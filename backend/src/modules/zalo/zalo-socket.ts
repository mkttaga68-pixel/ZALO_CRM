/**
 * Zalo Socket.IO event handlers.
 * Manages room subscriptions for org-level and per-account events.
 *
 * BẢO MẬT: mọi room đều suy ra từ định danh trong token (socketIdentity), KHÔNG
 * bao giờ từ payload client. Xem shared/socket-auth.ts để biết vì sao — trước đây
 * `org:join` tin orgId do client gửi nên ai cũng đọc được dữ liệu tổ chức khác.
 */
import type { Server, Socket } from 'socket.io';
import { logger } from '../../shared/utils/logger.js';
import { socketIdentity } from '../../shared/socket-auth.js';
import { prisma } from '../../shared/database/prisma-client.js';

export function registerZaloSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    // Tham số payload được giữ để client cũ gửi { orgId } không lỗi, nhưng giá trị
    // đó bị BỎ QUA hoàn toàn — org luôn lấy từ token.
    socket.on('org:join', () => {
      const { orgId } = socketIdentity(socket);
      socket.join(`org:${orgId}`);
      logger.debug(`Socket ${socket.id} joined org:${orgId}`);
    });

    // Subscribe to QR/status updates for a specific Zalo account.
    // Room này nhận mã QR đăng nhập Zalo, nên BẮT BUỘC kiểm tra account thuộc
    // đúng org của người dùng trước khi cho join.
    socket.on('zalo:subscribe', async (data: { accountId: string }) => {
      if (!data?.accountId) return;
      const { orgId, userId } = socketIdentity(socket);

      try {
        const account = await prisma.zaloAccount.findFirst({
          where: { id: data.accountId, orgId },
          select: { id: true },
        });
        if (!account) {
          logger.warn(
            `[socket] user ${userId} (org ${orgId}) bị chặn subscribe account:${data.accountId} — không thuộc org`,
          );
          return;
        }
      } catch (err) {
        logger.error('[socket] zalo:subscribe kiểm tra org thất bại:', err);
        return;
      }

      socket.join(`account:${data.accountId}`);
      logger.debug(`Socket ${socket.id} joined account:${data.accountId}`);
    });

    // Unsubscribe không cần kiểm tra quyền: rời room chỉ ảnh hưởng chính socket đó.
    socket.on('zalo:unsubscribe', (data: { accountId: string }) => {
      if (!data?.accountId) return;
      socket.leave(`account:${data.accountId}`);
      logger.debug(`Socket ${socket.id} left account:${data.accountId}`);
    });
  });
}
