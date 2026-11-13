import { beforeAll, vi } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
// Synthetic-only: no OpenAI, no external network. Loopback is allowed solely for the in-process Socket.IO realtime test.
const denied = () => { throw new Error('AIQC_LEARNING_TEST_OUTBOUND_DENIED'); };
const loopback = (host: unknown) => host === undefined || host === '127.0.0.1' || host === 'localhost' || host === '::1';
beforeAll(() => {
    if (process.env.NODE_ENV !== 'test' || !process.env.QC_TEST_ROOT || process.env.OPENAI_API_KEY || process.env.AI_QC_REAL_API_ENABLED !== 'false' || process.env.AI_QC_REAL_DATA_ENABLED !== 'false')
        throw new Error('Unsafe AIQC learning test environment');
    if (Object.keys(process.env).some(k => /TOKEN|COOKIE|SECRET|PASSWORD|API_KEY|PROXY/i.test(k))) throw new Error('Unexpected sensitive environment variable names');
    vi.stubGlobal('fetch', denied);
    vi.spyOn(https, 'request').mockImplementation(denied);
    vi.spyOn(https, 'get').mockImplementation(denied);
    vi.spyOn(tls, 'connect').mockImplementation(denied);
    vi.spyOn(dgram, 'createSocket').mockImplementation(denied);
    const originalLookup = dns.lookup;
    vi.spyOn(dns, 'lookup').mockImplementation(((host: string, ...rest: unknown[]) => { if (!loopback(host)) denied(); return (originalLookup as (...a: unknown[]) => void)(host, ...rest); }) as typeof dns.lookup);
    const originalRequest = http.request.bind(http);
    vi.spyOn(http, 'request').mockImplementation(((...args: unknown[]) => { const o = (typeof args[0] === 'object' && !(args[0] instanceof URL) ? args[0] : typeof args[1] === 'object' ? args[1] : {}) as { hostname?: string; host?: string }; const u = args[0] instanceof URL || typeof args[0] === 'string' ? new URL(String(args[0])) : null; if (!loopback(u?.hostname ?? o.hostname ?? o.host)) denied(); return (originalRequest as (...a: unknown[]) => http.ClientRequest)(...args); }) as typeof http.request);
    const originalConnect = net.Socket.prototype.connect;
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) { const o = args[0] as { host?: string; path?: string } | number; const host = typeof o === 'object' ? o.host : args[1]; if (!(typeof o === 'object' && o.path) && !loopback(host)) denied(); return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args); } as typeof net.Socket.prototype.connect);
});
