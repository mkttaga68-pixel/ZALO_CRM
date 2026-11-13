import type {QcDocument} from '@/api/ai-quality-control';
import {analysisOptions} from './presentation';

export const knowledgeGroups=[
  ...analysisOptions.map(option=>({key:option.value,label:option.title,icon:({INSULT:'mdi-message-alert-outline',COURTESY:'mdi-hand-heart-outline',UNRESOLVED_REQUEST:'mdi-message-question-outline',KNOWLEDGE_MISMATCH:'mdi-package-variant-closed'} as Record<string,string>)[option.value]})),
  {key:'REFERENCE',label:'Hướng dẫn và tài liệu tham khảo',icon:'mdi-book-open-page-variant-outline'},
  {key:'UNASSIGNED',label:'Chưa phân nhóm',icon:'mdi-folder-question-outline'},
];
const types=new Set(analysisOptions.map(option=>option.value));
export function documentRuleId(document:QcDocument):string {
  return document.rule?.id??document.markdown.match(/^rule_id:\s*["']?([\w.-]+)/m)?.[1]??document.sourcePath.split(/[\\/]/).pop()?.match(/^([A-Z]+-\d+)/)?.[1]??'';
}
export function documentGroup(document:QcDocument):{key:string;suggested:boolean} {
  if(document.knowledgeClass==='VERIFIED_LEARNING_CASE')return {key:'REFERENCE',suggested:false};
  if(document.rule)return {key:types.has(document.rule.type)?document.rule.type:'UNASSIGNED',suggested:false};
  const folder=document.sourcePath.replace(/\\/g,'/').split('/')[0];
  const proposed:Record<string,string>={
    '01_QUY_TAC_UNG_XU':documentRuleId(document)==='UX-001'?'INSULT':'COURTESY',
    '02_QUY_TRINH_CSKH':'UNRESOLVED_REQUEST','03_SLA_PHAN_HOI':'UNRESOLVED_REQUEST','05_KIEN_THUC_SAN_PHAM':'KNOWLEDGE_MISMATCH',
  };
  if(folder&&proposed[folder])return {key:proposed[folder]!,suggested:true};
  if(folder&&/^(00_BAT_DAU|04_CA_TRUC_NGAY_NGHI|06_TINH_HUONG_MAU|07_QUY_TAC_DANH_GIA_AI|08_KIEM_DUYET)$/.test(folder))return {key:'REFERENCE',suggested:false};
  return {key:'UNASSIGNED',suggested:false};
}
export function latestDocuments(documents:QcDocument[]):QcDocument[] {
  const latest=new Map<string,QcDocument>();
  for(const document of documents){const key=document.documentId||document.sourcePath;const previous=latest.get(key);if(!previous||document.revision>previous.revision)latest.set(key,document);}
  return [...latest.values()];
}
/** Resolve the published timeline before checking status, so a revoked revision cannot revive an old one. */
export function activeDocuments(documents:QcDocument[],now=Date.now()):QcDocument[] {
  const published=new Map<string,QcDocument>();
  for(const document of documents){
    if(document.status==='DRAFT'||!document.approvedAt||!document.effectiveFrom||!Number.isFinite(Date.parse(document.effectiveFrom))||Date.parse(document.effectiveFrom)>now)continue;
    if(document.revokedAt&&Date.parse(document.revokedAt)<Date.parse(document.effectiveFrom))continue;
    const key=document.documentId||document.sourcePath,previous=published.get(key);
    if(!previous||document.revision>previous.revision)published.set(key,document);
  }
  return [...published.values()].filter(document=>document.status==='APPROVED'&&!!document.rule&&document.knowledgeClass!=='VERIFIED_LEARNING_CASE'&&(!document.effectiveTo||Date.parse(document.effectiveTo)>now)&&(!document.revokedAt||Date.parse(document.revokedAt)>now));
}
