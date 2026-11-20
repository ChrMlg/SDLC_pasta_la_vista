import { KitchenReadyService } from './kitchen-ready.service';
import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';
import { KitchenActionsService } from './kitchen-actions.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({ imports: [NotificationsModule], controllers: [KitchenController],
  providers: [KitchenReadyService, KitchenService, KitchenActionsService, VerifiedSessionGuard], exports: [KitchenActionsService, KitchenReadyService] })
export class KitchenModule {}
