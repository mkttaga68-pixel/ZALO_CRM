const destinations = [
  ['trigger', '/automation/bot/triggers'],
  ['block', '/automation/bot/blocks'],
  ['sequence', '/automation/bot/sequences'],
  ['broadcast', '/automation/bot/broadcasts'],
  ['customer_list', '/automation/bot/lists'],
] as const;

/** Shared by the root route and top navigation; authorization remains in the API. */
export function firstBotAutoRoute(hasGrant: (resource: string, action: string) => boolean): string | null {
  return destinations.find(([resource]) => hasGrant(resource, 'access'))?.[1] ?? null;
}
