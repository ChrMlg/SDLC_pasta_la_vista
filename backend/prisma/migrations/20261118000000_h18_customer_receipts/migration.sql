BEGIN;

ALTER TABLE "Receipt"
  ADD COLUMN "paymentId" UUID,
  ADD COLUMN "clientId" UUID,
  ADD COLUMN "subtotal" DECIMAL(12,2),
  ADD COLUMN "discountAmount" DECIMAL(12,2),
  ADD COLUMN "taxAmount" DECIMAL(12,2),
  ADD COLUMN "total" DECIMAL(12,2);

-- Usa los importes del comprobante emitido y el pago que lo originó.
UPDATE "Receipt" r SET
  "paymentId" = (SELECT p."id" FROM "Payment" p WHERE p."billId" = r."billId" AND p."status" IN ('PAID', 'REFUNDED')),
  "clientId" = b."clientId",
  "subtotal" = (r."snapshot"->>'subtotal')::numeric,
  "discountAmount" = (r."snapshot"->>'discount')::numeric,
  "taxAmount" = (r."snapshot"->>'tax')::numeric,
  "total" = (r."snapshot"->>'total')::numeric
FROM "Bill" b WHERE b."id" = r."billId";

ALTER TABLE "Receipt"
  ALTER COLUMN "paymentId" SET NOT NULL,
  ALTER COLUMN "subtotal" SET NOT NULL,
  ALTER COLUMN "discountAmount" SET NOT NULL,
  ALTER COLUMN "taxAmount" SET NOT NULL,
  ALTER COLUMN "total" SET NOT NULL,
  ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Receipt_paymentId_key" ON "Receipt"("paymentId");
CREATE UNIQUE INDEX "Receipt_number_key" ON "Receipt"("number");
DROP INDEX "Receipt_branchId_number_key";

COMMIT;
