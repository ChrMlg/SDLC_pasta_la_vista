import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, validateId } from '../common/business-error';
import { validateReview } from './dto/review.dto';
import { reviewConflict } from './review-rules';

const orderSelect = {
  id: true, branchId: true, clientId: true, status: true, deliveredAt: true,
  review: { select: { id: true } },
} satisfies Prisma.OrderSelect;
type ReviewOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

@Injectable()
export class ReviewsService {
  constructor(private readonly db: PrismaClient) {}

  private requireCustomer(orderId: string, session: Session) {
    if (session.role !== 'CUSTOMER') throw new BusinessError(403, 'FORBIDDEN', 'Solo clientes pueden registrar y consultar su elegibilidad para reseñas');
    validateId(orderId, 'orderId');
    return orderId.toLowerCase();
  }

  private requireOwner(order: ReviewOrder | null, session: Session): asserts order is ReviewOrder {
    if (!order || (order.clientId !== null && order.clientId !== session.userId))
      throw new BusinessError(404, 'NOT_FOUND', 'Pedido no encontrado');
    // Un pedido sin vincular no expone detalles ni admite autoría enviada por el cliente.
    if (!order.clientId) throw new BusinessError(409, 'ORDER_NOT_LINKED', 'El pedido no tiene un cliente confirmado');
  }

  async eligibility(orderId: string, session: Session) {
    const id = this.requireCustomer(orderId, session);
    const order = await this.db.order.findUnique({ where: { id }, select: orderSelect });
    this.requireOwner(order, session);
    const conflict = reviewConflict(order, new Date());
    return { orderId: order.id, branchId: order.branchId, status: order.status, deliveredAt: order.deliveredAt,
      canReview: !conflict, reason: conflict?.message ?? null };
  }

  async create(orderId: string, body: unknown, session: Session) {
    const id = this.requireCustomer(orderId, session);
    const input = validateReview(body);
    try {
      return await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const order = await tx.order.findUnique({ where: { id }, select: orderSelect });
        this.requireOwner(order, session);
        // Reevalúa estado, propietario, plazo y duplicados después de adquirir el bloqueo.
        const conflict = reviewConflict(order, new Date());
        if (conflict) throw new BusinessError(409, conflict.code, conflict.message);
        return tx.review.create({ data: { orderId: order.id, clientId: session.userId, branchId: order.branchId, ...input },
          select: { id: true, orderId: true, clientId: true, branchId: true, rating: true, comment: true, createdAt: true } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new BusinessError(409, 'REVIEW_ALREADY_EXISTS', 'Este pedido ya tiene una reseña');
      throw error;
    }
  }
}
