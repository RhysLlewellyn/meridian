import type {MetadataRoute} from 'next'

import {ANY, listServices} from '../src/availability/query.ts'
import {getDb} from '../src/db/index.ts'
import {siteUrl} from '../src/site-url.ts'

/**
 * The pages worth crawling, built from the same table the routes read.
 *
 * It stops at step two. A step-three URL carries a date, and a sixty-day
 * horizon across five services and three practitioners is something like nine
 * hundred pages that differ by a query string and go stale daily — a sitemap
 * listing those is a sitemap nobody finishes reading, including a crawler.
 * `/book/<service>/any` is the useful entry point in that direction, since it
 * defaults to today and shows the whole clinic's availability.
 *
 * The appointment pages are absent on purpose and `robots.txt` disallows them:
 * a booking is addressed by a reference that is the only thing between a
 * stranger and somebody's appointment, and `/staff` is the front desk's view
 * of everybody's day.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const services = await listServices(getDb())

  return [
    {url: base, priority: 1},
    {url: `${base}/book`, priority: 0.9},
    ...services.map((service) => ({
      url: `${base}/book/${service.slug}`,
      priority: 0.8,
    })),
    ...services.map((service) => ({
      url: `${base}/book/${service.slug}/${ANY}`,
      priority: 0.6,
    })),
  ]
}
