import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { VerifiedSessionGuard } from '../common/session';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaOrdersRepository } from './prisma-orders.repository';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { MySeatingController, SeatingController } from './seating.controller';
import { OrderTrackingController } from './order-tracking.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [OrdersController, SeatingController, MySeatingController, OrderTrackingController],
  providers: [
    VerifiedSessionGuard,
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
    { provide: PrismaOrdersRepository, useFactory: (db: PrismaClient) => new PrismaOrdersRepository(db), inject: [PrismaClient] },
    { provide: OrdersService, useFactory: (repo: PrismaOrdersRepository, notifications: NotificationsService) => new OrdersService(repo, notifications), inject: [PrismaOrdersRepository, NotificationsService] },
  ],
})
export class OrdersModule {}
