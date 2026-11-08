import { Prisma, PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { validatePayment } from './dto/payment.dto';
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
  if (session.role !== 'WAITER') fail(403, 'FORBIDDEN', 'Sin permiso');
  if (session.branchId !== branchId) fail(403, 'FORBIDDEN', 'Sucursal no autorizada');
};
const isConflict = (error: unknown) => error && typeof error === 'object' && 'code' in error && ['P2034', 'P2002'].includes(String(error.code));
const serializeBill = (bill: Prisma.BillGetPayload<{ include: { orders: { select: { id: true } } } }>) => ({ id: bill.id, branchId: bill.branchId, tableId: bill.tableId, type: bill.type, status: bill.status,
  clientId: bill.clientId, discountAmount: money(bill.discount), taxAmount: money(bill.tax), subtotal: money(bill.subtotal), discount: money(bill.discount), tax: money(bill.tax), total: money(bill.total),
  orderIds: bill.orders?.map((o: { id: string }) => o.id) ?? [], createdAt: bill.createdAt.toISOString(), paidAt: bill.paidAt?.toISOString() ?? null });
const serializeReceipt = (receipt: Prisma.ReceiptGetPayload<Record<string, never>>) => ({ id: receipt.id, billId: receipt.billId, branchId: receipt.branchId, number: receipt.number,
  cardLast4: receipt.cardLast4, snapshot: receipt.snapshot, createdAt: receipt.createdAt.toISOString() });

