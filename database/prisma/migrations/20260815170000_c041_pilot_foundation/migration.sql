CREATE TYPE "PilotStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'COMPLETED');

CREATE TABLE "pilots" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PilotStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "ownerUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilots_status_startsAt_idx" ON "pilots"("status", "startsAt");
CREATE INDEX "pilots_ownerUserId_idx" ON "pilots"("ownerUserId");

ALTER TABLE "pilots" ADD CONSTRAINT "pilots_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
