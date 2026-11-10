import { Body, Controller, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { CustomerReservationsService } from './customer-reservations.service';

@Controller('me/reservations')
@UseGuards(VerifiedSessionGuard)
export class CustomerReservationsController {
  constructor(private readonly reservations: CustomerReservationsService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.reservations.list(query, request.user!);
  }

  @Put(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.reservations.cancel(id, body, request.user!);
  }
}
