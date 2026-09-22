"use client"

import { useState, type FocusEvent } from "react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type ISODateInputProps = {
  value: string
  onValueChange: (value: string) => void
  className?: string
  disabled?: boolean
  required?: boolean
  id?: string
  name?: string
  "aria-label"?: string
}

function formatISODateInput(rawValue: string): string {
  const digits = rawValue.replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 4) return digits
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
}

export function isValidISODate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))

  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day
}

export function ISODateInput({
  value,
  onValueChange,
  className,
  disabled,
  required,
  id,
  name,
  "aria-label": ariaLabel,
}: ISODateInputProps) {
  const [touched, setTouched] = useState(false)
  const invalid = touched && value.length > 0 && !isValidISODate(value)

  const handleBlur = (_event: FocusEvent<HTMLInputElement>) => {
    setTouched(true)
  }

  return (
    <div className="space-y-1">
      <Input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        placeholder="YYYY-MM-DD"
        value={value}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        className={cn(invalid && "border-destructive focus-visible:ring-destructive/25", className)}
        onChange={(event) => {
          setTouched(false)
          onValueChange(formatISODateInput(event.target.value))
        }}
        onBlur={handleBlur}
      />
      {invalid ? <p className="text-[10px] font-medium text-destructive">Enter a real date as YYYY-MM-DD.</p> : null}
    </div>
  )
}
