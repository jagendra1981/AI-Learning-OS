-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'LOCKED', 'SUSPENDED', 'DELETED', 'ANONYMIZED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'MANAGED');

-- CreateEnum
CREATE TYPE "ConsentState" AS ENUM ('GRANTED', 'WITHDRAWN', 'REVOKED');

-- CreateEnum
CREATE TYPE "UserRoleName" AS ENUM ('STUDENT', 'CONTENT_REVIEWER', 'ACADEMIC_ADMIN', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "RoleAssignmentStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "userId" UUID NOT NULL,
    "authProvider" "AuthProvider" NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "email" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "studentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "targetExamId" TEXT,
    "targetYear" INTEGER,
    "availabilityProfile" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("studentId")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "consentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "consentType" TEXT NOT NULL,
    "state" "ConsentState" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("consentId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userRoleId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "UserRoleName" NOT NULL,
    "scope" JSONB,
    "status" "RoleAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedByUserId" UUID,
    "auditReference" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userRoleId")
);

-- CreateTable
CREATE TABLE "sessions" (
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "rotatedFromId" UUID,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("sessionId")
);

-- CreateIndex
CREATE INDEX "users_providerSubject_idx" ON "users"("providerSubject");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_authProvider_providerSubject_key" ON "users"("authProvider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_userId_key" ON "student_profiles"("userId");

-- CreateIndex
CREATE INDEX "student_profiles_targetExamId_idx" ON "student_profiles"("targetExamId");

-- CreateIndex
CREATE INDEX "consent_records_userId_consentType_recordedAt_idx" ON "consent_records"("userId", "consentType", "recordedAt");

-- CreateIndex
CREATE INDEX "user_roles_userId_status_idx" ON "user_roles"("userId", "status");

-- CreateIndex
CREATE INDEX "user_roles_role_status_idx" ON "user_roles"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_expiresAt_idx" ON "sessions"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "users"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_rotatedFromId_fkey" FOREIGN KEY ("rotatedFromId") REFERENCES "sessions"("sessionId") ON DELETE SET NULL ON UPDATE CASCADE;
