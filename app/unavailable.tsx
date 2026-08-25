import Link from 'next/link'

import {AppShell, type NavKey} from './AppShell.tsx'

/**
 * What a page shows when Postgres does not answer.
 *
 * This deployment runs on Neon's free tier, which suspends its compute when
 * idle. A cold first request therefore has a real chance of finding no database
 * at the other end, and until this existed every route answered that by
 * throwing: the framework's own handler, on the page a prospect clicks into
 * from a link at nine in the evening. Waking a suspended compute is a designed
 * state, not an exception.
 *
 * It keeps the page's own heading and its place in the navigation rather than
 * replacing the screen with a generic error. Somebody who followed a link to
 * the staff schedule should still be looking at a page called Schedule; losing
 * that as well as the data turns a slow database into a wrong address.
 *
 * **Why this is a `try`/`catch` returning markup, and not a `Suspense`
 * boundary or a `loading.tsx`.** Meridian's booking flow works with JavaScript
 * switched off — that is a stated property of the build, and the slot grid and
 * the cancellation form are both built around it. A streamed fallback breaks
 * it. Measured on this build at Next 16.3.1: with a `loading.tsx` on `/staff`
 * and scripting disabled, the page renders 38 characters — the fallback — and
 * stops. The real schedule is in the response, sitting inside a `<div hidden>`
 * waiting for an inline script that will never run, so the reader is left
 * looking at "Loading" permanently. Without it the same page renders 541
 * characters of real content. A fallback that hides the page from the readers
 * it was meant to help is worse than no fallback, so this build has none, and
 * every route resolves its own queries before it returns anything.
 *
 * The retry is a plain link to the same URL. There is nothing to re-run a fetch
 * with on a page that has just failed to render, and there does not need to be:
 * a link back to the current address is exactly what a retry is, it works with
 * scripting off, and it is honest about being a reload.
 */
export function Unavailable({
  title,
  retry,
  current,
  /**
   * What the reader was in the middle of. The booking flow needs a different
   * sentence from the front desk — one of them is a person who cannot book,
   * the other is a clinic that cannot see today.
   */
  booking,
}: {
  title: string
  retry: string
  current?: NavKey
  booking?: boolean
}) {
  return (
    <AppShell measure title={title} current={current}>
      <p className="max-w-prose text-ink-2">
        The database is not answering at the moment, so this page has nothing to show. This
        deployment runs on a free tier that suspends its compute when idle, and waking it
        takes a few seconds.
      </p>

      {/*
        Phrased as a conditional, and the phrasing was measured rather than
        guessed. The obvious copy here is "nothing was submitted from this page,
        so nothing was booked" — and it is false in the one case that matters
        most. With JavaScript switched off the booking form does a native POST:
        the action runs, returns its form state, and Next then re-renders this
        route, which fails its own query and lands here. Verified in Chrome with
        scripting disabled — a submit into a stopped Postgres renders this page,
        not the form. So something *was* submitted, and this component has no
        way to know what became of it.

        It cannot distinguish the two cases, so it says the thing that is true
        in both and leaves the reader a check that works: the grid. As on the
        error boundary, the reassurance that matters is that retrying is safe,
        and it is safe because of the exclusion constraint rather than because
        of anything written here.
      */}
      {booking ? (
        <p className="mt-4 max-w-prose text-ink-2">
          If you were confirming an appointment, this page cannot tell you whether it went
          through. Open the times for that day again once the clinic is back: if yours has
          gone, it was booked. Trying again is safe either way — the database will not
          accept a second appointment in a time that is already taken.
        </p>
      ) : null}

      <p className="mt-6 text-sm">
        <Link
          href={retry}
          className="inline-block border border-line-strong px-3 py-1.5 transition-colors duration-[120ms] pointer-coarse:py-3 hover:bg-surface-2"
        >
          Try again
        </Link>
      </p>
    </AppShell>
  )
}
