// Bot-Auto module permission (2026-10-26) — công tắc tổng cho tab 🤖.
// Luật: resource con chỉ có hiệu lực khi bot_auto.access = true (AND, không phải OR).

import { describe, it, expect } from 'vitest';
import {
  RESOURCES,
  RESOURCE_ACTIONS,
  BOT_AUTO_RESOURCES,
  RESOURCE_MODULE,
  hasGrant,
  sanitizeGrants,
  DEFAULT_PERMISSION_GROUPS,
  type GrantsJson,
} from '../src/modules/rbac/permission-types.js';

describe('bot_auto resource', () => {
  it('nằm trong ma trận và chỉ có action access', () => {
    expect(RESOURCES).toContain('bot_auto');
    expect(RESOURCE_ACTIONS.bot_auto).toEqual(['access']);
  });

  it('gom đúng 5 resource con của tab Bot-Auto', () => {
    expect([...BOT_AUTO_RESOURCES].sort()).toEqual(
      ['block', 'broadcast', 'customer_list', 'sequence', 'trigger'].sort(),
    );
  });

  it('không gate các resource ngoài module', () => {
    for (const r of ['contact', 'conversation', 'webhook', 'zalo_account', 'settings'] as const) {
      expect(RESOURCE_MODULE[r]).toBeUndefined();
    }
  });
});

describe('hasGrant — module gate', () => {
  const full: GrantsJson = {
    bot_auto: { access: true },
    trigger: { access: true, create: true, edit: true },
    contact: { access: true },
  };

  it('cho qua khi module bật và ô con được tick', () => {
    expect(hasGrant(full, 'trigger', 'access')).toBe(true);
    expect(hasGrant(full, 'trigger', 'create')).toBe(true);
  });

  it('chặn sạch resource con khi module tắt, dù ô con vẫn tick', () => {
    const off: GrantsJson = { ...full, bot_auto: { access: false } };
    expect(hasGrant(off, 'trigger', 'access')).toBe(false);
    expect(hasGrant(off, 'trigger', 'create')).toBe(false);
    expect(hasGrant(off, 'trigger', 'edit')).toBe(false);
  });

  it('chặn khi thiếu hẳn khoá bot_auto (grants cũ chưa backfill)', () => {
    const legacy: GrantsJson = { trigger: { access: true, create: true } };
    expect(hasGrant(legacy, 'trigger', 'access')).toBe(false);
  });

  it('không ảnh hưởng resource ngoài module', () => {
    const off: GrantsJson = { ...full, bot_auto: { access: false } };
    expect(hasGrant(off, 'contact', 'access')).toBe(true);
  });

  it('bật module nhưng không tick ô con thì vẫn deny', () => {
    const moduleOnly: GrantsJson = { bot_auto: { access: true } };
    for (const r of BOT_AUTO_RESOURCES) {
      expect(hasGrant(moduleOnly, r, 'access')).toBe(false);
    }
  });
});

describe('sanitizeGrants', () => {
  it('giữ bot_auto.access', () => {
    expect(sanitizeGrants({ bot_auto: { access: true } })).toEqual({ bot_auto: { access: true } });
  });

  it('strip action không hợp lệ trên bot_auto', () => {
    expect(sanitizeGrants({ bot_auto: { access: true, delete: true, view_all: true } }))
      .toEqual({ bot_auto: { access: true } });
  });
});

describe('DEFAULT_PERMISSION_GROUPS', () => {
  it('nhóm nào có quyền trên resource con thì phải có bot_auto.access', () => {
    for (const grp of DEFAULT_PERMISSION_GROUPS) {
      const usesBotAuto = BOT_AUTO_RESOURCES.some((r) =>
        Object.values(grp.grants[r] ?? {}).some((v) => v === true),
      );
      if (!usesBotAuto) continue;
      expect(
        grp.grants.bot_auto?.access,
        `Nhóm "${grp.name}" có quyền Bot-Auto con nhưng thiếu bot_auto.access → mất quyền sau deploy`,
      ).toBe(true);
    }
  });

  it('Admin giữ nguyên full quyền trên mọi resource con', () => {
    const admin = DEFAULT_PERMISSION_GROUPS.find((g) => g.name === 'Admin')!;
    for (const r of BOT_AUTO_RESOURCES) {
      for (const a of RESOURCE_ACTIONS[r]) {
        expect(hasGrant(admin.grants, r, a), `Admin.${r}.${a}`).toBe(true);
      }
    }
  });

  it('Hành chính - Nhân sự không được cấp Bot-Auto', () => {
    const hr = DEFAULT_PERMISSION_GROUPS.find((g) => g.name === 'Hành chính - Nhân sự')!;
    expect(hr.grants.bot_auto?.access).toBeUndefined();
  });
});
