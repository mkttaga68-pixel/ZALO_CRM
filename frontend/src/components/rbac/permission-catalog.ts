/**
 * Danh mục quyền cho trang Phân quyền: nhóm các chức năng (resource) thành "mục quyền lớn",
 * kèm tên/mô tả tiếng Việt và logic tích quyền. Danh sách resource thật vẫn lấy từ backend
 * (/permission-groups/meta); resource chưa có trong danh mục rơi vào nhóm "Khác".
 */
export type Grants = Record<string, Record<string, boolean>>;

export interface ResourceInfo { icon: string; label: string; hint: string }
export interface Category { id: string; icon: string; label: string; hint: string; resources: string[] }

export const ACTION_LABELS: Record<string, string> = {
  access: 'Truy cập', create: 'Thêm mới', edit: 'Chỉnh sửa', delete: 'Xóa', approve: 'Duyệt', pay: 'Thanh toán', view_all: 'Xem tất cả',
};
export const ACTION_HINTS: Record<string, string> = {
  create: 'Tạo mới bản ghi', edit: 'Sửa bản ghi đã có', delete: 'Xóa bản ghi', approve: 'Duyệt / phê duyệt',
  pay: 'Thao tác thanh toán', view_all: 'Xem dữ liệu của cả tổ chức, không chỉ của mình / phòng ban',
};

export const RESOURCE_INFO: Record<string, ResourceInfo> = {
  dashboard: { icon: '🏠', label: 'Dashboard (Tổng quan)', hint: 'Trang chủ với số liệu tổng hợp' },
  report: { icon: '📊', label: 'Báo cáo', hint: 'Xem các báo cáo' },
  analytics: { icon: '📈', label: 'Phân tích', hint: 'Biểu đồ và phân tích dữ liệu' },
  conversation: { icon: '💬', label: 'Tin nhắn (Hội thoại)', hint: 'Đọc và trả lời tin nhắn khách' },
  contact: { icon: '🧑', label: 'Khách hàng', hint: 'Hồ sơ, trạng thái, thẻ khách hàng' },
  appointment: { icon: '📅', label: 'Lịch hẹn', hint: 'Lịch hẹn với khách hàng' },
  engagement_score: { icon: '🚨', label: 'KH đình trệ / Điểm tương tác', hint: 'Danh sách khách đình trệ và điểm tương tác' },
  audit_log: { icon: '📜', label: 'Lịch sử hoạt động khách hàng', hint: 'Nhật ký thao tác trên khách hàng' },
  contact_data_purge: { icon: '🧹', label: 'Xóa dữ liệu khách hàng', hint: 'Dọn dữ liệu đồng bộ theo nhân viên / nick. Chỉ Admin/Owner dùng được' },
  zalo_account: { icon: '🟢', label: 'Nick Zalo', hint: 'Kết nối và quản lý tài khoản Zalo' },
  friend: { icon: '🫂', label: 'Bạn bè Zalo', hint: 'Danh sách bạn bè, kết bạn' },
  group: { icon: '👥', label: 'Nhóm Zalo', hint: 'Các nhóm Zalo (biểu tượng Nhóm trên thanh trên cùng)' },
  posting: { icon: '📢', label: 'Đăng bài', hint: 'Đăng nhóm và Chào hàng' },
  automation: { icon: '⚡', label: 'Automation', hint: 'Quy tắc và mẫu tin tự động' },
  bot_auto: { icon: '🤖', label: 'Bot-Auto (công tắc tổng)', hint: 'Phải bật thì các mục Bot-Auto bên dưới mới có hiệu lực' },
  trigger: { icon: '🎯', label: 'Trigger', hint: 'Điều kiện kích hoạt bot' },
  block: { icon: '🧱', label: 'Message Block', hint: 'Khối nội dung tin nhắn' },
  sequence: { icon: '🔁', label: 'Sequence', hint: 'Chuỗi tin nhắn theo thời gian' },
  broadcast: { icon: '📣', label: 'Chiến dịch', hint: 'Gửi tin hàng loạt' },
  customer_list: { icon: '📋', label: 'Tệp khách hàng', hint: 'Danh sách khách dùng cho chiến dịch' },
  ai_assistant: { icon: '✨', label: 'Trợ lý AI', hint: 'Trợ lý AI trả lời và gợi ý' },
  ai_quality_control: { icon: '🧠', label: 'AI Quality Control', hint: 'Giám sát chất lượng hội thoại bằng AI' },
  department: { icon: '🏢', label: 'Phòng ban', hint: 'Cơ cấu phòng ban và thành viên' },
  user: { icon: '👤', label: 'Người dùng', hint: 'Tài khoản nhân viên' },
  permission_group: { icon: '🛡', label: 'Nhóm quyền', hint: 'Trang Phân quyền này. Chỉ Owner/Admin sửa được' },
  settings: { icon: '⚙', label: 'Cài đặt', hint: 'Tổ chức, CRM, chấm điểm, nhãn Zalo, trả lời tự động' },
  integration: { icon: '🔗', label: 'Tích hợp & Facebook', hint: 'Kết nối Facebook và dịch vụ ngoài' },
  webhook: { icon: '🔌', label: 'API & Webhook', hint: 'Khóa API và webhook gửi ra ngoài' },
};

