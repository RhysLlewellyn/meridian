import Link from 'next/link'

import {
  listDayBookings,
  listPractitioners,
  practitionersOnShift,
  today,
} from '../../src/availability/query.ts'
import {formatTime, shiftDate} from '../../src/availability/time.ts'
import {AppShell} from '../AppShell.tsx'
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
    <AppShell current="schedule" title="Schedule" meta={formatDate(date)}>
      <dl className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
        <Stat label="Appointments" value={confirmed.length} />
        <Stat label="Practitioners in" value={onShift.length} />
        <Stat label="Hours booked" value={(minutes / 60).toFixed(1)} />
        <Stat label="Cancellations" value={cancelled.length} />
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DayLink href={href({date: shiftDate(date, -1)})}>
          ← {formatDateShort(shiftDate(date, -1))}
        </DayLink>
        <form method="get" className="flex items-center gap-2">
          <label htmlFor="staff-date" className="sr-only">
            Jump to date
          </label>
          <input
            id="staff-date"
            type="date"
            name="date"
            defaultValue={date}
            className="tabular border border-line-strong bg-surface px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="border border-line-strong px-3 py-1.5 text-sm transition-colors duration-[120ms] hover:bg-surface-2"
          >
            Go
          </button>
        </form>
        <DayLink href={href({date: shiftDate(date, 1)})}>
          {formatDateShort(shiftDate(date, 1))} →
        </DayLink>
        <DayLink href={href({date: today()})}>Today</DayLink>
      </div>

      {/*
        The same filter the availability engine understands: all
        practitioners, or one. It is a row of links rather than a select,
        because the current state has to be visible without opening anything.
      */}
      <nav aria-label="Filter by practitioner" className="mt-3 flex flex-wrap gap-1.5">
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
        <p className="mt-3 border border-line bg-surface px-4 py-6 text-sm text-muted">
          Nothing booked on {formatDate(date)}.
        </p>
      ) : (
        /*
          Wide content scrolls inside its own container. A table of five
          columns cannot fit a 390px viewport at a readable size, and the
          alternative -- letting the document scroll sideways -- hides the
          status and the row link off the right-hand edge with nothing to
          say they are there.
        */
        <div className="mt-3 overflow-x-auto border border-line">
          <table className="w-full min-w-[38rem] border-collapse bg-surface text-sm">
            <caption className="sr-only">
              Appointments on {formatDate(date)}, earliest first
            </caption>
            <thead>
              <tr className="bg-ground text-left">
                {['Time', 'Client', 'Practitioner and service', 'Status'].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="border-b border-line px-3 py-2 font-mono text-[0.625rem] font-medium tracking-[0.12em] text-muted uppercase"
                  >
                    {label}
                  </th>
                ))}
                <th scope="col" className="border-b border-line px-3 py-2">
                  <span className="sr-only">Detail</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((row) => (
                <tr
                  key={row.reference}
                  className={`border-b border-line transition-colors duration-[120ms] last:border-b-0 ${
                    row.reference === selected?.reference
                      ? 'bg-surface-2'
                      : 'hover:bg-surface-2'
                  }`}
                >
                  <td className="tabular px-3 py-2 align-top font-mono whitespace-nowrap">
                    {formatTime(row.startsAt)}–{formatTime(row.endsAt)}
                  </td>
                  <td className="px-3 py-2 align-top">{row.clientName}</td>
                  <td className="px-3 py-2 align-top text-ink-2">
                    {row.practitionerName}
                    <span className="block text-muted">{row.serviceName}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <Link
                      href={
                        row.reference === selected?.reference
                          ? href({})
                          : href({booking: row.reference})
                      }
                      className="inline-block px-1 py-1.5 underline underline-offset-4"
                    >
                      {row.reference === selected?.reference ? 'Close' : 'Open'}
                      <span className="sr-only"> {row.reference}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        The three states differ in border and in the line through the word as
        well as in hue, which is what keeps the day readable in greyscale.
      */}
      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[0.625rem] tracking-[0.1em] text-muted uppercase">
        <span>
          <span className="text-ink">Confirmed</span> solid border
        </span>
        <span>
          <span className="text-ink">Cancelled</span> struck through
        </span>
      </p>

      {selected ? <DetailPanel booking={selected} closeHref={href({})} /> : null}
    </AppShell>
  )
}

/** Previous day, next day, today. */
function DayLink({href, children}: {href: string; children: React.ReactNode}) {
  return (
    <Link
      href={href}
      className="tabular border border-line-strong px-3 py-1.5 text-sm whitespace-nowrap transition-colors duration-[120ms] hover:bg-surface-2"
    >
      {children}
    </Link>
  )
}

function Stat({label, value}: {label: string; value: number | string}) {
  return (
    <div className="bg-surface px-4 py-3">
      <dd className="tabular text-2xl leading-none font-semibold tracking-[-0.02em]">
        {value}
      </dd>
      <dt className="mt-1.5 font-mono text-[0.625rem] tracking-[0.1em] text-muted uppercase">
        {label}
      </dt>
    </div>
  )
}

/**
 * Status carries in three ways at once — the word, the border and the line
 * through it — so it survives greyscale, a colour-blind reader and a screen
 * reader. Colour alone would carry it for none of them.
 */
function StatusBadge({status}: {status: 'confirmed' | 'cancelled'}) {
  const shared =
    'inline-block border px-2 py-0.5 font-mono text-[0.625rem] tracking-[0.1em] uppercase'
  return status === 'cancelled' ? (
    <span className={`${shared} border-cancelled text-cancelled line-through`}>
      Cancelled
    </span>
  ) : (
    <span className={`${shared} border-accent text-accent`}>Confirmed</span>
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
          ? 'border-accent bg-accent font-medium text-accent-ink'
          : 'border-line-strong text-ink-2 hover:bg-surface-2 hover:text-ink'
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
    <section
      aria-label={`Appointment ${booking.reference}`}
      className="mt-4 border border-line bg-surface p-4"
    >
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
