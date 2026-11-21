import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { PerformanceService } from './performance.service';
import { PeakHoursService } from './peak-hours.service';
import { TopDishesService } from './top-dishes.service';
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { requireGeneral, reportFields, reportPeriod, periodResponse, reportBranchIds } from './dto/analytics-query.dto';
import { SalesMetricsService } from './sales-metrics.service';

@ApiTags('Reportes')
@Controller('analytics')
@UseGuards(VerifiedSessionGuard)
export class AnalyticsController {
  constructor(private readonly performance: PerformanceService, private readonly peaks: PeakHoursService, private readonly topDishes: TopDishesService, private readonly sales: SalesMetricsService) {}

  @ApiQuery({"name": "from", "required": true, "schema": {"type": "string", "format": "date-time"}})
  @ApiQuery({"name": "to", "required": true, "schema": {"type": "string", "format": "date-time"}})
  @Get('sales')
  async summary(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    requireGeneral(request.user!); reportFields(query);
    const period = reportPeriod(query), { metrics } = await this.sales.read(period);
    return { ...periodResponse(period), branches: metrics };
  }
  @ApiQuery({"name": "branchIds", "required": true, "schema": {"type": "string"}})
  @ApiQuery({"name": "from", "required": true, "schema": {"type": "string", "format": "date-time"}})
  @ApiQuery({"name": "to", "required": true, "schema": {"type": "string", "format": "date-time"}})
  @Get('branches/compare')
  async compare(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    requireGeneral(request.user!); reportFields(query, ['branchIds']);
    const period = reportPeriod(query), ids = reportBranchIds(query.branchIds, 2);
    const { metrics } = await this.sales.read(period, ids);
    const total = metrics.reduce((sum, branch) => sum + branch.totalSales, 0);
    return { period: periodResponse(period), metrics: metrics.map(({ hasData, ...branch }) => ({ ...branch, marketShare: total > 0 ? branch.totalSales / total : null })) };
  }

  @ApiQuery({"name": "from", "required": true, "schema": {"type": "string", "format": "date-time"}})
  @ApiQuery({"name": "limit", "required": false, "schema": {"type": "integer"}})
  @ApiQuery({"name": "to", "required": true, "schema": {"type": "string", "format": "date-time"}})
  @Get('branches/:branchId/top-dishes')
  top(@Param('branchId') branchId: string, @Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    requireGeneral(request.user!);
    return this.topDishes.list(branchId, query);
  }

  @ApiQuery({"name": "branchIds", "required": true, "schema": {"type": "string"}})
  @ApiQuery({"name": "from", "required": true, "schema": {"type": "string", "format": "date-time"}})
  @ApiQuery({"name": "to", "required": true, "schema": {"type": "string", "format": "date-time"}})
  @Get('branches/peak-hours')
  peakHours(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    requireGeneral(request.user!);
    return this.peaks.list(query);
  }

  @ApiQuery({"name": "direction", "required": false, "schema": {"type": "string"}})
  @ApiQuery({"name": "from", "required": true, "schema": {"type": "string", "format": "date-time"}})
  @ApiQuery({"name": "sortBy", "required": false, "schema": {"type": "string"}})
  @ApiQuery({"name": "to", "required": true, "schema": {"type": "string", "format": "date-time"}})
  @Get('branches/performance')
  branchPerformance(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    requireGeneral(request.user!);
    return this.performance.list(query);
  }

}
