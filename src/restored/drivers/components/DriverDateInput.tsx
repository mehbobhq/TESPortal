"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { normalizeDriverDate } from "@/lib/driver-date"

export interface DriverDateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value?: string | null
  onChange: (value: string) => void
}

function formatTyping(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 4) return digits
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

export function DriverDateInput({ value, onChange, className, onBlur, ...props }: DriverDateInputProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="YYYY-MM-DD"
      maxLength={10}
      value={formatTyping(String(value ?? ""))}
      onChange={(event) => onChange(formatTyping(event.target.value))}
      onBlur={(event) => {
        const raw = event.currentTarget.value
        if (raw) {
          const normalized = normalizeDriverDate(raw)
          if (normalized) onChange(normalized)
        }
        onBlur?.(event)
      }}
      className={cn("font-mono", className)}
    />
  )
}
