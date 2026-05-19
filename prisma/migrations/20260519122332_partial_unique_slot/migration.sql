CREATE UNIQUE INDEX "Booking_slotAt_active_unique"
  ON "Booking" ("slotAt")
  WHERE status IN ('PENDING', 'CONFIRMED');
