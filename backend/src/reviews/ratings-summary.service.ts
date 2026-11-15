import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, validateId } from '../common/business-error';
import { ratingsDateRange } from './dto/ratings-query.dto';

@Injectable()
export class RatingsSummaryService {
  constructor(private readonly db: PrismaClient) {}

  async summary(branchId: string, query: Record<string, unknown>, session: Session) {
    if (!['MANAGER', 'GENERAL_MANAGER'].includes(session.role))
      throw new BusinessError(403, 'FORBIDDEN', 'Solo gerencia puede consultar calificaciones');
    validateId(branchId, 'branchId');
    branchId = branchId.toLowerCase();
    if (session.role === 'MANAGER' && session.branchId !== branchId)
      throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    const createdAt = ratingsDateRange(query);
    if (!await this.db.branch.findUnique({ where: { id: branchId }, select: { id: true } }))
      throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    // Una sola agregación mantiene suma y conteo sobre el mismo conjunto de reseñas.
    const result = await this.db.review.aggregate({ where: { branchId, ...(createdAt ? { createdAt } : {}) }, _sum: { rating: true }, _count: { _all: true } });
    const reviewCount = result._count._all;
    return { branchId, averageRating: reviewCount ? Math.round((result._sum.rating! / reviewCount) * 10) / 10 : null, reviewCount };
  }
}
