import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['tests/aiqc-learning-drafts.test.ts'], setupFiles: ['tests/aiqc-learning.setup.ts'], fileParallelism: false, maxWorkers: 1, testTimeout: 15000, reporters: ['default', 'json'], outputFile: { json: process.env.QC_TEST_ROOT + '/results.json' } } });
