import Link from "next/link"
import { verifyDriverInvitationToken } from "@/lib/driver-invitation-token"
import DriverApplicationWorkspace from "./DriverApplicationWorkspace"
import { DriverApplicationBrandHeader } from "./DriverApplicationBrandHeader"
import { DriverApplicationFooter } from "./DriverApplicationFooter"

export const dynamic = "force-dynamic"

const DRIVER_APPLICATION_STEP_IDS = new Set([
  "identity",
  "about-you",
  "driving-licence",
  "experience-safety",
  "employment",
  "authorizations",
  "documents",
  "review",
])

function isDriverApplicationStep(value?: string): value is
  | "identity"
  | "about-you"
  | "driving-licence"
  | "experience-safety"
  | "employment"
  | "authorizations"
  | "documents"
  | "review" {
  return Boolean(value && DRIVER_APPLICATION_STEP_IDS.has(value))
}

/**
 * Preparation documents.
 *
 * These documents are required before the application can be submitted.
 * They do not necessarily need to be physically available when the
 * applicant first starts the application.
 */
const requiredDocuments = [
  {
    title: "Driver licence",
    detail: "Front and back",
  },
  {
    title: "DVR / CVOR / Driver Abstract",
    detail: "Original required · Current document preferred",
  },
  {
    title: "Medical / health certificate",
    detail: "Where required",
  },
  {
    title: "Relevant training certificates",
    detail: "Certificates you already have",
  },
]

function CheckIcon() {
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EDF4FF] text-[#2563EB] sm:h-8 sm:w-8"
    >
      <svg
        viewBox="0 0 20 20"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 10.5 8 14l8-8" />
      </svg>
    </span>
  )
}

function ApplicantIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-6 w-6 fill-[#2563EB] sm:h-7 sm:w-7"
    >
      <path d="M12 12a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5Zm0 2c-4.56 0-8.25 2.56-8.25 5.72 0 .43.35.78.78.78h14.94c.43 0 .78-.35.78-.78C20.25 16.56 16.56 14 12 14Z" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10h11" />
      <path d="m11 5 5 5-5 5" />
    </svg>
  )
}

