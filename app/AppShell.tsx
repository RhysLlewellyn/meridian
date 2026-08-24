import Link from 'next/link'

/**
 * The application shell: a navigation rail on the left, a sticky bar at the
 * top of the content area, and everything else inside one `<main>`.
 *
 * This is the structural difference between Meridian and an editorial site,
 * and it is deliberate. A site is a document: full-width header, centred
 * column, long scroll. An application is a frame with a view inside it —
 * navigation that never moves, a header that stays put while the content
 * beneath it changes, and content that fills the space it is given rather
 * than sitting in a measure. Colour is the easy half of a divergence; this is
 * the half a viewer registers first.
 *
 * One shell for every route, the patient-facing ones included. The booking
 * flow is a surface of the same product as the front desk, not a separate
 * website with the same palette bolted on.
 *
 * On narrow viewports the rail becomes a bar across the top — a 13rem rail on
 * a 390px screen is a third of the viewport spent on navigation — and the
 * sticky content header stays sticky, because that is the one that carries the
 * step indicator.
 */

export type NavKey = 'clinic' | 'book' | 'practitioners' | 'schedule'

const NAV: {key: NavKey; label: string; href: string}[] = [
  {key: 'clinic', label: 'The clinic', href: '/'},
  {key: 'book', label: 'Book an appointment', href: '/book'},
  {key: 'practitioners', label: 'Practitioners', href: '/#practitioners'},
  {key: 'schedule', label: 'Staff schedule', href: '/staff'},
]

type Props = {
  current?: NavKey
  /** The page's `<h1>`. It lives in the sticky bar, where it stays visible. */
  title: React.ReactNode
  /** Right of the title: the date at the front desk, the reference on a booking. */
  meta?: React.ReactNode
  /** A second row in the sticky bar — the booking flow's step indicator. */
  toolbar?: React.ReactNode
  /** A panel beside the content: the booking summary, the appointment actions. */
  aside?: React.ReactNode
  /**
   * Prose keeps a measure; application screens do not. Section 7 of the brief
   * allows exactly one exception to "no reading measure", and this is it —
   * the confirmation and manage screens are a paragraph and a receipt, not a
   * tool.
   */
  measure?: boolean
  children: React.ReactNode
}

export function AppShell({
  current,
  title,
  meta,
  toolbar,
  aside,
  measure,
  children,
}: Props) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[13.5rem_1fr]">
      <Rail current={current} />

      <main id="main" tabIndex={-1} className="focus:outline-none flex min-w-0 flex-col">
        {/*
          Sticky, and inside the landmark rather than above it. Things that
          stay put while content moves are tool behaviour; a heading a screen
          reader user cannot find after jumping to `<main>` is not.
        */}
        <header className="sticky top-0 z-10 border-b border-line bg-surface">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
            <h1 className="text-lg font-medium tracking-[-0.01em]">{title}</h1>
            {meta ? (
              <p className="tabular font-mono text-xs tracking-[0.06em] text-muted">
                {meta}
              </p>
            ) : null}
          </div>
          {toolbar ? <div className="border-t border-line px-4 py-2">{toolbar}</div> : null}
        </header>

        <div
          className={`flex-1 px-4 py-4 ${measure ? 'mx-auto w-full max-w-3xl' : 'w-full'}`}
        >
          {aside ? (
            <div className="grid items-start gap-4 xl:grid-cols-[1fr_18rem]">
              <div className="min-w-0">{children}</div>
              {aside}
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  )
}

function Rail({current}: {current?: NavKey}) {
  return (
    // A real `<header>`, so the brand block and the note beneath the links sit
    // inside a landmark. Content outside every landmark is content a screen
    // reader user can only reach by walking the document, and axe's `region`
    // rule is right to call it.
    <header className="border-b border-line bg-ground lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
      <div className="flex items-center gap-3 border-line px-4 py-3 lg:border-b lg:py-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 transition-opacity duration-[120ms] hover:opacity-80"
        >
          <span
            aria-hidden="true"
            className="grid h-6 w-6 shrink-0 place-items-center bg-accent text-xs font-semibold text-accent-ink"
          >
            M
          </span>
          <span className="leading-tight">
            <span className="block font-semibold tracking-[-0.01em]">Meridian</span>
            <span className="block font-mono text-[0.625rem] tracking-[0.14em] text-muted uppercase">
              Physiotherapy
            </span>
          </span>
        </Link>
      </div>

      {/*
        A row on a phone, a column at a desk. Same links, same order, same
        current marker — a left border at a desk, a bottom border in the row,
        because a left border on a horizontal item marks the wrong edge.
      */}
      <nav aria-label="Main" className="overflow-x-auto lg:mt-2 lg:overflow-visible">
        <ul className="flex text-sm lg:block">
          {NAV.map((item) => {
            const active = item.key === current
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`block border-transparent px-4 py-2.5 whitespace-nowrap transition-colors duration-[120ms] lg:border-l-2 ${
                    active
                      ? 'bg-surface-2 font-medium text-ink lg:border-l-accent'
                      : 'text-ink-2 hover:bg-surface hover:text-ink'
                  } ${active ? 'border-b-2 border-b-accent lg:border-b-0' : 'border-b-2 border-b-transparent lg:border-b-0'}`}
                >
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <p className="hidden px-4 pt-4 text-xs text-muted lg:block">
        An invented clinic, built to demonstrate a booking system. Nobody is expecting you.
      </p>
    </header>
  )
}
