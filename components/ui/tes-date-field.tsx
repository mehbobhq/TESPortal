"use client"

import * as React from "react"
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"
import { inputBaseClass } from "@/components/ui/input-styles"
import {
  DEFAULT_MAX_DATE,
  DEFAULT_MIN_DATE,
  MONTH_NAMES,
  WEEKDAY_NAMES,
  addDays,
  addMonths,
  compareDateOnly,
  daysInMonth,
  describeDate,
  finalizeDateInput,
  formatDateOnly,
  interpretTypedDate,
  maskDateInput,
  normalizeDateOnly,
  parseDateOnly,
  todayLocalDate,
  validateDateOnly,
  weekdayOf,
} from "@/lib/dates/date-only"
import { instantToZonedLocal, zoneLabel, zonedLocalToInstant } from "@/lib/dates/zoned"

/**
 * TESDateField — the one calendar-date control for TES.
 *
 *  - Value: "YYYY-MM-DD" (or "" when empty). It is a calendar date, not an instant: nothing here reads or applies a time zone, so a date of birth or a
 *    licence expiry can never shift by a day. Timestamps use TESDateTimeField.
 *  - Typing: digits only; the dashes are added as you type (19850412 -> 1985-04-12). Pasting 1985/4/2 also works.
 *  - Calendar: a month grid with month and year pickers (a date of birth is two clicks, not 400), full keyboard support, Today and Clear.
 *  - What is shown is exactly what is stored: the same YYYY-MM-DD in every browser, locale and device.
 *  - Forms: works controlled (value/onValueChange or an input-style onChange) and uncontrolled (name + defaultValue, read by FormData). Invalid or
 *    out-of-range text blocks native submission with a clear message.
 */

type ChangeLike = React.ChangeEvent<HTMLInputElement>

/** An input-style change event carrying the value, so handlers written for <input onChange={(e) => set(e.target.value)}> keep working. */
function changeEvent(value: string, meta: { name?: string; id?: string; type: string }): ChangeLike {
  const target = { value, name: meta.name ?? "", id: meta.id ?? "", type: meta.type }
  return { target, currentTarget: target, type: "change", preventDefault() {}, stopPropagation() {}, persist() {} } as unknown as ChangeLike
}

interface CommonProps {
  id?: string
  name?: string
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
  className?: string
  invalid?: boolean
  /** An error from the form (server or schema); shown in place of the field's own message. */
  error?: string | null
  autoFocus?: boolean
  /** Extra attributes for the visible text input (data-testid, title, tabIndex …). */
  inputProps?: Record<string, unknown>
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
}

export interface TESDateFieldProps extends CommonProps {
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string) => void
  onChange?: (event: ChangeLike) => void
  /** Earliest / latest allowed date (YYYY-MM-DD). Default 1900-01-01 .. 2100-12-31. */
  min?: string
  max?: string
  placeholder?: string
  /** Month the calendar opens on when the field is empty (e.g. a date of birth might open on 1985-01). */
  defaultViewDate?: string
  /** Offer "Clear" in the calendar (default: when the field is not required). */
  clearable?: boolean
}

const errorId = (id: string) => `${id}-error`

