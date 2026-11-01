# Soạn và gửi từ CRM: Đăng nhóm / Chào hàng

## Sử dụng

Vào **Đăng bài → Đăng nhóm** hoặc **Đăng bài → Chào hàng**.

1. Chọn nick công việc đang kết nối, thuộc quyền sở hữu/quyền chat của người dùng.
2. Tìm và chọn tối đa 50 nhóm hoặc khách. Nhóm phải có hội thoại đã đồng bộ;
   khách phải có quan hệ bạn bè `accepted` với nick gửi và thuộc phạm vi truy cập.
3. Nhập nội dung tối đa 2.000 ký tự và/hoặc tối đa 10 URL ảnh HTTPS công khai,
   mỗi dòng một URL. Không hỗ trợ tải file từ máy tính trong revision này.
4. Chọn khoảng nghỉ 10–300 giây giữa hai người nhận.
5. Bấm **Xem lại và gửi**, kiểm tra nick, người nhận, nội dung và ảnh;
   tích xác nhận, sau đó bấm **Xác nhận gửi**.
6. Theo dõi **20 lượt gửi gần nhất từ CRM**, mở **Chi tiết** để xem từng người nhận.
   **Dừng lượt gửi** bỏ qua các mục chưa gửi, không thu hồi tin đã gửi.

Nhật ký BOT cũ vẫn nằm bên dưới, dùng API và bảng cũ. Lượt gửi từ CRM được lưu
riêng, không tạo job ID giả cho BOT, không thay đổi writer cũ.

## Kích hoạt: cần chuẩn bị database và triển khai riêng

Mặc định `CRM_MANUAL_POSTING_ENABLED` không được đặt hoặc khác `true`: API gửi
không nhận job, worker không chạy. UI hiển thị thông báo chưa kích hoạt.
Đây là biến cấu hình **backend**, không phải biến Vite.

Hai bảng mới được mô tả trong `backend/prisma/schema/manual-posting.prisma`.
Migration cần review riêng:
`backend/prisma/migrations/20261031180000_manual_posting/migration.sql`.

Quy trình deploy và tiếp nhận database đã có bảng: [manual-posting-database-deploy.md](manual-posting-database-deploy.md).
Sử dụng runner riêng `scripts/manual-posting-migrate.cjs`; không chạy migration toàn
thư mục. Manifest checksum nằm tại `backend/prisma/manual-posting-release.json`.

Ở bước viết mã ban đầu, migration và cờ chưa được áp dụng. Trạng thái triển khai
được ghi riêng ở mục cuối tài liệu. Không chạy
`prisma db push` hoặc chạy toàn bộ migration chờ một cách tự động: lịch sử database
cũ chưa được baseline đầy đủ. Người vận hành cần sao lưu, đối chiếu lịch sử
migration và chọn quy trình áp dụng riêng migration mới, rồi kiểm chứng môi trường
thử nghiệm trước khi bật cờ. Sinh Prisma client/build thuộc bước chuẩn bị triển khai.
Không đưa mật khẩu, token hay cookie vào cấu hình frontend.

## Lưu trữ và độ tin cậy

- Job cùng danh sách người nhận được lưu transaction trước khi xếp hàng gửi.
- Khóa duy nhất `(org_id, created_by_id, request_id)` và fingerprint ngăn tạo
  job trùng khi trình duyệt thử lại cùng yêu cầu. Nội dung khác cùng ID trả 409.
- UI đóng băng yêu cầu khi chưa nhận được phản hồi. Bấm thử lại giữ cùng ID.
  Không có tự động POST lại. Không rời trang/tải lại khi chưa rõ kết quả;
  kiểm tra nhật ký và Zalo trước khi chủ động tạo lượt mới.
- Worker ghi `SENDING` trước khi gọi SDK, mỗi người nhận tối đa một lần gọi.
  Không dùng wrapper tự retry. Lỗi/timeout SDK trả `UNKNOWN`, dừng các mục còn lại;
  không suy ra gửi thất bại và không tự gửi lại.
- SDK hoàn tất → `SENT`; không phải bằng chứng đã nhận hoặc đã đọc.
  SDK có thể gửi một album thành nhiều bước; một lần gọi không bảo đảm một bước mạng.
- Mất tiến trình/lease hết hạn → `UNKNOWN`, các mục chưa gửi → `SKIPPED`.
  Lease 10 phút bao phủ thời gian tải ảnh, khoảng nghỉ tối đa và timeout SDK.
- Hủy và kết quả đến muộn dùng cập nhật có điều kiện để không ghi đè trạng thái
  đã hủy/đối soát. Một lệnh SDK đã bắt đầu vẫn có thể hoàn thành sau khi hủy.
- File ảnh tạm nằm trong thư mục riêng `zalocrm-manual-posting/job-*` dưới
  thư mục tạm của hệ điều hành. SDK timeout thì chờ promise kết thúc mới dọn ảnh.
  Nếu SDK không kết thúc hoặc tiến trình bị tắt cưỡng bức, có thể còn ảnh tạm;
  người vận hành chỉ dọn thư mục job đã xác minh không còn dùng.

## Bảo mật và giới hạn

### Quyền Đăng bài

Vào **Cài đặt → Phân quyền**, chọn nhóm nhân viên và bật ô **Truy cập** tại dòng
**Đăng bài (Đăng nhóm / Chào hàng)**, rồi lưu. Quyền JSON là `posting.access`.
Đây là một quyền chung cho cả hai trang, bao gồm xem nhật ký, soạn/gửi và dừng
lượt gửi thuộc phạm vi đang được phép. Nó không cấp thêm quyền với nick hay khách.

