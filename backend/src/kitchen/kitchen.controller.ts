import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { KitchenService } from './kitchen.service';
import { KitchenActionsService } from './kitchen-actions.service';

@Controller('branches/:branchId/kitchen/orders')
@UseGuards(VerifiedSessionGuard)
export class KitchenController {
  constructor(private readonly kitchen: KitchenService, private readonly actions: KitchenActionsService) {}

  @Patch(':orderId/take')
  take(@Param('branchId') branchId: string, @Param('orderId') orderId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.actions.change(branchId, orderId, 'TAKE', body, request.user!);
  }

  @Patch(':orderId/release')
  release(@Param('branchId') branchId: string, @Param('orderId') orderId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.actions.change(branchId, orderId, 'RELEASE', body, request.user!);
  }

  @Get()
  list(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.kitchen.list(branchId, query, request.user!);
  }
}
