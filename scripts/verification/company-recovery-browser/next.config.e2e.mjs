const S = "/tmp/tes-e2e/stubs"
export default {
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@clerk/nextjs/server$": `${S}/clerk-server.js`,
      "@clerk/nextjs$": `${S}/clerk-client.js`,
      "@/lib/database/postgres$": `${S}/postgres.js`,
    }
    return config
  },
}
