import Link from 'next/link'

import {formatDate, formatDuration, formatPrice} from '../../src/format.ts'

/**
 * The shell around steps 1–4.
 *
 * Two pieces of chrome, both of which exist to stop four pages feeling like
 * four errands.
 *
 * The **step indicator** says how many there are and which one this is, so the
 * first screen is not an unbounded commitment. Completed steps are real links
 * back, because they are real URLs — the flow keeps its whole state in the
 * path and the query string, so going back two steps and forward again lands
 * on exactly the same grid.
 *
 * The **summary panel** answers "what have I picked" without a back
 * navigation. Every line is present from step one, reading "Not selected yet"
 * until it is filled, so the panel has one shape throughout rather than
 * growing rows as it goes — the eye learns where the date lives before there
 * is a date in it. The cancellation policy sits inside it because that is
 * where the commitment is being made, and a person deciding whether to give
 * their email address should not have to go looking for it.
 */

export type FrameService = {name: string; slug: string; specialty: string}

/** A named practitioner, or the "no preference" choice, which is also a choice. */
export type FramePractitioner = {name: string; title: string} | 'any'

export type BookingSelection = {
  service?: FrameService
  practitioner?: FramePractitioner
  when?: {date: string; time: string}
  /** Known only once a practitioner is, because it is theirs and not the service's. */
  durationMinutes?: number
  pricePence?: number
}

type Props = {
  step: 1 | 2 | 3 | 4
  selection: BookingSelection
  children: React.ReactNode
}

const STEPS = ['Service', 'Practitioner', 'Time', 'Details'] as const

export function BookingFrame({step, selection, children}: Props) {
  const {service, practitioner} = selection

  // Where each completed step goes back to. A step with nowhere to return to
  // — step 3 before a practitioner exists — is not rendered as a link.
  const hrefs: (string | undefined)[] = [
    '/book',
    service ? `/book/${service.slug}` : undefined,
    undefined,
    undefined,
  ]

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      {/*
        A landmark, not a loose list. The indicator sits outside <main> so it
        stays put while the step changes, and content outside every landmark
        is content a screen reader user can only reach by walking the whole
        document.
      */}
      <nav aria-label="Booking steps">
        <ol className="flex flex-wrap items-stretch gap-px border border-line bg-line">
        {STEPS.map((label, index) => {
          const number = index + 1
          const state = number < step ? 'done' : number === step ? 'current' : 'upcoming'
          const href = state === 'done' ? hrefs[index] : undefined

          const inner = (
            <>
              <span
                className={`tabular flex h-5 w-5 shrink-0 items-center justify-center border text-xs font-medium ${
                  state === 'current'
                    ? 'border-accent bg-accent text-accent-ink'
                    : state === 'done'
                      ? 'border-ink bg-ink text-surface'
                      : 'border-line text-muted'
                }`}
              >
                {number}
              </span>
              <span className={state === 'upcoming' ? 'text-muted' : undefined}>
                {label}
              </span>
              {/*
                The three states differ in fill, border and weight, so they
                survive greyscale. They also have to differ in words, or a
                screen reader hears four identical items.
              */}
              <span className="sr-only">
                {state === 'done'
                  ? ' — completed'
                  : state === 'current'
                    ? ' — current step'
                    : ' — not reached yet'}
              </span>
            </>
          )

          return (
            <li key={label} className="flex-1 bg-surface">
              {href ? (
                <Link
                  href={href}
                  className="flex h-full items-center gap-2 px-3 py-2 text-sm font-medium transition-colors duration-[120ms] hover:bg-surface-2"
                >
                  {inner}
                </Link>
              ) : (
                <span
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={`flex h-full items-center gap-2 px-3 py-2 text-sm ${
                    state === 'current' ? 'font-medium' : ''
                  }`}
                >
                  {inner}
                </span>
              )}
            </li>
            )
          })}
        </ol>
      </nav>

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[1fr_17rem]">
        <main id="main" tabIndex={-1} className="focus:outline-none min-w-0">
          {children}
        </main>

        <aside
          aria-labelledby="summary-heading"
          className="border border-line lg:sticky lg:top-20"
        >
          <h2
            id="summary-heading"
            className="border-b border-line bg-surface-2 px-4 py-2 font-mono text-xs tracking-[0.14em] text-muted uppercase"
          >
            Your appointment
          </h2>

          <dl className="px-4 py-3 text-sm">
            <Row label="Service" value={service?.name} />
            <Row
              label="Practitioner"
              value={
                practitioner === 'any'
                  ? 'No preference'
                  : practitioner
                    ? `${practitioner.name}, ${practitioner.title}`
                    : undefined
              }
            />
            <Row
              label="Date & time"
              tabular
              value={
                selection.when
                  ? `${formatDate(selection.when.date)}, ${selection.when.time}`
                  : undefined
              }
            />
            {selection.durationMinutes ? (
              <Row label="Length" tabular value={formatDuration(selection.durationMinutes)} />
            ) : null}
            {selection.pricePence ? (
              <Row label="Price" tabular value={formatPrice(selection.pricePence)} />
            ) : null}
          </dl>

          <p className="border-t border-line px-4 py-3 text-xs text-ink-2">
            Free cancellation up to 24 hours before your appointment. No payment is taken
            online.
          </p>
        </aside>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  tabular,
}: {
  label: string
  value?: string
  tabular?: boolean
}) {
  return (
    <div className="border-b border-line py-2 last:border-0 last:pb-0 first:pt-0">
      <dt className="text-xs tracking-[0.06em] text-muted uppercase">{label}</dt>
      <dd className={`mt-0.5 ${value ? (tabular ? 'tabular' : '') : 'text-muted'}`}>
        {value ?? 'Not selected yet'}
      </dd>
    </div>
  )
}
