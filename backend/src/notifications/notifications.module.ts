import { OrderNotificationsController } from './order-notifications.controller';
import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { VerifiedSessionGuard } from '../common/session';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController, OrderNotificationsController],
  providers: [VerifiedSessionGuard,
    { provide: NotificationsService, useFactory: (db: PrismaClient) => new NotificationsService(db, {
      async findCommittedOwner(event) {
        if (event.status !== 'CONFIRMED' && event.status !== 'CANCELLED') return null;
        const reservation = await db.reservation.findFirst({ where: { id: event.reservationId, status: event.status }, select: { customerId: true } });
        return reservation?.customerId ?? null;
      },
    }), inject: [PrismaClient] }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
