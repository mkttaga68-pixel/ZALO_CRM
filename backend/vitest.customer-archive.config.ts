import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['tests/customer-archive.test.ts'], setupFiles: ['tests/native-ai-quality-control.setup.ts'], fileParallelism: false, maxWorkers: 1, testTimeout: 15000 } });
