import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { KitchenService } from './kitchen.service';

@Controller('branches/:branchId/kitchen/orders')
@UseGuards(VerifiedSessionGuard)
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get()
  list(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.kitchen.list(branchId, query, request.user!);
  }
}
