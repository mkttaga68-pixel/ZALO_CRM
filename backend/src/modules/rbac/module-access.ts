import type { FastifyReply, FastifyRequest } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { userHasGrant } from './permission-group-service.js';
import type { Action, Resource } from './permission-types.js';

type Check = readonly [Resource, Action];
// OR between alternatives, AND within each alternative. Null = non-module route.
export type ModulePolicy = readonly (readonly Check[])[] | null;
const read = (resource: Resource): ModulePolicy => [[[resource, 'access']]];
const action = (resource: Resource, verb: Action): ModulePolicy => [[[resource, 'access'], [resource, verb]]];
const crud = (resource: Resource, method: string, pathname: string): ModulePolicy =>
  action(resource, ['GET','HEAD'].includes(method) ? 'access' : method === 'DELETE' ? 'delete' :
    method === 'POST' && /\/(contacts|appointments|users|teams|departments|permission-groups|integrations|saved-reports|rules|zalo-accounts|groups|requests|polls)$/.test(pathname) ? 'create' : 'edit');
const publicPaths = new Set(['/api/v1/setup/status', '/api/v1/setup', '/api/v1/auth/login', '/api/v1/branding', '/api/v1/health']);
const selfPaths = /^\/api\/v1\/(profile$|me(?:\/|$)|privacy(?:\/|$))/;

/** Fail closed for new v1 modules until their access policy is explicitly mapped.
 * Existing per-object/account/privacy/policy and action checks still run afterwards.
 * Public API keys and signed incoming webhooks keep their independent authentication.
 */
