// Operator request: response within 10 minutes; proactive care every day.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root='C:/Users/ADMIN/Downloads/ZALO_CRM_AI_BRAIN';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const policyTargets=[
  {relative:'02_QUY_TRINH_CSKH/CSKH-001_LICH_SAU_MUA.md',expected:'18ad2164c1d00a3c0fbf83691685874205c01369683d6a95c8ec8f87b2ecba6d',edit(text){
    const start=text.indexOf('## Lịch tham khảo cần chủ dự án phê duyệt');
    const end=text.indexOf('## Điều kiện tạo cảnh báo QUÊN',start);
    if(start<0||end<0)throw Error('CARE_SECTION_CHANGED');
    return text.slice(0,start)+'## Lịch chăm sóc đã xác nhận\n- Chăm sóc chủ động mỗi ngày một lần sau khi mua hàng, chu kỳ 1 ngày (24 giờ).\n- Mốc tính từ lần chăm sóc chủ động được xác minh gần nhất; nếu chưa có, tính từ ngày mua đã xác minh.\n- Nội dung: hỏi trải nghiệm, ghi nhận phản hồi và nhu cầu hỗ trợ; không ép mua hoặc tự tạo thông tin sản phẩm.\n- Lịch hằng ngày thay thế lịch đề xuất ngày 3, 7, 12, 17, 21 trước đây.\n- Khách từ chối liên hệ, bàn giao hoặc ngoại lệ khác phải có bằng chứng và được đối soát trước khi tạo cảnh báo.\n\nXác nhận theo yêu cầu chủ dự án ngày 13/11/2026: “Chăm sóc mỗi ngày”. Hiệu lực áp dụng được ghi tại Knowledge Registry.\n\n'+text.slice(end);
  }},
  {relative:'03_SLA_PHAN_HOI/SLA-002_NGUONG_PHAN_HOI_CAN_DUYET.md',expected:'74eb07f39c006cb76de297dda95966e18ea08601b64ad204685f4e41ea5c85bb',edit(text){
    const start=text.indexOf('## Bảng quyết định chính sách'),end=text.indexOf('## Ngoại lệ cần xét',start);
    if(start<0||end<0)throw Error('SLA_SECTION_CHANGED');
    const table='## Bảng ngưỡng phản hồi đã xác nhận\n| Kênh/nhóm | Loại yêu cầu | Clock | SLA phút |\n|---|---|---|---|\n| Zalo - CSKH | Khách hỏi về đơn | WALL_CLOCK | 10 |\n| Zalo - Tư vấn | Khách hỏi sản phẩm | WALL_CLOCK | 10 |\n| Zalo - Khiếu nại | Khiếu nại | WALL_CLOCK | 10 |\n\n- Phản hồi hợp lệ trong vòng 10 phút (600 giây) kể từ yêu cầu cần phản hồi.\n- Đo thời gian trôi qua thực tế; chỉ đánh giá các lượt đủ điều kiện trong phạm vi giám sát, có người phụ trách và độ phủ dữ liệu được xác minh.\n- Phản hồi của BOT/AI/SYSTEM không được tính là phản hồi của nhân viên.\n- Thiếu lịch trực, phân công, đồng bộ hoặc thông tin ngoại lệ: trả chưa đủ dữ liệu, không tự quy lỗi.\n\nXác nhận theo yêu cầu chủ dự án ngày 13/11/2026: “Trong tầm 10 phút”. Hiệu lực áp dụng được ghi tại Knowledge Registry.\n\n';
    return (text.slice(0,start)+table+text.slice(end)).replace('**Không tự thay `CHƯA CHỐT` bằng một số phút tùy ý.**','**Ngưỡng 10 phút chỉ được thay đổi khi có quyết định cập nhật và phiên bản được duyệt tại Knowledge Registry.**');
  }},
];
const supportingTargets=[
  {relative:'02_QUY_TRINH_CSKH/CSKH-002_KHACH_CHUA_DUOC_GIAI_QUYET.md',expected:'6d6b262391bb4dd9f326d0f2d559cbae1ddb45ea099ffe333f9d41190c8a1e58',edit(text){
    return text+'\n## Ngưỡng phản hồi liên quan\nTheo quyết định chủ dự án ngày 13/11/2026 và SLA-002: phản hồi hợp lệ trong 10 phút (600 giây), tính thời gian trôi qua thực tế trong phạm vi đủ điều kiện được xác minh. Có phản hồi không đồng nghĩa yêu cầu đã được giải quyết. Thiếu dữ liệu phân công, lịch trực hoặc độ phủ: chưa đủ dữ liệu để kết luận.\n';
  }},
  {relative:'03_SLA_PHAN_HOI/SLA-001_DINH_NGHIA_KPI.md',expected:'e8a2770e45980fa44c80e6fbcec21355e68e84797d17ebc236c0065e4ce304b7',edit(text){
    const start=text.indexOf('## Những trường cần chủ dự án chốt');if(start<0)throw Error('SLA_DEFINITION_CHANGED');
    return text.slice(0,start)+'## Ngưỡng và phạm vi áp dụng đã xác nhận\n- Theo SLA-002 và quyết định chủ dự án ngày 13/11/2026: phản hồi hợp lệ trong 10 phút (600 giây).\n- Clock: WALL_CLOCK, tính thời gian trôi qua thực tế.\n- Phạm vi: yêu cầu khách về đơn hàng, tư vấn sản phẩm và khiếu nại trong giám sát Zalo đang cấu hình.\n- Chỉ đánh giá lượt có trách nhiệm nhân viên, lịch và độ phủ dữ liệu được xác minh; các trường hợp ngoài ca, bàn giao, thiếu nguồn hoặc chưa xác minh phải được loại trừ/đối soát phù hợp.\n- Thiếu dữ liệu bắt buộc: trả chưa đủ dữ liệu, không suy ra vi phạm.\n';
  }},
];
const targets=process.argv.includes('--supporting-documents')?supportingTargets:policyTargets;
const resolvedRoot=fs.realpathSync(root),changes=[];
for(const target of targets){
  const file=path.join(resolvedRoot,target.relative),real=fs.realpathSync(file),stat=fs.lstatSync(file);
  if(!real.startsWith(resolvedRoot+path.sep)||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('INVALID_SOURCE_TARGET');
  const before=fs.readFileSync(file);if(sha(before)!==target.expected)throw Error('OBSIDIAN_SOURCE_CHANGED: '+target.relative);
  let after=target.edit(before.toString('utf8')).replace('version: "0.1"','version: "0.2"');
  after=after.replace('> **BẢN NHÁP — CHƯA CÓ HIỆU LỰC.** Phải được chủ dự án/người được ủy quyền duyệt qua Knowledge Registry trước khi AI dùng làm căn cứ.','> Ngưỡng chính sách được cập nhật theo yêu cầu chủ dự án. Trạng thái duyệt, phiên bản và hiệu lực thực tế do Knowledge Registry quản lý.');
  changes.push({file,relative:target.relative,before,after:Buffer.from(after,'utf8'),oldHash:sha(before),newHash:sha(Buffer.from(after,'utf8'))});
}
const manifest=path.join(resolvedRoot,'00_BAT_DAU/MANIFEST_SHA256.md'),oldManifest=fs.readFileSync(manifest);let nextManifest=oldManifest.toString('utf8');
for(const c of changes){if(!nextManifest.includes(c.oldHash))throw Error('MANIFEST_ENTRY_CHANGED');nextManifest=nextManifest.replace(c.oldHash,c.newHash);}
changes.push({file:manifest,relative:'00_BAT_DAU/MANIFEST_SHA256.md',before:oldManifest,after:Buffer.from(nextManifest,'utf8')});
if(!process.argv.includes('--apply')){console.log(JSON.stringify({preview:true,files:changes.map(c=>c.relative)}));process.exit(0);}
try{for(const c of changes)fs.writeFileSync(c.file,c.after);}catch(e){for(const c of changes)fs.writeFileSync(c.file,c.before);throw e;}
console.log(JSON.stringify({applied:true,slaSeconds:600,careIntervalDays:1,files:changes.map(c=>c.relative)}));
