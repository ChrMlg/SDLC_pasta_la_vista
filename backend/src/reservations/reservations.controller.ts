import { ApiQuery } from '@nestjs/swagger';
import { ApiBody } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { ReservationsService } from './reservations.service';

@Controller()
@UseGuards(VerifiedSessionGuard)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @ApiBody({ schema: {"type": "object", "properties": {"branchId": {"type": "string"}, "date": {"type": "string"}, "time": {"type": "string"}, "partySize": {"type": "integer"}}, "example": {"branchId": "a1111111-1111-4111-8111-111111111111", "date": "2090-01-01", "time": "Ejemplo", "partySize": 2}} })
  @Post('reservations')
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.reservations.create(body, request.user!);
  }

  @ApiQuery({"name": "date", "required": false, "schema": {"type": "string", "format": "date"}})
  @ApiQuery({"name": "partySize", "required": false, "schema": {"type": "integer"}})
  @Get('branches/:branchId/reservation-availability')
  availability(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.reservations.availability(branchId, query, request.user!);
  }
}
