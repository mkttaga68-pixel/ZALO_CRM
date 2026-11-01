import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/database/prisma-client.js';
import { PostingError, type PostingDraft, type PostingJob, type PostingRecipient, type PostingTarget, type PostingViewer } from './contracts.js';

export class ManualPostingStore {
  async ready(): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`SELECT to_regclass('manual_posting_jobs') IS NOT NULL AND to_regclass('manual_posting_recipients') IS NOT NULL AS ready`;
    return rows[0]?.ready === true;
  }

  async create(viewer: PostingViewer, draft: PostingDraft, targets: PostingTarget[]) {
    const fingerprint = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
    return prisma.$transaction(async tx => {
      const id = randomUUID();
      const inserted = await tx.$queryRaw<PostingJob[]>(Prisma.sql`
        INSERT INTO manual_posting_jobs(id,org_id,created_by_id,zalo_account_id,request_id,fingerprint,kind,body,image_urls,delay_seconds)
        VALUES (${id},${viewer.orgId},${viewer.id},${draft.zaloAccountId},${draft.requestId},${fingerprint},${draft.kind},${draft.body},${JSON.stringify(draft.imageUrls)}::jsonb,${draft.delaySeconds})
        ON CONFLICT (org_id,created_by_id,request_id) DO NOTHING RETURNING *`);
      if (!inserted.length) {
        const old = await tx.$queryRaw<PostingJob[]>(Prisma.sql`SELECT * FROM manual_posting_jobs WHERE org_id=${viewer.orgId} AND created_by_id=${viewer.id} AND request_id=${draft.requestId}`);
        if (!old[0] || old[0].fingerprint !== fingerprint) throw new PostingError(409, 'Yêu cầu đã được ghi nhận với nội dung khác. Hãy xem nhật ký trước khi tạo lượt mới.');
        return { job: old[0], duplicate: true };
      }
      for (const [ordinal, target] of targets.entries()) {
        await tx.$executeRaw(Prisma.sql`INSERT INTO manual_posting_recipients(id,org_id,job_id,target_ref,thread_id,display_name,ordinal)
          VALUES (${randomUUID()},${viewer.orgId},${id},${target.id},${target.threadId},${target.name},${ordinal})`);
      }
      return { job: inserted[0]!, duplicate: false };
    });
  }

  async list(orgId: string, userId: string, admin: boolean, accountIds: string[], kind: string) {
    if (!accountIds.length) return [];
    return prisma.$queryRaw<Array<PostingJob & { total: number; sent: number; unknown: number }>>(Prisma.sql`
      SELECT j.*,
        (SELECT count(*)::int FROM manual_posting_recipients r WHERE r.org_id=j.org_id AND r.job_id=j.id) AS total,
        (SELECT count(*)::int FROM manual_posting_recipients r WHERE r.org_id=j.org_id AND r.job_id=j.id AND r.status='SENT') AS sent,
        (SELECT count(*)::int FROM manual_posting_recipients r WHERE r.org_id=j.org_id AND r.job_id=j.id AND r.status='UNKNOWN') AS unknown
      FROM manual_posting_jobs j WHERE j.org_id=${orgId} AND j.kind=${kind}
        AND j.zalo_account_id IN (${Prisma.join(accountIds)}) ${admin ? Prisma.empty : Prisma.sql`AND j.created_by_id=${userId}`}
      ORDER BY j.created_at DESC,j.id LIMIT 20`);
  }

  async get(orgId: string, id: string) {
    const rows = await prisma.$queryRaw<PostingJob[]>(Prisma.sql`SELECT * FROM manual_posting_jobs WHERE org_id=${orgId} AND id=${id}`);
    return rows[0] ?? null;
  }

  async recipients(orgId: string, jobId: string) {
    return prisma.$queryRaw<PostingRecipient[]>(Prisma.sql`SELECT * FROM manual_posting_recipients WHERE org_id=${orgId} AND job_id=${jobId} ORDER BY ordinal`);
  }

  async cancel(orgId: string, jobId: string) {
    return prisma.$transaction(async tx => {
      const changed = await tx.$executeRaw(Prisma.sql`UPDATE manual_posting_jobs SET status='CANCELLED',worker_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
        WHERE org_id=${orgId} AND id=${jobId} AND status IN ('QUEUED','RUNNING')`);
      if (changed) await tx.$executeRaw(Prisma.sql`UPDATE manual_posting_recipients SET
        status=CASE WHEN status='SENDING' THEN 'UNKNOWN' ELSE 'SKIPPED' END,
        error=CASE WHEN status='SENDING' THEN 'Đã hủy khi đang gửi; cần đối soát Zalo, không tự gửi lại.' ELSE 'Đã hủy trước khi gửi.' END
        WHERE org_id=${orgId} AND job_id=${jobId} AND status IN ('QUEUED','SENDING')`);
      return changed > 0;
    });
  }

  async recoverExpired() {
    await prisma.$transaction(async tx => {
      const expired = await tx.$queryRaw<Array<{ id: string; org_id: string }>>(Prisma.sql`UPDATE manual_posting_jobs
        SET status='UNKNOWN',worker_id=NULL,lease_until=NULL,last_error='Tiến trình bị gián đoạn; cần đối soát, không tự gửi lại.',updated_at=clock_timestamp()
        WHERE status='RUNNING' AND lease_until < clock_timestamp() RETURNING id,org_id`);
      for (const row of expired) await tx.$executeRaw(Prisma.sql`UPDATE manual_posting_recipients SET
        status=CASE WHEN status='SENDING' THEN 'UNKNOWN' ELSE 'SKIPPED' END,error='Tiến trình bị gián đoạn; không tự gửi lại.'
        WHERE org_id=${row.org_id} AND job_id=${row.id} AND status IN ('QUEUED','SENDING')`);
    });
  }

  async claim(workerId: string): Promise<PostingJob | null> {
    return prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<PostingJob[]>(Prisma.sql`SELECT * FROM manual_posting_jobs WHERE status='QUEUED' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const job = rows[0]; if (!job) return null;
      // Serialize claims for a nick across server processes, not just this process.
      await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${job.org_id + '/' + job.zalo_account_id},0))) AS held`);
      const active = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM manual_posting_jobs WHERE org_id=${job.org_id} AND zalo_account_id=${job.zalo_account_id} AND status='RUNNING' LIMIT 1`);
      if (active.length) return null;
      const claimed = await tx.$queryRaw<PostingJob[]>(Prisma.sql`UPDATE manual_posting_jobs SET status='RUNNING',worker_id=${workerId},lease_until=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp()
        WHERE org_id=${job.org_id} AND id=${job.id} AND status='QUEUED' RETURNING *`);
      return claimed[0] ?? null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async beginRecipient(job: PostingJob, recipient: PostingRecipient) {
    return prisma.$transaction(async tx => {
      const active = await tx.$executeRaw(Prisma.sql`UPDATE manual_posting_jobs SET lease_until=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp()
        WHERE org_id=${job.org_id} AND id=${job.id} AND worker_id=${job.worker_id} AND status='RUNNING' AND lease_until>clock_timestamp()`);
      if (!active) return false;
      return (await tx.$executeRaw(Prisma.sql`UPDATE manual_posting_recipients SET status='SENDING',started_at=clock_timestamp()
        WHERE org_id=${job.org_id} AND job_id=${job.id} AND id=${recipient.id} AND status='QUEUED'`)) === 1;
    });
  }

  async outcome(job: PostingJob, recipient: PostingRecipient, status: 'SENT' | 'UNKNOWN', error: string | null) {
    return (await prisma.$executeRaw(Prisma.sql`UPDATE manual_posting_recipients r SET status=${status},error=${error},sent_at=${status === 'SENT' ? new Date() : null}
      WHERE r.org_id=${job.org_id} AND r.job_id=${job.id} AND r.id=${recipient.id} AND r.status='SENDING'
      AND EXISTS (SELECT 1 FROM manual_posting_jobs j WHERE j.org_id=r.org_id AND j.id=r.job_id AND j.worker_id=${job.worker_id} AND j.status='RUNNING' AND j.lease_until>clock_timestamp())`)) === 1;
  }

  async finish(job: PostingJob, error: string | null = null) {
    await prisma.$transaction(async tx => {
      // Lock the job before finalizing so cancellation cannot be overwritten.
      const owned = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM manual_posting_jobs WHERE org_id=${job.org_id} AND id=${job.id} AND worker_id=${job.worker_id} AND status='RUNNING' FOR UPDATE`);
      if (!owned.length) return;
      await tx.$executeRaw(Prisma.sql`UPDATE manual_posting_recipients SET status=CASE WHEN status='SENDING' THEN 'UNKNOWN' ELSE 'SKIPPED' END,error=COALESCE(error,${error ?? 'Đã dừng; không tự gửi lại.'})
        WHERE org_id=${job.org_id} AND job_id=${job.id} AND status IN ('QUEUED','SENDING')`);
      const rows = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`SELECT status FROM manual_posting_recipients WHERE org_id=${job.org_id} AND job_id=${job.id}`);
      const status = rows.some(r => r.status === 'UNKNOWN') ? 'UNKNOWN' : rows.every(r => r.status === 'SENT') ? 'DONE' : rows.some(r => r.status === 'SENT') ? 'PARTIAL' : 'FAILED';
      await tx.$executeRaw(Prisma.sql`UPDATE manual_posting_jobs SET status=${status},last_error=${error},worker_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE org_id=${job.org_id} AND id=${job.id}`);
    });
  }
}
