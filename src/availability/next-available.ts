/**
 * "Next available" for the practitioner directory.
 *
 * The directory could be a static list of three names and a paragraph each.
 * Making each card say when that person can actually be seen is what turns it
 * into a view of the system rather than a description of it — and it is the
 * same engine the booking flow runs, not a second opinion about availability
 * that could drift from the first.
 *
 * Two things make it cheap enough to put on the homepage:
 *
 *   1. **One read, then arithmetic.** The engine is a pure function over a
 *      bundle of rows, so a fortnight of rota, bookings and leave is fetched
 *      once and then replayed against it day by day in memory. Three
 *      practitioners over fourteen days is forty-two engine runs on arrays of
 *      a few dozen items, which costs less than the round trip that fetched
 *      them. The naive version — one query per practitioner per day — is
 *      forty-two round trips and would be visible on the page.
 *
 *   2. **Cached, and invalidated by the thing that changes it.** The answer is
 *      only allowed to be a minute stale, and booking or cancelling drops it
 *      immediately via the `availability` tag. A hint that is briefly behind
 *      is fine; one that contradicts the grid a click later is not.
 *
 * The service used per practitioner is their shortest, which is the honest
 * reading of "next available": the earliest moment they could see anybody. A
 * longer appointment may well not fit there, and the card does not claim it
 * does — it links into the flow, where the real grid answers for the service
 * actually wanted.
 */

import {and, eq, gte, lt} from 'drizzle-orm'
import {unstable_cache} from 'next/cache'

import type {Database} from '../booking/create.ts'
import {
  booking,
  practitioner,
  practitionerService,
  service,
  timeOff,
  workingHours,
} from '../db/schema.ts'
import {getDb} from '../db/index.ts'
import {getAvailability, type AvailabilityData} from './engine.ts'
import {
  addDays,
  addCalendarDays,
  calendarDateAt,
  formatCalendarDate,
  instantFromWallClock,
} from './time.ts'

/**
 * How far ahead the directory looks.
 *
 * Not the booking horizon. Sixty days of "next available" would be a promise
 * about a diary nobody has written yet, and a card reading "next available:
 * 14 October" is a card saying don't bother. Fourteen days, then it says so.
 */
export const NEXT_AVAILABLE_DAYS = 14

/** The cache tag that booking and cancelling invalidate. */
export const AVAILABILITY_TAG = 'availability'

export type NextAvailable = {
  /** `2026-08-24`, in the clinic's timezone. */
  date: string
  /** `09:15`. */
  time: string
  /** The service the slot was found for — their shortest. */
  serviceSlug: string
}

/**
 * Next available per practitioner id, cached for a minute.
 *
 * `now` is not a parameter. It cannot be: a cache keyed on the current instant
 * would never hit, and one that ignored a passed-in instant would lie to the
 * caller that supplied it. The uncached function underneath takes it, and the
 * tests use that.
 */
export const nextAvailableByPractitioner = unstable_cache(
  async (): Promise<Record<string, NextAvailable>> => {
    const found = await computeNextAvailable(getDb(), new Date())
    return Object.fromEntries(found)
  },
  ['next-available'],
  {revalidate: 60, tags: [AVAILABILITY_TAG]},
)

export async function computeNextAvailable(
  db: Database,
  now: Date,
): Promise<Map<string, NextAvailable>> {
  const from = calendarDateAt(now)
  const windowStart = addDays(instantFromWallClock(from, {hour: 0, minute: 0, second: 0}), -1)
  const windowEnd = addDays(windowStart, NEXT_AVAILABLE_DAYS + 2)

  const [practitionerRows, offerings, serviceRows, hours, bookings, off] = await Promise.all([
    db.select().from(practitioner).where(eq(practitioner.active, true)),
    db.select().from(practitionerService),
    db.select().from(service).where(eq(service.active, true)),
    db.select().from(workingHours),
    db
      .select({
        practitionerId: booking.practitionerId,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        status: booking.status,
      })
      .from(booking)
      .where(and(gte(booking.startsAt, windowStart), lt(booking.startsAt, windowEnd))),
    db
      .select({
        practitionerId: timeOff.practitionerId,
        startsAt: timeOff.startsAt,
        endsAt: timeOff.endsAt,
      })
      .from(timeOff)
      .where(and(gte(timeOff.startsAt, windowStart), lt(timeOff.startsAt, windowEnd))),
  ])

  const serviceById = new Map(serviceRows.map((row) => [row.id, row]))
  const enginePractitioners = practitionerRows.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
  }))

  const result = new Map<string, NextAvailable>()

  for (const person of practitionerRows) {
    const theirs = offerings
      .filter((row) => row.practitionerId === person.id && serviceById.has(row.serviceId))
      .map((row) => {
        const offered = serviceById.get(row.serviceId)!
        return {
          service: offered,
          durationMinutes: row.durationMinutesOverride ?? offered.defaultDurationMinutes,
        }
      })
      .sort((a, b) => a.durationMinutes - b.durationMinutes || a.service.name.localeCompare(b.service.name))

    const shortest = theirs[0]
    if (!shortest) continue

    // The engine is handed only this practitioner's rows. It would filter them
    // itself, but narrowing here keeps each of the fourteen runs proportional
    // to one diary rather than to the whole clinic's.
    const data: AvailabilityData = {
      service: {
        id: shortest.service.id,
        defaultDurationMinutes: shortest.service.defaultDurationMinutes,
      },
      practitioners: enginePractitioners.filter((p) => p.id === person.id),
      practitionerServices: offerings
        .filter((row) => row.practitionerId === person.id)
        .map((row) => ({
          practitionerId: row.practitionerId,
          serviceId: row.serviceId,
          durationMinutesOverride: row.durationMinutesOverride,
        })),
      workingHours: hours
        .filter((row) => row.practitionerId === person.id)
        .map((row) => ({
          practitionerId: row.practitionerId,
          weekday: row.weekday,
          startTime: row.startTime,
          endTime: row.endTime,
        })),
      bookings: bookings.filter((row) => row.practitionerId === person.id),
      timeOff: off.filter((row) => row.practitionerId === person.id),
    }

    for (let offset = 0; offset < NEXT_AVAILABLE_DAYS; offset += 1) {
      const date = formatCalendarDate(addCalendarDays(from, offset))
      const {slots} = getAvailability({
        date,
        serviceId: shortest.service.id,
        practitionerId: person.id,
        now,
        data,
      })

      const first = slots[0]
      if (first) {
        result.set(person.id, {date, time: first.time, serviceSlug: shortest.service.slug})
        break
      }
    }
  }

  return result
}
