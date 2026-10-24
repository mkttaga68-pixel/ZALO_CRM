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
    // Dạng HÀM, không phải object tĩnh: socket.io gọi lại MỖI lần kết nối — kể cả
    // những lần tự nối lại sau khi rớt mạng — nên token luôn là bản mới nhất trong
    // storage. Object tĩnh chỉ đọc token MỘT lần lúc tạo: token hết hạn hoặc người dùng
    // đăng nhập lại thì mọi lần nối lại đều bị server từ chối, realtime chết âm thầm
    // cho tới khi tải lại trang.
    auth: (cb) => cb({ token: readToken() ?? '' }),
  });
}