Nhóm hiện có không tự được cấp quyền mới. Không cần schema migration vì quyền
được lưu trong JSON grants hiện có. Owner giữ cơ chế bypass hiện có của hệ thống;
các role khác, kể cả admin, cần có grant trong nhóm quyền đang hoạt động.

Menu ẩn và URL hai trang bị chặn khi thiếu quyền. Backend kiểm tra grant trên
tất cả API manual-posting và API JWT đọc nhật ký BOT. Worker đọc lại quyền trước
mỗi người nhận, nên thu hồi quyền sẽ dừng các mục chưa bắt đầu gửi; không thể
thu hồi một lệnh SDK đã bắt đầu. API key/webhook tích hợp BOT không bị thay đổi
bởi quyền giao diện này. Sau khi đổi quyền, người dùng cần tải lại hồ sơ/đăng nhập
lại để menu cập nhật; API và worker không phụ thuộc bản grants đã cache ở browser.

Tất cả API `/api/v1/manual-posting/*` yêu cầu đăng nhập còn hiệu lực.
Org lấy từ session; actor lấy từ user đã xác thực. Nick cá nhân `privacyMode=main`
không xuất hiện. Không nhận UID Zalo tùy ý từ trình duyệt: server tự giải ID
Conversation/Friend đúng org, nick, scope và policy hiện tại.

Worker kiểm tra lại user đang hoạt động, nick và quyền người nhận trước mỗi lần gửi.
Policy bổ sung có thể cần request context; nếu không đánh giá được trong background,
job dừng, không bỏ qua policy. Cần kiểm chứng tích hợp nếu triển khai edition có
policy dựa vào HTTP request/OTP. Người dùng thường chỉ xem/hủy lượt mình tạo;
owner/admin vẫn phải có quyền truy cập nick và người nhận.

Ảnh: chỉ HTTPS public, kiểm tra tất cả DNS answers, pin IP, cấm redirect,
giới hạn 25 MB/ảnh, tổng 50 MB; chỉ JPEG/PNG/WebP/GIF theo MIME.
Không ghi raw lỗi SDK, cookie hoặc URL ảnh vào log hệ thống. Nội dung/URL ảnh được
lưu trong job để theo dõi; cần dùng URL public không mang credentials nhạy cảm.

Giới hạn gửi toàn ứng dụng dùng rate limiter hiện có. Rate limiter hiện tại có
nhánh fail-open và có thể chỉ lưu trong bộ nhớ nếu không cấu hình Redis;
chức năng này không thay đổi hợp đồng đó và không bảo đảm quota toàn cụm tuyệt đối.
Zalo có thể giới hạn tài khoản; khoảng nghỉ không bảo đảm tránh giới hạn nền tảng.

## Bằng chứng tác vụ

Phân tích tĩnh import/caller theo ngoại lệ GitNexus được chủ dự án duyệt cho
phạm vi soạn/gửi. Không sửa Auth/RBAC, BOT cũ, Cloudflare hoặc writer cũ.
Không chạy unit/integration/browser test, typecheck hay build theo yêu cầu trước
của chủ dự án. Kiểm tra cú pháp tĩnh và whitespace không thay thế các bước đó.
Không gửi tin thật, không gọi API Zalo/OpenAI, không kết nối database trong tác vụ.
Chức năng cần kiểm chứng trên môi trường cô lập trước khi đưa vào sử dụng thật.

## Release được chủ dự án cho phép ngày 01/11/2026

Đã build backend/frontend, sao lưu database (custom archive, SHA-256 trong evidence)
và snapshot container trước khi cập nhật. Bản cập nhật dùng dependency hiện có đã
đối chiếu phiên bản, build image offline; chỉ container app được tạo lại.

Đã áp dụng riêng SQL tạo hai bảng manual posting trong transaction. Database không
có `_prisma_migrations`, vì vậy không tạo lịch sử migration giả. Việc áp dụng được
theo dõi bằng `../manual-posting-release-20261101/evidence.json` tính từ repository
root, gồm hash migration và backup. Trước khi dùng Prisma migration về sau phải
đối chiếu baseline thực tế, không chạy lại SQL này hoặc toàn bộ migration chờ.

`docker-compose.override.yml` giữ image release và cờ bật cho lần chạy Compose
mặc định sau. Image cũ có lệnh tự `db push`; image mới đã loại bỏ hành vi này.
Rollback recipe nằm trong thư mục release, dùng snapshot cũ với command chạy Node
trực tiếp, không chạy lại `db push`. Rollback app giữ nguyên hai bảng bổ sung;
không tự drop bảng hoặc restore toàn bộ database đang có dữ liệu mới.

Kết quả kiểm tra sau cập nhật: Docker `healthy`, HTTP health xác nhận database
connected, hai bảng mới tồn tại, route mới yêu cầu đăng nhập (401 thay cho 404),
cờ gửi từ CRM đã bật, chưa có job gửi ở thời điểm kiểm tra. Không gửi tin thật.
Không thực hiện kiểm thử gửi end-to-end bằng tài khoản thật. Không truy cập được
Vite 5173 từ tiến trình kiểm chứng; giao diện đăng nhập cần được kiểm tra lại trên
trình duyệt của người dùng.
