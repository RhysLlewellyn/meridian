/**
 * Deliberately empty.
 *
 * The URL exists from the first commit so that everything after it is
 * deployed rather than promised. The interface is step 4 of the build; the
 * availability engine and the concurrency guarantee come first, because a
 * correct engine behind a plain page is worth more than a finished form with
 * a race condition in it.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="font-mono text-xs tracking-[0.14em] text-muted uppercase">Meridian</h1>
      <p className="mt-4 text-lg text-ink-2">
        Physiotherapy and rehabilitation. Under construction — the booking engine is being
        built before the interface that will sit on it.
      </p>
    </main>
  )
}
