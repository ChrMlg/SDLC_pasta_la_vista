import { RatingsSummaryController } from './ratings-summary.controller';
import { RatingsSummaryService } from './ratings-summary.service';
import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({ controllers: [ReviewsController, RatingsSummaryController], providers: [RatingsSummaryService, ReviewsService, VerifiedSessionGuard] })
export class ReviewsModule {}
