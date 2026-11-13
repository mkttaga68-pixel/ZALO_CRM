import { prisma } from '../../shared/database/prisma-client.js';
import { hasGrant, RESOURCES, RESOURCE_ACTIONS, type Action, type GrantsJson, type Resource } from './permission-types.js';

export interface AuthorityUser { id: string; orgId: string; role: string; isActive: boolean; permissionGroupId: string | null }
export interface AuthorityGroup { id: string; parentId: string | null; grants: unknown; archivedAt?: Date | null }
export interface PermissionAuthority { actor: AuthorityUser; users: AuthorityUser[]; groups: AuthorityGroup[] }
export class PermissionAuthorityError extends Error {
  readonly statusCode = 403;
  readonly code = 'PERMISSION_HIERARCHY_FORBIDDEN';
  constructor(message = 'Chỉ Owner/Admin được sửa quyền, và chỉ sửa được người có vai trò thấp hơn mình (không tự sửa, không sửa người ngang cấp)') { super(message); }
}
const rank = (role: string): number => ({owner:3,admin:2,member:1}[role] ?? 0);
/** Chỉ owner/admin được quản trị phân quyền. Owner là cấp cao nhất của toàn hệ thống. */
export const isPermissionManagerRole = (role: string): boolean => role === 'owner' || role === 'admin';
/** Các hành động thay đổi phân quyền: chỉ owner/admin, kể cả khi nhóm của member được tích nhầm. */
const managerOnly = (resource: Resource, action: Action): boolean => resource === 'permission_group' && action !== 'access';
export function isGroupAncestor(groups: AuthorityGroup[], ancestor: string | null, child: string | null): boolean {
  if (!ancestor || !child || ancestor === child) return false;
  const seen = new Set<string>();
  let current = child;
  let found = false;
  while (current && !seen.has(current)) {
    seen.add(current);
    const group = groups.find(g => g.id === current);
    if (!group) return false;
    const parent = group.parentId;
    if (!parent) return found;
    if (parent === ancestor) found = true;
    current = parent;
  }
  return false;
}
export function isStrictlyAbove(authority: PermissionAuthority, target: AuthorityUser): boolean {
  const { actor } = authority;
  if (!actor.isActive || !isPermissionManagerRole(actor.role) || actor.id === target.id || actor.orgId !== target.orgId || !rank(target.role)) return false;
  // Ngang vai trò không quản lý nhau (admin↔admin, owner↔owner), kể cả khi nhóm quyền
  // là cha/con. Owner quản lý admin + member; admin chỉ quản lý member.
  return rank(actor.role) > rank(target.role);
}
export function authorityHasGrant(authority: PermissionAuthority, resource: Resource, action: Action): boolean {
  if (authority.actor.role === 'owner') return true;
  if (managerOnly(resource, action) && !isPermissionManagerRole(authority.actor.role)) return false;
  const group = authority.groups.find(g => g.id === authority.actor.permissionGroupId);
  return !!group && hasGrant((group.grants ?? {}) as GrantsJson, resource, action);
}
export function assertAuthorityGrant(authority: PermissionAuthority, resource: Resource, action: Action): void {
  if (!authorityHasGrant(authority,resource,action)) throw new PermissionAuthorityError('Bạn chưa được cấp quyền quản lý tương ứng');
}
export function assertManageUser(authority: PermissionAuthority, targetId: string): AuthorityUser {
  const target = authority.users.find(u => u.id === targetId);
  if (!target || !isStrictlyAbove(authority,target)) throw new PermissionAuthorityError();
  return target;
}
export function canManageGroup(authority: PermissionAuthority, groupId: string): boolean {
  if (!authority.groups.some(g => g.id === groupId) || (authority.actor.role !== 'owner' &&
      (groupId === authority.actor.permissionGroupId || isGroupAncestor(authority.groups,groupId,authority.actor.permissionGroupId)))) return false;
  const affected = authority.groups.filter(g => g.id === groupId || isGroupAncestor(authority.groups,groupId,g.id));
  const affectedIds = new Set(affected.map(g=>g.id));
  // Owner's effective permissions come from the role bypass; a legacy group
  // assignment must not lock the Owner out of managing that group's members.
  const members = authority.users.filter(u=>u.id !== authority.actor.id && u.permissionGroupId && affectedIds.has(u.permissionGroupId));
  if (members.some(u=>!isStrictlyAbove(authority,u))) return false;
  // An empty group has no effective target yet, so any manager with a valid
  // permission_group.edit grant may configure it. Once assigned to a peer or
  // superior, the member check above locks it against that manager. This keeps
  // seeded, currently unassigned role groups manageable without granting a
  // way to change the actor's own or a peer's effective permissions.
  return true;
}
export function assertManageGroup(authority: PermissionAuthority, groupId: string): void {
  if (!canManageGroup(authority,groupId)) throw new PermissionAuthorityError('Không được sửa nhóm của mình, nhóm ngang/cấp trên hoặc nhóm chứa người ngang/cấp trên');
}
export function assertGrantEnvelope(authority: PermissionAuthority, grants: unknown): void {
  if (authority.actor.role === 'owner') return;
  for (const r of RESOURCES) for (const a of RESOURCE_ACTIONS[r]) {
    // Include explicitly checked dormant actions: they must not become a stored
    // escalation once somebody enables the module/access switch later.
    if ((grants as GrantsJson)?.[r]?.[a] === true && !authorityHasGrant(authority,r,a))
      throw new PermissionAuthorityError('Không được cấp hoặc sao chép quyền vượt quá quyền của bạn');
  }
}
export function assertGroupParent(authority: PermissionAuthority, parentId: string | null): void {
  if (parentId && !authority.groups.some(g=>g.id===parentId)) throw new PermissionAuthorityError('Nhóm cha không hợp lệ trong tổ chức');
  if (authority.actor.role === 'owner') return;
  if (!parentId || (parentId !== authority.actor.permissionGroupId &&
      !isGroupAncestor(authority.groups,authority.actor.permissionGroupId,parentId))) throw new PermissionAuthorityError('Chỉ được tạo/chuyển nhóm bên dưới nhóm quyền của bạn');
}
export function assertAssignGroup(authority: PermissionAuthority, targetId: string, groupId: string | null): void {
  assertManageUser(authority,targetId);
  assertAuthorityGrant(authority,'permission_group','edit');
  if (!groupId) return;
  assertManageGroup(authority,groupId);
  assertGrantEnvelope(authority,authority.groups.find(g=>g.id===groupId)?.grants);
}
export function assertNewRole(authority: PermissionAuthority, role: unknown): void {
  if (!isPermissionManagerRole(authority.actor.role)) throw new PermissionAuthorityError('Chỉ Owner hoặc Admin được cấp vai trò');
  if (typeof role !== 'string' || !rank(role) || rank(role) >= rank(authority.actor.role))
    throw new PermissionAuthorityError('Không được cấp vai trò ngang hoặc cao hơn chính mình');
}
// The app's Prisma client is extended with query hooks, so its transaction
// client is not structurally assignable to the generated TransactionClient.
// Keep this internal boundary loose; all queried/returned records are typed by
// the authority interfaces above.
export async function loadPermissionAuthority(db: any, actorId: string, orgId: string): Promise<PermissionAuthority> {
  const [users,groups] = await Promise.all([
    db.user.findMany({where:{orgId},select:{id:true,orgId:true,role:true,isActive:true,permissionGroupId:true}}),
    db.permissionGroup.findMany({where:{orgId,archivedAt:null},select:{id:true,parentId:true,grants:true,archivedAt:true}}),
  ]);
  const actor=users.find((u: AuthorityUser)=>u.id===actorId);
  if (!actor?.isActive) throw new PermissionAuthorityError('Phiên quản trị không còn hiệu lực');
  return {actor,users,groups};
}
export async function withPermissionAuthority<T>(actorId: string, orgId: string, resource: Resource, action: Action,
  mutate: (tx: any, authority: PermissionAuthority)=>Promise<T>): Promise<T> {
  return prisma.$transaction(async tx=>{
    // Same lock for every role/group/department membership writer. Read and write
    // in one serializable transaction; conflicts roll back, never silently retry.
    await tx.$queryRawUnsafe('SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1, 0))',`rbac-authority:${orgId}`);
    const authority=await loadPermissionAuthority(tx,actorId,orgId);
    assertAuthorityGrant(authority,resource,action);
    return mutate(tx,authority);
  },{isolationLevel:'Serializable'});
}
