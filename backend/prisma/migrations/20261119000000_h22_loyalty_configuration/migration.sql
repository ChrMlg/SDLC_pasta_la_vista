BEGIN;

-- H19 owns the singleton LoyaltyRule table. H22 adds only the benefit catalog.
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
