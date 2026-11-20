ALTER TABLE "User" ADD COLUMN "email" VARCHAR(254);
ALTER TABLE "User" ADD COLUMN "passwordHash" VARCHAR(255);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "AuthSession" (
  "tokenHash" CHAR(64) NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
