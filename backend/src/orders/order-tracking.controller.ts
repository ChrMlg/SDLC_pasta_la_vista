import { OrderDeliveryService } from './order-delivery.service';
import { KitchenReadyService } from '../kitchen/kitchen-ready.service';
import { Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { OrderError } from './orders.service';
import { KitchenActionsService } from '../kitchen/kitchen-actions.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('orders')
@UseGuards(VerifiedSessionGuard)
export class OrderTrackingController {
  constructor(private readonly ready: KitchenReadyService, private readonly db: PrismaClient, private readonly delivery: OrderDeliveryService, private readonly kitchen: KitchenActionsService) {}

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
    if (user.role === 'KITCHEN' && status === 'IN_PREPARATION') {
      const result = await this.kitchen.change(user.branchId, orderId, 'TAKE', request.body, user);
      return { id: result.orderId, status: result.orderStatus };
    }
    if (user.role === 'KITCHEN' && status === 'READY') {
      const result = await this.ready.mark(user.branchId, orderId, null, request.body, user);
      return { id: orderId, status: result.orderStatus };
    }
    if (user.role === 'WAITER' && ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(status)) {
      const result = await this.delivery.change(user.branchId, orderId, status === 'DELIVERED' ? 'deliver' : 'pickup', request.body, user);
      return { id: result.orderId, status: result.status };
    }
    throw new OrderError(403, 'FORBIDDEN', 'Transición no permitida');
  }
}
