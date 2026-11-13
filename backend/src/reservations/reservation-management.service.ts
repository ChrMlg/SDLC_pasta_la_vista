import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, inputFields, validateId } from '../common/business-error';
import { formatMinutes, restaurantTimeZone, timeMinutes } from '../common/local-time';
import { NotificationsService } from '../notifications/notifications.service';
import { validateOccupancyQuery } from './dto/occupancy-query.dto';
import { assertCancellationAllowed, overlaps } from './reservation-rules';

function requireManagement(session: Session) {
  if (session.role !== 'MANAGER' && session.role !== 'GENERAL_MANAGER')
    throw new BusinessError(403, 'FORBIDDEN', 'Solo gerencia puede gestionar reservaciones');
}

function requireBranch(branchId: string, session: Session) {
  if (session.role === 'MANAGER' && session.branchId !== branchId)
    throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
}

@Injectable()
export class ReservationManagementService {
  private readonly logger = new Logger(ReservationManagementService.name);
  constructor(private readonly db: PrismaClient, private readonly notifications: NotificationsService) {}

  async occupancy(branchId: string, query: unknown, session: Session) {
    requireManagement(session);
    validateId(branchId, 'branchId');
    requireBranch(branchId, session);
    const { date } = validateOccupancyQuery(query);
    // Una sola fotografía de mesas y reservas, incluso si se cancela durante la consulta.
    const { branch, totalTables, reservations } = await this.db.$transaction(async tx => ({
      branch: await tx.branch.findUnique({ where: { id: branchId }, select: { openingTime: true, closingTime: true } }),
      totalTables: await tx.table.count({ where: { branchId } }),
      reservations: await tx.reservation.findMany({
        where: { branchId, date }, orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
        select: { id: true, tableId: true, table: { select: { number: true } }, date: true, startTime: true, endTime: true, partySize: true, status: true },
      }),
    }), { isolationLevel: 'RepeatableRead' });
    if (!branch) throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    const slots = [];
    const closing = timeMinutes(branch.closingTime);
    for (let start = timeMinutes(branch.openingTime); start < closing; start += 60) {
      const startTime = formatMinutes(start);
      const endTime = formatMinutes(Math.min(start + 60, closing));
      // Contar mesas distintas: dos reservas contiguas pueden tocar el mismo bloque.
      const reservedTables = new Set(reservations.filter(reservation =>
        reservation.status !== 'CANCELLED' && overlaps(startTime, endTime, reservation.startTime, reservation.endTime),
      ).map(reservation => reservation.tableId)).size;
      slots.push({ startTime, endTime, reservedTables, availableTables: totalTables - reservedTables,
        occupancyPercentage: totalTables ? Math.round(reservedTables / totalTables * 10000) / 100 : 0 });
    }
    return { branchId, date, timeZone: restaurantTimeZone, totalTables, slots,
      reservations: reservations.map(({ table, ...reservation }) => ({ ...reservation, tableNumber: table.number })) };
  }

  async cancel(id: string, body: unknown, session: Session) {
    requireManagement(session);
    validateId(id, 'id');
    inputFields(body ?? {}, []);
    const reservation = await this.db.$transaction(async tx => {
      // Serializa cancelaciones de la misma reserva; se verifica el plazo tras el bloqueo.
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const existing = await tx.reservation.findUnique({ where: { id }, include: { branch: { select: { name: true } } } });
      if (!existing) throw new BusinessError(404, 'NOT_FOUND', 'Reservación no encontrada');
      requireBranch(existing.branchId, session);
      assertCancellationAllowed(existing.date, existing.startTime, existing.status);
      const saved = await tx.reservation.update({ where: { id }, data: { status: 'CANCELLED' } });
      return { ...saved, branchName: existing.branch.name };
    });
    try {
      await this.notifications.createNotification({
        recipientId: reservation.customerId, sourceModule: 'RESERVATIONS',
        eventKey: `reservation.cancelled:${reservation.id}`, relatedEntityId: reservation.id,
        title: 'Reservación cancelada',
        message: `${reservation.branchName}, ${reservation.date} ${reservation.startTime}: reservación cancelada`,
      });
    } catch { this.logger.error(`No se pudo registrar el aviso de cancelación de la reservación ${reservation.id}`); }
    return reservation;
  }
}