export class BillingService {
  constructor(private db: PrismaClient, private wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)), private notifications?: Pick<NotificationsService, 'orderQueued'>) {}

  private async branch(branchId: string) { if (!await this.db.branch.count({ where: { id: branchId } })) fail(404, 'NOT_FOUND', 'Sucursal no encontrada'); }
  private async billForSession(billId: string, session: Session) {
    validId(billId, 'billId');
    const bill = await this.db.bill.findUnique({ where: { id: billId }, include: { orders: true } });
    if (!bill) fail(404, 'NOT_FOUND', 'Cuenta no encontrada');
    if (session.role === 'CUSTOMER') {
      if (bill.clientId !== session.userId) fail(404, 'NOT_FOUND', 'Cuenta no encontrada');
    } else staffBranch(session, bill.branchId);
    return bill;
  }
  async summary(branchId: string, tableId: string, session: Session) {
    validId(branchId, 'branchId'); validId(tableId, 'tableId'); staffBranch(session, branchId);
    const table = await this.db.table.findFirst({ where: { id: tableId, branchId } });
    if (!table) fail(404, 'NOT_FOUND', 'Mesa no encontrada');
    const orders = await this.db.order.findMany({ where: { branchId, tableId, billId: null, status: { not: 'CANCELLED' } },
      include: { items: { include: { dish: { select: { name: true } } } } }, orderBy: { createdAt: 'asc' } });
    const amounts = orders.length ? calculateTotals(orders.flatMap(order => order.items.map(item => money(item.unitPrice.mul(item.quantity))))) : { subtotal: '0.00', discount: '0.00', tax: '0.00', total: '0.00' };
    return { tableId, canClose: orders.length > 0 && orders.every(order => order.status === 'DELIVERED'),
      pendingOrderIds: orders.filter(order => order.status !== 'DELIVERED').map(order => order.id),
      taxAmount: amounts.tax, discountAmount: amounts.discount, blockingOrderIds: orders.filter(order => order.status !== 'DELIVERED').map(order => order.id),
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
    if (hasTable) { if (session.role !== 'WAITER') fail(403, 'FORBIDDEN', 'Sin permiso'); staffBranch(session, branchId); }
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
          if (!orders.length) fail(409, 'NO_BILLABLE_ORDERS', 'No hay pedidos para cerrar');
          if (orders.some(order => order.status !== 'DELIVERED')) fail(409, 'BILL_HAS_UNDELIVERED_ITEMS', 'Hay pedidos pendientes de entrega');
        } else {
          const order = await tx.order.findFirst({ where: { id: targetId, branchId }, select: { id: true, total: true, status: true, type: true, clientId: true, billId: true } });
          if (!order) fail(404, 'NOT_FOUND', 'Pedido no encontrado');
          if (order.type !== 'TAKEAWAY' || order.status === 'CANCELLED' || order.billId) fail(409, 'ORDER_NOT_BILLABLE', 'El pedido no admite una nueva cuenta');
          if (session.role === 'CUSTOMER' && order.clientId !== session.userId) fail(404, 'NOT_FOUND', 'Pedido no encontrado');
          orders = [order];
        }
        const items = await tx.orderItem.findMany({ where: { orderId: { in: orders.map(order => order.id) } } });
        const amounts = calculateTotals(items.map(item => money(item.unitPrice.mul(item.quantity))));
        const clientId = orders.every(order => order.clientId === orders[0].clientId) ? orders[0].clientId : null;
        const bill = await tx.bill.create({ data: { branchId, clientId, tableId: hasTable ? targetId : null, type: hasTable ? 'DINE_IN' : 'TAKEAWAY', ...amounts } });
        const attached = await tx.order.updateMany({ where: { id: { in: orders.map(order => order.id) }, billId: null }, data: { billId: bill.id } });
        if (attached.count !== orders.length) fail(409, 'BILL_CONFLICT', 'Los pedidos cambiaron durante el cierre');
        return tx.bill.findUniqueOrThrow({ where: { id: bill.id }, include: { orders: { select: { id: true } } } });
      }, txOptions);
      return serializeBill(bill);
    } catch (error) { if (isConflict(error)) fail(409, 'BILL_CONFLICT', 'La cuenta cambió durante el cierre'); throw error; }
  }
  async getBill(billId: string, session: Session) {
    const bill = await this.billForSession(billId, session);
    const payments = await this.db.payment.findMany({ where: { billId }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, amount: true, cardLast4: true, failureCode: true, createdAt: true } });
    return { ...serializeBill(bill), payments };
  }
  async pay(billId: string, key: unknown, body: unknown, session: Session) {
    if (typeof key !== 'string' || key.length < 8 || key.length > 64) fail(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key debe tener entre 8 y 64 caracteres');
    await this.billForSession(billId, session);
    const existing = await this.db.payment.findUnique({ where: { billId_idempotencyKey: { billId, idempotencyKey: key } } });
    if (existing && existing.status !== 'PENDING') return this.paymentResult(existing, billId);
    const last4 = validatePayment(body, field => fail(422, 'INVALID_FIELD', 'Datos de tarjeta inválidos', field));
    if (last4 !== '4242' && last4 !== '0002') fail(422, 'INVALID_TEST_CARD', 'Tarjeta de prueba inválida', 'cardNumber');
    let payment;
    try {
      payment = await this.paymentTransaction(async tx => {
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
        if (locked[0].status !== 'OPEN') fail(409, 'BILL_ALREADY_PAID', 'La cuenta no admite pagos');
        const pending = await tx.payment.findFirst({ where: { billId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
        if (pending) {
          if (Date.now() - pending.createdAt.getTime() <= 30_000) fail(409, 'PAYMENT_IN_PROGRESS', 'Hay un pago en proceso');
          await tx.payment.update({ where: { id: pending.id }, data: { status: 'FAILED', failureCode: 'GATEWAY_TIMEOUT', completedAt: new Date() } });
        }
        return { payment: await tx.payment.create({ data: { billId, userId: session.userId, idempotencyKey: key, amount: locked[0].total, cardLast4: last4 } }), retry: false };
      });
    } catch (error) { if (isConflict(error)) fail(409, 'PAYMENT_IN_PROGRESS', 'Hay un pago en proceso'); throw error; }
    if (payment.retry) return this.paymentResult(payment.payment, billId);
    await this.wait(2000);
    try {
      const completed = await this.paymentTransaction(async tx => {
        const locked = await tx.$queryRaw<{ id: string; status: string; branchId: string; tableId: string | null }[]>`SELECT "id", "status"::text, "branchId", "tableId" FROM "Bill" WHERE "id" = ${billId}::uuid FOR UPDATE`;
        const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.payment.id } });
        if (current.status !== 'PENDING') return current;
        if (last4 === '0002') return tx.payment.update({ where: { id: current.id }, data: { status: 'FAILED', failureCode: 'CARD_DECLINED', completedAt: new Date() } });
        if (locked[0].status !== 'OPEN') fail(409, 'BILL_ALREADY_PAID', 'La cuenta ya está pagada');
        const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { branch: true, table: true, orders: { include: { items: { include: { dish: { select: { name: true } } } } } } } });
        const items = bill.orders.flatMap(order => order.items.map(item => ({ orderNumber: order.orderNumber, name: item.dish.name,
          quantity: item.quantity, unitPrice: money(item.unitPrice), lineTotal: money(item.unitPrice.mul(item.quantity)) })));
        await tx.bill.update({ where: { id: billId }, data: { status: 'PAID', paidAt: new Date() } });
        const result = await tx.payment.update({ where: { id: current.id }, data: { status: 'PAID', completedAt: new Date() } });
        await tx.$executeRaw`INSERT INTO "ReceiptCounter" ("branchId", "nextNumber") VALUES (${bill.branchId}::uuid, 1) ON CONFLICT ("branchId") DO NOTHING`;
        const counter = await tx.$queryRaw<{ nextNumber: number }[]>`UPDATE "ReceiptCounter" SET "nextNumber" = "nextNumber" + 1 WHERE "branchId" = ${bill.branchId}::uuid RETURNING "nextNumber" - 1 AS "nextNumber"`;
        const sequence = counter[0].nextNumber;
        if (sequence > 999999) fail(409, 'RECEIPT_SEQUENCE_EXHAUSTED', 'Correlativo agotado');
        await tx.receipt.create({ data: { billId, branchId: bill.branchId, sequence, number: `${bill.branch.code}-${String(sequence).padStart(6, '0')}`,
          cardLast4: last4, snapshot: { branchName: bill.branch.name, tableNumber: bill.table?.number ?? null, type: bill.type, items, subtotal: money(bill.subtotal), discount: money(bill.discount), tax: money(bill.tax), total: money(bill.total) } } });
        if (bill.tableId) {
          await tx.table.update({ where: { id: bill.tableId }, data: { status: 'NEEDS_CLEANING' } });
          await tx.tableAssignment.updateMany({ where: { tableId: bill.tableId, validFrom: { lt: new Date() }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }] }, data: { validTo: new Date() } });
        }
        if (bill.type === 'TAKEAWAY') await tx.kitchenTicket.createMany({ data: bill.orders.map(order => ({ orderId: order.id })), skipDuplicates: true });
        return result;
      });
      if (completed.status === 'PAID' && this.notifications) {
        try {
          const queued = await this.db.bill.findUnique({ where: { id: billId }, select: { type: true, orders: { select: { id: true } } } });
          if (queued?.type === 'TAKEAWAY') for (const order of queued.orders) await this.notifications.orderQueued(order.id);
        } catch (error) { console.error('Notification delivery failed after payment commit', error); }
      }
      return this.paymentResult(completed, billId);
    } catch (error) { if (isConflict(error)) fail(409, 'PAYMENT_CONFLICT', 'El pago cambió durante la confirmación'); throw error; }
  }
  // Dos cuentas de una sucursal comparten el contador de comprobantes.
  // Reintenta únicamente transacciones abortadas, nunca la pasarela ni un commit confirmado.
  private async paymentTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.db.$transaction(operation, txOptions); }
      catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' ||
          (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code))));
        if (attempt >= 2 || !retryable) throw error;
      }
    }
  }

  private async paymentResult(payment: { id: string; status: string; failureCode: string | null; cardLast4: string }, billId: string) {
    const receipt = payment.status === 'PAID' ? await this.db.receipt.findUnique({ where: { billId } }) : null;
    const bill = await this.db.bill.findUniqueOrThrow({ where: { id: billId }, select: { status: true } });
    return { id: payment.id, paymentId: payment.id, billStatus: bill.status, status: payment.status, failureCode: payment.failureCode, cardLast4: payment.cardLast4, receiptId: receipt?.id ?? null };
  }
  async receipt(branchId: string, receiptId: string, session: Session, mine = false) {
    validId(receiptId, 'receiptId'); if (!mine) { validId(branchId, 'branchId'); staffBranch(session, branchId); }
    else if (session.role !== 'CUSTOMER') fail(403, 'FORBIDDEN', 'Sin permiso');
    const receipt = await this.db.receipt.findUnique({ where: { id: receiptId }, include: { bill: { include: { orders: { select: { clientId: true } } } } } });
    if (!receipt || (!mine && receipt.branchId !== branchId) || (mine && receipt.bill.clientId !== session.userId)) fail(404, 'NOT_FOUND', 'Comprobante no encontrado');
    return serializeReceipt(receipt);
  }
  async myReceipts(session: Session, pageValue: unknown) {
    if (session.role !== 'CUSTOMER') fail(403, 'FORBIDDEN', 'Sin permiso');
    const page = pageValue === undefined ? 1 : Number(pageValue);
    if (pageValue !== undefined && (typeof pageValue !== 'string' || !/^[1-9]\d*$/.test(pageValue))) fail(422, 'INVALID_FIELD', 'Página inválida', 'page');
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail(422, 'INVALID_FIELD', 'Página inválida', 'page');
    const where = { bill: { clientId: session.userId } };
    const [receipts, total] = await this.db.$transaction([
      this.db.receipt.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 10, skip: (page - 1) * 10 }),
      this.db.receipt.count({ where }),
    ]);
    return { data: receipts.map(receipt => {
      const snapshot = receipt.snapshot as { branchName?: string; total: string };
      return { ...serializeReceipt(receipt), issuedAt: receipt.createdAt.toISOString(), branchName: snapshot.branchName ?? null, total: snapshot.total };
    }), total, page, pageSize: 10 };
  }
}
