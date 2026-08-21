import {listPractitionersWithSpecialties, listServices} from '../../src/availability/query.ts'
import {getDb} from '../../src/db/index.ts'
import {formatDurationShort, formatPrice} from '../../src/format.ts'
import {siteUrl} from '../../src/site-url.ts'

/**
 * `/llms.txt` — the clinic described in markdown, for agents that would
 * otherwise infer it by crawling.
 *
 * Fieldnote's version lists sections, because a publication is a structure of
 * pages. A booking application is not: what an agent needs here is what can be
 * booked, how long it takes, what it costs, and the shape of the URL that gets
 * you there. So this carries the service list from the database rather than a
 * hand-written summary that would drift the first time a price changed.
 *
 * It says plainly that the appointments are not real. An agent acting for
 * somebody who wants a physiotherapist should be able to tell in one line that
 * this is a demonstration and stop, rather than booking them in with a
 * fictional practitioner.
 *
 * Rendered per request for the same reason every other page here is — it reads
 * the database, and `next build` must not need one.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const base = siteUrl()
  const db = getDb()
  const [services, practitioners] = await Promise.all([
    listServices(db),
    listPractitionersWithSpecialties(db),
  ])

  const body = `# Meridian

> A booking platform for a multi-practitioner physiotherapy and rehabilitation clinic.

**Meridian is not a real clinic.** It is a demonstration build by Rhys Llewellyn. The
practitioners are invented, the appointments are not real, and nobody is expecting you. If
you are acting for somebody who needs a physiotherapist, this is not the place to book one.

## Booking

Four steps, and every step's state is in the URL, so any of these can be linked to directly.

- [Choose a service](${base}/book)
- \`${base}/book/<service>\` — choose a practitioner, or "any" for no preference.
- \`${base}/book/<service>/<practitioner>?date=YYYY-MM-DD\` — the available times on that
  date. \`<practitioner>\` may be \`any\`.
- \`${base}/book/<service>/<practitioner>/details?date=YYYY-MM-DD&time=HH:MM\` — name, email
  and phone.

Appointments open two hours ahead and up to 60 days out. No account and no payment is
needed. An appointment can be viewed or cancelled at \`${base}/booking/<reference>\` using
the reference issued at the time of booking.

## Services

${services
  .map(
    (service) =>
      `- **${service.name}** (\`${service.slug}\`) — ${service.specialty}. ` +
      `${formatDurationShort(service.defaultDurationMinutes)}, ${formatPrice(service.pricePence)}. ` +
      service.description,
  )
  .join('\n')}

Both the length and the price can differ by practitioner: an initial assessment takes Tomas
Iriarte an hour where it takes Nadia Okafor forty-five minutes. The figures above are the
service defaults, and the practitioner's own are shown at step two.

## Practitioners

${practitioners
  .map(
    (person) =>
      `- **${person.name}** (\`${person.slug}\`) — ${person.title}. ` +
      `${person.specialties.join(', ')}.`,
  )
  .join('\n')}

## Also

- [Sitemap](${base}/sitemap.xml)
- [Source](https://github.com/RhysLlewellyn/meridian) — the availability engine, the
  Postgres exclusion constraint that makes double-booking impossible, and the test that
  proves it.
`

  return new Response(body, {
    headers: {'Content-Type': 'text/markdown; charset=utf-8'},
  })
}
