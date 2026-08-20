import type {Metadata} from 'next'
import Link from 'next/link'

import {listServices} from '../../src/availability/query.ts'
import {getDb} from '../../src/db/index.ts'
import {formatDuration, formatPrice} from '../../src/format.ts'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {title: 'Choose a service'}

export default async function ChooseService() {
  const services = await listServices(getDb())

  return (
    <main>
      <h1 className="mt-6 text-2xl font-medium">Choose a service</h1>
      <p className="mt-2 text-ink-2">
        Not sure? An initial assessment is the right first appointment for anything new.
      </p>

      <ul className="mt-8 border-t border-line">
        {services.map((service) => (
          <li key={service.id} className="border-b border-line">
            <Link
              href={`/book/${service.slug}`}
              className="flex gap-6 py-4 transition-colors duration-[120ms] hover:bg-surface-2"
            >
              <div className="flex-1">
                <h2 className="font-medium">{service.name}</h2>
                <p className="mt-1 text-sm text-ink-2">{service.description}</p>
              </div>
              <div className="tabular w-28 shrink-0 text-right text-sm text-ink-2">
                <div>{formatPrice(service.pricePence)}</div>
                <div className="text-muted">
                  {formatDuration(service.defaultDurationMinutes)}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
