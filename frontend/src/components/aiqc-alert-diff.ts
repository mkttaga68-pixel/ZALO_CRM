export type AiqcAlertItem = { id: string; createdAt: string; unread: boolean; employees: Array<{ id: string; name: string }>; types: string[] };

/**
 * Trả về các cảnh báo CHƯA ĐỌC lần đầu xuất hiện, và ghi nhận mọi ID vào `known`.
 * Lần tải đầu tiên (initialized=false) chỉ ghi nhận, không báo — tránh bật toast cho
 * toàn bộ lịch sử mỗi khi tải lại trang.
 */
export function freshAlerts(known: Set<string>, items: AiqcAlertItem[], initialized: boolean): AiqcAlertItem[] {
  const fresh = items.filter(i => i.unread && !known.has(i.id));
  for (const i of items) known.add(i.id);
  if (known.size > 1000) for (const id of [...known].slice(0, known.size - 1000)) known.delete(id);
  return initialized ? fresh : [];
}

export function alertText(items: AiqcAlertItem[], label: (type: string) => string): string {
  const describe = (i: AiqcAlertItem) => `${i.employees.map(e => e.name).join(', ') || 'Hội thoại cần xem xét'} — ${[...new Set(i.types)].map(label).join(' · ')}`;
  if (!items.length) return '';
  return items.length > 1 ? `${items.length} cảnh báo mới. Gần nhất: ${describe(items[0]!)}` : describe(items[0]!);
}
