import {describe, expect, it} from 'vitest'

import {
  formatTime,
  instantFromWallClock,
  parseCalendarDate,
  parseWallClockTime,
  weekdayOf,
  zoneOffsetMs,
} from './time'

const HOUR = 3_600_000

/** `at('2026-10-25', '09:00')` — the instant London reads as that wall clock. */
function at(date: string, time: string): Date {
  return instantFromWallClock(parseCalendarDate(date), parseWallClockTime(time))
}

describe('zoneOffsetMs', () => {
  it('is +1 hour during British Summer Time and 0 in winter', () => {
    expect(zoneOffsetMs(new Date('2026-08-01T12:00:00Z'))).toBe(HOUR)
    expect(zoneOffsetMs(new Date('2026-12-01T12:00:00Z'))).toBe(0)
  })

  it('changes across the October transition, not at the start of the month', () => {
    // The clocks go back at 02:00 BST on Sunday 25 October 2026.
    expect(zoneOffsetMs(new Date('2026-10-25T00:59:00Z'))).toBe(HOUR)
    expect(zoneOffsetMs(new Date('2026-10-25T01:01:00Z'))).toBe(0)
  })
})

describe('instantFromWallClock', () => {
  it('resolves the same wall clock to different instants either side of DST', () => {
    // This is the bug the whole file exists to prevent. A practitioner works
    // 09:00 on both days; the instants are an hour apart and neither reading
    // is 08:00.
    expect(at('2026-10-22', '09:00').toISOString()).toBe('2026-10-22T08:00:00.000Z')
    expect(at('2026-10-26', '09:00').toISOString()).toBe('2026-10-26T09:00:00.000Z')
  })

  it('round-trips through formatTime', () => {
    for (const date of ['2026-03-28', '2026-03-29', '2026-10-25', '2026-10-26']) {
      expect(formatTime(at(date, '14:30'))).toBe('14:30')
    }
  })

  it('resolves the repeated hour to one of its two instants, and reads back', () => {
    // 01:30 happens twice on 25 October, once in BST and once in GMT. Either
    // is a defensible answer; what matters is that the one returned reads back
    // as 01:30 rather than as 00:30 or 02:30. No working day starts here.
    const ambiguous = at('2026-10-25', '01:30')
    expect(ambiguous.toISOString()).toBe('2026-10-25T01:30:00.000Z')
    expect(formatTime(ambiguous)).toBe('01:30')
  })

  it('rounds a wall clock that does not exist forward rather than throwing', () => {
    // 01:30 on 29 March 2026 never happens — the clocks jump 01:00 to 02:00.
    expect(at('2026-03-29', '01:30').toISOString()).toBe('2026-03-29T01:30:00.000Z')
    expect(formatTime(at('2026-03-29', '01:30'))).toBe('02:30')
  })
})

describe('weekdayOf', () => {
  it('numbers Sunday as 0, matching working_hours.weekday', () => {
    expect(weekdayOf(parseCalendarDate('2026-10-25'))).toBe(0)
    expect(weekdayOf(parseCalendarDate('2026-10-26'))).toBe(1)
    expect(weekdayOf(parseCalendarDate('2026-09-03'))).toBe(4)
  })
})

describe('parsing', () => {
  it('rejects anything that is not a date or a time', () => {
    expect(() => parseCalendarDate('3 September 2026')).toThrow(/YYYY-MM-DD/)
    expect(() => parseWallClockTime('9am')).toThrow(/HH:MM/)
  })

  it('accepts a time with or without seconds, as Postgres returns both', () => {
    expect(parseWallClockTime('09:00')).toEqual({hour: 9, minute: 0, second: 0})
    expect(parseWallClockTime('09:00:00')).toEqual({hour: 9, minute: 0, second: 0})
  })
})
