import { randomUUID } from 'node:crypto';
import { digest } from './knowledge.js';
import { canonicalJson, iso, QcError, type Conversation, type Message } from './contracts.js';
export const SYNTHETIC_SCENARIOS = ['insult', 'customer-insult', 'quoted', 'polite', 'unanswered', 'knowledge', 'missing-actor', 'bot', 'off-day', 'missing-coverage'] as const;
export function conversationHash(c: Conversation) { const { provenanceHash: _, ...rest } = c; return digest(canonicalJson(rest)); }
export function syntheticConversation(orgId: string, scenario: string): Conversation {
    if (!(SYNTHETIC_SCENARIOS as readonly string[]).includes(scenario))
        throw new QcError('UNKNOWN_SYNTHETIC_SCENARIO');
    // A simulated one-hour timeline starts after creation, so newly approved demo
    // rules can be exercised without backdating policy or claiming real elapsed time.
    const base = Date.now() + 1000;
    const message = (role: Message['role'], text: string, minute: number): Message => ({ id: randomUUID(), text, occurredAt: new Date(base + minute * 60000).toISOString(), role, actorId: role === 'HUMAN' ? 'synthetic-staff-A' : null, attribution: role === 'HUMAN' ? 'VERIFIED' : 'UNKNOWN', timestampStatus: 'VERIFIED' });
    const messages = [message('CUSTOMER', 'Cho tôi hỏi về mẫu sản phẩm SYNTHETIC-A?', 0), message('HUMAN', 'Tôi sẽ giải đáp câu hỏi của anh.', 2)];
    if (scenario === 'insult')
        messages[1]!.text = 'đồ ngu';
    if (scenario === 'customer-insult')
        messages[0]!.text = 'đồ ngu';
    if (scenario === 'quoted')
        messages[1]!.text = 'Khách nói "đồ ngu"; tôi xin trao đổi lịch sự.';
    if (scenario === 'knowledge')
        messages[1]!.text = 'SYNTHETIC-A miễn phí';
    if (scenario === 'unanswered')
        messages.push(message('CUSTOMER', 'Vậy bao giờ tôi nhận được hướng dẫn?', 3));
    if (scenario === 'missing-actor') {
        messages[1]!.role = 'UNKNOWN';
        messages[1]!.actorId = null;
        messages[1]!.attribution = 'UNKNOWN';
    }
    if (scenario === 'bot') {
        messages[1]!.role = 'BOT';
        messages[1]!.actorId = null;
        messages[1]!.attribution = 'UNKNOWN';
    }
    const c: Conversation = { id: randomUUID(), orgId, source: 'SERVER_SYNTHETIC', messages, departmentIds: [], coverage: scenario === 'missing-coverage' ? 'UNKNOWN' : 'VERIFIED', assignedActorId: 'synthetic-staff-A', assignmentStatus: 'VERIFIED',
        workIntervals: scenario === 'off-day' ? [] : [{ start: new Date(base - 3600000).toISOString(), end: new Date(base + 86400000).toISOString() }], offDayIntervals: scenario === 'off-day' ? [{ start: new Date(base - 3600000).toISOString(), end: new Date(base + 86400000).toISOString() }] : [], observationEndAt: new Date(base + 3600000).toISOString(), provenanceHash: null };
    c.provenanceHash = conversationHash(c);
    return c;
}
export function importAttestedSample(orgId: string, value: unknown): Conversation {
    const input = value as {
        messages?: unknown[];
        observationEndAt?: unknown;
    };
    if (!input || !Array.isArray(input.messages) || !input.messages.length || input.messages.length > 200)
        throw new QcError('INVALID_SAMPLE_MESSAGES');
    const messages: Message[] = input.messages.map(raw => {
        const m = raw as Record<string, unknown>;
        if (!m || typeof m.text !== 'string' || m.text.length > 4000 || !['CUSTOMER', 'HUMAN', 'BOT', 'SYSTEM', 'UNKNOWN'].includes(String(m.role)))
            throw new QcError('INVALID_SAMPLE_MESSAGE');
        return { id: randomUUID(), text: m.text, occurredAt: iso(m.occurredAt), role: m.role as Message['role'], actorId: null, attribution: 'UNKNOWN', timestampStatus: 'UNKNOWN' };
    });
    return { id: randomUUID(), orgId, source: 'USER_ATTESTED_SAMPLE', messages, departmentIds: [], coverage: 'UNKNOWN', assignedActorId: null, assignmentStatus: 'UNKNOWN', workIntervals: null, offDayIntervals: null, observationEndAt: iso(input.observationEndAt), provenanceHash: null };
}
