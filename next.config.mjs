/** @type {import('next').NextConfig} */
const nextConfig = {
  // HarfBuzz (WASM) shapes the complex-script names in the application PDF; keep it out of the bundle.
  serverExternalPackages: ['harfbuzzjs'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The signed-application PDF embeds Inter (SIL OFL) read from disk at generation time; make sure the files ship with the routes that generate it.
  outputFileTracingIncludes: {
    '/api/driver-applications/submit': ['./lib/driver-application/pdf/fonts/**/*', './node_modules/harfbuzzjs/dist/*', './public/branding/TES-Logo.png'],
    '/api/companies/[id]/driver-prospects/[prospectId]/application/dossier': ['./lib/driver-application/pdf/fonts/**/*', './node_modules/harfbuzzjs/dist/*', './public/branding/TES-Logo.png'],
    '/api/driver-applications/application': ['./lib/driver-application/pdf/fonts/**/*', './node_modules/harfbuzzjs/dist/*', './public/branding/TES-Logo.png'],
  },
}

export default nextConfig
