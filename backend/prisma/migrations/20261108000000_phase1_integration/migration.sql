-- Preserva los pagos existentes y sus relaciones; no elimina registros.
ALTER TYPE "PaymentStatus" RENAME VALUE 'APPROVED' TO 'PAID';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "BillStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "TableStatus" ADD VALUE 'OUT_OF_SERVICE';
ALTER TABLE "User"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "firstName" VARCHAR(80),
  ADD COLUMN "lastName" VARCHAR(80),
  ADD COLUMN "phone" VARCHAR(8),
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Order" ADD COLUMN "clientLinkedAt" TIMESTAMP(3);
ALTER TABLE "OrderLinkCode" ADD COLUMN "createdById" UUID;
ALTER TABLE "OrderLinkCode" ADD CONSTRAINT "OrderLinkCode_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- No se inventa una fecha o autor para vínculos históricos.
ALTER TABLE "Bill" ADD COLUMN "clientId" UUID;
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Conserva la política anterior: dueño solamente si todos los pedidos tienen el mismo cliente.
UPDATE "Bill" b SET "clientId" = owners."clientId"::uuid
FROM (SELECT "billId", min("clientId"::text) AS "clientId"
      FROM "Order" WHERE "billId" IS NOT NULL GROUP BY "billId"
      HAVING count(*) = count("clientId") AND count(DISTINCT "clientId") = 1) owners
WHERE b."id" = owners."billId";
