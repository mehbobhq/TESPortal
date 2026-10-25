import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"
import { inputBaseClass } from "@/components/ui/input-styles"
import { TESDateField, TESDateTimeField, TESTimeField } from "@/components/ui/tes-date-field"

/**
 * Text input. Date-like types are rendered by the shared TES controls instead of the browser's native pickers, whose look, segment layout and display
 * format differ between browsers, devices and locales: type="date" -> TESDateField, "datetime-local" -> TESDateTimeField, "time" -> TESTimeField.
 * The `value`/`defaultValue`/`onChange` (e.target.value)/`name`/`min`/`max`/`required` contract is unchanged, and the value is still YYYY-MM-DD,
 * YYYY-MM-DDTHH:mm or HH:mm.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  if (type === "date" || type === "datetime-local" || type === "time") {
    const { value, defaultValue, onChange, min, max, id, name, required, disabled, readOnly, autoFocus, onBlur } = props
    const inputProps = Object.fromEntries(Object.entries(props).filter(([k]) => k.startsWith("data-") || k === "title" || k === "tabIndex"))
    const common = {
      inputProps,
      id,
      name,
      required,
      disabled,
      readOnly,
      autoFocus,
      onBlur,
      className,
      value: value === undefined ? undefined : String(value ?? ""),
      defaultValue: defaultValue === undefined ? undefined : String(defaultValue ?? ""),
      onChange,
      invalid: props["aria-invalid"] === true || props["aria-invalid"] === "true",
      "aria-label": props["aria-label"],
      "aria-labelledby": props["aria-labelledby"],
      "aria-describedby": props["aria-describedby"],
    }
    if (type === "date") return <TESDateField {...common} min={typeof min === "string" ? min : undefined} max={typeof max === "string" ? max : undefined} placeholder={props.placeholder} />
    if (type === "time") return <TESTimeField {...common} />
    return <TESDateTimeField {...common} min={typeof min === "string" ? min.slice(0, 10) : undefined} max={typeof max === "string" ? max.slice(0, 10) : undefined} />
  }
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        inputBaseClass,
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input }
