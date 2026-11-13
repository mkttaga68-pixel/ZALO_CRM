import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {canAccessPath} from '../src/router/access-policy';
const only=(...grants:string[])=>(r:string,a='access')=>grants.includes(`${r}.${a}`);
const all=()=>true;
describe('access policy: mọi trang đều có quyền quản lý',()=>{
 it('Đăng nhóm / Chào hàng mở bằng quyền posting (trước đây bị chặn với mọi người)',()=>{
  for(const p of ['/group-posts','/chao-hang']){expect(canAccessPath(p,only('posting.access'))).toBe(true);expect(canAccessPath(p,only('contact.access'))).toBe(false);}
 });
 it('không trang cần đăng nhập nào trong router bị thiếu quy tắc quyền',()=>{
  const src=readFileSync(new URL('../src/router/index.ts',import.meta.url),'utf8');
  const top=[...src.matchAll(/path:\s*'(\/[^']*)'/g)].map(m=>m[1]!);
  // Trang con: phần trước khối '/automation/bot' thuộc /settings, phần sau thuộc /automation/bot.
  const [beforeBot,afterBot]=src.split("path: '/automation/bot'");
  const child=(text:string,prefix:string)=>[...text.matchAll(/path:\s*'([a-z][^']*)'/g)].map(m=>prefix+m[1]!);
  const settings=[...child(beforeBot!,'/settings/'),...child(afterBot!,'/automation/bot/')];
  const skip=new Set(['/login','/setup','/:pathMatch(.*)*','/automation/bot']);
  const missing=[...top,...settings].filter(p=>!skip.has(p)).map(p=>p.replace(/\/:[^/]+\??/g,'/x')).filter(p=>!canAccessPath(p,all));
  expect(missing).toEqual([]);
 });
});
