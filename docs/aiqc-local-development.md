# AI QC chạy local từ mã nguồn

Từ `C:\Zalo CRM\ZL-CRM`, chạy:

```powershell
.\AI-QC-LOCAL.cmd
# Hoặc: node scripts/aiqc-local.cjs start
```

Mở `http://localhost:5173/ai-quality-control`. Cổng backend là `3091`; database synthetic đã xác minh là `59941`. Launcher dùng lại tài khoản, Vault fixture, rules và warning đã kiểm thử; không tạo lại dữ liệu mỗi lần chạy. Email synthetic hiện tại và đường dẫn file mật khẩu được in khi start/status; mật khẩu không in ra terminal. Tài khoản E2E riêng có warning mẫu, tài khoản synthetic ban đầu thuộc tổ chức khác.

Frontend chạy Vite/HMR: sửa Vue/CSS/TypeScript frontend sẽ tự cập nhật. Backend chạy trực tiếp `backend/src/app.ts` bằng tsx + Node watch, tự restart khi file trong `backend/src` thay đổi; không cần build lại sau mỗi lần sửa backend. Khóa phiên synthetic được giữ trong process supervisor qua các lần hot reload; sau restart toàn bộ launcher có thể cần đăng nhập lại.

```powershell
.\AI-QC-LOCAL.cmd status
.\AI-QC-LOCAL.cmd restart
.\AI-QC-LOCAL.cmd stop
.\AI-QC-LOCAL.cmd build
```

`start` là idempotent khi local source-watch đang chạy. `restart` chỉ thay process app local đã xác minh; `stop` giữ nguyên PostgreSQL và mọi dữ liệu synthetic. Nếu database đã dừng sau khi reboot máy, launcher báo lỗi kết nối và không tự tạo cluster/database hay chạy migration; cần khởi động lại đúng cluster sandbox đã ghi nhận trước. Cổng đang do process không nhận diện được chiếm sẽ bị từ chối thay thế.

Log/cache/build nằm ở `C:\Zalo CRM\native-ai-qc-runtime\mvxj0im3\local-dev`. Backend watcher và frontend chạy nền ẩn; lệnh status cho biết tình trạng. Nếu hệ thống chặn quyền đọc thông tin process/CIM, launcher dừng kiểm tra thay vì đoán PID.

`build` kiểm tra TypeScript/backend/frontend và tạo frontend artifact trong `local-dev/build/frontend-default-off` với flags OFF. Đây là bước chuẩn bị build; không build/thay image Docker, deploy, publish hoặc migrate database. Việc đưa tính năng vào CRM Docker/production vẫn là một release riêng có scope được duyệt.

Môi trường local chỉ dùng synthetic: OpenAI, dữ liệu CRM thật, Zalo outbound đều bị khóa bằng guard trước khi import app. Không nạp `.env` production. Vite cache riêng, proxy cố định 3091, không trỏ 3080. Launcher không gọi Docker/Compose và không đụng Cloudflare, production database/container/volume. Không dùng `docker-compose.dev.yml` như thay thế launcher này: compose dev hiện khai báo cổng 5433, trùng cổng PostgreSQL production trên máy.

Đã kiểm tra thực tế: start/restart dùng source-watch thành công; frontend và backend trả 200. Chạm mtime source (không đổi nội dung) làm backend tự khởi động lại từ PID 24760 sang 14884; token synthetic vẫn hợp lệ qua lần reload, proxy trả 200 và 2 warnings được giữ nguyên. Bằng chứng tại `local-dev/source-watch-evidence.json`. Không dùng tài khoản production.

Lệnh `AI-QC-LOCAL.cmd build` cũng đã chạy thành công: backend TypeScript, frontend vue-tsc và Vite build đều đạt. Artifact frontend giữ flags OFF; cảnh báo chunk lớn hiện có vẫn còn, không chặn build.
