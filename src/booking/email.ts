/**
 * The confirmation email.
 *
 * Sent through Resend's REST API rather than their SDK: the whole of the
 * integration is one POST with a base64 attachment, and a dependency that
 * wraps one POST is a dependency to keep up to date for no reason.
 *
 * Nothing here is allowed to lose a booking. The appointment is already
 * committed by the time this runs, so every failure path — no API key, a bad
 * response, a timeout, a thrown TypeError from fetch — returns a reason rather
 * than raising. The confirmation page reads that reason and says the email did
 * not send, which is a far better outcome for the person who has just booked
 * than a 500 on a page whose appointment actually exists.
 */

import {buildCalendar, calendarFilename, type CalendarEvent} from './ics.ts'

export type EmailOutcome = {sent: true} | {sent: false; reason: string}

const ENDPOINT = 'https://api.resend.com/emails'

/** Resend's shared test sender, which needs no verified domain of our own. */
const FROM = 'Meridian <onboarding@resend.dev>'

const TIMEOUT_MS = 8_000

export type ConfirmationEmail = CalendarEvent & {
  to: string
  clientName: string
  /** `Tuesday 25 August 2026`, already rendered in the clinic's timezone. */
  whenText: string
}

export async function sendConfirmationEmail(
  detail: ConfirmationEmail,
): Promise<EmailOutcome> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    return {sent: false, reason: 'Email is not configured in this environment.'}
  }

  const ics = buildCalendar(detail)
  const body = {
    from: FROM,
    to: [detail.to],
    subject: `Your appointment at Meridian — ${detail.whenText}`,
    text: [
      `Hello ${detail.clientName},`,
      '',
      `Your ${detail.serviceName.toLowerCase()} with ${detail.practitionerName} is booked for ${detail.whenText}.`,
      '',
      `Booking reference: ${detail.reference}`,
      '',
      'The attached calendar file will add it to your diary. If you need to',
      'change or cancel, quote the reference.',
      '',
      'Meridian Physiotherapy and Rehabilitation',
    ].join('\n'),
    attachments: [
      {
        filename: calendarFilename(detail.reference),
        content: Buffer.from(ics, 'utf8').toString('base64'),
      },
    ],
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return {sent: false, reason: `Resend returned ${response.status}. ${text}`.trim()}
    }

    return {sent: true}
  } catch (error) {
    return {sent: false, reason: error instanceof Error ? error.message : String(error)}
  }
}
