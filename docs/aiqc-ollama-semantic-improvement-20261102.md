# Ollama AIQC semantic improvement — 02/11/2026

**Kết luận: cải thiện, nhưng production NO-GO.** Qwen3 4B tăng từ 15/20 lên 18/20 trên bộ cũ, giữ nguyên input/nhãn/rule. Bộ 20 ca mới đạt 20/20 về có/không cảnh báo, nhưng chỉ 18/20 khi phân biệt đủ ISSUE / CLEAR / INSUFFICIENT_EVIDENCE. Không coi hai lỗi trạng thái thiếu dữ liệu là PASS.

Dashboard sandbox đã có thêm 40 kết quả mới, giữ 20 kết quả cũ để đối chiếu. Browser xác nhận 60 hàng Ollama, trong đó 40 run `ollama-semantic-v2`, tất cả SERVER_SYNTHETIC. URL: http://localhost:5173/ai-quality-control.

## 1. Phân tích năm lỗi cũ

Đã đọc báo cáo cũ và xử lý đủ 20 snapshot. Nội dung đầy đủ của cả 20 ca nằm trong `evidence/ollama-semantic-v2-20261102/all-20-baseline-reviewed.json`. File `five-failures.json` có nguyên conversation, expected, actual, rule APPROVED, revision/hash, context truy xuất và phân loại nguyên nhân cho từng lỗi.

Payload HTTP cũ không được lưu. Context cũ được tái dựng từ snapshot bất biến và thuật toán xếp hạng lexical trước đó; bốn policy benchmark đều là một dòng Markdown nên byte range có thể tái dựng chính xác. Đây là tái dựng, không phải log request quan sát trực tiếp.

Mọi ca bắt đầu bằng khách hỏi: “Cho tôi hỏi về mẫu sản phẩm SYNTHETIC-A?”.

| Ca | Phần hội thoại quan trọng | Expected / actual cũ | Rule APPROVED liên quan | Nguyên nhân và sửa đổi |
|---|---|---|---|---|
| direct-insult | HUMAN: “đồ ngu” | INSULT cảnh báo / ABSTAIN | doc-0 r1: không hạ nhục, xúc phạm, chế giễu; có ngoại lệ trích dẫn/phủ định/xin lỗi | Explanation nhận ra xúc phạm nhưng đảo nghĩa ngoại lệ thành điều kiện bắt buộc. Prompt và diễn giải rule mơ hồ; có mâu thuẫn nội tại của model. Làm rõ ba trạng thái và phạm vi ngoại lệ. **Bản cuối vẫn bỏ sót**, nay viện thiếu chứng cứ về đối tượng. |
| semantic-insult | HUMAN: “Anh chẳng có chút khả năng hiểu một việc đơn giản thế này à?” | INSULT cảnh báo / ABSTAIN | doc-0 r1, nhưng model dẫn doc-3 r1 về sản phẩm | Có đủ cả bốn rule, không phải thiếu retrieval. Model chọn citation khác loại; backend hạ status, mã cũ gộp lỗi loại rule với thời gian. Thay bằng ref có enum theo category, backend dựng citation. **Lỗi citation đã hết nhưng bản cuối vẫn bỏ sót ngữ nghĩa**, trả thiếu chứng cứ. |
| apology | HUMAN: “Em xin lỗi vì đã hướng dẫn chưa rõ. Em sẽ giải thích lại ạ.” | Không cảnh báo COURTESY / POTENTIAL_ISSUE | doc-1 r1 loại trừ lời xin lỗi, hướng dẫn rõ và từ chối lịch sự | Explanation nói không thiếu lịch sự nhưng status lại cảnh báo: nhầm polarity của COURTESY. Định nghĩa đây là phát hiện **thiếu** tôn trọng. Bản cuối CLEAR. |
| product-question | HUMAN: “Anh đang hỏi SYNTHETIC-A có miễn phí không phải không ạ?” | Không cảnh báo KNOWLEDGE_MISMATCH / POTENTIAL_ISSUE | doc-3 r1: giá 100000, bảo hành 12 tháng; không cảnh báo câu hỏi/phủ định thông tin sai | Lẫn câu hỏi xác nhận với khẳng định sai; rule được lấy đúng. Làm rõ assertion, clarification, quote, hypothesis và correction; không dùng dấu hỏi làm classifier. Bản cuối CLEAR. |
| unanswered | HUMAN: “Tôi sẽ giải đáp câu hỏi của anh.”; CUSTOMER sau đó: “Vậy bao giờ tôi nhận được hướng dẫn?” | UNRESOLVED_REQUEST cảnh báo / ABSTAIN | doc-2 r1: SLA synthetic 1800 giây trong giờ làm, có assignment/coverage | Đóng gói xóa calendar; model còn nhầm vai ở lượt cuối và nói thiếu metadata dù snapshot/analytics xác nhận một lượt quá hạn. Giữ calendar được dịch thời gian đồng bộ, alias assignment và cung cấp responseEligibility. Bản cuối cảnh báo có căn cứ. |

