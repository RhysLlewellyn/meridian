import Link from 'next/link'

/**
 * The shell every booking step sits in.
 *
 * No step indicator with ticks and a progress bar. The steps are four short
 * pages and the browser already has a back button; the heading of each page
 * says where you are.
 */
export default function BookLayout({children}: {children: React.ReactNode}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="font-mono text-xs tracking-[0.14em] text-muted uppercase">
        <Link href="/" className="underline underline-offset-4 hover:text-ink">
          Meridian
        </Link>
      </p>
      {children}
    </div>
  )
}
