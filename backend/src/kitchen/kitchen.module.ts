import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';

@Module({ controllers: [KitchenController], providers: [KitchenService, VerifiedSessionGuard] })
export class KitchenModule {}
