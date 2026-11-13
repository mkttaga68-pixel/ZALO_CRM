import path from 'node:path';import fs from 'node:fs';import {fileURLToPath} from 'node:url';
import {createServer} from '../frontend/node_modules/vite/dist/node/index.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),runtime=path.resolve(repo,'..','native-ai-qc-runtime','mvxj0im3','local-dev');
if(process.env.VITE_API_PROXY_TARGET!=='http://127.0.0.1:3091'||process.env.CI!=='true')throw Error('LOCAL_SANDBOX_PROXY_REQUIRED');
const server=await createServer({root:path.join(repo,'frontend'),configFile:path.join(repo,'frontend/vite.config.ts'),cacheDir:path.join(runtime,'vite-cache'),server:{host:'127.0.0.1',port:5173,strictPort:true}});
if(server.config.server.proxy['/api']!=='http://127.0.0.1:3091')throw Error('LOCAL_PROXY_MISMATCH');
await server.listen();fs.writeFileSync(path.join(runtime,'frontend-version.json'),JSON.stringify({pid:process.pid,root:server.config.root,proxy:'http://127.0.0.1:3091',port:5173,hmr:true,cache:server.config.cacheDir},null,2));console.log('AI_QC_LOCAL_FRONTEND_READY_5173');
