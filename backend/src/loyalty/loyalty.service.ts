import { Prisma, PrismaClient } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import type { Session } from '../menu/menu.service';
import { BusinessError, inputFields, validateId } from '../common/business-error';

const RULE_ID = 'GLOBAL';
const MAX_INTEGER = 2_147_483_647n;
const centsOf = (value: Prisma.Decimal) => BigInt(value.mul(100).toFixed(0));

type OrderAmount = { id: string; total: Prisma.Decimal };

/** Prorates the paid amount in cents; the final order receives the exact remainder. */
export function allocatePaidAmounts(amount: Prisma.Decimal, orders: OrderAmount[]) {
  const paidCents = centsOf(amount);
  const weights = orders.map(order => centsOf(order.total));
  if (paidCents < 0n || weights.some(weight => weight < 0n)) throw new Error('Invalid loyalty amount');
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight <= 0n || !weights.length) return [];

  let allocatedCents = 0n;
  return orders.map((order, index) => {
    let shareCents: bigint;
    if (index === orders.length - 1) {
      shareCents = paidCents - allocatedCents;
    } else {
      const numerator = paidCents * weights[index];
      const quotient = numerator / totalWeight;
      const remainder = numerator % totalWeight;
      shareCents = quotient + (remainder * 2n >= totalWeight ? 1n : 0n);
      allocatedCents += shareCents;
    }
    return { orderId: order.id, amount: new Prisma.Decimal(shareCents.toString()).div(100) };
  });
}

/** Floors each order's prorated paid amount times the global conversion rate. */
export function allocatePoints(amount: Prisma.Decimal, rate: Prisma.Decimal, orders: OrderAmount[]) {
  const rateUnits = BigInt(rate.mul(10_000).toFixed(0));
  if (rateUnits < 0n) throw new Error('Invalid loyalty conversion rate');
  return allocatePaidAmounts(amount, orders).map(share => {
    const points = centsOf(share.amount) * rateUnits / 1_000_000n;
    if (points > MAX_INTEGER) throw new Error('Loyalty points exceed the database integer range');
    return { orderId: share.orderId, points: Number(points) };
  });
}

