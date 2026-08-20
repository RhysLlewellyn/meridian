/**
 * Getting the engine its data.
 *
 * The engine is a pure function over a bundle of rows, which leaves somebody
 * having to fetch the bundle. That is all this file is. It deliberately does
 * no filtering the engine already does — the rules live in one place, and a
 * clever query here that quietly disagreed with them would be the worst
 * possible bug to own.
 *
 * Everything is fetched once per page render. The tables involved are tiny
 * (three practitioners, five services, a fortnight of appointments), so the
 * cost of one wide read is lower than the cost of being clever.
 */

import {and, asc, desc, eq, gte, inArray, lt} from 'drizzle-orm'

import {
  auditLog,
  booking,
  client,
  practitioner,
  practitionerService,
  service,
  timeOff,
  workingHours,
} from '../db/schema.ts'
import type {Database} from '../booking/create.ts'
import {getAvailability, type AvailabilityData, type Availability} from './engine.ts'
import {
  addCalendarDays,
  addDays,
  calendarDateAt,
  formatCalendarDate,
  instantFromWallClock,
  parseCalendarDate,
  weekdayOf,
} from './time.ts'

export type ServiceRow = typeof service.$inferSelect
export type PractitionerRow = typeof practitioner.$inferSelect

/** Active services, in the order a person would work down them. */
export async function listServices(db: Database): Promise<ServiceRow[]> {
  return db
    .select()
    .from(service)
    .where(eq(service.active, true))
    .orderBy(asc(service.defaultDurationMinutes), asc(service.name))
}

export async function getServiceBySlug(
  db: Database,
  slug: string,
): Promise<ServiceRow | undefined> {
  const [row] = await db.select().from(service).where(eq(service.slug, slug)).limit(1)
  return row
}

export async function listPractitioners(db: Database): Promise<PractitionerRow[]> {
  return db
    .select()
    .from(practitioner)
    .where(eq(practitioner.active, true))
    .orderBy(asc(practitioner.name))
}

/**
 * The practitioners who offer a service, with what it costs and how long it
 * takes *with them* — which is not necessarily what the service says.
 */
export async function listPractitionersForService(
  db: Database,
  serviceId: string,
): Promise<(PractitionerRow & {durationMinutes: number; pricePence: number})[]> {
  const rows = await db
    .select({
      practitioner,
      durationMinutesOverride: practitionerService.durationMinutesOverride,
      pricePenceOverride: practitionerService.pricePenceOverride,
      defaultDurationMinutes: service.defaultDurationMinutes,
      pricePence: service.pricePence,
    })
    .from(practitionerService)
    .innerJoin(practitioner, eq(practitioner.id, practitionerService.practitionerId))
    .innerJoin(service, eq(service.id, practitionerService.serviceId))
    .where(and(eq(practitionerService.serviceId, serviceId), eq(practitioner.active, true)))
    .orderBy(asc(practitioner.name))

  return rows.map((row) => ({
    ...row.practitioner,
    durationMinutes: row.durationMinutesOverride ?? row.defaultDurationMinutes,
    pricePence: row.pricePenceOverride ?? row.pricePence,
  }))
}

/**
 * Everything needed to answer "what is free on this date?".
 *
 * The booking and time-off windows start a day early: an appointment that
 * began yesterday evening can still be running this morning, and a query that
 * only looks at rows starting today would offer its slot to somebody else.
 */
