import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationManagementController } from './reservation-management.controller';
import { ReservationManagementService } from './reservation-management.service';

@Module({ imports: [NotificationsModule], controllers: [ReservationsController, ReservationManagementController], providers: [ReservationsService, ReservationManagementService, VerifiedSessionGuard] })
export class ReservationsModule {}
