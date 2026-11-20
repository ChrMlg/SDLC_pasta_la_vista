import { ApiBody } from '@nestjs/swagger';
import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { OrderDeliveryService } from './order-delivery.service';

@Controller('branches/:branchId/orders')
@UseGuards(VerifiedSessionGuard)
export class OrderDeliveryController {
  constructor(private readonly delivery: OrderDeliveryService) {}

  @ApiBody({ schema: {"type": "object", "properties": {}, "example": {}} })
  @Patch(':orderId/pickup')
  pickup(@Param('branchId') branchId: string, @Param('orderId') orderId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.delivery.change(branchId, orderId, 'pickup', body, request.user!);
  }

  @ApiBody({ schema: {"type": "object", "properties": {}, "example": {}} })
  @Patch(':orderId/deliver')
  deliver(@Param('branchId') branchId: string, @Param('orderId') orderId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.delivery.change(branchId, orderId, 'deliver', body, request.user!);
  }
}
