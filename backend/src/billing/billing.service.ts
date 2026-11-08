import { Prisma, PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { calculateTotals } from './billing-math';
import type { NotificationsService } from '../notifications/notifications.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = (value: Prisma.Decimal) => value.toFixed(2);
const txOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 } as const;
export class BillingError extends Error {
  constructor(public status: number, public code: string, message: string, public field: string | null = null) { super(message); }
}
function fail(status: number, code: string, message: string, field: string | null = null): never {
  throw new BillingError(status, code, message, field);
}
const validId = (value: string, field: string) => { if (!uuid.test(value)) fail(400, 'INVALID_FIELD', 'Identificador inválido', field); };
const staffBranch = (session: Session, branchId: string) => {
  if (!['WAITER', 'MANAGER', 'GENERAL_MANAGER'].includes(session.role)) fail(403, 'FORBIDDEN', 'Sin permiso');
  if (session.role !== 'GENERAL_MANAGER' && session.branchId !== branchId) fail(404, 'NOT_FOUND', 'Recurso no encontrado');
};
const isConflict = (error: unknown) => error && typeof error === 'object' && 'code' in error && ['P2034', 'P2002'].includes(String(error.code));
const serializeBill = (bill: any) => ({ id: bill.id, branchId: bill.branchId, tableId: bill.tableId, type: bill.type, status: bill.status,
  subtotal: money(bill.subtotal), discount: money(bill.discount), tax: money(bill.tax), total: money(bill.total),
  orderIds: bill.orders?.map((o: { id: string }) => o.id) ?? [], createdAt: bill.createdAt.toISOString(), paidAt: bill.paidAt?.toISOString() ?? null });
const serializeReceipt = (receipt: any) => ({ id: receipt.id, billId: receipt.billId, branchId: receipt.branchId, number: receipt.number,
  cardLast4: receipt.cardLast4, snapshot: receipt.snapshot, createdAt: receipt.createdAt.toISOString() });

