import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, inputFields, invalid, validateId } from '../common/business-error';
import { formatMinutes, localInstant, localParts, restaurantTimeZone, timeMinutes, validateDate } from '../common/local-time';
import { NotificationsService } from '../notifications/notifications.service';
import { validateReservation } from './dto/reservation.dto';
import { overlaps, reservationDurationMinutes, reservationEnd } from './reservation-rules';

const activeStatuses = ['PENDING', 'CONFIRMED'] as const;
function requireCustomer(session: Session) {
  if (session.role !== 'CUSTOMER') throw new BusinessError(403, 'FORBIDDEN', 'Solo los clientes pueden registrar reservaciones');
}

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);
  constructor(private readonly db: PrismaClient, private readonly notifications: NotificationsService) {}

  async create(body: unknown, session: Session) {
    requireCustomer(session);
    const input = validateReservation(body);
    const reservation = await this.db.$transaction(async tx => {
      // Serializa las asignaciones y los cambios de horario de esta sucursal.
      await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${input.branchId}::uuid FOR UPDATE`;
      const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
      if (!branch) throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
      const endTime = reservationEnd(input.date, input.time, branch.openingTime, branch.closingTime);
      const tables = await tx.$queryRaw<{ id: string; number: number; capacity: number }[]>`
        SELECT "id", "number", "capacity" FROM "Table"
        WHERE "branchId" = ${branch.id}::uuid AND "capacity" IS NOT NULL AND "status" <> 'OUT_OF_SERVICE'
        ORDER BY "capacity", "number" FOR UPDATE`;
      if (tables.length && input.partySize > Math.max(...tables.map(table => table.capacity)))
        invalid('partySize', 'La cantidad de personas supera la capacidad de las mesas');
      for (const table of tables.filter(table => table.capacity >= input.partySize)) {
        const conflicts = await tx.reservation.count({ where: {
          tableId: table.id, date: input.date, status: { in: [...activeStatuses] },
          startTime: { lt: endTime }, endTime: { gt: input.time },
        } });
        if (conflicts) continue;
        const saved = await tx.reservation.create({ data: {
          branchId: branch.id, tableId: table.id, customerId: session.userId,
          date: input.date, startTime: input.time, endTime, partySize: input.partySize, status: 'CONFIRMED',
        } });
        return { ...saved, branchName: branch.name, tableNumber: table.number };
      }
      throw new BusinessError(409, 'NO_TABLE_AVAILABLE', 'No hay mesas disponibles para ese horario');
    });
    // El aviso se registra después del commit; su fallo no revierte la reserva.
    try {
      await this.notifications.createNotification({
        recipientId: reservation.customerId, sourceModule: 'RESERVATIONS',
        eventKey: `reservation.confirmed:${reservation.id}`, relatedEntityId: reservation.id,
        title: 'Reservación confirmada',
        message: `${reservation.branchName}, ${reservation.date} ${reservation.startTime}, mesa ${reservation.tableNumber}, ${reservation.partySize} personas: reservación confirmada`,
      });
    } catch { this.logger.error(`No se pudo registrar el aviso de la reservación ${reservation.id}`); }
    return reservation;
  }

  async availability(branchId: string, query: Record<string, unknown>, session: Session) {
    requireCustomer(session);
    validateId(branchId, 'branchId');
    inputFields(query, ['date', 'partySize']);
    const date = validateDate(query.date);
    if (date < localParts(new Date()).date) invalid('date', 'La fecha no puede estar en el pasado');
    if (typeof query.partySize !== 'string' || !/^[1-9]\d*$/.test(query.partySize) || Number(query.partySize) > 2147483647)
      invalid('partySize', 'Cantidad de personas inválida');
    const partySize = Number(query.partySize);
    const { branch, tables, reservations } = await this.db.$transaction(async tx => ({
      branch: await tx.branch.findUnique({ where: { id: branchId } }),
      tables: await tx.table.findMany({ where: { branchId, capacity: { not: null }, status: { not: 'OUT_OF_SERVICE' } }, select: { id: true, capacity: true } }),
      reservations: await tx.reservation.findMany({ where: { branchId, date, status: { in: [...activeStatuses] } }, select: { tableId: true, startTime: true, endTime: true } }),
    }), { isolationLevel: 'RepeatableRead' });
    if (!branch) throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    if (tables.length && partySize > Math.max(...tables.map(table => table.capacity!)))
      invalid('partySize', 'La cantidad de personas supera la capacidad de las mesas');
    const slots = [];
    const now = new Date();
    for (let minutes = timeMinutes(branch.openingTime); minutes + reservationDurationMinutes <= timeMinutes(branch.closingTime); minutes += 60) {
      const time = formatMinutes(minutes);
      const endTime = formatMinutes(minutes + reservationDurationMinutes);
      if (localInstant(date, time) <= now) continue;
      const available = tables.some(table => table.capacity! >= partySize && !reservations.some(reservation =>
        reservation.tableId === table.id && overlaps(time, endTime, reservation.startTime, reservation.endTime)));
      slots.push({ time, endTime, available });
    }
    return { branchId, date, partySize, timeZone: restaurantTimeZone, slots };
  }
}
