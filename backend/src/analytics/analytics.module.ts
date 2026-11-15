import { TopDishesService } from './top-dishes.service';
import { Module } from '@nestjs/common';
import { VerifiedSessionGuard } from '../common/session';
import { AnalyticsController } from './analytics.controller';
import { SalesMetricsService } from './sales-metrics.service';

@Module({ controllers: [AnalyticsController], providers: [TopDishesService, SalesMetricsService, VerifiedSessionGuard] })
export class AnalyticsModule {}
