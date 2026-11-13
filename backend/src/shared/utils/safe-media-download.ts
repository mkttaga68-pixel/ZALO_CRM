import { downloadOwnMediaBuffer } from '../storage/index.js';
import { safeOutboundFetch } from './safe-outbound-fetch.js';

/** Technical per-file download ceiling for mirroring/forwarding. */
export const MAX_REMOTE_MEDIA_BYTES = 50 * 1024 * 1024;
export async function downloadMediaBuffer(url: string) {
  const owned = await downloadOwnMediaBuffer(url, MAX_REMOTE_MEDIA_BYTES, 30_000);
  if (owned) return owned;
  const response = await safeOutboundFetch(url, { maxBytes: MAX_REMOTE_MEDIA_BYTES, timeoutMs: 30_000 });
  if (!response.ok) throw new Error('Media download rejected by upstream');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('Empty media');
  return { buffer, mimeType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim() };
}