Phân loại sáu nhóm nguyên nhân:

- **Context / speaker attribution:** rõ nhất ở unanswered và product-question; đối tượng của hai ca xúc phạm vẫn là điểm model diễn giải chưa đạt.
- **Knowledge retrieval:** không thiếu rule trong năm ca cũ. Lỗi semantic-insult là chọn citation từ context, không phải không lấy được rule. Nguy cơ tài liệu dài lấn category khác được sửa và có regression test riêng.
- **Rule ambiguity:** ngoại lệ INSULT và phạm vi giao nhau INSULT/COURTESY cần viết rõ hơn. Không tự sửa rule APPROVED để thay đổi kết quả.
- **Prompt instructions:** polarity COURTESY, quyết định status, loại speech act và điều kiện thiếu dữ liệu chưa đủ rõ ở bản cũ.
- **Model capability:** quan sát được mâu thuẫn giữa rationale/status và diễn giải ngữ cảnh yếu. Chưa có ablation hoặc model đối chứng nên không quy toàn bộ nguyên nhân cho kích thước 4B.
- **Ground-truth labeling:** giữ nguyên toàn bộ 20 nhãn cũ. Ca unanswered được snapshot và working-time metrics hỗ trợ. Các nhãn cũ chỉ đánh giá một category mục tiêu; không suy ra gold cho ba category còn lại. Nhãn của ca mỉa mai mơ hồ là “không cảnh báo”, không đồng nghĩa đủ chứng cứ để kết luận CLEAR.

## 2. Thay đổi đã áp dụng

1. `ollama-semantics.ts`: prompt tiếng Việt phân biệt role, nhiều lượt chat, phát ngôn trực tiếp/trích dẫn/phủ định/câu hỏi/giả định; định nghĩa polarity và không suy diễn ý định/cảm xúc. Schema có ô riêng cho từng category; backend không ép các category loại trừ nhau.
2. Model trả JSON trung gian có bốn key category cố định. Mỗi category có enum message IDs đã cung cấp và enum rule refs đúng loại. Backend không yêu cầu model chép lại quote/hash/byte offset.
3. `decodeSemanticOutput`: kiểm tra cấu trúc, ref và category; dựng nguyên citation từ KnowledgeChunk đã được truy xuất. Analyzer hiện có tiếp tục kiểm chứng message IDs, exact UTF-8 citations, revision/hash, hiệu lực tại sự kiện và attribution. Không tin JSON chỉ vì HTTP 200 hoặc grammar chấp nhận.
4. `pseudonymize`: chỉ với Ollama, giữ work/off-day intervals nhưng dịch cùng gốc thời gian với messages và observationEndAt. Giữ alias staff/phân công. Các nhánh khác giữ hành vi cũ.
5. Context có `VERIFIED_EMPLOYEE`, `CUSTOMER`, `BOT`, `SYSTEM`, `UNVERIFIED_SPEAKER` và `responseEligibility` từ analytics/SLA được duyệt. Đây là kiểm tra metadata, không phải dò từ khóa để nhận diện hành vi.
6. Retrieval giữ slot cho mỗi analysis type trước khi lấp đầy giới hạn 12 chunks theo lexical ranking. Vẫn chỉ lấy current APPROVED, đúng tenant/ACL, hiệu lực và hash hợp lệ; không đưa DRAFT vào inference.
7. `INSUFFICIENT_EVIDENCE` từ model được map vào `ABSTAIN` của contract hiện có và thêm mã `INSUFFICIENT_EVIDENCE` trong missingContext. Backend chặn cảnh báo quá hạn nếu không có verified overdue turn; không có verified employee thì các category hành vi phải abstain.

