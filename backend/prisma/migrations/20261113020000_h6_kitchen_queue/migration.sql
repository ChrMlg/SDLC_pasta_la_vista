BEGIN;

CREATE TYPE "KitchenTicketStatus" AS ENUM ('PENDING', 'IN_PREPARATION', 'READY', 'CANCELLED');
ALTER TABLE "KitchenTicket" ALTER COLUMN "status" DROP DEFAULT;
-- Un estado legado incompatible aborta la transacción; no se inventa otro estado.
ALTER TABLE "KitchenTicket" ALTER COLUMN "status" TYPE "KitchenTicketStatus"
  USING "status"::text::"KitchenTicketStatus";
ALTER TABLE "KitchenTicket" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "KitchenTicket"
  ADD COLUMN "branchId" UUID,
  ADD COLUMN "takenById" UUID,
  ADD COLUMN "takenAt" TIMESTAMP(3),
  ADD COLUMN "readyAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3);

UPDATE "KitchenTicket" AS ticket
SET "branchId" = orders."branchId", "updatedAt" = ticket."createdAt"
FROM "Order" AS orders WHERE orders."id" = ticket."orderId";
ALTER TABLE "KitchenTicket" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "KitchenTicket" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "KitchenTicket" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_takenById_fkey"
  FOREIGN KEY ("takenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "KitchenTicket_branchId_status_createdAt_idx" ON "KitchenTicket"("branchId", "status", "createdAt");

COMMIT;
