import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { CheckoutBenefitsController, CustomerLoyaltyController, LoyaltyManagementController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

@Module({ controllers: [LoyaltyManagementController, CheckoutBenefitsController, CustomerLoyaltyController], providers: [LoyaltyService, VerifiedSessionGuard], exports: [LoyaltyService] })
export class LoyaltyModule {}
