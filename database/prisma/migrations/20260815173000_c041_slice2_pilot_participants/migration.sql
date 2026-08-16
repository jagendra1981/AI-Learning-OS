CREATE TABLE "pilot_participants" (
    "pilotId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_participants_pkey" PRIMARY KEY ("pilotId", "userId")
);

CREATE INDEX "pilot_participants_userId_idx" ON "pilot_participants"("userId");

ALTER TABLE "pilot_participants" ADD CONSTRAINT "pilot_participants_pilotId_fkey"
  FOREIGN KEY ("pilotId") REFERENCES "pilots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pilot_participants" ADD CONSTRAINT "pilot_participants_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
