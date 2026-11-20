import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, inputFields } from '../common/business-error';
import { ReservationCancellationService } from './reservation-cancellation.service';

@Injectable()
export class CustomerReservationsService {
  constructor(private readonly db: PrismaClient, private readonly cancellations: ReservationCancellationService) {}

  async list(query: unknown, session: Session) {
    if (session.role !== 'CUSTOMER') throw new BusinessError(403, 'FORBIDDEN', 'Solo los clientes pueden consultar sus reservaciones');
    inputFields(query, []);
    const reservations = await this.db.reservation.findMany({
      where: { customerId: session.userId },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
      select: { id: true, branchId: true, branch: { select: { name: true } }, tableId: true, table: { select: { number: true } },
        date: true, startTime: true, endTime: true, partySize: true, status: true, createdAt: true, updatedAt: true },
    });
    return reservations.map(({ branch, table, ...reservation }) => ({ ...reservation, branchName: branch.name, tableNumber: table.number }));
  }

  cancel(id: string, body: unknown, session: Session) {
    return this.cancellations.cancel(id, body, session, 'CUSTOMER');
  }
}
