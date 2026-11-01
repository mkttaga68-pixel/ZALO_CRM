import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { zaloPool } from '../../zalo/zalo-pool.js';
import { zaloRateLimiter } from '../../zalo/zalo-rate-limiter.js';
import { postingTargets, requirePostingAccount } from './access.js';
import type { PostingJob, PostingViewer } from './contracts.js';
import { preparePostingImages } from './media.js';
import { ManualPostingStore } from './store.js';

export class ManualPostingWorker {
  private readonly id = randomUUID();
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private stopped = true;
  private retryAfter = 0;
  private current: Promise<void> | null = null;
  private readonly closing = new AbortController();
  constructor(private readonly app: FastifyInstance, private readonly store: ManualPostingStore) {}

  start() { this.stopped = false; this.timer = setInterval(() => this.wake(), 5000); this.timer.unref(); this.wake(); }
  async stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.closing.abort(); await this.current; }
  wake(immediate = false) {
    if (immediate) this.retryAfter = 0;
    if (this.stopped || this.busy || Date.now() < this.retryAfter) return;
    this.current = this.tick();
  }
  private async tick() {
    this.busy = true;
    try {
      if (!await this.store.ready()) { this.retryAfter = Date.now() + 60000; return; }
      await this.store.recoverExpired();
      const job = await this.store.claim(this.id); if (job) await this.run(job);
    } catch {
      this.retryAfter = Date.now() + 60000;
      logger.warn('[manual-posting] Queue unavailable; no automatic resend of uncertain outcomes.');
    } finally { this.busy = false; }
  }
  private async pause(ms: number) {
    if (this.closing.signal.aborted) return;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.closing.signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms);
      this.closing.signal.addEventListener('abort', done, { once: true });
    });
  }
  private async run(job: PostingJob) {
    let images: Awaited<ReturnType<typeof preparePostingImages>> | null = null;
    let lateSend: Promise<unknown> | null = null;
    try {
      const user = await prisma.user.findUnique({ where: { id: job.created_by_id }, select: { id: true, orgId: true, role: true, isActive: true } });
      if (!user || !user.isActive || user.orgId !== job.org_id) throw new Error('Actor unavailable');
      const viewer: PostingViewer = { id: user.id, orgId: user.orgId, role: user.role };
      await requirePostingAccount(viewer, job.zalo_account_id, true);
      images = await preparePostingImages(job.image_urls);
      const recipients = await this.store.recipients(job.org_id, job.id);
      for (const [index, recipient] of recipients.entries()) {
        if (this.stopped) break;
        if (recipient.status !== 'QUEUED') continue;
        if (index) await this.pause(job.delay_seconds * 1000);
        if (this.stopped) break;
        // Re-check current actor, nick, source membership and contact policy.
        await requirePostingAccount(viewer, job.zalo_account_id, true);
        const current = await postingTargets(this.app, viewer, job.zalo_account_id, job.kind, { ids: [recipient.target_ref] });
        if (!current.targets.some(t => t.threadId === recipient.thread_id)) throw new Error('Recipient no longer eligible');
        const api = zaloPool.getApi(job.zalo_account_id);
        if (!api) throw new Error('Account disconnected');
        const limit = await zaloRateLimiter.checkLimits(job.zalo_account_id, 'message');
        if (!limit.allowed) throw new Error('Rate limit reached');
        // Count the attempt conservatively even if SDK outcome is unknown.
        await zaloRateLimiter.recordSend(job.zalo_account_id, 'message');
        if (!await this.store.beginRecipient(job, recipient)) break;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          // Exactly one SDK invocation. Never retry a timeout or partial album.
          const send = Promise.resolve().then(() => api.sendMessage(
            images!.paths.length ? { msg: job.body, attachments: images!.paths } : job.body,
            recipient.thread_id, job.kind === 'GROUP' ? 1 : 0,
          ));
          lateSend = send;
          await Promise.race([send, new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Uncertain SDK timeout')), 60000);
          })]);
          lateSend = null;
          if (!await this.store.outcome(job, recipient, 'SENT', null)) break;
        } catch {
          await this.store.outcome(job, recipient, 'UNKNOWN', 'Chưa rõ kết quả gửi. Kiểm tra trực tiếp trên Zalo; hệ thống không tự gửi lại.');
          break;
        } finally { if (timeout) clearTimeout(timeout); }
      }
      await this.store.finish(job);
    } catch {
      await this.store.finish(job, 'Đã dừng do quyền, kết nối, giới hạn gửi hoặc ảnh không còn hợp lệ. Các mục chưa gửi không được tự tiếp tục.');
    } finally {
      // A timed-out SDK call may still be uploading. Do not delete its files early.
      if (images) {
        const cleanup = images.cleanup;
        if (lateSend) void lateSend.then(cleanup, cleanup).catch(() => logger.warn('[manual-posting] Temporary media cleanup deferred.'));
        else await cleanup().catch(() => logger.warn('[manual-posting] Temporary media cleanup failed.'));
      }
    }
  }
}
