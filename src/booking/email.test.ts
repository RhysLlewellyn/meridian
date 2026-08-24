/**
 * The one thing the confirmation email must never do is throw.
 *
 * By the time it runs the appointment is committed, so an exception here does
 * not fail an email — it fails a page belonging to a booking that genuinely
 * exists, and sends somebody away thinking they have no appointment when they
 * do. Every path below returns a reason instead.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {
  composeConfirmationEmail,
  sendConfirmationEmail,
  type ConfirmationEmail,
} from './email.ts'

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
const originalRecipient = process.env.DEMO_EMAIL_RECIPIENT

afterEach(() => {
  process.env.RESEND_API_KEY = originalKey
  if (originalRecipient === undefined) delete process.env.DEMO_EMAIL_RECIPIENT
  else process.env.DEMO_EMAIL_RECIPIENT = originalRecipient
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

describe('with an API key, writing to the allowlisted address', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.DEMO_EMAIL_RECIPIENT = 'someone@example.com'
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

/**
 * The demo only delivers to one address, because the form that feeds this is
 * public and would otherwise be a button for emailing strangers. Withholding is
 * not a failure and must not be reported as one — the composed email comes back
 * so the confirmation page can show what would have gone.
 */
describe('writing to any other address', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.DEMO_EMAIL_RECIPIENT = 'clinic@example.com'
  })

  it('does not send, and returns the email it would have sent', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const outcome = await sendConfirmationEmail(DETAIL)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(outcome.sent).toBe(false)
    expect(outcome.sent === false && outcome.withheld).toBe(true)

    // The same object the sender would have posted, not a second rendering of
    // it: anything else would drift the first time the copy changed.
    expect(outcome.sent === false && outcome.withheld && outcome.email).toEqual(
      composeConfirmationEmail(DETAIL),
    )
  })

  it('composes a real message rather than a placeholder', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const outcome = await sendConfirmationEmail(DETAIL)
    const email = outcome.sent === false && outcome.withheld ? outcome.email : null

    expect(email?.to).toBe('someone@example.com')
    expect(email?.from).toBe('Meridian <onboarding@resend.dev>')
    expect(email?.subject).toContain('Tuesday 25 August 2026 at 08:30')
    expect(email?.text).toContain('MRD-8F3K')
    expect(email?.text).toContain('Nadia Okafor')
    expect(email?.attachment).toBe('meridian-MRD-8F3K.ics')
    expect(email?.ics).toContain('BEGIN:VCALENDAR')
  })

  it('matches the allowlist regardless of case or surrounding space', async () => {
    process.env.DEMO_EMAIL_RECIPIENT = '  SomeOne@Example.com  '
    const fetchSpy = vi.fn(async () => new Response('{"id":"1"}', {status: 200}))
    vi.stubGlobal('fetch', fetchSpy)

    const outcome = await sendConfirmationEmail(DETAIL)

    expect(outcome).toEqual({sent: true})
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('withholds when no recipient is configured at all', async () => {
    delete process.env.DEMO_EMAIL_RECIPIENT
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    // A missing allowlist must fail closed. The opposite default would turn a
    // deployment that forgot one variable into an open mail relay.
    const outcome = await sendConfirmationEmail(DETAIL)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(outcome.sent === false && outcome.withheld).toBe(true)
  })
})
