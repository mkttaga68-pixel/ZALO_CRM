import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { safeOutboundFetch } from '../src/shared/utils/safe-outbound-fetch.js';

let response: PassThrough & { statusCode: number; headers: Record<string, string> };
let body = 'fixture';
beforeEach(() => {
  vi.clearAllMocks(); body = 'fixture';
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  response = Object.assign(new PassThrough(), { statusCode: 200, headers: { 'content-type': 'text/plain' } });
  mocks.request.mockImplementation((_url, options, callback) => {
    const req = Object.assign(new EventEmitter(), { end: vi.fn(() => queueMicrotask(() => {
      callback(response); if (!response.destroyed) response.end(body);
    })) });
    expect(options.agent).toBe(false);
    return req;
  });
});
describe('checked and pinned outbound HTTP (no real network)', () => {
  it('pins the checked DNS result and keeps the TLS hostname', async () => {
    const result = await safeOutboundFetch('https://example.com/path');
    expect(await result.text()).toBe('fixture');
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.request.mock.calls[0];
    expect(url.hostname).toBe('example.com');
    const callback = vi.fn(); options.lookup('example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });
  for (const address of ['127.0.0.1','10.1.2.3','::ffff:127.0.0.1','fe90::1']) it(`rejects DNS to ${address}`, async () => {
    mocks.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
    await expect(safeOutboundFetch('https://example.com/')).rejects.toThrow('DNS target');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('rejects mixed public/private DNS answers', async () => {
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.1', family: 4 }]);
    await expect(safeOutboundFetch('https://example.com/')).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('rejects redirects without issuing a second request', async () => {
    response.statusCode = 302; response.headers.location = 'https://127.0.0.1/';
    await expect(safeOutboundFetch('https://example.com/')).rejects.toThrow('redirect');
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it('bounds streamed bodies even without content-length', async () => {
    body = 'too large';
    await expect(safeOutboundFetch('https://example.com/', { maxBytes: 2 })).rejects.toThrow('size limit');
  });
  it('rejects oversized declared bodies before buffering', async () => {
    response.headers['content-length'] = '100';
    await expect(safeOutboundFetch('https://example.com/', { maxBytes: 2 })).rejects.toThrow('limits');
  });
  it('does not send aborted requests', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(safeOutboundFetch('https://example.com/', { signal: controller.signal })).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('propagates DNS failure without attempting a request', async () => {
    mocks.lookup.mockRejectedValue(new Error('fixture DNS failure'));
    await expect(safeOutboundFetch('https://example.com/')).rejects.toThrow('DNS failure');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('supports empty HTTP 204 responses', async () => {
    response.statusCode = 204; body = '';
    expect((await safeOutboundFetch('https://example.com/')).status).toBe(204);
  });
});
