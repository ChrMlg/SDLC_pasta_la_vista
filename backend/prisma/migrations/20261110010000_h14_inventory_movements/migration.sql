BEGIN;

CREATE TYPE "InventoryMovementType" AS ENUM ('IN', 'OUT');
CREATE TYPE "InventoryAlertStatus" AS ENUM ('ACTIVE', 'RESOLVED');

CREATE TABLE "InventoryMovement" (
  "id" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "type" "InventoryMovementType" NOT NULL,
  "reason" VARCHAR(200) NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryMovement_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "InventoryMovement_reason_check" CHECK (length(btrim("reason")) > 0)
);
CREATE INDEX "InventoryMovement_itemId_createdAt_idx" ON "InventoryMovement"("itemId", "createdAt");
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Persistencia necesaria para la resolución transaccional que exige H14.
CREATE TABLE "InventoryAlert" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "currentStock" INTEGER NOT NULL,
  "minStock" INTEGER NOT NULL,
  "status" "InventoryAlertStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" UUID,
  CONSTRAINT "InventoryAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryAlert_stock_check" CHECK ("currentStock" >= 0 AND "minStock" >= 0),
  CONSTRAINT "InventoryAlert_resolution_check" CHECK (
    ("status" = 'ACTIVE' AND "resolvedAt" IS NULL AND "resolvedByUserId" IS NULL) OR
    ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND "resolvedByUserId" IS NOT NULL)
  )
);
CREATE INDEX "InventoryAlert_branchId_status_createdAt_idx" ON "InventoryAlert"("branchId", "status", "createdAt");
CREATE UNIQUE INDEX "InventoryAlert_one_active_item" ON "InventoryAlert"("itemId") WHERE "status" = 'ACTIVE';
ALTER TABLE "InventoryAlert" ADD CONSTRAINT "InventoryAlert_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAlert" ADD CONSTRAINT "InventoryAlert_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryAlert" ADD CONSTRAINT "InventoryAlert_resolvedByUserId_fkey"
  FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
