# CRM TAG ADDED → BOT-AUTO TRIGGER → SEQUENCE → ZALO MESSAGE

Bàn giao tính năng, ngày 2026-10-25. Nhánh `main`, chưa commit, **chưa apply migration, chưa deploy**.

Nghiệp vụ: nhân viên gắn Tag CRM cho 1 khách → hệ thống tự đưa **đúng khách đó** vào Sequence
tương ứng. Ví dụ: tag `Chăm sóc KH ngày 1` → event `crm_tag_added` → sequence `CSKH - Ngày 1`.

---

## A. Báo cáo audit source gốc

Codebase **đã có gần đủ** hạ tầng. Phần viết mới rất nhỏ so với phần tái sử dụng.

### Tái sử dụng nguyên trạng (không sửa)

| Thành phần | File | Vai trò trong tính năng này |
|---|---|---|
| Trigger dispatcher | `backend/src/modules/automation/engine/campaign-materializer.ts` | Chọn trigger theo `(orgId, eventType, enabled)`, lọc `eventFilter` vs `payload`, tạo Campaign + Task. **Khi event có `contactId` thì `resolveSegmentContactIds` trả về đúng `[contactId]` đó và KHÔNG query segment** → không thể gửi lan sang khách khác cùng tag. |
| Sequence enrollment | cùng file trên, nhánh `bindingKind === 'sequence'` | Dedupe theo `findFirst({campaignId, contactId})` |
| Worker gửi tin | `engine/task-worker.ts` | Atomic claim `updateMany WHERE state='queued'`, lease recovery 5′, backoff `[1,5,15,60,240]`′, `MAX_ATTEMPT_COUNT=5` |
| Gates | `engine/gate-evaluator.ts` | hour range `[6,22]`, per-nick throttle, daily cap, stop-on-accept, cross-nick recency |
| Gửi Zalo | `engine/action-handlers/send-message.ts` | SDK thật + `AUTOMATION_STUB_MODE=true` để test |
| Timeline KH | `ActivityLog` + `GET /customers/:id/timeline` | Đã log `tag_add_crm` / `tag_remove_crm` |
| Catalog UI | `frontend/src/views/automation/TriggersView.vue` | Tab Catalog render từ `TRIGGER_CATALOG` của backend; nút "Khởi tạo" đã mặc định `enabled: false` |

### Phát hiện quyết định thiết kế

1. **Không có bảng mapping contact-tag.** `Contact.tags` là `Json` array **tên tag**
   (`schema.prisma:326`); `Friend.crmTagsPerNick` là array tên per-nick (`:1296`).
   → "chưa gắn → đã gắn" **chỉ biết được bằng diff array**, và `crmTagId` phải resolve
   qua unique `CrmTag(orgId, name)`.

2. **Sequence advance tạo task row MỚI cùng `(campaignId, contactId)`**
   (`task-worker.ts` → `markDoneAndAdvance`). → **tuyệt đối không được** thêm
   `@@unique([campaignId, contactId])` vào `automation_tasks`; chống trùng phải nằm ở bảng khác.

3. **Event bus là EventEmitter in-memory** (`engine/event-bus.ts`, `setImmediate`).
   Gắn tag xong mà process chết trước khi listener chạy là **mất event vĩnh viễn**.

4. **Engine chưa hề đọc `Contact.consentStatus`** — automation vẫn gửi cho khách đã opt-out.

5. **`nick-selector.ts` chưa dùng `ZaloAccountAccess`** và tự fallback sang nick khác.

6. **Không tồn tại chức năng gắn tag hàng loạt.** Chỉ có `PUT /contacts/:id/tags` (1 KH) và
   `PATCH /friends/:id` (1 cặp nick×KH). → Phase 5 item 4 (xác nhận khi gửi nhiều khách)
   **không áp dụng**; an toàn này là *cấu trúc*, không phải nhờ cảnh báo UI.

### Các đường ghi tag KHÔNG được sinh event (đã kiểm tra từng đường)

