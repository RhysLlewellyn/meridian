/**
 * Rendering. Times, dates, money and durations, in the forms a person in the
 * UK reads without translating.
 */

import {parseCalendarDate, shiftDate, type CalendarDate} from './availability/time.ts'

/**
 * A calendar date is formatted from midday UTC, not from midnight.
 *
 * A date is a civil fact with no zone attached, and formatting it through any
 * zone at all risks landing on the previous day. Midday is far enough from
 * both edges that no offset on earth can move it.
 */
function noonOf(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12))
}

const longDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

const longDateWithYear = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const shortDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

/** `Thursday 3 September`. */
export function formatDate(iso: string): string {
  return longDate.format(noonOf(parseCalendarDate(iso)))
}

/** `Thursday 3 September 2026`. */
export function formatDateWithYear(iso: string): string {
  return longDateWithYear.format(noonOf(parseCalendarDate(iso)))
}

/** `Thu 3 Sep`. */
export function formatDateShort(iso: string): string {
  return shortDate.format(noonOf(parseCalendarDate(iso)))
}

/** `£75` or `£52.50`. Trailing `.00` is noise on a price list. */
export function formatPrice(pence: number): string {
  const pounds = pence / 100
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
  }).format(pounds)
}

/** `45 minutes`, `1 hour`, `1 hour 30 minutes`. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const parts: string[] = []
  if (hours > 0) parts.push(hours === 1 ? '1 hour' : `${hours} hours`)
  if (rest > 0) parts.push(rest === 1 ? '1 minute' : `${rest} minutes`)
  return parts.join(' ') || '0 minutes'
}

/** `45 min`. Compact, for a card where the number matters more than the word. */
export function formatDurationShort(minutes: number): string {
  if (minutes < 120) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
}

/**
 * `Today`, `Tomorrow`, or `Thu, 22 Aug`.
 *
 * Both dates are calendar dates in the clinic's timezone, so the comparison is
 * a string comparison and no instant is involved. "Today" is a fact about the
 * wall calendar, and computing it from a subtraction of instants is how a
 * booking at 00:30 ends up labelled yesterday.
 */
export function formatRelativeDay(iso: string, today: string): string {
  if (iso === today) return 'Today'
  if (iso === shiftDate(today, 1)) return 'Tomorrow'
  return shortDateComma.format(noonOf(parseCalendarDate(iso)))
}

const shortDateComma = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
