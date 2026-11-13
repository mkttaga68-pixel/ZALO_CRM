import {describe,expect,it} from 'vitest';
import {alertText,freshAlerts,type AiqcAlertItem} from '../src/components/aiqc-alert-diff';
const item=(id:string,unread=true,name='Nhân viên A',types=['COURTESY']):AiqcAlertItem=>({id,createdAt:'2026-11-11T00:00:00Z',unread,employees:[{id:'u-'+id,name}],types});
describe('AIQC global alert diff (pure, no network)',()=>{
 it('does not announce history on first load',()=>{const known=new Set<string>();expect(freshAlerts(known,[item('a'),item('b')],false)).toEqual([]);expect(known.size).toBe(2);});
 it('announces only newly appeared unread alerts afterwards',()=>{const known=new Set<string>();freshAlerts(known,[item('a')],false);const fresh=freshAlerts(known,[item('c'),item('d',false),item('a')],true);expect(fresh.map(i=>i.id)).toEqual(['c']);expect(freshAlerts(known,[item('c'),item('a')],true)).toEqual([]);});
 it('formats single and multiple alerts with employee and rule labels',()=>{const label=(t:string)=>t==='COURTESY'?'Thái độ':t;expect(alertText([item('a')],label)).toBe('Nhân viên A — Thái độ');expect(alertText([item('a',true,'B'),item('b')],label)).toBe('2 cảnh báo mới. Gần nhất: B — Thái độ');expect(alertText([{...item('x'),employees:[]}],label)).toBe('Hội thoại cần xem xét — Thái độ');});
 it('bounds memory of known ids',()=>{const known=new Set<string>();freshAlerts(known,Array.from({length:1200},(_,i)=>item('k'+i)),true);expect(known.size).toBe(1000);});
});
