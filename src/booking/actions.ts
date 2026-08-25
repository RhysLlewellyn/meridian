'use server'

import {eq} from 'drizzle-orm'
import {revalidatePath, updateTag} from 'next/cache'
import {redirect} from 'next/navigation'

import {AVAILABILITY_TAG} from '../availability/next-available.ts'
import {
  availabilityFor,
  getServiceBySlug,
  listPractitionersForService,
} from '../availability/query.ts'
import {
  instantFromWallClock,
  parseCalendarDate,
  parseWallClockTime,
} from '../availability/time.ts'
import {getDb} from '../db/index.ts'
import {auditLog, client} from '../db/schema.ts'
import {formatDateWithYear} from '../format.ts'
import {cancelBooking} from './cancel.ts'
import {createBooking} from './create.ts'
import {sendConfirmationEmail} from './email.ts'

export type BookingFormState = {
  errors?: Partial<Record<'name' | 'email' | 'phone' | 'slot', string>>
  values?: {name?: string; email?: string; phone?: string}
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function text(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Take the details and make the booking.
 *
 * Two things here are deliberately not trusted. The duration comes from
 * `practitioner_service` rather than from the form, because the price and the
 * length of an appointment are not the client's to state. And the requested
 * time is checked back through the availability engine before the insert —
 * not to make the write safe, which is the exclusion constraint's job, but so
 * that a hand-edited URL cannot book 03:00 on a Sunday.
 */
export async function createBookingAction(
  _previous: BookingFormState,
  form: FormData,
): Promise<BookingFormState> {
  const serviceSlug = text(form, 'service')
  const practitionerSlug = text(form, 'practitioner')
  const date = text(form, 'date')
  const time = text(form, 'time')

  const db = getDb()
  const name = text(form, 'name')
  const email = text(form, 'email')
  const phone = text(form, 'phone')
  const values = {name, email, phone}

  const errors: BookingFormState['errors'] = {}
  if (!name) errors.name = 'Enter your name.'
  if (!email) errors.email = 'Enter your email address.'
  else if (!EMAIL.test(email)) errors.email = 'That does not look like an email address.'
  if (Object.keys(errors).length > 0) return {errors, values}

  /**
   * Everything up to the insert, in one place, because everything up to the
   * insert shares one property: nothing has been written yet. A failure here
   * can promise that no appointment was made, which is the only circumstance
   * in which this action is allowed to promise it.
   */
  let service: Awaited<ReturnType<typeof getServiceBySlug>>
  let practitioners: Awaited<ReturnType<typeof listPractitionersForService>> = []
  let slots: Awaited<ReturnType<typeof availabilityFor>>['slots'] = []
  try {
    service = await getServiceBySlug(db, serviceSlug)
    if (service) {
      practitioners = await listPractitionersForService(db, service.id)
      // The engine decides what may be offered. If it is not offering this,
      // the request did not come from the grid.
      ;({slots} = await availabilityFor(db, service, practitionerSlug, date))
    }
  } catch {
    return {
      errors: {
        slot:
          'The database is not answering, so this could not be booked. No appointment ' +
          'has been made and nothing has been sent. Try again in a few seconds.',
      },
      values,
    }
  }

  if (!service) return {errors: {slot: 'That service no longer exists.'}, values}

  const practitioner = practitioners.find((p) => p.slug === practitionerSlug)
  if (!practitioner) {
    return {errors: {slot: 'That practitioner does not offer this service.'}, values}
  }

  const offered = slots.some((slot) => slot.time === time)
  if (!offered) {
    redirect(
      `/book/${service.slug}/${practitionerSlug}?date=${date}&taken=${encodeURIComponent(time)}`,
    )
  }

  const startsAt = instantFromWallClock(parseCalendarDate(date), parseWallClockTime(time))

  // One row per email address. No account, no password — just somewhere to
  // hang a second appointment off the same person. Still before the booking,
  // so a failure here is still "nothing was made".
  let person: typeof client.$inferSelect
  try {
    const [existing] = await db.select().from(client).where(eq(client.email, email)).limit(1)
    person =
      existing ??
      (
        await db
          .insert(client)
          .values({name, email, phone: phone || null})
          .returning()
      )[0]
  } catch {
    return {
      errors: {
        slot:
          'The database is not answering, so this could not be booked. No appointment ' +
          'has been made and nothing has been sent. Try again in a few seconds.',
      },
      values,
    }
  }

  /**
   * The insert, and the one failure in this action that cannot be described
   * honestly as "nothing happened".
   *
   * `createBooking` answers a lost race by returning `slot_taken`, and a
   * deadlock or a reference collision by retrying. What is left is a
   * connection that dies, and if it dies while `COMMIT` is in flight then the
   * appointment either exists or does not and this process cannot find out
   * which. Saying "nothing was booked" here would be a guess, and the wrong
   * guess sends somebody to book a second appointment.
   *
   * So it says what is true and leans on the guarantee rather than on hope:
   * booking again is safe because `booking_no_overlap` is an exclusion
   * constraint in the database, not a check in this file. A retry that finds
   * the first write did land is refused by Postgres and comes back as
   * `slot_taken`, which redirects to the grid with the time marked gone. Two
   * confirmed appointments in one slot is not a thing this code has to avoid;
   * it is a thing the table cannot hold.
   */
  let result: Awaited<ReturnType<typeof createBooking>>
  try {
    result = await createBooking(db, {
      practitionerId: practitioner.id,
      serviceId: service.id,
      clientId: person.id,
      startsAt,
      durationMinutes: practitioner.durationMinutes,
    })
  } catch {
    return {
      errors: {
        slot:
          'The database stopped answering while this was being booked, so it is not ' +
          'clear whether the appointment was made. Open the times for that day again: ' +
          'if yours has gone, it was booked. Trying again is safe either way — the ' +
          'database will not accept a second appointment in a time that is already taken.',
      },
      values,
    }
  }

  // Lost the race between the grid being rendered and this insert. Back to the
  // grid, which will no longer be offering it, with a line saying why.
  if (!result.ok) {
    redirect(
      `/book/${service.slug}/${practitionerSlug}?date=${date}&taken=${encodeURIComponent(time)}`,
    )
  }

  // The directory's "next available" hint is now one appointment out of date.
  // `updateTag` rather than `revalidateTag`: this is a Server Action, and the
  // person is about to be redirected to a page rendered in the same pass, so
  // the cache has to be gone now rather than merely marked stale. Waiting out
  // the sixty-second window would leave a homepage that contradicts the diary
  // it just wrote to.
  updateTag(AVAILABILITY_TAG)

  // The appointment is committed. Everything from here is best effort, and
  // none of it is allowed to change that -- if Resend has a bad minute the
  // person still has their slot, and the confirmation page says the email did
  // not send rather than pretending it did.
  const outcome = await sendConfirmationEmail({
    to: email,
    clientName: name,
    reference: result.booking.reference,
    serviceName: service.name,
    practitionerName: practitioner.name,
    practitionerTitle: practitioner.title,
    startsAt: result.booking.startsAt,
    endsAt: result.booking.endsAt,
    status: 'confirmed',
    whenText: `${formatDateWithYear(date)} at ${time}`,
  })

  // Withheld is its own action, not a failure. Nothing went wrong when the
  // demo declines to email a stranger, and the confirmation page has to be
  // able to tell the two apart to know whether to apologise or to explain.
  // Best effort, for the same reason the email is. The appointment is already
  // committed; a database that dies between the insert and this row must not
  // turn a booking that exists into an error page for the person who made it.
  // The `created` row went in inside the booking's own transaction, so what is
  // lost here is the record of what happened to the email, not of the booking.
  await db
    .insert(auditLog)
    .values({
      bookingId: result.booking.id,
      action: outcome.sent
        ? 'email_sent'
        : outcome.withheld
          ? 'email_withheld'
          : 'email_failed',
      detail: outcome.sent ? {to: email} : {to: email, reason: outcome.reason},
    })
    .catch(() => undefined)

  redirect(`/book/confirm/${result.booking.reference}`)
}

export type CancelFormState = {error?: string; reason?: string}

const CANCEL_MESSAGES: Record<string, string> = {
  no_reason: 'Please say why you are cancelling, so the clinic can offer the time on.',
  not_found: 'No appointment with that reference.',
  already_cancelled: 'That appointment has already been cancelled.',
  already_started:
    'That appointment has already started. Phone the clinic rather than cancelling here.',
}

/**
 * Cancel, from the manage page.
 *
 * `revalidatePath` rather than a redirect: the person stays on the page they
 * were on and watches it change state, which is what they came to see.
 */
export async function cancelBookingAction(
  _previous: CancelFormState,
  form: FormData,
): Promise<CancelFormState> {
  const db = getDb()
  const reference = text(form, 'reference')
  const reason = text(form, 'reason')

  /**
   * The ambiguity here is the mirror of the booking's, and it is the milder
   * half. If the connection dies mid-commit the appointment may or may not
   * have been cancelled — but both outcomes are safe to retry into, because
   * `cancelBooking` answers a second attempt on an already-cancelled row with
   * `already_cancelled` rather than doing it twice. So this can say "try
   * again" without qualification, which the booking path could not.
   */
  let result: Awaited<ReturnType<typeof cancelBooking>>
  try {
    result = await cancelBooking(db, reference, reason)
  } catch {
    return {
      error:
        'The database is not answering, so this could not be cancelled. Reload the page ' +
        'to see whether it went through, and try again if it did not.',
      reason,
    }
  }

  if (!result.ok) {
    return {error: CANCEL_MESSAGES[result.reason] ?? 'That could not be cancelled.', reason}
  }

  // A cancellation frees a slot, which can only make the directory's hint
  // earlier. Same tag, same reason.
  updateTag(AVAILABILITY_TAG)
  revalidatePath(`/booking/${reference}`)
  return {}
}
