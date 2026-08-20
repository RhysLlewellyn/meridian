/**
 * Cancelling.
 *
 * A status change, not a delete. The exclusion constraint only indexes rows
 * where `status = 'confirmed'`, so flipping the status is what frees the time
 * — and it frees it immediately, for everyone, without anything having to
 * invalidate a cache. The row stays, which is the difference between a clinic
 * that can answer "who cancelled this, and when?" and one that cannot.
 */

import {and, eq} from 'drizzle-orm'

import {auditLog, booking, type Booking} from '../db/schema.ts'
import type {Database} from './create.ts'

export type CancelResult =
  | {ok: true; booking: Booking}
  | {ok: false; reason: 'not_found' | 'already_cancelled' | 'already_started' | 'no_reason'}

/** Long enough to be a reason rather than a keystroke. */
const MIN_REASON_LENGTH = 3

export async function cancelBooking(
  db: Database,
  reference: string,
  reason: string,
  now: Date = new Date(),
): Promise<CancelResult> {
  const trimmed = reason.trim()
  if (trimmed.length < MIN_REASON_LENGTH) return {ok: false, reason: 'no_reason'}

  const [existing] = await db
    .select()
    .from(booking)
    .where(eq(booking.reference, reference))
    .limit(1)

  if (!existing) return {ok: false, reason: 'not_found'}
  if (existing.status === 'cancelled') return {ok: false, reason: 'already_cancelled'}

  // An appointment that has already started cannot be un-had. Releasing the
  // time would also be a lie: nobody else can take a slot in the past.
  if (existing.startsAt <= now) return {ok: false, reason: 'already_started'}

  return db.transaction(async (tx) => {
    // The status is part of the WHERE clause, not just the SET. Two people
    // cancelling the same appointment at once is far more likely than two
    // booking it, and this makes the second one a no-op rather than a second
    // audit entry saying it was cancelled twice.
    const [updated] = await tx
      .update(booking)
      .set({status: 'cancelled', cancellationReason: trimmed})
      .where(and(eq(booking.id, existing.id), eq(booking.status, 'confirmed')))
      .returning()

    if (!updated) return {ok: false, reason: 'already_cancelled'} as const

    await tx.insert(auditLog).values({
      bookingId: updated.id,
      action: 'cancelled',
      detail: {reason: trimmed},
    })

    return {ok: true, booking: updated} as const
  })
}
