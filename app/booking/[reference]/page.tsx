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
import {formatDateWithYear, formatDuration, formatPrice} from '../../../src/format.ts'
import {SiteHeader} from '../../SiteHeader.tsx'
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
  const minutes = (detail.endsAt.getTime() - detail.startsAt.getTime()) / 60_000

  return (
    <>
      <SiteHeader />

      <main id="main" tabIndex={-1} className="focus:outline-none mx-auto w-full max-w-5xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
          <h1 className="text-2xl font-medium">Your appointment</h1>

          {/*
            Status is stated in words and marked with a border weight, not
            carried by colour alone. Printed in greyscale, or read aloud, it
            still says which of the two this is.
          */}
          <p
            className={`inline-block border-2 px-3 py-1 text-sm font-medium ${
              cancelled ? 'border-danger text-danger' : 'border-accent text-accent'
            }`}
          >
            {cancelled ? 'Cancelled' : 'Confirmed'}
          </p>
        </div>

        {cancelled && detail.cancellationReason ? (
          <p className="mt-5 border-2 border-danger px-4 py-3 text-sm text-danger">
            Cancelled — {detail.cancellationReason}. The time has been released and is
            available to book again.
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
              <Row
                label="When"
                tabular
                value={`${formatDateWithYear(date)}, ${formatTime(detail.startsAt)} to ${formatTime(detail.endsAt)}`}
              />
              <Row label="Length" tabular value={formatDuration(minutes)} />
              <Row label="Booked for" value={detail.clientName} />
              <Row label="Price" tabular value={formatPrice(detail.pricePence)} />
            </dl>
          </section>

          <aside className="border border-line">
            <h2 className="border-b border-line bg-surface-2 px-4 py-2 font-mono text-xs tracking-[0.14em] text-muted uppercase">
              {cancelled ? 'Next' : 'Manage'}
            </h2>
            <div className="px-4 py-3 text-sm">
              {!cancelled ? (
                <a
                  href={`/api/ics/${detail.reference}`}
                  className="block border-2 border-accent px-4 py-2 text-center font-medium text-accent transition-colors duration-[120ms] hover:bg-surface-2"
                >
                  Add to calendar
                </a>
              ) : (
                <Link
                  href="/book"
                  className="block border-2 border-accent bg-accent px-4 py-2 text-center font-medium text-accent-ink transition-colors duration-[120ms] hover:border-ink hover:bg-ink"
                >
                  Book another appointment
                </Link>
              )}

              {!cancelled && !started ? <CancelForm reference={detail.reference} /> : null}

              {!cancelled && started ? (
                <p className="mt-3 text-ink-2">
                  This appointment has already started, so it can no longer be cancelled
                  here. Phone the clinic.
                </p>
              ) : null}

              {!cancelled ? (
                <p className="mt-3 border-t border-line pt-3 text-xs text-ink-2">
                  Free cancellation up to 24 hours before your appointment.
                </p>
              ) : null}
            </div>
          </aside>
        </div>
      </main>
    </>
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
