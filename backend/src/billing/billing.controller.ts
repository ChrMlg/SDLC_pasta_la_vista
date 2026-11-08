import { Body, Controller, Get, Headers, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { BillingService } from './billing.service';

function pdf(receipt: Awaited<ReturnType<BillingService['receipt']>>): Buffer {
  const snapshot = receipt.snapshot as { items: { name: string; quantity: number; lineTotal: string }[]; subtotal: string; discount: string; tax: string; total: string };
  const lines = [`Comprobante ${receipt.number}`, `Tarjeta **** ${receipt.cardLast4}`, ...snapshot.items.map(item => `${item.quantity} x ${item.name}  $${item.lineTotal}`),
    `Subtotal: $${snapshot.subtotal}`, `Descuento: $${snapshot.discount}`, `IVA: $${snapshot.tax}`, `Total: $${snapshot.total}`];
  const safe = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '\\$&');
  const content = `BT /F1 11 Tf 50 780 Td 16 TL ${lines.map((line, index) => `${index ? 'T* ' : ''}(${safe(line)}) Tj`).join('\n')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let output = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(output); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

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
  pay(@Param('billId') billId: string, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.billing.pay(billId, key, body, request.user!); }
  @Get('branches/:branchId/receipts/:receiptId/pdf')
  async branchPdf(@Param('branchId') branchId: string, @Param('receiptId') receiptId: string, @Req() request: AuthenticatedRequest, @Res() response: Response) {
    const data = await this.billing.receipt(branchId, receiptId, request.user!); response.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="${data.number}.pdf"`).send(pdf(data));
  }
  @Get('branches/:branchId/receipts/:receiptId')
  branchReceipt(@Param('branchId') branchId: string, @Param('receiptId') receiptId: string, @Req() request: AuthenticatedRequest) { return this.billing.receipt(branchId, receiptId, request.user!); }
  @Get('me/receipts')
  mine(@Req() request: AuthenticatedRequest) { return this.billing.myReceipts(request.user!); }
  @Get('me/receipts/:receiptId/pdf')
  async myPdf(@Param('receiptId') receiptId: string, @Req() request: AuthenticatedRequest, @Res() response: Response) {
    const data = await this.billing.receipt('', receiptId, request.user!, true); response.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="${data.number}.pdf"`).send(pdf(data));
  }
  @Get('me/receipts/:receiptId')
  myReceipt(@Param('receiptId') receiptId: string, @Req() request: AuthenticatedRequest) { return this.billing.receipt('', receiptId, request.user!, true); }
}