Không hardcode năm câu lỗi vào classifier, không parse explanation bằng keyword để lật status, không đổi expected labels. Bốn rule benchmark có `matchTerms:[]`; inference dùng Qwen3 4B qua Conversation Analyzer hiện có.

**Giới hạn còn biết rõ:** guard quá hạn hiện chặn POTENTIAL_ISSUE khi thiếu metadata, nhưng chưa ép mọi NO_ISSUE_OBSERVED thành ABSTAIN khi thiếu calendar. Ca h20 chỉ ra lỗ hổng trạng thái này. Model vẫn có thể abstain quá mức dù nhân viên đã phản hồi phù hợp (h03). Không che hai lỗi này bằng kết quả binary.

## 3. Thiết kế kiểm thử và bảo toàn nhãn

- Bộ cũ: tái dùng nguyên conversation snapshot, expected và category từ evidence cũ; SHA-256 và labels đối chiếu trong `frozen-manifest.json`, `labelsUnchanged=true`.
- Bộ mới: `scripts/fixtures/aiqc-ollama-holdout-v2.json`, 20 ca được viết và đóng băng trước lượt tối ưu. Có xúc phạm gián tiếp, lời khách, trích dẫn nhiều lượt, câu ngắn trung tính, đổ lỗi khinh miệt/nêu sự kiện trung tính, từ chối, giá/bảo hành sai, giả định, hỏi lại nhiều lượt, SLA còn hạn/quá hạn, thiếu coverage/actor/calendar.
- Không đưa labels vào prompt. Mọi request chỉ đến `http://host.docker.internal:11434/api/chat` trong container tạm, không dùng dữ liệu khách hàng thật.
- Một pilot trên 20 ca cũ đã sửa được năm lỗi ban đầu nhưng phát sinh ba lỗi hợp đồng category/ref. Đã dừng container trước khi nhận kết quả holdout; `pilot-old-cases.json` có 20 ca cũ và không có kết quả holdout. Sau đó siết schema cố định và chạy lại toàn bộ 40 ca. Pilot không được trộn vào kết quả nghiệm thu.
- Sau khi bắt đầu lượt 40 ca cuối, không chỉnh prompt/provider theo kết quả holdout. `final-source-inventory.json` lưu hash source; DRAFT chỉ là đề xuất, không được dùng trong lần chạy.
- Model, bốn rule APPROVED r1/hash, temperature 0, context 8192 và max output 2048 giữ nguyên cho đối chiếu. Backend tests **128/128 PASS**, backend TypeScript build PASS; không đổi frontend source trong phase này. Browser sandbox PASS.

## 4. Kết quả riêng từng bộ

Các tỷ lệ dưới đây đánh giá **category mục tiêu đã có gold**. Chưa phải đánh giá toàn bộ bốn output category trên mọi conversation. ABSTAIN là “không cảnh báo” khi đối chiếu nhãn binary, nhưng luôn tính FN nếu expected có cảnh báo. Lỗi ba trạng thái được báo cáo riêng.

| Chỉ số | Baseline 20 cũ | Tối ưu 20 cũ | 20 ca mới | Tổng 40 sau tối ưu |
|---|---:|---:|---:|---:|
| Accuracy | 75% (15/20) | 90% (18/20) | 100% (20/20) | 95% (38/40) |
| TP / TN | 2 / 13 | 3 / 15 | 7 / 13 | 10 / 28 |
| FP / FN | 2 / 3 | 0 / 2 | 0 / 0 | 0 / 2 |
| Precision | 50% | 100% | 100% | 100% |
| Recall | 40% | 60% | 100% | 83,33% |
| False positive rate | 13,33% (2/15) | 0% (0/15) | 0% (0/13) | 0% (0/28) |
| False negative rate | 60% (3/5) | 40% (2/5) | 0% (0/7) | 16,67% (2/12) |
| Target-category abstentions | 16 | 5 | 3 | 8 |
| JSON / schema valid | 20/20 output accepted | 20/20 raw schema valid | 20/20 raw schema valid | 40/40 |
| Timeout | 0 | 0 | 0 | 0 |

