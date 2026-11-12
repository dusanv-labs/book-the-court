-- A booking waiting for online payment holds its court too, so nobody else can take the time
-- while the customer is paying. (Separate migration: new enum values can be used only after the
-- migration that added them has been committed.)
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_no_overlap";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist ("courtId" WITH =, tstzrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("status" IN ('CONFIRMED', 'PENDING'));
