import { beforeAll, vi } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dgram from 'node:dgram';
import tls from 'node:tls';
import dns from 'node:dns';
const denied = () => { throw new Error('NATIVE_QC_TEST_OUTBOUND_DENIED'); };
beforeAll(() => {
    if (process.env.NODE_ENV !== 'test' || !process.env.QC_TEST_ROOT || process.env.OPENAI_API_KEY || process.env.AI_QC_REAL_API_ENABLED !== 'false' || process.env.AI_QC_REAL_DATA_ENABLED !== 'false')
        throw new Error('Unsafe native QC test environment');
    const forbidden = Object.keys(process.env).filter(k => /TOKEN|COOKIE|SECRET|PASSWORD|API_KEY|PROXY/i.test(k));
    if (forbidden.length)
        throw new Error('Unexpected sensitive environment variable names');
    vi.stubGlobal('fetch', denied);
    vi.spyOn(http, 'request').mockImplementation(denied);
    vi.spyOn(http, 'get').mockImplementation(denied);
    vi.spyOn(https, 'request').mockImplementation(denied);
    vi.spyOn(https, 'get').mockImplementation(denied);
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(denied);
    vi.spyOn(tls, 'connect').mockImplementation(denied);
    vi.spyOn(dgram, 'createSocket').mockImplementation(denied);
    vi.spyOn(dns, 'lookup').mockImplementation(denied);
});
