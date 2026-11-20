import { BranchReviewsController } from './branch-reviews.controller';
import { BranchReviewsService } from './branch-reviews.service';
import { RatingsSummaryController } from './ratings-summary.controller';
import { RatingsSummaryService } from './ratings-summary.service';
import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({ controllers: [BranchReviewsController, ReviewsController, RatingsSummaryController], providers: [BranchReviewsService, RatingsSummaryService, ReviewsService, VerifiedSessionGuard] })
export class ReviewsModule {}
