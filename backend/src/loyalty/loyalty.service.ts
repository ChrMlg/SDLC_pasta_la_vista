import { Prisma } from '@prisma/client';

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