| Đường | File | Ghi vào | Có sinh event? |
|---|---|---|---|
| Nhân viên gắn tag cấp KH | `contacts/contact-routes.ts:566` | `Contact.tags` | **CÓ** — đường duy nhất |
| Nhân viên gắn tag per-nick | `contact-routes.ts:~938` | `Friend.crmTagsPerNick` | Không (ngoài phạm vi V1) |
| Đồng bộ Zalo Native | `zalo/zalo-labels-routes.ts:300` | `crmTagsPerNick` prefix `🔵 ` | Không |
| Rename / xoá tag | `contacts/crm-tag-routes.ts:187,225` | `Contact.tags` nhiều KH | Không |
| Merge KH | `contacts/merge-service.ts:82` | `Contact.tags` | Không |
| Public API ngoài | `api/public-api-routes.ts:297,326` | `Contact.tags` | Không |
| Backfill / import | `contacts/backfill-*.ts` | — | Không |

### Hạn chế của audit

`AGENTS.md` yêu cầu chạy `gitnexus_impact` trước khi sửa bất kỳ symbol. **GitNexus MCP server
không được nạp trong session làm việc này**, nên audit thực hiện bằng grep/read trực tiếp.
**Nên chạy `gitnexus_impact` trên 4 symbol sau trước khi merge**:
`pickNickForTask`, `processTask` (task-worker), `materializeFromEvent`, và handler
`PUT /api/v1/contacts/:id/tags`.

---

## B. Sơ đồ kiến trúc trước / sau

### Trước

```
PUT /contacts/:id/tags
  └─ prisma.contact.update({ tags })        ← 1 lệnh, không khoá dòng
  └─ logActivity(tag_add_crm)
  (hết — không có đường nào tới Bot-Auto)
```

### Sau

```
PUT /contacts/:id/tags
  │
  ├─ $transaction:                                    ← crm-tag-event-service.ts
  │    SELECT tags FROM contacts ... FOR UPDATE         (khoá dòng: chống race)
  │    added = nextTags \ oldTags                       (chỉ chuyển trạng thái mới)
  │    resolve tên tag → CrmTag.id                      (tag ngoài catalog → bỏ)
  │    UPDATE contacts.tags
  │    INSERT crm_tag_events (state='pending')          ← CÙNG transaction
  │  COMMIT
  │
  ├─ dispatchCrmTagEventsSoon()  (sau commit, fire-and-forget)
  │    │                                               ← crm-tag-dispatcher.ts
  │    ├─ claim atomic: pending → dispatching
  │    ├─ Gate 1  source = 'crm_manual'
  │    ├─ Gate 2  event ≤ 24h
  │    ├─ Gate 3  KH canonical (theo mergedInto)
  │    ├─ Gate 4  consentStatus ≠ 'revoked'            ← MỚI
  │    ├─ Gate 5  policy 'contact.view' cho actor      ← lớp 2
  │    ├─ Gate 6  trigger enabled + eventFilter.crmTagId khớp
  │    ├─ Gate 7  event.occurredAt ≥ trigger.createdAt  (không chạy tag lịch sử)
  │    │
  │    └─ materializeFromEvent()  ← DISPATCHER CÓ SẴN, gọi trực tiếp
  │         contactId = ĐÚNG 1 khách, không segmentHint
  │         → AutomationCampaign + AutomationTask
  │       state → done | skipped | failed | unknown
  │       logActivity(crm_tag_sequence_enrolled | _skipped)   → Timeline KH
  │
  └─ sweeper 60s (crm-tag-dispatcher)                  ← lớp bền
       pending bị bỏ sót (restart) → dispatch lại
       dispatching treo > 5′ → về pending
       attemptCount ≥ 3 → 'unknown', KHÔNG gửi lại

task-worker (CÓ SẴN, thêm 2 gate)
  ├─ checkConsent(actionType, consentStatus)           ← MỚI
  └─ pickNickForTask({ ..., nickPolicy })              ← MỚI
       mode 'fixed' → đúng nick đó hoặc BỎ QUA
       onBehalfOfUserId → nick phải trong ZaloAccountAccess (chat|admin)
  └─ gates cũ → send-message.ts → Zalo SDK
```

