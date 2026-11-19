import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { LoyaltyService } from './loyalty.service';

@Controller('management/loyalty')
@UseGuards(VerifiedSessionGuard)
export class LoyaltyManagementController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('rules')
  rules(@Req() request: AuthenticatedRequest) {
    return this.loyalty.getRule(request.user!);
  }

  @Put('rules')
  updateRule(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.loyalty.updateRule(body, request.user!);
  }

  @Get('benefits')
  allBenefits(@Req() request: AuthenticatedRequest) {
    return this.loyalty.listAllBenefits(request.user!);
  }

  @Post('benefits')
  createBenefit(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.loyalty.createBenefit(body, request.user!);
  }

  @Patch('benefits/:benefitId')
  updateBenefit(@Param('benefitId') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.loyalty.updateBenefit(id, body, request.user!);
  }
}

@Controller('loyalty/benefits')
@UseGuards(VerifiedSessionGuard)
export class CheckoutBenefitsController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  active(@Req() request: AuthenticatedRequest) {
    return this.loyalty.listActiveBenefits(request.user!);
  }
}
