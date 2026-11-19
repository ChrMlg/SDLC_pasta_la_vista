import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { CheckoutBenefitsController, CustomerLoyaltyController, LoyaltyManagementController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { RedemptionController, RedemptionGuard } from './redemption.controller';
import { RedemptionService } from './redemption.service';

@Module({ controllers: [LoyaltyManagementController, CheckoutBenefitsController, CustomerLoyaltyController, RedemptionController],
  providers: [LoyaltyService, RedemptionService, RedemptionGuard, VerifiedSessionGuard], exports: [LoyaltyService] })
export class LoyaltyModule {}