**Vì sao gọi `materializeFromEvent()` trực tiếp mà không `automationEventBus.emit()`:**
bus không trả kết quả (không ghi được "đã enroll mấy task" / "vì sao bỏ qua" như Phase 3
yêu cầu), và listener duy nhất của bus cũng chính là materializer — emit thêm là **enroll 2 lần**.

---

## C. Danh sách file đã sửa

### Backend — mới (3 file + 1 migration)

| File | Dòng | Nội dung |
|---|---|---|
| `backend/src/modules/contacts/crm-tag-event-service.ts` | 175 | Ghi tag + sinh event trong 1 transaction, `FOR UPDATE` |
| `backend/src/modules/automation/engine/crm-tag-dispatcher.ts` | 340 | Outbox worker: claim, 7 gate, materialize, sweeper |
| `backend/prisma/migrations/20261025100000_add_crm_tag_events/migration.sql` | 89 | 1 bảng mới + 3 index + 1 partial unique |

### Backend — sửa (11 file)

| File | Thay đổi |
|---|---|
| `backend/prisma/schema/schema.prisma` | `+model CrmTagEvent`; 4 back-relation vào `Organization`, `Contact`, `CrmTag`, `User` |
| `automation/triggers/types.ts` | `+'crm_tag_added'` vào union + `SUPPORTED_EVENT_TYPES` + 1 entry `TRIGGER_CATALOG` |
| `automation/sequences/types.ts` | `+SequenceRuntimeRules.nickPolicy` |
| `automation/engine/types.ts` | `+GateName 'consent_revoked'` |
| `automation/engine/gate-evaluator.ts` | `+checkConsent()` (pure) |
| `automation/engine/nick-selector.ts` | `+NickPolicy`, nhánh `mode:'fixed'`, `userMayUseNick()`, lọc quyền ở 2 nhánh auto |
| `automation/engine/task-worker.ts` | `+select consentStatus`, gate 2b consent, truyền `nickPolicy`, xử lý skip nick cố định |
| `automation/engine/index.ts` | `+startCrmTagEventSweeper()` |
| `activity/action-types.ts` | `+crm_tag_sequence_enrolled`, `+crm_tag_sequence_skipped` |
| `contacts/contact-routes.ts` | `PUT /contacts/:id/tags` dùng service + dispatch sau commit; response `+automation{}` |
| `contacts/contact-sub-resource-routes.ts` | `+GET /contacts/:id/crm-tag-events` (vết đầy đủ, read-only) |

### Backend — test (3 file mới + 1 sửa)

`tests/crm-tag-event-service.test.ts` (17), `tests/crm-tag-dispatcher.test.ts` (20),
`tests/crm-tag-nick-policy.test.ts` (16), `tests/trigger-types.test.ts` (+1).

### Frontend — sửa (5 file)

| File | Thay đổi |
|---|---|
| `api/automation/types.ts` | `+'crm_tag_added'` |
| `components/automation/phase7/design-tokens.ts` | `+icon mdi-tag-plus-outline` |
| `views/automation/TriggersView.vue` | Chọn Tag CRM kích hoạt, chính sách nick, **bảng tổng hợp 8 dòng**, validate trước khi lưu |
| `constants/activity-types.ts` | Label + icon 2 action mới |
| `components/chat/ActivityItem.vue` | Render 2 action mới trên Timeline KH |

**Không sửa** `TagCrmBar.vue` (UI gắn tag): không có thao tác nhiều khách nên không cần hộp xác nhận.

---

## D. Database migration

Một bảng mới duy nhất. **Không sửa, không xoá, không đổi kiểu cột nào đang có. Không backfill.**

