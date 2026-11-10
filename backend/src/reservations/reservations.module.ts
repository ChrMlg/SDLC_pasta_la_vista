import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationManagementController } from './reservation-management.controller';
import { ReservationManagementService } from './reservation-management.service';
import { CustomerReservationsController } from './customer-reservations.controller';
import { CustomerReservationsService } from './customer-reservations.service';
import { ReservationCancellationService } from './reservation-cancellation.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ReservationsController, ReservationManagementController, CustomerReservationsController],
  providers: [ReservationsService, ReservationManagementService, CustomerReservationsService, ReservationCancellationService, VerifiedSessionGuard],
})
export class ReservationsModule {}
