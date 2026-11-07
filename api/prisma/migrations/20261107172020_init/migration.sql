-- CreateEnum
CREATE TYPE "Sport" AS ENUM ('PADEL', 'TENNIS', 'FOOTBALL');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('WEEKDAY', 'WEEKEND');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "indoor" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_hours" (
    "dayOfWeek" INTEGER NOT NULL,
    "openMinute" INTEGER NOT NULL,
    "closeMinute" INTEGER NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "opening_hours_pkey" PRIMARY KEY ("dayOfWeek")
);

-- CreateTable
CREATE TABLE "price_rules" (
    "id" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "dayType" "DayType" NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "pricePerHour" INTEGER NOT NULL,

    CONSTRAINT "price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "cancelToken" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" TEXT NOT NULL,
    "courtId" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "price_rules_sport_dayType_idx" ON "price_rules"("sport", "dayType");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_code_key" ON "bookings"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_cancelToken_key" ON "bookings"("cancelToken");

-- CreateIndex
CREATE INDEX "bookings_courtId_startsAt_idx" ON "bookings"("courtId", "startsAt");

-- CreateIndex
CREATE INDEX "blocks_startsAt_idx" ON "blocks"("startsAt");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "courts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "courts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prevent double booking: no two CONFIRMED bookings on the same court may overlap in time.
-- Enforced by the database itself, so it holds even for concurrent requests.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist ("courtId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("status" = 'CONFIRMED');

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_valid_range" CHECK ("endsAt" > "startsAt");
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_valid_range" CHECK ("endsAt" > "startsAt");
ALTER TABLE "opening_hours" ADD CONSTRAINT "opening_hours_valid" CHECK ("dayOfWeek" BETWEEN 0 AND 6 AND "openMinute" >= 0 AND "closeMinute" <= 1440 AND "closeMinute" > "openMinute");
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_valid" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute" AND "pricePerHour" > 0);
