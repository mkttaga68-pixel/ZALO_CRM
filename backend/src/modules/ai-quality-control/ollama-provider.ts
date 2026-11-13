import { QcError, ANALYSIS_TYPES, type AIProvider, type ProviderInput, type ProviderResult } from './contracts.js';
import { semanticSchema, focusedInstructions, focusedContext, decodeSemanticOutput } from './ollama-semantics.js';
import { ollamaRuntimeSafety } from './ollama-runtime-safety.js';

const OLLAMA_URL = 'http://host.docker.internal:11434', OLLAMA_MODEL = 'qwen3:4b-instruct';
/** True when the approved model is already loaded (its memory is then already accounted for). Never throws. */
export async function ollamaResident(baseUrl = OLLAMA_URL, model = OLLAMA_MODEL): Promise<boolean> {
    if (baseUrl !== OLLAMA_URL) return false;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
    try { const r = await fetch(baseUrl + '/api/ps', { signal: controller.signal, redirect: 'error' }); if (!r.ok) return false; const b = await r.json() as { models?: Array<{ name?: string; model?: string }> };
        return Array.isArray(b?.models) && b.models.some(m => m?.name === model || m?.model === model); }
    catch { return false; } finally { clearTimeout(timer); }
}
/** Resource admission for the approved local model, checked before a preview token is spent. */
export async function ollamaAdmission() { return ollamaRuntimeSafety.admission(await ollamaResident()); }
/** Local inference only. The analyzer remains responsible for authority and evidence. */
export class OllamaProvider implements AIProvider {
    readonly name = 'ollama' as const;
    constructor(private baseUrl = process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434', private model = process.env.OLLAMA_MODEL || 'qwen3:4b-instruct', private timeoutMs = 180000, private allowRealData = false) {
        if (baseUrl !== 'http://host.docker.internal:11434') throw new QcError('OLLAMA_ENDPOINT_NOT_ALLOWED');
        if (model !== 'qwen3:4b-instruct') throw new QcError('OLLAMA_MODEL_NOT_APPROVED');
    }
    async analyze(input: ProviderInput): Promise<ProviderResult> {
        if (input.conversation.source !== 'SERVER_SYNTHETIC' && !(this.allowRealData && input.conversation.source === 'CRM')) throw new QcError('OLLAMA_SYNTHETIC_ONLY', 403);
        const resident = await ollamaResident(this.baseUrl, this.model);
        return ollamaRuntimeSafety.run(async assertResourceSafe => {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let stopCode: string | null = null;
        const safetyPoll = setInterval(() => {
            void assertResourceSafe().catch(error => {
                stopCode = error instanceof QcError ? error.code : 'OLLAMA_RESOURCE_GUARD_FAILED';
                controller.abort();
            });
        }, 1000);
        safetyPoll.unref?.();
        try {
            const combined: { summary: string; findings: Record<string, unknown> } = { summary: '', findings: {} };
            let inputTokens = 0, outputTokens = 0;
            for (const type of ANALYSIS_TYPES) {
            // No approved rule for this category: never ask the model (it can only guess). Abstain deterministically.
            if (!input.knowledge.some(c => c.rule.type === type)) {
                combined.findings[type] = { status: 'INSUFFICIENT_EVIDENCE', messageIds: [], ruleReferences: [], explanation: 'Chưa có quy tắc đã duyệt cho loại phân tích này.', missingContext: ['APPROVED_RULE_NOT_AVAILABLE'] };
                continue;
            }
            await assertResourceSafe();
            const response = await fetch(this.baseUrl + '/api/chat', {
                method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ model: this.model, stream: false, think: false, format: semanticSchema(input, [type]),
                    options: { temperature: 0, num_predict: input.maxOutputTokens, num_ctx: 8192 },
                    messages: [{ role: 'system', content: focusedInstructions(type) }, { role: 'user', content: JSON.stringify(focusedContext(input, type)) }] })
            });
            if (!response.ok) throw new QcError('OLLAMA_HTTP_ERROR', 502);
            const raw = await response.text();
            if (raw.length > 1000000) throw new QcError('OLLAMA_RESPONSE_TOO_LARGE', 502);
            const body = JSON.parse(raw);
            if (!body.done || body.done_reason !== 'stop' || body.model !== this.model) throw new QcError('OLLAMA_INCOMPLETE', 502);
            const part = JSON.parse(body.message?.content);
            if (!part || typeof part !== 'object' || Object.keys(part).length !== 2 || typeof part.summary !== 'string' || part.summary.length > 900 ||
                !part.findings || typeof part.findings !== 'object' || Array.isArray(part.findings) || Object.keys(part.findings).length !== 1 || !Object.hasOwn(part.findings, type)) throw new QcError('INVALID_MODEL_OUTPUT');
            combined.findings[type] = part.findings[type];
            combined.summary += (combined.summary ? '\n' : '') + part.summary;
            for (const n of [body.prompt_eval_count, body.eval_count]) if (!Number.isInteger(n) || n < 0) throw new QcError('OLLAMA_USAGE_INVALID');
            inputTokens += body.prompt_eval_count; outputTokens += body.eval_count;
            }
            const output = decodeSemanticOutput(combined, input);
            return { output, usage: { inputTokens, outputTokens, costUsd: 0, costStatus: 'CALCULATED', responseId: null, model: this.model, providerVersion: 'ollama-semantic-v3' } };
        } catch (e) {
            if (stopCode) throw new QcError(stopCode, 503);
            if (controller.signal.aborted) throw new QcError('OLLAMA_TIMEOUT', 504);
            if (e instanceof QcError) throw e;
            throw new QcError('OLLAMA_INVALID_OR_UNAVAILABLE', 502);
        } finally { clearTimeout(timer); clearInterval(safetyPoll); }
        }, { resident });
    }
}
