import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalesMetricsService } from './sales-metrics.service';
import { periodResponse, reportFields, reportInvalid, reportPeriod } from './dto/analytics-query.dto';

type Metric = { branchId: string; branchName: string; totalSales: number; orderCount: number; hasData: boolean };
export function performanceRows(metrics: Metric[]) {
  const withData = metrics.filter(row => row.hasData);
  const sum = withData.reduce((total, row) => total.plus(row.totalSales), new Prisma.Decimal(0));
  const average = withData.length ? sum.div(withData.length) : new Prisma.Decimal(0);
  return metrics.map(row => ({ ...row, averageSales: average.toDecimalPlaces(2).toNumber(),
    differencePercent: row.hasData && average.gt(0) ? new Prisma.Decimal(row.totalSales).minus(average).div(average).mul(100).toDecimalPlaces(2).toNumber() : null,
    attention: row.hasData ? new Prisma.Decimal(row.totalSales).lt(average.mul('0.8')) : null,
  }));
}
@Injectable()
export class PerformanceService {
  constructor(private readonly sales: SalesMetricsService) {}
  async list(query: Record<string, unknown>) {
    reportFields(query, ['sortBy', 'direction']);
    const period = reportPeriod(query), sortBy = query.sortBy ?? 'totalSales', direction = query.direction ?? 'desc';
    if (sortBy !== 'totalSales' && sortBy !== 'orderCount') reportInvalid('sortBy');
    if (direction !== 'asc' && direction !== 'desc') reportInvalid('direction');
    const { metrics } = await this.sales.read(period);
    const branches = performanceRows(metrics).sort((a,b) => (a[sortBy] - b[sortBy]) * (direction === 'asc' ? 1 : -1) || a.branchId.localeCompare(b.branchId));
    return { ...periodResponse(period), branches };
  }
}
