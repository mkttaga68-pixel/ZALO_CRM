import type { Conversation, ResponseMetrics } from './contracts.js';
const description = 'Response rate = answered eligible customer request-turns / all eligible request-turns. Consecutive customer messages form one turn. Bot/system do not answer a turn. Unknown actors/timestamps, missing coverage/assignment/work calendar and not-yet-due unanswered turns are excluded. SLA uses verified working intervals; median/P90 use eligible answered turns only.';
function unavailable(reason: string): ResponseMetrics { return { status: 'NOT_AVAILABLE', reason, eligibleTurns: 0, answeredTurns: 0, unansweredEligibleTurns: 0, excludedTurns: 0, exclusions: { [reason]: 1 }, firstResponseSeconds: null, medianSeconds: null, p90Seconds: null, responseRate: null, slaCompliance: null, denominatorDescription: description }; }
function seconds(start: number, end: number, intervals: Array<{
    start: string;
    end: string;
}>) { return intervals.reduce((sum, i) => sum + Math.max(0, Math.min(end, Date.parse(i.end)) - Math.max(start, Date.parse(i.start))), 0) / 1000; }
export class EmployeeResponseAnalyticsService {
    calculate(conversation: Conversation, slaSeconds: number | null): ResponseMetrics {
        if (!Number.isFinite(Date.parse(conversation.observationEndAt)))
            return unavailable('INVALID_OBSERVATION_TIME');
        if (conversation.coverage !== 'VERIFIED')
            return unavailable('SYNC_COVERAGE_NOT_AVAILABLE');
        if (conversation.assignmentStatus !== 'VERIFIED' || !conversation.assignedActorId)
            return unavailable('ASSIGNMENT_NOT_AVAILABLE');
        if (!conversation.workIntervals?.length)
            return unavailable('WORK_CALENDAR_NOT_AVAILABLE');
        if (slaSeconds === null)
            return unavailable('APPROVED_SLA_NOT_AVAILABLE');
        const intervals = [...conversation.workIntervals].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
        if (intervals.some((v, i) => !Number.isFinite(Date.parse(v.start)) || !Number.isFinite(Date.parse(v.end)) || Date.parse(v.start) >= Date.parse(v.end) || i > 0 && Date.parse(v.start) < Date.parse(intervals[i - 1]!.end)))
            return unavailable('INVALID_OR_OVERLAPPING_WORK_INTERVALS');
        const messages = [...conversation.messages].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id));
        type Turn = {
            start: number;
            timestampKnown: boolean;
            answer: number | null;
            ambiguous: boolean;
        };
        const turns: Turn[] = [];
        let pending: Turn | undefined;
        const tieRoles = new Map<string, Set<string>>();
        for (const m of messages) {
            if (m.role === 'BOT' || m.role === 'SYSTEM')
                continue;
            const roles = tieRoles.get(m.occurredAt) ?? new Set();
            roles.add(m.role);
            tieRoles.set(m.occurredAt, roles);
        }
        for (const m of messages) {
            const at = Date.parse(m.occurredAt);
            if (!Number.isFinite(at) || at > Date.parse(conversation.observationEndAt))
                return unavailable('INVALID_EVENT_TIME');
            if (m.role === 'CUSTOMER') {
                if (!pending) {
                    pending = { start: at, timestampKnown: m.timestampStatus === 'VERIFIED', answer: null, ambiguous: false };
                    turns.push(pending);
                }
                pending.timestampKnown &&= m.timestampStatus === 'VERIFIED';
                if ((tieRoles.get(m.occurredAt)?.size ?? 0) > 1)
                    pending.ambiguous = true;
            }
            else if (m.role === 'UNKNOWN') {
                if (pending)
                    pending.ambiguous = true;
            }
            else if (m.role === 'HUMAN' && pending) {
                if (m.attribution !== 'VERIFIED' || !m.actorId || m.actorId !== conversation.assignedActorId || m.timestampStatus !== 'VERIFIED')
                    pending.ambiguous = true;
                if ((tieRoles.get(m.occurredAt)?.size ?? 0) > 1)
                    pending.ambiguous = true;
                if (m.attribution === 'VERIFIED' && m.actorId) {
                    pending.answer = at;
                    pending = undefined;
                }
            }
        }
        const exclusions: Record<string, number> = {}, latencies: number[] = [];
        let eligible = 0, answered = 0, unanswered = 0, met = 0;
        const exclude = (reason: string) => { exclusions[reason] = (exclusions[reason] ?? 0) + 1; };
        for (const turn of turns) {
            if (!turn.timestampKnown || turn.ambiguous) {
                exclude('UNKNOWN_ACTOR_TIMESTAMP_OR_ORDER');
                continue;
            }
            const elapsed = seconds(turn.start, turn.answer ?? Date.parse(conversation.observationEndAt), intervals);
            if (turn.answer === null && elapsed < slaSeconds) {
                exclude('PENDING_ELIGIBILITY_WINDOW');
                continue;
            }
            eligible++;
            if (turn.answer === null)
                unanswered++;
            else {
                answered++;
                latencies.push(elapsed);
                if (elapsed <= slaSeconds)
                    met++;
            }
        }
        const sorted = [...latencies].sort((a, b) => a - b), n = sorted.length;
        return { status: eligible ? 'AVAILABLE' : 'NOT_AVAILABLE', reason: eligible ? null : 'NO_ELIGIBLE_TURNS', eligibleTurns: eligible, answeredTurns: answered, unansweredEligibleTurns: unanswered, excludedTurns: Object.values(exclusions).reduce((a, b) => a + b, 0), exclusions,
            firstResponseSeconds: latencies[0] ?? null, medianSeconds: n ? (n % 2 ? sorted[Math.floor(n / 2)]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2) : null, p90Seconds: n ? sorted[Math.ceil(n * .9) - 1]! : null, responseRate: eligible ? answered / eligible : null, slaCompliance: eligible ? met / eligible : null, denominatorDescription: description };
    }
}
export class CustomerCareMonitoringService {
    evaluate(input: {
        verifiedPurchase: boolean;
        purchasedAt: string;
        lastProactiveCareAt: string | null;
        assignedActorId: string | null;
        coverageVerified: boolean;
    } | null, approvedIntervalDays: number | null, now = new Date()) {
        if (!input || !input.verifiedPurchase || !input.coverageVerified || !input.assignedActorId || approvedIntervalDays === null)
            return { status: 'NOT_AVAILABLE', reason: 'VERIFIED_ORDER_ASSIGNMENT_CARE_COVERAGE_OR_APPROVED_INTERVAL_MISSING', overdue: null };
        if (!Number.isInteger(approvedIntervalDays) || approvedIntervalDays <= 0 || approvedIntervalDays > 3650)
            return { status: 'NOT_AVAILABLE', reason: 'INVALID_APPROVED_CARE_INTERVAL', overdue: null };
        const last = Date.parse(input.lastProactiveCareAt ?? input.purchasedAt);
        if (!Number.isFinite(last) || !Number.isFinite(now.getTime()) || !Number.isFinite(Date.parse(input.purchasedAt)) || last < Date.parse(input.purchasedAt) || last > now.getTime())
            return { status: 'NOT_AVAILABLE', reason: 'INVALID_CARE_TIMESTAMP', overdue: null };
        return { status: 'OBSERVATION_ONLY', reason: null, overdue: now.getTime() - last > approvedIntervalDays * 86400000, reviewRequired: true };
    }
}
export class OffDayActivityService {
    evaluate(conversation: Conversation) {
        if (!conversation.offDayIntervals || conversation.coverage !== 'VERIFIED' || conversation.assignmentStatus !== 'VERIFIED' || !conversation.assignedActorId)
            return { status: 'NOT_AVAILABLE', reason: 'VERIFIED_OFF_DAY_CALENDAR_OR_COVERAGE_MISSING', messageIds: [] as string[] };
        if (conversation.offDayIntervals.some(i => !Number.isFinite(Date.parse(i.start)) || !Number.isFinite(Date.parse(i.end)) || Date.parse(i.end) <= Date.parse(i.start)))
            return { status: 'NOT_AVAILABLE', reason: 'INVALID_OFF_DAY_CALENDAR', messageIds: [] as string[] };
        const messageIds = conversation.messages.filter(m => m.role === 'HUMAN' && m.actorId === conversation.assignedActorId && m.attribution === 'VERIFIED' && m.timestampStatus === 'VERIFIED' && conversation.offDayIntervals!.some(i => Date.parse(m.occurredAt) >= Date.parse(i.start) && Date.parse(m.occurredAt) < Date.parse(i.end))).map(m => m.id);
        return { status: 'AVAILABLE', reason: null, messageIds, interpretation: 'Verified activity only; no intent, overtime approval or violation inferred.' };
    }
}
