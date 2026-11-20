import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { InventoryMovementsService } from './inventory-movements.service';

@Controller('management/inventory/movements')
@UseGuards(VerifiedSessionGuard)
export class InventoryMovementsController {
  constructor(private readonly movements: InventoryMovementsService) {}

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.movements.create(body, request.user!);
  }
}
