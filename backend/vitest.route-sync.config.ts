import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const local = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  root: local('.'), envDir: false,
  resolve: { alias: {
    '@': local('../frontend/src'),
    vue: local('../frontend/node_modules/vue/dist/vue.runtime.esm-bundler.js'),
    pinia: local('../frontend/node_modules/pinia/dist/pinia.mjs'),
    axios: local('../frontend/node_modules/axios/index.js'),
    'vue-router': local('../frontend/node_modules/vue-router/dist/vue-router.mjs'),
  } },
  test: { environment: 'node', include: ['tests/frontend-route-contract.spec.ts','tests/frontend-session-sync.spec.ts','tests/frontend-bot-navigation.spec.ts'] },
});