Baseline citations: byte/hash/revision hợp lệ 79/79; category alignment 77/79. Hai ref sai loại được giữ trong các snapshot đã abstain, nên PASS về toàn vẹn citation không đồng nghĩa đúng semantic category. Bản mới có citation integrity và category alignment **100%** sau đối chiếu ref/backend; điều này vẫn không chứng minh model hiểu đúng nội dung.

**Ba trạng thái trên bộ mới: 18/20, FAIL.**

| Ca | Expected giữ nguyên | Actual | Ý nghĩa |
|---|---|---|---|
| h03-customer-abuse | CLEAR cho INSULT: khách xúc phạm, nhân viên hỗ trợ đúng | INSUFFICIENT_EVIDENCE | Không tạo cảnh báo nhầm nhưng abstain quá mức. |
| h20-missing-calendar | INSUFFICIENT_EVIDENCE cho UNRESOLVED_REQUEST | CLEAR | Không cảnh báo nhưng biểu đạt mức đủ chứng cứ chưa đúng; chặn nghiệm thu thiếu ngữ cảnh. |

Hai FN ở bộ cũ vẫn là direct-insult và semantic-insult. Cả hai có citation đúng ở bản cuối nhưng model chọn thiếu chứng cứ. Không sửa nhãn hoặc coi việc abstain là phát hiện đúng.

Quan sát 0 FP trên 28 negatives là bằng chứng của mẫu này, **không chứng minh FPR production dưới 1%**. Precision 100% chỉ dựa trên 10 cảnh báo đúng của category mục tiêu. Cần gold đa nhãn, nhiều cách diễn đạt, phân tầng rủi ro và người duyệt độc lập.

## 5. Hiệu năng và tài nguyên

| Chỉ số | Baseline 20 | Tối ưu 20 cũ | 20 ca mới | Tổng 40 mới |
|---|---:|---:|---:|---:|
| Average latency | 19,14 s | 6,21 s | 6,21 s | 6,21 s |
| P95 latency | 21,50 s | 7,01 s | 6,70 s | 6,98 s |
| Tổng batch | 383,02 s | khoảng 124,19 s | khoảng 124,15 s | 248,82 s |
| Client container peak RSS | 99,27 MiB | — | — | 109,15 MiB |

Host llama-server working set lớn nhất quan sát: baseline **4,64 GiB**, lượt mới **828342272 byte ≈ 790 MiB**. Ollama service lượt mới khoảng **38,51 MiB**. CPU llama-server trung bình lượt mới khoảng **6,20% tổng 16 logical CPU**, baseline khoảng **6,29%**. Cửa sổ mẫu mới 15:37:31–15:41:38 Asia/Bangkok, 3 giây/lần, gần trọn batch; mẫu baseline chỉ bao phủ một phần batch.

Đây là peak **working set được lấy mẫu**, không phải toàn bộ host memory hoặc cam kết không có spike giữa hai mẫu. PID inference server khác baseline, baseline không đo GPU. Lượt mới giữ model trên GPU: `/api/ps` báo Qwen3 4.0B Q4_K_M, context 8192, `size_vram=3877571133` byte (~3,61 GiB). `nvidia-smi` trong lượt chạy ghi tổng GPU memory used **5087 MiB**, free **7027 MiB**, utilization **43%** tại một thời điểm; đây không phải GPU peak. Không diễn giải RAM host giảm thành tổng memory footprint giảm tương ứng.

Prompt/context/JSON ngắn hơn giúp giảm output cần sinh; cache, mức warm-up và trạng thái runner/GPU cũng là yếu tố gây nhiễu. Không coi so sánh này là benchmark tải đồng thời hoặc hiệu năng production. Không chạy compiler nặng đồng thời lượt đo cuối.

## 6. Audit và đề xuất Obsidian DRAFT

Audit workspace sandbox, đọc database sau kiểm chứng đúng tên database và data_directory; không quét/ghi production. Có 6 records APPROVED: 4 rule benchmark r1 và hai revision của fixture E2E INSULT. Hiện 5 records active; revision 2 của fixture E2E chỉ hiệu lực từ 01/01/2035 giờ Bangkok nên hiện chọn revision 1. Active hash và tenant đều khớp. Chỉ có một SLA được duyệt: 1800 giây synthetic. Không phát hiện xung đột SLA hoặc conflictGroup được khai báo.

