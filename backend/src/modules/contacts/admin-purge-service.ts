/**
 * admin-purge-service.ts — Admin xoá dữ liệu trang Khách hàng mà 1 user vừa đồng bộ vào.
 *
 * BÀI TOÁN: sale connect 1 nick Zalo → friend-sync hút toàn bộ danh sách bạn
 * (có thể vài nghìn) vào bảng contacts + friends. Nếu đó là nick cá nhân / nick
 * sai / sync nhầm org thì trang Khách hàng bị ngập rác và không có cách nào hoàn tác.
 * Service này cho admin hoàn tác theo user, hoặc theo từng nick cụ thể của user đó.
 *
 * NGUYÊN TẮC — "chỉ xoá ra khỏi hệ thống, KHÔNG xoá kết bạn":
 *  - Toàn bộ thao tác chỉ chạy trên DB CRM. KHÔNG gọi Zalo SDK, KHÔNG unfriend,
 *    KHÔNG block, KHÔNG đụng vào tài khoản Zalo thật. Trên Zalo, nick vẫn là bạn
 *    của KH y như cũ.
 *  - Vì vẫn còn là bạn, friend-sync sẽ hút lại tất cả trong ≤15 phút (cron) hoặc
 *    ngay khi nick connect lại. Nên executePurge BẮT BUỘC set
 *    ZaloAccount.syncPaused=true cho mọi nick trong phạm vi. Admin bật lại qua
 *    resumeSync() khi thực sự muốn đồng bộ tiếp.
 *
 * AN TOÀN cho dữ liệu người khác (quyết định của chủ hệ thống):
 *  - KH được nhiều nick cùng chăm → CHỈ xoá Friend row của nick trong phạm vi.
 *    Contact (KH Cha) được giữ nguyên vì nick của sale khác vẫn đang chăm.
 *  - Chỉ xoá hẳn Contact khi sau thao tác KH đó không còn Friend row nào.
 *  - keepCurated=true (mặc định): KH đã có dữ liệu do người thật nhập
 *    (SĐT / ghi chú / lịch hẹn / được gán sale / đổi tên CRM / nằm trong tệp KH)
 *    thì chỉ cắt link nick, KHÔNG xoá Contact — đó là KH đã chăm thật, không phải
 *    rác từ sync.
 *
 * LUỒNG 2 BƯỚC: buildPurgePlan() (preview, chỉ đọc) → executePurge() (xoá thật).
 * FE luôn gọi preview trước và buộc admin gõ tên nhân viên để xác nhận.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../activity/activity-logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PurgeScopeInput {
  orgId: string;
  /** User sở hữu nick (ownerUserId) — KH đồng bộ qua nick của user này */
  userId: string;
  /**
   * Giới hạn trong các nick cụ thể. undefined/[] → TẤT CẢ nick của user.
   * Mọi id không thuộc user/org sẽ bị loại ở resolveScopeAccounts (fail-closed).
   */
  zaloAccountIds?: string[];
  /** Bỏ qua (không xoá Contact) KH đã có dữ liệu người thật nhập. Mặc định true. */
  keepCurated?: boolean;
  /** Xoá kèm hội thoại + tin nhắn 1-1 của các nick trong phạm vi. Mặc định false. */
  deleteConversations?: boolean;
}

export interface ScopeAccount {
  id: string;
  displayName: string | null;
  zaloUid: string | null;
  status: string;
  syncPaused: boolean;
  friendCount: number;
}

