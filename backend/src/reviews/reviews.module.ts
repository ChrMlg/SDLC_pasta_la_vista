import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({ controllers: [ReviewsController], providers: [ReviewsService, VerifiedSessionGuard] })
export class ReviewsModule {}
