import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { BusinessError, inputFields, validateId } from '../common/business-error';
import type { Session } from '../menu/menu.service';

type Tx = Prisma.TransactionClient;
const billFields = { id: true, subtotal: true, discount: true, tax: true, total: true } as const;
type PricedBill = Prisma.BillGetPayload<{ select: typeof billFields }>;

function serializeBill(bill: PricedBill) {
  return { id: bill.id, subtotal: bill.subtotal.toNumber(), discount: bill.discount.toNumber(),
    tax: bill.tax.toNumber(), total: bill.total.toNumber() };
}

function ids(body: unknown, fields: string[]) {
  try {
    const input = inputFields(body, fields);
    const result: Record<string, string> = {};
    for (const field of fields) {
      const value = input[field];
      validateId(value, field);
      result[field] = value;
    }
    return result;
  } catch (error) {
    if (error instanceof BusinessError) throw new BusinessError(400, 'VALIDATION_ERROR', error.message, error.field);
    throw error;
  }
}

async function lockBill(tx: Tx, billId: string, customerId: string) {
  const [bill] = await tx.$queryRaw<{ status: string; redemptionId: string | null; subtotal: Prisma.Decimal; discount: Prisma.Decimal }[]>`
    SELECT status::text, "redemptionId", subtotal, discount FROM "Bill"
    WHERE id = ${billId}::uuid AND "clientId" = ${customerId}::uuid FOR UPDATE`;
  if (!bill) throw new BusinessError(404, 'BILL_NOT_FOUND', 'Cuenta no encontrada', 'billId');
  return bill;
}

async function requireEditable(tx: Tx, billId: string, status: string) {
  if (status !== 'OPEN') throw new BusinessError(409, 'BILL_NOT_OPEN', 'La cuenta no está abierta', 'billId');
  if (await tx.payment.count({ where: { billId, status: 'PENDING' } }))
    throw new BusinessError(409, 'PAYMENT_IN_PROGRESS', 'Hay un pago en proceso', 'billId');
}

// The bill trigger applies or removes the snapshot and recalculates the tax in the same update.
export function applyLoyaltyDiscount(tx: Tx, billId: string, redemptionId: string) {
  return tx.bill.update({ where: { id: billId }, data: { redemptionId }, select: billFields });
}

export function releaseLoyaltyRedemption(tx: Tx, { billId }: { billId: string }) {
  return tx.bill.update({ where: { id: billId }, data: { redemptionId: null }, select: billFields });
}

export async function confirmLoyaltyRedemption(tx: Tx, { paymentId }: { paymentId: string }) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true, bill: { select: { redemptionId: true } } } });
  if (payment.status !== 'PAID' || !payment.bill.redemptionId) return;
  const id = payment.bill.redemptionId;
  const redemption = await tx.loyaltyRedemption.findUniqueOrThrow({ where: { id } });
  const changed = await tx.loyaltyRedemption.updateMany({ where: { id, status: 'PENDING' },
    data: { status: 'CONFIRMED', paymentId, confirmedAt: new Date() } });
  if (!changed.count) return;
  const debited = await tx.loyaltyAccount.updateMany({ where: { id: redemption.accountId, balance: { gte: redemption.points } },
    data: { balance: { decrement: redemption.points } } });
  if (!debited.count) throw new Error('El saldo no cubre los puntos reservados');
  await tx.loyaltyTransaction.create({ data: { accountId: redemption.accountId, type: 'REDEEM', points: -redemption.points, redemptionId: id, paymentId } });
}

@Injectable()
export class RedemptionService {
  constructor(private readonly db: PrismaClient) {}

  redeem(body: unknown, session: Session) {
    const { billId, benefitId } = ids(body, ['billId', 'benefitId']);
    return this.db.$transaction(async tx => {
      const bill = await lockBill(tx, billId, session.userId);
      await requireEditable(tx, billId, bill.status);
      if (bill.redemptionId) throw new BusinessError(409, 'REDEMPTION_ALREADY_EXISTS', 'La cuenta ya tiene un canje', 'billId');
      const benefit = await tx.loyaltyBenefit.findFirst({ where: { id: benefitId, isActive: true } });
      if (!benefit) throw new BusinessError(404, 'BENEFIT_NOT_FOUND', 'Beneficio no encontrado', 'benefitId');
      const [account] = await tx.$queryRaw<{ id: string; balance: number }[]>`
        SELECT id, balance FROM "LoyaltyAccount" WHERE "customerId" = ${session.userId}::uuid FOR UPDATE`;
      const reserved = account && await tx.loyaltyRedemption.aggregate({ where: { accountId: account.id, status: 'PENDING' }, _sum: { points: true } });
      const available = (account?.balance ?? 0) - (reserved?._sum.points ?? 0);
      if (!account || available < benefit.pointsRequired)
        throw new BusinessError(400, 'INSUFFICIENT_POINTS', 'Puntos disponibles insuficientes', 'benefitId');
      if (bill.subtotal.lte(bill.discount.plus(benefit.discountValue)))
        throw new BusinessError(422, 'REDEMPTION_TOTAL_TOO_LOW', 'El total debe ser al menos 0.01', 'benefitId');
      const redemption = await tx.loyaltyRedemption.create({ data: { accountId: account.id, billId, benefitId,
        points: benefit.pointsRequired, discountAmount: benefit.discountValue } });
      const priced = await applyLoyaltyDiscount(tx, billId, redemption.id);
      return { redemptionId: redemption.id, status: redemption.status, points: redemption.points, bill: serializeBill(priced),
        availableBalance: available - redemption.points };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  release(value: string, session: Session) {
    const { redemptionId } = ids({ redemptionId: value }, ['redemptionId']);
    return this.db.$transaction(async tx => {
      const owned = await tx.loyaltyRedemption.findFirst({ where: { id: redemptionId, bill: { clientId: session.userId } }, select: { billId: true } });
      if (!owned) throw new BusinessError(404, 'REDEMPTION_NOT_FOUND', 'Canje no encontrado', 'redemptionId');
      const bill = await lockBill(tx, owned.billId, session.userId);
      const redemption = await tx.loyaltyRedemption.findUniqueOrThrow({ where: { id: redemptionId } });
      if (redemption.status === 'RELEASED') return { status: 'RELEASED', bill: serializeBill(await tx.bill.findUniqueOrThrow({ where: { id: owned.billId }, select: billFields })) };
      await requireEditable(tx, owned.billId, bill.status);
      if (redemption.status !== 'PENDING' || bill.redemptionId !== redemption.id)
        throw new BusinessError(409, 'REDEMPTION_NOT_PENDING', 'El canje no está pendiente', 'redemptionId');
      return { status: 'RELEASED', bill: serializeBill(await releaseLoyaltyRedemption(tx, owned)) };
    });
  }
}
