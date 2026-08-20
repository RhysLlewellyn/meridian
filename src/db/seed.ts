/**
 * Seed data for Meridian.
 *
 * `npm run seed`, and it is idempotent: practitioners and services are matched
 * on their slug so their ids survive, and the transactional data underneath is
 * rebuilt from scratch each run. Running it twice leaves the same clinic.
 *
 * The three practitioners have deliberately different working patterns —
 * different days, different hours, one with a lunch break and one without, and
 * one who needs an hour for the assessment the others do in 45 minutes.
 * Identical schedules hide exactly the bugs this data exists to expose: an
 * engine that assumes everyone opens at nine and closes at five passes a
 * suite built on a clinic where everyone does.
 *
 * The bookings are generated from a fixed seed, so the demo looks the same
 * every time it is rebuilt, and are deliberately uneven — one nearly full day,
 * one nearly empty, a Friday when Grace is on leave, and a few cancellations
 * that free their slots again.
 */

import {eq, inArray} from 'drizzle-orm'

import {
  addMinutes,
  calendarDateAt,
  formatCalendarDate,
  instantFromWallClock,
  parseWallClockTime,
  weekdayOf,
  type CalendarDate,
} from '../availability/time.ts'
import {connect} from './client.ts'
import {
  auditLog,
  booking,
  client as clientTable,
  practitioner,
  practitionerService,
  service,
  timeOff,
  workingHours,
} from './schema.ts'

const SUN = 0
const MON = 1
const TUE = 2
const WED = 3
const THU = 4
const FRI = 5

const services = [
  {
    slug: 'initial-assessment',
    name: 'Initial assessment',
    description:
      'A first appointment: history, movement screen, and a plan. Longer than a ' +
      'follow-up because most of it is listening.',
    defaultDurationMinutes: 45,
    pricePence: 7_500,
  },
  {
    slug: 'follow-up',
    name: 'Follow-up treatment',
    description: 'Hands-on treatment and a progression of the exercise plan.',
    defaultDurationMinutes: 30,
    pricePence: 5_200,
  },
  {
    slug: 'extended-treatment',
    name: 'Extended treatment',
    description:
      'A full hour, for complex presentations or where more than one area is ' +
      'being treated.',
    defaultDurationMinutes: 60,
    pricePence: 9_000,
  },
  {
    slug: 'rehab-review',
    name: 'Rehab review',
    description: 'A check on progress against the plan, and a reload of the programme.',
    defaultDurationMinutes: 30,
    pricePence: 4_800,
  },
  {
    slug: 'gait-analysis',
    name: 'Gait analysis',
    description: 'Video assessment of walking and running mechanics, with a written report.',
    defaultDurationMinutes: 45,
    pricePence: 8_500,
  },
] as const

type ServiceSlug = (typeof services)[number]['slug']

const practitioners: {
  slug: string
  name: string
  title: string
  bio: string
  /** `[weekday, start, end]`, local wall clock. */
  shifts: [number, string, string][]
  /** Lunch, as a wall-clock window taken out of every working day. */
  lunch: [string, string] | null
  offers: {service: ServiceSlug; durationMinutesOverride?: number}[]
}[] = [
  {
    slug: 'nadia-okafor',
    name: 'Nadia Okafor',
    title: 'MSK Physiotherapist',
    bio:
      'Fifteen years in musculoskeletal physiotherapy, the last six of them in private ' +
      'practice. Particular interest in shoulders and in the long tail of injuries that ' +
      'were never quite rehabilitated the first time.',
    shifts: [
      [MON, '08:00', '16:00'],
      [TUE, '08:00', '16:00'],
      [WED, '08:00', '16:00'],
      [THU, '08:00', '16:00'],
    ],
    lunch: ['12:00', '12:45'],
    offers: [
      {service: 'initial-assessment'},
      {service: 'follow-up'},
      {service: 'extended-treatment'},
      {service: 'rehab-review'},
    ],
  },
  {
    slug: 'tomas-iriarte',
    name: 'Tomas Iriarte',
    title: 'Sports Rehabilitation Therapist',
    bio:
      'Works with club and amateur athletes on return-to-play. Takes an hour over an ' +
      'initial assessment because it always includes a movement screen on the plinth ' +
      'and again on the treadmill.',
    shifts: [
      [TUE, '10:00', '18:00'],
      [WED, '10:00', '18:00'],
      [FRI, '10:00', '18:00'],
    ],
    lunch: null,
    offers: [
      // The override that makes the availability engine interesting: the same
      // service, a different length, a different grid on the same day.
      {service: 'initial-assessment', durationMinutesOverride: 60},
      {service: 'follow-up'},
      {service: 'extended-treatment'},
      {service: 'gait-analysis'},
    ],
  },
  {
    slug: 'grace-whitfield',
    name: 'Grace Whitfield',
    title: 'Physiotherapist',
    bio:
      'Part-time, Mondays and Fridays. Post-operative rehabilitation and the slower ' +
      'work of getting people back to walking distances they used to take for granted.',
    shifts: [
      [MON, '09:00', '13:00'],
      [FRI, '09:00', '13:00'],
    ],
    lunch: null,
    offers: [{service: 'follow-up'}, {service: 'rehab-review'}],
  },
]

