const labels: Record<string, string> = {
  INSULT: 'Ngôn ngữ xúc phạm', COURTESY: 'Phép lịch sự', UNRESOLVED_REQUEST: 'Yêu cầu chưa giải quyết', KNOWLEDGE_MISMATCH: 'Thông tin sản phẩm',
  POTENTIAL_ISSUE: 'Cần xem xét', NO_ISSUE_OBSERVED: 'Chưa ghi nhận vấn đề', ABSTAIN: 'Chưa đủ căn cứ', UNKNOWN: 'Chưa xác định',
  PENDING: 'Chờ duyệt', ACCEPTED_FOR_FOLLOWUP: 'Cần theo dõi', DISMISSED: 'Đã bác bỏ', OPEN: 'Chưa xem', ACKNOWLEDGED: 'Đã xem',
  COMPLETED: 'Đã phân tích', NOT_EVALUABLE: 'Chưa thể đánh giá', APPROVED: 'Đã duyệt', DRAFT: 'Bản nháp', REVOKED: 'Đã thu hồi', REPLACED: 'Đã thay thế',
  CRM: 'Hội thoại CRM', SERVER_SYNTHETIC: 'Dữ liệu thử nghiệm', USER_ATTESTED_SAMPLE: 'Mẫu nhập thủ công',
  HUMAN: 'Nhân viên', CUSTOMER: 'Khách hàng', BOT: 'Tự động', SYSTEM: 'Hệ thống', VERIFIED: 'Đã xác minh',
  mock: 'Mô phỏng', ollama: 'AI cục bộ', openai: 'OpenAI', NOT_AVAILABLE: 'Chưa có dữ liệu', AVAILABLE: 'Sẵn sàng', VALID: 'Hợp lệ',
  CONDUCT_NEEDS_REVIEW: 'Ứng xử cần xem xét', UNANSWERED_CONVERSATION: 'Hội thoại chưa phản hồi', SLA_BREACH: 'Quá hạn phản hồi', CUSTOMER_CARE_OVERDUE: 'Quá hạn chăm sóc', INSUFFICIENT_EVIDENCE: 'Chưa đủ bằng chứng',
  RETENTION_7_DAYS_REQUIRED: 'Cần duyệt thời gian lưu chứng cứ 7 ngày.', MANUAL_RETENTION_7_DAYS_REQUIRED: 'Cần duyệt thời gian lưu chứng cứ 7 ngày.',
  APPROVED_RULES_REQUIRED: 'Chưa có quy tắc đã duyệt còn hiệu lực.', APPROVED_RULE_NOT_AVAILABLE: 'Chưa có quy tắc phù hợp.', APPROVED_KNOWLEDGE_NOT_AVAILABLE: 'Chưa có tài liệu đã duyệt phù hợp.',
  VERIFIED_HUMAN_ATTRIBUTION_MISSING: 'Chưa xác minh được người gửi.', VERIFIED_HUMAN_MESSAGE_NOT_AVAILABLE: 'Chưa có tin nhắn nhân viên được xác minh.',
  RULE_NOT_APPLICABLE_AT_EVENT_TIME: 'Quy tắc chưa có hiệu lực tại thời điểm tin nhắn.', COVERAGE_OR_ASSIGNMENT_UNKNOWN: 'Chưa đủ dữ liệu phân công và theo dõi hội thoại.',
  LOCAL_MODEL_UNAVAILABLE: 'AI cục bộ chưa sẵn sàng.', SEMANTIC_MODEL_REQUIRED: 'Cần mô hình phân tích ngữ nghĩa.',
  AI_QC_JOB_CHANGED: 'Lượt xử lý hoặc cấu hình đã thay đổi. Vui lòng làm mới danh sách.',
  DEPARTMENT_MONITORING_STORAGE_UNAVAILABLE: 'Chưa tải được danh sách xử lý. Vui lòng thử lại.',
  OLLAMA_QUEUE_TIMEOUT: 'AI đang bận quá lâu. Vui lòng thử lại sau.', OLLAMA_CIRCUIT_OPEN: 'AI đang tạm nghỉ sau nhiều lỗi. Vui lòng thử lại sau.',
  OLLAMA_TIMEOUT: 'Phân tích vượt thời gian chờ. Vui lòng kiểm tra máy chạy AI trước khi thử lại.',
  OLLAMA_INVALID_OR_UNAVAILABLE: 'AI chưa sẵn sàng hoặc trả kết quả không hợp lệ.', CONTINUOUS_SERVICE_UNAVAILABLE: 'Dịch vụ phân tích nền chưa sẵn sàng.',
  insult: 'Nhân viên dùng lời xúc phạm', 'customer-insult': 'Khách hàng dùng lời xúc phạm', quoted: 'Trích dẫn lời nói', polite: 'Phản hồi lịch sự', unanswered: 'Chưa phản hồi', knowledge: 'Kiến thức sản phẩm', 'missing-actor': 'Chưa xác định người gửi', bot: 'Phản hồi tự động', 'off-day': 'Hoạt động ngày nghỉ', 'missing-coverage': 'Thiếu dữ liệu theo dõi',
};

