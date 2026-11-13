import {defineConfig} from '../backend/node_modules/vitest/dist/config.js';
import vue from './node_modules/@vitejs/plugin-vue/dist/index.mjs';
import {fileURLToPath} from 'node:url';
// Compile client render functions for the in-memory Vue renderer, without a browser.
const clientVue=vue();
for(const hook of ['load','transform']){
  const handler=clientVue[hook].handler;
  clientVue[hook].handler=function(...args){args[args.length-1]={...args[args.length-1],ssr:false};return handler.apply(this,args);};
}
export default defineConfig({envDir:false,plugins:[clientVue],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},test:{environment:'node',include:['tests/department-job-warnings.test.ts','tests/knowledge-groups.test.ts','tests/knowledge-library-groups.test.ts'],maxWorkers:1,fileParallelism:false}});
