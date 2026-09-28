"use client"

import Link from "next/link"
import {
  DRIVER_APPLICATION_STEPS,
  type DriverApplicationStepId,
} from "./DriverApplicationShell"

const copy: Record<DriverApplicationStepId, { title: string; description: string }> = {
  identity: {
    title: "Verify your identity",
    description: "Driver photo and licence evidence will be collected here. The evidence workflow will be connected without changing the shared application shell.",
  },
  "about-you": {
    title: "Tell us about yourself",
    description: "Your personal and contact information will be collected here and autosaved to your application draft.",
  },
  "driving-licence": {
    title: "Driving & licence",
    description: "Licence details, operating availability and related driving information will be collected here and later cross-referenced with supporting evidence.",
  },
  "experience-safety": {
    title: "Experience & safety history",
    description: "Driving experience, collisions, citations and other applicable safety-history declarations will be collected here as applicant-stated facts.",
  },
  employment: {
    title: "Employment history",
    description: "Employment records, commercial-driving history and applicable gaps will be collected here without rewriting historical facts.",
  },
  authorizations: {
    title: "Authorizations",
    description: "Applicable authorizations and consents will be presented separately and recorded with their own evidence and timestamps.",
  },
  documents: {
    title: "Documents",
    description: "Only documents applicable to this driver and operating context will be requested here. Uploaded evidence will remain linked to the application record.",
  },
  review: {
    title: "Review & submit",
    description: "The applicant will review the completed application before submission. Submission will preserve an immutable application record for TES processing and review.",
  },
}

export default function DriverApplicationStepPlaceholder({
  token,
  activeStep,
}: {
  token: string
  activeStep: DriverApplicationStepId
}) {
  const index = DRIVER_APPLICATION_STEPS.findIndex((step) => step.id === activeStep)
  const previous = index > 0 ? DRIVER_APPLICATION_STEPS[index - 1] : undefined
  const next = index < DRIVER_APPLICATION_STEPS.length - 1 ? DRIVER_APPLICATION_STEPS[index + 1] : undefined
  const current = copy[activeStep]

  const href = (step: DriverApplicationStepId) => `/driver-application?token=${encodeURIComponent(token)}&step=${step}`

  return (
    <section className="rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm sm:p-8">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1D4ED8]">
        Step {index + 1} · {DRIVER_APPLICATION_STEPS[index].label}
      </div>
      <h1 className="mt-2 text-2xl font-semibold">{current.title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[#6B7280]">{current.description}</p>

      <div className="mt-8 rounded-xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-5">
        <div className="text-sm font-semibold text-[#374151]">Section shell ready</div>
        <p className="mt-1 text-xs leading-5 text-[#6B7280]">
          This phase intentionally establishes navigation and progress without inventing applicant data or bypassing the future autosave/persistence boundary.
        </p>
      </div>

      <div className="mt-8 flex flex-col-reverse gap-3 border-t border-[#E5E7EB] pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {previous ? (
            <Link href={href(previous.id)} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#D1D5DB] bg-white px-4 py-2.5 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]">
              Back
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#6B7280]">Autosave will connect here</span>
          {next ? (
            <Link href={href(next.id)} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1D4ED8] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1E40AF]">
              Continue
            </Link>
          ) : (
            <button type="button" disabled className="inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-lg bg-[#D1D5DB] px-5 py-2.5 text-sm font-semibold text-white">
              Submit Application
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
