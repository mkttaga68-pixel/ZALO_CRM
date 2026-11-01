import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkOrBackfill, PENDING_SQL, UPDATE_SQL } = require('../../scripts/bot-auto-backfill.cjs');
let db: PGlite;
beforeEach(async () => {
  // Disposable embedded PostgreSQL, memory only. No DSN, server or production schema.
  db = new PGlite();
  await db.exec('CREATE TABLE permission_groups (id text PRIMARY KEY, grants jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
  for (const [id, grants] of [
    ['legacy', { block: { access: true } }],
    ['explicit-off', { bot_auto: { access: false }, block: { edit: true } }],
    ['no-access', { contact: { access: true }, block: { access: false } }],
    ['enabled', { bot_auto: { access: true }, trigger: { access: true } }],
  ]) await db.query('INSERT INTO permission_groups(id,grants) VALUES ($1,$2::jsonb)', [id, JSON.stringify(grants)]);
}, 30000);
afterEach(async () => { await db?.close(); });
describe('Bot-Auto backfill on disposable PostgreSQL', () => {
  it('backfills only legacy grants, preserves explicit denial and is idempotent', async () => {
    expect(await checkOrBackfill(db)).toBe(1);
    expect(await checkOrBackfill(db, true)).toBe(0);
    const rows = (await db.query<{ id: string; grants: any }>('SELECT id,grants FROM permission_groups ORDER BY id')).rows;
    expect(rows.find(r => r.id === 'legacy')!.grants).toEqual({ block: { access: true }, bot_auto: { access: true } });
    expect(rows.find(r => r.id === 'explicit-off')!.grants.bot_auto.access).toBe(false);
    expect(rows.find(r => r.id === 'no-access')!.grants.bot_auto).toBeUndefined();
    await checkOrBackfill(db, true);
    expect((await db.query('SELECT id,grants FROM permission_groups ORDER BY id')).rows).toEqual(rows);
  }, 30000);
  it('rolls back actual SQL updates when post-update verification fails', async () => {
    let updated = false;
    const client = { query: async (sql: string) => {
      if (updated && sql === PENDING_SQL) throw new Error('fixture verification failed');
      const result = await db.query(sql); if (sql === UPDATE_SQL) updated = true; return result;
    } };
    await expect(checkOrBackfill(client, true)).rejects.toThrow('fixture verification failed');
    expect(await checkOrBackfill(db)).toBe(1);
  }, 30000);
});
