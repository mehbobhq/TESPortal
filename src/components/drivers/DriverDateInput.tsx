"use client"

import * as React from "react"
import { TESDateField } from "@/components/ui/tes-date-field"

export interface DriverDateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value?: string | null
  onChange: (value: string) => void
}

/**
 * Driver date control. Kept for its existing callers; it is now the shared TESDateField (YYYY-MM-DD, calendar, keyboard entry), so a driver's date of
 * birth looks and behaves like every other date in TES. The value handed to `onChange` is a complete valid date, or "" while the entry is incomplete.
 */
export function DriverDateInput({ value, onChange, className, onBlur, min, max, ...props }: DriverDateInputProps) {
  const data = Object.fromEntries(Object.entries(props).filter(([k]) => k.startsWith("data-")))
  return (
    <TESDateField
      id={props.id}
      name={props.name}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      autoFocus={props.autoFocus}
      aria-label={props["aria-label"]}
      aria-labelledby={props["aria-labelledby"]}
      aria-describedby={props["aria-describedby"]}
      inputProps={data}
      placeholder={props.placeholder}
      min={typeof min === "string" ? min : undefined}
      max={typeof max === "string" ? max : undefined}
      className={className}
      value={value ?? ""}
      onValueChange={onChange}
      onBlur={onBlur}
    />
  )
}
