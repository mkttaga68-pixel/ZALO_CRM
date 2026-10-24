/**
 * socket.ts — nơi DUY NHẤT tạo kết nối Socket.IO.
 *
 * Server xác thực handshake bằng JWT (backend/src/shared/socket-auth.ts), nên mọi
 * kết nối phải kèm token. Gom vào một chỗ để không có composable nào quên — thiếu
 * token là server từ chối và toàn bộ realtime của tính năng đó im lặng.
 *
 * Lưu ý: `orgId` không cần gửi nữa, server lấy từ token. Các composable vẫn gọi
 * `emit('org:join', { orgId })` được bình thường — server bỏ qua payload đó.
 */
import { io, type Socket } from 'socket.io-client';
import { readToken } from './index';

export function connectSocket(): Socket {
  return io({
    transports: ['websocket', 'polling'],
    auth: { token: readToken() ?? '' },
  });
}
