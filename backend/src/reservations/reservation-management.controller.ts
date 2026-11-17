import { ApiQuery } from '@nestjs/swagger';
import { ApiBody } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { ReservationManagementService } from './reservation-management.service';

@Controller()
@UseGuards(VerifiedSessionGuard)
export class ReservationManagementController {
  constructor(private readonly reservations: ReservationManagementService) {}

  @ApiQuery({"name": "date", "required": true, "schema": {"type": "string", "format": "date"}})
  @Get('management/branches/:branchId/occupancy')
  occupancy(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.reservations.occupancy(branchId, query, request.user!);
  }

  @ApiBody({ schema: {"type": "object", "properties": {}, "example": {}} })
  @Put('reservations/:id/cancel')
  cancel(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.reservations.cancel(id, body, request.user!);
  }
}
