// Test harness for the EXISTING auth routes + native bootstrap, no app/worker start.
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import http from 'node:http';import https from 'node:https';import tls from 'node:tls';import dns from 'node:dns';import dgram from 'node:dgram';
const root=process.env.QC_APP_INTEGRATION_ROOT,url=new URL(process.env.DATABASE_URL||'invalid:');
if(!root||process.env.NODE_ENV!=='production'||url.hostname!=='127.0.0.1'||url.port!=='59941'||!/^\/ai_qc_sandbox_crm_[a-z0-9_]+$/.test(url.pathname)||process.env.OPENAI_API_KEY||process.env.AI_QC_REAL_API_ENABLED!=='false'||process.env.AI_QC_REAL_DATA_ENABLED!=='false')throw Error('Unsafe application-mode smoke target');
const denied=()=>{throw Error('APPLICATION_SMOKE_OUTBOUND_DENIED');};const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const arg=Array.isArray(args[0])?args[0][0]:args[0],options=arg&&typeof arg==='object'?arg:{port:arg,host:args[1]};if(options.path||options.host!=='127.0.0.1'||Number(options.port)!==59941)return denied();return Reflect.apply(connect,this,args);};
globalThis.fetch=denied;http.request=denied;https.request=denied;http.get=denied;https.get=denied;tls.connect=denied;dns.lookup=denied;dgram.createSocket=denied;
const [{default:Fastify},{default:jwt},{authRoutes},{registerNativeAiQualityControl},{prisma}]=await Promise.all([import('../backend/node_modules/fastify/fastify.js'),import('../backend/node_modules/@fastify/jwt/jwt.js'),import('../backend/dist/modules/auth/auth-routes.js'),import('../backend/dist/modules/ai-quality-control/bootstrap.js'),import('../backend/dist/shared/database/prisma-client.js')]);
const app=Fastify({logger:false});let token;
try{
  await app.register(jwt,{secret:process.env.JWT_SECRET});await app.register(authRoutes);await registerNativeAiQualityControl(app);
  const call=async(method,endpoint,payload,expected=200,authenticated=true)=>{const response=await app.inject({method,url:'/api/v1'+endpoint,payload,headers:authenticated&&token?{authorization:'Bearer '+token}:{}});if(response.statusCode!==expected)throw Error(`Application smoke ${endpoint} returned ${response.statusCode}`);return response.json();};
  token=(await call('POST','/auth/login',{identifier:'ai-qc@sandbox.invalid',password:process.env.QC_SYNTHETIC_LOGIN})).token;
  const profile=await call('GET','/profile');if(profile.email!=='ai-qc@sandbox.invalid'||profile.org?.name!=='AI QC SYNTHETIC SANDBOX')throw Error('Synthetic identity mismatch');
  const status=await call('GET','/ai-quality-control/status');if(status.storageMode!=='application'||status.runtimeIntegration!=='EXISTING_CRM_BACKEND'||!status.syntheticOnly||status.capabilities.realApi||status.capabilities.realData)throw Error('Application mode contract mismatch');
  await call('GET','/ai-quality-control/status',undefined,401,false);
  const dataset=await call('POST','/ai-quality-control/datasets',{name:'APPLICATION MODE — server synthetic integration test',scenario:'polite'});
  const run=await call('POST',`/ai-quality-control/datasets/${dataset.id}/analyze`,{provider:'mock'});if(run.status!=='NOT_EVALUABLE'||!run.output.findings.every(f=>f.status==='ABSTAIN'))throw Error('Unapproved policy was used');
  const replay=await call('POST',`/ai-quality-control/runs/${run.id}/replay`,{});if(!replay.hashMatches||!replay.citationsValid)throw Error('Application store snapshot mismatch');
  const stored=await prisma.nativeAiQcWorkspace.findUnique({where:{organizationId:profile.orgId}});if(!stored||!JSON.stringify(stored.payload).includes(run.id))throw Error('Application Prisma store did not persist run');
  await call('GET','/ai-quality-control/crm/conversations',undefined,403);await call('POST','/ai-quality-control/connection/test',{},403);
  const result={at:new Date().toISOString(),NODE_ENV:'production',testData:'SYNTHETIC_ONLY',databaseTarget:'VERIFIED_LOOPBACK_SANDBOX',existingAuth:'PASS',existingProfile:'PASS',applicationPrismaStore:'PASS',authenticatedNativeRoutes:'PASS',anonymousBlocked:'PASS',draftPolicyAbstain:'PASS',persistentRun:'PASS',snapshotReplay:'PASS',realDataBlocked:'PASS',realApiBlocked:'PASS',appOrWorkersStarted:false,productionAccessed:false};
  fs.writeFileSync(path.join(root,'application-mode-smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await app.close();await prisma.$disconnect();}