export class BillingService {
  constructor(private db: PrismaClient, private wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)), private notifications?: Pick<NotificationsService, 'orderQueued'>) {}

  private async branch(branchId: string) { if (!await this.db.branch.count({ where: { id: branchId } })) fail(404, 'NOT_FOUND', 'Sucursal no encontrada'); }
  private async billForSession(billId: string, session: Session) {
    validId(billId, 'billId');
    const bill = await this.db.bill.findUnique({ where: { id: billId }, include: { orders: true } });
    if (!bill) fail(404, 'NOT_FOUND', 'Cuenta no encontrada');
    if (session.role === 'CUSTOMER') {
      if (!bill.orders.length || bill.orders.some(order => order.clientId !== session.userId)) fail(404, 'NOT_FOUND', 'Cuenta no encontrada');
    } else staffBranch(session, bill.branchId);
    return bill;
  }
  async summary(branchId: string, tableId: string, session: Session) {
    validId(branchId, 'branchId'); validId(tableId, 'tableId'); staffBranch(session, branchId);
    const table = await this.db.table.findFirst({ where: { id: tableId, branchId } });
    if (!table) fail(404, 'NOT_FOUND', 'Mesa no encontrada');
    const orders = await this.db.order.findMany({ where: { branchId, tableId, billId: null, status: { not: 'CANCELLED' } },
      include: { items: { include: { dish: { select: { name: true } } } } }, orderBy: { createdAt: 'asc' } });
    const amounts = orders.length ? calculateTotals(orders.map(order => money(order.total))) : { subtotal: '0.00', discount: '0.00', tax: '0.00', total: '0.00' };
    return { tableId, canClose: orders.length > 0 && orders.every(order => order.status === 'DELIVERED'),
      blockingOrderIds: orders.filter(order => order.status !== 'DELIVERED').map(order => order.id),
      orders: orders.map(order => ({ id: order.id, orderNumber: order.orderNumber, status: order.status, items: order.items.map(item => ({
        name: item.dish.name, quantity: item.quantity, unitPrice: money(item.unitPrice), lineTotal: money(item.unitPrice.mul(item.quantity)) })) })),
      ...amounts };
  }
  async create(branchId: string, body: unknown, session: Session) {
    validId(branchId, 'branchId');
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(422, 'INVALID_FIELD', 'Solicitud inválida');
    const data = body as Record<string, unknown>;
    if (Object.keys(data).some(key => !['tableId', 'orderId'].includes(key))) fail(422, 'INVALID_FIELD', 'Campo no permitido');
    const hasTable = typeof data.tableId === 'string'; const hasOrder = typeof data.orderId === 'string';
    if (hasTable === hasOrder || Object.keys(data).length !== 1) fail(422, 'INVALID_FIELD', 'Indique tableId u orderId');
    const targetId = (hasTable ? data.tableId : data.orderId) as string; validId(targetId, hasTable ? 'tableId' : 'orderId');
    if (hasTable) { if (session.role !== 'WAITER' && session.role !== 'MANAGER' && session.role !== 'GENERAL_MANAGER') fail(403, 'FORBIDDEN', 'Sin permiso'); staffBranch(session, branchId); }
    else if (session.role !== 'CUSTOMER') staffBranch(session, branchId);
    await this.branch(branchId);
    try {
      const bill = await this.db.$transaction(async tx => {
        let orders: { id: string; total: Prisma.Decimal; status: string; type: string; clientId: string | null }[];
        if (hasTable) {
          const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Table" WHERE "id" = ${targetId}::uuid AND "branchId" = ${branchId}::uuid FOR UPDATE`;
          if (!rows.length) fail(404, 'NOT_FOUND', 'Mesa no encontrada');
          if (await tx.bill.count({ where: { tableId: targetId, status: 'OPEN' } })) fail(409, 'BILL_ALREADY_OPEN', 'La mesa ya tiene una cuenta abierta');
          orders = await tx.order.findMany({ where: { branchId, tableId: targetId, billId: null, status: { not: 'CANCELLED' } }, select: { id: true, total: true, status: true, type: true, clientId: true } });
          if (!orders.length) fail(409, 'NO_ELIGIBLE_ORDERS', 'No hay pedidos para cerrar');
          if (orders.some(order => order.status !== 'DELIVERED')) fail(409, 'ORDERS_NOT_DELIVERED', 'Hay pedidos pendientes de entrega');
        } else {
          const order = await tx.order.findFirst({ where: { id: targetId, branchId }, select: { id: true, total: true, status: true, type: true, clientId: true, billId: true } });
          if (!order) fail(404, 'NOT_FOUND', 'Pedido no encontrado');
          if (order.type !== 'TAKEAWAY' || order.status === 'CANCELLED' || order.billId) fail(409, 'ORDER_NOT_BILLABLE', 'El pedido no admite una nueva cuenta');
          if (session.role === 'CUSTOMER' && order.clientId !== session.userId) fail(404, 'NOT_FOUND', 'Pedido no encontrado');
          orders = [order];
        }
        const amounts = calculateTotals(orders.map(order => money(order.total))); // Loyalty integration has no contract in this repository.
        const bill = await tx.bill.create({ data: { branchId, tableId: hasTable ? targetId : null, type: hasTable ? 'DINE_IN' : 'TAKEAWAY', ...amounts } });
        const attached = await tx.order.updateMany({ where: { id: { in: orders.map(order => order.id) }, billId: null }, data: { billId: bill.id } });
        if (attached.count !== orders.length) fail(409, 'BILL_CONFLICT', 'Los pedidos cambiaron durante el cierre');
        return tx.bill.findUniqueOrThrow({ where: { id: bill.id }, include: { orders: { select: { id: true } } } });
      }, txOptions);
      return serializeBill(bill);
    } catch (error) { if (isConflict(error)) fail(409, 'BILL_CONFLICT', 'La cuenta cambió durante el cierre'); throw error; }
  }
  async getBill(billId: string, session: Session) { return serializeBill(await this.billForSession(billId, session)); }
  async pay(billId: string, key: unknown, body: unknown, session: Session) {
    if (typeof key !== 'string' || key.length < 8 || key.length > 64) fail(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key debe tener entre 8 y 64 caracteres');
    await this.billForSession(billId, session);
    const existing = await this.db.payment.findUnique({ where: { billId_idempotencyKey: { billId, idempotencyKey: key } } });
    if (existing && existing.status !== 'PENDING') return this.paymentResult(existing, billId);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof (body as any).cardNumber !== 'string') fail(422, 'INVALID_FIELD', 'Tarjeta inválida', 'cardNumber');
    const card = (body as { cardNumber: string }).cardNumber.replace(/\s/g, '');
    if (!/^\d{12,19}$/.test(card)) fail(422, 'INVALID_TEST_CARD', 'Tarjeta de prueba inválida', 'cardNumber');
    const last4 = card.slice(-4);
    if (last4 !== '4242' && last4 !== '0002') fail(422, 'INVALID_TEST_CARD', 'Tarjeta de prueba inválida', 'cardNumber');
    let payment;
    try {
      payment = await this.db.$transaction(async tx => {
        const locked = await tx.$queryRaw<{ id: string; status: string; total: Prisma.Decimal }[]>`SELECT "id", "status"::text, "total" FROM "Bill" WHERE "id" = ${billId}::uuid FOR UPDATE`;
        if (!locked.length) fail(404, 'NOT_FOUND', 'Cuenta no encontrada');
        const previous = await tx.payment.findUnique({ where: { billId_idempotencyKey: { billId, idempotencyKey: key } } });
        if (previous) {
          if (previous.status === 'PENDING' && Date.now() - previous.createdAt.getTime() <= 30_000)
            fail(409, 'PAYMENT_IN_PROGRESS', 'Hay un pago en proceso');
          if (previous.status === 'PENDING') {
            const timedOut = await tx.payment.update({ where: { id: previous.id }, data: { status: 'FAILED', failureCode: 'GATEWAY_TIMEOUT', completedAt: new Date() } });
            return { payment: timedOut, retry: true };
          }
          return { payment: previous, retry: true };
        }
        if (locked[0].status === 'PAID') fail(409, 'BILL_ALREADY_PAID', 'La cuenta ya está pagada');
        const pending = await tx.payment.findFirst({ where: { billId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
        if (pending) {
          if (Date.now() - pending.createdAt.getTime() <= 30_000) fail(409, 'PAYMENT_IN_PROGRESS', 'Hay un pago en proceso');
          await tx.payment.update({ where: { id: pending.id }, data: { status: 'FAILED', failureCode: 'GATEWAY_TIMEOUT', completedAt: new Date() } });
        }
        return { payment: await tx.payment.create({ data: { billId, userId: session.userId, idempotencyKey: key, amount: locked[0].total, cardLast4: last4 } }), retry: false };
      }, txOptions);
    } catch (error) { if (isConflict(error)) fail(409, 'PAYMENT_IN_PROGRESS', 'Hay un pago en proceso'); throw error; }
    if (payment.retry) return this.paymentResult(payment.payment, billId);
    await this.wait(2000);
    try {
      const completed = await this.db.$transaction(async tx => {
        const locked = await tx.$queryRaw<{ id: string; status: string; branchId: string; tableId: string | null }[]>`SELECT "id", "status"::text, "branchId", "tableId" FROM "Bill" WHERE "id" = ${billId}::uuid FOR UPDATE`;
        const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.payment.id } });
        if (current.status !== 'PENDING') return current;
        if (last4 === '0002') return tx.payment.update({ where: { id: current.id }, data: { status: 'FAILED', failureCode: 'CARD_DECLINED', completedAt: new Date() } });
        if (locked[0].status !== 'OPEN') fail(409, 'BILL_ALREADY_PAID', 'La cuenta ya está pagada');
        const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { branch: true, orders: { include: { items: { include: { dish: { select: { name: true } } } } } } } });
        const items = bill.orders.flatMap(order => order.items.map(item => ({ orderNumber: order.orderNumber, name: item.dish.name,
          quantity: item.quantity, unitPrice: money(item.unitPrice), lineTotal: money(item.unitPrice.mul(item.quantity)) })));
        await tx.bill.update({ where: { id: billId }, data: { status: 'PAID', paidAt: new Date() } });
        const result = await tx.payment.update({ where: { id: current.id }, data: { status: 'APPROVED', completedAt: new Date() } });
        await tx.$executeRaw`INSERT INTO "ReceiptCounter" ("branchId", "nextNumber") VALUES (${bill.branchId}::uuid, 1) ON CONFLICT ("branchId") DO NOTHING`;
        const counter = await tx.$queryRaw<{ nextNumber: number }[]>`UPDATE "ReceiptCounter" SET "nextNumber" = "nextNumber" + 1 WHERE "branchId" = ${bill.branchId}::uuid RETURNING "nextNumber" - 1 AS "nextNumber"`;
        const sequence = counter[0].nextNumber;
        if (sequence > 999999) fail(409, 'RECEIPT_SEQUENCE_EXHAUSTED', 'Correlativo agotado');
        await tx.receipt.create({ data: { billId, branchId: bill.branchId, sequence, number: `${bill.branch.code}-${String(sequence).padStart(6, '0')}`,
          cardLast4: last4, snapshot: { items, subtotal: money(bill.subtotal), discount: money(bill.discount), tax: money(bill.tax), total: money(bill.total) } } });
        if (bill.tableId) {
          await tx.table.update({ where: { id: bill.tableId }, data: { status: 'NEEDS_CLEANING' } });
          await tx.tableAssignment.updateMany({ where: { tableId: bill.tableId, validTo: null }, data: { validTo: new Date() } });
        }
        if (bill.type === 'TAKEAWAY') await tx.kitchenTicket.createMany({ data: bill.orders.map(order => ({ orderId: order.id })), skipDuplicates: true });
        return result;
      }, txOptions);
      if (completed.status === 'APPROVED' && this.notifications) {
        try {
          const queued = await this.db.bill.findUnique({ where: { id: billId }, select: { type: true, orders: { select: { id: true } } } });
          if (queued?.type === 'TAKEAWAY') for (const order of queued.orders) await this.notifications.orderQueued(order.id);
        } catch (error) { console.error('Notification delivery failed after payment commit', error); }
      }
      return this.paymentResult(completed, billId);
    } catch (error) { if (isConflict(error)) fail(409, 'PAYMENT_CONFLICT', 'El pago cambió durante la confirmación'); throw error; }
  }
  private async paymentResult(payment: { id: string; status: string; failureCode: string | null; cardLast4: string }, billId: string) {
    const receipt = payment.status === 'APPROVED' ? await this.db.receipt.findUnique({ where: { billId } }) : null;
    return { id: payment.id, status: payment.status, failureCode: payment.failureCode, cardLast4: payment.cardLast4, receiptId: receipt?.id ?? null };
  }
  async receipt(branchId: string, receiptId: string, session: Session, mine = false) {
    validId(receiptId, 'receiptId'); if (!mine) { validId(branchId, 'branchId'); staffBranch(session, branchId); }
    else if (session.role !== 'CUSTOMER') fail(403, 'FORBIDDEN', 'Sin permiso');
    const receipt = await this.db.receipt.findUnique({ where: { id: receiptId }, include: { bill: { include: { orders: { select: { clientId: true } } } } } });
    if (!receipt || (!mine && receipt.branchId !== branchId) || (mine && (!receipt.bill.orders.length || receipt.bill.orders.some(order => order.clientId !== session.userId)))) fail(404, 'NOT_FOUND', 'Comprobante no encontrado');
    return serializeReceipt(receipt);
  }
  async myReceipts(session: Session) {
    if (session.role !== 'CUSTOMER') fail(403, 'FORBIDDEN', 'Sin permiso');
    const receipts = await this.db.receipt.findMany({ where: { bill: { orders: { every: { clientId: session.userId }, some: { clientId: session.userId } } } }, orderBy: { createdAt: 'desc' } });
    return receipts.map(serializeReceipt);
  }
}
