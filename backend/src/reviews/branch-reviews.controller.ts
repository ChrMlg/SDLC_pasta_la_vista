import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { BranchReviewsService } from './branch-reviews.service';

@Controller('branches/:branchId/reviews')
@UseGuards(VerifiedSessionGuard)
export class BranchReviewsController {
  constructor(private readonly reviews: BranchReviewsService) {}

  @Get()
  list(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return this.reviews.list(branchId, query, request.user!);
  }
}
