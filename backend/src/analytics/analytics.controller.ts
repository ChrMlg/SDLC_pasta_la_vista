import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { requireGeneral, reportFields, reportPeriod, periodResponse, reportBranchIds } from './dto/analytics-query.dto';
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
  @Get('branches/compare')
  async compare(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    requireGeneral(request.user!); reportFields(query, ['branchIds']);
    const period = reportPeriod(query), ids = reportBranchIds(query.branchIds, 2);
    const { metrics } = await this.sales.read(period, ids);
    const total = metrics.reduce((sum, branch) => sum + branch.totalSales, 0);
    return { period: periodResponse(period), metrics: metrics.map(({ hasData, ...branch }) => ({ ...branch, marketShare: total > 0 ? branch.totalSales / total : null })) };
  }

}