/** Called only by the payment flow with its active Prisma transaction. */
export async function accumulateLoyaltyPoints(
  tx: Prisma.TransactionClient,
  input: { paymentId: string },
): Promise<void> {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: input.paymentId },
    include: {
      bill: {
        include: {
          orders: {
            where: { status: { not: 'CANCELLED' } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, total: true },
          },
        },
      },
    },
  });
  if (payment.status !== 'PAID' || !payment.bill.clientId || !payment.bill.orders.length) return;

  const rule = await tx.loyaltyRule.findUnique({ where: { id: RULE_ID } });
  if (!rule) return;

  const allocations = allocatePoints(payment.amount, rule.conversionRate, payment.bill.orders)
    .filter(allocation => allocation.points > 0);
  if (!allocations.length) return;

  let account = await tx.loyaltyAccount.findUnique({ where: { customerId: payment.bill.clientId } });
  if (!account) {
    try {
      account = await tx.loyaltyAccount.upsert({
        where: { customerId: payment.bill.clientId },
        create: { customerId: payment.bill.clientId },
        update: {},
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      account = await tx.loyaltyAccount.findUnique({ where: { customerId: payment.bill.clientId } });
      if (!account) throw error;
    }
  }

  let earned = 0;
  for (const allocation of allocations) {
    const inserted = await tx.loyaltyTransaction.createMany({
      data: [{
        accountId: account.id,
        type: 'EARN',
        points: allocation.points,
        paymentId: input.paymentId,
        orderId: allocation.orderId,
      }],
      skipDuplicates: true,
    });
    if (inserted.count) earned += allocation.points;
  }
  if (earned) {
    if (BigInt(earned) > MAX_INTEGER) throw new Error('Loyalty balance exceeds the database integer range');
    await tx.loyaltyAccount.update({ where: { id: account.id }, data: { balance: { increment: earned } } });
  }
}

type DecimalInput = string | number;

function decimalText(value: unknown, field: string, scale: number): string {
  if (typeof value !== 'number' && typeof value !== 'string')
    throw new BusinessError(400, 'INVALID_FIELD', 'Valor decimal inválido', field);
  const text = String(value);
  const pattern = scale === 4 ? /^(?:0|[1-9]\d{0,5})(?:\.\d{1,4})?$/ : /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;
  if (!pattern.test(text) || /^0+(?:\.0+)?$/.test(text))
    throw new BusinessError(400, 'INVALID_FIELD', 'El valor debe ser mayor que cero y respetar la precisión permitida', field);
  return text;
}

function serializeRule(rule: { conversionRate: { toFixed: (scale: number) => string }; updatedById: string; updatedAt: Date }) {
  return { conversionRate: Number(rule.conversionRate.toFixed(4)), updatedById: rule.updatedById, updatedAt: rule.updatedAt.toISOString() };
}

function serializeBenefit(benefit: { id: string; name: string; pointsRequired: number; discountValue: { toFixed: (scale: number) => string }; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return { id: benefit.id, name: benefit.name, pointsRequired: benefit.pointsRequired, discountValue: Number(benefit.discountValue.toFixed(2)), isActive: benefit.isActive, createdAt: benefit.createdAt.toISOString(), updatedAt: benefit.updatedAt.toISOString() };
}

/** H22 configuration/catalog operations; H19 accrual helpers above are called inside BillingService's payment transaction. */
@Injectable()
export class LoyaltyService {
  constructor(private readonly db: PrismaClient) {}

  private requireCustomer(session: Session) {
    if (session.role !== 'CUSTOMER') throw new BusinessError(403, 'FORBIDDEN', 'Solo clientes pueden consultar sus puntos');
  }

  // H19 has a confirmed ledger. H21 adds redemption reservations separately.
  private async hasRedemptions() {
    const [row] = await this.db.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('"LoyaltyRedemption"') IS NOT NULL AS present`;
    return row.present;
  }

  async balance(session: Session) {
    this.requireCustomer(session);
    const reserved = await this.hasRedemptions() ? Prisma.sql`(
      SELECT COALESCE(SUM(r."points"), 0) FROM "LoyaltyRedemption" r
      WHERE r."accountId" = a."id" AND r."status" = 'PENDING'
    )` : Prisma.sql`0`;
    const [row] = await this.db.$queryRaw<{ balance: number; reservedPoints: bigint | number }[]>`
      SELECT a."balance", ${reserved} AS "reservedPoints"
      FROM "LoyaltyAccount" a WHERE a."customerId" = ${session.userId}::uuid`;
    const balance = row?.balance ?? 0, reservedPoints = Number(row?.reservedPoints ?? 0);
    return { balance, reservedPoints, availableBalance: balance - reservedPoints };
  }

  async history(session: Session, value: unknown) {
    this.requireCustomer(session);
    const page = value === undefined ? 1 : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(page) || page < 1)
      throw new BusinessError(400, 'INVALID_FIELD', 'page debe ser un entero positivo', 'page');

    const pageSize = 10;
    const hasRedemptions = await this.hasRedemptions();
    const source = Prisma.sql`FROM "LoyaltyTransaction" t JOIN "LoyaltyAccount" a ON a."id" = t."accountId"
      ${hasRedemptions ? Prisma.sql`LEFT JOIN "LoyaltyRedemption" r ON r."id" = t."redemptionId" AND r."accountId" = a."id"` : Prisma.empty}
      WHERE a."customerId" = ${session.userId}::uuid
      ${hasRedemptions ? Prisma.sql`AND (t."type" = 'EARN' OR r."status" = 'CONFIRMED' OR r."id" IS NULL)` : Prisma.empty}`;
    const [count] = await this.db.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total ${source}`;
    const total = Number(count.total), offset = (page - 1) * pageSize;
    if (offset >= total) return { data: [], total, page, pageSize };

    const details = hasRedemptions ? Prisma.sql`
      COALESCE(t."paymentId", (SELECT p."id" FROM "Payment" p WHERE p."billId" = r."billId"
        AND p."status" IN ('PAID','REFUNDED') ORDER BY p."completedAt" DESC, p."id" DESC LIMIT 1)) AS "paymentId",
      (SELECT b."name" FROM "LoyaltyBenefit" b WHERE b."id" = r."benefitId") AS "benefitName"` : Prisma.sql`t."paymentId", NULL::text AS "benefitName"`;
    const rows = await this.db.$queryRaw<{ id: string; type: string; points: number; createdAt: Date; paymentId: string | null;
      orderId: string | null; redemptionId: string | null; benefitName: string | null }[]>`
      SELECT t."id", t."type"::text, t."points", t."createdAt", t."orderId", t."redemptionId", ${details}
      ${source} ORDER BY t."createdAt" DESC, t."id" DESC LIMIT ${pageSize} OFFSET ${offset}`;
    const data = rows.map(({ benefitName, ...row }) => row.type === 'REDEEM' ? { ...row, benefitName } : row);
    return { data, total, page, pageSize };
  }

  getRule(session: Session) {
    this.requireReadRole(session);
    return this.db.loyaltyRule.findUnique({ where: { id: RULE_ID } }).then(rule => {
      if (!rule) throw new BusinessError(404, 'LOYALTY_RULE_NOT_FOUND', 'No hay una regla de lealtad configurada');
      return serializeRule(rule);
    });
  }

  async updateRule(body: unknown, session: Session) {
    this.requireWriteRole(session);
    const input = inputFields(body, ['conversionRate']);
    if (Object.keys(input).length !== 1) throw new BusinessError(400, 'INVALID_FIELD', 'Debe indicar conversionRate', 'conversionRate');
    const conversionRate = decimalText(input.conversionRate as DecimalInput, 'conversionRate', 4);
    const rule = await this.db.loyaltyRule.upsert({
      where: { id: RULE_ID },
      create: { id: RULE_ID, conversionRate, updatedById: session.userId },
      update: { conversionRate, updatedById: session.userId },
    });
    return serializeRule(rule);
  }

  async listAllBenefits(session: Session) {
    this.requireReadRole(session);
    const benefits = await this.db.loyaltyBenefit.findMany({ orderBy: [{ pointsRequired: 'asc' }, { id: 'asc' }] });
    return benefits.map(serializeBenefit);
  }

  async listActiveBenefits(session: Session) {
    if (session.role !== 'CUSTOMER') throw new BusinessError(403, 'FORBIDDEN', 'Solo clientes pueden consultar beneficios de checkout');
    const benefits = await this.db.loyaltyBenefit.findMany({ where: { isActive: true }, orderBy: [{ pointsRequired: 'asc' }, { id: 'asc' }] });
    return benefits.map(serializeBenefit);
  }

  async createBenefit(body: unknown, session: Session) {
    this.requireWriteRole(session);
    const input = inputFields(body, ['name', 'pointsRequired', 'discountValue', 'isActive']);
    const name = this.name(input.name);
    const pointsRequired = this.points(input.pointsRequired);
    const discountValue = decimalText(input.discountValue, 'discountValue', 2);
    if (typeof input.isActive !== 'boolean') throw new BusinessError(400, 'INVALID_FIELD', 'isActive debe ser booleano', 'isActive');
    const benefit = await this.db.loyaltyBenefit.create({ data: { name, pointsRequired, discountValue, isActive: input.isActive } });
    return serializeBenefit(benefit);
  }

  async updateBenefit(id: string, body: unknown, session: Session) {
    this.requireWriteRole(session);
    validateId(id, 'benefitId');
    const input = inputFields(body, ['name', 'pointsRequired', 'discountValue', 'isActive']);
    if (!Object.keys(input).length) throw new BusinessError(400, 'INVALID_FIELD', 'Indique al menos un campo');
    const data: { name?: string; pointsRequired?: number; discountValue?: string; isActive?: boolean } = {};
    if ('name' in input) data.name = this.name(input.name);
    if ('pointsRequired' in input) data.pointsRequired = this.points(input.pointsRequired);
    if ('discountValue' in input) data.discountValue = decimalText(input.discountValue, 'discountValue', 2);
    if ('isActive' in input) {
      if (typeof input.isActive !== 'boolean') throw new BusinessError(400, 'INVALID_FIELD', 'isActive debe ser booleano', 'isActive');
      data.isActive = input.isActive;
    }
    const result = await this.db.loyaltyBenefit.updateMany({ where: { id }, data });
    if (!result.count) throw new BusinessError(404, 'BENEFIT_NOT_FOUND', 'Beneficio no encontrado');
    return serializeBenefit(await this.db.loyaltyBenefit.findUniqueOrThrow({ where: { id } }));
  }

  private requireReadRole(session: Session) {
    if (session.role !== 'MANAGER' && session.role !== 'GENERAL_MANAGER')
      throw new BusinessError(403, 'FORBIDDEN', 'Solo gerencia puede consultar la configuración de lealtad');
  }

  private requireWriteRole(session: Session) {
    if (session.role !== 'GENERAL_MANAGER')
      throw new BusinessError(403, 'FORBIDDEN', 'Solo gerencia general puede modificar la configuración de lealtad');
  }

  private name(value: unknown) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 100 || value.trim() !== value || !value.trim())
      throw new BusinessError(400, 'INVALID_FIELD', 'name debe tener entre 1 y 100 caracteres sin espacios externos', 'name');
    return value;
  }

  private points(value: unknown) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647)
      throw new BusinessError(400, 'INVALID_FIELD', 'pointsRequired debe ser un entero positivo', 'pointsRequired');
    return value;
  }
}
