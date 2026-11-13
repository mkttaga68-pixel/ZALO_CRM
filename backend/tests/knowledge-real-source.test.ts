import {afterEach,describe,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {ObsidianKnowledgeService} from '../src/modules/ai-quality-control/knowledge.js';
import {MemoryWorkspaceRepository} from '../src/modules/ai-quality-control/repository.js';
import type {Actor} from '../src/modules/ai-quality-control/contracts.js';
const root=path.resolve('../evidence');
const created:string[]=[];
const actor:Actor={id:'test-editor',orgId:'test-org',permissions:['access','edit','view_all'],departmentIds:[]};
async function fixture(){await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'knowledge-real-source-'));created.push(dir);await fs.mkdir(path.join(dir,'01_QUY_TAC_UNG_XU'));await fs.mkdir(path.join(dir,'09_BO_TEST_AI'));await fs.writeFile(path.join(dir,'01_QUY_TAC_UNG_XU/policy.md'),'# Real source policy');await fs.writeFile(path.join(dir,'09_BO_TEST_AI/samples.md'),'# SYNTHETIC sample conversations');return dir;}
afterEach(async()=>{for(const dir of created.splice(0)){if(!path.resolve(dir).startsWith(root+path.sep))throw Error('Invalid test cleanup target');await fs.rm(dir,{recursive:true,force:true});}});
describe('real knowledge source excludes packaged sample tests',()=>{
  it('loads actual policy but excludes the test suite in preview and repeated syncs',async()=>{
    const dir=await fixture(),service=new ObsidianKnowledgeService(()=>[dir],path.join(root,'other-synthetic-root'));
    const scan=await service.scan(actor,dir);expect(scan.issues).toEqual([]);expect(scan.documents.map(d=>d.sourcePath)).toEqual(['01_QUY_TAC_UNG_XU/policy.md']);expect(scan.documents[0]!.synthetic).toBe(false);
    const repo=new MemoryWorkspaceRepository();await service.sync(actor,repo,dir);await service.sync(actor,repo,dir);expect((await repo.read(actor.orgId)).documents).toHaveLength(1);
  });
  it('preserves test suite access in an explicitly synthetic fixture vault',async()=>{
    const dir=await fixture(),service=new ObsidianKnowledgeService(()=>[dir],dir);const scan=await service.scan(actor,dir);expect(scan.documents).toHaveLength(2);expect(scan.documents.every(d=>d.synthetic)).toBe(true);
  });
});
