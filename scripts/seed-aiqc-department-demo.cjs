// Fake CRM rows for local department-scope tests. Never publishes policy or sends model/Zalo requests.
const crypto=require('node:crypto');
const {Pool}=(()=>{try{return require('pg');}catch{return require('../backend/node_modules/pg');}})();
const mode=process.argv.includes('--apply')?'apply':'check';
const namespace='aiqc-department-demo-v1';
const uuid=key=>{const h=crypto.createHash('sha256').update(namespace+':'+key).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
const departments=[{id:uuid('department-main'),name:'[TEST AIQC] Chăm sóc khách hàng'},{id:uuid('department-control'),name:'[TEST AIQC] Phòng đối chứng'}];
const users=['An','Bình','Chi','Dũng'].map((name,i)=>({id:uuid('user-'+i),name:'[TEST AIQC] '+name,email:'aiqc.demo.'+i+'@example.invalid',departmentId:departments[i===3?1:0].id}));
const accountId=uuid('account');
const scenarios=[
 {key:'polite',title:'01 - An - Phản hồi lịch sự',employee:0,question:'[DỮ LIỆU ẢO] Sản phẩm mẫu A có màu xanh không?',reply:'Dạ em chào anh, sản phẩm mẫu A có màu xanh. Em gửi thông tin để anh tham khảo ạ.',expected:'Không khẳng định trước kết quả AI; mẫu phản hồi lịch sự.'},
 {key:'insult',title:'02 - An - Ngôn ngữ cần xem xét',employee:0,question:'[DỮ LIỆU ẢO] Tôi chưa hiểu thông tin, bạn giải thích lại được không?',reply:'Anh ngu quá, hỏi mãi không hiểu. Đồ ngu.',expected:'Có thể cần xem xét ngôn ngữ xúc phạm nếu quy tắc đã duyệt áp dụng.'},
 {key:'courtesy',title:'03 - Bình - Phép lịch sự',employee:1,question:'[DỮ LIỆU ẢO] Nhờ bạn kiểm tra giúp thông số sản phẩm mẫu.',reply:'Tự đi mà tìm, đừng hỏi tôi nữa.',expected:'Có thể cần xem xét phép lịch sự, cần quản lý đối soát.'},
 {key:'product',title:'04 - Chi - Thông tin sản phẩm',employee:2,question:'[DỮ LIỆU ẢO] Sản phẩm mẫu A được bảo hành bao lâu?',reply:'Tôi chưa có thông tin bảo hành đã xác minh. Tôi sẽ kiểm tra chính sách và phản hồi anh.',expected:'Không suy ra sai kiến thức khi chưa có chính sách sản phẩm đối chiếu.'},
 {key:'unknown',title:'05 - Không xác định người gửi',employee:null,question:'[DỮ LIỆU ẢO] Xin hỏi về sản phẩm mẫu A.',reply:'Đây là tin chưa xác minh được nhân viên gửi.',expected:'Không đưa vào lô phòng ban vì thiếu repliedByUserId.'},
 {key:'outside',title:'06 - Dũng - Ngoài phòng ban',employee:3,question:'[DỮ LIỆU ẢO] Tôi muốn được tư vấn sản phẩm mẫu.',reply:'Dạ tôi sẽ hỗ trợ anh. Đây là hội thoại thuộc phòng đối chứng.',expected:'Không đưa vào lô của phòng Chăm sóc khách hàng test.'},
];
(async()=>{
 if(process.env.AI_QC_DEPLOYMENT_TIER!=='local-test')throw Error('LOCAL_TEST_TIER_REQUIRED');
 const orgId=process.env.AI_QC_REAL_DATA_PILOT_ORG_ID;
 if(!orgId||!process.env.DATABASE_URL)throw Error('LOCAL_DATABASE_AND_TENANT_REQUIRED');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1});const client=await pool.connect();
 try{
  const current=await client.query('SELECT count(*)::int AS count FROM conversations WHERE org_id=$1 AND id=ANY($2::text[])',[orgId,scenarios.map(s=>uuid(s.key))]);
  const conversationColumns=new Set((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='conversations'")).rows.map(r=>r.column_name));
  const threadColumn=conversationColumns.has('thread_type')?'thread_type':conversationColumns.has('threadType')?'threadType':null;
  const nameColumn=conversationColumns.has('group_name')?'group_name':conversationColumns.has('groupName')?'groupName':null;
  if(!threadColumn||!nameColumn)throw Error('CONVERSATION_DISPLAY_SCHEMA_NOT_SUPPORTED:'+JSON.stringify([...conversationColumns]));
  if(mode==='check'){console.log(JSON.stringify({namespace,mode,seededConversations:current.rows[0].count,departments,users:users.map(u=>({name:u.name,email:u.email,departmentId:u.departmentId})),scenarios:scenarios.map(s=>({title:s.title,expected:s.expected}))},null,2));return;}
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[namespace]);
  if(!(await client.query('SELECT id FROM organizations WHERE id=$1',[orgId])).rows.length)throw Error('TENANT_NOT_FOUND');
  // Owned identifiers must be absent on the first run; reruns are read-only.
  if(current.rows[0].count===scenarios.length){await client.query('ROLLBACK');console.log(JSON.stringify({alreadySeeded:true,department:departments[0].name,conversations:scenarios.length,scansStarted:0}));return;}
  const conflicts=await client.query('SELECT id FROM users WHERE id=ANY($1::text[]) OR email=ANY($2::text[])',[users.map(u=>u.id),users.map(u=>u.email)]);
  if(current.rows[0].count||conflicts.rows.length)throw Error('PARTIAL_OR_CONFLICTING_SEED_REQUIRES_REVIEW');
  for(const d of departments)await client.query('INSERT INTO departments(id,org_id,name,path,updated_at) VALUES($1,$2,$3,$4,NOW())',[d.id,orgId,d.name,'/'+d.id+'/']);
  for(const u of users){
   // A unique unknown random password is never returned. Demo employees cannot be used as test logins.
   await client.query('INSERT INTO users(id,org_id,email,password_hash,full_name,role,is_active,updated_at) VALUES($1,$2,$3,$4,$5,$6,TRUE,NOW())',[u.id,orgId,u.email,'!disabled-demo-'+crypto.randomBytes(32).toString('hex'),u.name,'member']);
   await client.query('INSERT INTO department_members(id,department_id,user_id,dept_role) VALUES($1,$2,$3,$4)',[uuid('membership-'+u.id),u.departmentId,u.id,'member']);
  }
  await client.query('INSERT INTO zalo_accounts(id,org_id,owner_user_id,display_name,status,privacy_mode,sync_paused,sync_paused_reason) VALUES($1,$2,$3,$4,$5,$6,TRUE,$7)',[accountId,orgId,users[0].id,'[TEST AIQC] Kênh dữ liệu ảo - không kết nối','disconnected','sub','SYNTHETIC AIQC DEMO; NO ZALO SESSION']);
  const base=Date.now()-15*60000;
  for(let i=0;i<scenarios.length;i++){
   const s=scenarios[i],conversationId=uuid(s.key),at=new Date(base+i*60000);
   await client.query(`INSERT INTO conversations(id,org_id,zalo_account_id,"${threadColumn}","${nameColumn}",last_message_at,is_replied) VALUES($1,$2,$3,$4,$5,$6,TRUE)`,[conversationId,orgId,accountId,'group','[TEST AIQC] '+s.title,at]);
   await client.query('INSERT INTO messages(id,conversation_id,sender_type,content,content_type,sent_at,sent_via) VALUES($1,$2,$3,$4,$5,$6,$7)',[uuid(s.key+'-question'),conversationId,'contact',s.question,'text',new Date(at.getTime()-30000),'user']);
   await client.query('INSERT INTO messages(id,conversation_id,sender_type,content,content_type,sent_at,sent_via,replied_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uuid(s.key+'-reply'),conversationId,'self',s.reply,'text',at,'user',s.employee===null?null:users[s.employee].id]);
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({namespace,applied:true,department:departments[0].name,controlDepartment:departments[1].name,users:users.map(u=>u.name),conversations:scenarios.length,messages:scenarios.length*2,expectedMainDepartmentCandidates:4,coveredMainEmployees:3,scansStarted:0,policiesPublished:0,aiEnabled:false},null,2));
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();await pool.end();}
})().catch(e=>{console.error('AIQC_DEMO_SEED_FAILED',e.code||'',e.message);process.exitCode=1;});
