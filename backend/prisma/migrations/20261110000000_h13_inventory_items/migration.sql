BEGIN;

CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "minStock" INTEGER NOT NULL,
    "currentStock" INTEGER NOT NULL,
    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryItem_min_stock_check" CHECK ("minStock" >= 0),
    CONSTRAINT "InventoryItem_current_stock_check" CHECK ("currentStock" >= 0),
    CONSTRAINT "InventoryItem_name_check" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "InventoryItem_unit_check" CHECK (length(btrim("unit")) > 0)
);

CREATE UNIQUE INDEX "InventoryItem_branchId_name_key" ON "InventoryItem"("branchId", "name");

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
