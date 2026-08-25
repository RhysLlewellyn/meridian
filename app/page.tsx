import Link from 'next/link'

import {
  listPractitionersWithSpecialties,
  listServices,
  today,
} from '../src/availability/query.ts'
import {nextAvailableByPractitioner} from '../src/availability/next-available.ts'
import {getDb} from '../src/db/index.ts'
import {formatDurationShort, formatPrice} from '../src/format.ts'
import {AppShell} from './AppShell.tsx'
import {PractitionerDirectory} from './PractitionerDirectory.tsx'

// Reads the clinic's services and practitioners, so it is rendered per request
// rather than baked at build time against whatever database happened to be
// reachable from CI.
export const dynamic = 'force-dynamic'

export default async function Home() {
  const db = getDb()
  const [services, practitioners, next] = await Promise.all([
    listServices(db),
    listPractitionersWithSpecialties(db),
    nextAvailableByPractitioner(),
  ])

  const specialties = [...new Set(services.map((s) => s.specialty))].sort()

  return (
    <AppShell current="clinic" title="The clinic" meta={'Physiotherapy & rehabilitation'}>
      <div className="flex flex-wrap items-center justify-between gap-4 border border-line bg-surface px-4 py-3">
        <p className="max-w-[60ch] text-sm text-ink-2">
          Three practitioners, five appointment types. You see the same availability the
          front desk sees — no account, no deposit.
        </p>
        <Link
          href="/book"
          className="border-2 border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-colors duration-[120ms] pointer-coarse:py-3 hover:border-ink hover:bg-ink hover:text-ground"
        >
          Start booking
        </Link>
      </div>

      <section aria-labelledby="services-heading" className="mt-6">
        <h2
          id="services-heading"
          className="font-mono text-xs tracking-[0.14em] text-muted uppercase"
        >
          Appointments
        </h2>

        <ul className="mt-3 grid border-t border-l border-line sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {services.map((row) => (
            <li key={row.id} className="border-r border-b border-line bg-surface">
              <Link
                href={`/book/${row.slug}`}
                className="flex h-full flex-col p-4 transition-colors duration-[120ms] hover:bg-surface-2"
              >
                <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
                  {row.specialty}
                </p>
                <h3 className="mt-1 font-medium">{row.name}</h3>
                <p className="mt-2 text-sm text-ink-2">{row.description}</p>

                {/*
                  The two facts a patient actually needs, held at the foot of
                  every card so they line up across the row however long the
                  descriptions above them run.
                */}
                <p className="tabular mt-auto border-t border-line pt-3 text-sm">
                  {formatDurationShort(row.defaultDurationMinutes)}
                  {/* Spoken as a comma, drawn as a middot. */}
                  <span className="sr-only">, </span>
                  <span className="mx-2 text-muted" aria-hidden="true">
                    ·
                  </span>
                  {formatPrice(row.pricePence)}
                </p>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-3 max-w-[70ch] text-sm text-muted">
          Lengths and prices are the standard ones. Both can differ by practitioner — an
          initial assessment takes Tomas an hour where it takes Nadia forty-five minutes —
          and the next step shows what it is with each of them.
        </p>
      </section>

      {/*
        The rail links here, so the anchor has to clear the sticky header it
        would otherwise scroll underneath.
      */}
      <section
        id="practitioners"
        aria-labelledby="practitioners-heading"
        className="mt-8 scroll-mt-20"
      >
        <h2
          id="practitioners-heading"
          className="font-mono text-xs tracking-[0.14em] text-muted uppercase"
        >
          Practitioners
        </h2>

        <PractitionerDirectory
          today={today()}
          specialties={specialties}
          practitioners={practitioners.map((person) => ({
            id: person.id,
            name: person.name,
            slug: person.slug,
            title: person.title,
            bio: person.bio,
            specialties: person.specialties,
            next: next[person.id],
          }))}
        />
      </section>

      <p className="mt-8 max-w-[70ch] border-t border-line pt-4 text-sm text-muted">
        Meridian is an invented clinic, built to demonstrate a booking system. The
        practitioners are fictional, the appointments are not real, and nobody is expecting
        you.
      </p>
    </AppShell>
  )
}
