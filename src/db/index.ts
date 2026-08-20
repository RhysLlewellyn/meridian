import {connect} from './client.ts'

/**
 * The application's connection, made once and made late.
 *
 * Late matters. Connecting at module scope means importing a page connects to
 * Postgres, and `next build` imports every page to collect its metadata — so a
 * build with no database in reach fails before it renders anything, including
 * the pages that never touch one. Deploying an empty shell first is the whole
 * point of having the URL exist from the start, and that is impossible if the
 * build needs a database to produce it.
 *
 * Once matters too. Next reloads modules freely in development, and a fresh
 * pool per reload exhausts Postgres' connection limit within a few edits.
 * Hanging it off globalThis is the usual, ugly, correct answer.
 */
const globalForDb = globalThis as {meridian?: ReturnType<typeof connect>}

export function getDb() {
  return (globalForDb.meridian ??= connect(process.env.DATABASE_URL, {max: 5})).db
}
