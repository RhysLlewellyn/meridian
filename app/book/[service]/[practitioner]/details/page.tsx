import type {Metadata} from 'next'
import Link from 'next/link'
import {notFound, redirect} from 'next/navigation'

import {
  getServiceBySlug,
  listPractitionersForService,
} from '../../../../../src/availability/query.ts'
import {getDb} from '../../../../../src/db/index.ts'
import {formatDate, formatDuration, formatPrice} from '../../../../../src/format.ts'
import {DetailsForm} from './DetailsForm.tsx'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {title: 'Your details'}

type Props = {
  params: Promise<{service: string; practitioner: string}>
  searchParams: Promise<{date?: string; time?: string}>
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^\d{2}:\d{2}$/

export default async function Details({params, searchParams}: Props) {
  const {service: serviceSlug, practitioner: practitionerSlug} = await params
  const {date, time} = await searchParams

  const db = getDb()
  const service = await getServiceBySlug(db, serviceSlug)
  if (!service) notFound()

  const practitioners = await listPractitionersForService(db, service.id)
  const practitioner = practitioners.find((p) => p.slug === practitionerSlug)
  if (!practitioner) notFound()

  // Arriving here without an appointment in the URL means a bookmark of the
  // form itself, or a refresh after the slot was cleared. Send them back to
  // the grid rather than showing a form with nothing behind it.
  if (!date || !time || !DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) {
    redirect(`/book/${service.slug}/${practitionerSlug}`)
  }

  return (
    <main>
      <p className="mt-6">
        <Link
          href={`/book/${service.slug}/${practitionerSlug}?date=${date}`}
          className="text-sm text-muted underline underline-offset-4"
        >
          Change time
        </Link>
      </p>

      <h1 className="mt-2 text-2xl font-medium">Your details</h1>

      <dl className="mt-6 border-y border-line py-4 text-sm">
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-muted">Appointment</dt>
          <dd>{service.name}</dd>
        </div>
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-muted">With</dt>
          <dd>
            {practitioner.name}, {practitioner.title}
          </dd>
        </div>
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-muted">When</dt>
          <dd className="tabular">
            {formatDate(date)} at {time}
          </dd>
        </div>
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-muted">Length</dt>
          <dd className="tabular">{formatDuration(practitioner.durationMinutes)}</dd>
        </div>
        <div className="flex gap-4 py-1">
          <dt className="w-32 shrink-0 text-muted">Price</dt>
          <dd className="tabular">{formatPrice(practitioner.pricePence)}</dd>
        </div>
      </dl>

      <DetailsForm
        service={service.slug}
        practitioner={practitionerSlug}
        date={date}
        time={time}
      />
    </main>
  )
}
