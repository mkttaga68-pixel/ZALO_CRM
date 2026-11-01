import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: { status: { findMany: vi.fn().mockResolvedValue([]) } } }));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({ authMiddleware: async (req: any) => { req.user = { id: 'synthetic-user', orgId: 'synthetic-org', role: 'owner' }; } }));
vi.mock('../src/modules/activity/activity-logger.js', () => ({ logActivity: vi.fn(), computeDiff: vi.fn() }));
vi.mock('../src/shared/utils/logger.js', () => ({ logger: { error: vi.fn() } }));
import { appointmentRoutes } from '../src/modules/contacts/appointment-routes.js';
import { statusRoutes } from '../src/modules/contacts/status-routes.js';

function frontendCall(file: string, prefix: string) {
  const source = readFileSync(new URL(`../../frontend/src/${file}`, import.meta.url), 'utf8');
  const script = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  const tree = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true);
  const calls: Array<{ method: string; path: string }> = [];
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(tree) === 'api') {
      const arg = n.arguments[0];
      const url = arg && ts.isStringLiteralLike(arg) ? arg.text : arg && ts.isTemplateExpression(arg) ? arg.head.text + ':id' : '';
      if (url.startsWith(prefix)) calls.push({ method: n.expression.name.text.toUpperCase(), path: '/api/v1' + url });
    }
    ts.forEachChild(n, visit);
  }
  visit(tree); expect(calls).toHaveLength(1); return calls[0]!;
}
describe('frontend calls match registered backend routes', () => {
  it('appointment edit uses an existing backend method/path', async () => {
    const call = frontendCall('components/appointments/AppointmentEditor.vue', '/appointments/');
    const app = Fastify(); await app.register(appointmentRoutes); await app.ready();
    try { expect(app.hasRoute({ method: call.method as any, url: call.path })).toBe(true); }
    finally { await app.close(); }
  });
  it('block status selector loads the actual statuses endpoint', async () => {
    const call = frontendCall('views/automation/BlocksView.vue', '/');
    // Other block operations use blocksApi, so this is the selector's sole api call.
    const app = Fastify(); await app.register(statusRoutes);
    try {
      const result = await app.inject({ method: call.method as any, url: call.path });
      expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ statuses: [] });
    } finally { await app.close(); }
  });
});
