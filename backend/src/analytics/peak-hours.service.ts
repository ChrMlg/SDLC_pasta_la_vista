import { Injectable } from '@nestjs/common';
import { SalesMetricsService } from './sales-metrics.service';
import { periodResponse, reportBranchIds, reportFields, reportPeriod } from './dto/analytics-query.dto';

@Injectable()
export class PeakHoursService {
  constructor(private readonly sales: SalesMetricsService) {}
  async list(query: Record<string, unknown>) {
    reportFields(query, ['branchIds']);
    const period = reportPeriod(query), ids = reportBranchIds(query.branchIds, 1);
    const { metrics, payments } = await this.sales.read(period, ids);
    const hour = 3600000;
    const branches = metrics.map(branch => {
      const counts = new Map<number, number>();
      // UTC-06 tiene horas enteras: el truncado UTC conserva los mismos límites horarios locales.
      for (let at = Math.floor(period.from.getTime() / hour) * hour; at <= period.to.getTime(); at += hour) counts.set(at, 0);
      const orders = new Map(payments.filter(payment => payment.bill.branchId === branch.branchId).flatMap(payment => payment.bill.orders.map(order => [order.id, order.createdAt] as const)));
      for (const at of orders.values()) {
        if (at < period.from || at > period.to) continue;
        const start = Math.floor(at.getTime() / hour) * hour;
        counts.set(start, (counts.get(start) ?? 0) + 1);
      }
      const slots = [...counts].sort((a,b) => b[1] - a[1] || a[0] - b[0]).slice(0,3).map(([at,orderCount]) => ({
        startAt: new Date(at - 6 * hour).toISOString().replace('Z','-06:00'), orderCount,
      }));
      return { branchId: branch.branchId, branchName: branch.branchName, slots };
    });
    return { period: periodResponse(period), intervalMinutes: 60, branches };
  }
}
