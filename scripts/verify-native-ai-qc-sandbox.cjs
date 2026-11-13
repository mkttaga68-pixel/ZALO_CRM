// HTTP smoke probes only against the recorded synthetic instance. Never production.
const fs=require('node:fs'),path=require('node:path');
const parent=path.resolve(__dirname,'..','..','native-ai-qc-runtime');
async function main(){
  const latest=JSON.parse(fs.readFileSync(path.join(parent,'latest.json'),'utf8')),root=path.resolve(latest.root);
  if(!root.startsWith(parent+path.sep))throw Error('Invalid sandbox path');
  const evidence=JSON.parse(fs.readFileSync(path.join(root,'runtime-evidence.json'),'utf8'));
  if(!evidence.syntheticOnly||evidence.ports.frontend!==5174||evidence.ports.backend!==3091||evidence.ports.database!==59941)throw Error('Unexpected sandbox identity');
  const loginText=fs.readFileSync(path.join(root,'SYNTHETIC-LOGIN.txt'),'utf8'),password=loginText.match(/^Password: (.+)$/m)?.[1];if(!password?.startsWith('Synthetic-QC-'))throw Error('Synthetic login not found');
  const base='http://127.0.0.1:5174/api/v1';let token;
  const call=async(method,url,body,expected=200,authenticated=true)=>{const response=await fetch(base+url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(authenticated&&token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});if(response.status!==expected)throw Error(`Sandbox probe ${method} ${url} returned ${response.status}, expected ${expected}`);return response.json();};
  token=(await call('POST','/auth/login',{identifier:'ai-qc@sandbox.invalid',password})).token;
  const profile=await call('GET','/profile');if(profile.email!=='ai-qc@sandbox.invalid'||profile.org?.name!=='AI QC SYNTHETIC SANDBOX')throw Error('Synthetic profile mismatch');
  await call('GET','/ai-quality-control/status',undefined,401,false);
  const apiEnabled=evidence.apiActivation?.requested===true&&evidence.apiActivation.status==='CONFIGURED_SYNTHETIC_ONLY';
  const status=await call('GET','/ai-quality-control/status');if(!status.syntheticOnly||status.capabilities.realApi!==apiEnabled||status.capabilities.realData)throw Error('Unsafe flags');
  const workspace=await call('GET','/ai-quality-control/workspace');if(workspace.documents.some(d=>d.status!=='DRAFT')||!workspace.datasets.length)throw Error('Unexpected workspace');
  const run=await call('POST',`/ai-quality-control/datasets/${workspace.datasets[0].id}/analyze`,{provider:'mock'});if(run.status!=='NOT_EVALUABLE'||!run.output.findings.every(f=>f.status==='ABSTAIN'))throw Error('Missing-rule evidence was not preserved');
  const replay=await call('POST',`/ai-quality-control/runs/${run.id}/replay`,{});if(!replay.hashMatches||!replay.citationsValid)throw Error('Stored snapshot integrity mismatch');
  await call('GET','/ai-quality-control/crm/conversations',undefined,403);
  // A smoke verifier must never unexpectedly create a billable real request.
  if(!apiEnabled)await call('POST','/ai-quality-control/connection/test',{},403);
  const after=await call('GET','/ai-quality-control/workspace');if(!after.runs.some(r=>r.id===run.id))throw Error('PostgreSQL analysis persistence failed');
  const result={at:new Date().toISOString(),profile:'PASS',authenticatedNativeApi:'PASS',anonymousAccessBlocked:'PASS',missingPolicyAbstain:'PASS',postgresqlRunPersistence:'PASS',snapshotReplay:'PASS',realDataBlocked:'PASS',realApi:apiEnabled?'SYNTHETIC_ONLY_ENABLED_NO_ADDITIONAL_CALL':'BLOCKED',productionTouched:false};
  fs.writeFileSync(path.join(root,apiEnabled?'http-smoke-openai-config-evidence.json':'http-smoke-evidence.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