export async function loadAvailabilityData(
  db: Database,
  serviceRow: ServiceRow,
  date: string,
): Promise<AvailabilityData> {
  const day = parseCalendarDate(date)
  const dayStart = instantFromWallClock(day, {hour: 0, minute: 0, second: 0})
  const windowStart = addDays(dayStart, -1)
  const windowEnd = addDays(dayStart, 1)

  const offering = await db
    .select()
    .from(practitionerService)
    .where(eq(practitionerService.serviceId, serviceRow.id))

  const practitionerIds = offering.map((row) => row.practitionerId)

  if (practitionerIds.length === 0) {
    return {
      service: {
        id: serviceRow.id,
        defaultDurationMinutes: serviceRow.defaultDurationMinutes,
      },
      practitioners: [],
      practitionerServices: [],
      workingHours: [],
      bookings: [],
      timeOff: [],
    }
  }

  const [practitionerRows, hours, bookings, off] = await Promise.all([
    db
      .select()
      .from(practitioner)
      .where(and(inArray(practitioner.id, practitionerIds), eq(practitioner.active, true))),
    db
      .select()
      .from(workingHours)
      .where(inArray(workingHours.practitionerId, practitionerIds)),
    db
      .select()
      .from(booking)
      .where(
        and(
          inArray(booking.practitionerId, practitionerIds),
          gte(booking.startsAt, windowStart),
          lt(booking.startsAt, windowEnd),
        ),
      ),
    db
      .select()
      .from(timeOff)
      .where(
        and(
          inArray(timeOff.practitionerId, practitionerIds),
          gte(timeOff.startsAt, windowStart),
          lt(timeOff.startsAt, windowEnd),
        ),
      ),
  ])

  return {
    service: {id: serviceRow.id, defaultDurationMinutes: serviceRow.defaultDurationMinutes},
    practitioners: practitionerRows.map((p) => ({id: p.id, name: p.name, slug: p.slug})),
    practitionerServices: offering.map((row) => ({
      practitionerId: row.practitionerId,
      serviceId: row.serviceId,
      durationMinutesOverride: row.durationMinutesOverride,
    })),
    workingHours: hours.map((row) => ({
      practitionerId: row.practitionerId,
      weekday: row.weekday,
      startTime: row.startTime,
      endTime: row.endTime,
    })),
    bookings: bookings.map((row) => ({
      practitionerId: row.practitionerId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      status: row.status,
    })),
    timeOff: off.map((row) => ({
      practitionerId: row.practitionerId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    })),
  }
}

/** Fetch, then hand it to the engine. The rules stay in the engine. */
export async function availabilityFor(
  db: Database,
  serviceRow: ServiceRow,
  practitionerSlug: string,
  date: string,
  now: Date = new Date(),
): Promise<Availability> {
  const data = await loadAvailabilityData(db, serviceRow, date)
  const chosen =
    practitionerSlug === ANY
      ? ANY
      : (data.practitioners.find((p) => p.slug === practitionerSlug)?.id ?? UNKNOWN)

  return getAvailability({
    date,
    serviceId: serviceRow.id,
    practitionerId: chosen,
    now,
    data,
  })
}

/** The slug that means "no preference" in a booking URL. */
export const ANY = 'any'

/**
 * A practitioner id that cannot match anything, for the case where the slug in
 * the URL is not one of the practitioners offering this service. The engine
 * then returns no slots, which is the correct answer to a nonsense URL.
 */
const UNKNOWN = '00000000-0000-0000-0000-000000000000'

export type BookingDetail = {
  id: string
  reference: string
  startsAt: Date
  endsAt: Date
  status: 'confirmed' | 'cancelled'
  cancellationReason: string | null
  serviceName: string
  practitionerName: string
  practitionerTitle: string
  clientName: string
  clientEmail: string
  pricePence: number
}

/**
 * One booking, by the reference a person was given.
 *
 * The reference is the key here rather than the id, because the id is a uuid
 * and a uuid cannot be read down a telephone. It is unguessable enough to be
 * the only thing standing between a stranger and somebody's appointment,
 * which is a trade this demo makes knowingly and the README says so.
 */
export async function getBookingByReference(
  db: Database,
  reference: string,
): Promise<BookingDetail | undefined> {
  const [row] = await db
    .select({
      id: booking.id,
      reference: booking.reference,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      status: booking.status,
      cancellationReason: booking.cancellationReason,
      serviceName: service.name,
      practitionerName: practitioner.name,
      practitionerTitle: practitioner.title,
      clientName: client.name,
      clientEmail: client.email,
      pricePence: practitionerService.pricePenceOverride,
      servicePricePence: service.pricePence,
    })
    .from(booking)
    .innerJoin(service, eq(service.id, booking.serviceId))
    .innerJoin(practitioner, eq(practitioner.id, booking.practitionerId))
    .innerJoin(client, eq(client.id, booking.clientId))
    .leftJoin(
      practitionerService,
      and(
        eq(practitionerService.practitionerId, booking.practitionerId),
        eq(practitionerService.serviceId, booking.serviceId),
      ),
    )
    .where(eq(booking.reference, reference))
    .limit(1)

  if (!row) return undefined
  const {servicePricePence, pricePence, ...rest} = row
  return {...rest, pricePence: pricePence ?? servicePricePence}
}

