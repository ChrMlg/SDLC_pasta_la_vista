import { ApiQuery } from '@nestjs/swagger';
import { ApiBody } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { KitchenReadyService } from './kitchen-ready.service';
import { KitchenService } from './kitchen.service';
import { KitchenActionsService } from './kitchen-actions.service';

@Controller('branches/:branchId/kitchen/orders')
@UseGuards(VerifiedSessionGuard)
export class KitchenController {
  constructor(private readonly ready: KitchenReadyService, private readonly kitchen: KitchenService, private readonly actions: KitchenActionsService) {}

  @ApiBody({ schema: {"type": "object", "properties": {}, "example": {}} })
  @Patch(':orderId/items/:itemId/ready')
  markReady(@Param('branchId') branchId: string, @Param('orderId') orderId: string, @Param('itemId') itemId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.ready.mark(branchId, orderId, itemId, body, request.user!);
  }

  @ApiBody({ schema: {"type": "object", "properties": {}, "example": {}} })
  @Patch(':orderId/take')
  take(@Param('branchId') branchId: string, @Param('orderId') orderId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.actions.change(branchId, orderId, 'TAKE', body, request.user!);
  }

  @ApiBody({ schema: {"type": "object", "properties": {}, "example": {}} })
  @Patch(':orderId/release')
  release(@Param('branchId') branchId: string, @Param('orderId') orderId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.actions.change(branchId, orderId, 'RELEASE', body, request.user!);
  }

  @ApiQuery({"name": "status", "required": false, "schema": {"type": "string"}})
  @Get()
  list(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.kitchen.list(branchId, query, request.user!);
  }
}
