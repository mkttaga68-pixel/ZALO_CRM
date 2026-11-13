import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONTROL_PROJECT, CONTROL_MODEL, CONTROL_ORG, OpenAiControl, controlledOpenAiFetch, readOpenAiSecret, createControlledOpenAiClient } from '../src/modules/ai-quality-control/openai-control.js';
import { safeOutboundFetch } from '../src/shared/utils/safe-outbound-fetch.js';
import { OpenAIProvider, providerEnvironment } from '../src/modules/ai-quality-control/providers.js';
import { ANALYSIS_TYPES, initialWorkspace } from '../src/modules/ai-quality-control/contracts.js';
import { syntheticConversation } from '../src/modules/ai-quality-control/synthetic.js';
import { MemoryWorkspaceRepository } from '../src/modules/ai-quality-control/repository.js';
import { AIProviderService } from '../src/modules/ai-quality-control/providers.js';
import { ConversationAnalyzerService } from '../src/modules/ai-quality-control/analysis.js';
vi.mock('../src/shared/utils/safe-outbound-fetch.js',()=>({safeOutboundFetch:vi.fn()}));

function fixture(patch = {}) {
    const root = path.join(process.env.QC_TEST_ROOT!, 'control-' + randomUUID()); fs.mkdirSync(root);
    const policy = {project:CONTROL_PROJECT,model:CONTROL_MODEL,enabled:true,dailyUsd:2,monthlyUsd:30,maxConcurrent:1,requestsPerMinute:5,dailyTokenBudget:20000,...patch};
    fs.writeFileSync(path.join(root,'policy.json'),JSON.stringify(policy));fs.writeFileSync(path.join(root,'enabled'),'ALLOW_SYNTHETIC');
    fs.writeFileSync(path.join(root,'ledger.json'),JSON.stringify({version:1,project:CONTROL_PROJECT,blocked:false,entries:[]}));
    return {root,ledger:()=>JSON.parse(fs.readFileSync(path.join(root,'ledger.json'),'utf8'))};
}
const body = () => JSON.stringify({model:CONTROL_MODEL,store:false,max_output_tokens:256,instructions:'synthetic only',input:JSON.stringify({conversation:{source:'SERVER_SYNTHETIC'},knowledge:[]}),text:{format:{name:'native_ai_quality_control',type:'json_schema',strict:true}}});
const success = () => new Response(JSON.stringify({model:CONTROL_MODEL,usage:{input_tokens:10,output_tokens:5}}),{status:200});
describe('durable controlled OpenAI project gate (zero network)',()=>{
    it('local OpenAI removal ignores inherited credentials, model and enabling flags',()=>{
        const environment=providerEnvironment({AI_QC_OPENAI_REMOVED:'true',AI_QC_ENABLED:'true',AI_QC_REAL_API_ENABLED:'true',AI_QC_OUTBOUND_TEST_APPROVED:'true',OPENAI_MODEL:CONTROL_MODEL,OPENAI_API_KEY_FILE:'/must-not-read'});
        expect(environment.apiKey()).toBeUndefined();
        expect(environment.capabilities).toEqual({});
        expect(environment.realApi).toBe(false);
        expect(environment.realData).toBe(false);
        const service=new AIProviderService(environment);
        expect(service.status(initialWorkspace().settings)).toMatchObject({openAiRemoved:true,model:'',provider:'mock',models:[],apiKeyConfigured:false,realApiEnabled:false});
        expect(service.forSettings(initialWorkspace().settings).name).toBe('mock');
        expect(()=>service.forSettings({...initialWorkspace().settings,provider:'openai'})).toThrow('OPENAI_REMOVED');
    });
    it('local removal blocks direct provider calls before a client or key is read',async()=>{
        const key=vi.fn(),client=vi.fn();
        const environment={...providerEnvironment({AI_QC_OPENAI_REMOVED:'true'}),apiKey:key};
        const provider=new OpenAIProvider(environment,initialWorkspace().settings,client);
        await expect(provider.analyze({conversation:syntheticConversation('synthetic','polite'),knowledge:[],maxOutputTokens:256})).rejects.toThrow('OPENAI_REMOVED');
        expect(key).not.toHaveBeenCalled();expect(client).not.toHaveBeenCalled();
    });
    it('missing secret keeps Mock status available while real key access fails closed',()=>{
        const env=providerEnvironment({OPENAI_API_KEY_FILE:'/missing/backend-only-secret'});
        expect(new AIProviderService(env).status(initialWorkspace().settings).apiKeyConfigured).toBe(false);
        expect(()=>env.apiKey()).toThrow('SECRET_UNAVAILABLE');
    });
    it('default provider client goes through real SDK serialization and controlled transport',async()=>{
        const f=fixture(),secret=path.join(f.root,'secret');fs.writeFileSync(secret,'sk-synthetic-only-not-a-real-key');
        const output={summary:'Synthetic SDK gate test',findings:ANALYSIS_TYPES.map(type=>({type,status:'ABSTAIN',messageIds:[],citations:[],explanation:'No approved knowledge.',missingContext:['RULE_MISSING']}))};
        const transport=vi.mocked(safeOutboundFetch);transport.mockReset();transport.mockResolvedValue(new Response(JSON.stringify({id:'resp_synthetic',object:'response',status:'completed',model:CONTROL_MODEL,output:[{type:'message',id:'msg_synthetic',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(output),annotations:[]}]}],usage:{input_tokens:10,output_tokens:5,total_tokens:15}}),{status:200,headers:{'content-type':'application/json'}}));
        const environment=providerEnvironment({AI_QC_ENABLED:'true',AI_QC_REAL_API_ENABLED:'true',AI_QC_OUTBOUND_TEST_APPROVED:'true',AI_QC_REAL_DATA_ENABLED:'false',AI_QC_REAL_DATA_OUTBOUND_APPROVED:'false',AI_QC_AUTO_MONITOR_ENABLED:'false',AI_QC_OPENAI_ORG_ID:CONTROL_ORG,OPENAI_API_KEY_FILE:secret,OPENAI_PROJECT_ID:CONTROL_PROJECT,OPENAI_MODEL:CONTROL_MODEL,AI_QC_MODEL_CAPABILITIES:JSON.stringify({[CONTROL_MODEL]:{responses:true,structuredOutputs:true,reasoningEffort:'none'}}),AI_QC_OPENAI_CONTROL_DIR:f.root});
        const settings={...initialWorkspace().settings,provider:'openai' as const,model:CONTROL_MODEL,maxOutputTokens:256};
        const result=await new OpenAIProvider(environment,settings).analyze({conversation:syntheticConversation('synthetic','polite'),knowledge:[],maxOutputTokens:256});
        expect(result.output).toEqual(output);expect(result.usage.model).toBe(CONTROL_MODEL);expect(transport).toHaveBeenCalledTimes(1);expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({'OpenAI-Project':CONTROL_PROJECT});expect(f.ledger().entries[0].state).toBe('FINISHED');expect(JSON.stringify(f.ledger())).not.toContain('sk-synthetic');
    });
    it('rejects non-ASLAN analysis and connection test before provider dispatch',async()=>{
        const repo=new MemoryWorkspaceRepository(),environment=providerEnvironment({AI_QC_ENABLED:'true',AI_QC_REAL_API_ENABLED:'true',AI_QC_OUTBOUND_TEST_APPROVED:'true',AI_QC_OPENAI_ORG_ID:CONTROL_ORG});
        const factory=vi.fn(),analyzer=new ConversationAnalyzerService(repo,new AIProviderService(environment,factory),environment);
        const actor={id:'synthetic',orgId:'synthetic-other',departmentIds:[],permissions:['access','create','edit'] as ('access'|'create'|'edit')[]};
        await expect(analyzer.analyze(actor,syntheticConversation(actor.orgId,'polite'),'openai')).rejects.toThrow('OPENAI_TENANT_NOT_AUTHORIZED');
        await expect(analyzer.testConnection(actor)).rejects.toThrow('OPENAI_TENANT_NOT_AUTHORIZED');expect(factory).not.toHaveBeenCalled();
    });
    it('persists conservative cost and provider token usage separately across instances',()=>{const f=fixture(),g=new OpenAiControl(f.root),id=g.reserve(10,256);g.finish(id,{input_tokens:10,output_tokens:5},256);expect(f.ledger().entries[0]).toMatchObject({state:'FINISHED',reservedNano:525256000,usage:{input:10,output:5,estimatedNano:10000}});expect(()=>new OpenAiControl(f.root).reserve(10,256)).not.toThrow();});
    it('stops before dispatch at daily cost ceiling',()=>{const f=fixture({dailyUsd:0.21});expect(()=>new OpenAiControl(f.root).reserve(1,256)).toThrow('BUDGET_EXCEEDED');expect(f.ledger().entries).toHaveLength(0);});
    it('cannot reserve a fourth request beyond the actual 2 USD daily ceiling',()=>{const f=fixture({dailyTokenBudget:50000}),g=new OpenAiControl(f.root);for(let n=0;n<3;n++){const id=g.reserve(1,256);g.finish(id,{input_tokens:1,output_tokens:1});}expect(()=>g.reserve(1,256)).toThrow('BUDGET_EXCEEDED');expect(f.ledger().entries.reduce((n:number,e:{reservedNano:number})=>n+e.reservedNano,0)).toBeLessThanOrEqual(2e9);});
    it('cannot exceed the actual 30 USD monthly ceiling across different days',()=>{const f=fixture({dailyTokenBudget:50000}),now=new Date('2026-11-01T01:00:00Z'),g=new OpenAiControl(f.root,()=>now);for(let day=1;day<=19;day++){now.setUTCDate(day);for(let n=0;n<3;n++){const id=g.reserve(1,256);g.finish(id,{input_tokens:1,output_tokens:1});}}now.setUTCDate(20);expect(()=>g.reserve(1,256)).toThrow('BUDGET_EXCEEDED');expect(f.ledger().entries.reduce((n:number,e:{reservedNano:number})=>n+e.reservedNano,0)).toBeLessThanOrEqual(30e9);});
    it('stops at monthly cost ceiling even when today has no usage',()=>{const f=fixture({monthlyUsd:0.8});const now=new Date('2026-11-10T10:00:00Z'),g=new OpenAiControl(f.root,()=>now);const id=g.reserve(1,256);g.finish(id,{input_tokens:1,output_tokens:1});now.setUTCDate(11);expect(()=>g.reserve(1,256)).toThrow('BUDGET_EXCEEDED');});
    it('rejects excessive approved ceiling and missing project configuration',()=>{const f=fixture({dailyUsd:3});expect(()=>new OpenAiControl(f.root).reserve(1,256)).toThrow('POLICY_INVALID');expect(()=>controlledOpenAiFetch(f.root,'proj_wrong')).toThrow('PROJECT_MISMATCH');});
    it('global concurrency across instances; a crashed OPEN reservation is not silently freed',()=>{const f=fixture();new OpenAiControl(f.root).reserve(1,256);expect(()=>new OpenAiControl(f.root).reserve(1,256)).toThrow('CONCURRENCY');});
    it('limits concurrent dispatch across independent wrapper instances',async()=>{const f=fixture();let release!:()=>void;const wait=new Promise<void>(r=>release=r);const transport=vi.fn(async()=>{await wait;return success();});const a=controlledOpenAiFetch(f.root,CONTROL_PROJECT,transport),b=controlledOpenAiFetch(f.root,CONTROL_PROJECT,transport);const first=a('https://api.openai.com/v1/responses',{method:'POST',body:body()});await expect(b('https://api.openai.com/v1/responses',{method:'POST',body:body()})).rejects.toThrow('CONCURRENCY');release();await first;expect(transport).toHaveBeenCalledTimes(1);});
    it('enforces project-wide rate and token budget',()=>{const f=fixture({requestsPerMinute:1}),g=new OpenAiControl(f.root),id=g.reserve(1,256);g.finish(id,{input_tokens:1,output_tokens:1});expect(()=>g.reserve(1,256)).toThrow('RATE_LIMIT');const b=fixture({dailyTokenBudget:100});expect(()=>new OpenAiControl(b.root).reserve(1,256)).toThrow('DAILY_TOKEN_BUDGET');});
    it('kill switch stops future calls without restart',async()=>{const f=fixture(),transport=vi.fn(async()=>success()),send=controlledOpenAiFetch(f.root,CONTROL_PROJECT,transport);await send('https://api.openai.com/v1/responses',{method:'POST',body:body()});fs.writeFileSync(path.join(f.root,'enabled'),'DISABLED');await expect(send('https://api.openai.com/v1/responses',{method:'POST',body:body()})).rejects.toThrow('DISABLED');expect(transport).toHaveBeenCalledTimes(1);});
    it('retains timeout/unknown charges across day and month boundaries',()=>{const f=fixture({monthlyUsd:0.8}),now=new Date('2026-11-30T16:59:59Z'),g=new OpenAiControl(f.root,()=>now),id=g.reserve(1,256);g.finish(id);now.setTime(Date.parse('2026-12-02T01:00:00Z'));expect(()=>g.reserve(1,256)).toThrow('BUDGET_EXCEEDED');});
    it('counts completed midnight-crossing calls in both local periods',()=>{const f=fixture({dailyUsd:0.8}),now=new Date('2026-11-01T16:59:59Z'),g=new OpenAiControl(f.root,()=>now),id=g.reserve(1,256);now.setTime(Date.parse('2026-11-01T17:00:01Z'));g.finish(id,{input_tokens:1,output_tokens:1});expect(()=>g.reserve(1,256)).toThrow('BUDGET_EXCEEDED');});
    it('new day frees only completed prior-day reservations',()=>{const f=fixture({dailyUsd:0.8}),now=new Date('2026-11-01T01:00:00Z'),g=new OpenAiControl(f.root,()=>now),id=g.reserve(1,256);g.finish(id,{input_tokens:1,output_tokens:1});now.setUTCDate(2);expect(()=>g.reserve(1,256)).not.toThrow();});
    it('rejects missing/corrupt ledgers and abandoned lock rather than resetting spend',()=>{const f=fixture();fs.unlinkSync(path.join(f.root,'ledger.json'));expect(()=>new OpenAiControl(f.root).reserve(1,256)).toThrow();fs.writeFileSync(path.join(f.root,'ledger.json'),'{}');expect(()=>new OpenAiControl(f.root).reserve(1,256)).toThrow('LEDGER_INVALID');fs.mkdirSync(path.join(f.root,'.lock'));expect(()=>new OpenAiControl(f.root).reserve(1,256)).toThrow('LEDGER_LOCKED');});
    it('clock rollback fails closed',()=>{const f=fixture(),now=new Date('2026-11-02T01:00:00Z'),g=new OpenAiControl(f.root,()=>now),id=g.reserve(1,256);g.finish(id);now.setUTCDate(1);expect(()=>g.reserve(1,256)).toThrow('CLOCK_ROLLBACK');});
    it.runIf(process.platform==='win32')('retries a transient Windows rename without resetting the ledger',()=>{const f=fixture(),original=fs.renameSync,rename=vi.spyOn(fs,'renameSync');rename.mockImplementationOnce(()=>{throw Object.assign(new Error('synthetic Windows lock'),{code:'EPERM'});}).mockImplementation((...args)=>original(...args));try{const g=new OpenAiControl(f.root),id=g.reserve(1,256);g.finish(id,{input_tokens:1,output_tokens:1});expect(f.ledger().entries).toHaveLength(1);expect(rename.mock.calls.length).toBeGreaterThanOrEqual(3);}finally{rename.mockRestore();}});
    it('invalid usage trips persistent block and never refunds',()=>{const f=fixture(),g=new OpenAiControl(f.root),id=g.reserve(1,256);g.finish(id,{input_tokens:-1,output_tokens:1});expect(f.ledger().blocked).toBe(true);expect(()=>g.reserve(1,256)).toThrow('LEDGER_BLOCKED');});
    it.each(['http://api.openai.com/v1/responses','https://api.openai.com/v1/models','https://api.openai.com/v1/responses?x=1','https://example.com/v1/responses'])('denies destination %s without transport',async(url)=>{const f=fixture(),transport=vi.fn();await expect(controlledOpenAiFetch(f.root,CONTROL_PROJECT,transport)(url,{method:'POST',body:body()})).rejects.toThrow('DESTINATION');expect(transport).not.toHaveBeenCalled();});
    it.each([{store:true},{model:'other'},{tools:[]},{background:true},{service_tier:'fast'},{input:JSON.stringify({conversation:{source:'CRM'},knowledge:[]})}])('denies unapproved contract %j',async(patch)=>{const f=fixture(),transport=vi.fn();await expect(controlledOpenAiFetch(f.root,CONTROL_PROJECT,transport)('https://api.openai.com/v1/responses',{method:'POST',body:JSON.stringify({...JSON.parse(body()),...patch})})).rejects.toThrow('SYNTHETIC_CONTRACT');expect(transport).not.toHaveBeenCalled();});
    it('strips extra headers and pins the configured project; redirect leaves uncertain spend',async()=>{const f=fixture(),transport=vi.fn(async()=>new Response(null,{status:302}));await expect(controlledOpenAiFetch(f.root,CONTROL_PROJECT,transport)('https://api.openai.com/v1/responses',{method:'POST',body:body(),headers:{host:'evil','OpenAI-Project':'other'}})).rejects.toThrow('REDIRECT');expect(transport.mock.calls[0]?.[1]).toMatchObject({headers:{'OpenAI-Project':CONTROL_PROJECT}});expect(f.ledger().entries[0].state).toBe('UNCERTAIN');});
    it('default client refuses uncontrolled real dispatch or missing secret file',()=>{expect(()=>createControlledOpenAiClient({},'synthetic')).toThrow('CONFIGURATION_REQUIRED');expect(()=>readOpenAiSecret({OPENAI_API_KEY_FILE:'/missing/secret'})).toThrow('SECRET_UNAVAILABLE');});
    it('reads a server-only secret file without returning its value in errors',()=>{const f=fixture(),file=path.join(f.root,'secret');fs.writeFileSync(file,'sk-synthetic-only-not-a-real-key');expect(readOpenAiSecret({OPENAI_API_KEY_FILE:file})).toBe('sk-synthetic-only-not-a-real-key');fs.writeFileSync(file,'bad-value');expect(()=>readOpenAiSecret({OPENAI_API_KEY_FILE:file})).toThrow('SECRET_UNAVAILABLE');});
});
