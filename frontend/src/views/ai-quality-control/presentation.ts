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
/** Lý do một tệp bị bỏ qua khi quét/đồng bộ thư mục Obsidian. */
export const vaultIssueLabels: Record<string, string> = {
  SYMLINK_REJECTED: 'Là liên kết tắt (symlink)', PATH_ESCAPED_VAULT: 'Trỏ ra ngoài thư mục Obsidian',
  FILE_SIZE_OR_LINK_REJECTED: 'Tệp lớn hơn 256 KB hoặc là liên kết cứng', FILE_CHANGED_DURING_SCAN: 'Tệp đang được sửa trong lúc quét — hãy đồng bộ lại',
  INVALID_UTF8: 'Không phải văn bản UTF-8', FILE_UNREADABLE: 'Không đọc được tệp',
};
export const vaultCoverageLabel = (coverage?: string) => coverage === 'PARTIAL' ? 'Chưa đầy đủ' : coverage === 'SCANNED_WITHIN_LIMITS' ? 'Đầy đủ' : coverage ?? '';
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
    // Kho quy tắc / đồng bộ Obsidian
    VAULT_DOCUMENT_LIMIT: 'Thư mục Obsidian có hơn 500 tài liệu, vượt giới hạn một lần đồng bộ. Hãy tách bớt tài liệu không phải quy tắc ra thư mục khác.',
    VAULT_ENTRY_LIMIT: 'Thư mục Obsidian có quá nhiều tệp/thư mục (trên 2.000). Hãy dọn bớt tệp không cần thiết.',
    VAULT_DEPTH_LIMIT: 'Thư mục Obsidian lồng quá sâu (trên 8 cấp).',
    VAULT_NOT_FOUND_OR_SYMLINK: 'Không tìm thấy thư mục Obsidian, hoặc đường dẫn là liên kết tắt.', VAULT_PATH_MUST_BE_ABSOLUTE: 'Đường dẫn thư mục Obsidian phải là đường dẫn đầy đủ.',
    VAULT_NOT_ALLOWED_FOR_TENANT: 'Thư mục này chưa được cấp phép cho tổ chức.', VAULT_SYMLINK_BOUNDARY_REJECTED: 'Thư mục Obsidian đi qua liên kết tắt nên bị từ chối.',
    WORKSPACE_CAPACITY_REQUIRES_RETENTION_REVIEW: 'Kho dữ liệu AIQC đã đầy. Hãy liên hệ quản trị viên để rà soát thời gian lưu trữ trước khi đồng bộ thêm.',
    DOCUMENT_NOT_FOUND: 'Phiên bản tài liệu này không còn (có thể đã được thay bằng bản mới hơn khi đồng bộ). Hãy mở lại tài liệu.',
    REVISION_OR_HASH_CONFLICT: 'Tài liệu đã thay đổi hoặc không còn ở trạng thái phù hợp. Vui lòng tải lại.',
    STALE_PUBLICATION_REVISION: 'Đã có phiên bản mới hơn được duyệt cho tài liệu này.',
    SOURCE_FILE_MISSING: 'Tệp nguồn đã bị xoá khỏi Obsidian nên không thể duyệt. Khôi phục tệp rồi đồng bộ lại.',
    SOURCE_FILE_UNREADABLE: 'Không đọc được tệp nguồn trong Obsidian (tệp quá lớn, không phải UTF-8 hoặc là liên kết). Hãy kiểm tra tệp rồi đồng bộ lại.',
    SOURCE_CHANGED_SINCE_SYNC: 'Tệp trong Obsidian đã được sửa sau lần đồng bộ gần nhất. Hãy đồng bộ lại và duyệt bản nháp mới.',
    INVALID_APPROVED_RULE: 'Thiết lập quy tắc chưa hợp lệ. Kiểm tra mã quy tắc, loại phân tích và từ khóa đối chiếu.',
  };
  return errors[code ?? ''] ?? 'Chưa thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ quản trị viên.';
}
