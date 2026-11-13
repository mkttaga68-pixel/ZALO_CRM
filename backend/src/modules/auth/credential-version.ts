import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config/index.js';

/** Never expose the bcrypt hash; the version is an opaque keyed binding. */
export function credentialVersion(userId: string, passwordHash: string): string {
  return createHmac('sha256', config.jwtSecret).update(`credential-v1\0${userId}\0${passwordHash}`).digest('hex');
}
export function matchesCredentialVersion(value: unknown, userId: string, passwordHash: string): boolean {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false;
  return timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(credentialVersion(userId, passwordHash), 'hex'));
}
