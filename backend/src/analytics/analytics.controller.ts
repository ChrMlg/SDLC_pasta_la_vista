import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { requireGeneral, reportFields, reportPeriod, periodResponse } from './dto/analytics-query.dto';
import { SalesMetricsService } from './sales-metrics.service';

@Controller('analytics')
@UseGuards(VerifiedSessionGuard)
export class AnalyticsController {
  constructor(private readonly sales: SalesMetricsService) {}

  @Get('sales')
  async summary(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    requireGeneral(request.user!); reportFields(query);
    const period = reportPeriod(query), { metrics } = await this.sales.read(period);
    return { ...periodResponse(period), branches: metrics };
  }
}
