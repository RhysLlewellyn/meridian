/**
 * The one thing the confirmation email must never do is throw.
 *
 * By the time it runs the appointment is committed, so an exception here does
 * not fail an email — it fails a page belonging to a booking that genuinely
 * exists, and sends somebody away thinking they have no appointment when they
 * do. Every path below returns a reason instead.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {sendConfirmationEmail, type ConfirmationEmail} from './email.ts'

const DETAIL: ConfirmationEmail = {
  to: 'someone@example.com',
  clientName: 'Marta Kowalczyk',
  reference: 'MRD-8F3K',
  serviceName: 'Initial assessment',
  practitionerName: 'Nadia Okafor',
  practitionerTitle: 'MSK Physiotherapist',
  startsAt: new Date('2026-08-25T07:30:00.000Z'),
  endsAt: new Date('2026-08-25T08:15:00.000Z'),
  status: 'confirmed',
  whenText: 'Tuesday 25 August 2026 at 08:30',
}

const originalKey = process.env.RESEND_API_KEY

afterEach(() => {
  process.env.RESEND_API_KEY = originalKey
  vi.unstubAllGlobals()
})

describe('with no API key', () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY
  })

  it('reports that email is not configured rather than attempting a send', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const outcome = await sendConfirmationEmail(DETAIL)

    expect(outcome).toEqual({
      sent: false,
      reason: 'Email is not configured in this environment.',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('with an API key', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_key'
  })

  it('posts the calendar file as a base64 attachment', async () => {
    const fetchSpy = vi.fn(async () => new Response('{"id":"1"}', {status: 200}))
    vi.stubGlobal('fetch', fetchSpy)

    const outcome = await sendConfirmationEmail(DETAIL)
    expect(outcome).toEqual({sent: true})

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.to).toEqual(['someone@example.com'])
    expect(body.attachments[0].filename).toBe('meridian-MRD-8F3K.ics')

    const ics = Buffer.from(body.attachments[0].content, 'base64').toString('utf8')
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('DTSTART:20260825T073000Z')
  })

  it('returns the status when Resend refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('over quota', {status: 429})),
    )

    const outcome = await sendConfirmationEmail(DETAIL)
    expect(outcome.sent).toBe(false)
    expect(outcome.sent === false && outcome.reason).toContain('429')
  })

  it('returns a reason when the request throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    const outcome = await sendConfirmationEmail(DETAIL)
    expect(outcome).toEqual({sent: false, reason: 'fetch failed'})
  })
})
