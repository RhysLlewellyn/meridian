'use client'

import './globals.css'

/**
 * The last resort, for a throw in the root layout itself.
 *
 * `error.tsx` renders *inside* the root layout, so it cannot catch the layout
 * failing. This replaces the whole document instead, which is why it carries
 * its own `<html>` and `<body>` — nothing above it is left to supply them.
 *
 * It is the least likely file in the build to run. Meridian's root layout loads
 * two fonts, imports the stylesheet and renders a skip link; there is no data
 * in it and nothing to throw. It exists because the alternative when it *does*
 * throw is the framework's unstyled default, and because a boundary that has
 * never fired is not evidence it was not needed.
 *
 * Two things it deliberately does without. The font variables are set on
 * `<html>` by the layout that is not running, so the type here is the system
 * stack, stated explicitly rather than left to a `var()` that would resolve to
 * nothing. And there is no `AppShell`: the shell's navigation is exactly the
 * kind of thing that would throw a second time inside a boundary that has
 * nowhere left to fall back to.
 *
 * The copy carries the same warning as `error.tsx` for the same reason — this
 * can fire mid-booking, and the reader has to be told that an appointment may
 * or may not exist rather than reassured that nothing happened.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & {digest?: string}
  reset: () => void
}) {
  return (
    <html lang="en-GB">
      <body
        className="bg-ground text-ink antialiased"
        style={{fontFamily: 'system-ui, sans-serif'}}
      >
        <main className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-lg font-medium tracking-[-0.01em]">Something went wrong</h1>

          <p className="mt-4 max-w-prose text-ink-2">
            Meridian could not render this page at all. It is a fault in the build rather
            than anything you did.
          </p>

          <p className="mt-4 max-w-prose text-ink-2">
            <strong className="font-medium text-ink">
              If you were confirming an appointment, it may or may not have been taken.
            </strong>{' '}
            Open the times for that day again to tell: an appointment that went through has
            removed its time from the grid. Booking again is safe — the database refuses a
            second appointment in a time that is already taken.
          </p>

          {error.digest && (
            <p className="mt-4 text-sm text-muted">
              Reference <span className="font-mono">{error.digest}</span>
            </p>
          )}

          <p className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <button
              type="button"
              onClick={reset}
              className="inline-block border border-line-strong px-3 py-1.5 pointer-coarse:py-3"
            >
              Try again
            </button>
            {/*
              A document load, necessarily: the root layout is what threw, so
              there is no router left to navigate with even if `Link` were
              wanted here.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="inline-block py-1 underline underline-offset-4 pointer-coarse:py-3">
              Back to the clinic →
            </a>
          </p>
        </main>
      </body>
    </html>
  )
}
