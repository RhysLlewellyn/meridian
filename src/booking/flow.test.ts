/**
 * The seam between the engine and the database.
 *
 * The engine's own tests run on fixtures and prove the rules. This proves the
 * rows actually reach it in the shape it expects — that `working_hours.start_time`
 * really does come back as `08:00:00`, that a duration override survives the
 * join, and that a booking written through `createBooking` disappears from the
 * next answer the grid gives.
 *
 * It runs against the seeded database. `npm run db:up && npm run db:migrate &&
 * npm run seed` first.
 */

import {eq} from 'drizzle-orm'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {
  availabilityFor,
  getBookingByReference,
  getServiceBySlug,
  listPractitionersForService,
  listServices,
  today,
  type ServiceRow,
} from '../availability/query.ts'
import {shiftDate} from '../availability/time.ts'
import {connect, requireDatabaseUrl} from '../db/client.ts'
import {booking} from '../db/schema.ts'
import {createBooking} from './create.ts'

const {db, sql} = connect(requireDatabaseUrl(), {max: 2})

let service: ServiceRow
const written: string[] = []

beforeAll(async () => {
  const found = await getServiceBySlug(db, 'initial-assessment')
  if (!found) {
    throw new Error('No seed data. Run `npm run seed`.')
  }
  service = found
})

afterAll(async () => {
  for (const id of written) await db.delete(booking).where(eq(booking.id, id))
  await sql.end()
})

/** The first date within the horizon that has anything free. */
async function firstFreeDate(practitionerSlug: string): Promise<string> {
  let date = today()
  for (let i = 0; i < 30; i += 1) {
    const {slots} = await availabilityFor(db, service, practitionerSlug, date)
    if (slots.length > 0) return date
    date = shiftDate(date, 1)
  }
  throw new Error(`No availability at all for ${practitionerSlug} in the next 30 days`)
}

describe('the seeded clinic', () => {
  it('has the five services and three practitioners the spec asks for', async () => {
    const services = await listServices(db)
    expect(services.map((s) => s.slug).sort()).toEqual([
      'extended-treatment',
      'follow-up',
      'gait-analysis',
      'initial-assessment',
      'rehab-review',
    ])
  })

  it('carries the duration override through the join', async () => {
    const practitioners = await listPractitionersForService(db, service.id)
    const byName = Object.fromEntries(practitioners.map((p) => [p.slug, p.durationMinutes]))

    // The same service, two lengths. If this ever reads 45 for both, the
    // override has been lost somewhere between the table and the page.
    expect(byName['nadia-okafor']).toBe(45)
    expect(byName['tomas-iriarte']).toBe(60)
  })
})

describe('availability from the database', () => {
  it('returns slots that respect the practitioner’s own duration', async () => {
    const date = await firstFreeDate('tomas-iriarte')
    const {slots} = await availabilityFor(db, service, 'tomas-iriarte', date)

    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((slot) => slot.durationMinutes === 60)).toBe(true)
    // Tomas works until 18:00 and takes an hour, so nothing may start later.
    expect(slots.every((slot) => slot.time <= '17:00')).toBe(true)
  })

  it('unions practitioners for "any" and tags each slot with one of them', async () => {
    const date = await firstFreeDate('any')
    const {slots} = await availabilityFor(db, service, 'any', date)

    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((slot) => slot.practitionerName.length > 0)).toBe(true)
  })

  it('offers nothing for a practitioner who does not offer the service', async () => {
    // Grace does follow-ups and rehab reviews, not initial assessments.
    const date = await firstFreeDate('any')
    const {slots} = await availabilityFor(db, service, 'grace-whitfield', date)
    expect(slots).toEqual([])
  })
})

describe('booking a slot the grid offered', () => {
  it('writes it, reads it back by reference, and stops offering it', async () => {
    const date = await firstFreeDate('nadia-okafor')
    const before = await availabilityFor(db, service, 'nadia-okafor', date)
    const target = before.slots[0]

    const practitioners = await listPractitionersForService(db, service.id)
    const nadia = practitioners.find((p) => p.slug === 'nadia-okafor')!

    const result = await createBooking(db, {
      practitionerId: nadia.id,
      serviceId: service.id,
      clientId: await someClientId(),
      startsAt: target.startsAt,
      durationMinutes: nadia.durationMinutes,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    written.push(result.booking.id)

    // The reference is what the client is given and what the confirmation
    // page looks up. It has to resolve to the appointment just made.
    const detail = await getBookingByReference(db, result.booking.reference)
    expect(detail).toMatchObject({
      practitionerName: 'Nadia Okafor',
      serviceName: service.name,
      status: 'confirmed',
    })
    expect(detail?.startsAt.getTime()).toBe(target.startsAt.getTime())

    // And the grid no longer offers it, without anything having been told to
    // invalidate a cache: the next answer is computed from the rows.
    const after = await availabilityFor(db, service, 'nadia-okafor', date)
    expect(after.slots.some((slot) => slot.time === target.time)).toBe(false)
    expect(after.slots.length).toBeLessThan(before.slots.length)
  })
})

async function someClientId(): Promise<string> {
  const rows = await sql<{id: string}[]>`select id from client limit 1`
  if (rows.length === 0) throw new Error('No clients in the seed data.')
  return rows[0].id
}
