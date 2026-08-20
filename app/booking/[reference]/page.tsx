import type {Metadata} from 'next'
import Link from 'next/link'
import {notFound} from 'next/navigation'

import {getBookingByReference} from '../../../src/availability/query.ts'
import {
  calendarDateAt,
  formatCalendarDate,
  formatTime,
} from '../../../src/availability/time.ts'
import {getDb} from '../../../src/db/index.ts'
import {formatDateWithYear, formatPrice} from '../../../src/format.ts'
import {CancelForm} from './CancelForm.tsx'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {title: 'Your appointment'}

type Props = {params: Promise<{reference: string}>}

export default async function ManageBooking({params}: Props) {
  const {reference} = await params
  const detail = await getBookingByReference(getDb(), reference)
  if (!detail) notFound()

  const date = formatCalendarDate(calendarDateAt(detail.startsAt))
  const cancelled = detail.status === 'cancelled'
  const started = detail.startsAt <= new Date()

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
        <Link href="/" className="underline underline-offset-4 hover:text-ink">
          Meridian
        </Link>
      </p>

      <h1 className="mt-6 text-2xl font-medium">Your appointment</h1>

      {/*
        Status is stated in words and marked with a border weight, not carried
        by colour alone. Printed in greyscale, or read aloud, it still says
        which of the two this is.
      */}
      <p
        className={`mt-4 inline-block border-2 px-3 py-1 text-sm font-medium ${
          cancelled ? 'border-danger text-danger' : 'border-accent text-accent'
        }`}
      >
        {cancelled ? 'Cancelled' : 'Confirmed'}
      </p>

      {cancelled && detail.cancellationReason ? (
        <p className="mt-4 text-ink-2">
          Cancelled — {detail.cancellationReason}. The time has been released.
        </p>
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
          <dd className="tabular">
            {formatDateWithYear(date)}, {formatTime(detail.startsAt)} to{' '}
            {formatTime(detail.endsAt)}
          </dd>
        </div>
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-sm text-muted">Booked for</dt>
          <dd>{detail.clientName}</dd>
        </div>
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-sm text-muted">Price</dt>
          <dd className="tabular">{formatPrice(detail.pricePence)}</dd>
        </div>
      </dl>

      {!cancelled ? (
        <p className="mt-6">
          <a
            href={`/api/ics/${detail.reference}`}
            className="inline-block border-2 border-accent px-4 py-2 text-sm font-medium text-accent transition-colors duration-[120ms] hover:bg-surface-2"
          >
            Add to calendar (.ics)
          </a>
        </p>
      ) : null}

      {!cancelled && !started ? <CancelForm reference={detail.reference} /> : null}

      {!cancelled && started ? (
        <p className="mt-8 text-sm text-muted">
          This appointment has already started, so it can no longer be cancelled here.
          Phone the clinic.
        </p>
      ) : null}

      {cancelled ? (
        <p className="mt-8">
          <Link
            href="/book"
            className="inline-block border-2 border-accent bg-accent px-5 py-2.5 font-medium text-accent-ink"
          >
            Book another appointment
          </Link>
        </p>
      ) : null}
    </main>
  )
}