export const TESDateField = React.forwardRef<HTMLInputElement, TESDateFieldProps>(function TESDateField(props, forwardedRef) {
  const { id: idProp, name, required, disabled, readOnly, className, invalid, error, autoFocus, onBlur, onValueChange, onChange, placeholder, defaultViewDate, clearable } = props
  const autoId = React.useId()
  const id = idProp ?? `tes-date-${autoId}`
  const min = props.min && parseDateOnly(props.min) ? props.min : DEFAULT_MIN_DATE
  const max = props.max && parseDateOnly(props.max) ? props.max : DEFAULT_MAX_DATE
  const controlled = props.value !== undefined
  const incoming = normalizeDateOnly(controlled ? props.value : props.defaultValue)
  const unrecognised = (controlled ? props.value : props.defaultValue) ? incoming === "" && String(controlled ? props.value : props.defaultValue).trim() !== "" : false

  const [text, setText] = React.useState(incoming)
  const [touched, setTouched] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const lastEmitted = React.useRef(incoming)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement)

  // Follow the parent when it changes the value (reload, reset, autosave restore) without echoing our own edits back.
  React.useEffect(() => {
    if (!controlled) return
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming
      setText(incoming)
    }
  }, [controlled, incoming])

  const typed = interpretTypedDate(text)
  const committed = typed.kind === "ok" ? typed.value : ""
  let message: string | null = null
  if (typed.kind === "invalid") message = typed.message
  else if (typed.kind === "partial") message = `Enter the complete date as YYYY-MM-DD.`
  else if (typed.kind === "ok") message = validateDateOnly(typed.value, { min, max })
  else if (required) message = "This date is required."
  else if (unrecognised && text === "") message = `The saved value is not a valid date (${String(controlled ? props.value : props.defaultValue).slice(0, 30)}). Choose the date again.`
  const showOwn = message !== null && (touched || typed.kind === "invalid" || (typed.kind === "ok" && message !== null))
  const shown = error ?? (showOwn ? message : null)

  React.useEffect(() => {
    inputRef.current?.setCustomValidity(message ?? "")
  }, [message])

  function emit(next: string) {
    if (next === lastEmitted.current) return
    lastEmitted.current = next
    onValueChange?.(next)
    onChange?.(changeEvent(next, { name, id, type: "date" }))
  }

  function handleInput(raw: string) {
    const masked = maskDateInput(raw)
    setText(masked)
    const t = interpretTypedDate(masked)
    emit(t.kind === "ok" ? t.value : "")
  }

  function pick(value: string) {
    setText(value)
    setTouched(true)
    emit(value)
    setOpen(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const canClear = (clearable ?? !required) && committed !== ""
  const describedBy = [props["aria-describedby"], shown ? errorId(id) : null].filter(Boolean).join(" ") || undefined

  return (
    <div className="w-full" data-slot="tes-date-field">
      <div className="relative">
      <input
        {...props.inputProps}
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={10}
        placeholder={placeholder ?? "YYYY-MM-DD"}
        value={text}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        aria-invalid={invalid || shown ? true : undefined}
        aria-describedby={describedBy}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        data-slot="input"
        className={cn(inputBaseClass, "pr-11 tabular-nums tracking-wide", className)}
        onChange={(e) => handleInput(e.target.value)}
        onBlur={(e) => {
          setTouched(true)
          const done = finalizeDateInput(text)
          if (done !== text) handleInput(done)
          onBlur?.(e)
        }}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || (e.altKey && e.key === "ArrowDown")) && !disabled && !readOnly) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      />
      {name ? <input type="hidden" name={name} value={committed} disabled={disabled} /> : null}
      <PopoverPrimitive.Root open={open} onOpenChange={(o) => !disabled && !readOnly && setOpen(o)}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            disabled={disabled || readOnly}
            aria-label={committed ? `Change date, ${describeDate(committed)}` : "Choose date"}
            aria-haspopup="dialog"
            className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 max-md:size-10"
          >
            <CalendarDays className="size-4" aria-hidden />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
            aria-label="Choose date"
            className="z-[300] w-[min(19rem,calc(100vw-1.5rem))] rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
          >
            <DateCalendar value={committed} min={min} max={max} defaultViewDate={defaultViewDate} onSelect={pick} onClear={canClear ? () => pick("") : undefined} />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      </div>
      {shown ? (
        <p id={errorId(id)} role="alert" className="mt-1 text-xs font-medium text-destructive">
          {shown}
        </p>
      ) : null}
    </div>
  )
})

// ---------------------------------------------------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------------------------------------------------

function clampDate(value: string, min: string, max: string) {
  return compareDateOnly(value, min) < 0 ? min : compareDateOnly(value, max) > 0 ? max : value
}

