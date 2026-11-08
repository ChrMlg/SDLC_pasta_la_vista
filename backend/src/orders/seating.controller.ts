import { Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { OrderError } from './orders.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new OrderError(400, 'INVALID_ID', 'Identificador inválido');

@Controller('branches')
@UseGuards(VerifiedSessionGuard)
export class SeatingController {
  constructor(private readonly db: PrismaClient) {}

  @Get()
  async branches(@Req() request: AuthenticatedRequest) {
    const user = request.user!;
    return this.db.branch.findMany({
      where: user.role === 'CUSTOMER' || user.role === 'GENERAL_MANAGER' ? {} : { id: user.branchId ?? '00000000-0000-4000-8000-000000000000' },
      select: { id: true, code: true, name: true }, orderBy: { name: 'asc' },
    });
  }

  @Get(':branchId/tables')
  async tables(@Param('branchId') branchId: string, @Req() request: AuthenticatedRequest) {
    if (!uuid.test(branchId)) throw invalid();
    const user = request.user!;
    if (user.role !== 'CUSTOMER' && user.role !== 'GENERAL_MANAGER' && user.branchId !== branchId)
      throw new OrderError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    if (!await this.db.branch.count({ where: { id: branchId } })) throw new OrderError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    const tables = await this.db.table.findMany({ where: { branchId }, orderBy: { number: 'asc' },
      select: { id: true, number: true, status: true } });
    const assignments = user.role === 'CUSTOMER' ? await this.db.tableAssignment.findMany({ where: {
      customerId: user.userId, tableId: { in: tables.map(table => table.id) }, validFrom: { lte: new Date() },
      OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
    }, select: { tableId: true } }) : [];
    const mine = new Set(assignments.map(assignment => assignment.tableId));
    return tables.map(table => ({ id: table.id, number: table.number, status: table.status,
      mine: mine.has(table.id) }));
  }

  @Post(':branchId/tables/:tableId/select')
  async select(@Param('branchId') branchId: string, @Param('tableId') tableId: string, @Req() request: AuthenticatedRequest) {
    if (!uuid.test(branchId) || !uuid.test(tableId)) throw invalid();
    const user = request.user!;
    if (user.role !== 'CUSTOMER') throw new OrderError(403, 'FORBIDDEN', 'Solo clientes pueden elegir mesa');
    try {
      return await this.db.$transaction(async tx => {
        // Serialize selections by the same customer, including requests for different tables.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.userId}::uuid FOR UPDATE`;
        const rows = await tx.$queryRaw<{ id: string; branchId: string; number: number; status: string }[]>`
          SELECT "id", "branchId", "number", "status"::text FROM "Table" WHERE "id" = ${tableId}::uuid FOR UPDATE`;
        const table = rows[0];
        if (!table || table.branchId !== branchId) throw new OrderError(404, 'NOT_FOUND', 'Mesa no encontrada');
        const assignment = await tx.tableAssignment.findFirst({ where: { tableId, customerId: user.userId,
          validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] } });
        if (assignment) {
          if (table.status !== 'OCCUPIED') throw new OrderError(409, 'TABLE_UNAVAILABLE', 'La mesa ya no está activa');
          return { id: table.id, number: table.number, status: table.status };
        }
        if (table.status !== 'AVAILABLE') throw new OrderError(409, 'TABLE_UNAVAILABLE', 'La mesa ya no está disponible');
        const current = await tx.tableAssignment.findFirst({ where: { tableId,
          validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] } });
        if (current) throw new OrderError(409, 'TABLE_UNAVAILABLE', 'La mesa ya no está disponible');
        const other = await tx.tableAssignment.findFirst({ where: { customerId: user.userId, tableId: { not: tableId },
          table: { status: 'OCCUPIED' }, validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] } });
        if (other) throw new OrderError(409, 'SEAT_ALREADY_SELECTED', 'Ya tiene una mesa asignada');
        await tx.table.update({ where: { id: tableId }, data: { status: 'OCCUPIED' } });
        await tx.tableAssignment.create({ data: { tableId, customerId: user.userId, validFrom: new Date() } });
        return { id: table.id, number: table.number, status: 'OCCUPIED' };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034')
        throw new OrderError(409, 'TABLE_UNAVAILABLE', 'La mesa ya no está disponible');
      throw error;
    }
  }

  @Delete(':branchId/tables/:tableId/select')
  async release(@Param('branchId') branchId: string, @Param('tableId') tableId: string, @Req() request: AuthenticatedRequest) {
    if (!uuid.test(branchId) || !uuid.test(tableId)) throw invalid();
    const user = request.user!;
    if (user.role !== 'CUSTOMER') throw new OrderError(403, 'FORBIDDEN', 'Solo clientes pueden liberar su mesa');
    try {
      return await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.userId}::uuid FOR UPDATE`;
        const rows = await tx.$queryRaw<{ id: string; branchId: string; status: string }[]>`
          SELECT "id", "branchId", "status"::text FROM "Table" WHERE "id" = ${tableId}::uuid FOR UPDATE`;
        const table = rows[0];
        if (!table || table.branchId !== branchId) throw new OrderError(404, 'NOT_FOUND', 'Mesa no encontrada');
        const assignment = await tx.tableAssignment.findFirst({ where: { tableId, customerId: user.userId,
          validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] }, orderBy: { validFrom: 'desc' } });
        if (!assignment) throw new OrderError(404, 'NOT_FOUND', 'Asignación no encontrada');
        const placedOrders = await tx.order.count({ where: { tableId, clientId: user.userId,
          createdAt: { gte: assignment.validFrom }, status: { not: 'CANCELLED' } } });
        if (placedOrders) throw new OrderError(409, 'TABLE_HAS_ORDERS', 'La mesa tiene pedidos; solicite el cierre de cuenta');
        if (table.status !== 'OCCUPIED') throw new OrderError(409, 'TABLE_UNAVAILABLE', 'La mesa cambió de estado');
        await tx.tableAssignment.update({ where: { id: assignment.id }, data: { validTo: new Date(Math.max(Date.now(), assignment.validFrom.getTime() + 1)) } });
        await tx.table.update({ where: { id: tableId }, data: { status: 'AVAILABLE' } });
        return { released: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034')
        throw new OrderError(409, 'TABLE_UNAVAILABLE', 'La mesa cambió durante la liberación');
      throw error;
    }
  }
}

@Controller('me/table-selection')
@UseGuards(VerifiedSessionGuard)
export class MySeatingController {
  constructor(private readonly db: PrismaClient) {}

  @Get()
  async current(@Req() request: AuthenticatedRequest) {
    const user = request.user!;
    if (user.role !== 'CUSTOMER') throw new OrderError(403, 'FORBIDDEN', 'Solo clientes pueden consultar su mesa');
    const assignment = await this.db.tableAssignment.findFirst({ where: { customerId: user.userId,
      table: { status: 'OCCUPIED' }, validFrom: { lte: new Date() },
      OR: [{ validTo: null }, { validTo: { gt: new Date() } }] },
      orderBy: { validFrom: 'desc' }, include: { table: { select: { id: true, branchId: true, number: true, status: true } } } });
    return assignment ? { branchId: assignment.table.branchId, tableId: assignment.table.id,
      number: assignment.table.number } : null;
  }
}
