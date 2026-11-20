import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthenticatedRequest } from '../common/session';
import { hashPassword, normalizeEmail, verifyPassword } from './credentials';

const cookieName = 'bistro_session';
const maxAgeSeconds = 7 * 24 * 60 * 60;
const dummyHash = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly field: string | null = null) { super(message); }
}

function credentials(body: unknown, registration: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AuthError(400, 'INVALID_FIELD', 'Solicitud inválida');
  const input = body as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!(registration ? ['email', 'password', 'firstName', 'lastName', 'phone'] : ['email', 'password']).includes(key)) throw new AuthError(400, 'INVALID_FIELD', `Campo no permitido: ${key}`, key);
  if (typeof input.email !== 'string') throw new AuthError(400, 'INVALID_FIELD', 'Correo inválido', 'email');
  const email = normalizeEmail(input.email);
  if (email.length > 254 || !emailPattern.test(email)) throw new AuthError(400, 'INVALID_FIELD', 'Correo inválido', 'email');
  if (typeof input.password !== 'string' || input.password.length > 128 || (registration && input.password.length < 8) || (!registration && !input.password.length))
    throw new AuthError(400, 'INVALID_FIELD', registration ? 'La contraseña debe tener entre 8 y 128 caracteres' : 'Contraseña inválida', 'password');
  if (registration) {
    for (const key of ['firstName', 'lastName']) {
      if (typeof input[key] !== 'string' || (input[key] as string).trim().length < 2 || (input[key] as string).trim().length > 80)
        throw new AuthError(400, 'INVALID_FIELD', 'Debe tener entre 2 y 80 caracteres', key);
    }
    if (typeof input.phone !== 'string' || !/^\d{8}$/.test(input.phone)) throw new AuthError(400, 'INVALID_FIELD', 'El teléfono debe tener ocho dígitos', 'phone');
  }
  return { email, password: input.password, firstName: (input.firstName as string | undefined)?.trim(), lastName: (input.lastName as string | undefined)?.trim(), phone: input.phone as string | undefined };
}

function tokenFromRequest(request: AuthenticatedRequest): string | null {
  const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`));
  const token = cookie?.slice(cookieName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(private readonly db: PrismaClient) {}

  async register(body: unknown) {
    const { email, password, firstName, lastName, phone } = credentials(body, true);
    const passwordHash = await hashPassword(password);
    try {
      const user = await this.db.user.create({ data: { email, passwordHash, firstName, lastName, phone, role: 'CUSTOMER' } });
      return { id: user.id, email: user.email, role: user.role, branchId: user.branchId };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AuthError(409, 'EMAIL_IN_USE', 'Este correo ya está registrado', 'email');
      throw error;
    }
  }

  async login(body: unknown) {
    const { email, password } = credentials(body, false);
    const user = await this.db.user.findUnique({ where: { email } });
    const valid = await verifyPassword(password, user?.passwordHash ?? dummyHash);
    if (!user || !valid || !user.isActive) throw new AuthError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
    const token = randomBytes(32).toString('hex');
    await this.db.authSession.create({ data: { tokenHash: tokenHash(token), userId: user.id, expiresAt: new Date(Date.now() + maxAgeSeconds * 1000) } });
    return { token, user: { userId: user.id, email: user.email, role: user.role, branchId: user.branchId } };
  }

  async attach(request: AuthenticatedRequest) {
    const token = tokenFromRequest(request);
    if (!token) return;
    const session = await this.db.authSession.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
    if (!session || !session.user.isActive || session.expiresAt <= new Date()) return;
    request.user = { userId: session.user.id, role: session.user.role, branchId: session.user.branchId };
  }

  async current(request: AuthenticatedRequest) {
    if (!request.user) throw new AuthError(401, 'UNAUTHENTICATED', 'Sesión requerida');
    const user = await this.db.user.findUnique({ where: { id: request.user.userId }, select: { id: true, email: true, role: true, branchId: true } });
    if (!user) throw new AuthError(401, 'UNAUTHENTICATED', 'Sesión requerida');
    return { userId: user.id, email: user.email, role: user.role, branchId: user.branchId };
  }

  async logout(request: AuthenticatedRequest) {
    const token = tokenFromRequest(request);
    if (token) await this.db.authSession.deleteMany({ where: { tokenHash: tokenHash(token) } });
    // An unused seat should not remain occupied when its customer signs out.
    if (request.user?.role === 'CUSTOMER') {
      try {
        await this.db.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${request.user!.userId}::uuid FOR UPDATE`;
          const assignments = await tx.tableAssignment.findMany({ where: { customerId: request.user!.userId,
            validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] } });
          for (const assignment of assignments) {
            const rows = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text FROM "Table" WHERE "id" = ${assignment.tableId}::uuid FOR UPDATE`;
            if (rows[0]?.status !== 'OCCUPIED') continue;
            const orders = await tx.order.count({ where: { tableId: assignment.tableId, OR: [{ billId: null }, { bill: { status: { not: 'PAID' } } }], status: { not: 'CANCELLED' } } });
            if (orders) continue;
            await tx.tableAssignment.update({ where: { id: assignment.id }, data: { validTo: new Date(Math.max(Date.now(), assignment.validFrom.getTime() + 1)) } });
            await tx.table.update({ where: { id: assignment.tableId }, data: { status: 'AVAILABLE' } });
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) { console.error('Could not release unused seat on logout', error); }
    }
  }

  cookieOptions() { return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: maxAgeSeconds * 1000 }; }
  clearCookieOptions() { return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.COOKIE_SECURE === 'true', path: '/' }; }
}
