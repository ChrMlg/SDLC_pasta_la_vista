import { OrderNotificationsController } from './order-notifications.controller';
import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { VerifiedSessionGuard } from '../common/session';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController, OrderNotificationsController],
  providers: [VerifiedSessionGuard,
    { provide: NotificationsService, useFactory: (db: PrismaClient) => new NotificationsService(db), inject: [PrismaClient] }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
