import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(VerifiedSessionGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post()
  createWaiter(@Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.orders.create(body, request.user!, false); }
  @Post('customer')
  createCustomer(@Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.orders.create(body, request.user!, true); }
  @Post(':orderId/link-code')
  createLinkCode(@Param('orderId') id: string, @Req() request: AuthenticatedRequest) { return this.orders.createLinkCode(id, request.user!); }
  @Get('link-code/:code')
  previewCode(@Param('code') code: string, @Req() request: AuthenticatedRequest) { return this.orders.previewCode(code, request.user!); }
  @Post('link-code/confirm')
  confirmCode(@Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.orders.confirmCode(body, request.user!); }
}
