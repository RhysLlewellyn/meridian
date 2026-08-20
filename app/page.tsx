import Link from 'next/link'

import {listPractitioners, listServices} from '../src/availability/query.ts'
import {db} from '../src/db/index.ts'
import {formatDuration, formatPrice} from '../src/format.ts'

// Reads the clinic's services and practitioners, so it is rendered per request
// rather than baked at build time against whatever database happened to be
// reachable from CI.
export const dynamic = 'force-dynamic'

export default async function Home() {
  const [services, practitioners] = await Promise.all([
    listServices(db),
    listPractitioners(db),
  ])

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Meridian</h1>

      <p className="mt-6 max-w-xl text-lg text-ink">
        Physiotherapy and rehabilitation. Three practitioners, one room each, appointments
        from 08:00.
      </p>

      <p className="mt-4 max-w-xl text-ink-2">
        Book online and you will see the same availability the front desk sees. No account,
        no deposit — a name, an email address, and the slot is yours.
      </p>

      <p className="mt-8">
        <Link
          href="/book"
          className="inline-block border-2 border-accent bg-accent px-5 py-2.5 font-medium text-accent-ink"
        >
          Book an appointment
        </Link>
      </p>

      <h2 className="mt-16 border-b border-line pb-2 font-mono text-xs tracking-[0.14em] text-muted uppercase">
        Services
      </h2>
      <ul className="mt-4 divide-y divide-line">
        {services.map((service) => (
          <li key={service.id} className="flex gap-6 py-3">
            <div className="flex-1">
              <h3 className="font-medium">{service.name}</h3>
              <p className="mt-1 text-sm text-ink-2">{service.description}</p>
            </div>
            <div className="tabular w-28 shrink-0 text-right text-sm text-ink-2">
              <div>{formatPrice(service.pricePence)}</div>
              <div className="text-muted">{formatDuration(service.defaultDurationMinutes)}</div>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 border-b border-line pb-2 font-mono text-xs tracking-[0.14em] text-muted uppercase">
        Practitioners
      </h2>
      <ul className="mt-4 divide-y divide-line">
        {practitioners.map((person) => (
          <li key={person.id} className="py-3">
            <h3 className="font-medium">
              {person.name}
              <span className="ml-2 font-normal text-muted">{person.title}</span>
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-ink-2">{person.bio}</p>
          </li>
        ))}
      </ul>

      <p className="mt-12 text-sm text-muted">
        Meridian is a fictional clinic, built as a demonstration of a booking system. The
        appointments are not real and nobody is expecting you.
      </p>
    </main>
  )
}
