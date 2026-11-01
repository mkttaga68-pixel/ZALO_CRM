import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { safeOutboundFetch } from '../../../shared/utils/safe-outbound-fetch.js';

export async function preparePostingImages(urls: string[]) {
  const base = path.resolve(tmpdir(), 'zalocrm-manual-posting');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'job-'));
  const cleanup = async () => {
    if (path.dirname(path.resolve(directory)) !== base) throw new Error('Unsafe temporary directory');
    await rm(directory, { recursive: true, force: true });
  };
  const paths: string[] = []; let total = 0;
  try {
    for (const [index, url] of urls.entries()) {
      const response = await safeOutboundFetch(url, { maxBytes: Math.min(25 * 1024 * 1024, 50 * 1024 * 1024 - total), timeoutMs: 15000 });
      if (!response.ok) throw new Error('Image download failed');
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const extension = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' } as Record<string, string>)[type];
      if (!extension) throw new Error('Unsupported image');
      const buffer = Buffer.from(await response.arrayBuffer()); total += buffer.length;
      const filename = path.join(directory, `${index}${extension}`);
      await writeFile(filename, buffer); paths.push(filename);
    }
    return { paths, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
