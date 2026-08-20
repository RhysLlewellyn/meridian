import Link from 'next/link'

import {
  listDayBookings,
  listPractitioners,
  practitionersOnShift,
  today,
} from '../../src/availability/query.ts'
import {formatTime, shiftDate} from '../../src/availability/time.ts'
import {CancelForm} from '../booking/[reference]/CancelForm.tsx'
import {getDb} from '../../src/db/index.ts'
import {formatDate, formatDateShort, formatDuration} from '../../src/format.ts'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

type Props = {
  /** A practitioner slug, or undefined for everybody. */
  practitionerSlug?: string
  date?: string
  /** The reference of the row whose detail panel is open, from the URL. */
  open?: string
}

/**
 * The day at the front desk.
 *
 * A day list rather than a week grid. A seven-column grid is hard to read, bad
 * on a phone and awkward to make accessible, and a receptionist is answering
 * "what is happening now" forty times a day rather than surveying a fortnight.
 *
 * Every piece of state — which day, which practitioner, which row is open — is
 * in the URL, so a colleague can be sent a link to exactly what is being
 * talked about on the phone.
 */
export async function StaffSchedule({practitionerSlug, date: dateParam, open}: Props) {
  const date = dateParam && DATE_PATTERN.test(dateParam) ? dateParam : today()

  const db = getDb()
  const [bookings, onShift, everybody] = await Promise.all([
    listDayBookings(db, date, practitionerSlug),
    practitionersOnShift(db, date),
    listPractitioners(db),
  ])

  const confirmed = bookings.filter((b) => b.status === 'confirmed')
  const cancelled = bookings.filter((b) => b.status === 'cancelled')
  const minutes = confirmed.reduce(
    (total, b) => total + (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000,
    0,
  )

  const selected = open ? bookings.find((b) => b.reference === open) : undefined
  const base = practitionerSlug ? `/staff/${practitionerSlug}` : '/staff'
  const href = (params: {date?: string; booking?: string}) => {
    const search = new URLSearchParams({date: params.date ?? date})
    if (params.booking) search.set('booking', params.booking)
    return `${base}?${search}`
  }

  return (
    <div className="flex min-h-screen">
      <StaffNav />

      <main className="min-w-0 flex-1 px-6 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-medium">Schedule</h1>
          <p className="tabular text-sm text-muted">{formatDate(date)}</p>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
          <Stat label="Appointments" value={confirmed.length} />
          <Stat label="Practitioners in" value={onShift.length} />
          <Stat label="Hours booked" value={(minutes / 60).toFixed(1)} />
          <Stat label="Cancellations" value={cancelled.length} />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link
            href={href({date: shiftDate(date, -1)})}
            className="border border-line px-3 py-1.5 text-sm transition-colors duration-[120ms] hover:bg-surface-2"
          >
            ← {formatDateShort(shiftDate(date, -1))}
          </Link>
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="staff-date" className="sr-only">
              Jump to date
            </label>
            <input
              id="staff-date"
              type="date"
              name="date"
              defaultValue={date}
              className="tabular border border-line bg-surface px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="border border-line px-3 py-1.5 text-sm transition-colors duration-[120ms] hover:bg-surface-2"
            >
              Go
            </button>
          </form>
          <Link
            href={href({date: shiftDate(date, 1)})}
            className="border border-line px-3 py-1.5 text-sm transition-colors duration-[120ms] hover:bg-surface-2"
          >
            {formatDateShort(shiftDate(date, 1))} →
          </Link>
          <Link
            href={href({date: today()})}
            className="border border-line px-3 py-1.5 text-sm transition-colors duration-[120ms] hover:bg-surface-2"
          >
            Today
          </Link>
        </div>

        {/*
          The same filter the availability engine understands: all
          practitioners, or one. It is a row of links rather than a select,
          because the current state has to be visible without opening anything.
        */}
        <nav aria-label="Filter by practitioner" className="mt-3 flex flex-wrap gap-2">
          <Chip href={`/staff?date=${date}`} active={!practitionerSlug}>
            All practitioners
          </Chip>
          {everybody.map((person) => (
            <Chip
              key={person.id}
              href={`/staff/${person.slug}?date=${date}`}
              active={person.slug === practitionerSlug}
            >
              {person.name}
            </Chip>
          ))}
        </nav>

        {bookings.length === 0 ? (
          <p className="mt-6 border border-line px-4 py-6 text-sm text-muted">
            Nothing booked on {formatDate(date)}.
          </p>
        ) : (
          <table className="mt-4 w-full border-collapse text-sm">
            <caption className="sr-only">
              Appointments on {formatDate(date)}, earliest first
            </caption>
            <thead>
              <tr className="border-y border-line text-left text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Time
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Client
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Practitioner and service
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Status
                </th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Detail</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((row) => (
                <tr
                  key={row.reference}
                  className={`border-b border-line ${
                    row.reference === selected?.reference ? 'bg-surface-2' : ''
                  }`}
                >
                  <td className="tabular py-2 pr-3 align-top whitespace-nowrap">
                    {formatTime(row.startsAt)}–{formatTime(row.endsAt)}
                  </td>
                  <td className="py-2 pr-3 align-top">{row.clientName}</td>
                  <td className="py-2 pr-3 align-top">
                    {row.practitionerName}
                    <span className="block text-muted">{row.serviceName}</span>
                  </td>
                  <td className="py-2 pr-3 align-top">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="py-2 align-top text-right">
                    <Link
                      href={
                        row.reference === selected?.reference
                          ? href({})
                          : href({booking: row.reference})
                      }
                      className="underline underline-offset-4"
                    >
                      {row.reference === selected?.reference ? 'Close' : 'Open'}
                      <span className="sr-only"> {row.reference}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {selected ? <DetailPanel booking={selected} closeHref={href({})} /> : null}
      </main>
    </div>
  )
}

function Stat({label, value}: {label: string; value: number | string}) {
  return (
    <div className="bg-surface px-3 py-3">
      <dt className="text-xs tracking-[0.08em] text-muted uppercase">{label}</dt>
      <dd className="tabular mt-1 text-2xl font-medium">{value}</dd>
    </div>
  )
}

/**
 * Status carries in three ways at once — the word, the border weight and the
 * fill — so it survives greyscale, a colour-blind reader and a screen reader.
 * Colour alone would carry it for none of them.
 */
function StatusBadge({status}: {status: 'confirmed' | 'cancelled'}) {
  return status === 'cancelled' ? (
    <span className="border-2 border-danger px-2 py-0.5 text-xs font-medium text-danger">
      Cancelled
    </span>
  ) : (
    <span className="border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium">
      Confirmed
    </span>
  )
}

function Chip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`border px-3 py-1.5 text-sm transition-colors duration-[120ms] ${
        active
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-line hover:bg-surface-2'
      }`}
    >
      {children}
    </Link>
  )
}

async function DetailPanel({
  booking,
  closeHref,
}: {
  booking: Awaited<ReturnType<typeof listDayBookings>>[number]
  closeHref: string
}) {
  const started = booking.startsAt <= new Date()

  return (
    <section aria-label={`Appointment ${booking.reference}`} className="mt-6 border-2 border-line p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-medium">
          {booking.clientName}
          <span className="tabular ml-3 font-mono text-sm font-normal text-muted">
            {booking.reference}
          </span>
        </h2>
        <Link href={closeHref} className="text-sm underline underline-offset-4">
          Close
        </Link>
      </div>

      <dl className="mt-3 text-sm">
        <div className="flex gap-4 py-0.5">
          <dt className="w-28 shrink-0 text-muted">When</dt>
          <dd className="tabular">
            {formatTime(booking.startsAt)}–{formatTime(booking.endsAt)},{' '}
            {formatDuration(
              (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
            )}
          </dd>
        </div>
        <div className="flex gap-4 py-0.5">
          <dt className="w-28 shrink-0 text-muted">With</dt>
          <dd>
            {booking.practitionerName} — {booking.serviceName}
          </dd>
        </div>
        <div className="flex gap-4 py-0.5">
          <dt className="w-28 shrink-0 text-muted">Email</dt>
          <dd>{booking.clientEmail}</dd>
        </div>
        <div className="flex gap-4 py-0.5">
          <dt className="w-28 shrink-0 text-muted">Phone</dt>
          <dd>{booking.clientPhone ?? 'Not given'}</dd>
        </div>
        {booking.cancellationReason ? (
          <div className="flex gap-4 py-0.5">
            <dt className="w-28 shrink-0 text-muted">Reason</dt>
            <dd>{booking.cancellationReason}</dd>
          </div>
        ) : null}
      </dl>

      {booking.status === 'confirmed' && !started ? (
        <CancelForm reference={booking.reference} />
      ) : null}
    </section>
  )
}

/**
 * The sidebar the spec asks for, with three of its four entries honestly
 * unbuilt. A demo that links to Appointments, Practitioners and Settings and
 * 404s on all three is worse than one that says what is here.
 */
function StaffNav() {
  return (
    <nav
      aria-label="Staff sections"
      className="w-44 shrink-0 border-r border-line bg-surface-2 px-3 py-6"
    >
      <p className="px-2 font-mono text-xs tracking-[0.14em] text-muted uppercase">
        Meridian
      </p>
      <ul className="mt-6 space-y-1 text-sm">
        <li>
          <span
            aria-current="page"
            className="block border-l-2 border-accent bg-surface px-2 py-1.5 font-medium"
          >
            Schedule
          </span>
        </li>
        {['Appointments', 'Practitioners', 'Settings'].map((label) => (
          <li key={label}>
            <span className="block px-2 py-1.5 text-muted">{label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 px-2 text-xs text-muted">
        Schedule only in this demo. The other three are not built.
      </p>
      <p className="mt-6 px-2 text-xs">
        <Link href="/" className="underline underline-offset-4">
          Public site
        </Link>
      </p>
    </nav>
  )
}
