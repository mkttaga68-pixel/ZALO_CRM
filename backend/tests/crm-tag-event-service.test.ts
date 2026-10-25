/**
 * crm-tag-event-service.test.ts — sinh event `crm_tag_added` (2026-10-25).
 *
 * Điểm cốt lõi phải giữ đúng:
 *  - CHỈ sinh event khi quan hệ (KH × tag) chuyển CHƯA GẮN → ĐÃ GẮN.
 *  - Gắn lại tag đang có → KHÔNG sinh event (nếu không KH nhận tin mỗi lần sale
 *    mở panel tag rồi bấm lưu).
 *  - Gỡ tag → KHÔNG sinh event.
 *  - Phải khoá dòng contact bằng SELECT ... FOR UPDATE, nếu không 2 nhân viên gắn
 *    đồng thời đều thấy "chưa có" → 2 event → gửi 2 lần.
 *  - Tag Zalo-mirror (🔵 X) không bao giờ vào Contact.tags.
 *  - Tag do Zalo quản lý / tag free-text / auto-tag → ghi tag nhưng KHÔNG kích hoạt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryRawMock = vi.fn();
const contactUpdateMock = vi.fn();
const crmTagFindManyMock = vi.fn();
const crmTagEventCreateMock = vi.fn();

const tx = {
  $queryRaw: queryRawMock,
  contact: { update: contactUpdateMock },
  crmTag: { findMany: crmTagFindManyMock },
  crmTagEvent: { create: crmTagEventCreateMock },
};

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    // $transaction interactive — gọi callback với tx mock.
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
  },
}));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { applyContactTagsWithEvents } = await import(
  '../src/modules/contacts/crm-tag-event-service.js'
);

/** Tag CRM bình thường, dùng được làm tag kích hoạt. */
function tagDef(name: string, over: Record<string, unknown> = {}) {
  return { id: `tag-${name}`, name, managedBy: null, archivedAt: null, isActive: true, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryRawMock.mockResolvedValue([{ id: 'kh-1', tags: [] }]);
  contactUpdateMock.mockResolvedValue({ id: 'kh-1' });
  crmTagFindManyMock.mockResolvedValue([]);
  crmTagEventCreateMock.mockResolvedValue({});
});

const base = { orgId: 'org-1', contactId: 'kh-1', actorUserId: 'nv-1' };

describe('TC1 — gắn tag lần đầu', () => {
  it('sinh đúng 1 event cho tag mới, state pending', async () => {
    crmTagFindManyMock.mockResolvedValue([tagDef('Chăm sóc KH ngày 1')]);

    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['Chăm sóc KH ngày 1'] });

    expect(r).not.toBeNull();
    expect(r!.added).toEqual(['Chăm sóc KH ngày 1']);
    expect(r!.events).toHaveLength(1);
    expect(r!.events[0].crmTagId).toBe('tag-Chăm sóc KH ngày 1');
    expect(crmTagEventCreateMock).toHaveBeenCalledTimes(1);
    expect(crmTagEventCreateMock.mock.calls[0][0].data).toMatchObject({
      orgId: 'org-1',
      contactId: 'kh-1',
      crmTagId: 'tag-Chăm sóc KH ngày 1',
      actorUserId: 'nv-1',
      source: 'crm_manual',
      state: 'pending',
    });
    // occurredAt phải có — dispatcher dùng để chặn tag lịch sử.
    expect(crmTagEventCreateMock.mock.calls[0][0].data.occurredAt).toBeInstanceOf(Date);
  });

  it('khoá dòng contact bằng FOR UPDATE trước khi đọc tags', async () => {
    await applyContactTagsWithEvents({ ...base, nextTags: ['X'] });
    const sql = JSON.stringify(queryRawMock.mock.calls[0][0]);
    expect(sql).toContain('FOR UPDATE');
  });
});

describe('TC2 — gắn lại tag trùng', () => {
  it('tag đã có trong Contact.tags → KHÔNG sinh event', async () => {
    queryRawMock.mockResolvedValue([{ id: 'kh-1', tags: ['Chăm sóc KH ngày 1'] }]);
    crmTagFindManyMock.mockResolvedValue([tagDef('Chăm sóc KH ngày 1')]);

    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['Chăm sóc KH ngày 1'] });

    expect(r!.added).toEqual([]);
    expect(r!.events).toEqual([]);
    expect(crmTagEventCreateMock).not.toHaveBeenCalled();
  });

  it('gỡ tag → KHÔNG sinh event', async () => {
    queryRawMock.mockResolvedValue([{ id: 'kh-1', tags: ['A', 'B'] }]);

    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['A'] });

    expect(r!.removed).toEqual(['B']);
    expect(r!.added).toEqual([]);
    expect(crmTagEventCreateMock).not.toHaveBeenCalled();
  });

  it('thêm 1 tag mới trong khi vẫn giữ tag cũ → chỉ 1 event cho tag mới', async () => {
    queryRawMock.mockResolvedValue([{ id: 'kh-1', tags: ['Cũ'] }]);
    crmTagFindManyMock.mockResolvedValue([tagDef('Mới')]);

    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['Cũ', 'Mới'] });

    expect(r!.events).toHaveLength(1);
    expect(r!.events[0].tagName).toBe('Mới');
  });
});

