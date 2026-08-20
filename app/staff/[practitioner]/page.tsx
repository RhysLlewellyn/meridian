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
  const found = (await listPractitioners(getDb())).find((p) => p.slug === practitioner)
  return {title: found ? `Schedule — ${found.name}` : 'Schedule'}
}

export default async function StaffPractitionerPage({params, searchParams}: Props) {
  const {practitioner} = await params
  const {date, booking} = await searchParams

  const everybody = await listPractitioners(getDb())
  if (!everybody.some((p) => p.slug === practitioner)) notFound()

  return <StaffSchedule practitionerSlug={practitioner} date={date} open={booking} />
}
