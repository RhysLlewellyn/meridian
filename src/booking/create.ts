/**
 * Creating a booking.
 *
 * There is no "is this slot still free?" check in here, and that is the point.
 * Two requests can both pass such a check before either of them inserts, and
 * no arrangement of application code closes that window — the gap between
 * reading and writing is where the double booking lives. The check is the
 * write: `booking_no_overlap` is an exclusion constraint over
 * `(practitioner_id, during)` for confirmed rows, so Postgres refuses the
 * second insert with SQLSTATE 23P01 and this function turns that into a clean
 * "that slot has just gone" rather than a 500.
 *
 * The availability engine still exists to decide what to *offer*. It is not
 * what makes the offer safe.
 */

import type {PostgresJsDatabase} from 'drizzle-orm/postgres-js'
import {randomInt} from 'node:crypto'

import {addMinutes} from '../availability/time.ts'
import * as schema from '../db/schema.ts'
import {auditLog, booking, type Booking} from '../db/schema.ts'

/** Postgres `exclusion_violation`. */
export const EXCLUSION_VIOLATION = '23P01'

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505'

/**
 * Postgres `deadlock_detected`.
 *
 * Not a hypothetical. Fire eight inserts at one slot at once and Postgres will
 * sometimes resolve the pile-up as a deadlock rather than as a clean
 * exclusion violation: each transaction is waiting on another's speculative
 * insertion, and one of them has to be shot. The row still never double-books
 * — but the loser gets 40P01 instead of 23P01, and a write path that only
 * knows about 23P01 turns that into a 500 under exactly the load it was
 * written for.
 *
 * The answer is to retry rather than to guess. On the retry the winner has
 * committed, so the conflict is an ordinary 23P01 and the client is told the
 * slot has gone.
 */
const DEADLOCK_DETECTED = '40P01'

/**
 * No I, O, 0 or 1. This gets written on a card by hand and read back down a
 * telephone by somebody who did not write it.
 */
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * Attempts, covering both retryable cases: a reference collision (draw
 * another) and a deadlock (wait a moment and go again). 32^4 is about a
 * million references, which is ample for a clinic and short enough to read
 * aloud; collisions are handled rather than designed out, because the unique
 * index is the authority either way.
 */
const MAX_ATTEMPTS = 6

export type CreateBookingInput = {
  practitionerId: string
  serviceId: string
  clientId: string
  startsAt: Date
  /** The practitioner's duration for this service, not the service default. */
  durationMinutes: number
}

export type CreateBookingResult =
  | {ok: true; booking: Booking}
  | {ok: false; reason: 'slot_taken'}

export type Database = PostgresJsDatabase<typeof schema>

export function generateReference(): string {
  let out = ''
  for (let i = 0; i < 4; i += 1) {
    out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]
  }
  return `MRD-${out}`
}

/**
 * The driver's error, dug out of whatever wrapped it.
 *
 * Drizzle raises a `DrizzleQueryError` with the `PostgresError` as its
 * `cause`, so reading `.code` off the thrown object finds nothing and the
 * SQLSTATE check silently never matches — which turns a handled "that slot has
 * just gone" into an unhandled 500 in exactly the case this file exists for.
 * Walking the chain is the difference between the guarantee being usable and
 * merely being present.
 */
function driverError(error: unknown): {code?: string; constraint_name?: string} | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined
    if (typeof (current as {code?: unknown}).code === 'string') {
      return current as {code?: string; constraint_name?: string}
    }
    current = (current as {cause?: unknown}).cause
  }
  return undefined
}

/** True for the exclusion violation raised by `booking_no_overlap`. */
export function isSlotTaken(error: unknown): boolean {
  return driverError(error)?.code === EXCLUSION_VIOLATION
}

/**
 * True for either way Postgres can refuse a concurrent write at the same slot.
 * Both mean the same thing to a client — somebody else got there — and neither
 * ever leaves two confirmed appointments in the table.
 */
export function isConcurrencyConflict(error: unknown): boolean {
  const code = driverError(error)?.code
  return code === EXCLUSION_VIOLATION || code === DEADLOCK_DETECTED
}

export async function createBooking(
  db: Database,
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const endsAt = addMinutes(input.startsAt, input.durationMinutes)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const reference = generateReference()
    try {
      // The audit row goes in with the booking or not at all. A confirmed
      // appointment with no record of who made it is the thing the table
      // exists to prevent.
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(booking)
          .values({
            reference,
            practitionerId: input.practitionerId,
            serviceId: input.serviceId,
            clientId: input.clientId,
            startsAt: input.startsAt,
            endsAt,
            status: 'confirmed' as const,
          })
          .returning()

        await tx.insert(auditLog).values({
          bookingId: row.id,
          action: 'created',
          detail: {durationMinutes: input.durationMinutes},
        })

        return {ok: true, booking: row} as const
      })
    } catch (error) {
      // The slot went while this request was in flight. Not an error: an
      // answer, and the caller puts the client back on the grid without it.
      if (isSlotTaken(error)) return {ok: false, reason: 'slot_taken'}

      const driver = driverError(error)

      // The transaction was chosen as the deadlock victim. Nothing was
      // written; go again, and let the next attempt find out whether the slot
      // is genuinely gone.
      if (driver?.code === DEADLOCK_DETECTED) {
        await new Promise((resolve) => setTimeout(resolve, 5 + randomInt(20)))
        continue
      }

      // A reference collision is not a scheduling problem. Draw another.
      if (
        driver?.code === UNIQUE_VIOLATION &&
        driver.constraint_name === 'booking_reference_key'
      ) {
        continue
      }

      throw error
    }
  }

  throw new Error(`Could not write the booking in ${MAX_ATTEMPTS} attempts`)
}
