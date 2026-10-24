/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The signed-application PDF embeds Inter (SIL OFL) read from disk at generation time; make sure the files ship with the routes that generate it.
  outputFileTracingIncludes: {
    '/api/driver-applications/submit': ['./lib/driver-application/pdf/fonts/*', './public/branding/TES-Logo.png'],
    '/api/driver-applications/application': ['./lib/driver-application/pdf/fonts/*', './public/branding/TES-Logo.png'],
  },
}

export default nextConfig
