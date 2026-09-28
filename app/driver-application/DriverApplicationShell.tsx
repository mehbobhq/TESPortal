"use client"

import * as React from "react"
import Link from "next/link"
import { DriverApplicationBrandHeader, type DriverApplicationCompanyContact } from "./DriverApplicationBrandHeader"
import { DriverApplicationFooter } from "./DriverApplicationFooter"

export type DriverApplicationStepId =
  | "identity"
  | "about-you"
  | "driving-licence"
  | "experience-safety"
  | "employment"
  | "authorizations"
  | "documents"
  | "review"

export type DriverApplicationStep = {
  id: DriverApplicationStepId
  label: string
  shortLabel: string
}

export const DRIVER_APPLICATION_STEPS: DriverApplicationStep[] = [
  { id: "identity", label: "Identity & Driver Photo", shortLabel: "Identity" },
  { id: "about-you", label: "About You", shortLabel: "About You" },
  { id: "driving-licence", label: "Driving & Licence", shortLabel: "Licence" },
  { id: "experience-safety", label: "Experience & Safety History", shortLabel: "Experience" },
  { id: "employment", label: "Employment History", shortLabel: "Employment" },
  { id: "authorizations", label: "Authorizations", shortLabel: "Authorizations" },
  { id: "documents", label: "Documents", shortLabel: "Documents" },
  { id: "review", label: "Review & Submit", shortLabel: "Review" },
]

export function isDriverApplicationStep(value?: string): value is DriverApplicationStepId {
  return DRIVER_APPLICATION_STEPS.some((step) => step.id === value)
}

export function driverApplicationStepHref(token: string, step: DriverApplicationStepId) {
  return `/driver-application?token=${encodeURIComponent(token)}&step=${step}`
}

export default function DriverApplicationShell({
  token,
  employerName,
  employerContact,
  applicantName,
  activeStep,
  completedSteps,
  lastSavedAt,
  saveState,
  children,
}: {
  token: string
  employerName: string
  employerContact?: DriverApplicationCompanyContact
  applicantName: string
  activeStep: DriverApplicationStepId
  completedSteps: DriverApplicationStepId[]
  lastSavedAt?: string
  saveState: "idle" | "saving" | "saved" | "error"
  children: React.ReactNode
}) {
  const activeIndex = Math.max(0, DRIVER_APPLICATION_STEPS.findIndex((step) => step.id === activeStep))
  const completedCount = DRIVER_APPLICATION_STEPS.filter((step) => completedSteps.includes(step.id)).length
  const progress = Math.round((completedCount / DRIVER_APPLICATION_STEPS.length) * 100)
  const activeStepMeta = DRIVER_APPLICATION_STEPS[activeIndex]

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? "Unable to save"
        : lastSavedAt
          ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : "Not saved yet"

  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#F4F8FD_0%,#F8FAFD_45%,#F5F8FC_100%)] px-3 py-5 text-[#0F172A] min-[380px]:px-4 sm:px-6 sm:py-8 lg:py-10">
      <div className="mx-auto w-full max-w-[1180px]">
        <DriverApplicationBrandHeader companyName={employerName} companyContact={employerContact} />

        {/* ======================================================
            PROGRESS — mobile: "STEP X OF 8" + bar. Desktop: adds the
            full eight-step chip row. Same activeIndex/completedSteps
            data either way, presentation only.
            ====================================================== */}
        <section className="mb-5 overflow-hidden rounded-[18px] border border-[#DDE6F0] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)] sm:mb-6 sm:rounded-[20px]">
          <div className="px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7C93B8]">
                  Step {activeIndex + 1} of {DRIVER_APPLICATION_STEPS.length}
                </div>
                <div className="mt-1 truncate text-[15px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-base">
                  {activeStepMeta.label}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-lg font-bold tabular-nums text-[#0B1F44]">{progress}%</div>
                <div
                  className={`mt-0.5 text-[10px] font-medium sm:text-[11px] ${
                    saveState === "error" ? "font-semibold text-[#B91C1C]" : "text-[#7C93B8]"
                  }`}
                >
                  {saveLabel}
                </div>
              </div>
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#E7EDF5] sm:mt-3.5">
              <div
                className="h-full rounded-full bg-[#1457F5] transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Desktop-only: full eight-step journey */}
          <div className="hidden grid-cols-8 gap-2 border-t border-[#E7EDF5] bg-[#FAFCFE] px-6 py-3.5 lg:grid">
            {DRIVER_APPLICATION_STEPS.map((step, index) => {
              const complete = completedSteps.includes(step.id)
              const active = step.id === activeStep
              const unlocked = index <= activeIndex || complete
              const classes = active
                ? "border-[#1457F5] bg-[#EEF3FF] text-[#1457F5]"
                : complete
                  ? "border-[#D9E2EE] bg-white text-[#334155]"
                  : "border-transparent text-[#A9B8CE]"

              return unlocked ? (
                <Link
                  key={step.id}
                  href={driverApplicationStepHref(token, step.id)}
                  className={`rounded-[10px] border px-2 py-2 text-center text-[11px] font-semibold transition-colors ${classes}`}
                >
                  {complete && !active ? "✓ " : ""}
                  {step.shortLabel}
                </Link>
              ) : (
                <div
                  key={step.id}
                  className={`cursor-not-allowed rounded-[10px] border px-2 py-2 text-center text-[11px] font-semibold ${classes}`}
                  title="Complete the earlier sections first"
                >
                  {step.shortLabel}
                </div>
              )
            })}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
          {/* Desktop-only sidebar navigator */}
          <aside className="hidden lg:block">
            <div className="sticky top-6 rounded-[18px] border border-[#DDE6F0] bg-white p-3 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
              {DRIVER_APPLICATION_STEPS.map((step, index) => {
                const complete = completedSteps.includes(step.id)
                const active = step.id === activeStep
                const unlocked = index <= activeIndex || complete
                const body = (
                  <>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                        active
                          ? "border-[#1457F5] bg-[#1457F5] text-white"
                          : complete
                            ? "border-[#B9C6DA] bg-[#F1F5FB] text-[#334155]"
                            : "border-[#DCE4EE] text-[#A9B8CE]"
                      }`}
                    >
                      {complete ? "✓" : index + 1}
                    </span>
                    <span>{step.label}</span>
                  </>
                )

                return unlocked ? (
                  <Link
                    key={step.id}
                    href={driverApplicationStepHref(token, step.id)}
                    className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm transition-colors ${
                      active ? "bg-[#EEF3FF] font-semibold text-[#1457F5]" : "text-[#475569] hover:bg-[#F7FAFE]"
                    }`}
                  >
                    {body}
                  </Link>
                ) : (
                  <div
                    key={step.id}
                    className="flex cursor-not-allowed items-center gap-3 rounded-[12px] px-3 py-2.5 text-sm text-[#A9B8CE]"
                    title="Complete the earlier sections first"
                  >
                    {body}
                  </div>
                )
              })}
            </div>
          </aside>

          <div className="min-w-0">{children}</div>
        </div>
        <DriverApplicationFooter />
      </div>
    </main>
  )
}
