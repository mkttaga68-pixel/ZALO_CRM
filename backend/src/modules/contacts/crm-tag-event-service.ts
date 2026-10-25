/**
 * crm-tag-event-service.ts — ghi Contact.tags VÀ sinh event `crm_tag_added`
 * trong CÙNG MỘT transaction (2026-10-25).
 *
 * Bài toán: Contact.tags là JSONB array TÊN tag, KHÔNG có bảng mapping
 * contact-tag. "Khách này đã được gắn tag kia chưa" chỉ biết được bằng cách đọc
 * array rồi so. Nếu đọc-so-ghi mà không khoá dòng, hai nhân viên gắn cùng tag
 * cho cùng khách trong cùng giây sẽ ĐỀU thấy "chưa có" → sinh 2 event → khách
 * nhận tin 2 lần.
 *
 * Nên:
 *   SELECT tags ... FOR UPDATE   ← khoá dòng contact, người thứ 2 phải chờ
 *   diff old vs next             ← người thứ 2 thấy tag ĐÃ có → không sinh event
 *   UPDATE tags + INSERT event   ← cùng transaction, cùng commit/rollback
 *
 * Event CHỈ được sinh khi quan hệ (KH × tag) chuyển CHƯA GẮN → ĐÃ GẮN.
 * Gỡ tag không sinh event. Gắn lại tag đang có không sinh event.
 *
 * Dispatch (gọi Bot-Auto → gửi Zalo) KHÔNG nằm ở đây: event ghi state='pending',
 * caller gọi dispatcher SAU KHI transaction commit. Tách ra vì gửi tin là việc
 * chậm + gọi mạng ngoài, không được giữ transaction mở, và không được làm
 * rollback việc gắn tag nếu Zalo lỗi.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

/** Tag Zalo-mirror per-nick, sống ở Friend.crmTagsPerNick — không bao giờ ở Contact.tags. */
const ZALO_MIRROR_PREFIX = '🔵 ';
/** Tag do bot tự sinh (scoring/auto-tag). Bot gắn thì không phải "nhân viên chủ động gắn". */
const AUTO_TAG_PREFIX = 'auto:';

export interface CrmTagEventRow {
  id: string;
  crmTagId: string;
  tagName: string;
}

export interface ApplyContactTagsResult {
  /** Mảng tag sau khi ghi (đã lọc). */
  tags: string[];
  /** Tên tag mới được gắn trong lần này. */
  added: string[];
  /** Tên tag bị gỡ trong lần này. */
  removed: string[];
  /** Event đã ghi, state='pending' — caller dispatch sau commit. */
  events: CrmTagEventRow[];
  /**
   * Tag mới được gắn nhưng KHÔNG sinh event, kèm lý do. Để route trả về cho UI
   * giải thích "vì sao gắn tag rồi mà không chạy sequence".
   */
  skipped: Array<{ tagName: string; reason: string }>;
}

/**
 * Ghi tag cấp KH (Contact.tags) + sinh event cho các tag mới gắn.
 *
 * @param nextTags  danh sách tag ĐẦY ĐỦ sau khi sửa (endpoint hiện tại là PUT,
 *                  không phải PATCH — caller gửi cả mảng).
 * @param actorUserId  nhân viên thực hiện; null nếu không phải người (hiện chưa
 *                  có đường nào như vậy, xem `source`).
 * @param source    'crm_manual' = nhân viên chủ động gắn trong CRM → ĐƯỢC dispatch.
 *                  Giá trị khác → ghi event để truy vết nhưng dispatcher bỏ qua.
 *                  Các đường đồng bộ Zalo / backfill / import / rename tag / merge
 *                  KH KHÔNG gọi hàm này chút nào (xem audit Phase 1).
 *
 * @returns null nếu không tìm thấy contact trong org (caller trả 404).
 */
