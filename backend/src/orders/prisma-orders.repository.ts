import { Prisma, PrismaClient } from '@prisma/client';
import { OrderError } from './orders.service';
import type { CreatedOrder, LinkPreview, OrderInput, OrdersRepository } from './orders.service';

const error = (status: number, code: string, message: string) => new OrderError(status, code, message);

export class PrismaOrdersRepository implements OrdersRepository {
  constructor(private db: PrismaClient) {}
  async branchExists(id: string) { return (await this.db.branch.count({ where: { id } })) > 0; }

  async create(input: OrderInput, userId: string, customer: boolean): Promise<CreatedOrder> {
    return this.db.$transaction(async tx => {
      if (input.tableId) {
        const tables = await tx.$queryRaw<{ id: string; branchId: string; status: string }[]>`
          SELECT "id", "branchId", "status"::text FROM "Table" WHERE "id" = ${input.tableId}::uuid FOR SHARE`;
        const table = tables[0];
        if (!table) throw error(404, 'NOT_FOUND', 'Mesa no encontrada');
        if (table.branchId !== input.branchId) throw error(409, 'TABLE_BRANCH_CONFLICT', 'La mesa pertenece a otra sucursal');
        if (table.status !== 'OCCUPIED') throw error(409, 'TABLE_NOT_ACTIVE', 'La mesa no está activa');
        if (await tx.bill.count({ where: { tableId: input.tableId, status: 'OPEN' } })) throw error(409, 'BILL_ALREADY_OPEN', 'La cuenta de la mesa está en proceso de cobro');
        if (customer) {
          const assignments = await tx.$queryRaw<{ id: string }[]>`
            SELECT "a"."id" FROM "TableAssignment" "a"
            WHERE "a"."tableId" = ${input.tableId}::uuid AND "a"."customerId" = ${userId}::uuid
              AND "a"."validFrom" <= CURRENT_TIMESTAMP
              AND ("a"."validTo" IS NULL OR "a"."validTo" > CURRENT_TIMESTAMP)
            LIMIT 1 FOR SHARE`;
          if (!assignments.length) throw error(409, 'CUSTOMER_TABLE_NOT_ASSIGNED', 'No tiene una asignación vigente a esta mesa');
        }
      }
      const ids = [...new Set(input.items.map(item => item.dishId))];
      const dishes = await tx.$queryRaw<{ id: string; branchId: string; isAvailable: boolean; price: Prisma.Decimal }[]>`
        SELECT "id", "branchId", "isAvailable", "price" FROM "MenuItem"
        WHERE "id" IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR SHARE`;
      const byId = new Map(dishes.map(dish => [dish.id, dish]));
      for (const item of input.items) {
        const dish = byId.get(item.dishId);
        if (!dish) throw error(404, 'NOT_FOUND', 'Platillo no encontrado');
        if (dish.branchId !== input.branchId) throw error(409, 'DISH_BRANCH_CONFLICT', 'El platillo pertenece a otra sucursal');
        if (!dish.isAvailable) throw error(409, 'DISH_UNAVAILABLE', 'El platillo ya no está disponible');
      }
      const total = input.items.reduce((sum, item) => sum.plus(byId.get(item.dishId)!.price.mul(item.quantity)), new Prisma.Decimal(0));
      if (total.gt('9999999999.99')) throw error(422, 'INVALID_TOTAL', 'El importe excede el límite permitido');
      const sequence = await tx.$queryRaw<{ number: number }[]>`SELECT nextval('"OrderNumberSeq"')::integer AS "number"`;
      const order = await tx.order.create({
        data: { orderNumber: sequence[0].number, branchId: input.branchId, tableId: input.tableId,
          createdById: userId, clientId: customer ? userId : null, clientLinkedAt: customer ? new Date() : null, type: input.type, total,
          items: { create: input.items.map(item => ({ dishId: item.dishId, quantity: item.quantity,
            unitPrice: byId.get(item.dishId)!.price, note: item.note })) } },
      });
      // This is the minimal contract consumed by the kitchen module. Kitchen owns subsequent transitions.
      if (input.type === 'DINE_IN') await tx.kitchenTicket.create({ data: { orderId: order.id } });
      return { id: order.id, orderNumber: order.orderNumber, status: 'PENDING', createdAt: order.createdAt,
        total: order.total.toFixed(2), type: order.type, branchId: order.branchId, tableId: order.tableId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
  }

  async findLinkableOrder(id: string, branchId: string) {
    return this.db.order.findFirst({ where: { id, branchId }, select: { id: true, clientId: true, type: true } });
  }
  async saveLinkCode(orderId: string, hash: string, expiresAt: Date, createdById: string) {
    await this.db.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ type: string; clientId: string | null }[]>`SELECT "type"::text, "clientId" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const order = rows[0];
      if (!order || order.type !== 'DINE_IN' || order.clientId) throw error(409, 'ORDER_NOT_LINKABLE', 'El pedido no admite vinculación');
      await tx.orderLinkCode.deleteMany({ where: { orderId, usedAt: null } });
      await tx.orderLinkCode.create({ data: { orderId, codeHash: hash, expiresAt, createdById } });
    });
  }
  private async lookup(hash: string): Promise<LinkPreview | null> {
    const link = await this.db.orderLinkCode.findUnique({ where: { codeHash: hash }, include: { order: { include: { table: true, items: true } } } });
    if (!link) return null;
    return { orderId: link.orderId, orderNumber: link.order.orderNumber, branchId: link.order.branchId,
      tableNumber: link.order.table?.number ?? null, itemCount: link.order.items.reduce((sum, item) => sum + item.quantity, 0), expiresAt: link.expiresAt, usedAt: link.usedAt, clientId: link.order.clientId };
  }
  previewCode(hash: string) { return this.lookup(hash); }
  async confirmCode(hash: string, customerId: string): Promise<LinkPreview | 'conflict' | null> {
    return this.db.$transaction(async tx => {
      const link = await tx.orderLinkCode.findUnique({ where: { codeHash: hash }, include: { order: true } });
      if (!link) return null;
      if (link.usedAt || link.expiresAt <= new Date() || link.order.clientId || link.order.type !== 'DINE_IN') return 'conflict';
      const updated = await tx.order.updateMany({ where: { id: link.orderId, clientId: null }, data: { clientId: customerId, clientLinkedAt: new Date() } });
      if (updated.count !== 1) return 'conflict';
      const used = await tx.orderLinkCode.updateMany({ where: { id: link.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (used.count !== 1) throw error(409, 'LINK_CODE_CONFLICT', 'El código expiró o ya fue usado');
      return { orderId: link.orderId, orderNumber: link.order.orderNumber, branchId: link.order.branchId,
        expiresAt: link.expiresAt, usedAt: new Date(), clientId: customerId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
