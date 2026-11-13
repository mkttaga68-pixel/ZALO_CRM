// Preloaded BEFORE app imports. This is a local synthetic runtime, never production.
import net from 'node:net';import http from 'node:http';import https from 'node:https';import tls from 'node:tls';import dns from 'node:dns';import dgram from 'node:dgram';import path from 'node:path';import fs from 'node:fs';
import {createOpenAiOnlyFetch} from './native-ai-qc-openai-transport.mjs';
import {isPublicAddress} from '../backend/dist/shared/utils/ssrf-guard.js';
const root=process.env.AI_QC_RUNTIME_ROOT,dbPort=Number(process.env.AI_QC_RUNTIME_DB_PORT);
if(process.env.NODE_ENV!=='test'||process.env.AI_QC_SANDBOX_RUNTIME!=='true'||!root||!path.isAbsolute(root)||!Number.isInteger(dbPort)||dbPort<1024)throw Error('Invalid synthetic runtime guard configuration');
const openAI=process.env.AI_QC_REAL_API_ENABLED==='true'&&process.env.AI_QC_OUTBOUND_TEST_APPROVED==='true'&&process.env.AI_QC_CREDENTIAL_SOURCE==='WINDOWS_DPAPI'&&!!process.env.OPENAI_API_KEY&&!!process.env.OPENAI_MODEL;
const sensitive=Object.keys(process.env).filter(k=>/TOKEN|COOKIE|SECRET|PASSWORD|API_KEY|AUTH_KEY|ENCRYPTION_KEY|PROXY/i.test(k)&&!['JWT_SECRET','ENCRYPTION_KEY',...(openAI?['OPENAI_API_KEY']:[])].includes(k));
if(sensitive.length)throw Error('Inherited sensitive environment sources rejected');
if(process.env.AI_QC_REAL_DATA_ENABLED!=='false'||process.env.AI_QC_REAL_DATA_OUTBOUND_APPROVED!=='false'||!openAI&&(process.env.AI_QC_REAL_API_ENABLED!=='false'||process.env.AI_QC_OUTBOUND_TEST_APPROVED!=='false'))throw Error('Real data remains disabled; API requires explicit DPAPI synthetic authorization');
const denied=()=>{throw Error('SYNTHETIC_RUNTIME_OUTBOUND_DENIED');};
const original=net.Socket.prototype.connect,rawFetch=globalThis.fetch.bind(globalThis),rawResolve=dns.promises.lookup.bind(dns.promises),rawTls=tls.connect.bind(tls);let apiPin=null;
net.Socket.prototype.connect=function(...args){const arg=Array.isArray(args[0])?args[0][0]:args[0];const options=arg&&typeof arg==='object'?arg:{port:arg,host:typeof args[1]==='string'?args[1]:'localhost'};if(!options.path&&Number(options.port)===dbPort&&options.host==='127.0.0.1')return Reflect.apply(original,this,args);if(!options.path&&openAI&&apiPin&&Number(options.port)===443&&['api.openai.com',apiPin].includes(options.host)){const pinned={...options,host:apiPin,port:443,lookup:(_host,_options,callback)=>callback(null,apiPin,4)};return Reflect.apply(original,this,[pinned,...args.slice(1)]);}return denied();};
globalThis.fetch=openAI?createOpenAiOnlyFetch({enabled:true,model:process.env.OPENAI_MODEL,resolve:host=>rawResolve(host,{all:true,verbatim:true}),publicAddress:isPublicAddress,pin:address=>{apiPin=address;},fetch:rawFetch}):denied;
http.request=denied;http.get=denied;https.request=denied;https.get=denied;
tls.connect=(options,...rest)=>{if(!openAI||!apiPin||!options||typeof options!=='object'||options.socket||Number(options.port)!==443||options.servername!=='api.openai.com'||!['api.openai.com',apiPin].includes(options.host))return denied();return rawTls({...options,host:apiPin,servername:'api.openai.com',rejectUnauthorized:true,checkServerIdentity:(_host,certificate)=>tls.checkServerIdentity('api.openai.com',certificate)},...rest);};
dgram.createSocket=denied;
dns.lookup=(host,options,callback)=>{const address=host==='127.0.0.1'?'127.0.0.1':openAI&&apiPin&&host==='api.openai.com'?apiPin:null;if(!address)return denied();const cb=typeof options==='function'?options:callback;queueMicrotask(()=>options?.all?cb(null,[{address,family:4}]):cb(null,address,4));};
for(const key of ['resolve','resolve4','resolve6','lookup','reverse'])if(key in dns.promises)dns.promises[key]=denied;
let blocked=false;try{new net.Socket().connect(443,'api.openai.com');}catch(error){blocked=error.message==='SYNTHETIC_RUNTIME_OUTBOUND_DENIED';}
if(!blocked)throw Error('Network guard self-check failed');
Object.defineProperty(globalThis,Symbol.for('zlcrm.synthetic-qc-runtime'),{value:Object.freeze({root,dbPort,openAI}),writable:false,configurable:false});
fs.writeFileSync(path.join(root,'backend-isolation.json'),JSON.stringify({at:new Date().toISOString(),allowedTCP:{host:'127.0.0.1',port:dbPort},openAI:openAI?'POST https://api.openai.com/v1/responses; synthetic strict schema only; public DNS pinning; TLS verification; no redirects':'DENIED',otherOutbound:'DENIED',credentialsInherited:false,credentialSource:openAI?'WINDOWS_DPAPI':'NONE',networkProbe:'BLOCKED_BEFORE_CONNECT',productionData:false},null,2));
