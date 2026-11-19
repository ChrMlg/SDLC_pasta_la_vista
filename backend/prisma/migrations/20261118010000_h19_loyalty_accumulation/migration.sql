BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LoyaltyTransactionType') THEN
    CREATE TYPE "LoyaltyTransactionType" AS ENUM ('EARN', 'REDEEM');
  END IF;
END $$;

CREATE TABLE "LoyaltyAccount" (
  "id" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoyaltyAccount_balance_check" CHECK ("balance" >= 0),
  CONSTRAINT "LoyaltyAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LoyaltyAccount_customerId_key" ON "LoyaltyAccount"("customerId");

CREATE TABLE "LoyaltyTransaction" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "type" "LoyaltyTransactionType" NOT NULL,
  "points" INTEGER NOT NULL,
  "paymentId" UUID,
  "orderId" UUID,
  "redemptionId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoyaltyTransaction_shape_check" CHECK (
    ("type" = 'EARN' AND "points" > 0 AND "paymentId" IS NOT NULL AND "orderId" IS NOT NULL AND "redemptionId" IS NULL)
    OR
    ("type" = 'REDEEM' AND "points" < 0 AND "paymentId" IS NULL AND "orderId" IS NULL AND "redemptionId" IS NOT NULL)
  ),
  CONSTRAINT "LoyaltyTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LoyaltyTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LoyaltyTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LoyaltyTransaction_paymentId_orderId_key" ON "LoyaltyTransaction"("paymentId", "orderId");
CREATE UNIQUE INDEX "LoyaltyTransaction_redemptionId_key" ON "LoyaltyTransaction"("redemptionId");
CREATE INDEX "LoyaltyTransaction_accountId_createdAt_idx" ON "LoyaltyTransaction"("accountId", "createdAt" DESC);

COMMIT;
