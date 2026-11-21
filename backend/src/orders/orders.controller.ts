import { ApiBody, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { OrdersService } from './orders.service';

@ApiTags('Menú y pedidos')
@Controller('orders')
@UseGuards(VerifiedSessionGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post()
  createWaiter(@Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.orders.create(body, request.user!, false); }
  @ApiBody({ schema: {"type": "object", "properties": {"branchId": {"type": "string"}, "type": {"type": "string"}, "items": {"type": "array", "items": {"type": "object", "properties": {"dishId": {"type": "string"}, "quantity": {"type": "integer"}}}}}, "example": {"branchId": "a1111111-1111-4111-8111-111111111111", "type": "TAKEAWAY", "items": [{"dishId": "a1111111-1111-4111-8111-111111111111", "quantity": 1}]}} })
  @Post('customer')
  createCustomer(@Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.orders.create(body, request.user!, true); }
  @Post(':orderId/link-code')
  createLinkCode(@Param('orderId') id: string, @Req() request: AuthenticatedRequest) { return this.orders.createLinkCode(id, request.user!); }
  @Get('link-code/:code')
  previewCode(@Param('code') code: string, @Req() request: AuthenticatedRequest) { return this.orders.previewCode(code, request.user!); }
  @ApiBody({ schema: {"type": "object", "properties": {"code": {"type": "string"}}, "example": {"code": "Ejemplo"}} })
  @Post('link-code/confirm')
  confirmCode(@Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.orders.confirmCode(body, request.user!); }
}
