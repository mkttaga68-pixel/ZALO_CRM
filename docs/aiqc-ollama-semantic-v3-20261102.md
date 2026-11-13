# AI Quality Control semantic evaluation — 02/11/2026

**Kết luận: production NO-GO.** Qwen3 4B cùng prompt tập trung theo category đã xử lý đúng hai false negative cũ và hai lỗi phân vai/thiếu calendar cũ. Tuy vậy, tập regression 40 ca vẫn có 2 false positive; bộ độc lập 28 ca có 2 sai lệch giữa `CLEAR` và `INSUFFICIENT_EVIDENCE`. 28 ca mới giữ nguyên nhãn đã đóng băng trước khi chạy; không dùng để sửa prompt.

## Tóm tắt thay đổi và kiểm chứng

- Analyzer gửi bốn yêu cầu category-focused theo tuần tự, kèm toàn bộ hội thoại, speaker attribution đã xác minh và chỉ rule APPROVED có liên quan; không thay Conversation Analyzer bằng hệ thống AI khác.
- Prompt nêu rõ phạm vi hành vi nhân viên, loại trừ khách/bot/system, áp dụng ngoại lệ và yêu cầu abstain khi thiếu bằng chứng. Decoder vẫn xác thực status, message IDs, rule reference/citation và các tiền điều kiện phía backend; thiếu calendar/assignment/coverage không được model đổi thành `CLEAR`.
- Không sửa rule APPROVED hoặc expected labels. Bộ test mù mới: SHA-256 `461d40d038dd92d0b9091447e7872acf53269369fc090e0dc3f5e40fec2e4830`.
- Backend AIQC cô lập: **135/135 PASS** (`evidence/ollama-semantic-v3-20261102/unit-results-v3.json`). Toàn bộ backend suite riêng: **642 passed, 42 failed** trên các route/auth/manual/OpenAI-control tests; các lỗi suite rộng không được quy cho semantic change, cần baseline triage.
- Ollama evaluation: **68/68 hoàn thành**, 272/272 request JSON schema hợp lệ, citations hợp lệ, 0 timeout. Sandbox Dashboard hiển thị 128 Ollama rows, 68 run mới, synthetic-only; xác nhận tại `evidence/ollama-semantic-v3-20261102/dashboard-verification.json`.

## 1. Bốn lỗi cũ: root cause và kết quả sau sửa

Chi tiết input đầy đủ, raw decision trước/sau, backend output, citations và validation: `evidence/ollama-semantic-v3-20261102/four-failures-after.json`; raw trước sửa nằm tại `four-failures-before.json`. Cả bốn conversation đều synthetic; attribution nhân viên và customer được giữ riêng. Rule snapshot dùng đúng tenant synthetic `ollama-synthetic-tenant`, trạng thái APPROVED, revision 1, hash khớp.

| Ca | Expected; trước → sau | Rule / context được truy xuất | Nguyên nhân và sửa |
|---|---|---|---|
| `direct-insult` | ISSUE; `INSUFFICIENT_EVIDENCE` → `POTENTIAL_ISSUE` | `rule-INSULT` r1, hash `c46d4653…aeb2`; HUMAN đã xác minh nói “đồ ngu” sau câu hỏi của customer. | Model trước đây đòi bằng chứng ý định/đối tượng quá mức dù speaker và lượt chat rõ. Prompt mới yêu cầu đánh giá hành vi theo nghĩa câu trong lượt hội thoại, không đòi suy đoán ý định. Backend xác nhận evidence ID là message HUMAN. |
| `semantic-insult` | ISSUE; `INSUFFICIENT_EVIDENCE` → `POTENTIAL_ISSUE` | Cùng `rule-INSULT` r1/hash; HUMAN hỏi khách “Anh chẳng có chút khả năng hiểu một việc đơn giản thế này à?”. | Prompt cũ thiên về dấu hiệu tục tĩu trực tiếp; chưa nhận diện hạ thấp năng lực bằng câu hỏi tu từ. Prompt focused yêu cầu hiểu nghĩa xúc phạm/miệt thị gián tiếp và trích message của nhân viên. Đây là cải thiện của model trên ca cụ thể, chưa chứng minh được năng lực tổng quát. |
| `h03-customer-abuse` | CLEAR; `POTENTIAL_ISSUE` → `NO_ISSUE_OBSERVED` | `rule-INSULT` r1/hash; câu “Nhân viên gì mà đần thế!” là CUSTOMER, sau đó HUMAN trả lời lịch sự. | Trước sửa model đảo đối tượng rule và dựng quy tắc bảo vệ nhân viên không có trong registry. Context mới nêu rõ subject/actor, loại customer khỏi hành vi được chấm và giới hạn evidence IDs vào HUMAN. Backend validation loại message customer khỏi citation evidence. |
| `h20-missing-calendar` | INSUFFICIENT_EVIDENCE; `NO_ISSUE_OBSERVED` → raw `INSUFFICIENT_EVIDENCE`, backend `ABSTAIN` | `rule-UNRESOLVED_REQUEST` r1, hash `5adaedac…3540`; thiếu work calendar, chỉ có yêu cầu của customer. | Metric mặc định `unansweredEligibleTurns=0` từng bị hiểu nhầm là đã xác minh không vi phạm. Analytics nay giữ trạng thái prerequisite unavailable; decoder bắt buộc abstain khi thiếu lịch làm việc, kể cả model trả `CLEAR`. Đây là backend guard độc lập với quyết định model. |

