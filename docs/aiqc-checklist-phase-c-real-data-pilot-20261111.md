# Checklist Phase C — pilot dữ liệu thật (CHƯA ĐƯỢC PHÊ DUYỆT)

Pilot chỉ được xem xét khi Phase B đã chạy ≥ 14 ngày mà không chạm tiêu chí dừng. Mọi mục dưới đây phải có **người ký, ngày ký và bằng chứng**. Nếu thiếu dù một mục thì giữ NO-GO. Kết quả AIQC chỉ là **observation cần người xem xét**: không dùng làm KPI, không dùng để kỷ luật hay chấm điểm nhân viên.

## 1. Tenant và cơ sở pháp lý

- [ ] Tenant pilot duy nhất: ASLAN GLOBAL `a236afea-cc9c-4de8-81c0-ee5923385b2e`. Người ký là đại diện có thẩm quyền của tenant.
- [ ] Có văn bản về cơ sở xử lý dữ liệu: mục đích kiểm soát chất lượng CSKH, phạm vi hội thoại, thời hạn. Nếu chính sách nội bộ yêu cầu, phải thông báo cho nhân viên. Pháp chế hoặc DPO của tenant xác nhận.
- [ ] Không có dữ liệu nào rời host: provider chỉ dùng Ollama local, hoặc dùng Mock. Muốn dùng OpenAI phải mở lại checklist riêng gồm billing hard limit, DPA và `AI_QC_OPENAI_REMOVED=false`; không thuộc phạm vi pilot này.

## 2. Chính sách (Obsidian Registry)

- [ ] Admin tenant duyệt 16 policy candidate trong `aiqc-obsidian-approval-register-20261102.md`: gán tenant, ACL phòng ban, hiệu lực; publish đúng revision và hash qua Registry. Không tự động duyệt.
- [ ] Hash trong manifest khớp; vault mount read-only, allowlist chỉ chứa tenant pilot.

## 3. Retention và audit

- [ ] Người có quyền `approve` đặt `retentionDays` (1–365) qua Settings. Giá trị đề xuất: 30 ngày cho run; manual run 7 ngày (đã cố định trong code).
- [ ] Ký chính sách audit: purge **không xóa** audit. Audit chỉ chứa ID, hash và lý do đã được che PII. Khi chạm trần 10.000 thì cần export có ký số rồi mới quyết định thu gọn. Chưa có công cụ thu gọn: làm thành change riêng.
- [ ] Lịch purge do operator chủ động: `POST /api/v1/ai-quality-control/retention/purge-expired` (cần `delete`+`view_all`, có lý do). Monitoring dùng `POST …/monitoring/retention/purge`.
- [ ] Backup DB nằm trong chu kỳ retention: dữ liệu đã purge vẫn còn trong backup cho tới khi backup hết hạn. Ghi rõ thời hạn này vào văn bản cơ sở xử lý.

## 4. Vai trò và quyền

- [ ] Ma trận ở runbook A §6 đã PASS trên production bằng tài khoản thật (G16).
- [ ] Danh sách người có grant `ai_quality_control` cho từng action đã được duyệt; quyền `view_all` và `delete` giới hạn tối đa 2 người.
- [ ] Người chỉ có `access` chỉ thấy run do mình tạo và đúng phòng ban (đã có test).

## 5. Cấu hình (hai khóa)

- [ ] `AI_QC_REAL_DATA_ENABLED=true` **và** `AI_QC_REAL_DATA_PILOT_ORG_ID=a236afea-…`. Thiếu một trong hai thì code giữ real-data OFF (có test). Mọi tenant khác nhận `AI_QC_REAL_DATA_TENANT_NOT_APPROVED`.
- [ ] `AI_QC_REAL_DATA_OUTBOUND_APPROVED` chỉ bật khi đã có quyết định provider. `AUTO_MONITOR` vẫn OFF; monitoring hiện chỉ chạy được khi `NODE_ENV=test`.
- [ ] Image phải là bản A2 (có cổng hai khóa), digest đã review.

## 6. Chất lượng và vận hành

- [ ] Semantic đạt ngưỡng pilot của `evaluate-aiqc-semantic-holdout.mjs`: holdout ≥ 30 positive và ≥ 60 negative; nhãn khóa trước khi đổi prompt; có adjudication; cận trên Wilson 95% FPR ≤ 10%, FNR ≤ 20%; mỗi category ≥ 8 ca; 3-state ≥ 95%.
- [ ] Benchmark Ollama đạt (G13), resource guard và kill switch đã diễn tập.
- [ ] Mọi observation qua người xem xét (review status) trước khi có hành động nào. Báo cáo FP hằng tuần cho chủ policy.

## 7. Ký GO

| Vai trò | Họ tên | Ngày | Chữ ký |
|---|---|---|---|
| Owner hệ thống | | | |
| Đại diện tenant ASLAN | | | |
| Pháp chế / DPO | | | |
| Operator hạ tầng | | | |
