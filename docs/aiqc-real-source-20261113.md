# AIQC dùng nguồn CRM thật — 13/11/2026

- Theo yêu cầu người dùng, gỡ 4 tài liệu `synthetic=true` và 2 tài liệu trong `09_BO_TEST_AI` khỏi workspace tổ chức đang test. Hai tài liệu bộ test được nguồn cũ nạp lại trong lúc triển khai đã được gỡ tiếp sau khi bộ lọc mới chạy.
- Kiểm tra cuối: 20 tài liệu nguồn còn lại, 0 tài liệu giả lập/bộ test, 3 quy tắc không synthetic đã duyệt (INSULT, COURTESY, UNRESOLVED_REQUEST). Hash của ba quy tắc khớp file nguồn. Không duyệt thêm bản nháp hoặc biểu mẫu.
- Provider mặc định: `ollama`, model `qwen3:4b-instruct`; giữ nguồn CRM của đúng pilot tenant và thời gian lưu đã duyệt 7 ngày. Không thay nội dung tin nhắn, ngân sách hay ngưỡng tài nguyên.
- Sửa frontend để không tự đổi cấu hình Ollama thành mock khi OpenAI đã bị loại bỏ.
- Kho nguồn thật bỏ qua thư mục gốc `09_BO_TEST_AI` trong preview/sync; kho fixture synthetic riêng vẫn hoạt động cho kiểm thử phần mềm. File nguồn gốc trong Downloads không bị sửa/xóa.
- Image đang áp dụng: `zl-crm-app:aiqc-real-source-20261113`, ID `sha256:977da9562a2a86809bcae8aec3b52d921167f89e26244bcb8feee62a41e635c9`. Chỉ thay module knowledge dựa trên bản đang chạy; giữ các API job recovery của image trước.
- Checksum module: `c08f41f20dc9d4aabf35bb1468215eea8cb65e759cd263555f0543cc4f7f4dcf`. Bản scan thật sau triển khai trả 20 file, 0 test, 0 issue; health 200.
- 10 kiểm thử backend liên quan, 7 kiểm thử dashboard, backend tsc và frontend vue-tsc đạt; kiểm tra image bằng bộ tài liệu tạm trong container không có mạng đạt.

## Điều kiện test bằng dữ liệu thật

Lần kiểm tra dữ liệu ban đầu có 10 hội thoại, 564 tin nhắn (21 self, 543 contact); chưa có `replied_by_user_id` để xác minh nhân viên gửi. Không tự gán danh tính vào lịch sử. Người dùng cần gửi tin từ giao diện CRM bằng tài khoản nhân viên để có dữ liệu đánh giá hợp lệ.

Lúc kiểm tra cuối (04:30 UTC), resource admission từ chối với `OLLAMA_RESOURCE_LIMIT`, RAM trống khoảng 1,38 GiB. Không chạy thử model trên hội thoại thật và không giảm ngưỡng bảo vệ. Cần giải phóng RAM rồi vào Hội thoại → Tải danh sách hội thoại → Xem trước bản gửi → xác nhận phân tích bằng Ollama.
