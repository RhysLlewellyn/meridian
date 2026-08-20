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

  return (
    <main>
      <h1 className="mt-6 text-2xl font-medium">
        {detail.status === 'cancelled' ? 'Appointment cancelled' : 'Appointment confirmed'}
      </h1>

      <p className="mt-2 text-ink-2">
        {detail.status === 'cancelled' ? (
          <>This appointment has been cancelled and the time released.</>
        ) : (
          <>Booked for {detail.clientName}.</>
        )}
      </p>

      {detail.status === 'confirmed' && email && !email.sent ? (
        // The booking stands. Saying so plainly is better than a silent
        // failure that has somebody waiting for an email that never comes.
        <p className="mt-4 border-2 border-warn px-4 py-3 text-sm text-warn">
          <strong className="font-medium">The confirmation email did not send.</strong> The
          appointment is booked and the details are below — take a note of the reference, or
          add it to your calendar using the link underneath.
        </p>
      ) : null}

      {detail.status === 'confirmed' && email?.sent ? (
        <p className="mt-4 text-ink-2">A confirmation is on its way to {detail.clientEmail}.</p>
      ) : null}

      <dl className="mt-8 border-y border-line py-4">
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-sm text-muted">Reference</dt>
          <dd className="tabular font-mono font-medium">{detail.reference}</dd>
        </div>
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-sm text-muted">Appointment</dt>
          <dd>{detail.serviceName}</dd>
        </div>
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-sm text-muted">With</dt>
          <dd>
            {detail.practitionerName}, {detail.practitionerTitle}
          </dd>
        </div>
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-sm text-muted">When</dt>
          {/*
            Rendered from the stored instant in the clinic's timezone, not from
            anything the browser knows. The appointment is at 09:15 in the
            building, whatever the laptop that opens this page thinks.
          */}
          <dd className="tabular">
            {formatDateWithYear(date)}, {formatTime(detail.startsAt)} to{' '}
            {formatTime(detail.endsAt)}
          </dd>
        </div>
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-sm text-muted">Price</dt>
          <dd className="tabular">{formatPrice(detail.pricePence)}</dd>
        </div>
      </dl>

      <p className="mt-6">
        {/*
          A plain link to a route that regenerates the file on request, rather
          than a blob built in the browser. It works with JavaScript off, and a
          cancelled appointment downloads as CANCELLED rather than as a stale
          copy of something that is no longer happening.
        */}
        <a
          href={`/api/ics/${detail.reference}`}
          className="inline-block border-2 border-accent px-4 py-2 text-sm font-medium text-accent transition-colors duration-[120ms] hover:bg-surface-2"
        >
          Add to calendar (.ics)
        </a>
      </p>

      <p className="mt-6 text-sm text-ink-2">
        Keep the reference. It is how the clinic finds this appointment, and how you get
        back to it:{' '}
        <Link
          href={`/booking/${detail.reference}`}
          className="underline underline-offset-4"
        >
          view or cancel this appointment
        </Link>
        .
      </p>

      <p className="mt-8">
        <Link href="/" className="text-sm underline underline-offset-4">
          Back to Meridian
        </Link>
      </p>
    </main>
  )
}
