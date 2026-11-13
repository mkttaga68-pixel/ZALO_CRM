import { defineConfig } from '../backend/node_modules/vitest/dist/config.js';
import vue from './node_modules/@vitejs/plugin-vue/dist/index.mjs';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [vue({template:{transformAssetUrls:false}})],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/strict-navigation.test.ts', 'tests/purge-permission.test.ts', 'tests/access-policy.test.ts', 'tests/permission-catalog.test.ts'], maxWorkers: 1 },
});
