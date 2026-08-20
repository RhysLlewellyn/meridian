import type {Metadata} from 'next'
import Link from 'next/link'
import {notFound} from 'next/navigation'

import {HORIZON_DAYS} from '../../../../src/availability/engine.ts'
import {
  ANY,
  availabilityFor,
  getServiceBySlug,
  listPractitionersForService,
  today,
} from '../../../../src/availability/query.ts'
import {shiftDate} from '../../../../src/availability/time.ts'
import {db} from '../../../../src/db/index.ts'
import {formatDate, formatDateShort, formatDuration} from '../../../../src/format.ts'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{service: string; practitioner: string}>
  searchParams: Promise<{date?: string; taken?: string}>
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {service} = await params
  const row = await getServiceBySlug(db, service)
  return {title: row ? `${row.name} — choose a time` : 'Choose a time'}
}

export default async function ChooseTime({params, searchParams}: Props) {
  const {service: serviceSlug, practitioner: practitionerSlug} = await params
  const {date: dateParam, taken} = await searchParams

  const service = await getServiceBySlug(db, serviceSlug)
  if (!service) notFound()

  const offering = await listPractitionersForService(db, service.id)
  if (practitionerSlug !== ANY && !offering.some((p) => p.slug === practitionerSlug)) {
    notFound()
  }

  const now = new Date()
  // An unparseable date in the URL is a typo or a crawler, not a 404. Show
  // today rather than an error page.
  const date = dateParam && DATE_PATTERN.test(dateParam) ? dateParam : today(now)

  const {slots} = await availabilityFor(db, service, practitionerSlug, date, now)

  const chosen = offering.find((p) => p.slug === practitionerSlug)
  const detailsBase = `/book/${service.slug}`

  const earliest = today(now)
  const latest = shiftDate(earliest, HORIZON_DAYS)
  const previous = shiftDate(date, -1)
  const next = shiftDate(date, 1)

  return (
    <main>
      <p className="mt-6">
        <Link
          href={`/book/${service.slug}`}
          className="text-sm text-muted underline underline-offset-4"
        >
          Change practitioner
        </Link>
      </p>

      <h1 className="mt-2 text-2xl font-medium">{service.name}</h1>
      <p className="mt-2 text-ink-2">
        {chosen ? (
          <>
            With {chosen.name}, {formatDuration(chosen.durationMinutes)}.
          </>
        ) : (
          <>Any practitioner. Appointment length depends on who you see.</>
        )}
      </p>

      {taken ? (
        // The slot went while they were filling in the form. Say which one,
        // and note that the grid below no longer has it.
        <p
          role="alert"
          className="mt-6 border-2 border-danger px-4 py-3 text-sm text-danger"
        >
          <strong className="font-medium">{taken} has just been booked</strong> by somebody
          else. It has been removed below — please choose another time.
        </p>
      ) : null}

      <h2 className="mt-8 text-lg font-medium">Choose a date and time</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-line py-3">
        <DayStep
          href={`${detailsBase}/${practitionerSlug}?date=${previous}`}
          label={`← ${formatDateShort(previous)}`}
          disabled={previous < earliest}
        />

        <form method="get" className="flex items-center gap-2">
          <label htmlFor="date" className="text-sm text-ink-2">
            Date
          </label>
          <input
            id="date"
            type="date"
            name="date"
            defaultValue={date}
            min={earliest}
            max={latest}
            className="tabular border border-line bg-surface px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            className="border border-line px-3 py-1.5 text-sm transition-colors duration-[120ms] hover:bg-surface-2"
          >
            Go
          </button>
        </form>

        <DayStep
          href={`${detailsBase}/${practitionerSlug}?date=${next}`}
          label={`${formatDateShort(next)} →`}
          disabled={next > latest}
        />
      </div>

      {/*
        The count is announced rather than merely displayed. Changing the date
        replaces the grid without moving focus, so a screen reader user is
        otherwise told nothing at all about what just happened.
      */}
      <p aria-live="polite" className="mt-4 text-sm text-ink-2">
        {slots.length === 0
          ? `No appointments available on ${formatDate(date)}.`
          : `${slots.length} appointment${slots.length === 1 ? '' : 's'} available on ${formatDate(date)}.`}
      </p>

      {slots.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Try another date. Appointments open two hours ahead and up to {HORIZON_DAYS} days
          out.
        </p>
      ) : (
        // One form, one submit button per slot. `formaction` puts the chosen
        // practitioner in the path, so the URL that results is the same shape
        // whether they picked a person or "no preference" — and it is a real
        // link somebody can send to somebody else.
        <form method="get" className="mt-4">
          <input type="hidden" name="date" value={date} />
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            {slots.map((slot) => (
              <li key={`${slot.practitionerId}-${slot.time}`}>
                <button
                  type="submit"
                  name="time"
                  value={slot.time}
                  formAction={`${detailsBase}/${slotSlug(offering, slot.practitionerId)}/details`}
                  aria-label={`${slot.time}, ${formatDate(date)}, ${formatDuration(slot.durationMinutes)}, with ${slot.practitionerName}`}
                  className="tabular w-full border border-line bg-surface px-3 py-2 text-left transition-colors duration-[120ms] hover:border-accent hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="block font-medium">{slot.time}</span>
                  <span className="block text-xs text-muted">
                    {practitionerSlug === ANY
                      ? slot.practitionerName
                      : formatDuration(slot.durationMinutes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </form>
      )}
    </main>
  )
}

/**
 * Previous and next day.
 *
 * Outside the bookable range this renders as text rather than as a link with
 * `aria-disabled` on it. A disabled link is still a link: it takes focus, it
 * follows on Enter, and only the mouse is stopped by `pointer-events: none`.
 */
function DayStep({href, label, disabled}: {href: string; label: string; disabled: boolean}) {
  const shared = 'border border-line px-3 py-1.5 text-sm'
  if (disabled) {
    return <span className={`${shared} text-muted`}>{label}</span>
  }
  return (
    <Link
      href={href}
      className={`${shared} transition-colors duration-[120ms] hover:bg-surface-2`}
    >
      {label}
    </Link>
  )
}

/** The slug for whoever a slot belongs to, for the URL it submits to. */
function slotSlug(
  offering: {id: string; slug: string}[],
  practitionerId: string,
): string {
  return offering.find((p) => p.id === practitionerId)?.slug ?? ANY
}
