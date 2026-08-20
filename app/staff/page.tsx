import type {Metadata} from 'next'

import {StaffSchedule} from './StaffSchedule.tsx'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {title: 'Schedule'}

type Props = {searchParams: Promise<{date?: string; booking?: string}>}

export default async function StaffPage({searchParams}: Props) {
  const {date, booking} = await searchParams
  return <StaffSchedule date={date} open={booking} />
}