Có hai tài liệu INSULT cùng hiệu lực: fixture literal và rule semantic. Đây là overlap cần review, chưa đủ căn cứ kết luận mâu thuẫn. INSULT/COURTESY cũng có phạm vi giao nhau; không được tự cộng gộp để phạt. Fixture E2E còn ghi rõ không dùng để đánh giá hội thoại thật. Benchmark chỉ dùng bốn rule cố định như baseline để không thay đổi điều kiện so sánh.

Đã tạo bốn file **DRAFT, chưa approved, chưa effective**, trong `evidence/ollama-semantic-v2-20261102/rule-drafts/`:

| DRAFT | Nội dung đề xuất cần người duyệt |
|---|---|
| INSULT.md | Đối tượng/hành vi có chứng cứ, xúc phạm không cần từ tục; phạm vi ngoại lệ và mỉa mai mơ hồ. |
| COURTESY.md | Phân biệt khinh miệt/xua đuổi/đổ lỗi hạ nhục với câu ngắn trung tính, hỗ trợ hoặc nêu lỗi dữ liệu; giao nhau với INSULT. |
| UNRESOLVED_REQUEST.md | SLA, lịch làm/nghỉ, coverage/assignment verified, trong hạn/quá hạn và trạng thái thiếu dữ liệu; không mặc định đã giải quyết vì có một phản hồi. |
| KNOWLEDGE_MISMATCH.md | Phân biệt khẳng định sai, hỏi lại, giả định, trích dẫn và đính chính; không tự xóa lịch sử phát ngôn sai. |

Không chỉnh sửa hoặc publish bản APPROVED. Import 40 run sandbox có kiểm tra danh sách documents không đổi trước/sau transaction; audit sau import xác nhận vẫn cùng 6 APPROVED/5 active. DRAFT không được gửi cho model trong bộ test.

## 7. Model comparison và preflight 8B

| Candidate | Đã chạy? | Kết quả |
|---|---|---|
| Qwen3 4B, provider v1 | Có, 20 ca cũ | Baseline 75%, FP2/FN3 |
| Qwen3 4B, provider semantic v2 | Có, 20 cũ + 20 mới | Binary 95%, FP0/FN2; three-state holdout 90% |
| Qwen3 8B | **Chưa chạy/chưa tải** | Chưa có phê duyệt tải model; không có số liệu accuracy/latency/RAM để so sánh |

Preflight: RAM host **16487856 KiB ≈ 15,72 GiB**, free tại lúc kiểm tra **5798456 KiB ≈ 5,53 GiB**; GPU RTX 3060 **12288 MiB VRAM** theo nvidia-smi. Không dùng giá trị AdapterRAM WMI bị giới hạn để kết luận GPU chỉ có 4 GiB. Free VRAM trong inference 4B khoảng 7027 MiB ở một mẫu, không phải capacity đảm bảo cho 8B.

Nếu được duyệt thử 8B: chốt tag/quantization, kiểm tra fit thực tế, chỉ chạy một candidate tại một thời điểm; giữ nguyên snapshot test, rules/revisions/hashes, prompt, token/context settings và metric definitions. Đo thời gian, JSON, citations, abstain, CPU/RAM/VRAM cùng cách. Nếu tiếp tục tối ưu bằng kết quả holdout này, phải bổ sung holdout mới độc lập. Không giả định model lớn hơn chính xác hơn và không dùng model lớn để che lỗi guard metadata.

## 8. Tiêu chí nghiệm thu đề xuất theo rủi ro

Các ngưỡng này là **đề xuất để con người phê duyệt**, không phải chính sách đã được bật. Tất cả vẫn chỉ tạo nhận xét cần review, không tự chấm điểm/xác nhận vi phạm.