export const qcLabel = (value?: string | null): string => value ? labels[value] ?? 'Chưa xác định' : 'Chưa có dữ liệu';
export const analysisOptions = ['INSULT', 'COURTESY', 'UNRESOLVED_REQUEST', 'KNOWLEDGE_MISMATCH'].map(value => ({ title: labels[value]!, value }));
export const qcTone = (value: string): string => ['POTENTIAL_ISSUE', 'PENDING', 'OPEN', 'ACCEPTED_FOR_FOLLOWUP'].includes(value) ? 'warning' : ['COMPLETED', 'APPROVED', 'VERIFIED', 'NO_ISSUE_OBSERVED'].includes(value) ? 'success' : 'secondary';
export function qcError(code?: string): string {
  if (code && labels[code]) return labels[code]!;
  const errors: Record<string, string> = {
    AI_QC_DISABLED: 'Phân hệ đang tạm dừng. Vui lòng liên hệ quản trị viên.', AI_QC_SCHEMA_NOT_READY: 'Dữ liệu cấu hình chưa sẵn sàng. Vui lòng liên hệ quản trị viên.',
    MONITORING_DISABLED: 'Giám sát thử nghiệm đang tắt.',
    SCHEDULE_INVALID: 'Lịch không hợp lệ. Kiểm tra lại giờ bật/tắt (không được trùng nhau) và tối đa 4 khung giờ.', SCHEDULE_EMPTY: 'Hãy chọn ít nhất một ngày và một khung giờ trước khi bật lịch.',
    DEPARTMENT_AI_DISABLED: 'AI đang tắt cho phòng ban này. Hãy bật công tắc trước khi quét.',
    DEPARTMENT_CONFIGURATION_CHANGED: 'Cấu hình vừa thay đổi. Hãy làm mới và xem trước lại.',
    ALERT_RECIPIENT_NOT_IN_TENANT: 'Người phụ trách không còn hoạt động trong tổ chức.',
    INVALID_DEPARTMENT_TOGGLE: 'Trạng thái AI không hợp lệ. Vui lòng tải lại trang.',
    QC_FORBIDDEN: 'Bạn chưa có quyền thực hiện thao tác này.', QC_ORG_ADMIN_REQUIRED: 'Thao tác này cần quyền quản trị tổ chức.',
    CONFLICTING_APPROVED_DOCUMENTS: 'Quy tắc trùng phạm vi với tài liệu đã duyệt. Hãy kiểm tra phiên bản và ngày hiệu lực.',
    HASH_CONFLICT: 'Tài liệu đã thay đổi. Vui lòng tải lại trước khi duyệt.', RUN_NOT_FOUND: 'Kết quả không còn khả dụng hoặc bạn chưa có quyền truy cập.',
    AI_QC_RATE_OR_TOKEN_BUDGET_EXCEEDED: 'Đã đạt giới hạn phân tích. Vui lòng thử lại sau.',
    DEPARTMENT_LOCAL_TEST_NOT_AUTHORIZED: 'Quét thử chưa được bật cho tổ chức này.', DEPARTMENT_MONITOR_CONFIG_INCOMPLETE: 'Hãy chọn loại phân tích, người nhận và mã phê duyệt trước khi quét.',
    DEPARTMENT_HAS_NO_ACTIVE_MEMBERS: 'Phòng ban chưa có thành viên đang hoạt động.', DEPARTMENT_LOCAL_TEST_KILL_SWITCH_ACTIVE: 'Quét thử đang tạm dừng theo yêu cầu quản trị viên.',
    DEPARTMENT_MONITOR_CONFIG_REQUIRED: 'Hãy lưu cấu hình phòng ban trước khi quét thử.',
    OLLAMA_RESOURCE_LIMIT: 'Máy chủ chưa đủ tài nguyên để phân tích. Vui lòng thử lại sau.', OLLAMA_QUEUE_FULL: 'AI đang bận. Vui lòng thử lại sau.',
  };
  return errors[code ?? ''] ?? 'Chưa thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ quản trị viên.';
}
