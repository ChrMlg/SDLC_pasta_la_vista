import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, inputFields, validateId } from '../common/business-error';
import { NotificationsService } from '../notifications/notifications.service';
import { assertCancellationAllowed } from './reservation-rules';

@Injectable()
export class ReservationCancellationService {
  private readonly logger = new Logger(ReservationCancellationService.name);
  constructor(private readonly db: PrismaClient, private readonly notifications: NotificationsService) {}

  async cancel(id: string, body: unknown, session: Session, access: 'CUSTOMER' | 'MANAGEMENT') {
    if (access === 'CUSTOMER' ? session.role !== 'CUSTOMER' : !['MANAGER', 'GENERAL_MANAGER'].includes(session.role))
      throw new BusinessError(403, 'FORBIDDEN', 'No tiene permiso para cancelar reservaciones en esta ruta');
    validateId(id, 'id');
    inputFields(body ?? {}, []);
    const reservation = await this.db.$transaction(async tx => {
      // El mismo bloqueo coordina las cancelaciones de clientes (H12) y gerencia (H11).
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const existing = await tx.reservation.findUnique({ where: { id }, include: { branch: { select: { name: true } } } });
      if (!existing) throw new BusinessError(404, 'NOT_FOUND', 'Reservación no encontrada');
      // Verificar propiedad antes de revelar el estado o el plazo de una reserva ajena.
      if (access === 'CUSTOMER' && existing.customerId !== session.userId)
        throw new BusinessError(403, 'FORBIDDEN', 'Solo puede cancelar sus propias reservaciones');
      if (access === 'MANAGEMENT' && session.role === 'MANAGER' && existing.branchId !== session.branchId)
        throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
      assertCancellationAllowed(existing.date, existing.startTime, existing.status);
      const saved = await tx.reservation.update({
        where: { id, ...(access === 'CUSTOMER' ? { customerId: session.userId } : {}) },
        data: { status: 'CANCELLED' },
      });
      return { ...saved, branchName: existing.branch.name };
    });
    // Confirmar el cambio antes de registrar el aviso; un fallo no revierte la reserva.
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
