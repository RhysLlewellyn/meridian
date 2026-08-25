import type {Metadata} from 'next'
import Link from 'next/link'

import {listServices} from '../../src/availability/query.ts'
import {getDb} from '../../src/db/index.ts'
import {formatDurationShort, formatPrice} from '../../src/format.ts'
import {BookingFrame} from './BookingFrame.tsx'
import {Unavailable} from '../unavailable.tsx'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {title: 'Choose a service'}

export default async function ChooseService() {
  let services: Awaited<ReturnType<typeof listServices>>
  try {
    services = await listServices(getDb())
  } catch {
    return <Unavailable booking title="Choose a service" retry="/book" current="book" />
  }

  return (
    <BookingFrame step={1} title="Choose a service" selection={{}}>
      <p className="text-ink-2">
        Not sure? An initial assessment is the right first appointment for anything new.
      </p>

      <ul className="mt-4 grid border-t border-l border-line sm:grid-cols-2 xl:grid-cols-3">
        {services.map((service) => (
          <li key={service.id} className="border-r border-b border-line bg-surface">
            <Link
              href={`/book/${service.slug}`}
              className="flex h-full flex-col p-4 transition-colors duration-[120ms] hover:bg-surface-2"
            >
              <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
                {service.specialty}
              </p>
              <h2 className="mt-1 font-medium">{service.name}</h2>
              <p className="mt-2 text-sm text-ink-2">{service.description}</p>
              <p className="tabular mt-auto border-t border-line pt-3 text-sm">
                {formatDurationShort(service.defaultDurationMinutes)}
                {/* Spoken as a comma, drawn as a middot. */}
                <span className="sr-only">, </span>
                <span className="mx-2 text-muted" aria-hidden="true">
                  ·
                </span>
                {formatPrice(service.pricePence)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </BookingFrame>
  )
}
