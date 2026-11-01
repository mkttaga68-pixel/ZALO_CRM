# Deploy database cho Đăng bài

Áp dụng cho **CRM hiện có** với PostgreSQL và đúng schema gốc đã vận hành.
Không phải bộ khởi tạo toàn bộ CRM trên database rỗng.

## Artifact và phạm vi

- Schema: `backend/prisma/schema/manual-posting.prisma`.
- SQL bất biến: `20261031180000_manual_posting/migration.sql`.
- SHA-256: `0e3af34b6145a7f586d3a89109b6bde547792b8dde0d45ced72685a695544b84`.
- Manifest: `backend/prisma/manual-posting-release.json`.
- Runner: `scripts/manual-posting-migrate.cjs`.
- Chỉ hai bảng `manual_posting_jobs`, `manual_posting_recipients` và một bản ghi
  lịch sử của migration này; tạo bảng `_prisma_migrations` chuẩn nếu chưa có.
- Quyền `posting.access` dùng JSON grants hiện có. Không có migration phân quyền
  và không tự bật quyền cho nhân viên.

Giữ nguyên SQL đã từng deploy; không sửa checksum để che drift. Schema Prisma
khai báo rõ `onUpdate: NoAction`, khớp FK thực tế của SQL đã áp dụng.

**Không chạy `prisma db push`, `prisma migrate deploy`, `prisma migrate dev` hoặc
`migrate resolve` cho toàn thư mục trong release này.** Lịch sử database cũ có thể
được tạo bằng db push; các migration lịch sử khác vẫn chưa được baseline.
Runner riêng không thực thi hoặc đánh dấu hoàn thành bất kỳ migration cũ nào.

Năm file schema và năm migration AI QC dư đã được gỡ sau khi đối chiếu database:
12 bảng AI QC không tồn tại và không có lịch sử migration tương ứng. Đây là dọn
artifact chưa áp dụng, không phải đã chạy DROP TABLE hay baseline lịch sử CRM.

## Các trạng thái

| Trạng thái | Exit | Xử lý |
| --- | --- | --- |
| `ARTIFACT_VERIFIED` | 0 | Checksum SQL khớp manifest, chưa kết nối DB |
| `PENDING_NEW_TABLES` | 2 | Chưa có hai bảng; cần apply có backup |
| `UNTRACKED_EXISTING_REQUIRES_ADOPTION` | 2 | Đã có hai bảng, cấu trúc khớp, chưa có lịch sử; cần explicit adoption |
| `UP_TO_DATE` | 0 | Cấu trúc và checksum lịch sử đều khớp |
| `APPLIED` | 0 | Tạo hai bảng và ghi lịch sử trong một transaction |
| `ADOPTED_VERIFIED_EXISTING` | 0 | Giữ dữ liệu/bảng hiện có, chỉ ghi lịch sử sau khi cấu trúc khớp |
| `ALREADY_APPLIED` | 0 | Apply lặp lại, không tạo bảng/hàng lịch sử trùng |
| `BLOCKED` | 1 | Dừng; xem mã lỗi, không tự sửa hoặc drop bảng |

Runner kiểm tra column/type/nullability/default, primary key, unique, check
constraints, FK org/job, index bắt buộc, index readiness và RLS. Chỉ có một bảng,
checksum khác, history chưa hoàn tất hoặc schema drift đều dừng. Không dùng
`CREATE TABLE IF NOT EXISTS` để bỏ qua cấu trúc sai của bảng nghiệp vụ.

## Chuẩn bị trên Windows

Chạy từ repository root, không in `.env` hoặc connection string:

```powershell
node scripts/manual-posting-migrate.cjs --artifact-check
docker compose build app
```

Image mới phải chứa runner, manifest và SQL. Build không chạy migration. Giữ
image/app trước deploy để rollback. Quy trình bên dưới chỉ khởi chạy Node runner,
không khởi động app hay worker trong container migration.

## Sao lưu PostgreSQL hiện tại