const clients = [
  'Marta Kowalczyk',
  'Desmond Aryee',
  'Fiona Barr',
  'Yusuf Demir',
  'Helen Ivory',
  'Callum Reith',
  'Priya Raghavan',
  'Owen Trelawny',
  'Ada Mensah',
  'Bernard Quill',
  'Sinead Molloy',
  'Ravi Chatterjee',
  'Lucia Ferrando',
  'Nathan Oyelaran',
  'Esme Hollowell',
  'Gideon Marsh',
]

/**
 * Deterministic PRNG. The demo data has to be the same on every rebuild, so
 * nothing here may call Math.random.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * A short reference a person can read down a telephone. No I, O, 0 or 1: this
 * gets written on a card by hand and read back by someone who did not write it.
 */
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function reference(random: () => number): string {
  let out = ''
  for (let i = 0; i < 4; i += 1) {
    out += REFERENCE_ALPHABET[Math.floor(random() * REFERENCE_ALPHABET.length)]
  }
  return `MRD-${out}`
}

function at(date: CalendarDate, time: string): Date {
  return instantFromWallClock(date, parseWallClockTime(time))
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/** The Monday of the week containing `date`. */
function mondayOf(date: CalendarDate): CalendarDate {
  const weekday = weekdayOf(date)
  return addCalendarDays(date, weekday === SUN ? -6 : 1 - weekday)
}

type Interval = {startsAt: Date; endsAt: Date}

function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt
}

