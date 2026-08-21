import type {MetadataRoute} from 'next'

import {siteUrl} from '../src/site-url.ts'

/**
 * What a crawler may look at.
 *
 * The clinic and the booking flow are public pages and should be indexed. Two
 * things should not be. An appointment's page is addressed by its reference,
 * which is the only thing standing between a stranger and somebody's booking —
 * a search engine holding a copy would be the same leak by a slower route. And
 * `/staff` is the front desk's view of everybody's day; it has no authentication
 * in this demo, which is stated plainly in the README, but that is not a reason
 * to invite a crawler into it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/booking/', '/book/confirm/', '/staff', '/api/'],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
