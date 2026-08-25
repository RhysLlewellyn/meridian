import type {Metadata} from 'next'
import Link from 'next/link'
import {notFound} from 'next/navigation'

import {
  getBookingByReference,
  getEmailOutcome,
} from '../../../../src/availability/query.ts'
import {
  calendarDateAt,
  formatCalendarDate,
  formatTime,
} from '../../../../src/availability/time.ts'
import {composeConfirmationEmail} from '../../../../src/booking/email.ts'
import {getDb} from '../../../../src/db/index.ts'
import {formatDateWithYear, formatPrice} from '../../../../src/format.ts'
import {AppShell} from '../../../AppShell.tsx'
import {Unavailable} from '../../../unavailable.tsx'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {title: 'Appointment confirmed'}

type Props = {params: Promise<{reference: string}>}

export default async function Confirmation({params}: Props) {
  const {reference} = await params
  const db = getDb()

  // This is the page somebody lands on immediately after booking. Telling them
  // the appointment does not exist because Postgres blinked would be the worst
  // moment in the flow to get wrong.
  let detail: Awaited<ReturnType<typeof getBookingByReference>>
  let email: Awaited<ReturnType<typeof getEmailOutcome>>
  try {
    detail = await getBookingByReference(db, reference)
    if (!detail) {
      // Outside the catch in spirit: a missing row is a 404, not an outage.
      // Assigned so the compiler can see `email` is always set below.
      email = undefined
    } else {
      email = await getEmailOutcome(db, detail.id)
    }
  } catch {
    return (
      <Unavailable title="Appointment confirmed" retry={`/book/confirm/${reference}`} />
    )
  }
  if (!detail) notFound()
  const date = formatCalendarDate(calendarDateAt(detail.startsAt))
  const cancelled = detail.status === 'cancelled'

  return (
    /*
      One of the two exceptions to "no reading measure". The confirmation is a
      receipt and a paragraph, not a tool -- there is nothing here to scan
      across, and a full-width row of five facts on a 27-inch monitor is
      harder to read than a column of them, not easier.
    */
    <AppShell
      current="book"
      measure
      title={cancelled ? 'Appointment cancelled' : 'Appointment confirmed'}
      meta={detail.reference}
    >
      <p className="text-ink-2">
        {cancelled ? (
          <>This appointment has been cancelled and the time released.</>
        ) : (
          <>Booked for {detail.clientName}.</>
        )}
      </p>

      {!cancelled && email && !email.sent && !email.withheld ? (
        // The booking stands. Saying so plainly is better than a silent
        // failure that has somebody waiting for an email that never comes.
        <p className="mt-4 border-l-2 border-pending bg-surface px-4 py-3 text-sm text-pending">
          <strong className="font-medium">The confirmation email did not send.</strong> The
          appointment is booked and the details are below — take a note of the reference, or
          add it to your calendar using the button.
        </p>
      ) : null}

      {!cancelled && email?.sent ? (
        <p className="mt-4 border-l-2 border-accent bg-surface px-4 py-3 text-sm text-ink-2">
          A confirmation is on its way to {detail.clientEmail}, with a calendar file
          attached.
        </p>
      ) : null}

      <div className="mt-4 grid items-start gap-4 md:grid-cols-[1fr_15rem]">
        <section
          aria-labelledby="detail-heading"
          className="min-w-0 border border-line bg-surface"
        >
          <h2
            id="detail-heading"
            className="border-b border-line bg-ground px-4 py-2 font-mono text-xs tracking-[0.12em] text-muted uppercase"
          >
            Appointment
          </h2>
          <dl className="px-4 py-3 text-sm">
            <Row label="Reference" mono value={detail.reference} />
            <Row label="Service" value={detail.serviceName} />
            <Row
              label="Practitioner"
              value={`${detail.practitionerName}, ${detail.practitionerTitle}`}
            />
            {/*
              Rendered from the stored instant in the clinic's timezone, not
              from anything the browser knows. The appointment is at 09:15 in
              the building, whatever the laptop that opens this page thinks.
            */}
            <Row
              label="When"
              tabular
              value={`${formatDateWithYear(date)}, ${formatTime(detail.startsAt)} to ${formatTime(detail.endsAt)}`}
            />
            <Row label="Price" tabular value={formatPrice(detail.pricePence)} />
          </dl>
        </section>

        <aside className="border border-line bg-surface">
          <h2 className="border-b border-line bg-ground px-4 py-2 font-mono text-xs tracking-[0.12em] text-muted uppercase">
            Next
          </h2>
          <div className="px-4 py-3 text-sm">
            {/*
              A plain link to a route that regenerates the file on request,
              rather than a blob built in the browser. It works with
              JavaScript off, and a cancelled appointment downloads as
              CANCELLED rather than as a stale copy of something that is no
              longer happening.
            */}
            <a
              href={`/api/ics/${detail.reference}`}
              className="block border-2 border-accent px-4 py-2 text-center font-medium text-accent transition-colors duration-[120ms] hover:bg-surface-2"
            >
              Add to calendar
            </a>

            <p className="mt-3 text-ink-2">
              Keep the reference — it is how the clinic finds this appointment, and how you
              get back to it.
            </p>

            <p className="mt-3">
              <Link
                href={`/booking/${detail.reference}`}
                className="underline underline-offset-4"
              >
                View or cancel this appointment
              </Link>
            </p>

            <p className="mt-3 border-t border-line pt-3 text-xs text-ink-2">
              Free cancellation up to 24 hours before your appointment.
            </p>
          </div>
        </aside>
      </div>

      {!cancelled && email?.withheld ? <WithheldEmail detail={detail} /> : null}
    </AppShell>
  )
}

