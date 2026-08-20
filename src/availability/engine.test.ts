/**
 * The engine's tests run entirely on fixtures, with no database anywhere near
 * them. That is the point of the engine being a pure function: these assert
 * the scheduling rules, and the concurrency test asserts the guarantee that
 * Postgres provides. Mixing the two would leave both weaker.
 *
 * Fixture instants are written as explicit UTC, not built with the same
 * wall-clock helper the engine uses. An offset bug would otherwise cancel
 * itself out and every test would still pass.
 */

import {describe, expect, it} from 'vitest'

import {
  getAvailability,
  type AvailabilityData,
  type EngineBooking,
  type EngineTimeOff,
} from './engine'

const NADIA = {id: 'p-nadia', name: 'Nadia Okafor', slug: 'nadia-okafor'}
const TOMAS = {id: 'p-tomas', name: 'Tomas Iriarte', slug: 'tomas-iriarte'}
const GRACE = {id: 'p-grace', name: 'Grace Whitfield', slug: 'grace-whitfield'}

const ASSESSMENT = {id: 's-assessment', defaultDurationMinutes: 45}
const FOLLOW_UP = {id: 's-follow-up', defaultDurationMinutes: 30}

/**
 * Tuesday 1 September 2026, 07:00 in London. Every date used below sits inside
 * the 60-day horizon from here, including the October DST weekend, which is
 * why this particular Tuesday.
 */
const NOW = new Date('2026-09-01T06:00:00Z')

const MON = 1
const TUE = 2
const WED = 3
const THU = 4
const FRI = 5

function data(overrides: Partial<AvailabilityData> = {}): AvailabilityData {
  return {
    service: ASSESSMENT,
    practitioners: [NADIA, TOMAS, GRACE],
    practitionerServices: [
      // Nadia takes the service default, 45 minutes.
      {practitionerId: NADIA.id, serviceId: ASSESSMENT.id, durationMinutesOverride: null},
      {practitionerId: NADIA.id, serviceId: FOLLOW_UP.id, durationMinutesOverride: null},
      // Tomas needs an hour for the same assessment. This one row is the
      // reason the engine is not a loop over a calendar.
      {practitionerId: TOMAS.id, serviceId: ASSESSMENT.id, durationMinutesOverride: 60},
      {practitionerId: TOMAS.id, serviceId: FOLLOW_UP.id, durationMinutesOverride: null},
      // Grace does not do initial assessments at all.
      {practitionerId: GRACE.id, serviceId: FOLLOW_UP.id, durationMinutesOverride: null},
    ],
    workingHours: [
      ...[MON, TUE, WED, THU].map((weekday) => ({
        practitionerId: NADIA.id,
        weekday,
        startTime: '08:00:00',
        endTime: '16:00:00',
      })),
      ...[TUE, WED, FRI].map((weekday) => ({
        practitionerId: TOMAS.id,
        weekday,
        startTime: '10:00:00',
        endTime: '18:00:00',
      })),
      ...[MON, FRI].map((weekday) => ({
        practitionerId: GRACE.id,
        weekday,
        startTime: '09:00:00',
        endTime: '13:00:00',
      })),
    ],
    bookings: [],
    timeOff: [],
    ...overrides,
  }
}

function booking(
  practitionerId: string,
  startsAt: string,
  endsAt: string,
  status: EngineBooking['status'] = 'confirmed',
): EngineBooking {
  return {practitionerId, startsAt: new Date(startsAt), endsAt: new Date(endsAt), status}
}

function timeOff(practitionerId: string, startsAt: string, endsAt: string): EngineTimeOff {
  return {practitionerId, startsAt: new Date(startsAt), endsAt: new Date(endsAt)}
}

/** The wall-clock times offered, which is what a person actually sees. */
function times(result: {slots: {time: string}[]}): string[] {
  return result.slots.map((slot) => slot.time)
}