```
backend/prisma/migrations/20261025100000_add_crm_tag_events/migration.sql
```

- `CREATE TABLE crm_tag_events` (16 cột)
- 4 FK: `org_id` / `contact_id` / `crm_tag_id` **CASCADE**, `actor_user_id` **SET NULL**
  (nhân viên nghỉ việc không được làm mất lịch sử)
- 3 index: `(state, occurred_at)` cho worker, `(contact_id, occurred_at DESC)` cho timeline,
  `(org_id, crm_tag_id, occurred_at DESC)` cho nghiệm thu
- 1 **partial unique** `uniq_crm_tag_event_inflight` trên `(contact_id, crm_tag_id)`
  `WHERE state IN ('pending','dispatching')` — tối đa 1 event đang bay cho mỗi cặp.
  **Không** unique trên `(contact_id, crm_tag_id)` trần, vì gỡ tag rồi gắn lại **là** một lần
  chuyển trạng thái mới và phải sinh event mới.

> **Prisma drift:** Prisma không hỗ trợ index có `WHERE`, nên partial unique chỉ sống trong
> migration SQL. `prisma migrate dev` về sau sẽ báo drift ở đúng index này — **giữ nguyên,
> đừng xoá**. Precedent sẵn trong repo: `20260522000000_rbac_partial_unique_leader_deputy`.

### ⚠ Cơ chế schema thật của production KHÔNG phải Prisma Migrate

Kiểm tra trên DB đang chạy:

- Bảng **`_prisma_migrations` KHÔNG tồn tại** → thư mục `migrations/` chưa bao giờ được track.
- `docker/Dockerfile:36` →
  `CMD ["sh","-c","npx prisma db push --url \"$DATABASE_URL\" && node dist/app.js"]`

Tức **mỗi lần container app start, schema được đồng bộ bằng `prisma db push` từ
`schema.prisma`**, không phải `migrate deploy`. Hệ quả:

1. File `migration.sql` ở trên **sẽ không tự được apply**. Nó giữ lại làm tài liệu DDL
   chính xác + căn cứ rollback + cho ai dùng `migrate` về sau. Đừng xoá.
2. **`db push` sẽ tự tạo bảng** từ `model CrmTagEvent` khi restart app.
3. **`db push` KHÔNG tạo được partial unique index** (Prisma không biểu diễn được) →
   `uniq_crm_tag_event_inflight` **phải apply tay 1 lần**. Thiếu nó thì mất lớp chặn
   trùng ở tầng DB (transaction + `FOR UPDATE` ở application layer vẫn còn).

### Đã verify: `db push` chỉ thêm bảng mới, không đụng gì đang chạy

```
prisma migrate diff --from-config-datasource --to-schema prisma/schema --script
```
chạy đối chiếu **DB production thật** với `schema.prisma` sau khi sửa, kết quả **duy nhất**:

```
CREATE TABLE "crm_tag_events" (...)
CREATE INDEX  crm_tag_events_state_occurred_at_idx
CREATE INDEX  crm_tag_events_contact_id_occurred_at_idx
CREATE INDEX  crm_tag_events_org_id_crm_tag_id_occurred_at_idx
ADD FOREIGN KEY × 4
```

**Không có một lệnh `ALTER` hay `DROP` nào** trên bảng đang có → rủi ro mất dữ liệu khi
deploy là **bằng không**, và **không cần** `--accept-data-loss`.

### Backup đã tạo và đã kiểm tra khôi phục

```
backups/pre-migration-crm-tag-events_20261025_171415.sql     384 KB, 73 bảng
```

Đã restore vào DB tạm `zalocrm_restore_check_20261025` và đối chiếu với DB thật:

| | DB thật | Bản restore |
|---|---|---|
| tables | 73 | 73 |
| contacts | 106 | 106 |
| messages | 25 | 25 |
| friends | 100 | 100 |
| crm_tags | 16 | 16 |

DB tạm **đã xoá**; chỉ còn `postgres` và `zalocrm`.

