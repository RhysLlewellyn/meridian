import type {Metadata} from 'next'
import Link from 'next/link'
import {notFound, redirect} from 'next/navigation'

import {
  getServiceBySlug,
  listPractitionersForService,
} from '../../../../../src/availability/query.ts'
import {getDb} from '../../../../../src/db/index.ts'
import {BookingFrame} from '../../../BookingFrame.tsx'
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
    <BookingFrame
      step={4}
      selection={{
        service: {name: service.name, slug: service.slug, specialty: service.specialty},
        practitioner: {name: practitioner.name, title: practitioner.title},
        when: {date, time},
        durationMinutes: practitioner.durationMinutes,
        pricePence: practitioner.pricePence,
      }}
    >
      <h1 className="text-xl font-medium">Your details</h1>
      <p className="mt-1 text-ink-2">
        The panel has what you have chosen.{' '}
        <Link
          href={`/book/${service.slug}/${practitionerSlug}?date=${date}`}
          className="underline underline-offset-4"
        >
          Change the time
        </Link>{' '}
        if it is not right.
      </p>

      <DetailsForm
        service={service.slug}
        practitioner={practitionerSlug}
        date={date}
        time={time}
      />
    </BookingFrame>
  )
}
