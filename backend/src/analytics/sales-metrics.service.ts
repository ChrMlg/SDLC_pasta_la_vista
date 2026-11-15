import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { reportInvalid, type ReportPeriod } from './dto/analytics-query.dto';

@Injectable()
export class SalesMetricsService {
  constructor(private readonly db: PrismaClient) {}

  async read(period: ReportPeriod, branchIds?: string[]) {
    return this.db.$transaction(async tx => {
      const branches = await tx.branch.findMany({ where: branchIds ? { id: { in: branchIds } } : {}, select: { id: true, name: true }, orderBy: { id: 'asc' } });
      if (branchIds && branches.length !== branchIds.length) reportInvalid('branchIds', 'Sucursal inexistente');
      // Payment pertenece a Bill en el modelo real. No se multiplica el importe por sus pedidos.
      // Una cuenta con pedidos anulados se excluye completa: no se inventa un prorrateo del pago.
      const payments = await tx.payment.findMany({ where: { status: 'PAID', createdAt: { gte: period.from, lte: period.to },
        bill: { status: 'PAID', ...(branchIds ? { branchId: { in: branchIds } } : {}), orders: { some: {}, none: { status: 'CANCELLED' } } } },
        select: { id: true, amount: true, bill: { select: { branchId: true, orders: { select: { id: true, createdAt: true } } } } } });
      const metrics = branches.map(branch => {
        const paid = payments.filter(payment => payment.bill.branchId === branch.id);
        const totalSales = paid.reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
        return { branchId: branch.id, branchName: branch.name, totalSales: totalSales.toNumber(),
          orderCount: new Set(paid.flatMap(payment => payment.bill.orders.map(order => order.id))).size, hasData: paid.length > 0 };
      });
      return { metrics, payments };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
