/**
 * The concurrency test.
 *
 * This runs against a real Postgres — `npm run db:up && npm run db:migrate`
 * first. It has to. The guarantee under test is `booking_no_overlap`, an
 * exclusion constraint that lives in the database, so a mocked version of this
 * test would be asserting that a stub returns what the stub was told to
 * return. It would pass against a schema with no constraint on it at all,
 * which is precisely the bug it claims to rule out.
 *
 * What is being proved: when N requests try to book the same practitioner at
 * the same time at the same instant, exactly one of them gets the appointment.
 * Not "usually one". Not "one, as long as the check runs inside a transaction".
 * One, because the second write is refused by the index that the first write
 * created an entry in.
 */

import {and, eq, sql as raw} from 'drizzle-orm'
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'

import {connect, requireDatabaseUrl} from '../db/client.ts'
import {
  auditLog,
  booking,
  client as clientTable,
  practitioner,
  service,
  timeOff,
} from '../db/schema.ts'
import {
  createBooking,
  generateReference,
  isConcurrencyConflict,
  isSlotTaken,
} from './create.ts'

/**
 * Eight simultaneous attempts. Enough that a lock held for the length of one
 * statement would show up as more than one winner if the guarantee were not
 * doing the work, and few enough to stay quick.
 */
const ATTEMPTS = 8

/** Far enough out that nothing the seed created can be in the way. */
const SLOT = new Date('2027-03-10T10:00:00.000Z')
const DURATION = 60

const suffix = process.pid.toString(36)
const PRACTITIONER_SLUG = `test-practitioner-${suffix}`
const OTHER_SLUG = `test-practitioner-other-${suffix}`
const SERVICE_SLUG = `test-service-${suffix}`

const pool = connect(requireDatabaseUrl(), {max: ATTEMPTS + 2})
const {db, sql} = pool

let practitionerId: string
let otherPractitionerId: string
let serviceId: string
let clientIds: string[]

beforeAll(async () => {
  // Fail loudly rather than passing vacuously. A green concurrency test
  // against a database with no constraint on it is worse than no test.
  const [{exists}] = await sql<{exists: boolean}[]>`
    select exists (
      select 1 from pg_constraint
      where conname = 'booking_no_overlap' and contype = 'x'
    ) as exists
  `
  if (!exists) {
    throw new Error(
      'booking_no_overlap is missing. Run `npm run db:up && npm run db:migrate`.',
    )
  }

  const [main, other] = await db
    .insert(practitioner)
    .values([
      {
        slug: PRACTITIONER_SLUG,
        name: 'Test Practitioner',
        title: 'Fixture',
        bio: 'Created by the concurrency test.',
      },
      {
        slug: OTHER_SLUG,
        name: 'Other Test Practitioner',
        title: 'Fixture',
        bio: 'Created by the concurrency test.',
      },
    ])
    .returning()
  practitionerId = main.id
  otherPractitionerId = other.id

  const [svc] = await db
    .insert(service)
    .values({
      slug: SERVICE_SLUG,
      name: 'Test service',
      description: 'Created by the concurrency test.',
      defaultDurationMinutes: DURATION,
      pricePence: 1_000,
    })
    .returning()
  serviceId = svc.id

  const inserted = await db
    .insert(clientTable)
    .values(
      Array.from({length: ATTEMPTS}, (_, i) => ({
        name: `Test Client ${i}`,
        email: `test.client.${i}.${suffix}@example.com`,
      })),
    )
    .returning()
  clientIds = inserted.map((c) => c.id)
})

afterAll(async () => {
  // Bookings first: they reference the practitioner without a cascade, which
  // is deliberate in the schema — an appointment must not disappear because
  // somebody removed a practitioner row.
  await db.delete(booking).where(eq(booking.serviceId, serviceId))
  await db.delete(timeOff).where(eq(timeOff.practitionerId, practitionerId))
  await db.delete(service).where(eq(service.id, serviceId))
  await db.delete(practitioner).where(eq(practitioner.slug, PRACTITIONER_SLUG))
  await db.delete(practitioner).where(eq(practitioner.slug, OTHER_SLUG))
  for (const id of clientIds) await db.delete(clientTable).where(eq(clientTable.id, id))
  await sql.end()
})

beforeEach(async () => {
  await db.delete(booking).where(eq(booking.serviceId, serviceId))
  await db.delete(timeOff).where(eq(timeOff.practitionerId, practitionerId))
})

async function confirmedCount(): Promise<number> {
  const rows = await db
    .select({count: raw<number>`count(*)::int`})
    .from(booking)
    .where(and(eq(booking.serviceId, serviceId), eq(booking.status, 'confirmed')))
  return rows[0].count
}