---

## E. Kết quả build / lint / test

| Hạng mục | Lệnh | Kết quả |
|---|---|---|
| Prisma schema | `prisma validate` | ✅ valid |
| Backend typecheck | `tsc --noEmit` | ✅ 0 lỗi |
| Frontend typecheck | `vue-tsc -b` | ✅ 0 lỗi |
| Backend test | `vitest run` | ✅ **560/560 pass, 43/43 file** |

Trong đó **53 test mới** cho tính năng này. Lần chạy đầu có 1 fail ở
`profile-media.test.ts > voice-sender` (timeout 5s); đã stash toàn bộ thay đổi và chạy lại
trên baseline → **test đó pass (16/16)** → là flake do timeout khi chạy song song cả suite,
không phải regression. Lần chạy lại đầy đủ: 560/560.

Dự án **không có script lint** (`package.json` chỉ có `dev/build/start/test`), nên typecheck
là cổng chất lượng tĩnh.

---

## F. Hướng dẫn sử dụng Trigger mới

1. **Tạo Sequence trước.** Bot-Auto → *Kịch bản chăm sóc* → tạo sequence (ví dụ `CSKH - Ngày 1`),
   thêm step, **bật** sequence. Trigger chỉ chọn được sequence đang bật.
2. **Tạo Tag CRM.** Cài đặt → Tag CRM → tạo tag (ví dụ `Chăm sóc KH ngày 1`).
   Tag do Zalo quản lý (`managedBy='zalo_sync'`) **không dùng được** làm tag kích hoạt.
3. **Khởi tạo Trigger.** Bot-Auto → *Kịch bản* → tab **Catalog** → card
   **"KH được gắn Tag CRM"** → **Khởi tạo**. Khai:
   - Tên Trigger
   - Event Type: `crm_tag_added` (cố định)
   - **Tag CRM kích hoạt** — bắt buộc
   - **Sequence sẽ chạy** — bắt buộc
   - **Chính sách chọn nick Zalo**: *Tự chọn* (nick nào đang là bạn thì gửi) hoặc
     *Cố định 1 nick* (nick đó không gửi được thì **bỏ qua**, không tự đổi nick)
   - Đọc **bảng tổng hợp 8 dòng** ở cuối form trước khi lưu
4. **Trigger mới luôn TẮT.** Nghiệm thu xong mới bật bằng công tắc ở tab *Đã cấu hình*.
5. **Dùng hằng ngày:** mở KH → gắn tag → chỉ **khách đó** vào sequence. Timeline KH hiện
   *"Gắn tag → vào kịch bản chăm sóc"* kèm tên sequence và số việc đã xếp hàng, hoặc
   *"Gắn tag → KHÔNG chạy kịch bản"* kèm lý do.

### Khi nào hệ thống KHÔNG gửi (và nói rõ lý do)

| Lý do trên Timeline | Nghĩa |
|---|---|
| `không có trigger nào đang bật cho tag này` | Trigger tắt, hoặc cấu hình tag khác |
| `sequence disabled` | Sequence bị tắt |
| `KH đã opt-out (consentStatus=revoked)` | Khách đã yêu cầu dừng nhận tin |
| `nhân viên không còn quyền với KH này` | Quyền bị thu hồi giữa lúc gắn tag và lúc gửi |
| `tag được gắn trước khi trigger được tạo` | Chống chạy tag lịch sử |
| `event cũ … (> 24h)` | Quá hạn, không gửi tin chăm sóc trễ |
| `tag_managed_by_zalo_sync` / `tag_not_in_catalog` / `auto_tag` | Tag không đủ điều kiện kích hoạt |
| `fixed_nick_not_connected` / `_no_permission` / `_not_friend` | Nick cố định không khả dụng — **không đổi nick** |

Tra vết đầy đủ (nick được giao, trạng thái task, lỗi cấp task):
`GET /api/v1/contacts/:id/crm-tag-events`

---

