import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: {} }));
import { assertAssignGroup, assertManageGroup, assertManageUser, assertNewRole, authorityHasGrant, canManageGroup, isStrictlyAbove,
  type AuthorityGroup, type AuthorityUser, type PermissionAuthority } from '../src/modules/rbac/permission-authority.js';

// Nhóm: g-ceo (cha) → g-manager → g-staff. Mọi nhóm đều được tích đủ quyền phân quyền + user.
const full = { permission_group: { access: true, create: true, edit: true, delete: true }, user: { access: true, create: true, edit: true, delete: true } };
const groups: AuthorityGroup[] = [
  { id: 'g-ceo', parentId: null, grants: full }, { id: 'g-manager', parentId: 'g-ceo', grants: full },
  { id: 'g-staff', parentId: 'g-manager', grants: full }, { id: 'g-empty', parentId: 'g-manager', grants: {} },
];
const u = (id: string, role: string, permissionGroupId: string | null): AuthorityUser => ({ id, orgId: 'org', role, isActive: true, permissionGroupId });
const users = [u('owner1', 'owner', null), u('owner2', 'owner', null), u('adminTop', 'admin', 'g-ceo'), u('adminSub', 'admin', 'g-manager'),
  u('memberLead', 'member', 'g-manager'), u('member1', 'member', 'g-staff'), u('member2', 'member', 'g-staff')];
const as = (id: string): PermissionAuthority => ({ actor: users.find(x => x.id === id)!, users, groups });
const target = (id: string) => users.find(x => x.id === id)!;

describe('phân quyền theo vai trò: chỉ Owner/Admin, ngang cấp không sửa nhau, Owner cao nhất', () => {
  it('Owner quản lý được Admin và Member, nhưng không sửa Owner khác hoặc chính mình', () => {
    for (const t of ['adminTop', 'adminSub', 'memberLead', 'member1']) expect(isStrictlyAbove(as('owner1'), target(t))).toBe(true);
    expect(isStrictlyAbove(as('owner1'), target('owner2'))).toBe(false);
    expect(isStrictlyAbove(as('owner1'), target('owner1'))).toBe(false);
  });
  it('Admin chỉ quản lý Member; không sửa Admin khác kể cả khi nhóm là cấp cha', () => {
    expect(isStrictlyAbove(as('adminTop'), target('member1'))).toBe(true);
    expect(isStrictlyAbove(as('adminTop'), target('adminSub'))).toBe(false); // trước đây được phép vì g-ceo là cha của g-manager
    expect(isStrictlyAbove(as('adminSub'), target('adminTop'))).toBe(false);
    expect(isStrictlyAbove(as('adminSub'), target('owner1'))).toBe(false);
    expect(() => assertManageUser(as('adminTop'), 'adminSub')).toThrow();
  });
  it('Member không sửa được ai, kể cả khi nhóm được tích quyền phân quyền', () => {
    expect(isStrictlyAbove(as('memberLead'), target('member1'))).toBe(false);
    for (const action of ['create', 'edit', 'delete'] as const) expect(authorityHasGrant(as('memberLead'), 'permission_group', action)).toBe(false);
    expect(authorityHasGrant(as('memberLead'), 'permission_group', 'access')).toBe(true); // vẫn xem được ma trận nếu được cấp
    expect(canManageGroup(as('memberLead'), 'g-empty')).toBe(true); // nhưng mọi API sửa đều chặn bởi quyền edit ở trên
    expect(() => assertAssignGroup(as('memberLead'), 'member1', 'g-staff')).toThrow();
    expect(() => assertNewRole(as('memberLead'), 'member')).toThrow();
  });
  it('Admin chỉ sửa nhóm chứa toàn Member; không sửa nhóm của mình hay nhóm có Admin', () => {
    expect(canManageGroup(as('adminTop'), 'g-staff')).toBe(true);
    expect(canManageGroup(as('adminTop'), 'g-ceo')).toBe(false); // nhóm của chính mình
    expect(canManageGroup(as('adminTop'), 'g-manager')).toBe(false); // có adminSub (ngang cấp)
    expect(() => assertManageGroup(as('adminSub'), 'g-ceo')).toThrow();
    expect(canManageGroup(as('owner1'), 'g-ceo')).toBe(true);
  });
  it('cấp vai trò: Owner cấp được Admin/Member, Admin chỉ cấp Member, không ai cấp Owner', () => {
    expect(() => assertNewRole(as('owner1'), 'admin')).not.toThrow();
    expect(() => assertNewRole(as('owner1'), 'owner')).toThrow();
    expect(() => assertNewRole(as('adminTop'), 'member')).not.toThrow();
    expect(() => assertNewRole(as('adminTop'), 'admin')).toThrow();
  });
  it('gán nhóm quyền: Admin gán được cho Member, không gán cho Admin khác', () => {
    expect(() => assertAssignGroup(as('adminTop'), 'member1', 'g-staff')).not.toThrow();
    expect(() => assertAssignGroup(as('adminTop'), 'adminSub', 'g-staff')).toThrow();
    expect(() => assertAssignGroup(as('owner1'), 'adminSub', 'g-ceo')).not.toThrow();
  });
});