export const CATEGORIES: Category[] = [
  { id: 'overview', icon: '📊', label: 'Tổng quan & Báo cáo', hint: 'Dashboard, báo cáo, phân tích', resources: ['dashboard', 'report', 'analytics'] },
  { id: 'customer', icon: '🧑‍💼', label: 'Khách hàng & Tin nhắn', hint: 'Hội thoại, khách hàng, lịch hẹn, dữ liệu khách', resources: ['conversation', 'contact', 'appointment', 'engagement_score', 'audit_log', 'contact_data_purge'] },
  { id: 'zalo', icon: '🟢', label: 'Zalo', hint: 'Nick Zalo, bạn bè, nhóm', resources: ['zalo_account', 'friend', 'group'] },
  { id: 'marketing', icon: '📢', label: 'Đăng bài & Automation', hint: 'Đăng nhóm, chào hàng, quy tắc tự động', resources: ['posting', 'automation'] },
  { id: 'bot', icon: '🤖', label: 'Bot-Auto', hint: 'Công tắc tổng và các thành phần bot', resources: ['bot_auto', 'trigger', 'block', 'sequence', 'broadcast', 'customer_list'] },
  { id: 'ai', icon: '✨', label: 'Trí tuệ nhân tạo (AI)', hint: 'Trợ lý AI và AI Quality Control', resources: ['ai_assistant', 'ai_quality_control'] },
  { id: 'org', icon: '🏢', label: 'Tổ chức & Phân quyền', hint: 'Phòng ban, người dùng, nhóm quyền', resources: ['department', 'user', 'permission_group'] },
  { id: 'system', icon: '⚙', label: 'Hệ thống & Tích hợp', hint: 'Cài đặt, tích hợp, API', resources: ['settings', 'integration', 'webhook'] },
];

/** Resource con chỉ có hiệu lực khi công tắc module bật (đồng bộ RESOURCE_MODULE backend). */
export const RESOURCE_MODULE: Record<string, string> = { customer_list: 'bot_auto', broadcast: 'bot_auto', sequence: 'bot_auto', trigger: 'bot_auto', block: 'bot_auto' };

export const resourceInfo = (r: string): ResourceInfo => RESOURCE_INFO[r] ?? { icon: '•', label: r, hint: '' };

/** Danh mục chỉ gồm resource backend thật sự hỗ trợ; resource lạ gom vào "Khác". */
export function buildCategories(resources: string[]): Category[] {
  const known = new Set(CATEGORIES.flatMap(c => c.resources));
  const out = CATEGORIES.map(c => ({ ...c, resources: c.resources.filter(r => resources.includes(r)) })).filter(c => c.resources.length);
  const other = resources.filter(r => !known.has(r));
  if (other.length) out.push({ id: 'other', icon: '•', label: 'Khác', hint: 'Chức năng khác', resources: other });
  return out;
}

const clone = (g: Grants | undefined): Grants => JSON.parse(JSON.stringify(g ?? {}));

/**
 * Tích/bỏ một ô. Tích hành động con → tự bật Truy cập (không có Truy cập thì ô con vô hiệu).
 * Tắt Truy cập → bỏ luôn các ô con của chức năng đó để không còn quyền "treo".
 */
export function setAction(grants: Grants | undefined, resource: string, action: string, value: boolean, actions: string[]): Grants {
  const next = clone(grants);
  const row = (next[resource] ??= {});
  if (action === 'access') {
    if (value) row.access = true;
    else for (const a of actions) row[a] = false;
  } else {
    row[action] = value;
    if (value && actions.includes('access')) row.access = true;
  }
  return next;
}

/** Bật/tắt toàn bộ hành động của các resource (cả nhóm lớn hoặc cả tổ chức). */
export function setResources(grants: Grants | undefined, resources: string[], resourceActions: Record<string, string[]>, value: boolean): Grants {
  const next = clone(grants);
  for (const r of resources) {
    const row = (next[r] ??= {});
    for (const a of resourceActions[r] ?? []) row[a] = value;
  }
  return next;
}

export function countGranted(grants: Grants | undefined, resources: string[], resourceActions: Record<string, string[]>): { on: number; total: number } {
  let on = 0, total = 0;
  for (const r of resources) for (const a of resourceActions[r] ?? []) { total++; if (grants?.[r]?.[a]) on++; }
  return { on, total };
}
