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
  // harfbuzzjs is deliberately NOT listed here: it is traced from `import("harfbuzzjs")` (serverExternalPackages above). Listing './node_modules/harfbuzzjs/dist/*' made three routes' traces
  // list files beneath the pnpm symlinked directory node_modules/harfbuzzjs (no other route's trace did); that was the only symlinked-directory difference found for the failed Vercel package.
  outputFileTracingIncludes: {
    '/api/driver-applications/submit': ['./lib/driver-application/pdf/fonts/**/*', './public/branding/TES-Logo.png'],
    '/api/companies/[id]/driver-prospects/[prospectId]/application/dossier': ['./lib/driver-application/pdf/fonts/**/*', './public/branding/TES-Logo.png'],
    '/api/driver-applications/application': ['./lib/driver-application/pdf/fonts/**/*', './public/branding/TES-Logo.png'],
  },
}

export default nextConfig
