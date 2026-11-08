import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { VerifiedSessionGuard } from '../common/session';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';

@Module({
  imports: [NotificationsModule],
  controllers: [BillingController],
  providers: [VerifiedSessionGuard,
    { provide: BillingService, useFactory: (db: PrismaClient, notifications: NotificationsService) => new BillingService(db, undefined, notifications), inject: [PrismaClient, NotificationsService] }],
})
export class BillingModule {}
