import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaClient, OrderStatus } from '@prisma/client';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { NotificationError } from './notifications.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// H29 conserva su contrato; la ruta compartida H6/H30 pertenece ahora a KitchenController.
@ApiTags('Notificaciones')
@Controller('branches/:branchId')
@UseGuards(VerifiedSessionGuard)
export class OrderNotificationsController {
  constructor(private readonly db: PrismaClient) {}

  @ApiQuery({"name": "status", "required": false, "schema": {"type": "string"}})
  @Get('orders')
  async waiter(@Param('branchId') branchId: string, @Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const user = request.user!;
    if (user.role !== 'WAITER' || user.branchId !== branchId)
      throw new NotificationError(403, 'FORBIDDEN', 'Sucursal o rol no autorizado');
    if (!uuid.test(branchId)) throw new NotificationError(422, 'INVALID_FIELD', 'Sucursal inválida', 'branchId');
    if (!await this.db.branch.count({ where: { id: branchId } })) throw new NotificationError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    if (Object.keys(query).some(key => key !== 'status')) throw new NotificationError(422, 'INVALID_FIELD', 'Filtro inválido');
    if (query.status !== undefined && typeof query.status !== 'string') throw new NotificationError(422, 'INVALID_FIELD', 'Estado inválido', 'status');
    const statuses = ((query.status as string | undefined) ?? 'IN_PREPARATION,READY,OUT_FOR_DELIVERY').split(',');
    if (statuses.some(status => !Object.values(OrderStatus).includes(status as OrderStatus)))
      throw new NotificationError(422, 'INVALID_FIELD', 'Estado inválido', 'status');
    const orders = await this.db.order.findMany({
      where: { branchId, status: { in: statuses as OrderStatus[] } },
      select: { id: true, orderNumber: true, type: true, status: true, updatedAt: true, table: { select: { number: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    return { items: orders.map(order => ({
      id: order.id, orderNumber: order.orderNumber, tableLabel: order.table ? `Mesa ${order.table.number}` : 'Para llevar',
      type: order.type, status: order.status, updatedAt: order.updatedAt,
    })) };
  }
}
