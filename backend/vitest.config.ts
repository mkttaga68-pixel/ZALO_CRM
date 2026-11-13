import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Native QC has its own scrubbed, outbound-denied runner/config.
    exclude: ['tests/native-ai-quality-control.test.ts','tests/native-ai-qc-monitoring*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/*.ts', 'src/shared/**/*.ts'],
    },
  },
});
