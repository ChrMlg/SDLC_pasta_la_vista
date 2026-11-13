import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { InventoryService } from './inventory.service';

@Controller('management/branches/:branchId/inventory')
@UseGuards(VerifiedSessionGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.inventory.list(branchId, query, request.user!);
  }
}
