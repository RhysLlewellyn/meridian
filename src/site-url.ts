/**
 * The site's own address, for the absolute URLs a sitemap, robots.txt and
 * llms.txt need.
 *
 * Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every deployment, without a
 * protocol, and it always points at the production domain rather than at the
 * preview being built — which is what a sitemap should contain, since a
 * sitemap advertising a preview deployment sends crawlers at a URL that will
 * not exist next week. Setting NEXT_PUBLIC_SITE_URL overrides it, for a custom
 * domain or another host.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel}`

  return 'http://localhost:3002'
}
