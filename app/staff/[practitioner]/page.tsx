import type {Metadata} from 'next'
import {notFound} from 'next/navigation'

import {listPractitioners} from '../../../src/availability/query.ts'
import {getDb} from '../../../src/db/index.ts'
import {StaffSchedule} from '../StaffSchedule.tsx'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{practitioner: string}>
  searchParams: Promise<{date?: string; booking?: string}>
}

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {practitioner} = await params
  // As elsewhere: a title is not worth a 500, and "Schedule" is already the
  // answer when the practitioner is not found.
  const everybody = await listPractitioners(getDb()).catch(() => [])
  const found = everybody.find((p) => p.slug === practitioner)
  return {title: found ? `Schedule — ${found.name}` : 'Schedule'}
}

export default async function StaffPractitionerPage({params, searchParams}: Props) {
  const {practitioner} = await params
  const {date, booking} = await searchParams

  // A database that will not answer must not become a 404 -- that would tell
  // the front desk a colleague does not exist. Hand the slug through instead
  // and let `StaffSchedule` render the fallback from its own catch.
  const everybody = await listPractitioners(getDb()).catch(() => undefined)
  if (everybody && !everybody.some((p) => p.slug === practitioner)) notFound()

  return <StaffSchedule practitionerSlug={practitioner} date={date} open={booking} />
}
