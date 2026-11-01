/**
 * ssrf-guard.ts — Validate an outbound URL before fetching it.
 *
 * Blocks SSRF vectors that let an attacker turn the server into a proxy:
 *   - non-HTTPS schemes (file://, gopher://, http:// to internal services)
 *   - loopback addresses (127.0.0.0/8, ::1)
 *   - RFC 1918 private ranges (10/8, 172.16/12, 192.168/16)
 *   - link-local (169.254/16) — covers AWS/GCP/Azure metadata IPs
 *   - "this network" (0.0.0.0/8)
 *   - ULA + IPv6 link-local (fc00::/7, fe80::/10)
 *
 * This synchronous helper checks syntax and IP literals only. Network callers
 * must use safeOutboundFetch, which validates DNS answers and pins the socket
 * to a checked address while preserving TLS hostname verification.
 */

import { isIP } from 'node:net';

const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  // IPv4 loopback, RFC1918, link-local, "this network"
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  // IPv6 loopback + link-local + ULA
  /^\[?::1\]?$/,
  /^\[?fc[0-9a-f]{2}:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

/** Conservative public IP policy. Deny mapped/transition IPv6 entirely. */
export function isPublicAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 ||
      a === 192 && (b === 168 || b === 0) || a === 100 && b! >= 64 && b! <= 127 ||
      a === 198 && (b === 18 || b === 19));
  }
  if (isIP(host) === 6) {
    const first = parseInt(host.split(':')[0] || '0', 16);
    if ((first & 0xe000) !== 0x2000 || first === 0x2002) return false;
    if (first === 0x2001 && parseInt(host.split(':')[1] || '0', 16) < 0x200) return false;
    return true;
  }
  return false;
}

export class SsrfBlockedError extends Error {
  constructor(message: string, public readonly url: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * Parse and validate an outbound URL. Throws SsrfBlockedError on rejection.
 * Returns the parsed URL on success.
 *
 * @example
 *   const url = assertSafeOutboundUrl(userInput);
 *   await fetch(url.toString(), ...);
 */
export function assertSafeOutboundUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SsrfBlockedError('Invalid URL', raw);
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new SsrfBlockedError(`Only HTTPS is allowed (got ${parsed.protocol})`, raw);
  }

  // Normalise hostname: strip brackets from IPv6 form, lowercase.
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || isIP(host) !== 0 && !isPublicAddress(host)) {
    throw new SsrfBlockedError('Empty hostname', raw);
  }

  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) {
      throw new SsrfBlockedError(`Hostname not allowed: ${host}`, raw);
    }
  }

  return parsed;
}

/**
 * Boolean variant. Use when you want to short-circuit without exception
 * handling — e.g. when validating a list of URLs and reporting each.
 */
export function isSafeOutboundUrl(raw: string): boolean {
  try {
    assertSafeOutboundUrl(raw);
    return true;
  } catch {
    return false;
  }
}
