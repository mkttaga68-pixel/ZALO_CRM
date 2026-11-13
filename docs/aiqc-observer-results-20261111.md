# Kết quả theo nhân viên và thông báo người phụ trách

Đã cập nhật local cổng 3080 với image `zl-crm-app:aiqc-observations-local-20261111`, digest `sha256:d62a59c2ac36521f960b98474f9ebc530d579d7c4180479a543b55b441394175`. Overlay cuối `docker-compose.aiqc-department-local.yml` hiện trỏ vào image này. Không thêm migration cho lượt cập nhật này.

## Giao diện

- Xem trước hiển thị tên nhân viên và tên hội thoại.
- Mỗi kết quả có thẻ tên nhân viên, trạng thái, nhận xét và các nhóm nội dung kiểm tra. Với nội dung cần xem xét, tên liên quan chỉ lấy từ tin HUMAN đã VERIFIED được chính finding trích dẫn, không lấy tất cả nhân viên trong hội thoại để quy kết.
- Bằng chứng gồm nguyên văn phần tin đã che dữ liệu theo snapshot lưu, thời điểm, người gửi và quy tắc/phiên bản đối chiếu.
- Khi resource guard chặn Ollama, kết quả ghi chưa phân tích được, hiển thị nhân viên trong phạm vi và không tạo nhận xét hành vi.
- Sau mỗi lượt quét, dashboard tải lại chỉ số; hộp thông báo tự cập nhật mỗi 30 giây khi tab trình duyệt đang mở và đang hiển thị.

## Thông báo trong dashboard AIQC

Chỉ những run phòng ban mới được tạo từ phiên bản này, có trạng thái COMPLETED và finding POTENTIAL_ISSUE mới xuất hiện trong hộp thông báo. Thông báo nằm trong trang AIQC, chưa tích hợp chuông toàn CRM hoặc gửi ra email/Zalo.

Người nhận phải có trong cả danh sách người phụ trách tại lúc tạo run và cấu hình hiện tại. Backend kiểm tra lại quyền AIQC, tenant, quyền nội dung hội thoại/account/contact/privacy, ACL tài liệu hiện tại và hạn lưu 7 ngày trước khi trả thông báo hoặc bằng chứng. Quyền người nhận không tự tăng lên view_all. Việc chọn một user làm người phụ trách không cấp thêm quyền đọc CRM cho user đó.

Đã xem chỉ thay đổi trạng thái thông báo; không đồng nghĩa quản lý đã chấp nhận nhận xét. Xét duyệt chính thức vẫn qua chức năng bằng chứng/xét duyệt với grant approve hiện tại. Trạng thái đọc và người nhận lưu cùng run trong workspace, audit chỉ ghi ID; metadata thông báo không thuộc snapshotHash của nội dung phân tích. Khi run bị purge, metadata thông báo được xóa cùng run.

Danh sách kiểm tra tối đa 100 run gần đây có nội dung cần xem xét, hiển thị 30 mục và giao diện tóm tắt 5 mục. Chưa phải hàng đợi cảnh báo quy mô lớn; cần phân trang/index riêng nếu khối lượng tăng.

## Kiểm tra

- Backend TypeScript, frontend vue-tsc, frontend build đạt.
- 16 kiểm tra backend cho cấu hình, bật/tắt, người nhận, tenant, expiry, ACL mới và tên từ đúng bằng chứng đạt.
- 13 kiểm tra hồi quy frontend đạt.
- Kiểm tra trình duyệt 1280px/390px bằng fixture synthetic: không lỗi JavaScript, không tràn ngang; thẻ tên/bằng chứng và trạng thái thiếu tài nguyên đúng. Ảnh trong `C:\Zalo CRM\aiqc-observations-local-20261111\desktop.png`, `mobile.png` chỉ chứa dữ liệu giả.
- Sau triển khai: app healthy, DB connected, index khớp bản build, hai chunk thẻ kết quả/hộp thư HTTP 200; API thông báo không đăng nhập trả 401.
- Không chạy inference thật trong lượt triển khai. Các lượt quét trước bị thiếu tài nguyên chưa có kết quả AI để hiển thị nhận xét.
