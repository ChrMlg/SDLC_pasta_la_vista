import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BusinessError } from '../common/business-error';
import { SalesMetricsService } from './sales-metrics.service';
import { periodResponse, reportBranchIds, reportFields, reportInvalid, reportPeriod } from './dto/analytics-query.dto';

@Injectable()
export class TopDishesService {
  constructor(private readonly db: PrismaClient, private readonly sales: SalesMetricsService) {}
  async list(branchId: string, query: Record<string, unknown>) {
    reportFields(query, ['limit']);
    const period = reportPeriod(query), id = reportBranchIds(branchId, 1)[0];
    if (query.limit !== undefined && (typeof query.limit !== 'string' || !/^[1-9]\d*$/.test(query.limit) || Number(query.limit) > 100)) reportInvalid('limit', 'Use un límite entre 1 y 100');
    const limit = query.limit === undefined ? 10 : Number(query.limit);
    if (!await this.db.branch.findUnique({ where: { id }, select: { id: true } })) throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    const { payments } = await this.sales.read(period, [id]);
    const orderIds = [...new Set(payments.flatMap(payment => payment.bill.orders.map(order => order.id)))];
    const items = await this.db.$transaction(async tx => {
      const quantities = await tx.orderItem.groupBy({ by: ['dishId'], where: { orderId: { in: orderIds }, status: { not: 'CANCELLED' } },
        _sum: { quantity: true }, orderBy: [{ _sum: { quantity: 'desc' } }, { dishId: 'asc' }], take: limit });
      const dishes = await tx.menuItem.findMany({ where: { id: { in: quantities.map(row => row.dishId) } }, select: { id: true, name: true } });
      return quantities.map(row => ({ dishId: row.dishId, dishName: dishes.find(dish => dish.id === row.dishId)!.name, unitsSold: row._sum.quantity! }));
    });
    return { branchId: id, ...periodResponse(period), items };
  }
}
