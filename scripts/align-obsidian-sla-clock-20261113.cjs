const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.realpathSync('C:/Users/ADMIN/Downloads/ZALO_CRM_AI_BRAIN');
const paths=['02_QUY_TRINH_CSKH/CSKH-002_KHACH_CHUA_DUOC_GIAI_QUYET.md','03_SLA_PHAN_HOI/SLA-001_DINH_NGHIA_KPI.md','03_SLA_PHAN_HOI/SLA-002_NGUONG_PHAN_HOI_CAN_DUYET.md'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),changes=[];
for(const relative of paths){const file=path.join(root,relative),stat=fs.lstatSync(file);if(!fs.realpathSync(file).startsWith(root+path.sep)||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('INVALID_TARGET');
const before=fs.readFileSync(file);let text=before.toString('utf8');if(!text.includes('version: "0.2"'))throw Error('SOURCE_VERSION_CHANGED');
text=text.replace('version: "0.2"','version: "0.3"').replaceAll('WALL_CLOCK','BUSINESS_HOURS')
  .replace('tính thời gian trôi qua thực tế trong phạm vi đủ điều kiện được xác minh','chỉ cộng thời gian trong lịch làm việc và phạm vi đủ điều kiện được xác minh')
  .replace('Clock: BUSINESS_HOURS, tính thời gian trôi qua thực tế','Clock: BUSINESS_HOURS, cộng thời gian trong lịch làm việc đã xác minh')
  .replace('Đo thời gian trôi qua thực tế; chỉ đánh giá','Cộng thời gian trong các khoảng làm việc đã xác minh; chỉ đánh giá');
changes.push({file,relative,before,after:Buffer.from(text,'utf8')});}
const manifest=path.join(root,'00_BAT_DAU/MANIFEST_SHA256.md'),beforeManifest=fs.readFileSync(manifest);let text=beforeManifest.toString('utf8');
for(const c of changes){if(!text.includes(sha(c.before)))throw Error('MANIFEST_SOURCE_CHANGED');text=text.replace(sha(c.before),sha(c.after));}
changes.push({file:manifest,relative:'00_BAT_DAU/MANIFEST_SHA256.md',before:beforeManifest,after:Buffer.from(text,'utf8')});
try{for(const c of changes)fs.writeFileSync(c.file,c.after);}catch(e){for(const c of changes)fs.writeFileSync(c.file,c.before);throw e;}
console.log(JSON.stringify({clock:'BUSINESS_HOURS',slaSeconds:600,files:changes.map(c=>c.relative)}));
