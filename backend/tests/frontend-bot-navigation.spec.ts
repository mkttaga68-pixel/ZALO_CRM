import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
vi.mock('vue-router', async importOriginal => { const actual = await importOriginal<typeof import('vue-router')>(); return { ...actual, createWebHistory: actual.createMemoryHistory }; });
const f = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../frontend/src/api/index.ts', () => ({ api: { get: f.get } }));
vi.mock('../../frontend/src/composables/use-org-timezone.ts', () => ({ refreshOrgTimezone: vi.fn() }));
import { useAuthStore } from '../../frontend/src/stores/auth';
import { router } from '../../frontend/src/router';
beforeEach(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  setActivePinia(createPinia());
  // Keep the real router/guards, but never import/render CRM view components.
  for (const r of router.getRoutes()) if (r.components) r.components.default = { render: () => null };
  const s = useAuthStore(); s.token = 'synthetic-token';
  s.user = { id: 'fixture-user', role: 'member', email: '', fullName: '', orgId: 'fixture-org', orgName: '', grants: {} };
  await router.push('/');
});
describe('Bot-Auto root respects available grants', () => {
  it('opens Blocks for a blocks-only member', async () => {
    const s = useAuthStore(); s.user!.grants = { bot_auto: { access: true }, block: { access: true } };
    await router.push('/automation/bot'); expect(router.currentRoute.value.path).toBe('/automation/bot/blocks');
  });
  it('opens Triggers for owner', async () => {
    useAuthStore().user!.role = 'owner'; await router.push('/automation/bot');
    expect(router.currentRoute.value.path).toBe('/automation/bot/triggers');
  });
  it('does not bypass the module gate', async () => {
    useAuthStore().user!.grants = { bot_auto: { access: false }, block: { access: true } };
    await router.push('/automation/bot'); expect(router.currentRoute.value.path).toBe('/');
  });
  it('keeps direct access to a forbidden tab denied', async () => {
    useAuthStore().user!.grants = { bot_auto: { access: true }, block: { access: true } };
    await router.push('/automation/bot/triggers'); expect(router.currentRoute.value.path).toBe('/');
  });
  it('also selects the permitted tab with a trailing slash', async () => {
    useAuthStore().user!.grants = { bot_auto: { access: true }, block: { access: true } };
    await router.push('/automation/bot/'); expect(router.currentRoute.value.path).toBe('/automation/bot/blocks');
  });
  it('preserves the token and cancels protected navigation if profile is temporarily unavailable', async () => {
    const s = useAuthStore(); s.user = null; f.get.mockRejectedValue({ response: { status: 503 } });
    await router.push('/automation/bot'); expect(s.token).toBe('synthetic-token');
    expect(router.currentRoute.value.path).toBe('/');
  });
});
