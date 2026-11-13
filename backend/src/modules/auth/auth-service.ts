/**
 * Auth service — handles setup, login, and profile operations.
 * Uses bcryptjs for password hashing and Fastify JWT for token signing.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { normalizePhone } from '../../shared/utils/phone.js';
import { credentialVersion } from './credential-version.js';

/**
 * Một chuỗi được coi là "có vẻ SĐT" khi bỏ hết ký tự không phải số vẫn còn
 * ≥ 8 chữ số VÀ không chứa '@'. Dùng để quyết định tra theo phone hay email.
 */
function looksLikePhone(identifier: string): boolean {
  if (identifier.includes('@')) return false;
  const digits = identifier.replace(/[^\d]/g, '');
  return digits.length >= 8;
}

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
  orgId: string;
  credentialVersion: string;
}

// Check if any users exist — true means first-run setup is needed
export async function checkSetupStatus(): Promise<{ needsSetup: boolean }> {
  const count = await prisma.user.count();
  return { needsSetup: count === 0 };
}

// Create the initial organization + owner user, return JWT payload
export async function setup(
  orgName: string,
  fullName: string,
  email: string,
  password: string,
): Promise<JwtPayload> {
  const existing = await prisma.user.count();
  if (existing > 0) {
    const err = new Error('Setup already completed') as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: orgName } });
    const user = await tx.user.create({
      data: {
        orgId: org.id,
        email: email.toLowerCase().trim(),
        passwordHash,
        fullName,
        role: 'owner',
      },
    });
    return { org, user };
  });

  logger.info(`Setup complete — org=${result.org.id}, user=${result.user.id}`);

  return {
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    orgId: result.org.id,
    credentialVersion: credentialVersion(result.user.id, result.user.passwordHash),
  };
}

// Verify credentials, return JWT payload.
// `identifier` chấp nhận EMAIL hoặc SỐ ĐIỆN THOẠI (VN). Nếu là SĐT thì tra theo
// User.phone (canonical 84xxxxxxxxx); ngược lại tra theo email (lowercased).
export async function login(identifier: string, password: string): Promise<JwtPayload> {
  const raw = (identifier ?? '').trim();

  const unauthorized = () => {
    const err = new Error('Sai tài khoản hoặc mật khẩu') as Error & { statusCode: number };
    err.statusCode = 401;
    return err;
  };

  let user = null;
  if (looksLikePhone(raw)) {
    const phone = normalizePhone(raw);
    if (phone) {
      user = await prisma.user.findUnique({ where: { phone } });
    }
    // Fallback: cho phép trường hợp SĐT được lưu ở cột email (dữ liệu cũ)
    if (!user) {
      user = await prisma.user.findUnique({ where: { email: raw.toLowerCase() } });
    }
  } else {
    user = await prisma.user.findUnique({ where: { email: raw.toLowerCase() } });
  }

  if (!user || !user.isActive) {
    throw unauthorized();
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw unauthorized();
  }

  return { id: user.id, email: user.email, role: user.role, orgId: user.orgId,
    credentialVersion: credentialVersion(user.id, user.passwordHash) };
}

// Return safe user profile (no password hash)
export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      orgId: true,
      teamId: true,
      isActive: true,
      createdAt: true,
      org: { select: { id: true, name: true, timezone: true } },
      permissionGroup: { select: { grants: true, archivedAt: true } },
    },
  });

  if (!user) {
    const err = new Error('User not found') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }

  const { permissionGroup, ...profile } = user;
  return {
    ...profile,
    // UI visibility only; API routes remain authoritative for authorization.
    grants: permissionGroup && !permissionGroup.archivedAt ? permissionGroup.grants : {},
  };
}
