import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, inputFields, validateId } from '../common/business-error';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class KitchenActionsService {
  private readonly logger = new Logger(KitchenActionsService.name);
  constructor(private readonly db: PrismaClient, private readonly notifications: NotificationsService) {}

  async change(branchId: string, orderId: string, action: 'TAKE' | 'RELEASE', body: unknown, session: Session) {
    if (session.role !== 'KITCHEN' || !session.branchId)
      throw new BusinessError(403, 'FORBIDDEN', 'Solo cocina puede modificar las comandas de su sucursal');
    validateId(branchId, 'branchId'); validateId(orderId, 'orderId');
    branchId = branchId.toLowerCase(); orderId = orderId.toLowerCase();
    if (session.branchId !== branchId) throw new BusinessError(403, 'FORBIDDEN', 'Sucursal no autorizada');
    inputFields(body ?? {}, []);
    const result = await this.db.$transaction(async tx => {
      // Orden de bloqueo compartido con el seguimiento legado y la futura H8: pedido, comanda.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, select: {
        branchId: true, status: true, type: true, bill: { select: { status: true } },
      } });
      if (!order) throw new BusinessError(404, 'NOT_FOUND', 'Pedido no encontrado');
      if (order.branchId !== branchId) throw new BusinessError(403, 'FORBIDDEN', 'Sucursal no autorizada');
      await tx.$queryRaw`SELECT "id" FROM "KitchenTicket" WHERE "orderId" = ${orderId}::uuid FOR UPDATE`;
      const ticket = await tx.kitchenTicket.findUnique({ where: { orderId } });
      if (!ticket) throw new BusinessError(404, 'NOT_FOUND', 'Comanda no encontrada');
      if (ticket.branchId !== branchId) throw new BusinessError(403, 'FORBIDDEN', 'Sucursal no autorizada');
      if (order.type === 'TAKEAWAY' && order.bill?.status !== 'PAID')
        throw new BusinessError(409, 'ORDER_NOT_PAID', 'El pedido para llevar aún no está pagado');
      const expected = action === 'TAKE' ? 'PENDING' : 'IN_PREPARATION';
      if (ticket.status !== expected || order.status !== expected)
        throw new BusinessError(409, action === 'TAKE' ? 'TICKET_ALREADY_TAKEN' : 'TICKET_NOT_IN_PREPARATION',
          action === 'TAKE' ? 'La comanda ya no está pendiente' : 'La comanda no está en preparación');
      if (await tx.orderItem.count({ where: { orderId, OR: [{ isReady: true }, { status: 'READY' }] } }))
        throw new BusinessError(409, 'TICKET_HAS_READY_ITEMS', 'La comanda tiene platillos listos');
      const status = action === 'TAKE' ? 'IN_PREPARATION' : 'PENDING';
      const takenAt = action === 'TAKE' ? new Date() : null;
      const changed = await tx.kitchenTicket.updateMany({ where: { id: ticket.id, branchId, status: expected },
        data: { status, takenById: action === 'TAKE' ? session.userId : null, takenAt } });
      if (changed.count !== 1) throw new BusinessError(409, 'TICKET_CONFLICT', 'La comanda cambió durante la operación');
      await tx.order.update({ where: { id: orderId }, data: { status } });
      await tx.orderItem.updateMany({ where: { orderId, status: action === 'TAKE' ? 'PENDING' : 'IN_PREPARATION' }, data: { status } });
      const log = await tx.kitchenTicketLog.create({ data: { ticketId: ticket.id, action, userId: session.userId } });
      return { logId: log.id, response: action === 'TAKE'
        ? { orderId, ticketStatus: status, orderStatus: status, takenById: session.userId, takenAt }
        : { orderId, ticketStatus: status, orderStatus: status } };
    });
    if (action === 'TAKE') {
      try { await this.notifications.kitchenStatusCommitted(orderId, 'IN_PREPARATION', result.logId); }
      catch { this.logger.error('No se pudo registrar el aviso de toma; la comanda quedó confirmada'); }
    }
    return result.response;
  }
}