## G. Rủi ro còn lại

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| 1 | Backend tham chiếu `prisma.crmTagEvent` → thiếu bảng là crash | **Thấp** (đã khảo sát) | Container chạy `prisma db push && node dist/app.js` nên bảng **luôn được tạo trước khi app nhận request**. Rủi ro chỉ còn nếu ai deploy bằng cách khác `docker compose`. |
| 1b | **Quên apply partial unique index** `uniq_crm_tag_event_inflight` | Trung bình | `db push` không tạo được index có `WHERE`. Mất nó thì mất lớp chặn trùng ở DB; transaction + `FOR UPDATE` vẫn còn nên chưa gửi trùng, nhưng phải chạy bước 4 mục H. Kiểm tra: `\d crm_tag_events` |
| 2 | Event bus / sweeper là **single-process**. Chạy nhiều instance app thì mỗi instance đều sweep | Trung bình | Claim atomic + partial unique đã chống trùng ở DB. Hiện deploy 1 container nên chưa phát sinh. |
| 3 | Ghép event → task trong `GET /contacts/:id/crm-tag-events` dùng **thời gian**, không FK | Thấp | Chỉ ảnh hưởng màn hình tra vết. Gắn 2 tag khác nhau cách nhau < 1 giây có thể ghép lệch. Nghiệp vụ gửi tin không phụ thuộc chỗ này. |
| 4 | `onBehalfOfUserId` lấy theo **người cấu hình trigger**, không phải người gắn tag | Thấp | *Giả định đã nêu rõ*: nick gửi là tài sản của automation, do admin chốt khi tạo trigger. Nếu nghiệp vụ muốn theo người gắn tag thì cần thêm cột `actor_user_id` vào `automation_tasks` — chưa làm vì sẽ sửa bảng đang chạy. |
| 5 | Tag **per-nick** (`Friend.crmTagsPerNick`) chưa kích hoạt trigger | Thấp | Ngoài phạm vi V1. Nghiệp vụ nêu "gắn Tag CRM cho một khách hàng" = cấp KH. |
| 6 | Thư mục `migrations/` **lệch hẳn** với DB thật (DB không có `_prisma_migrations`) — có trước tính năng này | Trung bình | Không phải việc của tính năng này, nhưng cần biết: đừng chạy `migrate deploy` / `migrate dev` lên production. Nên tách thành một việc riêng (`prisma migrate resolve --applied` cho toàn bộ migration cũ) nếu muốn đưa về Prisma Migrate. |
| 7 | State `unknown` cần người xử lý tay | Thấp | Chủ ý: thà thiếu 1 tin còn hơn khách nhận 2 tin. Query: `SELECT * FROM crm_tag_events WHERE state='unknown'`. |

---

## H. Hướng dẫn rollback

### Thứ tự triển khai (bắt buộc đúng thứ tự)

Theo đúng cơ chế thật của dự án (`db push` trong `CMD` của container), **không** dùng
`prisma migrate deploy` — DB này không có `_prisma_migrations` nên `migrate deploy` sẽ cố
apply lại toàn bộ migration từ đầu và fail.

```bash
# 1. Backup (đã có bản 20261025_171415; tạo bản mới nếu deploy ngày khác)
docker exec zalo-crm-db pg_dump -U crmuser -d zalocrm \
  > backups/pre-migration-crm-tag-events_$(date +%Y%m%d_%H%M%S).sql

# 2. Xem trước db push sẽ làm gì — PHẢI chỉ có CREATE TABLE crm_tag_events
cd backend
DATABASE_URL="postgresql://crmuser:<DB_PASSWORD>@127.0.0.1:5433/zalocrm" \
  npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script
# Nếu thấy BẤT KỲ lệnh ALTER / DROP nào → DỪNG, báo lại, đừng deploy.

# 3. Build + restart app. Container tự chạy `prisma db push` rồi mới start →
#    bảng được tạo trước khi backend nhận request.
cd .. && docker compose build app && docker compose up -d app

# 4. Apply partial unique index (db push không tạo được) — 1 lần duy nhất
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c \
  "CREATE UNIQUE INDEX IF NOT EXISTS \"uniq_crm_tag_event_inflight\"
     ON \"crm_tag_events\" (\"contact_id\", \"crm_tag_id\")
     WHERE \"state\" IN ('pending', 'dispatching');"

# 5. Kiểm tra
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c "\d crm_tag_events"
docker logs zalo-crm-app --tail 50 | grep "crm-tag sweeper"
# Kỳ vọng: "[crm-tag-dispatcher] sweeper chạy mỗi 60s"
```