describe('TC3 — hai nhân viên gắn tag đồng thời', () => {
  it('người thứ 2 trúng partial unique (P2002) → không sinh event thứ 2', async () => {
    crmTagFindManyMock.mockResolvedValue([tagDef('Chăm sóc KH ngày 1')]);
    // Giả lập DB chặn: đã có event đang bay cho đúng cặp (KH × tag).
    const { Prisma } = await import('@prisma/client');
    crmTagEventCreateMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );

    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['Chăm sóc KH ngày 1'] });

    expect(r!.events).toEqual([]);
    expect(r!.skipped).toEqual([
      { tagName: 'Chăm sóc KH ngày 1', reason: 'event_already_inflight' },
    ]);
  });

  it('lỗi DB khác P2002 vẫn throw — không âm thầm mất event', async () => {
    crmTagFindManyMock.mockResolvedValue([tagDef('T')]);
    crmTagEventCreateMock.mockRejectedValue(new Error('connection reset'));

    await expect(
      applyContactTagsWithEvents({ ...base, nextTags: ['T'] }),
    ).rejects.toThrow('connection reset');
  });
});

describe('TC10 — không kích hoạt từ tag đồng bộ Zalo Native', () => {
  it('tag Zalo-mirror "🔵 X" bị loại khỏi Contact.tags, không sinh event', async () => {
    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['🔵 VIP', 'Thường'] });

    expect(r!.tags).toEqual(['Thường']);
    expect(contactUpdateMock.mock.calls[0][0].data.tags).toEqual(['Thường']);
  });

  it('tag managedBy=zalo_sync → ghi tag nhưng KHÔNG sinh event', async () => {
    crmTagFindManyMock.mockResolvedValue([tagDef('1688', { managedBy: 'zalo_sync' })]);

    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['1688'] });

    expect(r!.tags).toEqual(['1688']);
    expect(r!.events).toEqual([]);
    expect(r!.skipped).toEqual([{ tagName: '1688', reason: 'tag_managed_by_zalo_sync' }]);
  });
});

describe('Tag không đủ điều kiện kích hoạt', () => {
  it('tag free-text chưa có trong bảng crm_tags → không sinh event', async () => {
    crmTagFindManyMock.mockResolvedValue([]);

    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['viết tay'] });

    expect(r!.tags).toEqual(['viết tay']); // vẫn lưu được, giữ hành vi cũ
    expect(r!.events).toEqual([]);
    expect(r!.skipped).toEqual([{ tagName: 'viết tay', reason: 'tag_not_in_catalog' }]);
  });

  it('auto-tag (prefix auto:) → không sinh event, không query bảng tag', async () => {
    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['auto:hot'] });

    expect(r!.skipped).toEqual([{ tagName: 'auto:hot', reason: 'auto_tag' }]);
    expect(crmTagFindManyMock).not.toHaveBeenCalled();
  });

  it('tag đã archive / inactive → không sinh event', async () => {
    crmTagFindManyMock.mockResolvedValue([
      tagDef('Cũ', { archivedAt: new Date() }),
      tagDef('Tắt', { isActive: false }),
    ]);

    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['Cũ', 'Tắt'] });

    expect(r!.events).toEqual([]);
    expect(r!.skipped).toEqual([
      { tagName: 'Cũ', reason: 'tag_archived' },
      { tagName: 'Tắt', reason: 'tag_inactive' },
    ]);
  });
});

describe('Org isolation + KH không tồn tại', () => {
  it('KH không thuộc org → trả null, KHÔNG ghi gì', async () => {
    queryRawMock.mockResolvedValue([]);

    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['X'] });

    expect(r).toBeNull();
    expect(contactUpdateMock).not.toHaveBeenCalled();
    expect(crmTagEventCreateMock).not.toHaveBeenCalled();
  });

  it('query tag luôn kẹp orgId của người gọi', async () => {
    crmTagFindManyMock.mockResolvedValue([tagDef('X')]);
    await applyContactTagsWithEvents({ ...base, nextTags: ['X'] });
    expect(crmTagFindManyMock.mock.calls[0][0].where.orgId).toBe('org-1');
  });
});

describe('TC15 — giữ nguyên dữ liệu ngoài phạm vi', () => {
  it('chỉ ghi Contact.tags, không đụng field nào khác của KH', async () => {
    crmTagFindManyMock.mockResolvedValue([tagDef('X')]);
    await applyContactTagsWithEvents({ ...base, nextTags: ['X'] });

    expect(contactUpdateMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(contactUpdateMock.mock.calls[0][0].data)).toEqual(['tags']);
  });

  it('nguồn khác crm_manual vẫn ghi event để truy vết (dispatcher mới là nơi chặn)', async () => {
    crmTagFindManyMock.mockResolvedValue([tagDef('X')]);
    await applyContactTagsWithEvents({ ...base, nextTags: ['X'], source: 'import' });
    expect(crmTagEventCreateMock.mock.calls[0][0].data.source).toBe('import');
  });

  it('dedupe tag trùng trong payload — 1 tag chỉ 1 event', async () => {
    crmTagFindManyMock.mockResolvedValue([tagDef('X')]);
    const r = await applyContactTagsWithEvents({ ...base, nextTags: ['X', 'X', 'X'] });
    expect(r!.tags).toEqual(['X']);
    expect(r!.events).toHaveLength(1);
  });
});
