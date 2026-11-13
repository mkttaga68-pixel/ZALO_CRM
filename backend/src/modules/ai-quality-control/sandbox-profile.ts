import path from 'node:path';

/** Only the scrubbed launcher + pre-import network guard may enable this profile.
 * An ordinary flag cannot disable workers in a production process. */
export function syntheticQcSandbox(): boolean {
  if (process.env.AI_QC_SANDBOX_RUNTIME !== 'true') return false;
  const proof = (globalThis as Record<symbol, unknown>)[Symbol.for('zlcrm.synthetic-qc-runtime')] as {root?:string;dbPort?:number;openAI?:boolean}|undefined;
  const url = new URL(process.env.DATABASE_URL || 'invalid:');
  const apiAllowed=proof?.openAI===true&&process.env.AI_QC_CREDENTIAL_SOURCE==='WINDOWS_DPAPI'&&!!process.env.OPENAI_API_KEY&&process.env.AI_QC_REAL_API_ENABLED==='true'&&process.env.AI_QC_OUTBOUND_TEST_APPROVED==='true';
  if (process.env.NODE_ENV !== 'test' || !proof?.root || !path.isAbsolute(proof.root) ||
      url.hostname !== '127.0.0.1' || Number(url.port) !== proof.dbPort || !/^\/ai_qc_sandbox_crm_[a-z0-9_]+$/.test(url.pathname) ||
      process.env.HOST !== '127.0.0.1' || !apiAllowed&&(process.env.AI_QC_REAL_API_ENABLED !== 'false'||process.env.AI_QC_OUTBOUND_TEST_APPROVED !== 'false') ||
      process.env.AI_QC_REAL_DATA_ENABLED !== 'false' ||
      process.env.AI_QC_REAL_DATA_OUTBOUND_APPROVED !== 'false') {
    throw new Error('Unverified synthetic CRM sandbox profile; refusing startup');
  }
  return true;
}
