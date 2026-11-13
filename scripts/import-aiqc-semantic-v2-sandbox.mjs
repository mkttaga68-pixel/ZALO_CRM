// Append verified synthetic runs to the already established, identity-checked local sandbox.
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {digest} from '../backend/dist/modules/ai-quality-control/knowledge.js';
import {conversationHash} from '../backend/dist/modules/ai-quality-control/synthetic.js';
import {canonicalJson} from '../backend/dist/modules/ai-quality-control/contracts.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(repo,'..','native-ai-qc-runtime/mvxj0im3');
const fixture=JSON.parse(fs.readFileSync(path.resolve(repo,'..','aiqc-browser-e2e-20261101/fixtures.json'),'utf8'));
const runtime=JSON.parse(fs.readFileSync(path.join(root,'runtime-evidence.json'),'utf8'));
if(!runtime.syntheticOnly||runtime.ports.database!==59941)throw Error('SANDBOX_PROOF_REQUIRED');
const report=JSON.parse(fs.readFileSync(path.join(repo,'evidence/ollama-semantic-v2-20261102/results.json'),'utf8'));
if(!report.complete||report.results.length!==40||report.results.some(r=>r.run.conversation.source!=='SERVER_SYNTHETIC'||r.run.orgId!=='ollama-synthetic-tenant'))throw Error('SYNTHETIC_REPORT_REQUIRED');
const password=fs.readFileSync(path.join(root,'postgres-password.synthetic'),'utf8');if(!/^[a-f0-9]{48}$/.test(password))throw Error('CREDENTIAL_FORMAT');
const {Client}=createRequire(path.join(repo,'backend/package.json'))('pg');
const client=new Client({connectionString:`postgresql://ai_qc_sandbox:${password}@127.0.0.1:59941/ai_qc_sandbox_knowledge_mvxj0im3`,connectionTimeoutMillis:3000});
try{await client.connect();const proof=(await client.query("SELECT current_database() AS name,current_setting('data_directory') AS directory")).rows[0];
 if(proof.name!=='ai_qc_sandbox_knowledge_mvxj0im3'||path.resolve(proof.directory).toLowerCase()!==path.join(root,'postgres-data').toLowerCase())throw Error('IDENTITY_MISMATCH');
 await client.query('BEGIN');const row=(await client.query('SELECT payload,version FROM native_ai_qc_workspace WHERE organization_id=$1 FOR UPDATE',[fixture.orgId])).rows[0];if(!row)throw Error('WORKSPACE_MISSING');
 const state=row.payload;const approvedBefore=JSON.stringify(state.documents);let added=0;
 for(const result of report.results){const run=structuredClone(result.run);if(state.runs.some(r=>r.id===run.id))continue;
 run.orgId=fixture.orgId;run.createdBy=fixture.owner.id;run.conversation.orgId=fixture.orgId;run.conversation.provenanceHash=conversationHash(run.conversation);
 for(const doc of run.knowledgeSnapshot){doc.orgId=fixture.orgId;doc.stagedBy=fixture.owner.id;doc.approvedBy=fixture.owner.id;const existing=state.documents.find(d=>d.id===doc.id);if(existing&&existing.contentHash!==doc.contentHash)throw Error('DOCUMENT_COLLISION');if(!existing)state.documents.push(structuredClone(doc));}
 run.snapshotHash=digest(canonicalJson({conversation:run.conversation,authorityEpoch:run.authorityEpoch,indexVersion:run.indexVersion,knowledgeSnapshot:run.knowledgeSnapshot,output:run.output,usage:run.usage,provider:run.provider,createdAt:run.createdAt}));
 state.runs.push(run);added++;}
 if(Buffer.byteLength(JSON.stringify(state))>8*1024*1024||state.runs.length>500)throw Error('CAPACITY');
 if(JSON.stringify(state.documents)!==approvedBefore)throw Error('APPROVED_REGISTRY_CHANGED');
 state.version++;state.authorityEpoch++;state.indexVersion++;state.audits.push({id:'ollama-import-'+Date.now(),orgId:fixture.orgId,actorId:fixture.owner.id,at:new Date().toISOString(),action:'OLLAMA_SYNTHETIC_REPORT_IMPORTED',resourceId:'ollama-semantic-v2-20261102',details:{added}});
 await client.query('UPDATE native_ai_qc_workspace SET payload=$1::jsonb,version=version+1 WHERE organization_id=$2 AND version=$3',[JSON.stringify(state),fixture.orgId,row.version]);await client.query('COMMIT');console.log(JSON.stringify({added,syntheticOnly:true,dashboard:'http://localhost:5173/ai-quality-control'}));
}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{await client.end();}
