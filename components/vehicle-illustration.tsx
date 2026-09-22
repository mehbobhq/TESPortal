"use client"

import type { CSSProperties } from "react"
import { Info } from "lucide-react"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const VEHICLE_COLOR_HEX: Record<string, string> = {
  black: "#20242b",
  blue: "#2563eb",
  brown: "#7c4a2d",
  burgundy: "#7f1d1d",
  gray: "#64748b",
  green: "#15803d",
  orange: "#ea580c",
  red: "#c62828",
  silver: "#a8b2bf",
  white: "#f8fafc",
  yellow: "#eab308",
}

export const REPRESENTATIVE_VEHICLE_NOTICE =
  "Representative illustration based on recorded vehicle details. Not an image of the actual unit."

export function resolveVehiclePaintColor(color?: string) {
  if (!color) return VEHICLE_COLOR_HEX.silver

  const normalized = color.trim().toLowerCase()
  if (VEHICLE_COLOR_HEX[normalized]) return VEHICLE_COLOR_HEX[normalized]
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized

  return VEHICLE_COLOR_HEX.silver
}

export function VehicleIllustration({
  color,
  illustrationKey = "generic-sleeper-tractor-v1",
  className,
}: {
  color?: string
  illustrationKey?: string
  className?: string
}) {
  const paintColor = resolveVehiclePaintColor(color)
  const style = { "--vehicle-paint": paintColor } as CSSProperties

  return (
    <figure
      data-illustration-key={illustrationKey}
      className={cn(
        "relative flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-gradient-to-br from-white via-blue-50/50 to-slate-100",
        className
      )}
      style={style}
      aria-label={REPRESENTATIVE_VEHICLE_NOTICE}
    >
      <svg viewBox="0 0 180 120" className="h-auto w-[92%]" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="tes-truck-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#dbeafe" />
            <stop offset="1" stopColor="#53739d" />
          </linearGradient>
          <linearGradient id="tes-truck-chrome" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f8fafc" />
            <stop offset="1" stopColor="#94a3b8" />
          </linearGradient>
          <filter id="tes-truck-shadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#0f234b" floodOpacity="0.18" />
          </filter>
        </defs>

        <ellipse cx="92" cy="101" rx="70" ry="7" fill="#17325d" opacity="0.12" />

        <g filter="url(#tes-truck-shadow)">
          <path d="M31 34h58c8 0 14 6 14 14v42H31z" fill="var(--vehicle-paint)" stroke="#405a7d" strokeWidth="1.4" />
          <path d="M37 40h50c5 0 9 4 9 9v8H37z" fill="#ffffff" opacity="0.16" />
          <path d="M98 46h25c8 0 14 4 19 11l12 19v14H98z" fill="var(--vehicle-paint)" stroke="#405a7d" strokeWidth="1.4" />
          <path d="M106 51h15c6 0 10 3 13 8l6 10h-34z" fill="url(#tes-truck-glass)" stroke="#405a7d" strokeWidth="1.2" />
          <path d="M145 72h20c5 0 9 4 9 9v9h-29z" fill="var(--vehicle-paint)" stroke="#405a7d" strokeWidth="1.4" />
          <rect x="154" y="76" width="15" height="4" rx="2" fill="#fef3c7" />
          <rect x="146" y="84" width="26" height="5" rx="2" fill="url(#tes-truck-chrome)" />
          <path d="M20 84h145v9H20z" fill="#334155" />
          <rect x="16" y="88" width="74" height="5" rx="2" fill="url(#tes-truck-chrome)" />
          <rect x="41" y="59" width="13" height="16" rx="2" fill="#d7e4f4" opacity="0.8" />
          <rect x="76" y="49" width="4" height="31" rx="2" fill="#405a7d" opacity="0.65" />
          <rect x="90" y="58" width="4" height="26" rx="2" fill="url(#tes-truck-chrome)" />
          <circle cx="47" cy="93" r="14" fill="#1f2937" />
          <circle cx="47" cy="93" r="7" fill="url(#tes-truck-chrome)" />
          <circle cx="47" cy="93" r="2.5" fill="#64748b" />
          <circle cx="126" cy="93" r="14" fill="#1f2937" />
          <circle cx="126" cy="93" r="7" fill="url(#tes-truck-chrome)" />
          <circle cx="126" cy="93" r="2.5" fill="#64748b" />
          <circle cx="157" cy="93" r="14" fill="#1f2937" />
          <circle cx="157" cy="93" r="7" fill="url(#tes-truck-chrome)" />
          <circle cx="157" cy="93" r="2.5" fill="#64748b" />
        </g>
      </svg>

      <Tooltip>
        <TooltipTrigger
          aria-label="About this vehicle illustration"
          className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border border-border/80 bg-white/90 text-muted-foreground shadow-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <Info className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-64 leading-relaxed">
          {REPRESENTATIVE_VEHICLE_NOTICE}
        </TooltipContent>
      </Tooltip>
    </figure>
  )
}
