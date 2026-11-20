CREATE TYPE "NotificationSourceModule" AS ENUM ('ORDERS', 'RESERVATIONS', 'KITCHEN');
CREATE TABLE "Notification" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "message" VARCHAR(500) NOT NULL,
  "sourceModule" "NotificationSourceModule" NOT NULL,
  "eventKey" VARCHAR(150) NOT NULL,
  "relatedEntityId" UUID,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Notification_eventKey_userId_key" ON "Notification"("eventKey", "userId");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
