import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaClient, OrderStatus } from '@prisma/client';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { NotificationError } from './notifications.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Vistas de seguimiento H29/H30. No ejecutan transiciones de Cocina.
@Controller('branches/:branchId')
@UseGuards(VerifiedSessionGuard)
export class OrderNotificationsController {
  constructor(private readonly db: PrismaClient) {}

  private async list(branchId: string, request: AuthenticatedRequest, query: Record<string, unknown>, kitchen: boolean) {
    const user = request.user!;
    if (user.role !== (kitchen ? 'KITCHEN' : 'WAITER') || user.branchId !== branchId)
      throw new NotificationError(403, 'FORBIDDEN', 'Sucursal o rol no autorizado');
    if (!uuid.test(branchId)) throw new NotificationError(422, 'INVALID_FIELD', 'Sucursal inválida', 'branchId');
    if (!await this.db.branch.count({ where: { id: branchId } })) throw new NotificationError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    if (Object.keys(query).some(key => key !== 'status')) throw new NotificationError(422, 'INVALID_FIELD', 'Filtro inválido');
    const allowed = kitchen ? ['PENDING', 'IN_PREPARATION', 'READY', 'CANCELLED'] : Object.values(OrderStatus);
    const defaults = kitchen ? 'PENDING,IN_PREPARATION' : 'IN_PREPARATION,READY,OUT_FOR_DELIVERY';
    if (query.status !== undefined && typeof query.status !== 'string') throw new NotificationError(422, 'INVALID_FIELD', 'Estado inválido', 'status');
    const statuses = ((query.status as string | undefined) ?? defaults).split(',');
    if (statuses.some(status => !allowed.includes(status as OrderStatus))) throw new NotificationError(422, 'INVALID_FIELD', 'Estado inválido', 'status');
    const orders = await this.db.order.findMany({
      where: { branchId, ...(kitchen ? {
        kitchenTicket: { is: { status: { in: statuses as OrderStatus[] } } },
        OR: [{ type: 'DINE_IN' }, { type: 'TAKEAWAY', bill: { status: 'PAID' } }],
      } : { status: { in: statuses as OrderStatus[] } }) },
      include: { table: { select: { number: true } }, kitchenTicket: true, items: { include: { dish: { select: { name: true } } } } },
      orderBy: kitchen ? [{ kitchenTicket: { createdAt: 'asc' } }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    return { items: orders.map(order => ({
      ...(kitchen ? { orderId: order.id } : { id: order.id }), orderNumber: order.orderNumber,
      tableLabel: order.table ? `Mesa ${order.table.number}` : 'Para llevar', type: order.type,
      status: kitchen ? order.kitchenTicket!.status : order.status, updatedAt: order.updatedAt,
      ...(kitchen ? { enteredAt: order.kitchenTicket!.createdAt, items: order.items.map(item => ({ id: item.id, dishName: item.dish.name, quantity: item.quantity, note: item.note, isReady: item.status === 'READY' })) } : {}),
    })) };
  }

  @Get('orders')
  waiter(@Param('branchId') branchId: string, @Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.list(branchId, request, query, false);
  }

  @Get('kitchen/orders')
  kitchen(@Param('branchId') branchId: string, @Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.list(branchId, request, query, true);
  }
}
