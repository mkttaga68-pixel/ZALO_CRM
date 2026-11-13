import {onMounted,onUnmounted,ref,watch,type Ref} from 'vue';
import type {Socket} from 'socket.io-client';
import {qcRequest,type LearningSummary} from '@/api/ai-quality-control';

/** Polling is the fallback: fast while realtime is down, slow safety net while connected. */
const hasDocument=()=>typeof document!=='undefined';
export const learningPollInterval=(connected:boolean)=>connected?300000:60000;

/** Pending Learning Draft badge for "Kho quy tắc": Socket.IO `/aiqc-learning` signal + polling fallback.
 * The socket only carries a content-free "changed" signal; data is always re-fetched through the authorised REST API,
 * so a decision by one Admin refreshes every other Admin's badge and list without showing stale state. */
export function useLearningDraftSignal(enabled:Ref<boolean>){
  const summary=ref<LearningSummary|null>(null),revision=ref(0),live=ref(false);
  let connecting=false,socket:Socket|undefined,timer:ReturnType<typeof setTimeout>|undefined,active=true,inflight=false,generation=0,queued=false;
  async function refresh(){
    if(!enabled.value||!active)return;if(inflight){queued=true;return;}inflight=true;const epoch=generation;
    try{const s=await qcRequest<LearningSummary>('get','/learning-drafts/summary');if(active&&enabled.value&&epoch===generation){if(summary.value&&summary.value.version!==s.version)revision.value++;summary.value=s;}}
    catch{if(active&&epoch===generation)summary.value=null;}
    finally{inflight=false;if(queued){queued=false;if(active&&enabled.value)void refresh();}}
  }
  function schedule(){if(timer)clearTimeout(timer);if(!active||!enabled.value)return;timer=setTimeout(()=>{if(!hasDocument()||!document.hidden)void refresh();schedule();},learningPollInterval(live.value));}
  const onVisible=()=>{if(hasDocument()&&!document.hidden)void refresh();};
  function connect(){
    if(socket||connecting||!enabled.value||!hasDocument())return;
    connecting=true;
    // Lazy: socket client and token reader are browser-only modules.
    void Promise.all([import('socket.io-client'),import('@/api/index')]).then(([{io},{readToken}])=>{
    connecting=false;if(!active||!enabled.value||socket)return;
    socket=io('/aiqc-learning',{auth:cb=>cb({token:readToken()??''}),transports:['websocket'],autoConnect:false});
    socket.on('connect',()=>{live.value=true;void refresh();schedule();});
    socket.on('disconnect',()=>{live.value=false;schedule();});
    socket.on('connect_error',()=>{live.value=false;});
    socket.on('aiqc:learning-drafts-changed',()=>{revision.value++;void refresh();});
    socket.connect();
    }).catch(()=>{connecting=false;});
  }
  function stop(){socket?.disconnect();socket=undefined;live.value=false;if(timer)clearTimeout(timer);}
  watch(enabled,on=>{generation++;if(on){void refresh();connect();schedule();}else{stop();summary.value=null;}});
  onMounted(()=>{if(!hasDocument())return;document.addEventListener('visibilitychange',onVisible);if(enabled.value){void refresh();connect();schedule();}});
  onUnmounted(()=>{active=false;if(hasDocument())document.removeEventListener('visibilitychange',onVisible);stop();});
  /** Local action finished: bump revision so lists reload, and refresh the badge immediately. */
  const touch=()=>{revision.value++;void refresh();};
  return {summary,revision,live,refresh,touch};
}
