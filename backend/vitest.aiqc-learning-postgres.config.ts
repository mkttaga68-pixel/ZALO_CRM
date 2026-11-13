import { defineConfig } from 'vitest/config';
// Runs ONLY via scripts/run-aiqc-learning-postgres-tests.cjs (fresh disposable PostgreSQL 18 cluster on loopback).
export default defineConfig({ test: { environment: 'node', include: ['tests/aiqc-learning-postgres.test.ts'], setupFiles: ['tests/aiqc-learning.setup.ts'], fileParallelism: false, maxWorkers: 1, testTimeout: 60000, hookTimeout: 60000, reporters: ['default', 'json'], outputFile: { json: process.env.QC_TEST_ROOT + '/results.json' } } });
