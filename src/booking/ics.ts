/**
 * iCalendar, hand-rolled.
 *
 * A calendar file is a small, fussy, well-specified format (RFC 5545), and the
 * fussiness is the whole job: CRLF line endings, lines folded at 75 octets,
 * commas and semicolons escaped, timestamps in UTC with a trailing Z. Get any
 * of those wrong and Outlook silently ignores the file while Google Calendar
 * accepts it, which is the worst way to find out.
 *
 * Written out rather than pulled in because the dependency would be larger
 * than the file it produces.
 */

export type CalendarEvent = {
  reference: string
  serviceName: string
  practitionerName: string
  practitionerTitle: string
  startsAt: Date
  endsAt: Date
  status: 'confirmed' | 'cancelled'
  /** When the file was produced. An argument, so the output is testable. */
  now?: Date
}

const CRLF = '\r\n'

/** `20260825T073000Z`. Always UTC — the event is an instant. */
function stamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`
}

/**
 * Escape the four characters that mean something to the format.
 *
 * The backslash goes first or it escapes the escapes.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Fold at 75 octets, continuing with a leading space.
 *
 * Octets, not characters: the limit is on bytes, and a name with an accent in
 * it is two bytes where the loop would otherwise count one. Multi-byte
 * characters are never split across a fold.
 */
function fold(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const out: string[] = []
  let current = ''
  let bytes = 0
  // The continuation line starts with a space, which itself counts toward the
  // limit, so subsequent lines get 74 octets of content.
  let limit = 75

  for (const char of line) {
    const size = encoder.encode(char).length
    if (bytes + size > limit) {
      out.push(current)
      current = ''
      bytes = 0
      limit = 74
    }
    current += char
    bytes += size
  }
  out.push(current)

  return out.join(`${CRLF} `)
}

export function buildCalendar(event: CalendarEvent): string {
  const now = event.now ?? new Date()
  const summary = `${event.serviceName} with ${event.practitionerName}`
  const description = [
    `${event.serviceName}, ${event.practitionerName} (${event.practitionerTitle}).`,
    `Booking reference ${event.reference}.`,
  ].join(' ')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meridian//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable across regenerations: the same appointment must update in a
    // calendar rather than appear twice.
    `UID:${event.reference}@meridian.clinic`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.endsAt)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'LOCATION:Meridian Physiotherapy and Rehabilitation',
    `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return lines.map(fold).join(CRLF) + CRLF
}

/** `meridian-MRD-8F3K.ics`. */
export function calendarFilename(reference: string): string {
  return `meridian-${reference}.ics`
}
