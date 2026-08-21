-- The clinical area a service belongs to, shown as a kicker above its name.
--
-- Added NOT NULL to a table that already has rows in it, so it arrives with a
-- default and then loses it: the five existing services are backfilled to the
-- commonest value in one statement, the seed corrects them to their real ones,
-- and no later insert is allowed to omit it.
ALTER TABLE "service" ADD COLUMN "specialty" text NOT NULL DEFAULT 'Treatment';--> statement-breakpoint
ALTER TABLE "service" ALTER COLUMN "specialty" DROP DEFAULT;
