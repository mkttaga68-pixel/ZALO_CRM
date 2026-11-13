import { ANALYSIS_TYPES, QcError, type Workspace } from './contracts.js';

export interface DepartmentScanConfig {
  enabled: boolean; version: string; analysis_types: string[]; recipient_user_ids: string[];
  lookback_hours: number; max_conversations_per_run: number; approval_ref: string | null;
}

export function departmentEnableBlockers(config: DepartmentScanConfig | undefined, workspace: Workspace, orgId: string, departmentId: string, runtimeAvailable: boolean): string[] {
  const blockers: string[] = [];
  if (!runtimeAvailable) blockers.push('DEPARTMENT_LOCAL_TEST_NOT_AUTHORIZED');
  if (!config || !config.analysis_types.length || !config.recipient_user_ids.length || !config.approval_ref) blockers.push('DEPARTMENT_MONITOR_CONFIG_INCOMPLETE');
  if (workspace.settings.retentionDays !== 7 || !workspace.settings.retentionApprovedBy) blockers.push('RETENTION_7_DAYS_REQUIRED');
  for (const type of config?.analysis_types ?? []) {
    const now = Date.now();
    const found = workspace.documents.some(d => d.orgId === orgId && !d.synthetic && d.status === 'APPROVED' && !!d.approvedAt && d.rule?.type === type && !!d.effectiveFrom && Date.parse(d.effectiveFrom) <= now && (!d.effectiveTo || Date.parse(d.effectiveTo) > now) && (!d.departmentIds.length || d.departmentIds.includes(departmentId)));
    if (!found) blockers.push(`APPROVED_DEPARTMENT_RULES_MISSING:${type}`);
  }
  return blockers;
}

export function validateDepartmentToggle(body: unknown): { enabled: boolean; version: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new QcError('INVALID_BODY');
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some(k => !['enabled', 'version'].includes(k)) || typeof b.enabled !== 'boolean' || typeof b.version !== 'string' || !/^[1-9][0-9]{0,17}$/.test(b.version)) throw new QcError('INVALID_DEPARTMENT_TOGGLE');
  return { enabled: b.enabled, version: b.version };
}

export function assertDepartmentScanEnabled(config: DepartmentScanConfig, paused: boolean, expectedVersion?: string) {
  if (paused) throw new QcError('DEPARTMENT_LOCAL_TEST_KILL_SWITCH_ACTIVE', 423);
  if (!config.enabled) throw new QcError('DEPARTMENT_AI_DISABLED', 409);
  if (expectedVersion && config.version !== expectedVersion) throw new QcError('DEPARTMENT_CONFIGURATION_CHANGED', 409);
}

export function departmentLocalScanGate(input: { deploymentTier?: string; localFlag?: string; enabled: boolean; realData: boolean; manualRetention: boolean; openAiRemoved: boolean; ollamaEnabled: boolean; ollamaRealData: boolean; tenantMatches: boolean; persistentStorage: boolean }) {
  return input.deploymentTier === 'local-test' && input.localFlag === 'true' && input.enabled && input.realData && input.manualRetention && input.openAiRemoved && input.ollamaEnabled && input.ollamaRealData && input.tenantMatches && input.persistentStorage;
}

export function validateDepartmentMonitorDraft(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new QcError('INVALID_BODY');
  const input = body as Record<string, unknown>;
  const allowed = ['enabled', 'analysisTypes', 'recipientUserIds', 'lookbackHours', 'maxConversationsPerRun', 'approvalRef'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new QcError('UNSUPPORTED_MONITORING_CONFIG_FIELD');
  if (input.enabled !== undefined && input.enabled !== false) throw new QcError('MONITORING_RELEASE_GATE_CLOSED', 423);
  const analysisTypes = input.analysisTypes ?? [];
  const recipients = input.recipientUserIds ?? [];
  const lookbackHours = input.lookbackHours ?? 24;
  const maxConversationsPerRun = input.maxConversationsPerRun ?? 100;
  const approvalRef = input.approvalRef ?? '';
  if (!Array.isArray(analysisTypes) || analysisTypes.some(v => typeof v !== 'string' || !(ANALYSIS_TYPES as readonly string[]).includes(v))) throw new QcError('INVALID_ANALYSIS_TYPES');
  if (!Array.isArray(recipients) || recipients.length > 20 || recipients.some(v => typeof v !== 'string' || !v)) throw new QcError('INVALID_ALERT_RECIPIENTS');
  if (!Number.isInteger(lookbackHours) || Number(lookbackHours) < 1 || Number(lookbackHours) > 72) throw new QcError('INVALID_LOOKBACK_HOURS');
  if (!Number.isInteger(maxConversationsPerRun) || Number(maxConversationsPerRun) < 1 || Number(maxConversationsPerRun) > 500) throw new QcError('INVALID_CONVERSATION_LIMIT');
  if (typeof approvalRef !== 'string' || approvalRef.length > 120 || approvalRef && !/^[A-Za-z0-9._:/-]+$/.test(approvalRef)) throw new QcError('INVALID_APPROVAL_REFERENCE');
  return { analysisTypes: [...new Set(analysisTypes as string[])], recipientUserIds: [...new Set(recipients as string[])], lookbackHours: Number(lookbackHours), maxConversationsPerRun: Number(maxConversationsPerRun), approvalRef };
}
