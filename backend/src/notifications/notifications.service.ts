import { Logger } from '@nestjs/common';
import { PrismaClient, NotificationSourceModule, OrderStatus } from '@prisma/client';

export type ReservationNotificationEvent = {
  reservationId: string;
  status: 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
};

// The reservations module must resolve ownership from its committed record.
export interface ReservationNotificationPort {
  findCommittedOwner(event: ReservationNotificationEvent): Promise<string | null>;
}

type Notice = { userId: string; title: string; message: string; sourceModule: NotificationSourceModule; eventKey: string; relatedEntityId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class NotificationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly field: string | null = null) { super(message); }
}

export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private readonly db: PrismaClient, private readonly reservations?: ReservationNotificationPort) {}

  // Only this method writes notifications. The unique constraint makes delivery idempotent.
  private async createNotification(notice: Notice) {
    await this.db.notification.createMany({ data: [notice], skipDuplicates: true });
  }

  private async deliver(notices: Notice[]) {
    for (const notice of notices) {
      try { await this.createNotification(notice); }
      catch (error) { this.logger.error(`Notification delivery failed for ${notice.eventKey}, user ${notice.userId}`, error instanceof Error ? error.stack : String(error)); }
    }
  }

  async orderQueued(orderId: string) {
    const order = await this.db.order.findUnique({ where: { id: orderId }, include: { kitchenTicket: true } });
    if (!order?.kitchenTicket) return;
    const staff = await this.db.user.findMany({ where: { role: 'KITCHEN', branchId: order.branchId }, select: { id: true } });
    const notices: Notice[] = staff.map(user => ({ userId: user.id, title: 'Nuevo pedido para cocina', message: `Pedido #${order.orderNumber} pendiente de preparación`, sourceModule: 'ORDERS', eventKey: `ORDER_QUEUED:${order.id}`, relatedEntityId: order.id }));
    if (order.clientId) notices.push({ userId: order.clientId, title: 'Pedido registrado', message: `Tu pedido #${order.orderNumber} fue registrado`, sourceModule: 'ORDERS', eventKey: `ORDER_CREATED:${order.id}`, relatedEntityId: order.id });
    await this.deliver(notices);
  }

  // Called by the kitchen owner after its status transaction commits.
  async kitchenStatusCommitted(orderId: string, status: OrderStatus) {
    if (!['PENDING', 'IN_PREPARATION', 'READY'].includes(status)) return;
    const order = await this.db.order.findUnique({ where: { id: orderId }, include: { kitchenTicket: true, createdBy: { select: { role: true, branchId: true } } } });
    if (!order?.kitchenTicket || order.kitchenTicket.status !== status) return;
    const label = status === 'PENDING' ? 'pendiente' : status === 'IN_PREPARATION' ? 'en preparación' : 'listo';
    const notices: Notice[] = [];
    const staff = await this.db.user.findMany({ where: { role: 'KITCHEN', branchId: order.branchId }, select: { id: true } });
    for (const user of staff) notices.push({ userId: user.id, title: 'Estado de comanda', message: `Pedido #${order.orderNumber}: ${label}`, sourceModule: 'KITCHEN', eventKey: `KITCHEN_${status}:${order.id}`, relatedEntityId: order.id });
    if (['IN_PREPARATION', 'READY'].includes(status) && order.createdBy.role === 'WAITER' && order.createdBy.branchId === order.branchId)
      notices.push({ userId: order.createdById, title: 'Estado de tu pedido', message: `Pedido #${order.orderNumber}: ${label}`, sourceModule: 'KITCHEN', eventKey: `WAITER_${status}:${order.id}`, relatedEntityId: order.id });
    await this.deliver(notices);
  }

  // The external reservations module supplies a resolver backed by its committed state.
  async reservationCommitted(event: ReservationNotificationEvent) {
    if (!this.reservations) throw new Error('Reservation notification port is not connected');
    if (!uuid.test(event.reservationId) || !['CONFIRMED', 'REJECTED', 'CANCELLED'].includes(event.status)) throw new Error('Invalid reservation event');
    const ownerId = await this.reservations.findCommittedOwner(event);
    if (!ownerId) return;
    const owner = await this.db.user.findUnique({ where: { id: ownerId }, select: { role: true } });
    if (owner?.role !== 'CUSTOMER') return;
    const labels = { CONFIRMED: 'confirmada', REJECTED: 'rechazada', CANCELLED: 'cancelada' };
    await this.deliver([{ userId: ownerId, title: 'Actualización de reservación', message: `Tu reservación fue ${labels[event.status]}`, sourceModule: 'RESERVATIONS', eventKey: `RESERVATION_${event.status}:${event.reservationId}`, relatedEntityId: event.reservationId }]);
  }

  async inbox(userId: string, pageValue: unknown) {
    const page = pageValue === undefined ? 1 : Number(pageValue);
    if (typeof pageValue !== 'undefined' && (typeof pageValue !== 'string' || !/^[1-9]\d*$/.test(pageValue))) throw new NotificationError(400, 'INVALID_FIELD', 'Página inválida', 'page');
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new NotificationError(400, 'INVALID_FIELD', 'Página inválida', 'page');
    const pageSize = 10;
    const where = { userId };
    const [data, total] = await this.db.$transaction([
      this.db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, title: true, message: true, sourceModule: true, eventKey: true, relatedEntityId: true, readAt: true, createdAt: true } }),
      this.db.notification.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }
}
