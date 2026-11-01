/**
 * permission-types.ts — Resource × Action matrix định nghĩa
 *
 * Reference: GetflyCRM screenshot (matrix 7 cột × 15 resource).
 * Lock 2026-05-21 trong design doc thanh-rbac-m2-design-20260521.md.
 */

// 7 action columns (giống Getfly)
export const ACTIONS = [
  'access',       // Truy cập
  'create',       // Thêm mới
  'edit',         // Chỉnh sửa
  'delete',       // Xóa
  'approve',      // Duyệt
  'pay',          // Thanh toán
  'view_all',     // Xem tất cả — KEY FLAG bypass dept scope
] as const;
export type Action = (typeof ACTIONS)[number];

// 17 resources trong ZaloCRM (map từ Getfly + thêm cụ thể cho Zalo domain)
export const RESOURCES = [
  'department',         // Quản lý phòng ban
  'user',               // Quản lý người dùng
  'permission_group',   // Quản lý quyền
  'conversation',       // Hội thoại
  'contact',            // Khách hàng
  'friend',             // Friends (Zalo per-account)
  'posting',            // Đăng bài: Đăng nhóm + Chào hàng
  'bot_auto',           // Bot-Auto — công tắc tổng của cả module automation (tab 🤖)
  'customer_list',      // Tệp KH
  'broadcast',          // Chiến dịch
  'sequence',           // Sequence automation
  'trigger',            // Trigger automation
  'block',              // Message block
  'zalo_account',       // Nick Zalo
  'webhook',            // Webhook outbound
  'engagement_score',   // Engagement + Score (metadata)
  'audit_log',          // Activity / Audit log
  'settings',           // App settings
] as const;
export type Resource = (typeof RESOURCES)[number];

// Mỗi resource declare actions hợp lệ (subset của ACTIONS).
// Vd Engagement không có "create/edit/delete" — chỉ computed.
export const RESOURCE_ACTIONS: Record<Resource, readonly Action[]> = {
  department: ['access', 'create', 'edit', 'delete'],
  user: ['access', 'create', 'edit', 'delete'],
  permission_group: ['access', 'create', 'edit', 'delete'],
  conversation: ['access', 'edit', 'delete', 'view_all'],
  contact: ['access', 'create', 'edit', 'delete', 'view_all'],
  friend: ['access', 'create', 'edit', 'delete', 'view_all'],
  posting: ['access'],
  // Bot-Auto là công tắc module, không phải entity → chỉ có 'access'.
  bot_auto: ['access'],
  customer_list: ['access', 'create', 'edit', 'delete', 'approve', 'view_all'],
  broadcast: ['access', 'create', 'edit', 'delete', 'approve', 'view_all'],
  sequence: ['access', 'create', 'edit', 'delete', 'approve', 'view_all'],
  trigger: ['access', 'create', 'edit', 'delete', 'view_all'],
  block: ['access', 'create', 'edit', 'delete', 'view_all'],
  zalo_account: ['access', 'create', 'edit', 'delete', 'view_all'],
  webhook: ['access', 'create', 'edit', 'delete'],
  engagement_score: ['access', 'view_all'],
  audit_log: ['access', 'view_all'],
  settings: ['access', 'create', 'edit'],
};

// JSON shape lưu trong permission_groups.grants:
//   { "<resource>": { "<action>": boolean } }
// Vd:
//   { "conversation": { "access": true, "view_all": true, "edit": true } }
export type GrantsJson = {
  [R in Resource]?: {
    [A in Action]?: boolean;
  };
};

// ════════════════════════════════════════════════════════════════════════
// MODULE GATE — Bot-Auto (2026-10-26)
//
// Tab 🤖 Bot-Auto gom 5 resource con. Trước đây mỗi resource tick riêng, không có
// cách nào tắt cả module trong 1 nốt nhạc. Thêm resource 'bot_auto' làm CÔNG TẮC
// TỔNG: bỏ tick 'bot_auto.access' → mọi quyền trên 5 resource con tắt theo,
// không cần đụng vào từng ô.
//
// Quan hệ là AND: user cần bot_auto.access VÀ grant của resource con.
// Enforce trong hasGrant() nên mọi đường (middleware requireGrant, userHasGrant,
// route guard) đều đi qua cùng 1 luật — không có cửa sau.
// ════════════════════════════════════════════════════════════════════════

