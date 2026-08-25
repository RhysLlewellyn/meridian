import {getBookingByReference} from '../../../../src/availability/query.ts'
import {buildCalendar, calendarFilename} from '../../../../src/booking/ics.ts'
import {getDb} from '../../../../src/db/index.ts'

export const dynamic = 'force-dynamic'

/**
 * The calendar file for one appointment.
 *
 * Served rather than generated once and stored, so that a cancellation makes
 * the next download say CANCELLED. A file handed out at booking time and never
 * revisited would keep asserting an appointment that no longer exists.
 */
export async function GET(
  _request: Request,
  {params}: {params: Promise<{reference: string}>},
) {
  const {reference} = await params

  // 503 and not 404. A calendar client that is told 404 has been told the
  // appointment is gone, and some of them will act on that; 503 with
  // `retry-after` says "ask again", which is what a suspended compute means.
  let detail: Awaited<ReturnType<typeof getBookingByReference>>
  try {
    detail = await getBookingByReference(getDb(), reference)
  } catch {
    return new Response('The database is not answering. Try again in a few seconds.', {
      status: 503,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'retry-after': '5',
      },
    })
  }

  if (!detail) {
    return new Response('No appointment with that reference.', {
      status: 404,
      headers: {'content-type': 'text/plain; charset=utf-8'},
    })
  }

  const body = buildCalendar({
    reference: detail.reference,
    serviceName: detail.serviceName,
    practitionerName: detail.practitionerName,
    practitionerTitle: detail.practitionerTitle,
    startsAt: detail.startsAt,
    endsAt: detail.endsAt,
    status: detail.status,
  })

  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${calendarFilename(detail.reference)}"`,
      // A reference is unguessable but not secret, and an appointment can be
      // cancelled at any moment. Nothing between here and the client should
      // hold on to this.
      'cache-control': 'no-store',
    },
  })
}
