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
import {Unavailable} from '../../../../unavailable.tsx'

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

  let service: Awaited<ReturnType<typeof getServiceBySlug>>
  let practitioners: Awaited<ReturnType<typeof listPractitionersForService>> = []
  try {
    service = await getServiceBySlug(db, serviceSlug)
    if (service) practitioners = await listPractitionersForService(db, service.id)
  } catch {
    return (
      <Unavailable
        booking
        title="Your details"
        retry={`/book/${serviceSlug}/${practitionerSlug}`}
        current="book"
      />
    )
  }
  if (!service) notFound()

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
      title="Your details"
      selection={{
        service: {name: service.name, slug: service.slug, specialty: service.specialty},
        practitioner: {name: practitioner.name, title: practitioner.title},
        when: {date, time},
        durationMinutes: practitioner.durationMinutes,
        pricePence: practitioner.pricePence,
      }}
    >
      {/*
        Position-neutral on purpose. The summary sits beside this form on a
        laptop and beneath it on a phone, and copy that says "the panel on the
        right" is wrong for half the people reading it.
      */}
      <p className="text-ink-2">
        Your appointment is summarised with this form.{' '}
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