describe('booking_no_overlap', () => {
  it('lets exactly one of eight simultaneous attempts take the slot', async () => {
    const results = await Promise.all(
      clientIds.map((clientId) =>
        createBooking(db, {
          practitionerId,
          serviceId,
          clientId,
          startsAt: SLOT,
          durationMinutes: DURATION,
        }),
      ),
    )

    const won = results.filter((r) => r.ok)
    const lost = results.filter((r) => !r.ok)

    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(ATTEMPTS - 1)
    // The losers get an answer, not a stack trace.
    expect(lost.every((r) => !r.ok && r.reason === 'slot_taken')).toBe(true)

    // And the database agrees with the answers it gave out.
    expect(await confirmedCount()).toBe(1)

    // One booking, one audit row. The transaction either wrote both or
    // neither; seven aborted transactions left nothing behind.
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.bookingId, won[0].ok ? won[0].booking.id : ''))
    expect(audit).toHaveLength(1)
  })

  it('refuses the second write even when the application never checks', async () => {
    // The same race with createBooking taken out of it: eight raw inserts, no
    // read of any kind beforehand, each in its own transaction on its own
    // connection. If the guarantee lived in application code this would put
    // eight overlapping appointments in the table.
    //
    // The losers come back as either 23P01 or 40P01. Postgres sometimes
    // resolves a pile-up of speculative insertions as a deadlock and shoots
    // one of the waiters instead of rejecting it cleanly, which is why
    // createBooking retries on 40P01 rather than assuming 23P01 is the only
    // way to lose. The count in the table is one either way, which is the
    // part that matters.
    const outcomes = await Promise.allSettled(
      Array.from({length: ATTEMPTS}, (_, i) =>
        sql.begin(
          (tx) => tx`
            insert into booking (reference, practitioner_id, service_id, client_id,
                                 starts_at, ends_at, status)
            values (${generateReference()}, ${practitionerId}, ${serviceId},
                    ${clientIds[i]}, ${SLOT.toISOString()},
                    ${new Date(SLOT.getTime() + DURATION * 60_000).toISOString()},
                    'confirmed')
          `,
        ),
      ),
    )

    const rejected = outcomes.filter((o) => o.status === 'rejected')
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect(rejected).toHaveLength(ATTEMPTS - 1)
    expect(rejected.every((o) => isConcurrencyConflict(o.reason))).toBe(true)
    expect(await confirmedCount()).toBe(1)
  })

  it('allows two appointments that abut exactly', async () => {
    // `during` is a half-open tstzrange. 10:00–11:00 and 11:00–12:00 touch
    // without overlapping, and with an inclusive upper bound they would not.
    const first = await createBooking(db, {
      practitionerId,
      serviceId,
      clientId: clientIds[0],
      startsAt: SLOT,
      durationMinutes: DURATION,
    })
    const second = await createBooking(db, {
      practitionerId,
      serviceId,
      clientId: clientIds[1],
      startsAt: new Date(SLOT.getTime() + DURATION * 60_000),
      durationMinutes: DURATION,
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(await confirmedCount()).toBe(2)
  })

  it('does not treat the same instant with a different practitioner as a clash', async () => {
    // The constraint is scoped by practitioner_id. A clinic with three rooms
    // running at once is the normal case, not a conflict.
    const results = await Promise.all([
      createBooking(db, {
        practitionerId,
        serviceId,
        clientId: clientIds[0],
        startsAt: SLOT,
        durationMinutes: DURATION,
      }),
      createBooking(db, {
        practitionerId: otherPractitionerId,
        serviceId,
        clientId: clientIds[1],
        startsAt: SLOT,
        durationMinutes: DURATION,
      }),
    ])

    expect(results.every((r) => r.ok)).toBe(true)
    expect(await confirmedCount()).toBe(2)
  })

  it('frees the slot on cancellation without deleting the history', async () => {
    const first = await createBooking(db, {
      practitionerId,
      serviceId,
      clientId: clientIds[0],
      startsAt: SLOT,
      durationMinutes: DURATION,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const blocked = await createBooking(db, {
      practitionerId,
      serviceId,
      clientId: clientIds[1],
      startsAt: SLOT,
      durationMinutes: DURATION,
    })
    expect(blocked).toEqual({ok: false, reason: 'slot_taken'})

    await db
      .update(booking)
      .set({status: 'cancelled', cancellationReason: 'Client unwell'})
      .where(eq(booking.id, first.booking.id))

    // The partial index only carries confirmed rows, so the cancelled one
    // leaves it and the time becomes bookable again. Nothing was deleted:
    // both rows are still there, and the clinic can still answer "who
    // cancelled this?".
    const rebooked = await createBooking(db, {
      practitionerId,
      serviceId,
      clientId: clientIds[1],
      startsAt: SLOT,
      durationMinutes: DURATION,
    })

    expect(rebooked.ok).toBe(true)
    expect(await confirmedCount()).toBe(1)

    const all = await db.select().from(booking).where(eq(booking.serviceId, serviceId))
    expect(all).toHaveLength(2)
  })
})

describe('time_off_no_overlap', () => {
  it('refuses two overlapping blocks for one practitioner', async () => {
    await db.insert(timeOff).values({
      practitionerId,
      startsAt: SLOT,
      endsAt: new Date(SLOT.getTime() + 60 * 60_000),
      reason: 'Lunch',
    })

    // Overlapping leave for one person is a data error rather than a
    // scheduling one, and it is caught by the same mechanism.
    await expect(
      db.insert(timeOff).values({
        practitionerId,
        startsAt: new Date(SLOT.getTime() + 30 * 60_000),
        endsAt: new Date(SLOT.getTime() + 90 * 60_000),
        reason: 'Also lunch',
      }),
    ).rejects.toSatisfy(isSlotTaken)
  })
})
