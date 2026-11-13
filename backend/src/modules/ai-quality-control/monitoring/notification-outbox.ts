import type {Server,Socket} from 'socket.io';
import type {WorkspaceRepository,Actor} from '../contracts.js';
import {canReadCurrentRun} from '../analysis.js';
import {warningEvidenceValid} from './warning-engine.js';
import type {MonitoringRepository,MonitoringWarning} from './contracts.js';
export async function visibleWarning(actor:Actor,w:MonitoringWarning,workspace:WorkspaceRepository){return actor.permissions.includes('access')&&actor.orgId===w.orgId&&warningEvidenceValid(w)&&canReadCurrentRun(actor,await workspace.read(actor.orgId),w.evidence);}
/** Uses the existing Socket.IO server in an authenticated isolated namespace.
 * Never joins client-selected tenant rooms or broadcasts warning contents. */
export class MonitoringNotifications {
 private namespace;private acked=new Map<string,Map<string,number>>();
 constructor(io:Server,private store:MonitoringRepository,private workspace:WorkspaceRepository,private authenticate:(socket:Socket)=>Promise<Actor>){
  this.namespace=io.of('/ai-qc-monitoring');
  this.namespace.use(async(socket,next)=>{try{const actor=await authenticate(socket);if(!actor.permissions.includes('access'))throw Error('forbidden');socket.data.monitoringActor=actor;next();}catch{next(Error('Unauthorized'));}});
  this.namespace.on('connection',socket=>{socket.on('qc:ack',(id:unknown)=>{if(typeof id!=='string'||!this.acked.get(socket.id)?.has(id))return;void(async()=>{const actor=await this.authenticate(socket),state=await this.store.read(actor.orgId),delivery=state.deliveries.find(d=>d.id===id),warning=state.warnings.find(w=>w.id===delivery?.warningId);if(!warning||!await visibleWarning(actor,warning,this.workspace))return;await this.store.mutate(actor.orgId,s=>{const row=s.deliveries.find(d=>d.id===id);if(row){row.acknowledgedBy=[...new Set([...(row.acknowledgedBy??[]),actor.id])];row.delivered=true;}});this.acked.get(socket.id)?.delete(id);})().catch(()=>{socket.disconnect(true);});});socket.on('disconnect',()=>this.acked.delete(socket.id));});
 }
 async flush(orgId:string){const state=await this.store.read(orgId);let sent=0;
  for(const delivery of state.deliveries){const warning=state.warnings.find(w=>w.id===delivery.warningId);if(!warning)continue;
   for(const socket of this.namespace.sockets.values())try{const actor=await this.authenticate(socket);if(delivery.acknowledgedBy?.includes(actor.id)||!await visibleWarning(actor,warning,this.workspace))continue;
    let pending=this.acked.get(socket.id);if(!pending){pending=new Map();this.acked.set(socket.id,pending);}const previous=pending.get(delivery.id);if(previous!==undefined&&Date.now()-previous<5000)continue;
    pending.set(delivery.id,Date.now());socket.emit('qc:warning-updated',{id:delivery.id,warningId:warning.id,version:warning.version});sent++;
   }catch{socket.disconnect(true);}
  }return sent;
 }
 close(){this.namespace.disconnectSockets(true);this.namespace.removeAllListeners();this.acked.clear();}
}
