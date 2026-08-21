-- The real specialties, replacing the placeholder 0002 had to use.
--
-- 0002 added a NOT NULL column to a table that already had rows in it, which
-- means every existing service was backfilled to one value in order to satisfy
-- the constraint. That is correct for the schema and wrong for three of the
-- five rows, and the seed cannot be relied on to fix it: `npm run seed`
-- rebuilds the appointments as well, which is not something to run against a
-- deployed database to correct one column.
--
-- Keyed on slug rather than on id, because the ids are generated per database
-- and the slugs are the stable name the URLs already use. A service that is
-- not one of these five is left alone.
UPDATE "service" SET "specialty" = v.specialty
FROM (VALUES
  ('initial-assessment', 'Assessment'),
  ('follow-up', 'Treatment'),
  ('extended-treatment', 'Treatment'),
  ('rehab-review', 'Rehabilitation'),
  ('gait-analysis', 'Biomechanics')
) AS v(slug, specialty)
WHERE "service"."slug" = v.slug;
