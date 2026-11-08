import { Logger } from '@nestjs/common';
import { PrismaClient, NotificationSourceModule, OrderStatus } from '@prisma/client';

export type ReservationNotificationEvent = {
  reservationId: string;
  status: 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
};
export interface ReservationNotificationPort {
  findCommittedOwner(event: ReservationNotificationEvent): Promise<string | null>;
}
export type Notice = {
  recipientId: string; title: string; message: string; sourceModule: NotificationSourceModule;
  eventKey: string; relatedEntityId?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class NotificationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly field: string | null = null) { super(message); }
}

export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private readonly db: PrismaClient, private readonly reservations?: ReservationNotificationPort) {}

  // Servicio interno: no existe un endpoint para elegir destinatarios desde el navegador.
  async createNotification(notice: Notice) {
    for (const [field, limit] of [['title', 120], ['message', 500], ['eventKey', 150]] as const) {
      if (typeof notice[field] !== 'string' || !notice[field].trim() || notice[field].length > limit)
        throw new NotificationError(422, 'INVALID_FIELD', 'Notificación inválida', field);
    }
    if (!uuid.test(notice.recipientId) || !notice.relatedEntityId || !uuid.test(notice.relatedEntityId) || !['ORDERS', 'KITCHEN', 'RESERVATIONS'].includes(notice.sourceModule))
      throw new NotificationError(422, 'INVALID_FIELD', 'Evento o destinatario inválido');
    const recipient = await this.db.user.findUnique({ where: { id: notice.recipientId } });
    if (!recipient?.isActive) throw new NotificationError(404, 'NOT_FOUND', 'Destinatario no encontrado');
    if (notice.sourceModule === 'RESERVATIONS') {
      const status = notice.eventKey.startsWith('reservation.confirmed:') ? 'CONFIRMED' : notice.eventKey.startsWith('reservation.cancelled:') ? 'CANCELLED' : null;
      if (!status || !this.reservations || recipient.role !== 'CUSTOMER' ||
          await this.reservations.findCommittedOwner({ reservationId: notice.relatedEntityId, status }) !== recipient.id)
        throw new NotificationError(403, 'FORBIDDEN', 'Destinatario no autorizado');
    } else {
      const order = await this.db.order.findUnique({ where: { id: notice.relatedEntityId }, include: { kitchenTicket: true, createdBy: true } });
      const customer = recipient.role === 'CUSTOMER' && order?.clientId === recipient.id;
      const waiter = recipient.role === 'WAITER' && !!order && (order.createdById === recipient.id || order.createdBy.role === 'CUSTOMER') && recipient.branchId === order.branchId;
      const kitchen = recipient.role === 'KITCHEN' && recipient.branchId === order?.branchId && !!order?.kitchenTicket &&
        ['order.queued:', 'order.in_preparation:', 'order.ready:'].some(prefix => notice.eventKey === prefix + order.id);
      if (!order || (!customer && !waiter && !kitchen)) throw new NotificationError(403, 'FORBIDDEN', 'Destinatario no autorizado');
    }
    const { recipientId, ...data } = notice;
    await this.db.notification.createMany({ data: [{ ...data, userId: recipientId }], skipDuplicates: true });
    const saved = await this.db.notification.findUniqueOrThrow({ where: { eventKey_userId: { eventKey: notice.eventKey, userId: recipientId } }, select: { id: true, createdAt: true } });
    return { id: saved.id, createdAt: saved.createdAt.toISOString() };
  }

  private async deliver(notices: Notice[]) {
    for (const notice of notices) {
      try { await this.createNotification(notice); }
      catch { this.logger.error(`No se pudo registrar la notificación ${notice.eventKey}`); }
    }
  }

  async orderCreated(orderId: string) {
    const order = await this.db.order.findUnique({ where: { id: orderId } });
    if (!order?.clientId) return;
    await this.deliver([{ recipientId: order.clientId, title: 'Pedido registrado', message: `Tu pedido #${order.orderNumber} fue registrado`, sourceModule: 'ORDERS', eventKey: `order.created:${order.id}`, relatedEntityId: order.id }]);
  }

  async orderQueued(orderId: string) {
    const order = await this.db.order.findUnique({ where: { id: orderId }, include: { kitchenTicket: true, bill: true } });
    if (!order?.kitchenTicket || (order.type === 'TAKEAWAY' && order.bill?.status !== 'PAID')) return;
    const staff = await this.db.user.findMany({ where: { role: 'KITCHEN', branchId: order.branchId, isActive: true }, select: { id: true } });
    await this.deliver(staff.map(user => ({ recipientId: user.id, title: 'Nuevo pedido para cocina', message: `Pedido #${order.orderNumber} pendiente de preparación`, sourceModule: 'ORDERS', eventKey: `order.queued:${order.id}`, relatedEntityId: order.id })));
  }

  // Recibe estados ya confirmados; no implementa las transiciones de Cocina.
  async kitchenStatusCommitted(orderId: string, status: OrderStatus) {
    if (!['IN_PREPARATION', 'READY'].includes(status)) return;
    const order = await this.db.order.findUnique({ where: { id: orderId }, include: { kitchenTicket: true, createdBy: true, bill: true } });
    if (!order?.kitchenTicket || order.kitchenTicket.status !== status || order.status !== status || (order.type === 'TAKEAWAY' && order.bill?.status !== 'PAID')) return;
    const staff = await this.db.user.findMany({ where: { role: 'KITCHEN', branchId: order.branchId, isActive: true }, select: { id: true } });
    const recipients = new Set(staff.map(user => user.id));
    if (order.createdBy.role === 'WAITER' && order.createdBy.branchId === order.branchId) recipients.add(order.createdById);
    if (order.createdBy.role === 'CUSTOMER') {
      const waiters = await this.db.user.findMany({ where: { role: 'WAITER', branchId: order.branchId, isActive: true }, select: { id: true } });
      for (const waiter of waiters) recipients.add(waiter.id);
    }
    if (status === 'READY' && order.clientId) recipients.add(order.clientId);
    const label = status === 'IN_PREPARATION' ? 'en preparación' : 'listo';
    await this.deliver([...recipients].map(recipientId => ({ recipientId, title: 'Estado de pedido', message: `Pedido #${order.orderNumber}: ${label}`, sourceModule: 'KITCHEN', eventKey: `order.${status.toLowerCase()}:${order.id}`, relatedEntityId: order.id })));
  }

  async orderDeliveryCommitted(orderId: string, status: 'OUT_FOR_DELIVERY' | 'DELIVERED') {
    const order = await this.db.order.findUnique({ where: { id: orderId }, include: { createdBy: true } });
    if (!order || order.status !== status) return;
    const recipients = new Set<string>();
    if (order.clientId) recipients.add(order.clientId);
    if (order.createdBy.role === 'WAITER' && order.createdBy.branchId === order.branchId) recipients.add(order.createdById);
    if (order.createdBy.role === 'CUSTOMER') {
      const waiters = await this.db.user.findMany({ where: { role: 'WAITER', branchId: order.branchId, isActive: true }, select: { id: true } });
      for (const waiter of waiters) recipients.add(waiter.id);
    }
    await this.deliver([...recipients].map(recipientId => ({ recipientId, title: 'Estado de entrega',
      message: `Pedido #${order.orderNumber}: ${status === 'DELIVERED' ? 'entregado' : 'en camino'}`,
      sourceModule: 'ORDERS', eventKey: `order.${status.toLowerCase()}:${order.id}`, relatedEntityId: order.id })));
  }

  async reservationCommitted(event: ReservationNotificationEvent) {
    if (!this.reservations) throw new Error('Reservation notification port is not connected');
    if (!uuid.test(event.reservationId) || !['CONFIRMED', 'CANCELLED'].includes(event.status)) throw new Error('Invalid reservation event');
    const ownerId = await this.reservations.findCommittedOwner(event);
    if (!ownerId) return;
    await this.deliver([{ recipientId: ownerId, title: 'Actualización de reservación', message: `Tu reservación fue ${event.status === 'CONFIRMED' ? 'confirmada' : 'cancelada'}`, sourceModule: 'RESERVATIONS', eventKey: `reservation.${event.status.toLowerCase()}:${event.reservationId}`, relatedEntityId: event.reservationId }]);
  }

  async inbox(userId: string, query: Record<string, unknown>) {
    for (const key of Object.keys(query)) if (!['page', 'sourceModule'].includes(key)) throw new NotificationError(422, 'INVALID_FIELD', 'Filtro inválido', key);
    const pageValue = query.page;
    const page = pageValue === undefined ? 1 : Number(pageValue);
    if (pageValue !== undefined && (typeof pageValue !== 'string' || !/^[1-9]\d*$/.test(pageValue))) throw new NotificationError(422, 'INVALID_FIELD', 'Página inválida', 'page');
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new NotificationError(422, 'INVALID_FIELD', 'Página inválida', 'page');
    if (query.sourceModule !== undefined && !Object.values(NotificationSourceModule).includes(query.sourceModule as NotificationSourceModule)) throw new NotificationError(422, 'INVALID_FIELD', 'Módulo inválido', 'sourceModule');
    const where = { userId, ...(query.sourceModule ? { sourceModule: query.sourceModule as NotificationSourceModule } : {}) };
    const [data, total] = await this.db.$transaction([
      this.db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 10, take: 10, select: { id: true, title: true, message: true, sourceModule: true, eventKey: true, relatedEntityId: true, readAt: true, createdAt: true } }),
      this.db.notification.count({ where }),
    ]);
    return { data, total, page, pageSize: 10 };
  }
}
