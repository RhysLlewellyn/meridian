import {SiteHeader} from '../SiteHeader.tsx'

/**
 * The shell every booking route sits in — the site header and nothing else.
 *
 * The step indicator and the summary panel live in `BookingFrame`, which the
 * four steps render themselves, because a layout in the App Router is not
 * given the URL's search parameters and the panel's whole job is to show what
 * they contain. The confirmation page shares this header and skips the frame:
 * it is the end of the task, not a step in it.
 */
export default function BookLayout({children}: {children: React.ReactNode}) {
  return (
    <>
      <SiteHeader current="book" />
      {children}
    </>
  )
}
