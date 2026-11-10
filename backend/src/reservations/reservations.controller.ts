import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { ReservationsService } from './reservations.service';

@Controller()
@UseGuards(VerifiedSessionGuard)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post('reservations')
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.reservations.create(body, request.user!);
  }

  @Get('branches/:branchId/reservation-availability')
  availability(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.reservations.availability(branchId, query, request.user!);
  }
}
