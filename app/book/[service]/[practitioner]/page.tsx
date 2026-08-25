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
import {getDb} from '../../../../src/db/index.ts'
import {formatDate, formatDateShort} from '../../../../src/format.ts'
import {BookingFrame} from '../../BookingFrame.tsx'
import {SlotGrid} from '../../SlotGrid.tsx'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{service: string; practitioner: string}>
  searchParams: Promise<{date?: string; taken?: string}>
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {service} = await params
  const row = await getServiceBySlug(getDb(), service)
  return {title: row ? `${row.name} — choose a time` : 'Choose a time'}
}

export default async function ChooseTime({params, searchParams}: Props) {
  const {service: serviceSlug, practitioner: practitionerSlug} = await params
  const {date: dateParam, taken} = await searchParams

  const db = getDb()
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

  const {slots, unavailable} = await availabilityFor(db, service, practitionerSlug, date, now)

  const chosen = offering.find((p) => p.slug === practitionerSlug)
  const detailsBase = `/book/${service.slug}`
  const anyPractitioner = practitionerSlug === ANY

  const earliest = today(now)
  const latest = shiftDate(earliest, HORIZON_DAYS)
  const previous = shiftDate(date, -1)
  const next = shiftDate(date, 1)

  const slugById = new Map(offering.map((p) => [p.id, p.slug]))

  return (
    <BookingFrame
      step={3}
      title="Choose a date and time"
      selection={{
        service: {name: service.name, slug: service.slug, specialty: service.specialty},
        practitioner: chosen
          ? {name: chosen.name, title: chosen.title}
          : anyPractitioner
            ? 'any'
            : undefined,
        durationMinutes: chosen?.durationMinutes,
        pricePence: chosen?.pricePence,
      }}
    >
      <p className="text-ink-2">
        {chosen ? (
          <>
            {service.name} with {chosen.name}.
          </>
        ) : (
          <>
            {service.name}, any practitioner. Appointment length depends on who you see.
          </>
        )}
      </p>

      {taken ? (
        // The slot went while they were filling in the form. Say which one,
        // and note that the grid below no longer has it.
        <p
          role="alert"
          className="mt-4 border-l-2 border-cancelled bg-surface px-4 py-3 text-sm text-cancelled"
        >
          <strong className="font-medium">{taken} has just been booked</strong> by somebody
          else. It has been removed below — please choose another time.
        </p>
      ) : null}

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
            className="tabular border border-line-strong bg-surface px-2 py-1.5 text-sm pointer-coarse:py-3"
          />
          <button
            type="submit"
            className="border border-line-strong px-3 py-1.5 text-sm transition-colors duration-[120ms] pointer-coarse:py-3 hover:bg-surface-2"
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
        {unavailable.length > 0
          ? ` ${unavailable.length} other time${unavailable.length === 1 ? '' : 's'} shown as unavailable.`
          : ''}
      </p>

      {slots.length === 0 && unavailable.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          The clinic is closed on this day for this appointment. Try another date —
          appointments open two hours ahead and up to {HORIZON_DAYS} days out.
        </p>
      ) : (
        // One form, one submit button per bookable slot. `formaction` puts the
        // chosen practitioner in the path, so the URL that results is the same
        // shape whether they picked a person or "no preference" — and it is a
        // real link somebody can send to somebody else. The grid enhances this
        // with arrow keys and an optimistic fill; without JavaScript it stays
        // an ordinary form that navigates.
        <form method="get">
          <input type="hidden" name="date" value={date} />
          <SlotGrid
            date={date}
            anyPractitioner={anyPractitioner}
            slots={slots.map((slot) => ({
              id: `${slot.practitionerId}-${slot.time}`,
              time: slot.time,
              practitionerName: slot.practitionerName,
              durationMinutes: slot.durationMinutes,
              action: `${detailsBase}/${slugById.get(slot.practitionerId) ?? ANY}/details`,
            }))}
            blocked={unavailable.map((slot) => ({
              id: `blocked-${slot.time}`,
              time: slot.time,
              reason: slot.reason,
            }))}
          />
        </form>
      )}
    </BookingFrame>
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
  const shared = 'border border-line-strong px-3 py-1.5 text-sm pointer-coarse:py-3'
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
