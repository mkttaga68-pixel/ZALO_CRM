import { describe, expect, it } from 'vitest';
import { departmentLocalScanGate, validateDepartmentMonitorDraft } from '../src/modules/ai-quality-control/department-monitoring-validation.js';
import { scopedDepartmentConversation } from '../src/modules/ai-quality-control/department-scan-scope.js';
import type { Conversation } from '../src/modules/ai-quality-control/contracts.js';

describe('department AIQC draft configuration', () => {
  it('keeps monitoring disabled and deduplicates supported values', () => {
    expect(validateDepartmentMonitorDraft({ enabled: false, analysisTypes: ['INSULT', 'INSULT'], recipientUserIds: ['manager-1', 'manager-1'] }))
      .toEqual({ analysisTypes: ['INSULT'], recipientUserIds: ['manager-1'], lookbackHours: 24, maxConversationsPerRun: 100, approvalRef: '' });
  });

  it('rejects attempts to enable the production scanner while the release gate is closed', () => {
    expect(() => validateDepartmentMonitorDraft({ enabled: true })).toThrow('MONITORING_RELEASE_GATE_CLOSED');
  });

  it('rejects unsupported analysis types, excessive limits, and secret-like fields', () => {
    expect(() => validateDepartmentMonitorDraft({ analysisTypes: ['STAFF_SCORE'] })).toThrow('INVALID_ANALYSIS_TYPES');
    expect(() => validateDepartmentMonitorDraft({ lookbackHours: 73 })).toThrow('INVALID_LOOKBACK_HOURS');
    expect(() => validateDepartmentMonitorDraft({ maxConversationsPerRun: 501 })).toThrow('INVALID_CONVERSATION_LIMIT');
    expect(() => validateDepartmentMonitorDraft({ apiKey: 'never-accepted' })).toThrow('UNSUPPORTED_MONITORING_CONFIG_FIELD');
    expect(() => validateDepartmentMonitorDraft({ approvalRef: 'contains spaces and PII' })).toThrow('INVALID_APPROVAL_REFERENCE');
  });

  it('opens only with every local-only, tenant, Ollama and retention gate', () => {
    const base = { deploymentTier: 'local-test', localFlag: 'true', enabled: true, realData: true, manualRetention: true, openAiRemoved: true, ollamaEnabled: true, ollamaRealData: true, tenantMatches: true, persistentStorage: true };
    expect(departmentLocalScanGate(base)).toBe(true);
    expect(departmentLocalScanGate({ ...base, deploymentTier: 'production' })).toBe(false);
    expect(departmentLocalScanGate({ ...base, localFlag: 'false' })).toBe(false);
    expect(departmentLocalScanGate({ ...base, ollamaEnabled: false })).toBe(false);
    expect(departmentLocalScanGate({ ...base, persistentStorage: false })).toBe(false);
  });

  it('keeps only current-department verified staff and customer context inside the configured time window', () => {
    const now = Date.now();
    const conversation: Conversation = { id: 'conversation', orgId: 'org-a', source: 'CRM', departmentIds: [], coverage: 'UNKNOWN', assignedActorId: null,
      assignmentStatus: 'UNKNOWN', workIntervals: null, offDayIntervals: null, observationEndAt: new Date(now).toISOString(), provenanceHash: null,
      messages: [
        { id: 'customer', text: 'context', role: 'CUSTOMER', actorId: null, attribution: 'UNKNOWN', timestampStatus: 'VERIFIED', occurredAt: new Date(now - 60000).toISOString() },
        { id: 'member', text: 'reply', role: 'HUMAN', actorId: 'member-a', attribution: 'VERIFIED', timestampStatus: 'VERIFIED', occurredAt: new Date(now - 30000).toISOString() },
        { id: 'other-dept', text: 'outside', role: 'HUMAN', actorId: 'member-b', attribution: 'VERIFIED', timestampStatus: 'VERIFIED', occurredAt: new Date(now - 20000).toISOString() },
        { id: 'unknown', text: 'unattributed', role: 'HUMAN', actorId: null, attribution: 'UNKNOWN', timestampStatus: 'VERIFIED', occurredAt: new Date(now - 10000).toISOString() },
        { id: 'old', text: 'old', role: 'HUMAN', actorId: 'member-a', attribution: 'VERIFIED', timestampStatus: 'VERIFIED', occurredAt: new Date(now - 2 * 3600000).toISOString() },
      ] };
    const scoped = scopedDepartmentConversation(conversation, 'dept-a', new Set(['member-a']), 1);
    expect(scoped?.departmentIds).toEqual(['dept-a']);
    expect(scoped?.messages.map(message => message.id)).toEqual(['customer', 'member']);
  });
});
