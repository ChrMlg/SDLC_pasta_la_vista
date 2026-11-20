BEGIN;

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "closingTime" CHAR(5) NOT NULL DEFAULT '22:00',
ADD COLUMN     "openingTime" CHAR(5) NOT NULL DEFAULT '12:00';

-- AlterTable
ALTER TABLE "Table" ADD COLUMN     "capacity" INTEGER;

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "date" CHAR(10) NOT NULL,
    "startTime" CHAR(5) NOT NULL,
    "endTime" CHAR(5) NOT NULL,
    "partySize" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Reservation_tableId_date_status_idx" ON "Reservation"("tableId", "date", "status");

-- CreateIndex
CREATE INDEX "Reservation_branchId_date_idx" ON "Reservation"("branchId", "date");

-- CreateIndex
CREATE INDEX "Reservation_customerId_date_idx" ON "Reservation"("customerId", "date");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- H10: validate persisted scheduling data independently of HTTP input.
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_reservation_hours_check" CHECK (
  "openingTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
  "closingTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "openingTime" < "closingTime"
);
ALTER TABLE "Table" ADD CONSTRAINT "Table_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_party_size_check" CHECK ("partySize" > 0);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_date_check" CHECK (
  "date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND "date"::date::text = "date"
);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_duration_check" CHECK (
  "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
  "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND
  ("endTime"::time - "startTime"::time) = interval '90 minutes'
);

COMMIT;
