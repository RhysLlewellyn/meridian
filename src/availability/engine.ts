/**
 * The availability engine.
 *
 * A pure function. It takes the clinic's data for one day and returns the
 * start times that can actually be booked; it opens no connection, reads no
 * clock and holds no state, so every rule below can be tested directly against
 * fixtures rather than inferred from a database.
 *
 * `now` is an argument for the same reason. Lead time is one of the rules, and
 * a function that reads the system clock cannot be tested without either
 * freezing time globally or waiting for it.
 *
 * The rules, in the order they are applied:
 *
 *  1. The practitioner offers the service at all.
 *  2. They have working hours on that weekday.
 *  3. The appointment's duration is theirs, not the service's — see
 *     `practitioner_service.duration_minutes_override`. This is what makes the
 *     calculation non-trivial: an initial assessment is 45 minutes with Nadia
 *     and 60 with Tomas, so the same service produces a different grid, a
 *     different last-bookable slot, and a different answer to "does this fit
 *     before closing?" on the same day.
 *  4. Slots are offered every 15 minutes but appointments are 30, 45 or 60, so
 *     a 45-minute appointment may start at 09:15.
 *  5. The whole appointment must end on or before the end of the working day.
 *  6. It must not overlap a confirmed booking. Cancelled bookings free their
 *     slot, which is the same rule the database's exclusion constraint applies.
 *  7. It must not overlap time off. Lunch, leave and a one-off block are one
 *     mechanism, and the engine cannot tell them apart.
 *  8. It must start at least two hours from now, and no more than 60 days out.
 *
 * With `practitionerId: 'any'` all of the above runs per practitioner and the
 * results are unioned, each slot carrying whoever is free for it.
 *
 * It also reports the times that exist on the grid but cannot be booked, which
 * is not the same question and is the one the interface needs. "Booked" and
 * "outside working hours" are different facts, and a grid that shows only what
 * is free collapses them into one silence: a screen reader user tabbing
 * through six buttons cannot tell a busy Tuesday from a short one. So the
 * unbookable grid positions come back too, each with the reason, and the day
 * renders as a day rather than as a list of survivors.
 */

import {
  addDays,
  addMinutes,
  formatCalendarDate,
  formatTime,
  instantFromWallClock,
  parseCalendarDate,
  parseWallClockTime,
  weekdayOf,
  type CalendarDate,
} from './time.ts'

/** Slots are offered on a quarter-hour grid regardless of appointment length. */
export const SLOT_GRANULARITY_MINUTES = 15

/** Nothing may be booked inside the next two hours. */
export const LEAD_TIME_MINUTES = 120

/** Nothing may be booked more than sixty days out. */
export const HORIZON_DAYS = 60

export type EnginePractitioner = {
  id: string
  name: string
  slug: string
}

export type EngineService = {
  id: string
  defaultDurationMinutes: number
}

export type EnginePractitionerService = {
  practitionerId: string
  serviceId: string
  durationMinutesOverride: number | null
}

export type EngineWorkingHours = {
  practitionerId: string
  /** 0 = Sunday. */
  weekday: number
  /** Local wall clock, `HH:MM` or `HH:MM:SS`. */
  startTime: string
  endTime: string
}

export type EngineBooking = {
  practitionerId: string
  startsAt: Date
  endsAt: Date
  status: 'confirmed' | 'cancelled'
}

export type EngineTimeOff = {
  practitionerId: string
  startsAt: Date
  endsAt: Date
}

/**
 * Everything the engine needs, fetched once. The caller is expected to have
 * narrowed these to the day in question, but the engine does not rely on it:
 * anything irrelevant is filtered out again here, so an over-broad fetch is
 * merely wasteful rather than wrong.
 */
export type AvailabilityData = {
  service: EngineService
  practitioners: EnginePractitioner[]
  practitionerServices: EnginePractitionerService[]
  workingHours: EngineWorkingHours[]
  bookings: EngineBooking[]
  timeOff: EngineTimeOff[]
}

export type AvailabilityQuery = {
  /** A local calendar date, `YYYY-MM-DD`. Not an instant: a day, as read here. */
  date: string
  serviceId: string
  practitionerId: string | 'any'
  now: Date
  data: AvailabilityData
}

export type Slot = {
  startsAt: Date
  endsAt: Date
  /** `09:15`, as read in the clinic's timezone. */
  time: string
  durationMinutes: number
  practitionerId: string
  practitionerName: string
}

/**
 * Why a grid position exists but cannot be taken.
 *
 * There is deliberately no reason for "outside working hours", because such a
 * position is not on the grid at all. That distinction is the whole point:
 * 16:00 on a Thursday being *booked* and 16:00 on a Friday not *existing* are
 * different answers to "can I come in then?", and only one of them is worth
 * rendering.
 */
export type UnavailableReason = 'booked' | 'too_soon'

export type UnavailableSlot = {
  startsAt: Date
  /** `09:15`, as read in the clinic's timezone. */
  time: string
  reason: UnavailableReason
}

export type Availability = {
  date: string
  /** Ascending by start time, then by practitioner name. */
  slots: Slot[]
  /**
   * Grid positions that exist but are not bookable, ascending by time, and
   * never a time that also appears in `slots` — with "any practitioner", one
   * free colleague is enough to make the time bookable.
   */
  unavailable: UnavailableSlot[]
}

