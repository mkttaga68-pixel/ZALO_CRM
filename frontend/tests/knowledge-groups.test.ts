import {describe,expect,it} from 'vitest';
import type {QcDocument} from '../src/api/ai-quality-control';
import {documentGroup,documentRuleId,latestDocuments,activeDocuments} from '../src/views/ai-quality-control/knowledge-groups';
const now=Date.parse('2026-11-13T04:00:00Z');
function doc(patch:Partial<QcDocument>={}):QcDocument{return {id:'r1',documentId:'doc-a',sourcePath:'01_QUY_TAC_UNG_XU/UX-001_POLICY.md',revision:1,contentHash:'hash',markdown:'# Policy',status:'APPROVED',approvedAt:'2026-11-12T00:00:00Z',effectiveFrom:'2026-11-12T00:00:00Z',effectiveTo:null,departmentIds:[],rule:{id:'UX-001',type:'INSULT',matchTerms:[],conflictGroup:null,slaSeconds:null,careIntervalDays:null},...patch};}
describe('knowledge library groups and revision counts',()=>{
  it('uses the saved analysis group even if the source folder suggests a different one',()=>{expect(documentGroup(doc({rule:{...doc().rule!,type:'KNOWLEDGE_MISMATCH'}}))).toEqual({key:'KNOWLEDGE_MISMATCH',suggested:false});});
  it('shows proposed draft groups without treating drafts as published rules',()=>{
    const draft=doc({rule:null,status:'DRAFT',approvedAt:null});expect(documentGroup(draft)).toEqual({key:'INSULT',suggested:true});expect(documentRuleId(draft)).toBe('UX-001');expect(activeDocuments([draft],now)).toEqual([]);
    expect(documentGroup(doc({sourcePath:'05_KIEN_THUC_SAN_PHAM/SP-002_TEMPLATE.md',rule:null,markdown:'rule_id: "SP-002"'}))).toEqual({key:'KNOWLEDGE_MISMATCH',suggested:true});
  });
  it('keeps governance, schedules, samples and learning references outside employee analysis groups',()=>{
    for(const folder of ['00_BAT_DAU','04_CA_TRUC_NGAY_NGHI','06_TINH_HUONG_MAU','07_QUY_TAC_DANH_GIA_AI','08_KIEM_DUYET'])expect(documentGroup(doc({sourcePath:folder+'/file.md',rule:null})).key).toBe('REFERENCE');
    expect(documentGroup(doc({knowledgeClass:'VERIFIED_LEARNING_CASE'})).key).toBe('REFERENCE');expect(activeDocuments([doc({knowledgeClass:'VERIFIED_LEARNING_CASE'})],now)).toEqual([]);
  });
  it('preserves unknown rule types for manual grouping instead of inventing a supported type',()=>{expect(documentGroup(doc({rule:{...doc().rule!,type:'NEW_TYPE'}})).key).toBe('UNASSIGNED');expect(documentGroup(doc({sourcePath:'other/file.md',rule:null})).key).toBe('UNASSIGNED');});
  it('counts one current document and one active rule across several approved revisions',()=>{
    const a=doc(),b=doc({id:'r2',revision:2,effectiveFrom:'2026-11-13T00:00:00Z'});expect(latestDocuments([b,a])).toEqual([b]);expect(activeDocuments([a,b],now)).toEqual([b]);
  });
  it('keeps the active published revision when the newest document is a draft or future approval',()=>{
    const a=doc(),draft=doc({id:'r2',revision:2,status:'DRAFT',approvedAt:null});expect(latestDocuments([a,draft])).toEqual([draft]);expect(activeDocuments([a,draft],now)).toEqual([a]);
    expect(activeDocuments([a,doc({id:'r3',revision:3,effectiveFrom:'2026-11-14T00:00:00Z'})],now)).toEqual([a]);
  });
  it('does not revive an older rule when the newest published revision is revoked or expired',()=>{
    const a=doc(),revoked=doc({id:'r2',revision:2,status:'REVOKED',effectiveFrom:'2026-11-13T00:00:00Z',revokedAt:'2026-11-13T01:00:00Z'});expect(activeDocuments([a,revoked],now)).toEqual([]);
    expect(activeDocuments([a,doc({id:'r2',revision:2,effectiveFrom:'2026-11-13T00:00:00Z',effectiveTo:'2026-11-13T01:00:00Z'})],now)).toEqual([]);
  });
  it('ignores a scheduled revision canceled before its effective time',()=>{const a=doc(),canceled=doc({id:'r2',revision:2,status:'REVOKED',effectiveFrom:'2026-11-13T02:00:00Z',revokedAt:'2026-11-13T01:00:00Z'});expect(activeDocuments([a,canceled],now)).toEqual([a]);});
});
