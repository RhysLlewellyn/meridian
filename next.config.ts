import type {NextConfig} from 'next'

const nextConfig: NextConfig = {
  experimental: {
    // The stylesheet is small and the cost of fetching it is the round trip
    // rather than the bytes. Inlining takes it off the critical path.
    inlineCss: true,
  },
}

export default nextConfig
