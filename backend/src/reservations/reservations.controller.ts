import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiBody } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { ReservationsService } from './reservations.service';

@ApiTags('Reservaciones')
@Controller()
@UseGuards(VerifiedSessionGuard)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @ApiBody({ schema: {"type": "object", "required": ["branchId", "date", "time", "partySize"], "properties": {"branchId": {"type": "string", "format": "uuid"}, "date": {"type": "string", "format": "date", "description": "Fecha futura dentro del rango permitido; consultar disponibilidad"}, "time": {"type": "string", "example": "12:00"}, "partySize": {"type": "integer", "minimum": 1}}, "example": {"branchId": "a1111111-1111-4111-8111-111111111111", "date": new Date(Date.now() + 86400000).toISOString().slice(0, 10), "time": "12:00", "partySize": 2}} })
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