async function main() {
  const {sql, db} = connect()

  try {
    // ---- Reference data: upserted, so ids survive a re-run. ----------------

    const serviceRows = []
    for (const s of services) {
      const [row] = await db
        .insert(service)
        .values(s)
        .onConflictDoUpdate({target: service.slug, set: {...s}})
        .returning()
      serviceRows.push(row)
    }
    const serviceBySlug = new Map(serviceRows.map((s) => [s.slug, s]))

    const practitionerRows = []
    for (const p of practitioners) {
      const values = {slug: p.slug, name: p.name, title: p.title, bio: p.bio, active: true}
      const [row] = await db
        .insert(practitioner)
        .values(values)
        .onConflictDoUpdate({target: practitioner.slug, set: values})
        .returning()
      practitionerRows.push(row)
    }
    const practitionerBySlug = new Map(practitionerRows.map((p) => [p.slug, p]))
    const practitionerIds = practitionerRows.map((p) => p.id)

    // ---- Transactional data: rebuilt from nothing each run. ----------------
    //
    // Deleted in dependency order. audit_log and booking cascade from their
    // parents, but deleting explicitly means the seed does not depend on which
    // foreign keys happen to carry ON DELETE CASCADE today.

    await db.delete(auditLog)
    await db.delete(booking)
    await db.delete(clientTable)
    await db.delete(timeOff).where(inArray(timeOff.practitionerId, practitionerIds))
    await db
      .delete(workingHours)
      .where(inArray(workingHours.practitionerId, practitionerIds))
    await db
      .delete(practitionerService)
      .where(inArray(practitionerService.practitionerId, practitionerIds))

    for (const p of practitioners) {
      const row = practitionerBySlug.get(p.slug)!

      await db.insert(practitionerService).values(
        p.offers.map((offer) => ({
          practitionerId: row.id,
          serviceId: serviceBySlug.get(offer.service)!.id,
          durationMinutesOverride: offer.durationMinutesOverride ?? null,
          pricePenceOverride: null,
        })),
      )

      await db.insert(workingHours).values(
        p.shifts.map(([weekday, startTime, endTime]) => ({
          practitionerId: row.id,
          weekday,
          startTime,
          endTime,
        })),
      )
    }

    // ---- The three weeks ---------------------------------------------------

    const today = calendarDateAt(new Date())
    const weekOne = mondayOf(today)
    const days: CalendarDate[] = []
    for (let offset = 0; offset < 21; offset += 1) {
      const day = addCalendarDays(weekOne, offset)
      if (weekdayOf(day) >= MON && weekdayOf(day) <= FRI) days.push(day)
    }

    const random = mulberry32(0x4d455249) // "MERI"

    // Time off. Lunch every working day for Nadia, plus two blocks that are
    // the same mechanism doing a different job: Grace on leave for a whole
    // Friday, and an afternoon of training for Tomas.
    const timeOffRows: {
      practitionerId: string
      startsAt: Date
      endsAt: Date
      reason: string
    }[] = []

    for (const p of practitioners) {
      if (!p.lunch) continue
      const row = practitionerBySlug.get(p.slug)!
      const workingWeekdays = new Set(p.shifts.map(([weekday]) => weekday))
      for (const day of days) {
        if (!workingWeekdays.has(weekdayOf(day))) continue
        timeOffRows.push({
          practitionerId: row.id,
          startsAt: at(day, p.lunch[0]),
          endsAt: at(day, p.lunch[1]),
          reason: 'Lunch',
        })
      }
    }

    const graceLeave = days.find((d) => weekdayOf(d) === FRI)
    if (graceLeave) {
      timeOffRows.push({
        practitionerId: practitionerBySlug.get('grace-whitfield')!.id,
        startsAt: at(graceLeave, '00:00'),
        endsAt: at(addCalendarDays(graceLeave, 1), '00:00'),
        reason: 'Annual leave',
      })
    }

    const tomasTraining = days.filter((d) => weekdayOf(d) === WED)[1]
    if (tomasTraining) {
      timeOffRows.push({
        practitionerId: practitionerBySlug.get('tomas-iriarte')!.id,
        startsAt: at(tomasTraining, '13:00'),
        endsAt: at(tomasTraining, '18:00'),
        reason: 'Course — tendinopathy loading',
      })
    }

    await db.insert(timeOff).values(timeOffRows)

    // Clients.
    const clientRows = await db
      .insert(clientTable)
      .values(
        clients.map((name) => ({
          name,
          email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
          phone: null,
        })),
      )
      .returning()

    // Bookings. A target count per practitioner per day rather than a fill
    // probability, so the shape of the week is controllable: one nearly full
    // day, one nearly empty, and the rest ordinary.
    const busiestDay = days[3] ? formatCalendarDate(days[3]) : ''
    const quietestDay = days[8] ? formatCalendarDate(days[8]) : ''

    const bookingRows: (typeof booking.$inferInsert)[] = []
    const references = new Set<string>()
    const placed: (Interval & {practitionerId: string})[] = []

    const nextReference = () => {
      for (;;) {
        const candidate = reference(random)
        if (!references.has(candidate)) {
          references.add(candidate)
          return candidate
        }
      }
    }

    const place = (
      practitionerId: string,
      day: CalendarDate,
      shift: [number, string, string],
      offers: {service: ServiceSlug; durationMinutesOverride?: number}[],
      target: number,
    ) => {
      const dayEnd = at(day, shift[2])
      let cursor = at(day, shift[1])
      let count = 0

      while (count < target) {
        const offer = offers[Math.floor(random() * offers.length)]
        const svc = serviceBySlug.get(offer.service)!
        const duration = offer.durationMinutesOverride ?? svc.defaultDurationMinutes
        const end = addMinutes(cursor, duration)
        if (end > dayEnd) break

        const candidate = {startsAt: cursor, endsAt: end}
        const blocked =
          timeOffRows.some(
            (t) => t.practitionerId === practitionerId && overlaps(candidate, t),
          ) ||
          placed.some((p) => p.practitionerId === practitionerId && overlaps(candidate, p))

        if (blocked) {
          cursor = addMinutes(cursor, 15)
          continue
        }

        bookingRows.push({
          reference: nextReference(),
          practitionerId,
          serviceId: svc.id,
          clientId: clientRows[Math.floor(random() * clientRows.length)].id,
          startsAt: candidate.startsAt,
          endsAt: candidate.endsAt,
          status: 'confirmed',
        })
        placed.push({...candidate, practitionerId})
        count += 1

        // A gap of nothing, a quarter or a half hour, so the day does not read
        // as a machine filling a grid.
        cursor = addMinutes(end, [0, 15, 30][Math.floor(random() * 3)])
      }
    }

    for (const p of practitioners) {
      const row = practitionerBySlug.get(p.slug)!
      for (const day of days) {
        const iso = formatCalendarDate(day)
        for (const shift of p.shifts) {
          if (shift[0] !== weekdayOf(day)) continue
          const target =
            iso === busiestDay ? 7 : iso === quietestDay ? 0 : Math.floor(random() * 4)
          place(row.id, day, shift, p.offers, target)
        }
      }
    }

    // At least one appointment either side of the October transition, because
    // the interesting question is not whether the engine survives the change
    // but whether a day after it still reads 09:00. Nadia works Thursdays and
    // Mondays; 22 October is BST and 26 October is GMT.
    const dstNadia = practitionerBySlug.get('nadia-okafor')!
    const dstService = serviceBySlug.get('follow-up')!
    for (const [iso, time] of [
      ['2026-10-22', '09:00'],
      ['2026-10-26', '09:00'],
    ] as const) {
      const [year, month, day] = iso.split('-').map(Number)
      const date = {year, month, day}
      const startsAt = at(date, time)
      bookingRows.push({
        reference: nextReference(),
        practitionerId: dstNadia.id,
        serviceId: dstService.id,
        clientId: clientRows[0].id,
        startsAt,
        endsAt: addMinutes(startsAt, dstService.defaultDurationMinutes),
        status: 'confirmed',
      })
    }

    const inserted = await db.insert(booking).values(bookingRows).returning()

    // A couple of cancellations, which free their slots again — the exclusion
    // constraint only indexes confirmed rows, so nothing is deleted to do it.
    const cancelled = inserted.filter((_, i) => i % 13 === 5).slice(0, 3)
    for (const row of cancelled) {
      await db
        .update(booking)
        .set({status: 'cancelled', cancellationReason: 'Client unwell'})
        .where(eq(booking.id, row.id))
    }

    await db.insert(auditLog).values([
      ...inserted.map((row) => ({
        bookingId: row.id,
        action: 'created' as const,
        detail: {source: 'seed'},
      })),
      ...cancelled.map((row) => ({
        bookingId: row.id,
        action: 'cancelled' as const,
        detail: {source: 'seed', reason: 'Client unwell'},
      })),
    ])

    console.log(
      [
        `practitioners  ${practitionerRows.length}`,
        `services       ${serviceRows.length}`,
        `working hours  ${practitioners.reduce((n, p) => n + p.shifts.length, 0)}`,
        `time off       ${timeOffRows.length}`,
        `clients        ${clientRows.length}`,
        `bookings       ${inserted.length} (${cancelled.length} cancelled)`,
        `weeks          ${formatCalendarDate(days[0])} to ${formatCalendarDate(days.at(-1)!)}`,
      ].join('\n'),
    )
  } finally {
    await sql.end()
  }
}

await main()
