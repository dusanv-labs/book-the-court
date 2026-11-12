-- Online payments (Stripe Checkout): a booking can hold its court while the customer pays.
ALTER TYPE "BookingStatus" ADD VALUE 'PENDING';
ALTER TYPE "BookingStatus" ADD VALUE 'EXPIRED';

CREATE TYPE "PaymentStatus" AS ENUM ('AT_VENUE', 'UNPAID', 'PAID', 'REFUNDED');

ALTER TABLE "bookings"
  ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'AT_VENUE',
  ADD COLUMN "holdExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "checkoutSessionId" TEXT,
  ADD COLUMN "checkoutUrl" TEXT,
  ADD COLUMN "paymentIntentId" TEXT,
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "refundedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "bookings_checkoutSessionId_key" ON "bookings"("checkoutSessionId");