export default async function DriverApplicationEntry({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; step?: string }>
}) {
  const { token, step } = await searchParams

  const invitation = token
    ? verifyDriverInvitationToken(token)
    : null

  /*
   * ============================================================
   * INVALID / EXPIRED INVITATION
   * ============================================================
   */
  if (!invitation) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-[#F5F8FC] px-4 py-6 text-[#0F172A] sm:px-6 sm:py-10">
        <div className="mx-auto w-full max-w-[920px]">
          <DriverApplicationBrandHeader />

          <section className="rounded-[22px] border border-[#E2E8F0] bg-white px-5 py-7 shadow-[0_12px_35px_rgba(15,23,42,0.06)] sm:px-9 sm:py-9">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#64748B]">
              Driver Application
            </div>

            <h2 className="mt-3 text-2xl font-bold tracking-[-0.02em] text-[#0B1F44]">
              Invitation unavailable
            </h2>

            <p className="mt-3 max-w-[650px] text-sm leading-6 text-[#64748B]">
              This Driver Application invitation is invalid or has expired.
              Contact the carrier that sent the invitation for a new link.
            </p>
          </section>
          <DriverApplicationFooter />
        </div>
      </main>
    )
  }

  /*
   * ============================================================
   * EXISTING APPLICATION WORKFLOW
   * ============================================================
   *
   * The entry-page redesign does not change application routing.
   */
  if (isDriverApplicationStep(step)) {
    return (
      <DriverApplicationWorkspace
        token={token!}
        applicationId={invitation.applicationId}
        employerName={invitation.companyName}
        employerContact={{
          address: invitation.companyAddress,
          phone: invitation.companyPhone,
          email: invitation.companyEmail,
        }}
        applicantName={invitation.driverName}
        invitationEmail={invitation.recipientEmail}
        operatingRegion={invitation.operatingRegion ?? "Canada"}
        activeStep={step}
      />
    )
  }

  const beginHref =
    `/driver-application?token=${encodeURIComponent(token!)}&step=identity`

  /*
   * ============================================================
   * APPLICATION ENTRY PAGE
   * ============================================================
   */
  return (
    <main className="min-h-screen overflow-x-hidden bg-[linear-gradient(180deg,#F4F8FD_0%,#F8FAFD_52%,#F5F8FC_100%)] px-3 py-5 text-[#0F172A] min-[380px]:px-4 sm:px-6 sm:py-8 lg:py-10">
      <div className="mx-auto w-full max-w-[920px]">

        {/* ======================================================
            HEADER
            ====================================================== */}
        <DriverApplicationBrandHeader
          companyName={invitation.companyName}
          companyContact={{
            address: invitation.companyAddress,
            phone: invitation.companyPhone,
            email: invitation.companyEmail,
          }}
        />

        {/* ======================================================
            MAIN CARD
            ====================================================== */}
        <section className="overflow-hidden rounded-[22px] border border-[#DDE6F0] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.075)] sm:rounded-[26px]">

          {/* ====================================================
              WELCOME / APPLICANT CONTEXT
              ==================================================== */}
          <div className="px-5 pb-6 pt-7 sm:px-9 sm:pb-7 sm:pt-9 lg:px-10">

            <h2 className="break-words text-[clamp(1.4rem,4vw,1.8rem)] font-semibold leading-[1.2] tracking-[-0.025em] text-[#0B1F44]">
              Welcome, {invitation.driverName}
            </h2>

            <p className="mt-2.5 max-w-[720px] text-[13px] leading-6 text-[#64748B] sm:text-[15px] sm:leading-7">
              You&apos;re completing a driver application for{" "}
              <span className="font-semibold text-[#1E293B]">
                {invitation.companyName}
              </span>
              . Your progress is saved as you work.
            </p>
          </div>

          {/* ====================================================
              MAIN CONTENT
              ==================================================== */}
          <div className="border-t border-[#E7EDF5] px-5 py-6 sm:px-9 sm:py-8 lg:px-10">

            {/* ==================================================
                APPLICANT
                ================================================== */}
            <div className="flex min-w-0 items-center gap-3 rounded-[17px] border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-4 sm:gap-4 sm:px-5 sm:py-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#E7F0FF] sm:h-12 sm:w-12">
                <ApplicantIcon />
              </div>

              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#64748B] sm:text-[10px]">
                  Applicant
                </div>

                <div className="mt-1 break-words text-[15px] font-bold text-[#0B1F44] sm:text-base">
                  {invitation.driverName}
                </div>

                <div className="mt-0.5 break-all text-xs text-[#536B98] sm:text-sm">
                  {invitation.recipientEmail}
                </div>
              </div>
            </div>

            {/* ==================================================
                ESTIMATED TIME
                ================================================== */}
            <div className="mt-6 rounded-[17px] border border-[#CFE0FF] bg-[#F3F7FF] px-4 py-4 sm:mt-7 sm:px-5 sm:py-4.5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E1ECFF] text-[#2563EB]">
                  <ClockIcon />
                </div>

                <div className="min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#536B98] sm:text-[10px]">
                    Estimated completion time
                  </div>

                  <div className="mt-0.5 text-[17px] font-bold tracking-[-0.01em] text-[#0B1F44] sm:text-[18px]">
                    ~15–25 minutes
                  </div>
                </div>
              </div>

              <p className="mt-3 pl-[52px] text-[11px] leading-5 text-[#64748B] sm:text-xs">
                Please allow enough time to complete the application and
                provide the required information and documents.
              </p>
            </div>

            {/* ==================================================
                REQUIRED DOCUMENTS
                ================================================== */}
            <div className="mt-7 sm:mt-8">

              <h2 className="text-[18px] font-bold tracking-[-0.015em] text-[#0B1F44] sm:text-[19px]">
                Required to complete your application
              </h2>

              <p className="mt-1.5 max-w-[720px] text-xs leading-5 text-[#64748B] sm:text-sm">
                The following documents are required before your application
                can be submitted.
              </p>

              {/* ==================================================
                  ONE UNIFIED DOCUMENT BLOCK
                  ================================================== */}
              <div className="mt-4 overflow-hidden rounded-[16px] border border-[#DCE4EE] bg-white">
                {requiredDocuments.map((item, index) => (
                  <div
                    key={item.title}
                    className={[
                      "flex min-w-0 items-center gap-3 px-4 py-3.5",
                      "sm:px-5 sm:py-4",
                      index !== requiredDocuments.length - 1
                        ? "border-b border-[#E8EDF3]"
                        : "",
                    ].join(" ")}
                  >
                    <CheckIcon />

                    <div className="min-w-0">
                      <div className="break-words text-[13px] font-medium leading-5 text-[#1E293B] sm:text-sm">
                        {item.title}
                      </div>

                      <div className="mt-0.5 text-[11px] leading-4 text-[#71829A] sm:text-xs">
                        {item.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ==================================================
                  IMPORTANT FLEXIBILITY NOTE
                  ==================================================
                  This intentionally remains on the page.

                  It explains that the documents are required for
                  submission but do not necessarily need to be
                  physically beside the driver at the moment they
                  begin the application.
                  ================================================== */}
              <div className="mt-4 rounded-[14px] border border-[#E1E8F1] bg-[#F8FAFD] px-4 py-3.5 sm:px-5 sm:py-4">
                <p className="text-[11px] leading-5 text-[#64748B] sm:text-xs sm:leading-5">
                  <span className="font-semibold text-[#334155]">
                    Additional information or documents may be requested
                    based on your operating requirements.
                  </span>{" "}
                  You can begin even if every document is not beside you
                  right now.
                </p>
              </div>
            </div>

            {/* ==================================================
                CTA
                ================================================== */}
            <div className="mt-7 border-t border-[#E2E8F0] pt-5 sm:mt-8 sm:flex sm:items-center sm:justify-end sm:pt-6">
              <Link
                href={beginHref}
                className="inline-flex min-h-[49px] w-full items-center justify-center gap-2 rounded-[11px] bg-[#1457F5] px-6 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(20,87,245,0.20)] transition-all duration-150 hover:bg-[#0F4BDC] hover:shadow-[0_10px_24px_rgba(20,87,245,0.24)] focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-2 active:translate-y-px sm:w-auto sm:min-w-[190px]"
              >
                <span>Start Application</span>
                <ArrowIcon />
              </Link>
            </div>
          </div>
        </section>
        <DriverApplicationFooter />
      </div>
    </main>
  )
}