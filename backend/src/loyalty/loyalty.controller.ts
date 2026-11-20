import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { LoyaltyService } from './loyalty.service';
import { ApiBody, ApiTags } from '@nestjs/swagger';

const benefitProperties = {
  name: { type: 'string', example: 'Descuento de evaluación' },
  pointsRequired: { type: 'integer', minimum: 1, example: 5 },
  discountValue: { type: 'string', example: '1.00' },
  isActive: { type: 'boolean', example: true },
};

@ApiTags('Lealtad')
@Controller('management/loyalty')
@UseGuards(VerifiedSessionGuard)
export class LoyaltyManagementController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('rules')
  rules(@Req() request: AuthenticatedRequest) {
    return this.loyalty.getRule(request.user!);
  }

  @Put('rules')
  @ApiBody({ schema: { type: 'object', required: ['conversionRate'], properties: { conversionRate: { type: 'string', example: '1.0000' } } } })
  updateRule(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.loyalty.updateRule(body, request.user!);
  }

  @Get('benefits')
  allBenefits(@Req() request: AuthenticatedRequest) {
    return this.loyalty.listAllBenefits(request.user!);
  }

  @Post('benefits')
  @ApiBody({ schema: { type: 'object', required: ['name', 'pointsRequired', 'discountValue', 'isActive'], properties: benefitProperties } })
  createBenefit(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.loyalty.createBenefit(body, request.user!);
  }

  @Patch('benefits/:benefitId')
  @ApiBody({ schema: { type: 'object', minProperties: 1, properties: benefitProperties } })
  updateBenefit(@Param('benefitId') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.loyalty.updateBenefit(id, body, request.user!);
  }
}

@ApiTags('Lealtad')
@Controller('loyalty/benefits')
@UseGuards(VerifiedSessionGuard)
export class CheckoutBenefitsController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  active(@Req() request: AuthenticatedRequest) {
    return this.loyalty.listActiveBenefits(request.user!);
  }
}

@ApiTags('Lealtad')
@Controller('me/loyalty')
@UseGuards(VerifiedSessionGuard)
export class CustomerLoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('balance')
  balance(@Req() request: AuthenticatedRequest) {
    return this.loyalty.balance(request.user!);
  }

  @Get('history')
  history(@Req() request: AuthenticatedRequest, @Query('page') page?: string) {
    return this.loyalty.history(request.user!, page);
  }
}
