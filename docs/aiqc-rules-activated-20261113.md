# Quy tắc Obsidian được bổ sung — 13/11/2026

Theo yêu cầu thêm các quy tắc và câu trả lời của người dùng “Trong tầm 10p. Chăm sóc mỗi ngày”, đã cập nhật nguồn Obsidian và xuất bản qua Knowledge Registry. Không đổi ngân sách, không chạy model, không tạo tin nhắn CRM.

| Rule | Mục đích | Revision có hiệu lực | SLA | Chăm sóc |
|---|---|---:|---:|---:|
| UX-001 | Không xúc phạm | 1 | — | — |
| UX-002 | Lịch sự và đồng cảm | 1 | — | — |
| UX-003 | Xử lý khiếu nại | 1 | — | — |
| CSKH-002 | Yêu cầu chưa giải quyết | 3 | 600 giây | — |
| SLA-001 | Định nghĩa chỉ số phản hồi | 3 | 600 giây | — |
| SLA-002 | Ngưỡng phản hồi | 3 | 600 giây | — |
| SP-001 | Nguyên tắc tư vấn sản phẩm | 1 | — | — |
| CSKH-001 | Chăm sóc sau mua | 2 | 600 giây cho yêu cầu phản hồi liên quan | 1 ngày |

- Ngưỡng phản hồi thống nhất 600 giây trên các quy tắc UNRESOLVED_REQUEST, tránh mất ngưỡng khi retrieval chọn một tài liệu khác cùng nhóm.
- Clock được giữ theo engine hiện tại: BUSINESS_HOURS, chỉ cộng thời gian trong lịch làm việc đã xác minh. Phiên bản nguồn ghi WALL_CLOCK ban đầu đã được thay bằng revision 3 cho các tài liệu SLA liên quan; revision cũ được giữ để đối soát, không còn là phiên bản có hiệu lực.
- Chu kỳ chăm sóc là 24 giờ kể từ lần chăm sóc chủ động xác minh gần nhất hoặc ngày mua đã xác minh nếu chưa có hoạt động. Lịch 3/7/12/17/21 được thay bằng lịch hằng ngày.
- Cập nhật 4 file chính sách trong vault và checksum tương ứng ở `00_BAT_DAU/MANIFEST_SHA256.md`. Nội dung mới được sync rồi publish theo hash/revision; không sửa bản đã duyệt tại chỗ.
- Quyết định được audit dưới danh tính kỹ thuật `operator:codex-user-request`, không tự điền hoặc giả danh chữ ký cá nhân.

## Xác minh

8 rule có hiệu lực, đủ 4 loại phân tích; hash của mỗi phiên bản khớp file nguồn; mọi citation thử truy xuất đều hợp lệ. Kiểm tra thuần trong bộ nhớ: 9 phút chưa quá hạn, 11 phút đủ điều kiện quá hạn, chỉ có 5 phút làm việc trong 11 phút thực tế thì chưa quá hạn; chăm sóc 23 giờ chưa quá hạn, 25 giờ quá hạn với chu kỳ 1 ngày. Không lưu dữ liệu thử vào CRM và không gọi model.

## Phần chưa thể tự động áp dụng

- SP-002: hồ sơ sản phẩm thực tế còn trống. SP-001 chỉ là nguyên tắc chung, không cung cấp thành phần/giá/công dụng để đối chiếu từng SKU.
- CA-001/CA-002 và cảnh báo chăm sóc: cần nguồn lịch nghỉ/ca trực, đơn hàng, lịch sử chăm sóc và phân công/bàn giao xác minh. API care hiện chưa nối các nguồn này; việc đăng ký chu kỳ 1 ngày không tự tạo cảnh báo chăm sóc khi thiếu dữ liệu.
- Các file hướng dẫn, manifest, quy trình duyệt, quản trị AI và ví dụ tham khảo vẫn có trong thư viện; không gán chúng thành một trong bốn loại lỗi nhân viên khi không phù hợp.
- Không tự đổi toàn bộ tài liệu/bản nháp thành quy tắc thực thi. UI có thể giữ nhiều revision APPROVED để tra lịch sử; số quy tắc có hiệu lực tính theo bản thắng trên timeline, không phải đếm mọi revision đã được duyệt.
