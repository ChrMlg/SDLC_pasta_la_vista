import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { BillingService } from './billing.service';
import { receiptPdf } from './receipt-pdf';

@Controller()
@UseGuards(VerifiedSessionGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}
  @Get('branches/:branchId/tables/:tableId/billing-summary')
  summary(@Param('branchId') branchId: string, @Param('tableId') tableId: string, @Req() request: AuthenticatedRequest) { return this.billing.summary(branchId, tableId, request.user!); }
  @Post('branches/:branchId/bills')
  create(@Param('branchId') branchId: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.billing.create(branchId, body, request.user!); }
  @Get('bills/:billId')
  bill(@Param('billId') billId: string, @Req() request: AuthenticatedRequest) { return this.billing.getBill(billId, request.user!); }
  @Post('bills/:billId/payments')
  @HttpCode(200)
  pay(@Param('billId') billId: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.billing.pay(billId, key, body, request.user!); }
  @Get('branches/:branchId/receipts/:receiptId/pdf')
  async branchPdf(@Param('branchId') branchId: string, @Param('receiptId') receiptId: string, @Req() request: AuthenticatedRequest, @Res() response: Response) {
    const data = await this.billing.receipt(branchId, receiptId, request.user!); response.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="${data.number}.pdf"`).send(receiptPdf(data));
  }
  @Get('branches/:branchId/receipts/:receiptId')
  branchReceipt(@Param('branchId') branchId: string, @Param('receiptId') receiptId: string, @Req() request: AuthenticatedRequest) { return this.billing.receipt(branchId, receiptId, request.user!); }
  @Get('me/receipts')
  mine(@Req() request: AuthenticatedRequest, @Query('page') page?: string) { return this.billing.myReceipts(request.user!, page); }
  @Get('me/receipts/:receiptId/pdf')
  async myPdf(@Param('receiptId') receiptId: string, @Req() request: AuthenticatedRequest, @Res() response: Response) {
    const data = await this.billing.receipt('', receiptId, request.user!, true); response.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="${data.number}.pdf"`).send(receiptPdf(data));
  }
  @Get('me/receipts/:receiptId')
  myReceipt(@Param('receiptId') receiptId: string, @Req() request: AuthenticatedRequest) { return this.billing.receipt('', receiptId, request.user!, true); }
}