function DateCalendar({ value, min, max, defaultViewDate, onSelect, onClear }: { value: string; min: string; max: string; defaultViewDate?: string; onSelect: (v: string) => void; onClear?: () => void }) {
  const today = todayLocalDate()
  const start = clampDate(value || (defaultViewDate && parseDateOnly(defaultViewDate) ? defaultViewDate : today), min, max)
  const [focusDate, setFocusDate] = React.useState(start)
  const gridRef = React.useRef<HTMLTableElement | null>(null)
  const wantFocus = React.useRef(false)
  const view = parseDateOnly(focusDate)!
  const minYear = parseDateOnly(min)!.year
  const maxYear = parseDateOnly(max)!.year

  React.useEffect(() => {
    if (!wantFocus.current) return
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus()
  }, [focusDate])

  const move = (next: string) => {
    wantFocus.current = true
    setFocusDate(clampDate(next, min, max))
  }

  // Weeks for the viewed month, Sunday first.
  const first = formatDateOnly({ year: view.year, month: view.month, day: 1 })
  const lead = weekdayOf(first)
  const total = daysInMonth(view.year, view.month)
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => formatDateOnly({ year: view.year, month: view.month, day: i + 1 }))]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: Array<Array<string | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const disabledDay = (d: string) => compareDateOnly(d, min) < 0 || compareDateOnly(d, max) > 0
  const prevMonth = addMonths(first, -1)
  const nextMonth = addMonths(first, 1)
  const canPrev = compareDateOnly(formatDateOnly({ year: parseDateOnly(prevMonth)!.year, month: parseDateOnly(prevMonth)!.month, day: daysInMonth(parseDateOnly(prevMonth)!.year, parseDateOnly(prevMonth)!.month) }), min) >= 0
  const canNext = compareDateOnly(nextMonth, max) <= 0

  function onKey(e: React.KeyboardEvent) {
    const keys: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusDate, -1),
      ArrowRight: () => addDays(focusDate, 1),
      ArrowUp: () => addDays(focusDate, -7),
      ArrowDown: () => addDays(focusDate, 7),
      PageUp: () => addMonths(focusDate, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusDate, e.shiftKey ? 12 : 1),
      Home: () => addDays(focusDate, -weekdayOf(focusDate)),
      End: () => addDays(focusDate, 6 - weekdayOf(focusDate)),
    }
    const fn = keys[e.key]
    if (!fn) return
    e.preventDefault()
    move(fn())
  }

  const selectCls = "h-8 rounded-md border border-input bg-background px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <button type="button" aria-label="Previous month" disabled={!canPrev} onClick={() => move(prevMonth)} className="flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40 max-md:size-10">
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <select aria-label="Month" className={cn(selectCls, "min-w-0 flex-1")} value={view.month} onChange={(e) => move(formatDateOnly({ year: view.year, month: Number(e.target.value), day: Math.min(view.day, daysInMonth(view.year, Number(e.target.value))) }))}>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <select aria-label="Year" className={cn(selectCls, "w-[5.25rem]")} value={view.year} onChange={(e) => move(formatDateOnly({ year: Number(e.target.value), month: view.month, day: Math.min(view.day, daysInMonth(Number(e.target.value), view.month)) }))}>
          {Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button type="button" aria-label="Next month" disabled={!canNext} onClick={() => move(nextMonth)} className="flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40 max-md:size-10">
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
      <table ref={gridRef} role="grid" aria-label={`${MONTH_NAMES[view.month - 1]} ${view.year}`} className="w-full table-fixed border-separate border-spacing-y-0.5 text-center text-sm" onKeyDown={onKey}>
        <thead>
          <tr>
            {WEEKDAY_NAMES.map((w) => (
              <th key={w} scope="col" abbr={w} className="pb-1 text-[11px] font-semibold text-muted-foreground">
                {w.slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((d, di) =>
                d === null ? (
                  <td key={di} />
                ) : (
                  <td key={d} role="gridcell" aria-selected={d === value}>
                    <button
                      type="button"
                      data-date={d}
                      tabIndex={d === focusDate ? 0 : -1}
                      disabled={disabledDay(d)}
                      aria-label={describeDate(d)}
                      aria-current={d === today ? "date" : undefined}
                      onClick={() => onSelect(d)}
                      onFocus={() => d !== focusDate && setFocusDate(d)}
                      className={cn(
                        "mx-auto flex size-9 items-center justify-center rounded-lg tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:text-muted-foreground/40 max-md:size-10",
                        d === value ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted",
                        d === today && d !== value && "border border-primary/50 font-semibold",
                      )}
                    >
                      {Number(d.slice(8))}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-between border-t pt-2">
        <button type="button" disabled={disabledDay(today)} onClick={() => onSelect(today)} className="rounded-md px-2 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-40">
          Today
        </button>
        {onClear ? (
          <button type="button" onClick={onClear} className="rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted">
            Clear
          </button>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------------------------------------------------------------------

export function maskTimeInput(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 4)
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export function validateTime(value: string): string | null {
  if (value === "") return null
  const m = /^(\d{2}):(\d{2})$/.exec(value)
  if (!m) return "Enter the time as HH:mm (24-hour)."
  if (Number(m[1]) > 23) return "Hours are 00–23."
  if (Number(m[2]) > 59) return "Minutes are 00–59."
  return null
}

export interface TESTimeFieldProps extends CommonProps {
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string) => void
  onChange?: (event: ChangeLike) => void
}

/** Time of day, 24-hour HH:mm. A wall-clock time only; pair it with a date (and a time zone when an instant is needed) via TESDateTimeField. */
export const TESTimeField = React.forwardRef<HTMLInputElement, TESTimeFieldProps>(function TESTimeField(props, ref) {
  const { id: idProp, name, required, disabled, readOnly, className, invalid, error, autoFocus, onBlur, onValueChange, onChange } = props
  const autoId = React.useId()
  const id = idProp ?? `tes-time-${autoId}`
  const controlled = props.value !== undefined
  const raw = (controlled ? props.value : props.defaultValue) ?? ""
  const incoming = /^(\d{2}:\d{2})/.exec(raw)?.[1] ?? ""
  const [text, setText] = React.useState(incoming)
  const [touched, setTouched] = React.useState(false)
  const last = React.useRef(incoming)
  React.useEffect(() => {
    if (controlled && incoming !== last.current) {
      last.current = incoming
      setText(incoming)
    }
  }, [controlled, incoming])
  const complete = text.length === 5 && validateTime(text) === null
  const own = text === "" ? (required ? "This time is required." : null) : text.length < 5 ? "Enter the complete time as HH:mm." : validateTime(text)
  const shown = error ?? (own && (touched || text.length === 5) ? own : null)
  const innerRef = React.useRef<HTMLInputElement | null>(null)
  React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement)
  React.useEffect(() => innerRef.current?.setCustomValidity(own ?? ""), [own])
  return (
    <div className="w-full" data-slot="tes-time-field">
      <div className="relative">
      <input
        {...props.inputProps}
        ref={innerRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        placeholder="HH:mm"
        value={text}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        aria-invalid={invalid || shown ? true : undefined}
        aria-describedby={shown ? errorId(id) : props["aria-describedby"]}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        data-slot="input"
        className={cn(inputBaseClass, "pr-9 tabular-nums tracking-wide", className)}
        onChange={(e) => {
          const masked = maskTimeInput(e.target.value)
          setText(masked)
          const next = masked.length === 5 && validateTime(masked) === null ? masked : ""
          if (next !== last.current) {
            last.current = next
            onValueChange?.(next)
            onChange?.(changeEvent(next, { name, id, type: "time" }))
          }
        }}
        onBlur={(e) => {
          setTouched(true)
          onBlur?.(e)
        }}
      />
      <Clock className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      {name ? <input type="hidden" name={name} value={complete ? text : ""} disabled={disabled} /> : null}
      </div>
      {shown ? (
        <p id={errorId(id)} role="alert" className="mt-1 text-xs font-medium text-destructive">
          {shown}
        </p>
      ) : null}
    </div>
  )
})

// ---------------------------------------------------------------------------------------------------------------------------------------
// Date and time (a timestamp)
// ---------------------------------------------------------------------------------------------------------------------------------------

export interface ZonedChange {
  /** Wall-clock "YYYY-MM-DDTHH:mm" as entered. */
  local: string
  timeZone: string
  /** The UTC instant ("...Z"), or null when the entry is incomplete or the time does not exist in the zone. */
  instant: string | null
  /** The wall-clock time happens twice in the zone (clocks go back); the earlier instant is used. */
  ambiguous: boolean
}

export interface TESDateTimeFieldProps extends CommonProps {
  /** Wall-clock "YYYY-MM-DDTHH:mm" (what <input type="datetime-local"> used). With `timeZone`, a UTC instant ("...Z") is also accepted and shown in that zone. */
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (local: string) => void
  onChange?: (event: ChangeLike) => void
  /** IANA zone the wall-clock time is in (e.g. "America/Toronto"). When set, `onZonedChange` reports the UTC instant and the zone is displayed. */
  timeZone?: string
  onZonedChange?: (change: ZonedChange) => void
  /** Date limits (YYYY-MM-DD) applied to the date part. */
  min?: string
  max?: string
}

const LOCAL_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/

/**
 * A timestamp: a date, a time and — when an instant is required — the IANA time zone it was observed in. Use this for when something HAPPENED
 * (an event's occurrence, an inspection time); use TESDateField for a calendar date.
 */
export function TESDateTimeField(props: TESDateTimeFieldProps) {
  const { id: idProp, name, required, disabled, readOnly, className, error, timeZone, onValueChange, onChange, onZonedChange, min, max } = props
  const autoId = React.useId()
  const id = idProp ?? `tes-datetime-${autoId}`
  const controlled = props.value !== undefined
  const raw = (controlled ? props.value : props.defaultValue) ?? ""
  const asLocal = timeZone && /Z$|[+-]\d{2}:?\d{2}$/.test(raw) ? instantToZonedLocal(raw, timeZone) : raw
  const m = LOCAL_RE.exec(asLocal)
  const [date, setDate] = React.useState(m?.[1] ?? "")
  const [time, setTime] = React.useState(m?.[2] ?? "")
  const last = React.useRef(m ? `${m[1]}T${m[2]}` : "")
  React.useEffect(() => {
    if (!controlled) return
    const mm = LOCAL_RE.exec(asLocal)
    const next = mm ? `${mm[1]}T${mm[2]}` : ""
    if (next !== last.current) {
      last.current = next
      setDate(mm?.[1] ?? "")
      setTime(mm?.[2] ?? "")
    }
  }, [controlled, asLocal])

  const local = parseDateOnly(date) && time.length === 5 && validateTime(time) === null ? `${date}T${time}` : ""
  const zoned = local && timeZone ? zonedLocalToInstant(local, timeZone) : null
  const pairError = (date !== "" || time !== "") && local === "" && (parseDateOnly(date) || date === "") ? (date === "" ? "Enter the date as well as the time." : time === "" ? "Enter the time as well as the date." : null) : null
  const zoneError = zoned && !zoned.ok ? (zoned.reason === "gap" ? `That time does not exist in ${timeZone} on that date (clocks go forward). Choose another time.` : zoned.reason === "zone" ? `Unknown time zone: ${timeZone}.` : "Enter a valid date and time.") : null
  const ambiguous = Boolean(zoned && zoned.ok && zoned.ambiguous)

  const innerRef = React.useRef<HTMLInputElement | null>(null)
  const hiddenValue = local && !(zoned && !zoned.ok) ? local : ""

  function commit(nextDate: string, nextTime: string) {
    const nextLocal = parseDateOnly(nextDate) && nextTime.length === 5 && validateTime(nextTime) === null ? `${nextDate}T${nextTime}` : ""
    if (nextLocal === last.current) return
    last.current = nextLocal
    onValueChange?.(nextLocal)
    onChange?.(changeEvent(nextLocal, { name, id, type: "datetime-local" }))
    if (timeZone && onZonedChange) {
      const z = nextLocal ? zonedLocalToInstant(nextLocal, timeZone) : null
      onZonedChange({ local: nextLocal, timeZone, instant: z && z.ok ? z.instant : null, ambiguous: Boolean(z && z.ok && z.ambiguous) })
    }
  }

  const shown = error ?? zoneError ?? pairError
  React.useEffect(() => {
    innerRef.current?.setCustomValidity(zoneError ?? "")
  }, [zoneError])

  return (
    <div className="w-full" data-slot="tes-datetime-field">
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2 max-[420px]:grid-cols-1">
        <TESDateField
          ref={innerRef}
          id={id}
          inputProps={props.inputProps}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          min={min}
          max={max}
          value={date}
          aria-label={props["aria-label"] ? `${props["aria-label"]} — date` : "Date"}
          onValueChange={(v) => {
            setDate(v)
            commit(v, time)
          }}
        />
        <TESTimeField
          id={`${id}-time`}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          value={time}
          aria-label={props["aria-label"] ? `${props["aria-label"]} — time (24-hour)` : "Time (24-hour)"}
          onValueChange={(v) => {
            setTime(v)
            commit(date, v)
          }}
        />
      </div>
      {name ? <input type="hidden" name={name} value={hiddenValue} disabled={disabled} /> : null}
      {timeZone ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Time zone: {timeZone.replace(/_/g, " ")}
          {zoned && zoned.ok ? ` · ${zoneLabel(timeZone, Date.parse(zoned.instant))}` : ""}
        </p>
      ) : null}
      {ambiguous ? <p className="mt-1 text-xs font-medium text-yellow-900">This time happens twice in {timeZone} (clocks go back). The earlier one is used.</p> : null}
      {shown ? (
        <p role="alert" className="mt-1 text-xs font-medium text-destructive">
          {shown}
        </p>
      ) : null}
    </div>
  )
}
