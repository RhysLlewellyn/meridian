import Link from 'next/link'

/**
 * The public chrome.
 *
 * Meridian is allowed furniture that Fieldnote is not: this is a tool with a
 * persistent bar across the top, not an editorial object that begins with its
 * own title. It stays put while the booking grid scrolls, so the way out is
 * always in the same place.
 */
export function SiteHeader({current}: {current?: 'book' | 'staff'}) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-6 py-3">
        <Link
          href="/"
          className="-my-1 py-1 font-mono text-xs tracking-[0.14em] uppercase transition-colors duration-[120ms] hover:text-accent"
        >
          Meridian
        </Link>

        <span className="hidden text-xs text-muted sm:inline">
          Physiotherapy &amp; rehabilitation
        </span>

        <nav aria-label="Main" className="ml-auto flex items-center gap-2 text-sm">
          <Link
            href="/staff"
            aria-current={current === 'staff' ? 'page' : undefined}
            className="border border-line px-3 py-1.5 transition-colors duration-[120ms] hover:bg-surface-2"
          >
            Front desk
          </Link>
          <Link
            href="/book"
            aria-current={current === 'book' ? 'page' : undefined}
            className="border-2 border-accent bg-accent px-3 py-1.5 font-medium text-accent-ink transition-colors duration-[120ms] hover:bg-ink hover:border-ink"
          >
            Book
          </Link>
        </nav>
      </div>
    </header>
  )
}
