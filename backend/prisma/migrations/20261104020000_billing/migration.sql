CREATE TYPE "BillStatus" AS ENUM ('OPEN', 'PAID');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'FAILED');

CREATE TABLE "Bill" (
  "id" UUID NOT NULL, "branchId" UUID NOT NULL, "tableId" UUID,
  "type" "OrderType" NOT NULL, "status" "BillStatus" NOT NULL DEFAULT 'OPEN',
  "subtotal" DECIMAL(12,2) NOT NULL, "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(12,2) NOT NULL, "total" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "paidAt" TIMESTAMP(3),
  CONSTRAINT "Bill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Bill_amount_check" CHECK ("subtotal" > 0 AND "discount" >= 0 AND "discount" <= "subtotal" AND "tax" >= 0 AND "total" > 0),
  CONSTRAINT "Bill_table_type_check" CHECK (("type" = 'DINE_IN' AND "tableId" IS NOT NULL) OR ("type" = 'TAKEAWAY' AND "tableId" IS NULL))
);
CREATE INDEX "Bill_branchId_tableId_idx" ON "Bill"("branchId", "tableId");
CREATE UNIQUE INDEX "Bill_one_open_table" ON "Bill"("tableId") WHERE "status" = 'OPEN' AND "tableId" IS NOT NULL;
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD COLUMN "billId" UUID;
CREATE INDEX "Order_billId_idx" ON "Order"("billId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Payment" (
  "id" UUID NOT NULL, "billId" UUID NOT NULL, "userId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(64) NOT NULL, "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(12,2) NOT NULL, "cardLast4" CHAR(4) NOT NULL,
  "failureCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3), CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payment_amount_check" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "Payment_billId_idempotencyKey_key" ON "Payment"("billId", "idempotencyKey");
CREATE INDEX "Payment_billId_status_createdAt_idx" ON "Payment"("billId", "status", "createdAt");
CREATE UNIQUE INDEX "Payment_one_pending_bill" ON "Payment"("billId") WHERE "status" = 'PENDING';
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReceiptCounter" (
  "branchId" UUID NOT NULL, "nextNumber" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ReceiptCounter_pkey" PRIMARY KEY ("branchId"),
  CONSTRAINT "ReceiptCounter_next_check" CHECK ("nextNumber" > 0)
);
ALTER TABLE "ReceiptCounter" ADD CONSTRAINT "ReceiptCounter_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Receipt" (
  "id" UUID NOT NULL, "billId" UUID NOT NULL, "branchId" UUID NOT NULL,
  "number" VARCHAR(80) NOT NULL, "sequence" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL, "cardLast4" CHAR(4) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Receipt_sequence_check" CHECK ("sequence" > 0 AND "sequence" <= 999999)
);
CREATE UNIQUE INDEX "Receipt_billId_key" ON "Receipt"("billId");
CREATE UNIQUE INDEX "Receipt_branchId_sequence_key" ON "Receipt"("branchId", "sequence");
CREATE UNIQUE INDEX "Receipt_branchId_number_key" ON "Receipt"("branchId", "number");
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
