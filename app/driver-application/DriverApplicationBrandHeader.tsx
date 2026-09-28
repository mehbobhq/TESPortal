"use client"

import Image from "next/image"

export type DriverApplicationCompanyContact = {
  address?: {
    street?: string
    city?: string
    stateProvince?: string
    postalCode?: string
    country?: string
  }
  phone?: string
  email?: string
}

function compact(values: Array<string | undefined>) {
  return values.map((value) => String(value || "").trim()).filter(Boolean)
}

export function DriverApplicationBrandHeader({
  companyName,
  companyContact,
}: {
  companyName?: string
  companyContact?: DriverApplicationCompanyContact
}) {
  const address = companyContact?.address
  const locality = compact([
    address?.city,
    address?.stateProvince,
    address?.postalCode,
  ]).join(", ").replace(/,\s([^,]+)$/, " $1")
  const contact = compact([companyContact?.phone, companyContact?.email]).join(" · ")

  return (
    <header className="mb-5 border-b border-[#E2E8F0] pb-4 sm:mb-6 sm:pb-5">
      <div className="grid items-center gap-3 text-center md:grid-cols-[minmax(145px,1fr)_auto_minmax(240px,1fr)] md:text-left">
        <div className="flex justify-center md:justify-start">
          <Image
            src="/branding/TES-Logo.png"
            alt="TES — Compliance Simplified"
            width={420}
            height={180}
            priority
            className="h-auto w-[96px] object-contain sm:w-[108px]"
          />
        </div>

        <div className="md:px-5 md:text-center">
          <div className="whitespace-nowrap text-[clamp(1.15rem,3vw,1.7rem)] font-extrabold tracking-[0.025em] text-[#0B1F44]">
            DRIVER APPLICATION
          </div>
        </div>

        <div className="min-w-0 text-center md:text-right">
          {companyName ? (
            <div className="break-words text-sm font-bold leading-5 text-[#0B1F44] sm:text-[15px]">
              {companyName}
            </div>
          ) : null}
          {address?.street ? (
            <div className="mt-1 break-words text-[11px] leading-4 text-[#64748B] sm:text-xs">
              {address.street}
            </div>
          ) : null}
          {locality ? (
            <div className="break-words text-[11px] leading-4 text-[#64748B] sm:text-xs">
              {locality}
            </div>
          ) : null}
          {address?.country ? (
            <div className="break-words text-[11px] leading-4 text-[#64748B] sm:text-xs">
              {address.country}
            </div>
          ) : null}
          {contact ? (
            <div className="mt-1 break-words text-[11px] leading-4 text-[#475569] sm:text-xs">
              {contact}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