**Không dùng** `prisma db push --accept-data-loss`, `migrate reset`, `migrate deploy`,
hay bất kỳ lệnh drop nào.

### Rollback

**Mức 1 — chỉ tắt tính năng (nhanh nhất, không rollback code):**
tắt công tắc Trigger ở Bot-Auto → *Kịch bản* → tab *Đã cấu hình*.
Event vẫn ghi vào outbox nhưng gate 6 chặn, không gửi gì. Hoặc:
```sql
UPDATE automation_triggers SET enabled = false WHERE event_type = 'crm_tag_added';
```

**Mức 2 — rollback code, giữ bảng:**
```bash
git revert <commit>
docker compose build app && docker compose up -d app
```
Bảng `crm_tag_events` để lại là vô hại (không ai đọc). **An toàn nhất** — không mất gì.

**Mức 3 — rollback cả schema:**
```sql
DROP TABLE IF EXISTS "crm_tag_events";
-- Không cần dọn _prisma_migrations: bảng đó không tồn tại trên DB này (dùng db push).
```
Phải revert code **trước** bước này, nếu không backend crash. Lưu ý: nếu code chưa revert,
lần restart app kế tiếp `db push` sẽ **tạo lại** bảng.
Chỉ mất log/outbox của tính năng mới — **không mất dữ liệu nghiệp vụ nào**
(CRM, bạn bè, tin nhắn, file, Zalo session, secrets đều không bị động tới).

**Mức 4 — restore toàn bộ DB** (chỉ khi mức 1–3 không đủ; **mất dữ liệu phát sinh sau backup**):
```bash
docker exec -i zalo-crm-db psql -U crmuser -d zalocrm \
  < backups/pre-migration-crm-tag-events_20261025_171415.sql
```

---

## I. Bảng nghiệm thu

### Đã kiểm thử tự động — PASS