export interface PurgePlan {
  user: { id: string; fullName: string; email: string };
  /** Chuỗi admin phải gõ đúng để xác nhận = email nhân viên bị xoá dữ liệu. */
  confirmPhrase: string;
  accounts: ScopeAccount[];
  keepCurated: boolean;
  deleteConversations: boolean;
  counts: {
    /** Friend row sẽ bị xoá (link nick ↔ KH) */
    friendsToDelete: number;
    /** Contact sẽ bị xoá hẳn (không còn nick nào chăm, và không thuộc diện giữ lại) */
    contactsToDelete: number;
    /** Contact chỉ bị cắt link nick, giữ lại vì nick của user khác vẫn chăm */
    contactsKeptSharedWithOthers: number;
    /** Contact chỉ bị cắt link nick, giữ lại vì đã có dữ liệu người thật nhập */
    contactsKeptCurated: number;
    /** Hội thoại 1-1 sẽ bị xoá (chỉ khi deleteConversations=true) */
    conversationsToDelete: number;
    /** Tin nhắn trong các hội thoại đó */
    messagesToDelete: number;
    /** Lịch hẹn + ghi chú sẽ mất theo Contact bị xoá (cascade) */
    appointmentsLost: number;
    notesLost: number;
  };
  /** Mẫu 20 KH đầu sẽ bị xoá hẳn — để admin mắt thường kiểm tra trước khi bấm */
  sampleContactsToDelete: Array<{ id: string; fullName: string | null; phone: string | null }>;
}

export interface PurgeResult {
  friendsDeleted: number;
  contactsDeleted: number;
  contactsKept: number;
  conversationsDeleted: number;
  messagesDeleted: number;
  accountsPaused: string[];
  durationMs: number;
}

// ── Scope resolution ───────────────────────────────────────────────────────

/**
 * Resolve các nick thuộc phạm vi. Fail-closed: luôn filter theo orgId +
 * ownerUserId nên id lạ / nick của org khác không bao giờ vào được phạm vi.
 */
