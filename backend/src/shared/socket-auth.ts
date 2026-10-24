/**
 * socket-auth.ts — xác thực Socket.IO ngay lúc handshake.
 *
 * TRƯỚC ĐÂY: Socket.IO không có xác thực nào cả — `io.use()` chưa từng được gọi,
 * và `org:join` join thẳng vào room theo `orgId` do CLIENT gửi. Hậu quả: một client
 * ẩn danh chỉ cần biết một `orgId` (UUID này lộ qua API thường) là nhận được toàn
 * bộ event của tổ chức đó. Nặng hơn, `zalo-pool.ts` emit mã QR đăng nhập Zalo vào
 * room `account:<id>`, nên kẻ tấn công join được room đó là quét QR chiếm luôn nick.
 * CORS của Socket.IO không chặn được vì client không phải browser thì bỏ qua CORS.
 *
 * BÂY GIỜ: token JWT là BẮT BUỘC ở handshake, và `orgId` LUÔN lấy từ token —
 * không bao giờ từ payload client. Mọi handler socket phải dùng socketIdentity().
 */
import type { FastifyInstance } from 'fastify';
import type { Server, Socket } from 'socket.io';
import { logger } from './utils/logger.js';

export interface SocketIdentity {
  userId: string;
  orgId: string;
  role: string;
  email?: string;
}

/**
 * Định danh đã xác thực của socket. Chỉ gọi được bên trong handler 'connection'
 * vì middleware xác thực đã chạy xong trước đó; socket không có định danh thì
 * đã bị từ chối ở handshake nên không bao giờ tới được handler.
 */
export function socketIdentity(socket: Socket): SocketIdentity {
  return socket.data.identity as SocketIdentity;
}

function extractToken(socket: Socket): string | undefined {
  // Cách chuẩn của socket.io-client: io({ auth: { token } })
  const fromAuth = (socket.handshake.auth ?? {}).token;
  if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;

  // Dự phòng cho client không phải browser (script, test) dùng header.
  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const raw = header.slice(7).trim();
    if (raw) return raw;
  }
  return undefined;
}

export function registerSocketAuth(io: Server, app: FastifyInstance): void {
  io.use((socket, next) => {
    const token = extractToken(socket);
    if (!token) {
      logger.warn(`[socket] từ chối ${socket.id}: thiếu token ở handshake`);
      return next(new Error('UNAUTHORIZED'));
    }

    try {
      const payload = app.jwt.verify(token) as {
        id?: string;
        email?: string;
        role?: string;
        orgId?: string;
      };

      // Token hợp lệ về chữ ký nhưng thiếu claim thì vẫn từ chối — tránh join
      // vào `org:undefined` hoặc coi như đã xác thực mà không có org.
      if (!payload?.id || !payload?.orgId) {
        logger.warn(`[socket] từ chối ${socket.id}: token thiếu claim id/orgId`);
        return next(new Error('UNAUTHORIZED'));
      }

      socket.data.identity = {
        userId: payload.id,
        orgId: payload.orgId,
        role: payload.role ?? 'member',
        email: payload.email,
      } satisfies SocketIdentity;

      return next();
    } catch {
      // Không log nội dung token.
      logger.warn(`[socket] từ chối ${socket.id}: token không hợp lệ hoặc đã hết hạn`);
      return next(new Error('UNAUTHORIZED'));
    }
  });
}
