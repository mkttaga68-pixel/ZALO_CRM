import { defineConfig } from '../backend/node_modules/vitest/dist/config.js';
import vue from './node_modules/@vitejs/plugin-vue/dist/index.mjs';
import {fileURLToPath} from 'node:url';
export default defineConfig({plugins:[vue()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},test:{environment:'node',include:['tests/native-ai-quality-control.test.ts'],setupFiles:['../backend/tests/native-ai-quality-control.setup.ts'],maxWorkers:1,fileParallelism:false,reporters:['default','json'],outputFile:{json:process.env.QC_TEST_ROOT+'/frontend-results.json'}}});