/** Resource con nằm trong module nào. Resource không có mặt ở đây = không bị gate. */
export const RESOURCE_MODULE: Partial<Record<Resource, Resource>> = {
  customer_list: 'bot_auto',
  broadcast: 'bot_auto',
  sequence: 'bot_auto',
  trigger: 'bot_auto',
  block: 'bot_auto',
};

/** 5 resource con của Bot-Auto (dùng cho test + backfill, không mang ý nghĩa thứ tự). */
export const BOT_AUTO_RESOURCES = (Object.keys(RESOURCE_MODULE) as Resource[]).filter(
  (r) => RESOURCE_MODULE[r] === 'bot_auto',
);

/**
 * Check 1 action có grant không.
 * Default deny (return false nếu thiếu).
 *
 * Resource thuộc 1 module (xem RESOURCE_MODULE) còn phải có module.access — tắt
 * module là tắt sạch, kể cả các ô con vẫn đang tick.
 */
export function hasGrant(grants: GrantsJson, resource: Resource, action: Action): boolean {
  if (grants?.[resource]?.[action] !== true) return false;
  const moduleResource = RESOURCE_MODULE[resource];
  if (moduleResource && grants?.[moduleResource]?.access !== true) return false;
  return true;
}

/**
 * Validate grants JSON từ user input — strip mọi key không nằm trong whitelist.
 * Tránh injection: grants.adminBackdoor = true sẽ bị strip.
 */
