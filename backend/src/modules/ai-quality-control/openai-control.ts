import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { safeOutboundFetch } from '../../shared/utils/safe-outbound-fetch.js';
import { consumeManualEgressPermit } from './manual-real-consent.js';

export const CONTROL_PROJECT = 'proj_6yDB6qP8X45ofaQO99BW2Bqy';
export const CONTROL_MODEL = 'gpt-6-luna';
export const CONTROL_ORG = 'a236afea-cc9c-4de8-81c0-ee5923385b2e';
const DAY_LIMIT = 2_000_000_000, MONTH_LIMIT = 30_000_000_000; // integer nano-USD
// Reserve the entire documented context at long-context rates, not an optimistic token estimate.
const MAX_INPUT = 1_050_000, INPUT_NANO = 500, OUTPUT_NANO = 1000;
type Entry = { id: string; at: string; finishedAt?: string; reservedNano: number; tokens: number; state: 'OPEN' | 'FINISHED' | 'UNCERTAIN'; usage?: { input: number; output: number; estimatedNano: number } };
type Ledger = { version: 1; project: string; blocked: boolean; entries: Entry[] };
type Policy = { project: string; model: string; enabled: boolean; dailyUsd: number; monthlyUsd: number; maxConcurrent: number; requestsPerMinute: number; dailyTokenBudget: number };
const deny: (code: string) => never = code => { throw Error('OPENAI_CONTROL_' + code); };

function readFile(file: string, limit: number): string {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > limit) deny('FILE_INVALID');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try { const opened = fs.fstatSync(fd); if (opened.ino !== stat.ino || opened.dev !== stat.dev) deny('FILE_CHANGED'); return fs.readFileSync(fd, 'utf8'); }
    finally { fs.closeSync(fd); }
}

export function readOpenAiSecret(env: NodeJS.ProcessEnv): string | undefined {
    if (!env.OPENAI_API_KEY_FILE) return env.OPENAI_API_KEY;
    try {
        if (!path.isAbsolute(env.OPENAI_API_KEY_FILE)) deny('SECRET_PATH');
        const value = readFile(env.OPENAI_API_KEY_FILE, 1024).trim();
        if (!/^sk-[A-Za-z0-9_-]{17,}$/.test(value)) deny('SECRET_FORMAT');
        return value;
    } catch { return deny('SECRET_UNAVAILABLE'); }
}

