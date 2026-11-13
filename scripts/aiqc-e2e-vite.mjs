import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createServer} from '../frontend/node_modules/vite/dist/node/index.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(repo,'..','aiqc-browser-e2e-20261101');
if(process.env.VITE_API_PROXY_TARGET!=='http://127.0.0.1:3091'||process.env.VITE_AI_QC_MONITORING_ENABLED!=='true'||process.env.CI!=='true')throw Error('SANDBOX_VITE_ENV_INVALID');
const server=await createServer({root:path.join(repo,'frontend'),configFile:path.join(repo,'frontend/vite.config.ts'),cacheDir:path.join(out,'vite-cache'),server:{host:'127.0.0.1',port:5174,strictPort:true}});
if(server.config.server.proxy['/api']!=='http://127.0.0.1:3091')throw Error('SANDBOX_PROXY_MISMATCH');
await server.listen();fs.writeFileSync(path.join(out,'vite-version.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,port:5174,host:'127.0.0.1',proxy:'http://127.0.0.1:3091',cacheDir:server.config.cacheDir,monitoringBuild:true},null,2));console.log('SANDBOX_VITE_READY_5174');
process.on('exit',code=>{fs.writeFileSync(path.join(out,'vite-exit.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,code}));});
