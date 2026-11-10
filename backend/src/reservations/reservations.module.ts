import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({ imports: [NotificationsModule], controllers: [ReservationsController], providers: [ReservationsService, VerifiedSessionGuard] })
export class ReservationsModule {}