**Phân loại nguyên nhân:** Hai lỗi xúc phạm là prompt/model interpretation, không phải retrieval hay nhãn. Ca customer abuse là speaker attribution/prompt scope; rule đúng đã được lấy nhưng model diễn giải sai phạm vi. Ca calendar là context packaging/validation thiếu prerequisite; không phải đổi ground truth. Không phát hiện citation sai hoặc rule revision/tenant sai trong các snapshot này. Raw pre-fix và post-fix JSON đã được lưu để audit.

## 2. Regression cũ và tập mù mới

### Cùng 40 ca regression (nhãn bất biến)

| Phiên bản | TP | TN | FP | FN | Accuracy nhị phân | Precision | Recall | FPR | FNR | Phân loại ba trạng thái |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Trước sửa v3 | 10 | 28 | 0 | 2 | 95% | 100% | 83.33% | 0% | 16.67% | 18/20 |
| Sau sửa v3 | 12 | 26 | 2 | 0 | 95% | 85.71% | 100% | 7.14% | 0% | 19/20 |

Hai false negative cũ đã thành true positive. Đổi lại, các false positive là `product-question` (model coi câu hỏi/nhắc lại “miễn phí” thành khẳng định của nhân viên) và `ambiguous-irony` (model suy diễn mỉa mai từ “Vâng, anh giỏi quá rồi” khi context chưa đủ). `h17-still-within-sla` expected CLEAR nhưng được abstain; case hiện cung cấp `NO_ELIGIBLE_TURNS` thay vì chứng cứ rằng mọi prerequisite đã được xác minh. Giữ nguyên nhãn của bộ test và coi đây là mismatch cần review fixture/semantics, không sửa expected.

### Tập độc lập mới, 28 ca

Phân loại nhị phân cảnh báo/không cảnh báo: **6 TP, 22 TN, 0 FP, 0 FN**, accuracy/precision/recall 100% trên tập nhỏ này. Phân loại đúng cả ba trạng thái: **26/28 (92.86%)**; hai mismatch đều là abstention-vs-clear. Đây là kết quả mô tả, không phải bằng chứng về độ tin cậy production.

| Scenario | N | TP/TN/FP/FN | Precision / Recall | FPR / FNR | Strict 3-state | Confusion matrix (expected → predicted) |
|---|---:|---|---|---|---:|---|
| Xúc phạm trực tiếp | 4 | 2/2/0/0 | 100% / 100% | 0% / 0% | 4/4 | ISSUE→ISSUE 2; CLEAR→CLEAR 1; INSUFFICIENT→INSUFFICIENT 1 |
| Xúc phạm gián tiếp | 4 | 2/2/0/0 | 100% / 100% | 0% / 0% | 3/4 | ISSUE→ISSUE 2; CLEAR→CLEAR 1; INSUFFICIENT→CLEAR 1 |
| Khách xúc phạm nhân viên | 4 | 0/4/0/0 | N/A / N/A* | 0% / N/A* | 4/4 | CLEAR→CLEAR 3; INSUFFICIENT→INSUFFICIENT 1 |
| Nhân viên xin lỗi | 4 | 1/3/0/0 | 100% / 100% | 0% / 0% | 4/4 | ISSUE→ISSUE 1; CLEAR→CLEAR 3 |
| Xác nhận sản phẩm | 4 | 1/3/0/0 | 100% / 100% | 0% / 0% | 4/4 | ISSUE→ISSUE 1; CLEAR→CLEAR 3 |
| Thiếu ngữ cảnh | 4 | 0/4/0/0 | N/A / N/A* | 0% / N/A* | 4/4 | INSUFFICIENT→INSUFFICIENT 4 |
| CLEAR vs INSUFFICIENT | 4 | 0/4/0/0 | N/A / N/A* | 0% / N/A* | 3/4 | CLEAR→CLEAR 1; CLEAR→INSUFFICIENT 1; INSUFFICIENT→INSUFFICIENT 2 |

