# AIQC: danh sách lỗi và thử lại từng lượt — 13/11/2026

## Kết quả kiểm tra chỉ đọc

- 28 lượt DEAD: 14 `OLLAMA_RESOURCE_LIMIT`, 14 `AI_QC_RATE_OR_TOKEN_BUDGET_EXCEEDED`; 2 lượt DONE.
- API tổng hợp dùng `max(error_code)`, vì vậy không thể suy ra nguyên nhân của cả nhóm từ mã lỗi đó. Giao diện mới đọc nguyên nhân theo từng lượt.
- Ngân sách tại lúc kiểm tra: 20.000 token/ngày UTC, đã giữ chỗ 16.363, còn 3.637; 5 yêu cầu/phút. Chưa thay hạn mức hoặc xóa reservations.
- Máy khoảng 3 GiB RAM trống, GPU RTX 3060 còn hơn 10 GiB VRAM; mẫu telemetry hợp lệ, Ollama chưa có model resident tại thời điểm kiểm tra. Đây là ảnh chụp trạng thái hiện tại, không phải bằng chứng tài nguyên tại lúc các lỗi cũ xảy ra.

## Bản sửa

- Danh sách mặc định thu gọn, chỉ GET khi nhấn mở; từng lượt cũng thu gọn. Phân trang 20 ứng viên, kiểm tra quyền truy cập hội thoại trước khi trả thông tin. Không trả nội dung tin nhắn.
- Thấy đúng nguyên nhân, thời gian, số lần thử, ngân sách ngày và nút thử lại từng lượt.
- Chỉ quản trị có quyền access/edit/approve/view_all được đọc; retry cần thêm create. Query luôn ràng buộc tổ chức/phòng ban và 7 ngày gần nhất.
- Retry chỉ cho lỗi tạm thời ở trạng thái DEAD; kiểm tra phiên bản cấu hình, công tắc, kill switch, quyền xem hội thoại, admission và ngân sách tối thiểu. Worker vẫn kiểm tra thẩm quyền, lịch/phạm vi và ngân sách chính xác khi thực sự xử lý. Yêu cầu retry có thể bị từ chối nếu dữ liệu thay đổi.
- Cập nhật retry có điều kiện và audit cùng transaction; hai yêu cầu đồng thời không xếp lại cùng một lượt hai lần. Không tự retry khi mở danh sách.
- Không sửa ngưỡng tài nguyên, logic model, schema hay cài đặt ngân sách.

## Xác minh

- 22 kiểm thử backend (job routes, department monitoring, continuous worker) đạt.
- 4 kiểm thử giao diện bằng Vue renderer trong bộ nhớ đạt: thu gọn, chỉ đọc khi mở, tải lại sau lỗi, retry đúng lượt được chọn.
- Backend TypeScript, frontend vue-tsc và Vite build đạt. Vite còn cảnh báo chunk lớn hiện có.
- Image `zl-crm-app:aiqc-job-recovery-20261113` build thành công, kiểm tra import module trong container tạm không có mạng đạt.
- Image chỉ thay `/app/dist/modules/ai-quality-control/routes.js` và `department-job-routes.js`. File routes dựa trên bản đang chạy và chỉ thêm import/đăng ký endpoint mới; không mang theo thay đổi learning chưa triển khai trong source.
- Base: `zl-crm-app:aiqc-library-ui-20261112`, ID `sha256:4c4303f2855d4ffcdadb233196ba1ee8ab587cc48db483d2ff37918da5fbddc1`.
- Manifest/Dockerfile: `evidence/aiqc-job-recovery-20261113/image-context/`. Frontend build riêng: `evidence/aiqc-job-recovery-20261113/frontend/`; image backend giữ static đang chạy, frontend source dùng qua Vite cập nhật riêng.

## Trạng thái áp dụng

ĐÃ áp dụng sau yêu cầu xử lý ảnh báo thiếu API. File `docker-compose.aiqc-department-local.yml` trỏ tới image `zl-crm-app:aiqc-job-recovery-20261113`.

- Image đang chạy: `sha256:735d08c9cf5f6512c5473aebd93b7826b9d037841e86240108ca866b8007414c`.
- Chỉ recreate app qua đúng 5 file Compose đang dùng, `--no-deps --no-build --pull never`; đã so sánh các biến môi trường Compose với app cũ trước khi cập nhật, không có khác biệt.
- App healthy, `/health` trả 200, `database: connected`.
- GET danh sách và POST thử lại không đăng nhập đều trả 401, xác nhận các endpoint mới đã được đăng ký và yêu cầu xác thực. Chưa kiểm tra giao diện bằng phiên đăng nhập của người dùng.
- DB/MinIO/backup giữ nguyên cả ID container và thời điểm khởi động.
- CHƯA chủ động đưa lại 28 lượt cũ vào hàng đợi; không thay ngân sách hoặc ngưỡng bảo vệ tài nguyên.

Người dùng nhấn “Làm mới danh sách” trong khung đã mở (hoặc tải lại trang), rồi chọn từng lượt thử lại khi đủ tài nguyên và hạn mức. Việc mở lại hàng đợi không bảo đảm lượt đó sẽ phân tích thành công.

Rollback: đổi image trong overlay cuối về `zl-crm-app:aiqc-library-ui-20261112`, rồi dùng cùng 5 file Compose và `up -d --no-deps --no-build --pull never --wait app`. Không rollback dữ liệu hoặc restart các service khác.
