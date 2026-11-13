# Ràng buộc chức năng theo quyền — 03/11/2026

Trạng thái: đã sửa mã nguồn và build ứng viên; **chưa triển khai lên CRM đang chạy**.

## Hành vi sau thay đổi

- Menu desktop, menu điện thoại, tìm kiếm cài đặt và URL trực tiếp dùng chung chính sách quyền.
- Người dùng thiếu quyền không thấy mục chức năng. Nhập URL trực tiếp nhận trang không có quyền; không được đưa về một Dashboard mà họ cũng không có quyền xem.
- Khi mở trang cần đăng nhập, frontend tải lại hồ sơ hiện tại trước khi cho truy cập. Backend đọc quyền hiện tại ở mỗi yêu cầu; không tin ma trận quyền do trình duyệt gửi.
- Mỗi hành động cần `resource.access` và đúng ô hành động. Tắt Truy cập thì các ô thêm/sửa/xóa còn tích cũng không có hiệu lực. Bot Auto vẫn cần công tắc tổng và quyền chức năng con.
- Lớp bảo vệ API được gắn trước khi đăng ký các module. API v1 chưa được ánh xạ quyền mặc định bị từ chối; đăng nhập, thiết lập ban đầu, hồ sơ cá nhân, PIN và các webhook/callback đã có cơ chế xác thực riêng giữ cơ chế đó.
- API đọc cây nhóm quyền, metadata và chi tiết nhóm yêu cầu `permission_group.access`. Quyền sửa người dùng không đủ để gán vai trò/nhóm quyền: còn cần `permission_group.edit`.
- Trang Phân quyền ẩn nút thêm/xóa/chỉnh sửa theo từng quyền; người chỉ có Truy cập chỉ xem ma trận.
- Dữ liệu thời gian thực qua adapter Socket.IO được kiểm tra lại theo chức năng, tổ chức và nick được phép xem, kể cả các broadcast cũ gửi toàn server. Nick riêng tư không phát nội dung thô qua socket thiếu ngữ cảnh PIN; sự kiện không phân loại được bị bỏ qua.
- Packet typing gửi từ client cần quyền sửa hội thoại và đúng phạm vi nick.
- Quyền chủ tổ chức (`owner`) hiện có được giữ làm tài khoản quản trị toàn quyền. Role `admin` không được tự vượt qua ma trận quyền module.

## Các ô mới

### Quyền xóa dữ liệu khách hàng

Ô **Xóa dữ liệu khách hàng (chỉ Admin/Owner)** (`contact_data_purge.access`) điều khiển riêng màn hình **Cài đặt → Tổ chức → Xóa dữ liệu khách hàng** (`/settings/org/data-purge`) và toàn bộ API `/api/v1/admin/contact-purge/*` (targets, preview, execute, resume).

- Owner giữ toàn quyền hiện có. Admin cần được cấp ô quyền này trong nhóm quyền đang hoạt động.
- Các vai trò khác bị từ chối ở frontend và hàm kiểm tra quyền backend, kể cả khi JSON grants được tích nhầm. Route vẫn kiểm tra role admin/owner độc lập.
- `settings.access` hoặc `contact.delete` không tự mở chức năng này. Admin được cấp riêng quyền xóa dữ liệu không cần quyền xem toàn bộ cài đặt.
- Quyền này áp dụng cho chức năng dọn dữ liệu đồng bộ theo nhân viên/nick đã có; không thay đổi quyền xóa từng hồ sơ khách (`contact.delete`) hay mở rộng phạm vi dữ liệu được xóa.
- Không thay đổi logic xóa, phạm vi tổ chức, xem trước và bước nhập email xác nhận. Không xóa dữ liệu thật trong tác vụ cập nhật quyền.
- Nhóm Admin đã tồn tại chưa tự được ghi thêm quyền. Owner có thể vào Phân quyền để tích ô Truy cập. Không cần migration database.

### Các màn hình khác

`dashboard` (Tổng quan), `appointment` (Lịch hẹn), `report` (Báo cáo), `analytics` (Phân tích), `automation` (Rules & Templates cũ), `group` (Nhóm Zalo), `integration` (Tích hợp/Facebook), `ai_assistant` (Trợ lý AI).