type Interval = {startsAt: Date; endsAt: Date}

/** Half-open `[start, end)`, the same bound the exclusion constraint uses. */
function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt
}

export function getAvailability(query: AvailabilityQuery): Availability {
  const {date, serviceId, practitionerId, now, data} = query
  const day = parseCalendarDate(date)
  const weekday = weekdayOf(day)

  const earliest = addMinutes(now, LEAD_TIME_MINUTES)
  const horizon = addDays(now, HORIZON_DAYS)

  const offering = new Map(
    data.practitionerServices
      .filter((ps) => ps.serviceId === serviceId)
      .map((ps) => [ps.practitionerId, ps]),
  )

  const candidates = data.practitioners.filter(
    (p) => offering.has(p.id) && (practitionerId === 'any' || p.id === practitionerId),
  )

  const slots: Slot[] = []

  /**
   * Blocked times, keyed by the time itself rather than by practitioner: the
   * grid a person reads is one row of times, not three overlaid diaries. The
   * first reason recorded for a time wins, which needs no precedence rule
   * because the only reason that can differ between two practitioners is
   * `booked` — lead time is a property of the clock and blocks everybody at
   * once.
   */
  const blocked = new Map<string, UnavailableSlot>()
  const block = (startsAt: Date, time: string, reason: UnavailableReason) => {
    if (!blocked.has(time)) blocked.set(time, {startsAt, time, reason})
  }

  for (const practitioner of candidates) {
    const link = offering.get(practitioner.id)
    const durationMinutes =
      link?.durationMinutesOverride ?? data.service.defaultDurationMinutes

    // A zero or negative duration would make every slot fit trivially and the
    // grid infinite. It is a data error, not an availability answer.
    if (durationMinutes <= 0) continue

    const busy = busyIntervalsFor(practitioner.id, data)

    for (const shift of shiftsFor(practitioner.id, weekday, day, data)) {
      for (
        let start = shift.startsAt;
        // Rule 5: the appointment ends on or before the end of the day. Tested
        // on the end rather than the start, which is what makes a 60-minute
        // appointment stop being offered half an hour before a 30-minute one.
        addMinutes(start, durationMinutes) <= shift.endsAt;
        start = addMinutes(start, SLOT_GRANULARITY_MINUTES)
      ) {
        const end = addMinutes(start, durationMinutes)

        // Slots only advance, so nothing after this one is inside the horizon.
        // Past it the grid stops rather than greying out: a date the clinic is
        // not taking bookings for yet is a closed day, not a full one.
        if (start > horizon) break

        const time = formatTime(start)

        if (start < earliest) {
          block(start, time, 'too_soon')
          continue
        }

        if (busy.some((interval) => overlaps({startsAt: start, endsAt: end}, interval))) {
          block(start, time, 'booked')
          continue
        }

        slots.push({
          startsAt: start,
          endsAt: end,
          time,
          durationMinutes,
          practitionerId: practitioner.id,
          practitionerName: practitioner.name,
        })
      }
    }
  }

  slots.sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.practitionerName.localeCompare(b.practitionerName),
  )

  // A time one practitioner has filled is still bookable if a colleague is
  // free, so the blocked list is resolved against the bookable one rather than
  // reported per practitioner.
  const bookable = new Set(slots.map((slot) => slot.time))
  const unavailable = [...blocked.values()]
    .filter((slot) => !bookable.has(slot.time))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())

  return {date: formatCalendarDate(day), slots, unavailable}
}

/**
 * The practitioner's working periods on that date, as instants.
 *
 * The wall-clock hours in `working_hours` are resolved against the clinic's
 * timezone *on this date*, which is the entire DST story: 09:00 is 08:00Z in
 * August and 09:00Z in November, and the practitioner notices neither.
 *
 * Several rows for one weekday are a split shift and are honoured as written.
 * A row whose end is not after its start describes no time at all and is
 * skipped rather than wrapping past midnight — an overnight physiotherapy
 * clinic is not a thing this models.
 */
function shiftsFor(
  practitionerId: string,
  weekday: number,
  day: CalendarDate,
  data: AvailabilityData,
): Interval[] {
  return data.workingHours
    .filter((wh) => wh.practitionerId === practitionerId && wh.weekday === weekday)
    .map((wh) => ({
      startsAt: instantFromWallClock(day, parseWallClockTime(wh.startTime)),
      endsAt: instantFromWallClock(day, parseWallClockTime(wh.endTime)),
    }))
    .filter((shift) => shift.endsAt > shift.startsAt)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}

/**
 * Confirmed bookings and time off, flattened into one list.
 *
 * The engine has no reason to distinguish them: both mean this practitioner is
 * not free between these two instants. Cancelled bookings are absent for the
 * same reason they leave the exclusion constraint's index — the slot is free
 * again, and nothing was deleted to make it so.
 */
function busyIntervalsFor(practitionerId: string, data: AvailabilityData): Interval[] {
  const bookings = data.bookings
    .filter((b) => b.practitionerId === practitionerId && b.status === 'confirmed')
    .map((b) => ({startsAt: b.startsAt, endsAt: b.endsAt}))

  const off = data.timeOff
    .filter((t) => t.practitionerId === practitionerId)
    .map((t) => ({startsAt: t.startsAt, endsAt: t.endsAt}))

  return [...bookings, ...off]
}
