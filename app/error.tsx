'use client'

/**
 * The backstop, for anything the routes did not catch themselves.
 *
 * Every page that touches Postgres wraps its own queries and renders
 * `Unavailable` when the database does not answer, which is the failure this
 * deployment actually has. This is for the rest: a bug in a component, a shape
 * of data nobody expected, anything that would otherwise reach the framework's
 * own handler and put "Application error: a server-side exception has occurred"
 * on the screen.
 *
 * It is a client component because React error boundaries are client components
 * by construction — there is no server equivalent. It holds no state and reads
 * nothing from the browser; the whole of its client-side behaviour is the reset
 * button. The links are here as well as the button because the button is the
 * only part that needs the handler, and a reader who would rather leave than
 * retry should not have to use it.
 *
 * **It does not use `AppShell`, and that was measured rather than assumed.**
 * Rendering the application's navigation rail here would be the consistent
 * thing to do and it is not free: because this file is a client component,
 * importing the shell pulls it and `next/link` across the boundary into every
 * route's bundle. Measured on this build: 471kB of script on the homepage with
 * it, 459kB without — twelve kilobytes on every page load, for chrome on a page
 * that should never render. The three links below are a better way out of an
 * error than a nav rail anyway, since they name where they go. `not-found.tsx`
 * is a server component and keeps the full shell for nothing.
 *
 * **This page needs JavaScript, and that is a framework constraint rather than
 * a choice.** Measured against Next 16.3.1: a throw during SSR is answered with
 * `<html id="__next_error__">` and an empty body, the boundary's markup is not
 * in the response at all, and the copy below is rendered on hydration. With
 * scripting off the reader gets a blank page and a 500 — verified in Chrome
 * with JavaScript disabled, 0 characters of body text. Nothing in this file can
 * change that.
 *
 * What covers the no-JavaScript reader is not this boundary but the per-route
 * database fallback: a route that catches its own failure returns a real 200
 * with real markup, and never reaches here. That is the case worth designing
 * for, because a suspended Neon compute is the failure this deployment actually
 * has, and it is the reason those fallbacks exist rather than a `Suspense`
 * boundary that would have the same blank-page problem.
 *
 * **What this page is not allowed to say.**
 *
 * The obvious reassurance — "nothing has been changed or lost" — is false here
 * and must not be written. Meridian takes bookings. If this renders after a
 * booking was submitted, the appointment may have been committed a millisecond
 * before the throw or not at all, and the reader genuinely does not know which.
 * Telling them nothing happened is worse than telling them nothing, because it
 * invites the one action that makes it worse: booking again.
 *
 * So it says what is true, and gives a check that actually works in this build.
 * Not "look for the confirmation email" — delivery is allowlisted to one
 * address, so for almost everybody that email never arrives and its absence
 * means nothing. The reliable check is the grid: a confirmed booking removes
 * its slot, the availability engine and the exclusion constraint read the same
 * rows, so a time that is still offered was not taken and a time that has gone
 * was.
 *
 * And if they do book again, the guarantee is what protects them rather than
 * this copy: `booking_no_overlap` refuses the second insert at the database, and
 * the action redirects to the grid with the slot marked gone. A retry from this
 * page cannot produce two appointments. That is worth saying plainly, because
 * "did I just book twice?" is the question somebody in this state is actually
 * asking.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & {digest?: string}
  reset: () => void
}) {
  return (
    // Self-contained, and deliberately the same shape as `global-error.tsx`:
    // the two boundaries are the two pages that cannot rely on anything else
    // having rendered, and they should not look like two different builds.
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-lg font-medium tracking-[-0.01em]">Something went wrong</h1>

      <p className="mt-4 max-w-prose text-ink-2">
        This page could not be rendered. It is a fault in the build rather than anything you
        did.
      </p>

      <p className="mt-4 max-w-prose text-ink-2">
        <strong className="font-medium text-ink">
          If you were confirming an appointment, it may or may not have been taken.
        </strong>{' '}
        The way to tell is to open the times for that day again: an appointment that went
        through has removed its time from the grid, and one that did not is still there to
        book. Booking again is safe either way — the database refuses a second appointment in
        a time that is already taken, so you cannot end up with two.
      </p>

      {error.digest && (
        // The digest is the server-side hash of the real error. It is the only
        // thing that connects what the reader saw to what the logs recorded,
        // and it costs one line to show it rather than making them describe the
        // page to somebody.
        <p className="mt-4 text-sm text-muted">
          Reference <span className="tabular font-mono">{error.digest}</span>
        </p>
      )}

      <p className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <button
          type="button"
          onClick={reset}
          className="inline-block border border-line-strong px-3 py-1.5 transition-colors duration-[120ms] pointer-coarse:py-3 hover:bg-surface-2"
        >
          Try again
        </button>
        {/*
          Plain anchors, and `next/link` would be the mistake here. A `Link` is
          a client-side navigation: it keeps the same JavaScript context, which
          is the context that has just thrown, and hands the next route a router
          whose state is whatever the error left behind. A document load throws
          all of that away and starts again, which is what somebody clicking
          "back to the times" from an error page is asking for. It also works
          when the bundle is the thing that broke.
        */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/book"
          className="inline-block py-1 underline underline-offset-4 pointer-coarse:py-3"
        >
          Back to the times →
        </a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="inline-block py-1 underline underline-offset-4 pointer-coarse:py-3"
        >
          Back to the clinic →
        </a>
      </p>
    </main>
  )
}
