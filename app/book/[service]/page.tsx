import type {Metadata} from 'next'
import Link from 'next/link'
import {notFound} from 'next/navigation'

import {
  ANY,
  getServiceBySlug,
  listPractitionersForService,
} from '../../../src/availability/query.ts'
import {db} from '../../../src/db/index.ts'
import {formatDuration, formatPrice} from '../../../src/format.ts'

export const dynamic = 'force-dynamic'

type Props = {params: Promise<{service: string}>}

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {service} = await params
  const row = await getServiceBySlug(db, service)
  return {title: row ? `${row.name} — choose a practitioner` : 'Choose a practitioner'}
}

export default async function ChoosePractitioner({params}: Props) {
  const {service: serviceSlug} = await params
  const service = await getServiceBySlug(db, serviceSlug)
  if (!service) notFound()

  const practitioners = await listPractitionersForService(db, service.id)

  return (
    <main>
      <p className="mt-6">
        <Link href="/book" className="text-sm text-muted underline underline-offset-4">
          Change service
        </Link>
      </p>

      <h1 className="mt-2 text-2xl font-medium">{service.name}</h1>
      <p className="mt-2 text-ink-2">{service.description}</p>

      <h2 className="mt-8 text-lg font-medium">Choose a practitioner</h2>

      <ul className="mt-4 border-t border-line">
        <li className="border-b border-line">
          <Link
            href={`/book/${service.slug}/${ANY}`}
            className="flex gap-6 py-4 transition-colors duration-[120ms] hover:bg-surface-2"
          >
            <div className="flex-1">
              <h3 className="font-medium">No preference</h3>
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
              className="flex gap-6 py-4 transition-colors duration-[120ms] hover:bg-surface-2"
            >
              <div className="flex-1">
                <h3 className="font-medium">
                  {person.name}
                  <span className="ml-2 font-normal text-muted">{person.title}</span>
                </h3>
                <p className="mt-1 text-sm text-ink-2">{person.bio}</p>
              </div>
              <div className="tabular w-28 shrink-0 text-right text-sm text-ink-2">
                <div>{formatPrice(person.pricePence)}</div>
                {/*
                  The duration is per practitioner, not per service. Tomas takes
                  an hour over an assessment that Nadia does in 45 minutes, and
                  the price and the diary both follow him rather than the
                  service.
                */}
                <div className="text-muted">{formatDuration(person.durationMinutes)}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
