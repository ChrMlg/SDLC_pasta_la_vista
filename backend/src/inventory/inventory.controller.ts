import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { InventoryService } from './inventory.service';
import { InventoryAlertsService } from './inventory-alerts.service';

@Controller('management/branches/:branchId/inventory')
@UseGuards(VerifiedSessionGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService, private readonly alerts: InventoryAlertsService) {}

  @Get('alerts')
  listAlerts(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.alerts.list(branchId, query, request.user!);
  }

  @Get()
  list(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.inventory.list(branchId, query, request.user!);
  }
}
