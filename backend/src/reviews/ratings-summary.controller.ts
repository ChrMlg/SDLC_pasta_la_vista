import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { RatingsSummaryService } from './ratings-summary.service';

@ApiTags('Reseñas')
@Controller('management/branches/:branchId/ratings')
@UseGuards(VerifiedSessionGuard)
export class RatingsSummaryController {
  constructor(private readonly ratings: RatingsSummaryService) {}

  @Get('summary')
  @ApiQuery({ name: 'dateFrom', required: false, description: 'Fecha inicial inclusiva en America/El_Salvador. Si se indica, también se requiere dateTo.', schema: { type: 'string', format: 'date' } })
  @ApiQuery({ name: 'dateTo', required: false, description: 'Fecha final inclusiva, igual o posterior a dateFrom. Si se indica, también se requiere dateFrom.', schema: { type: 'string', format: 'date' } })
  summary(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.ratings.summary(branchId, query, request.user!);
  }
}
