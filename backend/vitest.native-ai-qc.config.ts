import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['tests/native-ai-quality-control.test.ts'], setupFiles: ['tests/native-ai-quality-control.setup.ts'], fileParallelism: false, maxWorkers: 1, testTimeout: 10000, reporters: ['default', 'json'], outputFile: { json: process.env.QC_TEST_ROOT + '/results.json' } } });
