BEGIN;

CREATE TABLE "LoyaltyRule" (
  "id" VARCHAR(16) NOT NULL DEFAULT 'GLOBAL',
  "conversionRate" DECIMAL(10,4) NOT NULL,
  "updatedById" VARCHAR(80) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoyaltyRule_id_global_check" CHECK ("id" = 'GLOBAL'),
  CONSTRAINT "LoyaltyRule_conversionRate_check" CHECK ("conversionRate" > 0)
);

CREATE TABLE "LoyaltyBenefit" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "pointsRequired" INTEGER NOT NULL,
  "discountValue" DECIMAL(10,2) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyBenefit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoyaltyBenefit_pointsRequired_check" CHECK ("pointsRequired" > 0),
  CONSTRAINT "LoyaltyBenefit_discountValue_check" CHECK ("discountValue" > 0)
);

CREATE INDEX "LoyaltyBenefit_isActive_pointsRequired_id_idx"
  ON "LoyaltyBenefit"("isActive", "pointsRequired", "id");

COMMIT;
