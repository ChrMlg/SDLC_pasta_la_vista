import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BusinessError, inputFields, validateId } from '../common/business-error';
import type { Session } from '../menu/menu.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OrderDeliveryService {
  private readonly logger = new Logger(OrderDeliveryService.name);
  constructor(private readonly db: PrismaClient, private readonly notifications: NotificationsService) {}

  async change(branchId: string, orderId: string, action: 'pickup' | 'deliver', body: unknown, session: Session) {
    if (session.role !== 'WAITER' || !session.branchId)
      throw new BusinessError(403, 'FORBIDDEN', 'Solo meseros de la sucursal pueden recoger o entregar pedidos');
    validateId(branchId, 'branchId'); validateId(orderId, 'orderId');
    branchId = branchId.toLowerCase(); orderId = orderId.toLowerCase();
    if (branchId !== session.branchId) throw new BusinessError(403, 'FORBIDDEN', 'Sucursal no autorizada');
    inputFields(body ?? {}, []);
    const status = action === 'pickup' ? 'OUT_FOR_DELIVERY' : 'DELIVERED';
    const expected = action === 'pickup' ? 'READY' : 'OUT_FOR_DELIVERY';
    const timestamp = await this.db.$transaction(async tx => {
      // Comparte el bloqueo del pedido con cocina; no modifica la comanda ni la cuenta.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { kitchenTicket: true } });
      if (!order) throw new BusinessError(404, 'NOT_FOUND', 'Pedido no encontrado');
      if (order.branchId !== branchId) throw new BusinessError(403, 'FORBIDDEN', 'Sucursal no autorizada');
      if (order.kitchenTicket?.branchId !== branchId || order.kitchenTicket.status !== 'READY' || order.status !== expected)
        throw new BusinessError(409, 'INVALID_ORDER_TRANSITION', 'El pedido no está en el estado requerido');
      const now = new Date();
      const changed = await tx.order.updateMany({ where: { id: orderId, branchId, status: expected }, data: {
        status, ...(action === 'pickup' ? { pickedUpAt: now, pickedUpById: session.userId } : { deliveredAt: now, deliveredById: session.userId }),
      } });
      if (changed.count !== 1) throw new BusinessError(409, 'INVALID_ORDER_TRANSITION', 'El estado del pedido cambió');
      return now;
    });
    try { await this.notifications.orderDeliveryCommitted(orderId, status); }
    catch { this.logger.error('No se pudo registrar el aviso; la transición del pedido quedó confirmada'); }
    return action === 'pickup' ? { orderId, status, pickedUpAt: timestamp } : { orderId, status, deliveredAt: timestamp };
  }
}