/** One persistent directory per API project, shared by all app replicas. No automatic reset/recovery. */
export class OpenAiControl {
    constructor(private root: string, private now: () => Date = () => new Date()) {
        if (!path.isAbsolute(root) || fs.realpathSync(root) !== path.resolve(root) || !fs.lstatSync(root).isDirectory()) deny('ROOT_INVALID');
    }
    private policy(): Policy {
        const p = JSON.parse(readFile(path.join(this.root, 'policy.json'), 8192)) as Policy;
        if (p.project !== CONTROL_PROJECT || p.model !== CONTROL_MODEL || p.enabled !== true ||
            !Number.isFinite(p.dailyUsd) || p.dailyUsd <= 0 || p.dailyUsd > 2 || !Number.isFinite(p.monthlyUsd) || p.monthlyUsd <= 0 || p.monthlyUsd > 30 ||
            p.maxConcurrent !== 1 || !Number.isInteger(p.requestsPerMinute) || p.requestsPerMinute < 1 || p.requestsPerMinute > 5 ||
            !Number.isInteger(p.dailyTokenBudget) || p.dailyTokenBudget < 1 || p.dailyTokenBudget > 50000 ||
            readFile(path.join(this.root, 'enabled'), 64).trim() !== 'ALLOW_SYNTHETIC') deny('DISABLED_OR_POLICY_INVALID');
        return p;
    }
    assertEnabled() { this.policy(); }
    private mutate<T>(fn: (ledger: Ledger) => T): T {
        const lock = path.join(this.root, '.lock');
        try { fs.mkdirSync(lock, { mode: 0o700 }); } catch { return deny('LEDGER_LOCKED'); }
        try {
            const file = path.join(this.root, 'ledger.json');
            const s = JSON.parse(readFile(file, 4 * 1024 * 1024)) as Ledger;
            if (s.version !== 1 || s.project !== CONTROL_PROJECT || typeof s.blocked !== 'boolean' || !Array.isArray(s.entries) || s.entries.length > 5000 ||
                s.entries.some(e => !e.id || !Number.isFinite(Date.parse(e.at)) || !Number.isSafeInteger(e.reservedNano) || e.reservedNano < 1 ||
                    !Number.isSafeInteger(e.tokens) || e.tokens < 1 || !['OPEN','FINISHED','UNCERTAIN'].includes(e.state) ||
                    e.finishedAt !== undefined && !Number.isFinite(Date.parse(e.finishedAt)))) deny('LEDGER_INVALID');
            if (s.blocked) deny('LEDGER_BLOCKED');
            const result = fn(s), tmp = path.join(this.root, '.write-' + randomUUID());
            const fd = fs.openSync(tmp, 'wx', 0o600);
            try { fs.writeFileSync(fd, JSON.stringify(s)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            for(let attempt=0;;attempt++){
                try{fs.renameSync(tmp,file);break;}
                catch(error){const code=(error as NodeJS.ErrnoException).code;if(process.platform!=='win32'||attempt>=3||!['EPERM','EACCES','EBUSY'].includes(code??''))throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}
            }
            if (process.platform !== 'win32') { const dir = fs.openSync(this.root, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
            return result;
        } finally { fs.rmdirSync(lock); }
    }
    reserve(bodyBytes: number, output: number): string {
        const p = this.policy(), now = this.now();
        if (!Number.isInteger(bodyBytes) || bodyBytes < 1 || bodyBytes > 65536 || !Number.isInteger(output) || output < 256 || output > 4096) deny('TOKEN_BOUND');
        const calendar = (at: string) => new Date(Date.parse(at) + 7 * 3600000).toISOString();
        const stamp = now.toISOString(), day = calendar(stamp).slice(0,10), month = day.slice(0,7);
        const reservedNano = MAX_INPUT * INPUT_NANO + output * OUTPUT_NANO, tokens = bodyBytes + output + 8192;
        return this.mutate(s => {
            if (s.entries.some(e => Date.parse(e.at) > now.getTime())) deny('CLOCK_ROLLBACK');
            if (s.entries.filter(e => e.state === 'OPEN').length >= p.maxConcurrent) deny('CONCURRENCY');
            // Unknown/in-flight charges carry forward; a request crossing midnight is charged to both periods.
            const today = s.entries.filter(e => e.state !== 'FINISHED' || calendar(e.at).startsWith(day) || e.finishedAt && calendar(e.finishedAt).startsWith(day));
            const monthly = s.entries.filter(e => e.state !== 'FINISHED' || calendar(e.at).startsWith(month) || e.finishedAt && calendar(e.finishedAt).startsWith(month));
            if (today.reduce((n,e) => n + e.reservedNano,0) + reservedNano > Math.min(DAY_LIMIT, Math.floor(p.dailyUsd * 1e9)) ||
                monthly.reduce((n,e) => n + e.reservedNano,0) + reservedNano > Math.min(MONTH_LIMIT, Math.floor(p.monthlyUsd * 1e9))) deny('BUDGET_EXCEEDED');
            if (s.entries.filter(e => Date.parse(e.at) > now.getTime() - 60000).length >= p.requestsPerMinute) deny('RATE_LIMIT');
            if (today.reduce((n,e) => n + e.tokens,0) + tokens > p.dailyTokenBudget) deny('DAILY_TOKEN_BUDGET');
            const id = randomUUID(); s.entries.push({id,at:stamp,reservedNano,tokens,state:'OPEN'}); return id;
        });
    }
    finish(id: string, usage?: { input_tokens: number; output_tokens: number }, expectedOutput = 4096) {
        this.mutate(s => {
            const entry = s.entries.find(e => e.id === id); if (!entry || entry.state !== 'OPEN') deny('RESERVATION_MISSING');
            entry.finishedAt = this.now().toISOString();
            entry.state = 'UNCERTAIN';
            if (usage && Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0 && usage.input_tokens <= MAX_INPUT &&
                Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0 && usage.output_tokens <= expectedOutput) {
                entry.state = 'FINISHED'; entry.usage = { input: usage.input_tokens, output: usage.output_tokens, estimatedNano: usage.input_tokens * INPUT_NANO + usage.output_tokens * OUTPUT_NANO };
            } else if (usage) s.blocked = true;
            // Never refund the conservative reservation, including refusals/timeouts/invalid output.
        });
    }
}

export function controlledOpenAiFetch(root: string, project: string, transport: typeof safeOutboundFetch = safeOutboundFetch, allowManualReal = false): typeof fetch {
    if (project !== CONTROL_PROJECT) deny('PROJECT_MISMATCH');
    const control = new OpenAiControl(root);
    return async (resource, init) => {
        const req = resource instanceof Request ? resource : null;
        const url = new URL(req ? req.url : String(resource));
        if (url.href !== 'https://api.openai.com/v1/responses' || (init?.method ?? req?.method) !== 'POST') deny('DESTINATION');
        const body = typeof init?.body === 'string' ? init.body : req ? await req.text() : '';
        let payload: any, source: any;
        try { payload = JSON.parse(body); source = JSON.parse(payload.input); } catch { return deny('BODY_INVALID'); }
        const allowed = new Set(['model','store','max_output_tokens','reasoning','instructions','input','text','service_tier']);
        if (Object.keys(payload).some(k => !allowed.has(k)) || payload.model !== CONTROL_MODEL || payload.store !== false || payload.tools !== undefined || payload.stream === true ||
            payload.service_tier && payload.service_tier !== 'default' || payload.prompt_cache_retention !== undefined ||
            payload.text?.format?.name !== 'native_ai_quality_control' || payload.text?.format?.type !== 'json_schema' || payload.text?.format?.strict !== true ||
            !Array.isArray(source.knowledge) || source.knowledge.length > 12) deny('SYNTHETIC_CONTRACT');
        if(source.conversation?.source==='CRM'&&allowManualReal){source=consumeManualEgressPermit(source);payload.input=JSON.stringify(source);}
        else if(source.conversation?.source!=='SERVER_SYNTHETIC'||source._manualPermit!==undefined)deny('SYNTHETIC_CONTRACT');
        const outboundBody = JSON.stringify({...payload, service_tier:'default'});
        const id = control.reserve(Buffer.byteLength(outboundBody), payload.max_output_tokens);
        let usage: {input_tokens:number;output_tokens:number} | undefined;
        try {
            control.assertEnabled();
            const headers = new Headers(init?.headers ?? req?.headers);
            const response = await transport(url.href, {method:'POST',headers:{authorization:headers.get('authorization') ?? '', 'content-type':'application/json','OpenAI-Project':project},body:outboundBody,signal:init?.signal ?? req?.signal,timeoutMs:15000,maxBytes:1024*1024});
            if (response.status >= 300 && response.status < 400) deny('REDIRECT');
            if (response.ok) {
                const result = await response.clone().json() as any;
                if (result.model !== CONTROL_MODEL) deny('RETURNED_MODEL_MISMATCH');
                usage = result.usage;
            }
            return response;
        } finally { control.finish(id, usage, payload.max_output_tokens); }
    };
}

export function createControlledOpenAiClient(env: NodeJS.ProcessEnv, key: string) {
    const manual=env.AI_QC_MANUAL_REAL_TEST_ENABLED==='true';
    if (!env.AI_QC_OPENAI_CONTROL_DIR || manual&&env.AI_QC_MANUAL_RETENTION_ENABLED!=='true' || env.AI_QC_REAL_DATA_ENABLED !== (manual?'true':'false') || env.AI_QC_REAL_DATA_OUTBOUND_APPROVED !== (manual?'true':'false') ||
        env.AI_QC_AUTO_MONITOR_ENABLED === 'true' || env.AI_QC_OPENAI_ORG_ID !== CONTROL_ORG || !env.OPENAI_API_KEY_FILE) deny('CONFIGURATION_REQUIRED');
    return new OpenAI({apiKey:key,project:CONTROL_PROJECT,baseURL:'https://api.openai.com/v1',timeout:15000,maxRetries:0,logLevel:'off',
        fetch:controlledOpenAiFetch(env.AI_QC_OPENAI_CONTROL_DIR, env.OPENAI_PROJECT_ID ?? '',safeOutboundFetch,manual)});
}
