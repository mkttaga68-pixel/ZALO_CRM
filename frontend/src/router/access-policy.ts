/** Shared by desktop/mobile navigation, settings search and direct URL checks. */
export type GrantCheck = (resource: string, action?: string) => boolean;
const ROUTE_RESOURCES: ReadonlyArray<readonly [string, string]> = [
  ['/settings/rbac/permission-groups', 'permission_group'],
  ['/settings/rbac/departments', 'department'],
  ['/settings/rbac/users', 'user'],
  ['/settings/team/roles', 'permission_group'],
  ['/settings/team/teams', 'department'],
  ['/settings/team/users', 'user'],
  ['/settings/channels/zalo', 'zalo_account'],
  ['/settings/channels/facebook', 'integration'],
  ['/settings/channels/integrations', 'integration'],
  ['/settings/dev/api', 'webhook'],
  ['/settings/org/data-purge', 'contact_data_purge'],
  ['/settings/org', 'settings'],
  ['/settings/crm', 'settings'],
  ['/settings/scoring', 'settings'],
  ['/settings/zalo-labels', 'settings'],
  ['/automation/bot/triggers', 'trigger'],
  ['/automation/bot/blocks', 'block'],
  ['/automation/bot/sequences', 'sequence'],
  ['/automation/bot/broadcasts', 'broadcast'],
  ['/automation/bot/lists', 'customer_list'],
  ['/automation/bot', 'bot_auto'],
  ['/automation', 'automation'],
  ['/ai-quality-control', 'ai_quality_control'],
  ['/customers', 'audit_log'],
  ['/contacts', 'contact'],
  ['/friends', 'friend'],
  ['/chat', 'conversation'],
  ['/groups', 'group'],
  ['/group-posts', 'posting'],
  ['/chao-hang', 'posting'],
  ['/appointments', 'appointment'],
  ['/analytics', 'analytics'],
  ['/reports', 'report'],
  ['/leads/stuck', 'engagement_score'],
  ['/zalo-accounts', 'zalo_account'],
  ['/api-settings', 'webhook'],
  ['/integrations', 'integration'],
];
export function canAccessPath(path: string, can: GrantCheck): boolean {
  const clean = path.split(/[?#]/)[0]!.replace(/\/$/, '') || '/';
  if (['/profile', '/settings', '/settings/personal/profile', '/settings/personal/password', '/settings/privacy', '/forbidden'].includes(clean)) return true;
  if (clean === '/') return can('dashboard');
  const rule = ROUTE_RESOURCES.find(([prefix]) => clean === prefix || clean.startsWith(prefix + '/'));
  return !!rule && can(rule[1]);
}
export function firstAllowedPath(can: GrantCheck): string {
  return ['/', '/chat', '/contacts', '/friends', '/appointments', '/reports', '/analytics',
    '/automation/bot/triggers', '/automation/bot/blocks', '/automation/bot/sequences',
    '/automation/bot/broadcasts', '/automation/bot/lists', '/settings/personal/profile']
    .find(path => canAccessPath(path, can))!;
}
export function canUseGlobalSearch(can: GrantCheck): boolean {
  // Current legacy search returns all three categories and is organization-wide.
  return ['contact', 'conversation', 'appointment'].every(r => can(r) && can(r, 'view_all'));
}
export function canUseNotifications(can: GrantCheck): boolean {
  return ['conversation', 'appointment', 'zalo_account'].every(r => can(r) && can(r, 'view_all'));
}
