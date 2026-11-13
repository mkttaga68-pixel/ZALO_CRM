import type {Pool,PoolClient} from 'pg';
import {clone,QcError} from '../contracts.js';
import type {MonitoringRepository,MonitoringState} from './contracts.js';
const empty=():MonitoringState=>({jobs:[],warnings:[],deliveries:[]});
function bound(state:MonitoringState){if(state.jobs.length>5000||state.warnings.length>10000||Buffer.byteLength(JSON.stringify(state))>32*1024*1024)throw new QcError('MONITORING_CAPACITY_REACHED',409);}
/** Explicitly non-durable unit-test implementation. Never used as DB fallback. */
export class MemoryMonitoringRepository implements MonitoringRepository {
 private states=new Map<string,MonitoringState>();
 async read(orgId:string){return clone(this.states.get(orgId)??empty());}
 async mutate<T>(orgId:string,fn:(state:MonitoringState)=>T):Promise<T>{const state=clone(this.states.get(orgId)??empty());const result=fn(state);if(result instanceof Promise)throw new QcError('ASYNC_MONITORING_MUTATION',500);bound(state);this.states.set(orgId,clone(state));return clone(result);}
}
const tables={jobs:'native_ai_qc_monitoring_job',warnings:'native_ai_qc_monitoring_warning',deliveries:'native_ai_qc_monitoring_delivery'} as const;
/** Bounded sandbox implementation. Tenant advisory lock fences concurrent workers.
 * No automatic table creation, schema push or in-memory fallback. */
export class PostgresMonitoringRepository implements MonitoringRepository {
 constructor(private pool:Pool){}
 private async load(client:Pool|PoolClient,orgId:string){const state=empty();for(const key of Object.keys(tables) as Array<keyof typeof tables>){const result=await client.query(`SELECT payload FROM ${tables[key]} WHERE organization_id=$1 ORDER BY id`,[orgId]);(state[key] as unknown[]).push(...result.rows.map(r=>r.payload));}return state;}
 async read(orgId:string){const client=await this.pool.connect();try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const state=await this.load(client,orgId);await client.query('COMMIT');return state;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
 async mutate<T>(orgId:string,fn:(state:MonitoringState)=>T):Promise<T>{const client=await this.pool.connect();try{
  await client.query('BEGIN');await client.query('SET LOCAL lock_timeout=\'5s\'');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['native-qc-monitoring:'+orgId]);
  const state=await this.load(client,orgId),result=fn(state);if(result instanceof Promise)throw new QcError('ASYNC_MONITORING_MUTATION',500);bound(state);
  for(const key of Object.keys(tables) as Array<keyof typeof tables>)for(const row of state[key]){if(row.orgId!==orgId)throw new QcError('MONITORING_TENANT_MISMATCH',403);await client.query(`INSERT INTO ${tables[key]}(organization_id,id,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(organization_id,id) DO UPDATE SET payload=EXCLUDED.payload`,[orgId,row.id,JSON.stringify(row)]);}
  // Rows removed by the mutation (retention purge) are deleted for THIS tenant only, under the same lock.
  for(const key of Object.keys(tables) as Array<keyof typeof tables>)await client.query(`DELETE FROM ${tables[key]} WHERE organization_id=$1 AND NOT (id = ANY($2::text[]))`,[orgId,state[key].map(row=>row.id)]);
  await client.query('COMMIT');return clone(result);
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}}
}
