import { ApiBody, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { InventoryMovementsService } from './inventory-movements.service';

@ApiTags('Inventario')
@Controller('management/inventory/movements')
@UseGuards(VerifiedSessionGuard)
export class InventoryMovementsController {
  constructor(private readonly movements: InventoryMovementsService) {}

  @Post()
  @ApiBody({ schema: {
    type: 'object',
    required: ['branchId', 'itemId', 'quantity', 'type', 'reason'],
    properties: {
      branchId: { type: 'string', format: 'uuid' },
      itemId: { type: 'string', format: 'uuid' },
      quantity: { type: 'integer', minimum: 1 },
      type: { type: 'string', enum: ['IN', 'OUT'] },
      reason: { type: 'string', minLength: 1, maxLength: 200 },
    },
  } })
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.movements.create(body, request.user!);
  }
}
