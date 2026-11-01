import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { assertSafeOutboundUrl, isPublicAddress, SsrfBlockedError } from './ssrf-guard.js';

export interface SafeOutboundOptions {
  method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string;
  signal?: AbortSignal; maxBytes?: number; timeoutMs?: number;
}

/** Validate every DNS answer, pin the connection IP and retain TLS hostname
 * checks. No redirects, proxy inheritance or pooled connection reuse. */
export async function safeOutboundFetch(raw: string, options: SafeOutboundOptions = {}): Promise<Response> {
  const url = assertSafeOutboundUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const timeoutMs = options.timeoutMs ?? 15_000, maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid outbound limits');
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  signal.throwIfAborted();
  const records = isIP(host) ? [{ address: host, family: isIP(host) }] : await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    lookup(host, { all: true, verbatim: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
  signal.throwIfAborted();
  if (!records.length || records.some(r => !isPublicAddress(r.address))) throw new SsrfBlockedError('DNS target is not public', raw);
  const pinned = records[0]!;
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, {
      method: options.method ?? 'GET', agent: false, family: pinned.family,
      lookup: (_host, _lookupOptions, callback) => callback(null, pinned.address, pinned.family),
      headers: { ...options.headers, 'accept-encoding': 'identity' }, signal,
    }, res => {
      const status = res.statusCode ?? 502;
      if (status >= 300 && status < 400) { res.destroy(); reject(new SsrfBlockedError('Outbound redirects are not allowed', raw)); return; }
      const declared = Number(res.headers['content-length']);
      if (declared > maxBytes || res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
        res.destroy(); reject(new Error('Outbound response exceeds limits or uses unsupported encoding')); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(new Error('Outbound response exceeds size limit')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Outbound response aborted')));
      res.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        try { resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers })); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(options.body);
  });
}
