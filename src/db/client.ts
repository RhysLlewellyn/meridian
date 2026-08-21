import {drizzle} from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema.ts'

/**
 * One connection factory, used by the seed and by the tests.
 *
 * `postgres-js` pipelines statements on a single connection by default, which
 * is wrong for the concurrency test: simultaneous booking attempts have to be
 * simultaneous, on separate connections, or the thing the test claims to prove
 * is proved by the driver serialising them instead of by Postgres. Callers
 * that need real concurrency pass a pool size and get one.
 */
export function connect(
  url: string = requireDatabaseUrl(),
  options: {max?: number; connectTimeoutSeconds?: number} = {},
) {
  const sql = postgres(url, {
    max: options.max ?? 1,
    // Left to the driver's default (no timeout) unless a caller asks. The one
    // that asks is the test probe, which needs "is there a database here?" to
    // be answered in seconds rather than waited on.
    connect_timeout: options.connectTimeoutSeconds,
    onnotice: () => {},
  })
  return {sql, db: drizzle(sql, {schema})}
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env, then `npm run db:up`.',
    )
  }
  return url
}

export {schema}