describe('working hours', () => {
  it('offers a quarter-hour grid from the start of the day', () => {
    // Thursday 3 September. Nadia works 08:00–16:00 and takes 45 minutes.
    const result = getAvailability({
      date: '2026-09-03',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data(),
    })

    expect(times(result).slice(0, 4)).toEqual(['08:00', '08:15', '08:30', '08:45'])
    expect(result.slots).toHaveLength(30)
    expect(result.date).toBe('2026-09-03')
  })

  it('returns nothing on a day the practitioner does not work', () => {
    // Grace works Monday and Friday only; 3 September is a Thursday.
    const result = getAvailability({
      date: '2026-09-03',
      serviceId: FOLLOW_UP.id,
      practitionerId: GRACE.id,
      now: NOW,
      data: data({service: FOLLOW_UP}),
    })

    expect(result.slots).toEqual([])
  })

  it('returns nothing for a practitioner who does not offer the service', () => {
    // Monday 7 September: Grace is working, but not doing assessments.
    const result = getAvailability({
      date: '2026-09-07',
      serviceId: ASSESSMENT.id,
      practitionerId: GRACE.id,
      now: NOW,
      data: data(),
    })

    expect(result.slots).toEqual([])
  })

  it('honours a split shift as two separate runs of slots', () => {
    const result = getAvailability({
      date: '2026-09-03',
      serviceId: FOLLOW_UP.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data({
        service: FOLLOW_UP,
        workingHours: [
          {
            practitionerId: NADIA.id,
            weekday: THU,
            startTime: '08:00:00',
            endTime: '09:00:00',
          },
          {
            practitionerId: NADIA.id,
            weekday: THU,
            startTime: '14:00:00',
            endTime: '15:00:00',
          },
        ],
      }),
    })

    // Quarter-hour grid inside each shift, and nothing offered in the gap.
    expect(times(result)).toEqual([
      '08:00',
      '08:15',
      '08:30',
      '14:00',
      '14:15',
      '14:30',
    ])
  })
})

describe('duration overrides', () => {
  it('stops offering slots earlier for the practitioner who takes longer', () => {
    // Wednesday 2 September. Both work; the assessment is 45 minutes with
    // Nadia and 60 with Tomas, and both close at their own hour.
    const forNadia = getAvailability({
      date: '2026-09-02',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data(),
    })
    const forTomas = getAvailability({
      date: '2026-09-02',
      serviceId: ASSESSMENT.id,
      practitionerId: TOMAS.id,
      now: NOW,
      data: data(),
    })

    expect(forNadia.slots.at(-1)?.time).toBe('15:15')
    expect(forNadia.slots.at(-1)?.durationMinutes).toBe(45)

    expect(forTomas.slots.at(-1)?.time).toBe('17:00')
    expect(forTomas.slots.at(-1)?.durationMinutes).toBe(60)
  })

  it('does not offer a slot the appointment cannot finish inside', () => {
    // The same practitioner and the same closing time, two services. 17:15 is
    // bookable for a 30-minute follow-up and not for Tomas's 60-minute
    // assessment: the rule is tested on the end of the appointment.
    const assessment = getAvailability({
      date: '2026-09-02',
      serviceId: ASSESSMENT.id,
      practitionerId: TOMAS.id,
      now: NOW,
      data: data(),
    })
    const followUp = getAvailability({
      date: '2026-09-02',
      serviceId: FOLLOW_UP.id,
      practitionerId: TOMAS.id,
      now: NOW,
      data: data({service: FOLLOW_UP}),
    })

    expect(times(assessment)).not.toContain('17:15')
    expect(times(followUp)).toContain('17:15')
    expect(followUp.slots.at(-1)?.time).toBe('17:30')
  })
})

describe('existing bookings', () => {
  it('allows an appointment that abuts one exactly, at both ends', () => {
    // Nadia is booked 09:00–09:45 London, which is 08:00–08:45 UTC in BST.
    const result = getAvailability({
      date: '2026-09-03',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data({
        bookings: [booking(NADIA.id, '2026-09-03T08:00:00Z', '2026-09-03T08:45:00Z')],
      }),
    })

    // 08:15 ends exactly as the booking starts; 09:45 starts exactly as it
    // ends. Half-open ranges, the same bound the database constraint uses.
    expect(times(result)).toContain('08:15')
    expect(times(result)).toContain('09:45')

    // Everything genuinely overlapping is gone.
    for (const blocked of ['08:30', '08:45', '09:00', '09:15', '09:30']) {
      expect(times(result)).not.toContain(blocked)
    }
  })

  it('lets a cancelled booking free its slot', () => {
    const cancelled = booking(
      NADIA.id,
      '2026-09-03T08:00:00Z',
      '2026-09-03T08:45:00Z',
      'cancelled',
    )
    const result = getAvailability({
      date: '2026-09-03',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data({bookings: [cancelled]}),
    })

    expect(times(result)).toContain('09:00')
    expect(result.slots).toHaveLength(30)
  })

  it('ignores a booking belonging to a different practitioner', () => {
    const result = getAvailability({
      date: '2026-09-03',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data({
        bookings: [booking(TOMAS.id, '2026-09-03T08:00:00Z', '2026-09-03T09:00:00Z')],
      }),
    })

    expect(times(result)).toContain('09:00')
  })
})

