import type {Metadata} from 'next'
import Link from 'next/link'
import {notFound} from 'next/navigation'

import {
  ANY,
  getServiceBySlug,
  listPractitionersForService,
} from '../../../src/availability/query.ts'
import {getDb} from '../../../src/db/index.ts'
import {formatDurationShort, formatPrice} from '../../../src/format.ts'
import {BookingFrame} from '../BookingFrame.tsx'

export const dynamic = 'force-dynamic'

type Props = {params: Promise<{service: string}>}

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {service} = await params
  const row = await getServiceBySlug(getDb(), service)
  return {title: row ? `${row.name} — choose a practitioner` : 'Choose a practitioner'}
}

export default async function ChoosePractitioner({params}: Props) {
  const db = getDb()
  const {service: serviceSlug} = await params
  const service = await getServiceBySlug(db, serviceSlug)
  if (!service) notFound()

  const practitioners = await listPractitionersForService(db, service.id)

  return (
    <BookingFrame
      step={2}
      selection={{
        service: {name: service.name, slug: service.slug, specialty: service.specialty},
      }}
    >
      <h1 className="text-xl font-medium">Choose a practitioner</h1>
      <p className="mt-1 text-ink-2">
        {service.name} — {service.description}
      </p>

      <ul className="mt-5 border-t border-line">
        <li className="border-b border-line">
          <Link
            href={`/book/${service.slug}/${ANY}`}
            className="flex gap-6 px-1 py-4 transition-colors duration-[120ms] hover:bg-surface-2"
          >
            <div className="flex-1">
              <h2 className="font-medium">No preference</h2>
              <p className="mt-1 text-sm text-ink-2">
                Show every free appointment, whoever it is with. Usually the fastest way to
                be seen.
              </p>
            </div>
          </Link>
        </li>

        {practitioners.map((person) => (
          <li key={person.id} className="border-b border-line">
            <Link
              href={`/book/${service.slug}/${person.slug}`}
              className="flex items-start gap-6 px-1 py-4 transition-colors duration-[120ms] hover:bg-surface-2"
            >
              <div className="flex-1">
                <h2 className="font-medium">
                  {person.name}
                  <span className="ml-2 font-normal text-muted">{person.title}</span>
                </h2>
                <p className="mt-1 text-sm text-ink-2">{person.bio}</p>
              </div>

              {/*
                The length and the price are per practitioner, not per service.
                Tomas takes an hour over an assessment that Nadia does in
                forty-five minutes, and both the diary and the invoice follow
                him rather than the service — which is the single row in
                `practitioner_service` that makes the availability engine
                non-trivial, shown here where somebody can act on it.
              */}
              <p className="tabular w-32 shrink-0 text-right text-sm">
                {formatDurationShort(person.durationMinutes)}
                {/* Spoken as a comma, drawn as a middot. */}
                <span className="sr-only">, </span>
                <span className="mx-2 text-muted" aria-hidden="true">
                  ·
                </span>
                {formatPrice(person.pricePence)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </BookingFrame>
  )
}
