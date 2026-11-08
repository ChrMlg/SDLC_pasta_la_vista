CREATE TYPE "TableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'NEEDS_CLEANING');
CREATE TYPE "OrderType" AS ENUM ('DINE_IN', 'TAKEAWAY');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'IN_PREPARATION', 'READY', 'CANCELLED');
CREATE SEQUENCE "OrderNumberSeq" AS INTEGER START 1;

CREATE TABLE "Table" (
  "id" UUID NOT NULL, "branchId" UUID NOT NULL, "number" INTEGER NOT NULL,
  "status" "TableStatus" NOT NULL DEFAULT 'AVAILABLE',
  CONSTRAINT "Table_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Table_number_check" CHECK ("number" > 0)
);
CREATE UNIQUE INDEX "Table_branchId_number_key" ON "Table"("branchId", "number");
CREATE INDEX "Table_branchId_status_idx" ON "Table"("branchId", "status");
ALTER TABLE "Table" ADD CONSTRAINT "Table_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TableAssignment" (
  "id" UUID NOT NULL, "tableId" UUID NOT NULL, "customerId" UUID NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL, "validTo" TIMESTAMP(3),
  CONSTRAINT "TableAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TableAssignment_window_check" CHECK ("validTo" IS NULL OR "validTo" > "validFrom")
);
CREATE INDEX "TableAssignment_customerId_tableId_validFrom_validTo_idx" ON "TableAssignment"("customerId", "tableId", "validFrom", "validTo");
ALTER TABLE "TableAssignment" ADD CONSTRAINT "TableAssignment_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TableAssignment" ADD CONSTRAINT "TableAssignment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Order" (
  "id" UUID NOT NULL, "orderNumber" INTEGER NOT NULL, "branchId" UUID NOT NULL,
  "tableId" UUID, "createdById" UUID NOT NULL, "clientId" UUID,
  "type" "OrderType" NOT NULL, "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "total" DECIMAL(12,2) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "deliveredAt" TIMESTAMP(3),
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_total_check" CHECK ("total" > 0),
  CONSTRAINT "Order_table_type_check" CHECK (("type" = 'DINE_IN' AND "tableId" IS NOT NULL) OR ("type" = 'TAKEAWAY' AND "tableId" IS NULL))
);
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
CREATE INDEX "Order_branchId_tableId_status_idx" ON "Order"("branchId", "tableId", "status");
CREATE INDEX "Order_clientId_createdAt_idx" ON "Order"("clientId", "createdAt");
ALTER TABLE "Order" ADD CONSTRAINT "Order_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OrderItem" (
  "id" UUID NOT NULL, "orderId" UUID NOT NULL, "dishId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL, "unitPrice" DECIMAL(10,2) NOT NULL,
  "note" VARCHAR(500), "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItem_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "OrderItem_unitPrice_check" CHECK ("unitPrice" > 0)
);
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "KitchenTicket" (
  "id" UUID NOT NULL, "orderId" UUID NOT NULL, "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KitchenTicket_orderId_key" ON "KitchenTicket"("orderId");
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OrderLinkCode" (
  "id" UUID NOT NULL, "orderId" UUID NOT NULL, "codeHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderLinkCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrderLinkCode_codeHash_key" ON "OrderLinkCode"("codeHash");
CREATE INDEX "OrderLinkCode_orderId_expiresAt_idx" ON "OrderLinkCode"("orderId", "expiresAt");
ALTER TABLE "OrderLinkCode" ADD CONSTRAINT "OrderLinkCode_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