describe('time off', () => {
  it('refuses an appointment that would span a break', () => {
    // Nadia's lunch, 12:00–12:45 London.
    const result = getAvailability({
      date: '2026-09-03',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data({
        timeOff: [timeOff(NADIA.id, '2026-09-03T11:00:00Z', '2026-09-03T11:45:00Z')],
      }),
    })

    // 11:15 finishes as lunch starts and 12:45 starts as it ends; the four
    // starts in between would all still be running through it.
    expect(times(result)).toContain('11:15')
    expect(times(result)).toContain('12:45')
    for (const blocked of ['11:30', '11:45', '12:00', '12:15', '12:30']) {
      expect(times(result)).not.toContain(blocked)
    }
  })
})

describe('lead time and horizon', () => {
  it('offers nothing inside the next two hours', () => {
    // 10:10 London on the Thursday itself. The first bookable start is the
    // first grid slot at or after 12:10.
    const result = getAvailability({
      date: '2026-09-03',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: new Date('2026-09-03T09:10:00Z'),
      data: data(),
    })

    expect(result.slots[0]?.time).toBe('12:15')
  })

  it('offers nothing beyond sixty days', () => {
    // Thursday 29 October is inside the horizon from 1 September; Thursday
    // 5 November is not.
    const inside = getAvailability({
      date: '2026-10-29',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data(),
    })
    const outside = getAvailability({
      date: '2026-11-05',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data(),
    })

    expect(inside.slots.length).toBeGreaterThan(0)
    expect(outside.slots).toEqual([])
  })
})

describe('daylight saving', () => {
  it('keeps the working day at the same wall clock either side of the change', () => {
    // The clocks go back on Sunday 25 October 2026. Nadia works 08:00–16:00
    // on the Thursday before and the Monday after, and she works those hours
    // on both — a fixed-offset implementation moves one of these days by an
    // hour and nothing else in the suite would notice.
    const before = getAvailability({
      date: '2026-10-22',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data(),
    })
    const after = getAvailability({
      date: '2026-10-26',
      serviceId: ASSESSMENT.id,
      practitionerId: NADIA.id,
      now: NOW,
      data: data(),
    })

    expect(before.slots[0]?.time).toBe('08:00')
    expect(after.slots[0]?.time).toBe('08:00')
    expect(before.slots).toHaveLength(30)
    expect(after.slots).toHaveLength(30)

    // The same wall clock, an hour apart in absolute time. This is the
    // assertion that fails if the offset is computed once and reused.
    expect(before.slots[0]?.startsAt.toISOString()).toBe('2026-10-22T07:00:00.000Z')
    expect(after.slots[0]?.startsAt.toISOString()).toBe('2026-10-26T08:00:00.000Z')
  })
})

describe('no practitioner preference', () => {
  it('unions the practitioners who offer the service, tagging each slot', () => {
    // Wednesday 2 September. Nadia is in 08:00–16:00, Tomas 10:00–18:00,
    // Grace not at all.
    const result = getAvailability({
      date: '2026-09-02',
      serviceId: FOLLOW_UP.id,
      practitionerId: 'any',
      now: NOW,
      data: data({service: FOLLOW_UP}),
    })

    const at = (time: string) =>
      result.slots.filter((slot) => slot.time === time).map((s) => s.practitionerName)

    expect(at('08:00')).toEqual(['Nadia Okafor'])
    expect(at('10:00')).toEqual(['Nadia Okafor', 'Tomas Iriarte'])
    expect(at('17:00')).toEqual(['Tomas Iriarte'])
    expect(result.slots.map((s) => s.practitionerName)).not.toContain('Grace Whitfield')
  })

  it('sorts by time, then by practitioner, so the grid reads in order', () => {
    const result = getAvailability({
      date: '2026-09-02',
      serviceId: FOLLOW_UP.id,
      practitionerId: 'any',
      now: NOW,
      data: data({service: FOLLOW_UP}),
    })

    const ascending = result.slots.every(
      (slot, i) => i === 0 || result.slots[i - 1].startsAt <= slot.startsAt,
    )
    expect(ascending).toBe(true)
  })

  it('drops a practitioner whose only free time is taken', () => {
    // Tomas is booked solid on the Wednesday; Nadia is not.
    const result = getAvailability({
      date: '2026-09-02',
      serviceId: FOLLOW_UP.id,
      practitionerId: 'any',
      now: NOW,
      data: data({
        service: FOLLOW_UP,
        bookings: [booking(TOMAS.id, '2026-09-02T09:00:00Z', '2026-09-02T17:00:00Z')],
      }),
    })

    expect(result.slots.map((s) => s.practitionerName)).not.toContain('Tomas Iriarte')
    expect(result.slots.map((s) => s.practitionerName)).toContain('Nadia Okafor')
  })
})
