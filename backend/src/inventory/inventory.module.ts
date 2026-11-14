import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryMovementsController } from './inventory-movements.controller';
import { InventoryMovementsService } from './inventory-movements.service';
import { InventoryAlertsService } from './inventory-alerts.service';

@Module({ controllers: [InventoryController, InventoryMovementsController], providers: [InventoryService, InventoryMovementsService, InventoryAlertsService, VerifiedSessionGuard] })
export class InventoryModule {}