Quyền được lưu trong JSON hiện có, không thêm bảng và không cần migration. Không tự ghi lại quyền của nhóm/người dùng đang tồn tại. Nhóm cũ chưa có ô mới sẽ bị từ chối ở chức năng tương ứng. Chủ tổ chức mở **Cài đặt → Phân quyền**, chọn nhóm và tích các ô cần dùng. Cấp quyền nick riêng khi cần; quyền module không thay thế quyền đối tượng hiện có.

## Luồng dùng chung và giới hạn cần biết

- Endpoint danh sách nick cơ bản là bộ chọn nick có scope dùng trong chat/bạn bè/nhóm. Các quyền đó chỉ được đọc danh sách cơ bản; trang quản trị nick, danh sách enriched, credentials và thao tác quản lý vẫn cần `zalo_account`.
- Đọc từ điển trạng thái/tag cần cho trình biên tập khách và chat được cho phép trong ngữ cảnh tương ứng; sửa từ điển vẫn cần quyền cài đặt.
- Tìm kiếm toàn cục và chuông thông báo cũ tổng hợp nhiều loại dữ liệu. Bản này chỉ hiện/cho gọi chúng khi người dùng có đủ quyền cho mọi nhóm dữ liệu trả về, bao gồm quyền xem tất cả. Người chỉ có một chức năng dùng tìm kiếm ngay trong màn hình được cấp; không mở rộng quyền để dùng tìm kiếm toàn cục.
- API tích hợp dùng API key và webhook có xác thực riêng, không phải phiên người dùng giao diện; bản này không chuyển chúng sang JWT. Không chia sẻ API key với nhân viên để thay thế quyền đăng nhập.
- Adapter mới là in-memory, tương ứng cách chạy hiện tại. Triển khai đa tiến trình/Redis adapter cần tích hợp cùng kiểm tra quyền trước khi dùng. Broadcast được xếp hàng để giữ thứ tự; hàng đợi vượt 2.000 sự kiện sẽ bỏ sự kiện thay vì bỏ kiểm tra quyền. Chưa kiểm thử tải cao.
- Không có thử nghiệm đăng nhập nhiều người trên CRM thật, không gửi tin Zalo thật, không sửa dữ liệu khách hay nhóm quyền thật trong tác vụ này. Các kiểm thử quyền dùng dữ liệu/mocks cô lập; không phải chứng nhận toàn bộ logic scope trong các module cũ.

## Kiểm chứng

- 241 kiểm thử backend đạt: lớp quyền mới, quyền xóa dữ liệu chỉ admin/owner, logic purge hiện có, thu hồi quyền, chặn tự gán quyền, adapter thời gian thực (gồm đổi tổ chức/vai trò của phiên đã kết nối), Bot Auto và các kiểm thử hồi quy xác thực/user/socket liên quan.
- 9 kiểm thử frontend đạt: menu desktop, tab mobile và tìm kiếm cài đặt không lộ module thiếu quyền; kiểm tra store quyền thực tế cho owner/admin/member và quyền xóa dữ liệu riêng. SSR không thay thế kiểm thử click trình duyệt thật.
- TypeScript backend và vue-tsc frontend đạt; backend compile và frontend production build đạt. Vite còn cảnh báo chunk lớn của ứng dụng hiện tại.
- Rà AST các route v1 khai báo tĩnh; API sinh động trong AI QC dùng cùng prefix guard và vẫn giữ kiểm tra từng hành động của module.
- GitNexus CLI local đã được dùng để query/impact trước khi sửa. FTS không có sẵn và kết quả graph rất rộng/có tên trùng, nên đã đối chiếu thêm caller/import, router và các hook đăng ký bằng mã nguồn. Không coi số đếm rộng của graph là đánh giá chính xác từng caller.

Artifacts: `C:\Zalo CRM\rbac-strict-release-20261103`; baseline các tệp có sẵn đã lưu trước sửa ở `C:\Zalo CRM\rbac-strict-baseline-20261103`. Repo đã có nhiều thay đổi từ tác vụ trước; không reset, commit hoặc gom chúng thành một release được tuyên bố sẵn sàng triển khai. Khi triển khai cần so sánh với image thực tế, giữ cấu hình runtime hiện hành và chuẩn bị rollback ứng dụng; không chạy db push/migration cho thay đổi này.
