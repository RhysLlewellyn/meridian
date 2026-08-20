import {describe, expect, it} from 'vitest'

import {buildCalendar, calendarFilename} from './ics.ts'

const EVENT = {
  reference: 'MRD-8F3K',
  serviceName: 'Initial assessment',
  practitionerName: 'Nadia Okafor',
  practitionerTitle: 'MSK Physiotherapist',
  startsAt: new Date('2026-08-25T07:30:00.000Z'),
  endsAt: new Date('2026-08-25T08:15:00.000Z'),
  status: 'confirmed' as const,
  now: new Date('2026-08-20T09:00:00.000Z'),
}

describe('buildCalendar', () => {
  it('writes UTC timestamps with no punctuation and a trailing Z', () => {
    const ics = buildCalendar(EVENT)
    expect(ics).toContain('DTSTART:20260825T073000Z')
    expect(ics).toContain('DTEND:20260825T081500Z')
    expect(ics).toContain('DTSTAMP:20260820T090000Z')
  })

  it('ends every line with CRLF, including the last', () => {
    const ics = buildCalendar(EVENT)
    // Split on CRLF and there should be no stray LF left anywhere.
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.split('\r\n').join('')).not.toContain('\n')
  })

  it('keeps the UID stable so a re-download updates rather than duplicates', () => {
    expect(buildCalendar(EVENT)).toContain('UID:MRD-8F3K@meridian.clinic')
    expect(buildCalendar({...EVENT, now: new Date('2026-08-21T00:00:00Z')})).toContain(
      'UID:MRD-8F3K@meridian.clinic',
    )
  })

  it('escapes the characters that mean something to the format', () => {
    const ics = buildCalendar({
      ...EVENT,
      serviceName: 'Assessment; extended, with notes\\reports',
    })
    expect(ics).toContain('Assessment\\; extended\\, with notes\\\\reports')
  })

  it('folds long lines at 75 octets and continues with a space', () => {
    const ics = buildCalendar({
      ...EVENT,
      practitionerName: 'A'.repeat(120),
    })
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
    expect(ics).toMatch(/\r\n /)
  })

  it('never splits a multi-byte character across a fold', () => {
    const ics = buildCalendar({...EVENT, practitionerName: 'é'.repeat(100)})
    // If a fold landed mid-character the string would round-trip with U+FFFD.
    expect(ics).not.toContain('�')
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
  })

  it('marks a cancelled appointment as cancelled', () => {
    expect(buildCalendar({...EVENT, status: 'cancelled'})).toContain('STATUS:CANCELLED')
  })
})

describe('calendarFilename', () => {
  it('names the file after the reference', () => {
    expect(calendarFilename('MRD-8F3K')).toBe('meridian-MRD-8F3K.ics')
  })
})