export function sanitizeGrants(input: unknown): GrantsJson {
  if (!input || typeof input !== 'object') return {};
  const result: GrantsJson = {};
  for (const [r, actions] of Object.entries(input as Record<string, unknown>)) {
    if (!RESOURCES.includes(r as Resource)) continue;
    if (!actions || typeof actions !== 'object') continue;
    const validActions = RESOURCE_ACTIONS[r as Resource];
    const cleanActions: Record<string, boolean> = {};
    for (const [a, v] of Object.entries(actions as Record<string, unknown>)) {
      if (!validActions.includes(a as Action)) continue;
      if (typeof v === 'boolean') cleanActions[a] = v;
    }
    if (Object.keys(cleanActions).length > 0) {
      result[r as Resource] = cleanActions as any;
    }
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════════
// DEFAULT PERMISSION GROUPS (system, ship khi migration D13)
// 7 group anh chốt trong design doc.
// ════════════════════════════════════════════════════════════════════════

function fullCrud(resource: Resource): GrantsJson[Resource] {
  const actions: any = {};
  for (const a of RESOURCE_ACTIONS[resource]) actions[a] = true;
  return actions;
}

function readOnly(resource: Resource): GrantsJson[Resource] {
  return { access: true };
}

function viewAll(resource: Resource): GrantsJson[Resource] {
  return { access: true, view_all: true };
}

/**
 * Default groups. Migration D13 sẽ tạo các group này với is_system=true.
 * Admin → full mọi resource × mọi action.
 * Marketing → anh chốt A: contact.view_all=true (Zalo test loop 2026-05-21 13:25).
 */
export const DEFAULT_PERMISSION_GROUPS = [
  {
    name: 'Admin',
    isSystem: true,
    grants: Object.fromEntries(
      RESOURCES.map((r) => [r, fullCrud(r)])
    ) as GrantsJson,
  },
  {
    name: 'CEO',
    isSystem: true,
    grants: {
      // CEO xem mọi resource business, không sửa permission/department/user
      department: { access: true },
      user: { access: true },
      permission_group: { access: true },
      conversation: viewAll('conversation'),
      contact: viewAll('contact'),
      friend: viewAll('friend'),
      bot_auto: { access: true },
      customer_list: { access: true, view_all: true, create: true, edit: true, approve: true },
      broadcast: { access: true, view_all: true, create: true, edit: true, approve: true },
      sequence: { access: true, view_all: true, create: true, edit: true, approve: true },
      trigger: viewAll('trigger'),
      block: viewAll('block'),
      zalo_account: viewAll('zalo_account'),
      engagement_score: viewAll('engagement_score'),
      audit_log: viewAll('audit_log'),
      settings: { access: true },
    } as GrantsJson,
  },
  {
    name: 'Trưởng phòng',
    isSystem: true,
    grants: {
      // Manager full CRUD trong scope dept + sub-depts (view_all = false vì scope dept tree, không phải global)
      department: { access: true },
      user: { access: true },
      conversation: { access: true, edit: true, delete: true, view_all: true }, // view_all trong scope dept
      contact: fullCrud('contact'),
      friend: fullCrud('friend'),
      bot_auto: { access: true },
      customer_list: { access: true, create: true, edit: true, delete: true, approve: true, view_all: true },
      broadcast: { access: true, create: true, edit: true, delete: true, approve: true, view_all: true },
      sequence: { access: true, create: true, edit: true, approve: true, view_all: true },
      trigger: { access: true, create: true, edit: true, view_all: true },
      block: { access: true, create: true, edit: true, delete: true, view_all: true },
      zalo_account: { access: true, view_all: true },
      engagement_score: viewAll('engagement_score'),
      audit_log: { access: true },
      settings: { access: true },
    } as GrantsJson,
  },
  {
    name: 'Sale Senior',
    isSystem: true,
    grants: {
      // Sale Senior CRUD KH + Conversation của mình, có Xóa
      conversation: { access: true, edit: true, delete: true },
      contact: { access: true, create: true, edit: true, delete: true },
      friend: { access: true, create: true, edit: true },
      bot_auto: { access: true },
      customer_list: { access: true, create: true, edit: true },
      broadcast: { access: true, create: true, edit: true },
      sequence: { access: true, create: true, edit: true },
      trigger: { access: true },
      block: { access: true, create: true, edit: true },
      zalo_account: { access: true },
      engagement_score: { access: true },
      audit_log: { access: true },
    } as GrantsJson,
  },
  {
    name: 'Sale',
    isSystem: true,
    grants: {
      // Sale CR KH của mình, không Xóa Conversation
      conversation: { access: true, edit: true },
      contact: { access: true, create: true, edit: true },
      friend: { access: true, create: true, edit: true },
      bot_auto: { access: true },
      customer_list: { access: true },
      broadcast: { access: true },
      sequence: { access: true },
      trigger: { access: true },
      block: { access: true },
      zalo_account: { access: true },
      engagement_score: { access: true },
    } as GrantsJson,
  },
  {
    name: 'Marketing',
    isSystem: true,
    grants: {
      // Marketing CRUD Broadcast/Sequence/Trigger/Block, view_all Contact (anh chốt A 2026-05-21 13:25)
      contact: { access: true, view_all: true },
      friend: { access: true, view_all: true },
      bot_auto: { access: true },
      customer_list: { access: true, create: true, edit: true, view_all: true },
      broadcast: { access: true, create: true, edit: true, delete: true, view_all: true },
      sequence: { access: true, create: true, edit: true, delete: true, view_all: true },
      trigger: { access: true, create: true, edit: true, delete: true, view_all: true },
      block: { access: true, create: true, edit: true, delete: true, view_all: true },
      engagement_score: viewAll('engagement_score'),
      audit_log: { access: true },
    } as GrantsJson,
  },
  {
    name: 'Hành chính - Nhân sự',
    isSystem: true,
    grants: {
      // HC-NS view-only User + report, không access Conversation/Contact content
      user: { access: true, create: true, edit: true },
      department: { access: true },
      engagement_score: { access: true },
      audit_log: { access: true, view_all: true },
      settings: { access: true },
    } as GrantsJson,
  },
];
