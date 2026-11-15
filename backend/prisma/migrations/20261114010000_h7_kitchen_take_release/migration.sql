BEGIN;

ALTER TABLE "OrderItem" ADD COLUMN "isReady" BOOLEAN NOT NULL DEFAULT false;
UPDATE "OrderItem" SET "isReady" = true WHERE "status" = 'READY';

CREATE TYPE "KitchenTicketAction" AS ENUM ('TAKE', 'RELEASE', 'READY');
CREATE TABLE "KitchenTicketLog" (
  "id" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "action" "KitchenTicketAction" NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KitchenTicketLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KitchenTicketLog_ticketId_createdAt_idx" ON "KitchenTicketLog"("ticketId", "createdAt");
ALTER TABLE "KitchenTicketLog" ADD CONSTRAINT "KitchenTicketLog_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "KitchenTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KitchenTicketLog" ADD CONSTRAINT "KitchenTicketLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