export async function applyContactTagsWithEvents(args: {
  orgId: string;
  contactId: string;
  nextTags: string[];
  actorUserId: string | null;
  source?: string;
}): Promise<ApplyContactTagsResult | null> {
  const { orgId, contactId, actorUserId, source = 'crm_manual' } = args;

  // Lọc giống hệt endpoint cũ (giữ nguyên hành vi): bỏ non-string, bỏ Zalo-mirror.
  const nextTags = [
    ...new Set(
      args.nextTags.filter((t) => typeof t === 'string' && !t.startsWith(ZALO_MIRROR_PREFIX)),
    ),
  ];

  return prisma.$transaction(async (tx) => {
    // ── 1. Khoá dòng contact rồi đọc tags ────────────────────────────────
    // FOR UPDATE là mấu chốt chống race 2 nhân viên gắn đồng thời. Prisma không
    // phát sinh được FOR UPDATE qua findFirst nên phải dùng raw.
    const locked = await tx.$queryRaw<Array<{ id: string; tags: unknown }>>(
      Prisma.sql`SELECT "id", "tags" FROM "contacts"
                 WHERE "id" = ${contactId} AND "org_id" = ${orgId}
                 FOR UPDATE`,
    );
    if (locked.length === 0) return null;

    const oldTags = Array.isArray(locked[0].tags) ? (locked[0].tags as unknown[]) : [];
    const oldSet = new Set(oldTags.filter((t): t is string => typeof t === 'string'));

    const added = nextTags.filter((t) => !oldSet.has(t));
    const removed = [...oldSet].filter((t) => !nextTags.includes(t));

    // ── 2. Ghi tags ──────────────────────────────────────────────────────
    await tx.contact.update({ where: { id: contactId }, data: { tags: nextTags } });

    // Không có tag mới → không có gì để kích hoạt. Thoát sớm.
    if (added.length === 0) {
      return { tags: nextTags, added, removed, events: [], skipped: [] };
    }

    // ── 3. Resolve tên tag → CrmTag.id ───────────────────────────────────
    // Trigger chọn theo crmTagId (ID, không phải tên) nên tag free-text chưa có
    // trong bảng crm_tags KHÔNG THỂ khớp trigger nào → không sinh event.
    const skipped: Array<{ tagName: string; reason: string }> = [];
    const addedEligible = added.filter((t) => {
      if (t.startsWith(AUTO_TAG_PREFIX)) {
        skipped.push({ tagName: t, reason: 'auto_tag' });
        return false;
      }
      return true;
    });

    const tagDefs = addedEligible.length
      ? await tx.crmTag.findMany({
          where: { orgId, name: { in: addedEligible } },
          select: { id: true, name: true, managedBy: true, archivedAt: true, isActive: true },
        })
      : [];
    const byName = new Map(tagDefs.map((d) => [d.name, d]));

    // ── 4. Ghi event cho từng tag mới hợp lệ ─────────────────────────────
    const occurredAt = new Date();
    const events: CrmTagEventRow[] = [];

    for (const tagName of addedEligible) {
      const def = byName.get(tagName);
      if (!def) {
        skipped.push({ tagName, reason: 'tag_not_in_catalog' });
        continue;
      }
      if (def.archivedAt) {
        skipped.push({ tagName, reason: 'tag_archived' });
        continue;
      }
      if (!def.isActive) {
        skipped.push({ tagName, reason: 'tag_inactive' });
        continue;
      }
      // Tag do Zalo quản lý: nguồn sự thật là Zalo, CRM chỉ mirror. Gắn qua đường
      // CRM là bất thường → ghi nhận nhưng không kích hoạt gửi tin.
      if (def.managedBy === 'zalo_sync') {
        skipped.push({ tagName, reason: 'tag_managed_by_zalo_sync' });
        continue;
      }

      const id = randomUUID();
      try {
        await tx.crmTagEvent.create({
          data: {
            id,
            orgId,
            contactId,
            crmTagId: def.id,
            tagName,
            actorUserId,
            source,
            occurredAt,
            state: 'pending',
          },
        });
        events.push({ id, crmTagId: def.id, tagName });
      } catch (err) {
        // P2002 = trúng partial unique `uniq_crm_tag_event_inflight`: đã có event
        // ĐANG BAY cho đúng cặp (KH × tag) này. Event cũ sẽ gửi — không ghi thêm.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          skipped.push({ tagName, reason: 'event_already_inflight' });
          continue;
        }
        throw err;
      }
    }

    if (events.length > 0) {
      logger.info(
        `[crm-tag-event] contact=${contactId} sinh ${events.length} event: ${events.map((e) => e.tagName).join(', ')}`,
      );
    }

    return { tags: nextTags, added, removed, events, skipped };
  });
}
