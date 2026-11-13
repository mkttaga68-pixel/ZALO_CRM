// Explicit, bounded cleanup requested by the operator. No CRM messages or budget records are deleted.
const {execFileSync}=require('node:child_process');
const {randomUUID,createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {Pool}=require('../backend/node_modules/pg');
const orgId='a236afea-cc9c-4de8-81c0-ee5923385b2e';
const departmentId='07a7a432-c6b6-498d-9eb8-d5aed66b5fc6';
const apply=process.argv.includes('--apply');
const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:20000});
async function main(){
  const app=JSON.parse(docker(['inspect','zalo-crm-app']))[0],db=JSON.parse(docker(['inspect','zalo-crm-db']))[0];
  if(app.Image!=='sha256:735d08c9cf5f6512c5473aebd93b7826b9d037841e86240108ca866b8007414c'||app.State.Paused||!app.State.Running)throw Error('APP_IDENTITY_CHANGED');
  const binding=db.NetworkSettings.Ports['5432/tcp'].find(p=>p.HostIp==='127.0.0.1');
  if(!binding)throw Error('LOOPBACK_DATABASE_REQUIRED');
  const url=new URL(app.Config.Env.find(e=>e.startsWith('DATABASE_URL=')).slice(13));url.hostname='127.0.0.1';url.port=binding.HostPort;
  const pool=new Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:5000});
  let client,paused=false,committed=false;
  try{
    client=await pool.connect();
    if(apply){docker(['pause','zalo-crm-app']);paused=true;}
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='15s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['aiqc-department-controls:'+orgId]);
    const row=(await client.query('SELECT version,payload FROM native_ai_qc_workspace WHERE organization_id=$1 FOR UPDATE',[orgId])).rows[0];
    const jobs=(await client.query('SELECT id,state FROM ai_qc_continuous_job WHERE org_id=$1 AND department_id=$2 FOR UPDATE',[orgId,departmentId])).rows;
    const config=(await client.query('SELECT enabled,continuous_enabled,version::text FROM ai_qc_department_monitor_config WHERE org_id=$1 AND department_id=$2 FOR UPDATE',[orgId,departmentId])).rows[0];
    if(!row||!config||jobs.length!==30||jobs.filter(j=>j.state==='DONE').length!==2||jobs.filter(j=>j.state==='DEAD').length!==28||row.payload.runs.length!==5||row.payload.runs.some(r=>r.orgId!==orgId))throw Error('CLEANUP_SCOPE_CHANGED');
    const state=row.payload,runs=state.runs,removedIds=new Set(runs.map(r=>r.id));
    const cutoff=(await client.query('SELECT clock_timestamp() AS at')).rows[0].at;
    const summary={orgId,departmentId,cutoff:cutoff.toISOString(),deletedRuns:runs.length,deletedJobs:jobs.length,deletedEvaluations:state.evaluations.filter(e=>removedIds.has(e.runId)).length,budgetReservationsPreserved:state.reservations.length,applied:apply};
    if(!apply){await client.query('ROLLBACK');console.log(JSON.stringify(summary));return;}
    const tombstoneHash=createHash('sha256').update(runs.map(r=>r.snapshotHash).sort().join('\n')).digest('hex');
    state.runs=[];state.evaluations=state.evaluations.filter(e=>!removedIds.has(e.runId));state.version++;
    state.audits.push({id:randomUUID(),orgId,actorId:'operator:codex-user-request',action:'ANALYSIS_HISTORY_CLEARED_BY_OPERATOR',resourceId:'analysis-history',at:cutoff.toISOString(),details:{deletedRuns:summary.deletedRuns,deletedJobs:summary.deletedJobs,departmentId,tombstoneHash,reason:'User requested deletion of previous AIQC analyses on 2026-11-13; no CRM messages deleted.'}});
    const updated=await client.query('UPDATE native_ai_qc_workspace SET payload=$1::jsonb,version=version+1,updated_at=NOW() WHERE organization_id=$2 AND version=$3',[JSON.stringify(state),orgId,row.version]);
    if(updated.rowCount!==1)throw Error('WORKSPACE_CHANGED');
    const deleted=await client.query('DELETE FROM ai_qc_continuous_job WHERE org_id=$1 AND department_id=$2 AND id=ANY($3::text[])',[orgId,departmentId,jobs.map(j=>j.id)]);
    if(deleted.rowCount!==30)throw Error('JOB_COUNT_CHANGED');
    // Removing queue rows alone would rediscover old messages on the next worker tick.
    const advanced=await client.query("UPDATE ai_qc_department_monitor_config SET activated_at=GREATEST(activated_at,$1::timestamptz+INTERVAL '1 millisecond') WHERE org_id=$2 AND department_id=$3",[cutoff,orgId,departmentId]);
    if(advanced.rowCount!==1)throw Error('CONFIG_CHANGED');
    await client.query('COMMIT');committed=true;
    const destination=path.resolve(__dirname,'../evidence/aiqc-job-recovery-20261113/history-cleared.json');
    fs.writeFileSync(destination,JSON.stringify({...summary,tombstoneHash,crmMessagesDeleted:0,settingsChanged:false,activationBoundaryAdvanced:true},null,2));
    console.log(JSON.stringify(summary));
  }finally{
    if(client&&!committed)await client.query('ROLLBACK').catch(()=>{});
    if(paused)docker(['unpause','zalo-crm-app']);
    client?.release();await pool.end();
  }
}
main().catch(e=>{console.error('AIQC_HISTORY_CLEANUP_FAILED',e.code||e.message);process.exitCode=1;});
