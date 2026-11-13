import {describe,expect,it} from 'vitest';
import {buildCategories,countGranted,setAction,setResources,CATEGORIES,RESOURCE_INFO} from '../src/components/rbac/permission-catalog';
const ra={contact:['access','create','edit','delete','view_all'],dashboard:['access'],bot_auto:['access'],trigger:['access','create']};
describe('danh mục phân quyền dạng mục lớn → mục nhỏ',()=>{
 it('mọi chức năng backend 28 dòng đều có nhóm lớn và tên tiếng Việt',()=>{
  const backend=['dashboard','appointment','report','analytics','automation','group','integration','ai_assistant','department','user','permission_group','conversation','contact','contact_data_purge','friend','posting','ai_quality_control','bot_auto','customer_list','broadcast','sequence','trigger','block','zalo_account','webhook','engagement_score','audit_log','settings'];
  const grouped=CATEGORIES.flatMap(c=>c.resources);
  expect(backend.filter(r=>!grouped.includes(r))).toEqual([]);
  expect(backend.filter(r=>!RESOURCE_INFO[r])).toEqual([]);
  expect(new Set(grouped).size).toBe(grouped.length);
 });
 it('chỉ hiện chức năng backend hỗ trợ; chức năng lạ vào nhóm Khác',()=>{
  const cats=buildCategories(['contact','dashboard','new_thing']);
  expect(cats.map(c=>c.id)).toEqual(['overview','customer','other']);
  expect(cats.at(-1)!.resources).toEqual(['new_thing']);
 });
 it('tích quyền con tự bật Truy cập; tắt Truy cập bỏ hết quyền con',()=>{
  const g1=setAction({},'contact','edit',true,ra.contact);
  expect(g1.contact).toEqual({edit:true,access:true});
  const g2=setAction({contact:{access:true,edit:true,view_all:true}},'contact','access',false,ra.contact);
  expect(Object.values(g2.contact!).some(Boolean)).toBe(false);
  const g3=setAction(g1,'contact','edit',false,ra.contact);
  expect(g3.contact).toEqual({edit:false,access:true});
 });
 it('bật/tắt cả nhóm và đếm tiến độ, không sửa object gốc',()=>{
  const base={contact:{access:true}};
  const on=setResources(base,['contact','dashboard'],ra,true);
  expect(countGranted(on,['contact','dashboard'],ra)).toEqual({on:6,total:6});
  expect(base).toEqual({contact:{access:true}});
  expect(countGranted(setResources(on,['contact'],ra,false),['contact','dashboard'],ra)).toEqual({on:1,total:6});
 });
});
