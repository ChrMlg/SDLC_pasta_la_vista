import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { inputFields } from '../common/business-error';
import { ReviewsService } from './reviews.service';

@Controller('orders/:orderId')
@UseGuards(VerifiedSessionGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get('review-eligibility')
  eligibility(@Param('orderId') id: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    inputFields(query, []);
    return this.reviews.eligibility(id, request.user!);
  }

  @Post('reviews')
  create(@Param('orderId') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.reviews.create(id, body, request.user!);
  }
}