export function modulePolicy(pathname: string, method: string): ModulePolicy {
  if (!pathname.startsWith('/api/v1/')) return null;
  if (publicPaths.has(pathname)) return null;
  if (selfPaths.test(pathname)) return null;
  if (/^\/api\/v1\/integrations\/facebook\/(oauth\/callback|webhook)$/.test(pathname)) return null;
  if (/^\/api\/v1\/automation\/webhooks\//.test(pathname)) return null;
  const p = pathname.slice('/api/v1/'.length);
  const head = p.split('/')[0];
  const reading = ['GET','HEAD'].includes(method);
  if (head === 'search') return [[['contact','access'],['contact','view_all'],['conversation','access'],['conversation','view_all'],['appointment','access'],['appointment','view_all']]];
  if (head === 'notifications') return [[['conversation','access'],['conversation','view_all'],['appointment','access'],['appointment','view_all'],['zalo_account','access'],['zalo_account','view_all']]];
  if (head === 'permission-groups') return crud('permission_group', method, pathname);
  if (head === 'departments' || head === 'teams') return crud('department', method, pathname);
  if (head === 'users' || head === 'rbac') return crud('user', method, pathname);
  if (p === 'admin/rbac/seed-default-groups') return action('permission_group','create');
  if (p.startsWith('admin/rbac/')) return action('permission_group','edit');
  if (p.startsWith('admin/privacy/')) return action('user', reading ? 'access' : 'edit');
  if (p.startsWith('admin/engagement/')) return action('settings','edit');
  if (['admin/run-detector','admin/migrate-status-table'].includes(p)) return action('settings','edit');
  if (/^admin\/contact-purge(?:\/|$)/.test(p)) return read('contact_data_purge');
  if (/purge/.test(p) && (head === 'admin' || head === 'contacts')) return [[['settings','access'],['contact','access'],['contact','delete']]];
  if (head === 'dashboard') return read('dashboard');
  if (head === 'reports') return read('report');
  if (head === 'analytics') return read('analytics'); // POST custom is a read-only query.
  if (head === 'saved-reports') return crud('analytics',method,pathname);
  if (head === 'appointments') return crud('appointment',method,pathname);
  if (head === 'integrations') return crud('integration',method,pathname);
  if (p.startsWith('auto-reply/drafts')) return action('conversation',reading?'access':'edit');
  if (head === 'organization' || head === 'scoring' || head === 'telegram' || head === 'group-auto-reply' || head === 'auto-reply' || head === 'playbook') return action('settings',reading?'access':'edit');
  if (head === 'settings') {
    if (/^settings\/(webhook|api-key)(\/|$)/.test(p)) return action('webhook',reading?'access':'edit');
    // Read-only dictionaries are needed by contact/chat editors; no settings writes.
    if (reading && /^settings\/statuses(?:\/|$)/.test(p)) return [[['settings','access']],[['contact','access']],[['conversation','access']]];
    return action('settings',reading?'access':'edit');
  }
  if (head === 'ai') {
    if (/^ai\/(config|providers|usage)(\/|$)/.test(p)) return action('settings',reading?'access':'edit');
    return read('ai_assistant');
  }
  if (head === 'ai-quality-control') return read('ai_quality_control');
  if (head === 'manual-posting' || head === 'group-post-logs' || head === 'chao-hang') return read('posting');
  if (head === 'customer-lists') return read('customer_list'); // Route-level CRUD checks remain authoritative.
  if (head === 'automation') {
    const sub = p.split('/')[1];
    const bot: Record<string, Resource> = {blocks:'block','block-folders':'block',sequences:'sequence',triggers:'trigger',broadcasts:'broadcast'};
    return bot[sub ?? ''] ? read(bot[sub!]!) : crud('automation',method,pathname);
  }
  if (head === 'campaigns') return read('customer_list');
  if (head === 'leads') return action('engagement_score',reading?'access':'view_all');
  if (head === 'customers' || head === 'timeline') return read('audit_log');
  if (/^contacts\/[^/]+\/engagement-timeline$/.test(p)) return read('engagement_score');
  if (head === 'contacts') return crud('contact',method,pathname);
  if (head === 'notes') return action('contact',reading?'access':method==='DELETE'?'delete':'edit');
  if (head === 'crm-tags' || head === 'crm-tag-groups') return reading ? [[['settings','access']],[['contact','access']],[['conversation','access']]] : action('settings','edit');
  if (head === 'friends' || head === 'friends-db') return crud('friend',method,pathname);
  if (head === 'conversations' || head === 'messages' || head === 'attachments' || head === 'account-folders' || head === 'filter-presets' || head === 'templates' || head?.startsWith('zalo-sticker') || head === 'zalo-bankcard' || head === 'zalo-user-info') return action('conversation',reading?'access':method==='DELETE'?'delete':'edit');
  if (head === 'zalo-accounts') {
    if (/^zalo-accounts\/[^/]+\/groups(?:\/|$)/.test(p)) return crud('group',method,pathname);
    if (/^zalo-accounts\/[^/]+\/friends(?:\/|$)/.test(p)) return crud('friend',method,pathname);
    // The list is a scoped nick picker used in chat/friends; enriched admin pages
    // and account mutations still require zalo_account explicitly.
    if (p === 'zalo-accounts' && reading) return ['zalo_account','conversation','friend','group'].map(r=>[[r as Resource,'access']]);
    return crud('zalo_account',method,pathname);
  }
  return []; // Unclassified authenticated API: deny, including for legacy admin roles.
}

export async function strictModuleAccess(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const policy = modulePolicy(request.routeOptions.url ?? request.url.split('?')[0]!, request.method);
  if (policy === null) return;
  await authMiddleware(request, reply);
  if (reply.sent) return;
  const userId = request.user?.id;
  if (!userId) { reply.code(401).send({error:'Unauthorized'}); return; }
  // Request-local cache only: permission revocation applies on the next request.
  const cache = new Map<string, boolean>();
  try {
    const body = request.body as Record<string, unknown> | null;
    if (!['GET','HEAD'].includes(request.method) && /\/(rbac\/)?users(?:\/|$)/.test(request.routeOptions.url ?? '') &&
        (body && (Object.hasOwn(body,'permissionGroupId') || Object.hasOwn(body,'role')))) {
      if (!await userHasGrant(userId,'permission_group','edit')) {
        reply.code(403).send({error:'Bạn không có quyền gán vai trò hoặc nhóm quyền',code:'RBAC_FORBIDDEN'}); return;
      }
    }
    for (const alternative of policy) {
      let allowed = true;
      for (const [resource, verb] of alternative) {
        const key = `${resource}.${verb}`;
        if (!cache.has(key)) cache.set(key, await userHasGrant(userId, resource, verb));
        if (!cache.get(key)) { allowed = false; break; }
      }
      if (allowed) return;
    }
  } catch {
    reply.code(503).send({error:'Không thể xác minh quyền truy cập'}); return;
  }
  reply.code(403).send({error:'Bạn chưa được cấp quyền sử dụng chức năng này',code:'RBAC_FORBIDDEN'});
}
