import { Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderError } from './orders.service';
import { expectedPrevious } from './order-transition';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const conflict = (message: string) => new OrderError(409, 'ORDER_STATUS_CONFLICT', message);

@Controller('orders')
@UseGuards(VerifiedSessionGuard)
export class OrderTrackingController {
  constructor(private readonly db: PrismaClient, private readonly notifications: NotificationsService) {}

  @Get()
  async list(@Req() request: AuthenticatedRequest) {
    const user = request.user!;
    if (!['WAITER', 'KITCHEN', 'MANAGER', 'GENERAL_MANAGER'].includes(user.role))
      throw new OrderError(403, 'FORBIDDEN', 'Sin permiso para consultar pedidos');
    if (!user.branchId && user.role !== 'GENERAL_MANAGER') throw new OrderError(403, 'FORBIDDEN', 'Sucursal requerida');
    const orders = await this.db.order.findMany({
      where: { ...(user.branchId ? { branchId: user.branchId } : {}),
        ...(user.role === 'KITCHEN' ? { kitchenTicket: { isNot: null } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
      include: { branch: { select: { name: true } }, table: { select: { number: true } }, kitchenTicket: { select: { status: true } },
        items: { include: { dish: { select: { name: true } } } } },
    });
    return orders.map(order => ({ id: order.id, orderNumber: order.orderNumber, branchId: order.branchId, branchName: order.branch.name,
      tableNumber: order.table?.number ?? null, type: order.type, status: order.status,
      ticketStatus: order.kitchenTicket?.status ?? null, total: order.total.toFixed(2), createdAt: order.createdAt,
      items: order.items.map(item => ({ id: item.id, name: item.dish.name, quantity: item.quantity, note: item.note })) }));
  }

  @Patch(':orderId/status/:status')
  async changeStatus(@Param('orderId') orderId: string, @Param('status') status: string, @Req() request: AuthenticatedRequest) {
    if (!uuid.test(orderId)) throw new OrderError(400, 'INVALID_ID', 'Identificador inválido', 'orderId');
    const user = request.user!;
    if (user.role !== 'KITCHEN' && user.role !== 'WAITER') throw new OrderError(403, 'FORBIDDEN', 'Sin permiso para actualizar pedidos');
    if (!user.branchId) throw new OrderError(403, 'FORBIDDEN', 'Sucursal requerida');
    const expected = expectedPrevious(user.role, status);
    if (!expected) throw new OrderError(403, 'FORBIDDEN', 'Transición no permitida');
    try {
      const result = await this.db.$transaction(async tx => {
        const rows = await tx.$queryRaw<{ id: string; branchId: string; status: string }[]>`
          SELECT "id", "branchId", "status"::text FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
        const order = rows[0];
        if (!order || order.branchId !== user.branchId) throw new OrderError(404, 'NOT_FOUND', 'Pedido no encontrado');
        const ticket = await tx.kitchenTicket.findUnique({ where: { orderId } });
        if (!ticket) throw conflict('El pedido aún no está en cocina');
        if (order.status !== expected || ticket.status !== (status === 'DELIVERED' ? 'READY' : expected)) throw conflict('El estado del pedido cambió');
        await tx.order.update({ where: { id: orderId }, data: { status: status as 'IN_PREPARATION' | 'READY' | 'DELIVERED',
          ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}) } });
        if (status === 'IN_PREPARATION' || status === 'READY')
          await tx.kitchenTicket.update({ where: { orderId }, data: { status } });
        if (status === 'IN_PREPARATION' || status === 'READY')
          await tx.orderItem.updateMany({ where: { orderId }, data: { status } });
        return { id: orderId, status };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (status === 'IN_PREPARATION' || status === 'READY') {
        try { await this.notifications.kitchenStatusCommitted(orderId, status); }
        catch (error) { console.error('Notification delivery failed after status commit', error); }
      }
      if (status === 'DELIVERED') {
        try { await this.notifications.orderDeliveryCommitted(orderId, status); }
        catch { console.error('No se pudo registrar el aviso de entrega'); }
      }
      return result;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') throw conflict('El estado del pedido cambió');
      throw error;
    }
  }
}
