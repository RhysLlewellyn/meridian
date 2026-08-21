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
import {getDb} from '../../../../src/db/index.ts'
import {formatDateWithYear, formatPrice} from '../../../../src/format.ts'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {title: 'Appointment confirmed'}

type Props = {params: Promise<{reference: string}>}

export default async function Confirmation({params}: Props) {
  const {reference} = await params
  const db = getDb()
  const detail = await getBookingByReference(db, reference)
  if (!detail) notFound()

  const email = await getEmailOutcome(db, detail.id)
  const date = formatCalendarDate(calendarDateAt(detail.startsAt))
  const cancelled = detail.status === 'cancelled'

  return (
    <main id="main" tabIndex={-1} className="focus:outline-none mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-medium">
        {cancelled ? 'Appointment cancelled' : 'Appointment confirmed'}
      </h1>
      <p className="mt-1 text-ink-2">
        {cancelled ? (
          <>This appointment has been cancelled and the time released.</>
        ) : (
          <>Booked for {detail.clientName}.</>
        )}
      </p>

      {!cancelled && email && !email.sent ? (
        // The booking stands. Saying so plainly is better than a silent
        // failure that has somebody waiting for an email that never comes.
        <p className="mt-5 border-2 border-warn px-4 py-3 text-sm text-warn">
          <strong className="font-medium">The confirmation email did not send.</strong> The
          appointment is booked and the details are below — take a note of the reference, or
          add it to your calendar using the button.
        </p>
      ) : null}

      {!cancelled && email?.sent ? (
        <p className="mt-5 border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
          A confirmation is on its way to {detail.clientEmail}, with a calendar file
          attached.
        </p>
      ) : null}

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[1fr_17rem]">
        <section aria-labelledby="detail-heading" className="min-w-0 border border-line">
          <h2
            id="detail-heading"
            className="border-b border-line bg-surface-2 px-4 py-2 font-mono text-xs tracking-[0.14em] text-muted uppercase"
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

        <aside className="border border-line">
          <h2 className="border-b border-line bg-surface-2 px-4 py-2 font-mono text-xs tracking-[0.14em] text-muted uppercase">
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
    </main>
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
      <dt className="w-28 shrink-0 text-xs tracking-[0.06em] text-muted uppercase">
        {label}
      </dt>
      <dd className={`${tabular || mono ? 'tabular' : ''} ${mono ? 'font-mono font-medium' : ''}`}>
        {value}
      </dd>
    </div>
  )
}
