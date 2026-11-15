import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, inputFields, validateId } from '../common/business-error';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class KitchenReadyService {
  private readonly logger = new Logger(KitchenReadyService.name);
  constructor(private readonly db: PrismaClient, private readonly notifications: NotificationsService) {}

  // itemId null conserva la acción de completar la comanda de la ruta anterior.
  async mark(branchId: string, orderId: string, itemId: string | null, body: unknown, session: Session) {
    if (session.role !== 'KITCHEN' || !session.branchId)
      throw new BusinessError(403, 'FORBIDDEN', 'Solo cocina puede marcar los platillos');
    validateId(branchId, 'branchId'); validateId(orderId, 'orderId');
    if (itemId !== null) validateId(itemId, 'itemId');
    branchId = branchId.toLowerCase(); orderId = orderId.toLowerCase(); itemId = itemId?.toLowerCase() ?? null;
    if (branchId !== session.branchId) throw new BusinessError(403, 'FORBIDDEN', 'Sucursal no autorizada');
    inputFields(body ?? {}, []);
    const result = await this.db.$transaction(async tx => {
      // Mismo orden de bloqueo que toma/liberación y entrega para evitar interbloqueos.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { bill: true } });
      if (!order) throw new BusinessError(404, 'NOT_FOUND', 'Pedido no encontrado');
      if (order.branchId !== branchId) throw new BusinessError(403, 'FORBIDDEN', 'Sucursal no autorizada');
      await tx.$queryRaw`SELECT "id" FROM "KitchenTicket" WHERE "orderId" = ${orderId}::uuid FOR UPDATE`;
      const ticket = await tx.kitchenTicket.findUnique({ where: { orderId } });
      if (!ticket) throw new BusinessError(404, 'NOT_FOUND', 'Comanda no encontrada');
      if (ticket.branchId !== branchId) throw new BusinessError(403, 'FORBIDDEN', 'Sucursal no autorizada');
      const item = itemId ? await tx.orderItem.findFirst({ where: { id: itemId, orderId } }) : null;
      if (itemId && !item) throw new BusinessError(404, 'NOT_FOUND', 'Platillo no encontrado en el pedido');
      if (ticket.status !== 'IN_PREPARATION' || order.status !== 'IN_PREPARATION')
        throw new BusinessError(409, 'TICKET_NOT_IN_PREPARATION', 'La comanda no está en preparación');
      if (order.type === 'TAKEAWAY' && order.bill?.status !== 'PAID')
        throw new BusinessError(409, 'ORDER_NOT_PAID', 'El pedido para llevar aún no está pagado');
      if (item?.isReady || item?.status === 'READY') throw new BusinessError(409, 'ITEM_ALREADY_READY', 'El platillo ya está listo');
      if (item?.status === 'CANCELLED') throw new BusinessError(409, 'ITEM_CANCELLED', 'El platillo está cancelado');
      const readyAt = new Date();
      const changed = await tx.orderItem.updateMany({ where: { orderId, ...(itemId ? { id: itemId } : {}), isReady: false, status: { notIn: ['READY', 'CANCELLED'] } },
        data: { isReady: true, status: 'READY', readyAt, readyById: session.userId } });
      if (!changed.count) throw new BusinessError(409, 'ITEM_ALREADY_READY', 'No hay platillos pendientes');
      const pending = await tx.orderItem.count({ where: { orderId, isReady: false, status: { notIn: ['READY', 'CANCELLED'] } } });
      let logId: string | undefined;
      if (pending === 0) {
        await tx.kitchenTicket.update({ where: { id: ticket.id }, data: { status: 'READY', readyAt } });
        await tx.order.update({ where: { id: orderId }, data: { status: 'READY' } });
        logId = (await tx.kitchenTicketLog.create({ data: { ticketId: ticket.id, action: 'READY', userId: session.userId } })).id;
      }
      const status = pending === 0 ? 'READY' : 'IN_PREPARATION';
      return { logId, response: { itemId, isReady: true, readyAt, ticketStatus: status, orderStatus: status } };
    });
    if (result.logId) {
      try { await this.notifications.kitchenStatusCommitted(orderId, 'READY', result.logId); }
      catch { this.logger.error('No se pudo registrar el aviso; el pedido quedó listo'); }
    }
    return result.response;
  }
}