| Nhóm | Precision | Recall | FPR | Điều kiện bổ sung |
|---|---:|---:|---:|---|
| Cảnh báo xúc phạm | ≥98% | ≥95% | ≤0,5% | Hard negatives khách nói, quote, phủ định, hỏi tu từ, mỉa mai, câu ngắn; actor/evidence verified. Hai FN hiện tại phải xử lý. |
| Thiếu tôn trọng | ≥97% | ≥90% | ≤1% | Không cảnh báo chỉ do thiếu lời chào/xin lỗi hoặc câu ngắn; đánh giá độc lập với INSULT. |
| Đổ lỗi cho khách | ≥98% | ≥90% | ≤0,5% | Cần định nghĩa/rule APPROVED riêng hoặc scope COURTESY được duyệt; phân biệt nêu sự kiện với quy kết hạ nhục. Hiện chỉ có mẫu minh họa, chưa nghiệm thu taxonomy riêng. |
| Chăm sóc khách chưa phù hợp | ≥95% | ≥90% | ≤2% | Phải có nguồn đơn hàng, phân công, coverage, lịch và thời hạn đã duyệt; hiện adapter nghiệp vụ chưa đủ nên vẫn NOT_AVAILABLE/NO-GO cho nhóm này. |
| Thiếu dữ liệu/ngữ cảnh | Recall thiếu dữ liệu ≥99% | — | Không có cảnh báo không có căn cứ trong bộ safety | Không trả CLEAR thay INSUFFICIENT khi bắt buộc thiếu metadata; phân biệt abstain hợp lý với abstain quá mức. Hai lỗi trạng thái holdout hiện chặn nghiệm thu. |

Đề xuất tối thiểu 300 positives và 600 hard negatives **mỗi nhóm rủi ro cao**, nhiều cách diễn đạt, đủ nhiều lượt và nhóm thiếu metadata; gold đa nhãn do ít nhất hai người đánh giá, có adjudication, split theo conversation và tập nghiệm thu độc lập. Báo cáo khoảng tin cậy: ngay cả 0 FP/600 negatives cũng chỉ hỗ trợ cận trên một phía 95% xấp xỉ 0,5%; 0 FP/28 hiện tại còn rất ít. Không coi n=40 là production acceptance.

Thêm gate bắt buộc: schema và citation integrity 100% trên bộ safety; không vượt tenant/ACL/revision, timeout fail closed, retention/privacy, network allowlist, concurrency/rate-limit và kiểm thử tải/RAM headroom trong môi trường tương đương production. Model không được tự đặt SLA hoặc quy tắc chăm sóc.

## 9. Production readiness và evidence

**NO-GO** vì hai ca xúc phạm cũ vẫn bỏ sót (recall bộ cũ 60%); hai lỗi three-state còn tồn tại; mẫu và gold chưa đủ; nghiệp vụ chăm sóc/production vault chưa nghiệm thu; chưa có load test và quy trình vận hành đủ. Một guard cần sửa ở vòng tiếp theo là ép thiếu metadata bắt buộc sang INSUFFICIENT, kể cả model trả CLEAR, rồi kiểm thử bằng holdout mới. Giữ nguyên kết quả vòng này để tránh dùng holdout tối ưu rồi báo lại như dữ liệu chưa thấy.

Evidence trong `evidence/ollama-semantic-v2-20261102/`:

- `five-failures.json`, `all-20-baseline-reviewed.json`: phân tích gốc đầy đủ.
- `frozen-manifest.json`, `final-source-inventory.json`: input/labels/rule/source hashes.
- `pilot-old-cases.json`: pilot chỉ trên dữ liệu cũ, không dùng làm acceptance.
- `results.json`: 40 requests/responses, retrieved context, findings, snapshots, observations và metrics.
- `comparison.json`, `baseline-citation-audit.json`: confusion matrices và kiểm tra citation.
- `hardware.json`, `host-resources.json`, `gpu-during-run.csv`, `runtime-model.json`: tài nguyên và model thực tế.
- `sandbox-rule-audit.json`, `rule-drafts/`: rule audit và bốn đề xuất DRAFT.
- `unit-results.json`, `dashboard.png`, `dashboard-verification.json`: tests/browser evidence.

Production `zalo-crm-app` vẫn running, StartedAt `2026-11-01T09:31:11.772638502Z`. Không restart production, không gọi OpenAI, không tải model mới, không gửi hội thoại thật, không sửa dữ liệu nhân viên thật, không đổi Cloudflare Tunnel, không mở cổng 11434 và không deploy production. Chỉ các container test tạm được tạo/dừng/xóa.
