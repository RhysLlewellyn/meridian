/**
 * Wall-clock time in a named zone, without a date library.
 *
 * Everything in this repo is stored as an instant (`timestamptz`) and every
 * working day is expressed in local wall-clock hours. Converting between the
 * two is the whole of the timezone problem, and doing it with a fixed offset
 * is the bug this file exists to avoid: on 25 October 2026 the clocks go back,
 * and a practitioner who works 09:00-17:00 works 09:00-17:00 on that day too.
 * Their day is not shifted by an hour because the offset changed.
 *
 * The conversions below ask the platform's IANA database for the offset *at a
 * particular instant* rather than assuming one, so a day either side of a
 * transition resolves correctly with no special case.
 */

export const CLINIC_TIME_ZONE = 'Europe/London'

export type CalendarDate = {year: number; month: number; day: number}
export type WallClockTime = {hour: number; minute: number; second: number}

const MINUTE_MS = 60_000

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let existing = formatters.get(timeZone)
  if (!existing) {
    existing = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      // h23 rather than the locale default: midnight must read 00, not 24.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, existing)
  }
  return existing
}

/** The wall-clock reading a person in `timeZone` would see at `instant`. */
export function wallClockAt(
  instant: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): CalendarDate & WallClockTime {
  const parts = formatter(timeZone).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type)
    if (!part) throw new Error(`Intl returned no ${type} for ${timeZone}`)
    return Number(part.value)
  }
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

/**
 * The zone's offset from UTC, in milliseconds, at a given instant.
 *
 * Positive east of Greenwich: +3_600_000 during British Summer Time, 0 in
 * winter.
 */
export function zoneOffsetMs(instant: Date, timeZone: string = CLINIC_TIME_ZONE): number {
  const w = wallClockAt(instant, timeZone)
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  // Intl resolves to whole seconds; truncate the instant to match, or the
  // sub-second remainder lands in the offset.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * The instant at which a given wall clock in `timeZone` reads `date` + `time`.
 *
 * Two passes. The first guesses the offset using the naive reading as though
 * it were UTC; the second corrects it using the offset actually in force at
 * that guess. One correction is enough for every real transition, because no
 * zone shifts by more than the distance a single guess can be wrong.
 *
 * On the spring-forward morning there is a wall-clock hour that does not
 * exist. This returns the instant one offset later — 01:30 resolves as 02:30 —
 * rather than throwing. No working day in this clinic starts inside the gap,
 * and a booking engine that raises an exception twice a year is worse than one
 * that rounds forward.
 */
export function instantFromWallClock(
  date: CalendarDate,
  time: WallClockTime,
  timeZone: string = CLINIC_TIME_ZONE,
): Date {
  const naive = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
    time.second,
  )
  const firstGuess = naive - zoneOffsetMs(new Date(naive), timeZone)
  const corrected = naive - zoneOffsetMs(new Date(firstGuess), timeZone)
  return new Date(corrected)
}

/** `2026-10-25` -> `{year: 2026, month: 10, day: 25}`. */
export function parseCalendarDate(iso: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got ${JSON.stringify(iso)}`)
  const [, year, month, day] = match
  return {year: Number(year), month: Number(month), day: Number(day)}
}

/** `09:00` or `09:00:00` -> `{hour: 9, minute: 0, second: 0}`. */
export function parseWallClockTime(value: string): WallClockTime {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) throw new Error(`Expected a HH:MM[:SS] time, got ${JSON.stringify(value)}`)
  const [, hour, minute, second] = match
  return {hour: Number(hour), minute: Number(minute), second: Number(second ?? 0)}
}

export function formatCalendarDate(date: CalendarDate): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`
}

/**
 * The weekday of a calendar date, 0 = Sunday, matching `working_hours.weekday`
 * and JavaScript's `getDay()`.
 *
 * Computed from the civil date alone. A Sunday is a Sunday in every zone; only
 * an instant needs one.
 */
export function weekdayOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()
}

/** `09:15` as read in `timeZone` at that instant. */
export function formatTime(instant: Date, timeZone: string = CLINIC_TIME_ZONE): string {
  const w = wallClockAt(instant, timeZone)
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`
}

/** The calendar date `instant` falls on, as read in `timeZone`. */
export function calendarDateAt(
  instant: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): CalendarDate {
  const {year, month, day} = wallClockAt(instant, timeZone)
  return {year, month, day}
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MINUTE_MS)
}

export function addDays(instant: Date, days: number): Date {
  return addMinutes(instant, days * 24 * 60)
}
