import { assertSafeOutboundUrl } from '../../../shared/utils/ssrf-guard.js';
import { PostingError, type PostingDraft, type PostingKind } from './contracts.js';

export function postingKind(value: unknown): PostingKind {
  if (value !== 'GROUP' && value !== 'OFFER') throw new PostingError(400, 'Loại gửi không hợp lệ.');
  return value;
}
export function postingId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new PostingError(400, 'Mã tham chiếu không hợp lệ.');
  return value;
}
export function validatePostingDraft(input: unknown): PostingDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PostingError(400, 'Nội dung yêu cầu không hợp lệ.');
  const b = input as Record<string, unknown>;
  if (b.confirmed !== true) throw new PostingError(400, 'Cần xác nhận nội dung và người nhận trước khi gửi.');
  const requestId = postingId(b.requestId), zaloAccountId = postingId(b.zaloAccountId), kind = postingKind(b.kind);
  if (!Array.isArray(b.targetIds) || !b.targetIds.length || b.targetIds.length > 50) throw new PostingError(400, 'Chọn từ 1 đến 50 người nhận.');
  const targetIds = b.targetIds.map(postingId);
  if (new Set(targetIds).size !== targetIds.length) throw new PostingError(400, 'Danh sách người nhận bị trùng.');
  const body = typeof b.body === 'string' ? b.body.trim() : '';
  if (body.length > 2000) throw new PostingError(400, 'Nội dung tối đa 2.000 ký tự.');
  if (!Array.isArray(b.imageUrls) || b.imageUrls.length > 10) throw new PostingError(400, 'Tối đa 10 URL ảnh HTTPS.');
  const imageUrls = b.imageUrls.map(value => {
    if (typeof value !== 'string' || value.length > 2048) throw new PostingError(400, 'URL ảnh không hợp lệ.');
    try { return assertSafeOutboundUrl(value.trim()).toString(); }
    catch { throw new PostingError(400, 'Ảnh phải là URL HTTPS công khai, không có thông tin đăng nhập.'); }
  });
  if (!body && !imageUrls.length) throw new PostingError(400, 'Cần nội dung hoặc ảnh.');
  const delaySeconds = Number(b.delaySeconds);
  if (!Number.isInteger(delaySeconds) || delaySeconds < 10 || delaySeconds > 300) throw new PostingError(400, 'Giãn cách từ 10 đến 300 giây.');
  return { requestId, zaloAccountId, kind, targetIds, body, imageUrls, delaySeconds, confirmed: true };
}