async function resolveScopeAccounts(input: PurgeScopeInput): Promise<ScopeAccount[]> {
  const requested = input.zaloAccountIds?.filter((id) => typeof id === 'string' && id.length > 0) ?? [];
  const accounts = await prisma.zaloAccount.findMany({
    where: {
      orgId: input.orgId,
      ownerUserId: input.userId,
      ...(requested.length > 0 ? { id: { in: requested } } : {}),
    },
    select: {
      id: true,
      displayName: true,
      zaloUid: true,
      status: true,
      syncPaused: true,
      _count: { select: { friends: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return accounts.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    zaloUid: a.zaloUid,
    status: a.status,
    syncPaused: a.syncPaused,
    friendCount: a._count.friends,
  }));
}

/**
 * Ngữ cảnh cần để phân biệt "dữ liệu người thật nhập" với "giá trị do hệ thống tự gán".
 * Phải load trước khi dựng filter, nếu không sẽ nhận nhầm gần như MỌI KH là
 * đã-chăm-thật và lệnh xoá thành vô nghĩa.
 */
interface CuratedContext {
  /**
   * Status được flag isDefault — status-migration.ts gán hàng loạt cho mọi Contact
   * còn statusId=NULL, nên "có statusId" KHÔNG phải dấu hiệu người thật.
   * Chỉ khi status KHÁC default mới là sale đã kéo KH đi trong pipeline.
   */
  defaultStatusIds: string[];
  /**
   * User đang bị xoá dữ liệu. applyFriendTransition tự claim
   * Contact.assignedUserId = chủ nick ngay khi friendshipStatus='accepted'
   * (first-accepted-wins), nên "có assignedUserId" cũng KHÔNG phải dấu hiệu
   * người thật. Chỉ khi KH được gán cho người KHÁC mới là có người can thiệp.
   */
  scopeUserId: string;
}

async function loadCuratedContext(orgId: string, scopeUserId: string): Promise<CuratedContext> {
  const defaults = await prisma.status.findMany({
    where: { orgId, isDefault: true },
    select: { id: true },
  });
  return { defaultStatusIds: defaults.map((s) => s.id), scopeUserId };
}

/**
 * Điều kiện "KH đã có dữ liệu người thật nhập" — không coi là rác từ sync.
 * Dùng chung cho preview và execute để con số preview khớp kết quả thật.
 *
 * Mỗi mục dưới đây là thứ friend-sync KHÔNG bao giờ tự ghi (processFriend chỉ ghi
 * zaloUid / zaloGlobalId / zaloUsername / fullName / avatarUrl / hasZalo), nên có
 * giá trị = đã có người nhập hoặc nguồn khác (import SĐT, Facebook Lead) đổ vào.
 */
function curatedContactFilter(ctx: CuratedContext) {
  return [
    { phone: { not: null } },
    { phone2: { not: null } },
    { phone3: { not: null } },
    { email: { not: null } },
    { crmName: { not: null } },
    { notes: { not: null } },
    { source: { not: null } },
    { importBatchId: { not: null } },
    { parentContactId: { not: null } },
    { appointments: { some: {} } },
    { contactNotes: { some: {} } },
    // Đã có hội thoại → có tương tác thật. Xoá KH sẽ để lại hội thoại mồ côi
    // (Conversation.contactId là SetNull, không cascade) và mất liên kết tin nhắn.
    { conversations: { some: {} } },
    // Sale đã kéo KH ra khỏi status mặc định
    { AND: [{ statusId: { not: null } }, { statusId: { notIn: ctx.defaultStatusIds } }] },
    // KH được gán cho người khác, không phải auto-claim của chính chủ nick
    { AND: [{ assignedUserId: { not: null } }, { assignedUserId: { not: ctx.scopeUserId } }] },
  ];
}

// ── Preview (chỉ đọc) ──────────────────────────────────────────────────────

/**
 * Tính trước mọi con số mà executePurge sẽ làm. KHÔNG ghi gì vào DB.
 *
 * Phân loại từng Contact có Friend trong phạm vi vào 1 trong 3 nhóm:
 *   1. contactsToDelete              — chỉ nick trong phạm vi chăm + không thuộc diện giữ
 *   2. contactsKeptSharedWithOthers  — còn nick NGOÀI phạm vi chăm → giữ Contact
 *   3. contactsKeptCurated           — đã có dữ liệu người thật → giữ Contact
 * Nhóm 2 được ưu tiên hơn nhóm 3 khi 1 KH thoả cả hai (lý do giữ "mạnh" hơn).
 */
export async function buildPurgePlan(input: PurgeScopeInput): Promise<PurgePlan | null> {
  const keepCurated = input.keepCurated !== false;
  const deleteConversations = input.deleteConversations === true;

  const user = await prisma.user.findFirst({
    where: { id: input.userId, orgId: input.orgId },
    select: { id: true, fullName: true, email: true },
  });
  if (!user) return null;

  const accounts = await resolveScopeAccounts(input);
  const accountIds = accounts.map((a) => a.id);

  const emptyPlan: PurgePlan = {
    user,
    confirmPhrase: user.email,
    accounts,
    keepCurated,
    deleteConversations,
    counts: {
      friendsToDelete: 0,
      contactsToDelete: 0,
      contactsKeptSharedWithOthers: 0,
      contactsKeptCurated: 0,
      conversationsToDelete: 0,
      messagesToDelete: 0,
      appointmentsLost: 0,
      notesLost: 0,
    },
    sampleContactsToDelete: [],
  };
  if (accountIds.length === 0) return emptyPlan;

  // Friend row trong phạm vi + tập Contact id liên quan
  const friendsInScope = await prisma.friend.findMany({
    where: { orgId: input.orgId, zaloAccountId: { in: accountIds } },
    select: { id: true, contactId: true },
  });
  emptyPlan.counts.friendsToDelete = friendsInScope.length;
  if (friendsInScope.length === 0) return emptyPlan;

  const contactIds = [...new Set(friendsInScope.map((f) => f.contactId))];

  // KH còn nick NGOÀI phạm vi chăm → giữ Contact, chỉ cắt link nick trong phạm vi.
  const sharedIds = new Set<string>();
  for (const part of chunk(contactIds, BATCH)) {
    const rows = await prisma.friend.findMany({
      where: {
        orgId: input.orgId,
        contactId: { in: part },
        zaloAccountId: { notIn: accountIds },
      },
      select: { contactId: true },
      distinct: ['contactId'],
    });
    for (const r of rows) sharedIds.add(r.contactId);
  }

  // KH chỉ-trong-phạm-vi: ứng viên xoá hẳn
  const orphanIds = contactIds.filter((id) => !sharedIds.has(id));

  // Trong số ứng viên, loại ra KH đã có dữ liệu người thật nhập (nếu keepCurated)
  let curatedIds = new Set<string>();
  if (keepCurated && orphanIds.length > 0) {
    const ctx = await loadCuratedContext(input.orgId, input.userId);
    for (const part of chunk(orphanIds, BATCH)) {
      const curated = await prisma.contact.findMany({
        where: { orgId: input.orgId, id: { in: part }, OR: curatedContactFilter(ctx) },
        select: { id: true },
      });
      for (const c of curated) curatedIds.add(c.id);
    }
  }
  // KH nằm trong tệp KH (CustomerList) cũng là dữ liệu người thật dựng — giữ lại.
  if (keepCurated && orphanIds.length > 0) {
    for (const part of chunk(orphanIds, BATCH)) {
      const inLists = await prisma.customerListEntry.findMany({
        where: { contactId: { in: part } },
        select: { contactId: true },
        distinct: ['contactId'],
      });
      for (const e of inLists) if (e.contactId) curatedIds.add(e.contactId);
    }
  }

  const deleteIds = orphanIds.filter((id) => !curatedIds.has(id));

  // Dữ liệu sẽ mất theo Contact bị xoá (FK Cascade) — hiện rõ cho admin thấy
  let appointmentsLost = 0;
  let notesLost = 0;
  for (const part of chunk(deleteIds, BATCH)) {
    const [appts, nts] = await Promise.all([
      prisma.appointment.count({ where: { orgId: input.orgId, contactId: { in: part } } }),
      prisma.note.count({ where: { orgId: input.orgId, contactId: { in: part } } }),
    ]);
    appointmentsLost += appts;
    notesLost += nts;
  }

  // Mẫu 20 KH mới nhất sẽ bị xoá — lấy từ lô đầu là đủ cho mục đích mắt thường kiểm tra
  const sample = deleteIds.length > 0
    ? await prisma.contact.findMany({
        where: { orgId: input.orgId, id: { in: deleteIds.slice(0, BATCH) } },
        select: { id: true, fullName: true, phone: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    : [];

  // Hội thoại 1-1 của các nick trong phạm vi (chỉ đếm khi admin chọn xoá kèm)
  let conversationsToDelete = 0;
  let messagesToDelete = 0;
  if (deleteConversations) {
    const convs = await prisma.conversation.findMany({
      where: { orgId: input.orgId, zaloAccountId: { in: accountIds }, threadType: 'user' },
      select: { id: true },
    });
    conversationsToDelete = convs.length;
    if (convs.length > 0) {
      messagesToDelete = await prisma.message.count({
        where: { conversationId: { in: convs.map((c) => c.id) } },
      });
    }
  }

  return {
    user,
    confirmPhrase: user.email,
    accounts,
    keepCurated,
    deleteConversations,
    counts: {
      friendsToDelete: friendsInScope.length,
      contactsToDelete: deleteIds.length,
      contactsKeptSharedWithOthers: sharedIds.size,
      contactsKeptCurated: curatedIds.size,
      conversationsToDelete,
      messagesToDelete,
      appointmentsLost,
      notesLost,
    },
    sampleContactsToDelete: sample,
  };
}

// ── Execute ────────────────────────────────────────────────────────────────

/** Chia mảng id thành lô để deleteMany không dựng IN (...) hàng nghìn phần tử. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
const BATCH = 500;

/**
 * Xoá thật. Tính lại plan bên trong (KHÔNG tin con số FE gửi lên) rồi thực thi
 * đúng theo plan đó, nên dù dữ liệu có đổi giữa preview và confirm thì vẫn an toàn.
 *
 * Thứ tự quan trọng:
 *   1. syncPaused=true TRƯỚC khi xoá — chặn cron/connect hút lại ngay giữa lúc xoá.
 *   2. Hội thoại + tin nhắn (nếu chọn) — làm trước khi xoá Contact để không để lại
 *      hội thoại mồ côi contact_id=NULL trên trang Chat.
 *   3. Friend row trong phạm vi.
 *   4. Contact không còn nick nào chăm (cascade: appointment / note / access /
 *      engagement / attempt / automation task).
 *   5. Sửa counter cache + ownerFriendId treo cho KH ĐƯỢC GIỮ.
 *   6. Dọn id rác trong duplicate_groups + parent_candidates (mảng id, không FK).
 */
export async function executePurge(
  input: PurgeScopeInput & { actorUserId: string; actorEmail?: string },
): Promise<PurgeResult | null> {
  const startedAt = Date.now();
  const plan = await buildPurgePlan(input);
  if (!plan) return null;

  const accountIds = plan.accounts.map((a) => a.id);
  const result: PurgeResult = {
    friendsDeleted: 0,
    contactsDeleted: 0,
    contactsKept: plan.counts.contactsKeptSharedWithOthers + plan.counts.contactsKeptCurated,
    conversationsDeleted: 0,
    messagesDeleted: 0,
    accountsPaused: [],
    durationMs: 0,
  };

  const targetUser = plan.user;

  if (accountIds.length === 0) {
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  // 1. Tạm dừng đồng bộ cho mọi nick trong phạm vi — nếu bỏ bước này, cron 15'
  //    sẽ dựng lại toàn bộ Contact + Friend vừa xoá.
  await prisma.zaloAccount.updateMany({
    where: { id: { in: accountIds }, orgId: input.orgId },
    data: {
      syncPaused: true,
      syncPausedAt: new Date(),
      syncPausedReason: `Admin xoá dữ liệu KH đã đồng bộ (${input.actorEmail ?? input.actorUserId})`,
    },
  });
  result.accountsPaused = accountIds;

  // 2. Hội thoại + tin nhắn 1-1 của các nick trong phạm vi
  if (plan.deleteConversations) {
    const convs = await prisma.conversation.findMany({
      where: { orgId: input.orgId, zaloAccountId: { in: accountIds }, threadType: 'user' },
      select: { id: true },
    });
    const convIds = convs.map((c) => c.id);
    for (const part of chunk(convIds, BATCH)) {
      const msgs = await prisma.message.deleteMany({ where: { conversationId: { in: part } } });
      result.messagesDeleted += msgs.count;
    }
    for (const part of chunk(convIds, BATCH)) {
      const del = await prisma.conversation.deleteMany({ where: { id: { in: part } } });
      result.conversationsDeleted += del.count;
    }
  }

  // 3. Friend row trong phạm vi — đây là bước "cắt link nick ↔ KH".
  //    Chỉ xoá bản ghi CRM; trên Zalo nick vẫn là bạn của KH.
  //    Chốt tập Contact bị ảnh hưởng TRƯỚC khi xoá: sau khi Friend row mất thì
  //    không còn đường nào truy ra KH nào thuộc phạm vi nữa.
  const affectedRows = await prisma.friend.findMany({
    where: { orgId: input.orgId, zaloAccountId: { in: accountIds } },
    select: { contactId: true },
    distinct: ['contactId'],
  });
  const affectedContactIds = affectedRows.map((r) => r.contactId);

  const friendDel = await prisma.friend.deleteMany({
    where: { orgId: input.orgId, zaloAccountId: { in: accountIds } },
  });
  result.friendsDeleted = friendDel.count;

  // 4. Contact đã mất hết nick chăm + không thuộc diện giữ lại.
  //    Chỉ xét trong affectedContactIds — KH mồ côi sẵn từ trước (vd nhập từ file
  //    SĐT rồi lookup ra zaloUid mà chưa kết bạn) KHÔNG nằm trong phạm vi, không đụng tới.
  //    Lọc lại `friends: { none: {} }` ngay lúc xoá nên nếu giữa preview và execute
  //    có nick khác vừa nhận tin từ KH đó thì KH được giữ, không bị xoá oan.
  const deleteIds = await recomputeDeletableContacts(input, plan, affectedContactIds);
  const deletedIdSet = new Set<string>();
  for (const part of chunk(deleteIds, BATCH)) {
    // Lấy lại đúng id thực sự xoá được (sau filter friends:none) để biết KH nào
    // còn sống mà phải sửa số đếm ở bước 5.
    const rows = await prisma.contact.findMany({
      where: { orgId: input.orgId, id: { in: part }, friends: { none: {} } },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) continue;
    const del = await prisma.contact.deleteMany({ where: { orgId: input.orgId, id: { in: ids } } });
    result.contactsDeleted += del.count;
    for (const id of ids) deletedIdSet.add(id);
  }

  // 5. Sửa lại số đếm trên KH ĐƯỢC GIỮ. Contact.acceptedNicksCount /
  //    pendingNicksCount / chattingNicksCount là cache tăng-giảm theo từng
  //    transition (applyFriendTransition), KHÔNG tự tính lại khi Friend row bị
  //    xoá thẳng bằng deleteMany. Bỏ bước này thì KH giữ lại sẽ hiện "3 nick đang
  //    chăm" trong khi thực tế còn 1 → sai ở trang KH, ở gate stopOnAccept của
  //    automation và ở filter acceptedNicksCount > 0 của broadcast.
  //    ownerFriendId cũng trỏ vào Friend đã xoá (soft FK, không cascade) → clear.
  const keptIds = affectedContactIds.filter((id) => !deletedIdSet.has(id));
  if (keptIds.length > 0) {
    await repairKeptContactCounters(input.orgId, keptIds);
  }

  // 6. Dọn id rác trong 2 bảng lưu mảng contact id (không có FK nên không cascade)
  if (deleteIds.length > 0) {
    await cleanupStaleContactIdArrays(input.orgId, deleteIds);
  }

  result.durationMs = Date.now() - startedAt;

  logger.info(
    `[admin-purge] user=${targetUser.email} nicks=${accountIds.length} friends=${result.friendsDeleted} contacts=${result.contactsDeleted} kept=${result.contactsKept} convs=${result.conversationsDeleted} msgs=${result.messagesDeleted} dur=${result.durationMs}ms`,
  );

  logActivity({
    orgId: input.orgId,
    userId: input.actorUserId,
    action: 'admin_purge_synced_contacts',
    category: 'system',
    entityType: 'user',
    entityId: targetUser.id,
    details: {
      targetUser: { id: targetUser.id, email: targetUser.email, fullName: targetUser.fullName },
      zaloAccountIds: accountIds,
      keepCurated: plan.keepCurated,
      deleteConversations: plan.deleteConversations,
      ...result,
    },
  });

  return result;
}

/**
 * Tính lại danh sách Contact xoá được NGAY SAU khi Friend row đã bị xoá.
 * Lúc này `friends: { none: {} }` chính là "không còn nick nào chăm".
 * Vẫn loại KH đã có dữ liệu người thật khi keepCurated.
 *
 * `affectedContactIds` giới hạn phạm vi vào đúng những KH có link tới nick vừa
 * bị cắt — không quét cả org, nên KH mồ côi sẵn từ trước không bị xoá kèm.
 */
async function recomputeDeletableContacts(
  input: PurgeScopeInput,
  plan: PurgePlan,
  affectedContactIds: string[],
): Promise<string[]> {
  if (affectedContactIds.length === 0) return [];
  const keepCurated = plan.keepCurated;

  const ctx = keepCurated ? await loadCuratedContext(input.orgId, input.userId) : null;
  const orphans: Array<{ id: string }> = [];
  for (const part of chunk(affectedContactIds, BATCH)) {
    const rows = await prisma.contact.findMany({
      where: {
        orgId: input.orgId,
        id: { in: part },
        friends: { none: {} },
        ...(ctx ? { NOT: { OR: curatedContactFilter(ctx) } } : {}),
      },
      select: { id: true },
    });
    orphans.push(...rows);
  }
  let ids = orphans.map((c) => c.id);

  if (keepCurated && ids.length > 0) {
    const inLists = await prisma.customerListEntry.findMany({
      where: { contactId: { in: ids } },
      select: { contactId: true },
      distinct: ['contactId'],
    });
    const listed = new Set(inLists.map((e) => e.contactId).filter((v): v is string => !!v));
    ids = ids.filter((id) => !listed.has(id));
  }

  return ids;
}

/**
 * Tính lại 3 counter cache + clear ownerFriendId treo cho KH được giữ lại.
 * Một UPDATE…FROM duy nhất, dùng index (org_id, contact_id) của bảng friends.
 * LEFT JOIN để KH không còn Friend nào (trường hợp giữ vì curated) về đúng 0.
 */
async function repairKeptContactCounters(orgId: string, keptIds: string[]): Promise<void> {
  try {
    for (const part of chunk(keptIds, BATCH)) {
      // Đếm Friend CÒN LẠI theo (contact, relationshipKind) — 1 query/lô.
      const grouped = await prisma.friend.groupBy({
        by: ['contactId', 'relationshipKind'],
        where: { orgId, contactId: { in: part } },
        _count: { _all: true },
      });

      // Mặc định 0/0/0 — KH giữ vì curated có thể không còn Friend nào.
      const tally = new Map<string, { accepted: number; pending: number; chatting: number }>();
      for (const id of part) tally.set(id, { accepted: 0, pending: 0, chatting: 0 });
      for (const g of grouped) {
        const t = tally.get(g.contactId);
        if (!t) continue;
        const n = g._count._all;
        if (g.relationshipKind === 'friend') t.accepted += n;
        else if (g.relationshipKind === 'pending_friend') t.pending += n;
        else if (g.relationshipKind === 'chatting_stranger') t.chatting += n;
      }

      // ownerFriendId là soft FK (không có ràng buộc DB) → tự kiểm tra Friend còn sống.
      const withOwner = await prisma.contact.findMany({
        where: { orgId, id: { in: part }, ownerFriendId: { not: null } },
        select: { id: true, ownerFriendId: true },
      });
      const ownerIds = withOwner.map((c) => c.ownerFriendId).filter((v): v is string => !!v);
      const aliveOwners = ownerIds.length > 0
        ? new Set(
            (await prisma.friend.findMany({ where: { id: { in: ownerIds } }, select: { id: true } }))
              .map((f) => f.id),
          )
        : new Set<string>();
      const staleOwnerIds = withOwner
        .filter((c) => c.ownerFriendId && !aliveOwners.has(c.ownerFriendId))
        .map((c) => c.id);

      // Gom KH có cùng bộ 3 counter → 1 updateMany/bộ thay vì 1 update/KH.
      // Thực tế gần như chỉ có vài bộ (1/0/0, 0/1/0, 0/0/0…) nên rất ít query.
      const buckets = new Map<string, string[]>();
      for (const [id, t] of tally) {
        const key = `${t.accepted}:${t.pending}:${t.chatting}`;
        const list = buckets.get(key);
        if (list) list.push(id);
        else buckets.set(key, [id]);
      }
      for (const [key, ids] of buckets) {
        const [accepted, pending, chatting] = key.split(':').map(Number);
        await prisma.contact.updateMany({
          where: { orgId, id: { in: ids } },
          data: {
            acceptedNicksCount: accepted,
            pendingNicksCount: pending,
            chattingNicksCount: chatting,
          },
        });
      }

      if (staleOwnerIds.length > 0) {
        await prisma.contact.updateMany({
          where: { orgId, id: { in: staleOwnerIds } },
          data: { ownerFriendId: null },
        });
      }
    }
  } catch (err) {
    // Counter là cache — sai thì lệch hiển thị, không làm hỏng dữ liệu gốc.
    // Không để lỗi ở đây rollback cả thao tác xoá đã thành công.
    logger.warn('[admin-purge] repair kept contact counters failed:', err);
  }
}

/**
 * duplicate_groups.contact_ids và parent_candidates.contact_ids là mảng text,
 * không phải FK → Contact bị xoá vẫn để lại id treo, làm UI gợi ý trùng lặp trỏ
 * vào KH không tồn tại. Xoá luôn các cụm có chứa id đã xoá (cụm sẽ được
 * duplicate-detector cron dựng lại từ dữ liệu còn sống).
 */
async function cleanupStaleContactIdArrays(orgId: string, deletedIds: string[]): Promise<void> {
  try {
    for (const part of chunk(deletedIds, BATCH)) {
      await prisma.duplicateGroup.deleteMany({
        where: { orgId, contactIds: { hasSome: part } },
      });
      await prisma.parentCandidate.deleteMany({
        where: { orgId, contactIds: { hasSome: part } },
      });
    }
  } catch (err) {
    // Dọn dẹp phụ trợ — lỗi ở đây không được làm thao tác xoá chính thất bại.
    logger.warn('[admin-purge] cleanup duplicate/parent candidate arrays failed:', err);
  }
}

// ── Resume sync ────────────────────────────────────────────────────────────

/**
 * Bật lại đồng bộ cho các nick đã tạm dừng. Lần cron kế tiếp (hoặc nút "Làm mới
 * ngay") sẽ hút lại danh sách bạn từ Zalo — tức là dữ liệu vừa xoá sẽ quay về.
 * Vì vậy FE phải cảnh báo rõ trước khi gọi.
 */
export async function resumeSync(
  orgId: string,
  zaloAccountIds: string[],
  actor: { userId: string; email?: string },
): Promise<number> {
  const ids = zaloAccountIds.filter((id) => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return 0;

  const res = await prisma.zaloAccount.updateMany({
    where: { id: { in: ids }, orgId },
    data: { syncPaused: false, syncPausedAt: null, syncPausedReason: null },
  });

  if (res.count > 0) {
    logActivity({
      orgId,
      userId: actor.userId,
      action: 'admin_resume_friend_sync',
      category: 'system',
      entityType: 'zalo_account',
      entityId: ids[0] ?? null,
      details: { zaloAccountIds: ids, resumed: res.count, actorEmail: actor.email },
    });
  }

  return res.count;
}

// ── Target listing (cho dropdown chọn nhân viên trên FE) ──────────────────

export interface PurgeTargetUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
  accounts: ScopeAccount[];
  totalFriends: number;
}

/**
 * Liệt kê nhân viên trong org kèm nick Zalo + số KH đã đồng bộ qua từng nick.
 * Chỉ trả user có ít nhất 1 nick — user không có nick thì không có gì để xoá.
 */
export async function listPurgeTargets(orgId: string): Promise<PurgeTargetUser[]> {
  const users = await prisma.user.findMany({
    where: { orgId, zaloAccounts: { some: {} } },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      zaloAccounts: {
        select: {
          id: true,
          displayName: true,
          zaloUid: true,
          status: true,
          syncPaused: true,
          _count: { select: { friends: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { fullName: 'asc' },
  });

  return users.map((u) => {
    const accounts: ScopeAccount[] = u.zaloAccounts.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      zaloUid: a.zaloUid,
      status: a.status,
      syncPaused: a.syncPaused,
      friendCount: a._count.friends,
    }));
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      accounts,
      totalFriends: accounts.reduce((sum, a) => sum + a.friendCount, 0),
    };
  });
}
