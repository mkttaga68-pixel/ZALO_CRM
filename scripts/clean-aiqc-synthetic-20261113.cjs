const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {Pool}=require('../backend/node_modules/pg');
const orgId='a236afea-cc9c-4de8-81c0-ee5923385b2e',apply=process.argv.includes('--apply'),finalize=process.argv.includes('--finalize');
async function main(){
  const inspect=name=>JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8',windowsHide:true}))[0];
  const app=inspect('zalo-crm-app'),db=inspect('zalo-crm-db');
  const env=Object.fromEntries(app.Config.Env.map(e=>{const i=e.indexOf('=');return[e.slice(0,i),e.slice(i+1)];}));
  if(env.AI_QC_REAL_DATA_PILOT_ORG_ID!==orgId||env.AI_QC_OLLAMA_REAL_DATA_ENABLED!=='true'||env.AI_QC_OPENAI_REMOVED!=='true')throw Error('REAL_SOURCE_NOT_CONFIGURED');
  const binding=db.NetworkSettings.Ports['5432/tcp'].find(p=>p.HostIp==='127.0.0.1');if(!binding)throw Error('LOOPBACK_DATABASE_REQUIRED');
  const url=new URL(env.DATABASE_URL);url.hostname='127.0.0.1';url.port=binding.HostPort;
  const pool=new Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:5000});let c;
  try{
    c=await pool.connect();await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await c.query("SET LOCAL lock_timeout='5s'");
    const row=(await c.query('SELECT version,payload FROM native_ai_qc_workspace WHERE organization_id=$1 FOR UPDATE',[orgId])).rows[0];
    if(!row)throw Error('WORKSPACE_MISSING');const s=row.payload;
    const fake=s.documents.filter(d=>d.synthetic===true||d.sourcePath.startsWith('09_BO_TEST_AI/'));
    const expected=finalize?fake.length===2&&fake.every(d=>!d.synthetic&&d.sourcePath.startsWith('09_BO_TEST_AI/')):fake.length===6&&fake.filter(d=>d.synthetic===true).length===4;
    if(!expected||s.documents.some(d=>d.orgId!==orgId))throw Error('EXPECTED_SYNTHETIC_SCOPE_CHANGED');
    const datasetIds=new Set(s.datasets.filter(d=>['SERVER_SYNTHETIC','USER_ATTESTED_SAMPLE'].includes(d.conversation?.source)).map(d=>d.id));
    const runIds=new Set(s.runs.filter(r=>r.conversation?.source==='SERVER_SYNTHETIC'||r.conversation?.source==='USER_ATTESTED_SAMPLE').map(r=>r.id));
    const preservedRules=s.documents.filter(d=>!fake.includes(d)&&d.status==='APPROVED').map(d=>d.rule?.type);
    const result={orgId,applied:apply,deletedDocuments:fake.length,deletedDatasets:datasetIds.size,deletedRuns:runIds.size,remainingDocuments:s.documents.length-fake.length,preservedApprovedRuleTypes:preservedRules,provider:'ollama',model:'qwen3:4b-instruct',crmMessagesChanged:0};
    if(!apply){await c.query('ROLLBACK');console.log(JSON.stringify(result));return;}
    const fakeIds=new Set(fake.map(d=>d.id));s.documents=s.documents.filter(d=>!fakeIds.has(d.id));s.datasets=s.datasets.filter(d=>!datasetIds.has(d.id));s.runs=s.runs.filter(r=>!runIds.has(r.id));s.evaluations=s.evaluations.filter(e=>!datasetIds.has(e.datasetId)&&!runIds.has(e.runId));
    s.settings.provider='ollama';s.settings.model='qwen3:4b-instruct';s.version++;s.authorityEpoch++;s.indexVersion++;
    s.audits.push({id:randomUUID(),orgId,actorId:'operator:codex-user-request',action:'SYNTHETIC_DATA_REMOVED_FOR_REAL_CRM_TEST',resourceId:'knowledge',at:new Date().toISOString(),details:{deletedDocumentIds:[...fakeIds],deletedDatasetIds:[...datasetIds],deletedRunIds:[...runIds],provider:'ollama',model:'qwen3:4b-instruct',reason:'User requested removal of mock data and testing with existing real CRM sources.'}});
    const update=await c.query('UPDATE native_ai_qc_workspace SET payload=$1::jsonb,version=version+1,updated_at=NOW() WHERE organization_id=$2 AND version=$3',[JSON.stringify(s),orgId,row.version]);if(update.rowCount!==1)throw Error('WORKSPACE_CHANGED');
    await c.query('COMMIT');console.log(JSON.stringify(result));
  }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c?.release();await pool.end();}
}
main().catch(e=>{console.error('AIQC_SYNTHETIC_CLEANUP_FAILED',e.code||e.message);process.exitCode=1;});
