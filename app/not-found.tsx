import type {Metadata} from 'next'
import Link from 'next/link'

import {AppShell} from './AppShell.tsx'

/**
 * A real 404.
 *
 * Next ships a default — an unstyled black-on-white line with no navigation —
 * and it is easy to never see, because you have to guess a URL wrong to find
 * it. It is also the page a stranger is most likely to land on from a stale
 * link, and shipping the framework's placeholder there says the build stopped
 * at the happy path. It renders inside the same `AppShell` as everything else,
 * so somebody who mistypes a URL is still visibly inside the application and
 * one click from the thing they came for.
 *
 * **On what this page is allowed to say about a booking reference.**
 *
 * There are three ways to arrive: a mistyped service or practitioner slug, a
 * stale link, and — the likeliest one here — a wrong booking reference. The
 * tempting copy for the third is "there is no appointment with that reference",
 * and it is the wrong copy. A page that answers "does MRD-4K2P exist?"
 * differently from "does MRD-4K2Q exist?" is an enumeration oracle over other
 * people's appointments: the reference is the only credential this build has,
 * there are no accounts behind it, and a million-space of four characters is
 * small enough that a script which can tell hit from miss is worth writing.
 *
 * So this page does not distinguish. It says the address did not resolve and
 * points at the confirmation email, which is where a correct reference actually
 * comes from. It reads very slightly worse for the honest reader who fat-
 * fingered one character, and that is the trade being made deliberately.
 *
 * The disclosure this does not close is the manage page itself: a *correct*
 * reference shows a name, an email and a phone number to whoever holds it,
 * because that is what "no accounts, the reference is the credential" means.
 * That is a property of the design rather than of this file, and narrowing it
 * would be a feature rather than a fix. It is written down in the sign-off.
 *
 * The title matters more here than on a page somebody meant to open. Without
 * it this page inherits the root default and reads "Meridian" in the tab strip
 * and in history — identical to the front page, so a dead link and the clinic
 * are indistinguishable from anywhere except the page itself.
 *
 * **One measured limitation, which is the framework's rather than this file's.**
 * There are two ways to reach a 404 and Next 16.3.1 answers them differently.
 * An address that matches no route at all — `/nonexistent` — is served as an
 * ordinary document and this page renders with scripting off. A `notFound()`
 * called from a route that had already started rendering, which is every
 * interesting case here (a wrong reference, a wrong service slug, a wrong
 * practitioner), streams out of order: the markup arrives inside a `<div
 * hidden>` with an inline script to swap it in, and with JavaScript disabled
 * the swap never runs. Measured in Chrome with scripting off: `/nonexistent`
 * gives 500 characters of body text, `/booking/NOPE-1234`, `/book/not-a-service`
 * and `/staff/nobody` give 0.
 *
 * The status code is correct in every case, so crawlers and link checkers see
 * a 404 either way, and the page is right for anyone running scripts. It is
 * recorded here rather than worked around because the workaround — rendering
 * this content at 200 instead of calling `notFound()` — would trade a blank
 * page for a lie about the status, and that is the worse of the two.
 */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: {index: false, follow: true},
}

export default function NotFound() {
  return (
    <AppShell measure title="Not found">
      <p className="max-w-prose text-ink-2">
        There is nothing at this address. If you followed a link to an appointment, the
        reference may be wrong — it looks like <span className="tabular font-mono">MRD-8F3K</span>{' '}
        and it is on the confirmation email sent when the booking was made.
      </p>

      <p className="mt-4 max-w-prose text-sm text-muted">
        If the reference is right and this page still appears, the appointment may have been
        cancelled. Phone the clinic rather than booking a second time.
      </p>

      <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <li>
          <Link
            href="/book"
            className="inline-block py-1 underline underline-offset-4 pointer-coarse:py-3"
          >
            Book an appointment →
          </Link>
        </li>
        <li>
          <Link
            href="/"
            className="inline-block py-1 underline underline-offset-4 pointer-coarse:py-3"
          >
            Back to the clinic →
          </Link>
        </li>
      </ul>
    </AppShell>
  )
}