`*` Không có positive alert trong category nên precision/recall không định nghĩa. Ma trận và số liệu đủ từng loại nằm ở `comparison.json`; nhãn, prompt/model raw output và citation theo từng case nằm ở `results.json`.

## 3. Tài nguyên và tốc độ

- 272 request cho 68 conversation (4 focused categories/request sequence); tổng 671.6 giây. Latency trung bình **9.85 giây**, P95 **10.62 giây** trên regression; tập mù trung bình **9.84 giây**, P95 **10.58 giây**; không timeout.
- Host 16 logical CPUs, RAM tổng khoảng 15.72 GiB. RAM trống thấp nhất khi chạy: **2.42 GiB**; `llama-server` peak working set **2.24 GiB**; client peak RSS **128.4 MiB**. GPU RTX 3060: VRAM peak used **5,346 MiB**, min free **6,768 MiB**, peak utilization **100%**. CPU trung bình theo process: llama-server khoảng **6.28% machine CPU** trong 10.87 phút; Ollama khoảng 0.11%.
- Baseline Docker `zalo-crm-app` trước inference: 143.2 MiB / 7.619 GiB, 0.24% CPU (`production-stats-before.json`). Đây chỉ là snapshot trước chạy, không đủ để kết luận không có ảnh hưởng khi dùng GPU/RAM chung.
- Bộ đo ghi RAM host/process và GPU, không có số liệu peak RAM riêng của CRM trong suốt bài chạy. Qwen3 8B chưa tải/chạy. Với RAM trống thấp nhất 2.42 GiB, VRAM trống thấp nhất 6.6 GiB và GPU đã chạm 100%, **không thể xác nhận 8B chạy đồng thời an toàn**. Không thử model 8B khi chưa được phê duyệt.

Raw samples: `evidence/ollama-semantic-v3-20261102/resources.json`; summary reproducible: `comparison.json`.

## 4. Obsidian Registry

Mọi run sử dụng snapshot synthetic tenant `ollama-synthetic-tenant`; bốn benchmark rule được APPROVED, revision 1, effective, content hash kiểm tra khớp. Không thấy sai tenant/revision/hash ở run. Không chỉnh bản APPROVED. Các DRAFT đề xuất trước đó vẫn là tài liệu cần người duyệt: làm rõ phủ định/trích dẫn/ý mỉa mai cho INSULT, phân biệt câu hỏi với khẳng định cho KNOWLEDGE_MISMATCH, và bảng quyết định SLA giữa “đang trong hạn” với “thiếu prerequisite” cho UNRESOLVED_REQUEST. DRAFT không được gửi cho model.

## 5. Quyết định và điều kiện trước production

**NO-GO.** Lý do có bằng chứng: 2 FP/40 regression, 2 mismatch 3-state/28 holdout; chỉ có 4–13 mẫu mỗi scenario; GPU dùng chung chạm 100%, host RAM còn 2.42 GiB; full backend suite đang có 42 lỗi ngoài suite AIQC; chưa đo tải concurrent CRM trong lúc inference và chưa chạy Qwen3 8B comparison.

Trước xem xét production cần: (1) chủ sở hữu policy duyệt bản DRAFT; (2) independent holdout lớn hơn, có adjudication và coverage đủ mỗi category/speaker/context, nhãn khóa trước prompt; (3) xử lý hai FP và ambiguity `CLEAR`/`INSUFFICIENT_EVIDENCE`, sau đó chạy lại cùng regression và holdout mới; (4) baseline/triage 42 lỗi suite chung; (5) stress test concurrent trên tài nguyên cách ly, đo ảnh hưởng CRM và latency/error budget; (6) nếu cần so sánh 8B, phê duyệt riêng model/dung lượng và chạy cùng bộ test, rule, prompt; (7) privacy, audit, rollback và human-review acceptance sign-off. Kết quả synthetic hiện tại không đủ để cho phép tự động áp dụng quyết định cho nhân viên hoặc hội thoại thật.

Các thay đổi/kiểm thử lần này không gọi OpenAI, không tải model, không dùng dữ liệu khách hàng, không restart production, không đổi Cloudflare Tunnel và không sửa dữ liệu nhân viên.
