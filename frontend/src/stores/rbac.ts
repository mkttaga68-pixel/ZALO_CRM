/**
 * stores/rbac.ts — Pinia store cho RBAC (Department + PermissionGroup + Users).
 *
 * Endpoints:
 *   GET /departments                  → tree (root nodes với children)
 *   GET /permission-groups            → tree
 *   GET /permission-groups/meta       → resources + actions matrix shape
 *   GET /rbac/users                   → list (filter ?departmentId= ?permissionGroupId= ?q=)
 *   POST /admin/rbac/seed-default-groups → seed 7 system group (idempotent)
 */
import { defineStore } from 'pinia';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';

export interface DepartmentNode {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  displayOrder: number;
  archivedAt: string | null;
  memberCount: number;
  leaderUserId: string | null;
  deputyUserId: string | null;
  children: DepartmentNode[];
}

export interface PermissionGroupNode {
  id: string;
  name: string;
  parentId: string | null;
  isSystem: boolean;
  displayOrder: number;
  grants: Record<string, Record<string, boolean>>;
  memberCount: number;
  children: PermissionGroupNode[];
  canEdit?: boolean;
  canDelete?: boolean;
}

export interface RbacUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  permissionGroupId: string | null;
  permissionGroup: { id: string; name: string; isSystem: boolean } | null;
  departmentMember: {
    departmentId: string;
    deptRole: 'leader' | 'deputy' | 'member';
    department: { id: string; name: string; path: string };
  } | null;
  isActive: boolean;
  canManageAccess?: boolean;
  canManagePermissions?: boolean;
  assignableGroupIds?: string[];
}

export const useRbacStore = defineStore('rbac', {
  state: () => ({
    departments: [] as DepartmentNode[],
    permissionGroups: [] as PermissionGroupNode[],
    users: [] as RbacUser[],
    matrixMeta: null as null | { resources: string[]; actions: string[]; resourceActions: Record<string, string[]>; authority?: { actorGroupId: string | null; canCreateRoot: boolean } },
    loading: false,
  }),
  actions: {
    async loadDepartments() {
      if (!useAuthStore().hasGrant('department')) { this.departments = []; return; }
      this.loading = true;
      try {
        const { data } = await api.get('/departments');
        this.departments = data.tree ?? [];
      } finally {
        this.loading = false;
      }
    },
    async loadPermissionGroups() {
      if (!useAuthStore().hasGrant('permission_group')) { this.permissionGroups = []; this.matrixMeta = null; return; }
      this.loading = true;
      try {
        const [tree, meta] = await Promise.all([
          api.get('/permission-groups'),
          api.get('/permission-groups/meta'),
        ]);
        this.permissionGroups = tree.data.tree ?? [];
        this.matrixMeta = meta.data;
      } finally {
        this.loading = false;
      }
    },
    async loadUsers(filter: { departmentId?: string; permissionGroupId?: string; q?: string } = {}) {
      if (!useAuthStore().hasGrant('user')) { this.users = []; return; }
      this.loading = true;
      try {
        const params = new URLSearchParams();
        if (filter.departmentId) params.set('departmentId', filter.departmentId);
        if (filter.permissionGroupId) params.set('permissionGroupId', filter.permissionGroupId);
        if (filter.q) params.set('q', filter.q);
        const { data } = await api.get('/rbac/users?' + params.toString());
        this.users = data.users ?? [];
      } finally {
        this.loading = false;
      }
    },
    async createDepartment(input: { name: string; parentId: string | null }) {
      await api.post('/departments', input);
      await this.loadDepartments();
    },
    async renameDepartment(id: string, name: string) {
      await api.patch(`/departments/${id}`, { name });
      await this.loadDepartments();
    },
    async moveDepartment(id: string, parentId: string | null) {
      await api.patch(`/departments/${id}`, { parentId });
      await this.loadDepartments();
    },
    async archiveDepartment(id: string) {
      await api.delete(`/departments/${id}`);
      await this.loadDepartments();
    },
    async assignMember(deptId: string, userId: string, deptRole: 'leader' | 'deputy' | 'member') {
      await api.post(`/departments/${deptId}/members`, { userId, deptRole });
      await Promise.all([this.loadDepartments(), this.loadUsers()]);
    },
    async createPermissionGroup(input: { name: string; parentId: string | null; cloneFromId?: string }) {
      await api.post('/permission-groups', input);
      await this.loadPermissionGroups();
    },
    async updateGroupGrants(id: string, grants: Record<string, Record<string, boolean>>) {
      await api.patch(`/permission-groups/${id}`, { grants });
      await this.loadPermissionGroups();
    },
    async setUserPermissionGroup(userId: string, permissionGroupId: string | null) {
      await api.patch(`/rbac/users/${userId}/permission-group`, { permissionGroupId });
      await this.loadUsers();
    },
    async seedDefaultGroups() {
      const { data } = await api.post('/admin/rbac/seed-default-groups');
      await this.loadPermissionGroups();
      return data;
    },
    async migrateLegacyUsers() {
      const { data } = await api.post('/admin/rbac/migrate-legacy-users');
      await this.loadUsers();
      return data;
    },
  },
});