| # | Trường hợp | Kết quả | Test |
|---|---|---|---|
| 1 | Gắn tag lần đầu | **PASS** — sinh đúng 1 event `pending`, có `FOR UPDATE` | `crm-tag-event-service` |
| 2 | Gắn lại tag trùng | **PASS** — 0 event; gỡ tag cũng 0 event | `crm-tag-event-service` |
| 3 | Hai nhân viên gắn đồng thời | **PASS** — người thứ 2 trúng P2002 → `event_already_inflight`, không gửi 2 lần | `crm-tag-event-service` |
| 4 | Khách trên nhiều nick Zalo | **PASS** — mode `fixed` chỉ dùng nick chỉ định dù nick khác cũng là bạn; mode `auto` ưu tiên `accepted` | `crm-tag-nick-policy` |
| 5 | Trigger tắt | **PASS** — skipped, không gọi materializer (3 biến thể: tắt / sai tag / chưa chọn tag) | `crm-tag-dispatcher` |
| 6 | Sequence tắt | **PASS** — skipped kèm lý do từ materializer | `crm-tag-dispatcher` |
| 7 | Nhân viên thiếu quyền | **PASS** — policy `contact.view` false → skipped | `crm-tag-dispatcher` |
| 8 | Nick Zalo offline | **PASS** — bỏ qua, **không** tìm nick khác (khẳng định bằng assert không gọi `findMany`) | `crm-tag-nick-policy` |
| 9 | Khách opt-out | **PASS** — `revoked` chặn ở cả dispatcher và gate gửi tin; `implicit`/`granted` không bị chặn | cả 2 file |
| 10 | Đồng bộ Zalo Native | **PASS** — tag `🔵 X` không vào `Contact.tags`; tag `managedBy='zalo_sync'` ghi nhưng không kích hoạt | `crm-tag-event-service` |
| 11 | Retry worker | **PASS** — lỗi còn lượt → về `pending`; claim thất bại → `not_claimed` | `crm-tag-dispatcher` |
| 12 | Timeout không rõ trạng thái | **PASS** — hết lượt → `unknown`, **KHÔNG tự gửi lại** | `crm-tag-dispatcher` |
| 13 | Chọn nhiều khách | **N/A — an toàn cấu trúc.** Hệ thống **không có** chức năng gắn tag hàng loạt; event luôn mang đúng 1 `contactId` | audit mục A.6 |
| 14 | Chặn gửi ngoài danh sách | **PASS** — assert `materializeFromEvent` nhận đúng 1 `contactId` và `segmentHint === undefined`; thêm gate chống tag lịch sử + event quá 24h + nguồn ≠ `crm_manual` | `crm-tag-dispatcher` |
| 15 | Giữ nguyên dữ liệu chat/CRM/file | **PASS** — assert `contact.update` chỉ ghi đúng key `tags`; migration chỉ `CREATE TABLE`; backup đã verify 73 bảng khớp | `crm-tag-event-service` + mục D |

### Chưa kiểm thử — CHỜ PHÊ DUYỆT (Phase 7 items 4–6)

| # | Trường hợp | Trạng thái | Vì sao |
|---|---|---|---|
| 16 | Test 1 khách nội bộ (gửi Zalo thật) | **PENDING** | Cần apply migration + bật trigger trên **production đang chạy thật** (`NODE_ENV=production`, `crm.nguyentragiang.shop`, Zalo session sống). Chờ anh duyệt. |
| 17 | Test 5 khách nội bộ | **PENDING** | như trên |
| 18 | Kiểm tra execution log + trùng tin sau test thật | **PENDING** | như trên |

### Runbook nghiệm thu khi được duyệt

```bash
# 0. STUB MODE trước — chạy hết luồng mà KHÔNG gọi Zalo SDK
#    .env: AUTOMATION_STUB_MODE=true  → docker compose up -d app
```
1. Tạo tag test `TEST-CSKH-1` + sequence test 1 step + trigger, **bật** trigger.
2. Gắn tag cho **1 khách nội bộ**. Chờ ~10s (chu kỳ worker).
3. Kiểm tra:
   ```sql
   SELECT state, attempt_count, result, last_error FROM crm_tag_events
     WHERE tag_name = 'TEST-CSKH-1' ORDER BY occurred_at DESC;
   -- Kỳ vọng: state='done', result->>'tasksEnqueued' = '1'

   SELECT state, skip_reason, error_message, assigned_nick_id FROM automation_tasks
     WHERE contact_id = '<id KH test>' ORDER BY created_at DESC;
   ```
4. **Gắn lại đúng tag đó** → kỳ vọng **không** sinh event mới, **không** có task mới.
5. Lặp với **5 khách nội bộ** → kỳ vọng 5 event, 5 task, **mỗi khách đúng 1 tin**.
6. Đối chiếu trùng tin:
   ```sql
   SELECT contact_id, count(*) FROM automation_tasks
     WHERE campaign_id IN (SELECT id FROM automation_campaigns
                           WHERE trigger_id = '<id trigger test>')
     GROUP BY contact_id HAVING count(*) > 1;
   -- Kỳ vọng: 0 dòng (sequence 1 step)
   ```
7. Tắt `AUTOMATION_STUB_MODE` → lặp bước 2–3 với **1 khách nội bộ** để xác nhận gửi thật.
8. Xoá dữ liệu test, tắt trigger test, rồi mới bật trigger thật V1.
