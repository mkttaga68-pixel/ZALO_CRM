import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['tests/native-ai-qc-monitoring.test.ts'],setupFiles:['tests/native-ai-quality-control.setup.ts'],maxWorkers:1,fileParallelism:false,testTimeout:10000,reporters:['default','json'],outputFile:{json:process.env.QC_TEST_ROOT+'/monitoring-results.json'}}});