/**
 * What happened to the confirmation email, according to the audit log.
 *
 * The booking is committed before the email is attempted, so "did it send?"
 * is a fact about the past that has to be recorded somewhere rather than
 * recomputed. `undefined` means no attempt has been logged at all.
 */
export async function getEmailOutcome(
  db: Database,
  bookingId: string,
): Promise<{sent: boolean; reason?: string} | undefined> {
  const [row] = await db
    .select({action: auditLog.action, detail: auditLog.detail})
    .from(auditLog)
    .where(and(eq(auditLog.bookingId, bookingId), inArray(auditLog.action, EMAIL_ACTIONS)))
    .orderBy(desc(auditLog.createdAt))
    .limit(1)

  if (!row) return undefined
  return {
    sent: row.action === 'email_sent',
    reason: typeof row.detail.reason === 'string' ? row.detail.reason : undefined,
  }
}

const EMAIL_ACTIONS = ['email_sent', 'email_failed']

export type StaffBooking = {
  reference: string
  startsAt: Date
  endsAt: Date
  status: 'confirmed' | 'cancelled'
  cancellationReason: string | null
  serviceName: string
  practitionerName: string
  practitionerSlug: string
  clientName: string
  clientEmail: string
  clientPhone: string | null
}

/**
 * Everything happening on one day, cancellations included.
 *
 * The receptionist's view is not the client's: a cancelled appointment still
 * has to appear, because somebody will ring about it. Filtering it out here
 * would leave the front desk unable to see the thing they are being asked
 * about.
 *
 * Bounded by the London day rather than the UTC one — 25 October has 25 hours
 * in it, and an appointment at 23:30 belongs to the day the clinic thinks it
 * does.
 */
export async function listDayBookings(
  db: Database,
  date: string,
  practitionerSlug?: string,
): Promise<StaffBooking[]> {
  const day = parseCalendarDate(date)
  const dayStart = instantFromWallClock(day, {hour: 0, minute: 0, second: 0})
  const dayEnd = instantFromWallClock(addCalendarDays(day, 1), {
    hour: 0,
    minute: 0,
    second: 0,
  })

  const filters = [gte(booking.startsAt, dayStart), lt(booking.startsAt, dayEnd)]
  if (practitionerSlug) filters.push(eq(practitioner.slug, practitionerSlug))

  return db
    .select({
      reference: booking.reference,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      status: booking.status,
      cancellationReason: booking.cancellationReason,
      serviceName: service.name,
      practitionerName: practitioner.name,
      practitionerSlug: practitioner.slug,
      clientName: client.name,
      clientEmail: client.email,
      clientPhone: client.phone,
    })
    .from(booking)
    .innerJoin(service, eq(service.id, booking.serviceId))
    .innerJoin(practitioner, eq(practitioner.id, booking.practitionerId))
    .innerJoin(client, eq(client.id, booking.clientId))
    .where(and(...filters))
    .orderBy(asc(booking.startsAt), asc(practitioner.name))
}

/**
 * Who is meant to be in on a given day.
 *
 * Working hours alone, not working hours minus leave: somebody on a training
 * course is still on the rota, and the front desk wants the difference between
 * "not working today" and "working but blocked out".
 */
export async function practitionersOnShift(
  db: Database,
  date: string,
): Promise<PractitionerRow[]> {
  const weekday = weekdayOf(parseCalendarDate(date))
  const rows = await db
    .selectDistinct({practitioner})
    .from(workingHours)
    .innerJoin(practitioner, eq(practitioner.id, workingHours.practitionerId))
    .where(and(eq(workingHours.weekday, weekday), eq(practitioner.active, true)))
    .orderBy(asc(practitioner.name))
  return rows.map((row) => row.practitioner)
}

/** Today, as a calendar date in the clinic's timezone. */
export function today(now: Date = new Date()): string {
  return formatCalendarDate(calendarDateAt(now))
}
