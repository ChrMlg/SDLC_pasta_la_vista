import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError } from '../common/business-error';
import { kitchenStatuses } from './dto/kitchen-query.dto';

@Injectable()
export class KitchenService {
  constructor(private readonly db: PrismaClient) {}

  async list(branchId: string, query: Record<string, unknown>, session: Session) {
    if (session.role !== 'KITCHEN' || !session.branchId)
      throw new BusinessError(403, 'FORBIDDEN', 'Solo cocina puede consultar las comandas de su sucursal');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(branchId))
      throw new BusinessError(422, 'INVALID_FIELD', 'Sucursal inválida', 'branchId');
    branchId = branchId.toLowerCase();
    if (session.branchId !== branchId) throw new BusinessError(403, 'FORBIDDEN', 'Sucursal no autorizada');
    const statuses = kitchenStatuses(query);
    if (!await this.db.branch.count({ where: { id: branchId } }))
      throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    const tickets = await this.db.kitchenTicket.findMany({
      where: { branchId, status: { in: statuses }, order: { branchId,
        OR: [{ type: 'DINE_IN' }, { type: 'TAKEAWAY', bill: { status: 'PAID' } }],
      } },
      orderBy: [{ createdAt: 'asc' }, { orderId: 'asc' }],
      select: { status: true, createdAt: true, order: { select: {
        id: true, orderNumber: true, type: true, updatedAt: true, table: { select: { number: true } },
        items: { orderBy: { id: 'asc' }, select: { id: true, quantity: true, note: true, status: true, dish: { select: { name: true } } } },
      } } },
    });
    return { items: tickets.map(ticket => ({
      orderId: ticket.order.id, orderNumber: ticket.order.orderNumber,
      tableLabel: ticket.order.type === 'TAKEAWAY' ? 'Para llevar' : `Mesa ${ticket.order.table!.number}`,
      type: ticket.order.type, status: ticket.status, enteredAt: ticket.createdAt,
      // Conserva el campo que ya consumía el seguimiento H30 en esta misma ruta.
      updatedAt: ticket.order.updatedAt,
      items: ticket.order.items.map(item => ({ id: item.id, dishName: item.dish.name, quantity: item.quantity,
        note: item.note, isReady: item.status === 'READY' })),
    })) };
  }
}
