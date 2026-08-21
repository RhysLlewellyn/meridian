/**
 * Cancellation, against the real database — because the thing worth proving is
 * that the time comes back, and the time coming back is a property of the
 * partial index rather than of this function.
 */

import {eq} from 'drizzle-orm'
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'

import {connect} from '../db/client.ts'
import {probeDatabase, skipWithoutDatabase, testDatabaseUrl} from '../db/testing.ts'
import {
  auditLog,
  booking,
  client as clientTable,
  practitioner,
  service,
} from '../db/schema.ts'
import {cancelBooking} from './cancel.ts'
import {createBooking} from './create.ts'

/**
 * Nothing in this file can run without Postgres, and none of it can be
 * mocked into running without one. If there is no database here the tests
 * are skipped loudly rather than failed — except on CI, where an
 * unreachable database is a broken pipeline.
 */
const skip = skipWithoutDatabase('src/booking/cancel.test.ts', await probeDatabase())

const {db, sql} = connect(testDatabaseUrl(), {max: 2})

const suffix = `c${process.pid.toString(36)}`
const SLOT = new Date('2027-04-14T10:00:00.000Z')
const DURATION = 45
/** Before the slot, so nothing under test is accidentally in the past. */
const NOW = new Date('2027-04-01T09:00:00.000Z')

let practitionerId: string
let serviceId: string
let clientId: string

beforeAll(async () => {
  if (skip) return
  const [p] = await db
    .insert(practitioner)
    .values({
      slug: `cancel-${suffix}`,
      name: 'Cancel Fixture',
      title: 'Fixture',
      bio: 'Created by the cancellation test.',
    })
    .returning()
  practitionerId = p.id

  const [s] = await db
    .insert(service)
    .values({
      slug: `cancel-service-${suffix}`,
      name: 'Cancel fixture service',
      specialty: 'Treatment',
      description: 'Created by the cancellation test.',
      defaultDurationMinutes: DURATION,
      pricePence: 1_000,
    })
    .returning()
  serviceId = s.id

  const [c] = await db
    .insert(clientTable)
    .values({name: 'Cancel Fixture', email: `cancel.${suffix}@example.com`})
    .returning()
  clientId = c.id
})

afterAll(async () => {
  if (skip) return
  await db.delete(booking).where(eq(booking.serviceId, serviceId))
  await db.delete(service).where(eq(service.id, serviceId))
  await db.delete(practitioner).where(eq(practitioner.id, practitionerId))
  await db.delete(clientTable).where(eq(clientTable.id, clientId))
  await sql.end()
})

beforeEach(async () => {
  if (skip) return
  await db.delete(booking).where(eq(booking.serviceId, serviceId))
})

async function book(startsAt: Date = SLOT) {
  const result = await createBooking(db, {
    practitionerId,
    serviceId,
    clientId,
    startsAt,
    durationMinutes: DURATION,
  })
  if (!result.ok) throw new Error('fixture booking was refused')
  return result.booking
}

describe.skipIf(skip)('cancelBooking', () => {
  it('frees the time for somebody else without deleting the row', async () => {
    const original = await book()

    const cancelled = await cancelBooking(db, original.reference, 'Client unwell', NOW)
    expect(cancelled.ok).toBe(true)

    // The slot is bookable again, which is the partial index doing the work.
    const rebooked = await createBooking(db, {
      practitionerId,
      serviceId,
      clientId,
      startsAt: SLOT,
      durationMinutes: DURATION,
    })
    expect(rebooked.ok).toBe(true)

    // And the cancelled appointment is still on file, with its reason.
    const [row] = await db.select().from(booking).where(eq(booking.id, original.id))
    expect(row.status).toBe('cancelled')
    expect(row.cancellationReason).toBe('Client unwell')
  })

  it('records who did what in the audit log', async () => {
    const original = await book()
    await cancelBooking(db, original.reference, 'Double booked myself', NOW)

    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.bookingId, original.id))

    expect(entries.map((e) => e.action).sort()).toEqual(['cancelled', 'created'])
    expect(entries.find((e) => e.action === 'cancelled')?.detail).toEqual({
      reason: 'Double booked myself',
    })
  })

  it('requires a reason', async () => {
    const original = await book()

    expect(await cancelBooking(db, original.reference, '', NOW)).toEqual({
      ok: false,
      reason: 'no_reason',
    })
    expect(await cancelBooking(db, original.reference, '   ', NOW)).toEqual({
      ok: false,
      reason: 'no_reason',
    })

    const [row] = await db.select().from(booking).where(eq(booking.id, original.id))
    expect(row.status).toBe('confirmed')
  })

  it('refuses to cancel the same appointment twice', async () => {
    const original = await book()
    expect((await cancelBooking(db, original.reference, 'Unwell', NOW)).ok).toBe(true)

    // The second attempt writes nothing, so the audit log does not grow a
    // second cancellation for one appointment.
    expect(await cancelBooking(db, original.reference, 'Unwell again', NOW)).toEqual({
      ok: false,
      reason: 'already_cancelled',
    })

    const entries = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.bookingId, original.id))
    expect(entries.filter((e) => e.action === 'cancelled')).toHaveLength(1)
  })

  it('refuses to cancel an appointment that has already started', async () => {
    const original = await book()

    // An hour after it began. Releasing the time would be a lie — nobody can
    // take a slot in the past.
    const after = new Date(SLOT.getTime() + 60 * 60_000)
    expect(await cancelBooking(db, original.reference, 'Forgot to go', after)).toEqual({
      ok: false,
      reason: 'already_started',
    })
  })

  it('reports an unknown reference rather than throwing', async () => {
    expect(await cancelBooking(db, 'MRD-ZZZZ', 'Whatever', NOW)).toEqual({
      ok: false,
      reason: 'not_found',
    })
  })
})
