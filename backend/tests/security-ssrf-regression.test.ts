import { describe, it, expect } from 'vitest';
import { isSafeOutboundUrl } from '../src/shared/utils/ssrf-guard.js';

describe('SSRF literal address regression', () => {
  for (const url of [
    'https://[::ffff:127.0.0.1]/', 'https://[::ffff:10.0.0.1]/',
    'https://[fe90::1]/', 'https://[febf::1]/', 'https://[::]/',
    'https://100.64.0.1/', 'https://224.0.0.1/',
    'https://user:password@example.com/', 'https://localhost./',
  ]) it(`rejects ${url}`, () => expect(isSafeOutboundUrl(url)).toBe(false));
});
