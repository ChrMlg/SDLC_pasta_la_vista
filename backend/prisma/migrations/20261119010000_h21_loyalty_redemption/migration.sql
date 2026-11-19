BEGIN;
-- CreateEnum
CREATE TYPE "LoyaltyRedemptionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'RELEASED');

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "redemptionId" UUID;

-- CreateTable
CREATE TABLE "LoyaltyRedemption" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "benefitId" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "status" "LoyaltyRedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "LoyaltyRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyRedemption_paymentId_key" ON "LoyaltyRedemption"("paymentId");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_accountId_status_idx" ON "LoyaltyRedemption"("accountId", "status");

-- CreateIndex
CREATE INDEX "LoyaltyRedemption_billId_idx" ON "LoyaltyRedemption"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_redemptionId_key" ON "Bill"("redemptionId");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "LoyaltyRedemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- H19 accepted REDEEM rows before redemption records existed.
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "LoyaltyRedemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "LoyaltyBenefit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "LoyaltyRedemption_billId_active_key" ON "LoyaltyRedemption"("billId") WHERE status IN ('PENDING','CONFIRMED');
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "loyalty_redemption_points_pos" CHECK (points > 0 AND "discountAmount" > 0);
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT "LoyaltyTransaction_shape_check",
  ADD CONSTRAINT "LoyaltyTransaction_shape_check" CHECK (
    (type = 'EARN' AND points > 0 AND "paymentId" IS NOT NULL AND "orderId" IS NOT NULL AND "redemptionId" IS NULL)
    OR (type = 'REDEEM' AND points < 0 AND "paymentId" IS NOT NULL AND "orderId" IS NULL AND "redemptionId" IS NOT NULL)
  ) NOT VALID;

-- Reprice on the bill row so cancellation and order attachment use the same snapshot as checkout.
CREATE FUNCTION loyalty_price_bill() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE amount numeric;
BEGIN
  IF OLD."redemptionId" IS NULL AND NEW."redemptionId" IS NULL THEN RETURN NEW; END IF;
  IF OLD.status <> 'OPEN' OR NEW.status = 'PAID' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM "Payment" WHERE "billId" = NEW.id AND status = 'PENDING') THEN
    RAISE EXCEPTION 'PAYMENT_IN_PROGRESS';
  END IF;
  IF NEW.status = 'CANCELLED' THEN NEW."redemptionId" := NULL; END IF;
  IF OLD."redemptionId" IS NOT NULL AND NEW."redemptionId" IS NULL THEN
    UPDATE "LoyaltyRedemption" SET status = 'RELEASED', "releasedAt" = CURRENT_TIMESTAMP
      WHERE id = OLD."redemptionId" AND status = 'PENDING' RETURNING "discountAmount" INTO STRICT amount;
    NEW.discount := OLD.discount - amount;
  ELSIF OLD."redemptionId" IS NULL THEN
    SELECT "discountAmount" INTO STRICT amount FROM "LoyaltyRedemption"
      WHERE id = NEW."redemptionId" AND "billId" = NEW.id AND status = 'PENDING';
    NEW.discount := OLD.discount + amount;
  END IF;
  IF NEW.subtotal <= NEW.discount THEN RAISE EXCEPTION 'REDEMPTION_TOTAL_TOO_LOW'; END IF;
  NEW.tax := round((NEW.subtotal - NEW.discount) * 0.13, 2);
  NEW.total := NEW.subtotal - NEW.discount + NEW.tax;
  RETURN NEW;
END $$;
CREATE TRIGGER loyalty_price_bill BEFORE UPDATE OF "redemptionId", subtotal, status ON "Bill"
  FOR EACH ROW EXECUTE FUNCTION loyalty_price_bill();

CREATE FUNCTION loyalty_attach_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."billId" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."billId" IS DISTINCT FROM NEW."billId") THEN
    UPDATE "Bill" SET subtotal = subtotal + NEW.total
      WHERE id = NEW."billId" AND status = 'OPEN' AND "redemptionId" IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER loyalty_attach_order AFTER INSERT OR UPDATE OF "billId" ON "Order"
  FOR EACH ROW EXECUTE FUNCTION loyalty_attach_order();

COMMIT;

