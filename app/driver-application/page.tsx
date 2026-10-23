import type { Metadata } from "next"
import ApplicantApp from "./ApplicantApp"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Driver application", robots: { index: false, follow: false }, referrer: "no-referrer" }

/** The page is a shell. The invitation secret is exchanged for a server-side session in the browser; no applicant or company data is rendered on the server. */
export default function DriverApplicationPage() {
  return <ApplicantApp />
}
