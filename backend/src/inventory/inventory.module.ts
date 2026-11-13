import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({ controllers: [InventoryController], providers: [InventoryService, VerifiedSessionGuard] })
export class InventoryModule {}
