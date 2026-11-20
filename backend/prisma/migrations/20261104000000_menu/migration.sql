CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'WAITER', 'KITCHEN', 'MANAGER', 'GENERAL_MANAGER');
CREATE TYPE "MenuCategory" AS ENUM ('STARTER', 'MAIN_COURSE', 'DRINK', 'DESSERT');

CREATE TABLE "Branch" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "role" "Role" NOT NULL,
  "branchId" UUID,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MenuItem" (
  "id" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "normalizedName" VARCHAR(80) NOT NULL,
  "description" VARCHAR(300),
  "category" "MenuCategory" NOT NULL,
  "price" DECIMAL(10,2) NOT NULL,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "createdById" UUID NOT NULL,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MenuItem_price_check" CHECK ("price" >= 0.01 AND "price" <= 99999.99)
);
CREATE UNIQUE INDEX "MenuItem_branchId_normalizedName_key" ON "MenuItem"("branchId", "normalizedName");
CREATE INDEX "MenuItem_branchId_name_id_idx" ON "MenuItem"("branchId", "name", "id");
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MenuAvailabilityChange" (
  "id" UUID NOT NULL,
  "menuItemId" UUID NOT NULL,
  "oldValue" BOOLEAN NOT NULL,
  "newValue" BOOLEAN NOT NULL,
  "changedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MenuAvailabilityChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MenuAvailabilityChange_menuItemId_createdAt_idx" ON "MenuAvailabilityChange"("menuItemId", "createdAt");
ALTER TABLE "MenuAvailabilityChange" ADD CONSTRAINT "MenuAvailabilityChange_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MenuAvailabilityChange" ADD CONSTRAINT "MenuAvailabilityChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
