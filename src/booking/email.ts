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
 *
 * **Delivery is restricted on purpose.** Meridian's booking form is public and
 * takes an email address from anybody who fills it in. A demo that sends to
 * whatever is typed into that box is a demo that will email a stranger on
 * request, and the person who has to answer for that is the one whose name is
 * on the repository. So the send is allowlisted to a single address, and every
 * other booking gets the *composed* email rendered on the confirmation page
 * instead — the same object that would have been posted to Resend, built by
 * the same function, so what is shown cannot drift from what would have gone.
 */

import {buildCalendar, calendarFilename, type CalendarEvent} from './ics.ts'

/** The message itself, separated from the sending of it so both paths agree. */
export type ComposedEmail = {
  from: string
  to: string
  subject: string
  text: string
  /** The calendar attachment's filename; its body is `ics`. */
  attachment: string
  ics: string
}

export type EmailOutcome =
  | {sent: true}
  | {sent: false; reason: string; withheld?: undefined}
  /** Not a failure. The address is not the demo's allowlisted one. */
  | {sent: false; withheld: true; reason: string; email: ComposedEmail}

const ENDPOINT = 'https://api.resend.com/emails'

/**
 * Resend's shared sender, deliberately. Verifying a domain would mean DNS on a
 * personal domain for a fictional clinic, and the allowlist below makes the
 * shared sender's one real limitation — it delivers only to the account's own
 * address — into the demo's stated rule rather than a surprise.
 */
const FROM = 'Meridian <onboarding@resend.dev>'

const TIMEOUT_MS = 8_000

export type ConfirmationEmail = CalendarEvent & {
  to: string
  clientName: string
  /** `Tuesday 25 August 2026`, already rendered in the clinic's timezone. */
  whenText: string
}

/**
 * Build the message, without deciding whether to send it.
 *
 * Pure, and exported, because the confirmation page renders exactly this when
 * the address is not the allowlisted one. Two code paths writing the same email
 * would eventually write two different emails; one function cannot.
 */
export function composeConfirmationEmail(detail: ConfirmationEmail): ComposedEmail {
  return {
    from: FROM,
    to: detail.to,
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
    attachment: calendarFilename(detail.reference),
    ics: buildCalendar(detail),
  }
}

/**
 * Whether this address is the one the demo is allowed to write to.
 *
 * Case-insensitive and trimmed: an address typed into a form on a phone arrives
 * capitalised as often as not, and an allowlist that fails on `Rhys@` where it
 * passes on `rhys@` fails silently and looks like a broken integration.
 *
 * With no `DEMO_EMAIL_RECIPIENT` set nothing is allowlisted, which is the right
 * way round — a misconfiguration should stop the demo emailing strangers,
 * not start it.
 */
function isAllowlisted(to: string): boolean {
  const allowed = process.env.DEMO_EMAIL_RECIPIENT?.trim().toLowerCase()
  return Boolean(allowed) && to.trim().toLowerCase() === allowed
}

export async function sendConfirmationEmail(
  detail: ConfirmationEmail,
): Promise<EmailOutcome> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    return {sent: false, reason: 'Email is not configured in this environment.'}
  }

  const email = composeConfirmationEmail(detail)

  if (!isAllowlisted(detail.to)) {
    return {
      sent: false,
      withheld: true,
      reason:
        'This is a public demo, so a confirmation is only delivered to the ' +
        'clinic’s own address. The email is shown on the confirmation page instead.',
      email,
    }
  }

  const body = {
    from: email.from,
    to: [email.to],
    subject: email.subject,
    text: email.text,
    attachments: [
      {
        filename: email.attachment,
        content: Buffer.from(email.ics, 'utf8').toString('base64'),
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