/**
 * The email that would have gone, shown because it did not.
 *
 * Composed by `composeConfirmationEmail`, which is the same function the sender
 * calls — so this is not a mock-up of the email, it is the email, rendered
 * instead of posted.
 */
function WithheldEmail({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getBookingByReference>>>
}) {
  const date = formatCalendarDate(calendarDateAt(detail.startsAt))
  const email = composeConfirmationEmail({
    to: detail.clientEmail,
    clientName: detail.clientName,
    reference: detail.reference,
    serviceName: detail.serviceName,
    practitionerName: detail.practitionerName,
    practitionerTitle: detail.practitionerTitle,
    startsAt: detail.startsAt,
    endsAt: detail.endsAt,
    status: 'confirmed',
    whenText: `${formatDateWithYear(date)} at ${formatTime(detail.startsAt)}`,
  })

  return (
    <section
      aria-labelledby="withheld-heading"
      className="mt-4 border border-line bg-surface"
    >
      <h2
        id="withheld-heading"
        className="border-b border-line bg-ground px-4 py-2 font-mono text-xs tracking-[0.12em] text-muted uppercase"
      >
        Delivery is restricted in this demo
      </h2>

      <div className="px-4 py-3">
        <p className="text-sm text-ink-2">
          Meridian&rsquo;s booking form is public, and it takes whatever email address is
          typed into it. A demo that sends to that address is a demo that will email a
          stranger on request, so delivery is allowlisted to the clinic&rsquo;s own address
          and every other booking gets the email shown here instead. It is composed by the
          same function that posts it to Resend, so this is the message itself rather than
          an illustration of it.
        </p>

        <dl className="mt-3 border-t border-line pt-3 text-sm">
          <EmailRow label="From" value={email.from} />
          <EmailRow label="To" value={email.to} />
          <EmailRow label="Subject" value={email.subject} />
          <EmailRow label="Attached" value={email.attachment} />
        </dl>

        {/*
          `whitespace-pre-wrap` rather than a scrolling block: the body is
          nine short lines and its line breaks are part of it.
        */}
        <p className="mt-3 border-t border-line pt-3 font-mono text-xs whitespace-pre-wrap text-ink-2">
          {email.text}
        </p>
      </div>
    </section>
  )
}

function EmailRow({label, value}: {label: string; value: string}) {
  return (
    <div className="flex flex-wrap gap-x-4 py-1">
      <dt className="w-20 shrink-0 font-mono text-micro tracking-[0.1em] text-muted uppercase">
        {label}
      </dt>
      <dd className="min-w-0 font-mono text-xs break-words text-ink">{value}</dd>
    </div>
  )
}

function Row({
  label,
  value,
  tabular,
  mono,
}: {
  label: string
  value: string
  tabular?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-x-4 border-b border-line py-2 first:pt-0 last:border-0 last:pb-0">
      <dt className="w-28 shrink-0 font-mono text-micro tracking-[0.1em] text-muted uppercase">
        {label}
      </dt>
      <dd className={`${tabular || mono ? 'tabular' : ''} ${mono ? 'font-mono font-medium' : ''}`}>
        {value}
      </dd>
    </div>
  )
}
