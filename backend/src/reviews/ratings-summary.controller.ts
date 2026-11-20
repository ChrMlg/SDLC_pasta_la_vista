import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { RatingsSummaryService } from './ratings-summary.service';

@Controller('management/branches/:branchId/ratings')
@UseGuards(VerifiedSessionGuard)
export class RatingsSummaryController {
  constructor(private readonly ratings: RatingsSummaryService) {}

  @Get('summary')
  summary(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.ratings.summary(branchId, query, request.user!);
  }
}
