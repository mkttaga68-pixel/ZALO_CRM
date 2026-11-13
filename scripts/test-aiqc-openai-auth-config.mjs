// Offline SDK header regression tests. Never uses a real key or network.
import OpenAI from '../backend/node_modules/openai/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const project='proj_6yDB6qP8X45ofaQO99BW2Bqy';
const original={project:process.env.OPENAI_PROJECT_ID,org:process.env.OPENAI_ORG_ID};
const captures=[];
const capture=async(url,init)=>{
 const headers=new Headers(init.headers);
 captures.push({project:headers.get('OpenAI-Project'),organization:headers.get('OpenAI-Organization'),url:String(url),body:JSON.parse(init.body)});
 return new Response(JSON.stringify({id:'offline-response',object:'response',status:'completed',model:'offline-model',output:[],usage:{input_tokens:0,output_tokens:0,total_tokens:0}}),{status:200,headers:{'content-type':'application/json'}});
};
let checks=0;
try{
 process.env.OPENAI_PROJECT_ID='proj_offline_override';process.env.OPENAI_ORG_ID='org_offline_override';
 const client=new OpenAI({apiKey:'synthetic-offline-key',project,organization:null,baseURL:'https://api.openai.com/v1',logLevel:'off',maxRetries:0,fetch:capture});
 await client.responses.create({model:'offline-model',input:'synthetic offline',store:false});
 assert.equal(captures[0].project,project);checks++;
 assert.equal(captures[0].organization,null);checks++;
 assert.equal(captures[0].url,'https://api.openai.com/v1/responses');checks++;
 assert.equal(captures[0].body.store,false);checks++;
 assert.equal(project.trim(),project);assert.match(project,/^proj_[A-Za-z0-9]+$/);checks++;
 assert.equal(Buffer.byteLength(project,'utf8'),project.length);checks++;
 // Reproduce the previous cleared-environment factory without an org option.
 delete process.env.OPENAI_ORG_ID;delete process.env.OPENAI_PROJECT_ID;
 const previous=new OpenAI({apiKey:'synthetic-offline-key',project,fetch:capture,logLevel:'off',maxRetries:0});
 await previous.responses.create({model:'offline-model',input:'synthetic offline',store:false});
 assert.equal(captures[1].project,project);assert.equal(captures[1].organization,null);checks++;
 const out={status:'PASS',checks,apiRequests:0,project,projectWhitespace:false,projectNonAscii:false,explicitProjectOverridesEnvironment:true,organizationAbsentInPreviousCleanEnvironment:true,explicitNullOrganizationBlocksInheritedOverride:true,projectHeaderPreserved:true,modelAvailability:'NOT_VERIFIED'};
 const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 fs.writeFileSync(path.join(base,'aiqc-semantic-session-20261102/auth-config-regression.json'),JSON.stringify(out,null,2));
 console.log(JSON.stringify(out));
}finally{
 for(const [name,value]of [['OPENAI_PROJECT_ID',original.project],['OPENAI_ORG_ID',original.org]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}
}
