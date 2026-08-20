import {connect} from './client.ts'

/**
 * The application's connection, made once.
 *
 * Next reloads modules freely in development, and a fresh pool per reload
 * exhausts Postgres' connection limit within a few edits. Hanging it off
 * globalThis is the usual, ugly, correct answer.
 */
const globalForDb = globalThis as {meridian?: ReturnType<typeof connect>}

const connection = (globalForDb.meridian ??= connect(process.env.DATABASE_URL, {max: 5}))

export const {db, sql} = connection
