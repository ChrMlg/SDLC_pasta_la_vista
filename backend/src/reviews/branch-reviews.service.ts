import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { BusinessError, validateId } from '../common/business-error';
import type { Session } from '../menu/menu.service';
import { reviewsQuery } from './dto/reviews-query.dto';

@Injectable()
export class BranchReviewsService {
  constructor(private readonly db: PrismaClient) {}

  async list(branchId: string, query: Record<string, unknown>, session: Session) {
    if (!['CUSTOMER', 'WAITER', 'MANAGER', 'GENERAL_MANAGER'].includes(session.role))
      throw new BusinessError(403, 'FORBIDDEN', 'Sin permiso para consultar reseñas');
    validateId(branchId, 'branchId');
    branchId = branchId.toLowerCase();
    if (['WAITER', 'MANAGER'].includes(session.role) && session.branchId !== branchId)
      throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    const { page, rating } = reviewsQuery(query), pageSize = 10;
    // Conteo y página usan la misma vista aunque se registre otra reseña durante la consulta.
    return this.db.$transaction(async tx => {
      if (!await tx.branch.findUnique({ where: { id: branchId }, select: { id: true } }))
        throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
      const where = { branchId, ...(rating === undefined ? {} : { rating }) };
      const total = await tx.review.count({ where }), skip = (page - 1) * pageSize;
      const data = skip >= total ? [] : await tx.review.findMany({ where, skip, take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: { id: true, rating: true, comment: true, createdAt: true } });
      return { data, total, page, pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