```powershell
$backupDir = Join-Path (Split-Path (Get-Location).Path -Parent) ('posting-db-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupDir | Out-Null
docker cp scripts/manual-posting-backup.sh zalo-crm-db:/tmp/manual-posting-backup.sh
if ($LASTEXITCODE -ne 0) { throw 'Copy backup helper failed' }
$dumpPath = docker exec zalo-crm-db sh /tmp/manual-posting-backup.sh
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed' }
$dumpPath = $dumpPath.Trim()
if ($dumpPath -notmatch '^/tmp/manual-posting-[0-9TZ-]+\.dump$') { throw 'Unexpected backup path' }
docker cp "zalo-crm-db:$dumpPath" (Join-Path $backupDir 'before.dump')
if ($LASTEXITCODE -ne 0) { throw 'Copy database backup failed' }
$backupHash = (Get-FileHash -LiteralPath (Join-Path $backupDir 'before.dump') -Algorithm SHA256).Hash.ToLowerInvariant()
```

Backup chứa dữ liệu thật: lưu ngoài Git, giới hạn quyền truy cập và không gửi vào
log/chat. Helper kiểm tra archive có thể liệt kê bằng `pg_restore`; chưa phải bằng
chứng restore thành công. Người vận hành phải xác nhận backup mới và đúng database
target; runner chỉ chứng minh file đọc được, header `PGDMP` và SHA-256 khớp.

## Kiểm tra chỉ đọc trước apply

```powershell
docker compose run --rm --no-deps --entrypoint node app scripts/manual-posting-migrate.cjs --check
if ($LASTEXITCODE -notin @(0, 2)) { throw 'Database preflight blocked' }
```

Database đang chạy đã được tạo hai bảng bằng SQL trực tiếp ở lần deploy trước:
trạng thái dự kiến là `UNTRACKED_EXISTING_REQUIRES_ADOPTION`. Đây chỉ là dự kiến;
phải dùng kết quả check thực tế. Không tự coi bảng tồn tại là đã khớp schema.

## Apply riêng hoặc tiếp nhận bảng đã tồn tại

Trong giờ bảo trì, giữ backup và đảm bảo không có người tạo lượt gửi mới. Chạy:

```powershell
docker compose run --rm --no-deps --entrypoint node --volume "${backupDir}:/release-backups:ro" app scripts/manual-posting-migrate.cjs --apply --adopt-existing --backup-file /release-backups/before.dump --backup-sha256 $backupHash
if ($LASTEXITCODE -ne 0) { throw 'Migration blocked; do not continue deployment' }
docker compose run --rm --no-deps --entrypoint node app scripts/manual-posting-migrate.cjs --check
if ($LASTEXITCODE -ne 0) { throw 'Post-migration verification failed' }
```

`--adopt-existing` không bỏ qua kiểm tra: nếu cấu trúc khác thì dừng. Nếu chưa có
bảng, cùng lệnh tạo mới đúng SQL. Apply dùng advisory lock, lock timeout 5 giây,
transaction và lock hai bảng khi tiếp nhận; không tự retry khi lỗi.

Lưu output JSON của check/apply cùng hash backup trong hồ sơ release. Việc ghi
một migration vào `_prisma_migrations` **không** chứng minh các migration cũ đã áp
dụng và không cho phép chạy migrate deploy rộng sau đó.

## Cập nhật app và kiểm tra

```powershell
docker compose up -d --no-deps --no-build app
docker compose exec -T app node scripts/readiness-probe.cjs
```

Kiểm tra `/health` kết nối DB, đăng nhập bằng tài khoản được cấp `posting.access`,
mở Đăng nhóm/Chào hàng và kiểm tra menu/API. Không cần gửi tin thật để kiểm tra
schema/route. Cờ `CRM_MANUAL_POSTING_ENABLED` phải do cấu hình release quyết định.

## Windows backend không chạy Docker

Cấp `DATABASE_URL` qua cơ chế environment/secret injection đang dùng, không ghi
vào command history. Script cố ý không tự nạp `.env`:

```powershell
npm.cmd --prefix backend run db:posting:check
npm.cmd --prefix backend run db:posting:apply -- --adopt-existing --backup-file 'DUONG_DAN_BACKUP_MOI.dump' --backup-sha256 'SHA256_THUC_TE'
```

## Rollback và giới hạn

Lỗi apply trước COMMIT rollback cả DDL và history. Lỗi app sau migration: quay về
image app trước release và tắt cờ gửi; giữ hai bảng bổ sung cùng dữ liệu. Không tự
drop bảng hoặc restore cả database để sửa lỗi app. Restore cần quy trình riêng.
Không sửa/checksum lại migration đã ghi nhận. Drift cần được review và xử lý bằng
migration tiếp theo, không dùng runner này tự thay đổi dữ liệu hiện có.

Trong tác vụ chuẩn bị này chưa apply/adopt history lên database đang chạy.
