-- The concurrency guarantee.
--
-- Two requests can both pass an application-level "is this slot free?" check
-- before either of them inserts. No arrangement of application code closes
-- that window without serialising every booking through a lock, so the
-- guarantee lives in the database, where the write itself is the check.
--
-- btree_gist is what lets a gist index mix an equality column
-- (practitioner_id) with a range column (during) in one constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- Two confirmed bookings may not overlap for the same practitioner.
--
-- `during` is generated as tstzrange(starts_at, ends_at, '[)') -- half open,
-- so 10:00-11:00 and 11:00-12:00 abut rather than collide.
--
-- The WHERE clause is what makes cancellation free the slot: a cancelled row
-- leaves the index entirely, so the time becomes bookable again and no
-- history is deleted to do it.
--
-- A violation raises SQLSTATE 23P01 (exclusion_violation), which the
-- application catches and turns into "that slot has just gone" rather than a
-- 500.
ALTER TABLE "booking"
  ADD CONSTRAINT "booking_no_overlap"
  EXCLUDE USING gist (
    "practitioner_id" WITH =,
    "during" WITH &&
  ) WHERE ("status" = 'confirmed');
--> statement-breakpoint
-- Time off is not a booking, but the engine treats it identically, and the
-- same argument applies to entering it: two overlapping holidays for one
-- practitioner is a data error rather than a scheduling one.
ALTER TABLE "time_off"
  ADD CONSTRAINT "time_off_no_overlap"
  EXCLUDE USING gist (
    "practitioner_id" WITH =,
    "during" WITH &&
  );
