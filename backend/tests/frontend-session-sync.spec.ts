import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
const f = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), responseReject: null as any, replace: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => ({ get: f.get, post: f.post, interceptors: { request: { use: vi.fn() }, response: { use: (_ok: any, bad: any) => { f.responseReject = bad; } } } }) } }));
vi.mock('../../frontend/src/router/index.ts', () => ({ router: { currentRoute: { value: { path: '/chat' } }, replace: f.replace } }));
vi.mock('../../frontend/src/composables/use-org-timezone.ts', () => ({ refreshOrgTimezone: vi.fn() }));
import { useAuthStore } from '../../frontend/src/stores/auth';
function storage() { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v), removeItem: (k: string) => map.delete(k) }; }
const profile = { id: 'fixture-user', email: 'synthetic@example.invalid', fullName: 'Synthetic', role: 'member', orgId: 'fixture-org', orgName: 'Synthetic', grants: {} };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('localStorage', storage()); vi.stubGlobal('sessionStorage', storage()); setActivePinia(createPinia()); });
function loggedIn() { localStorage.setItem('token', 'synthetic-token'); const s = useAuthStore(); s.user = { ...profile }; return s; }
describe('session synchronization', () => {
  for (const status of [503, 500, undefined]) it(`preserves stored session on temporary profile failure ${status}`, async () => {
    const s = loggedIn(); f.get.mockRejectedValue({ response: status ? { status } : undefined });
    await expect(s.fetchProfile()).rejects.toBeDefined();
    expect(s.token).toBe('synthetic-token'); expect(localStorage.getItem('token')).toBe('synthetic-token');
    expect(s.profileError).toBeTruthy();
  });
  it('clears Pinia and both storage locations on HTTP 401', async () => {
    const s = loggedIn(); sessionStorage.setItem('token', 'old-session');
    await expect(f.responseReject({ response: { status: 401 }, config: { headers: { Authorization: 'Bearer synthetic-token' } } })).rejects.toBeDefined();
    expect(s.token).toBe(''); expect(s.user).toBeNull(); expect(s.isAuthenticated).toBe(false);
    expect(localStorage.getItem('token')).toBeNull(); expect(sessionStorage.getItem('token')).toBeNull();
    expect(f.replace).toHaveBeenCalledWith('/login');
  });
  it('does not let an older 401 response destroy a newer login', async () => {
    const s = loggedIn(); s.token = 'new-token'; localStorage.setItem('token', 'new-token');
    await expect(f.responseReject({ response: { status: 401 }, config: { headers: { Authorization: 'Bearer old-token' } } })).rejects.toBeDefined();
    expect(s.token).toBe('new-token'); expect(f.replace).not.toHaveBeenCalled();
  });
  it('does not restore a profile returned after logout', async () => {
    const s = loggedIn(); let resolve!: (v: unknown) => void;
    f.get.mockReturnValue(new Promise(r => { resolve = r; }));
    const pending = s.fetchProfile(); s.logout(); resolve({ data: profile }); await pending;
    expect(s.user).toBeNull(); expect(s.isAuthenticated).toBe(false);
  });
  it('clears a temporary error after successful profile reload', async () => {
    const s = loggedIn(); f.get.mockRejectedValueOnce({ response: { status: 503 } });
    await s.fetchProfile().catch(() => {}); f.get.mockResolvedValue({ data: profile }); await s.fetchProfile();
    expect(s.profileError).toBe(''); expect(s.isAuthenticated).toBe(true);
  });
  it('does not mark a new login authenticated until profile/grants are loaded', async () => {
    const s = useAuthStore(); f.post.mockResolvedValue({ data: { token: 'new-token', user: profile } });
    f.get.mockRejectedValue({ response: { status: 503 } });
    await expect(s.login('synthetic@example.invalid', 'synthetic-password')).rejects.toBeDefined();
    expect(s.user).toBeNull(); expect(s.isAuthenticated).toBe(false);
    expect(localStorage.getItem('token')).toBe('new-token');
  });
});
