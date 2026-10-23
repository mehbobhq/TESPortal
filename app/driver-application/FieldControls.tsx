"use client"

import { useId, useRef, useState } from "react"
import type { ItemField, Option, OptionsRef } from "@/lib/driver-application/catalogue/types"
import type { PlanField } from "@/lib/driver-application/plan"
import { JURISDICTIONS } from "@/lib/jurisdictions"
import { evalCond } from "@/lib/driver-application/conditions"
import { ApiError, api, prepareFile } from "./api-client"

const inputCls = "w-full rounded-xl border border-[#CBD5E1] bg-white px-3.5 py-3 text-base text-[#0F172A] shadow-sm outline-none transition motion-reduce:transition-none placeholder:text-[#94A3B8] focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/15 aria-[invalid=true]:border-[#B91C1C]"
const btn = "inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition motion-reduce:transition-none focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1D4ED8]/30 disabled:cursor-not-allowed disabled:opacity-50"
export const primaryBtn = `${btn} bg-[#0B1F44] text-white hover:bg-[#13306B]`
export const secondaryBtn = `${btn} border border-[#CBD5E1] bg-white text-[#0B1F44] hover:bg-[#F1F5F9]`

function optionsFor(options: Option[] | undefined, ref: OptionsRef | undefined): Option[] {
  if (ref) {
    const want = ref === "jurisdictions.us" ? ["United States"] : ref === "jurisdictions.ca" ? ["Canada"] : ["Canada", "United States"]
    return JURISDICTIONS.filter((j) => want.includes(j.country)).map((j) => ({ value: j.code, label: `${j.label} (${j.code})` }))
  }
  return options ?? []
}

type Common = { id: string; label: string; help?: string; required: boolean; error?: string }

export function Labelled({ id, label, help, required, error, children }: Common & { children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-[#0B1F44]">
        {label}
        {required ? <span aria-hidden className="ml-0.5 text-[#B91C1C]">*</span> : <span className="ml-1.5 text-xs font-normal text-[#64748B]">optional</span>}
      </label>
      {help ? <p id={`${id}-help`} className="text-xs leading-5 text-[#64748B]">{help}</p> : null}
      {children}
      {error ? <p id={`${id}-err`} role="alert" className="text-sm font-medium text-[#B91C1C]">{error}</p> : null}
    </div>
  )
}

function Scalar({ type, value, onChange, id, options, optionsRef, error, hasHelp, onBlur }: { type: string; value: unknown; onChange: (v: unknown) => void; id: string; options?: Option[]; optionsRef?: OptionsRef; error?: string; hasHelp: boolean; onBlur?: () => void }) {
  const aria = { "aria-invalid": error ? true : undefined, "aria-describedby": [hasHelp ? `${id}-help` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined } as const
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : ""
  switch (type) {
    case "textarea":
      return <textarea id={id} rows={4} className={inputCls} value={text} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} {...aria} />
    case "select":
      return (
        <select id={id} className={inputCls} value={text} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} {...aria}>
          <option value="">Select…</option>
          {optionsFor(options, optionsRef).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case "yesno":
      return (
        <div role="radiogroup" id={id} className="flex gap-3" {...aria}>
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-xl border px-4 text-sm font-semibold transition motion-reduce:transition-none has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#1D4ED8]/30 ${value === v ? "border-[#0B1F44] bg-[#0B1F44] text-white" : "border-[#CBD5E1] bg-white text-[#0B1F44] hover:bg-[#F1F5F9]"}`}>
              <input type="radio" name={id} className="sr-only" checked={value === v} onChange={() => onChange(v)} onBlur={onBlur} />
              {v === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
      )
    case "multiselect": {
      const picked = Array.isArray(value) ? (value as string[]) : []
      return (
        <div id={id} role="group" className="grid gap-2 sm:grid-cols-2" {...aria}>
          {optionsFor(options, optionsRef).map((o) => (
            <label key={o.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[#CBD5E1] bg-white px-3.5 text-sm text-[#0F172A] has-[:checked]:border-[#0B1F44] has-[:checked]:bg-[#EFF6FF]">
              <input type="checkbox" className="h-4 w-4 accent-[#0B1F44]" checked={picked.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value))} />
              {o.label}
            </label>
          ))}
        </div>
      )
    }
    default: {
      const htmlType = type === "email" ? "email" : type === "date" ? "date" : type === "number" ? "number" : type === "phone" ? "tel" : "text"
      return <input id={id} type={htmlType} inputMode={type === "number" ? "decimal" : undefined} autoComplete="off" className={inputCls} value={text} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} {...aria} />
    }
  }
}

function Repeatable({ field, value, onChange, errors, onBlur }: { field: PlanField; value: unknown; onChange: (v: unknown) => void; errors: Array<Record<string, string>> | undefined; onBlur: () => void }) {
  const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
  const base = useId()
  const set = (i: number, key: string, v: unknown) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)))
  const max = field.validation?.maxItems ?? 30
  return (
    <div className="space-y-4">
      {rows.map((row, i) => (
        <fieldset key={i} className="space-y-4 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
          <legend className="px-1 text-sm font-semibold text-[#0B1F44]">{field.label} {i + 1}</legend>
          {(field.itemFields ?? []).map((f: ItemField) => {
            if (f.appliesWhen && evalCond(f.appliesWhen, { ctx: {}, ans: {}, item: row } as never) === "F") return null
            const id = `${base}-${i}-${f.id}`
            const err = errors?.[i]?.[f.id]
            return (
              <Labelled key={f.id} id={id} label={f.label} required={f.required} error={err}>
                <Scalar type={f.type} value={row[f.id]} onChange={(v) => set(i, f.id, v)} id={id} options={f.options} optionsRef={f.optionsRef} error={err} hasHelp={false} onBlur={onBlur} />
              </Labelled>
            )
          })}
          <button type="button" className="text-sm font-semibold text-[#B91C1C] underline-offset-2 hover:underline" onClick={() => { onChange(rows.filter((_, idx) => idx !== i)); onBlur() }}>Remove this entry</button>
        </fieldset>
      ))}
      {rows.length < max ? <button type="button" className={secondaryBtn} onClick={() => onChange([...rows, {}])}>Add {rows.length ? "another" : "an entry"}</button> : null}
    </div>
  )
}

function UploadControl({ field, id, files, disabled, onChanged }: { field: PlanField; id: string; files: Array<{ documentId: string; filename: string; state: string; slot: string }>; disabled: boolean; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const accept = (field.evidence?.accept ?? []).join(",")
  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setMessage(null)
    try {
      const prepared = await prepareFile(file)
      const form = new FormData()
      form.set("fieldId", field.id)
      form.set("file", prepared)
      await api("/api/driver-applications/uploads", { method: "POST", form })
      onChanged()
    } catch (e) {
      setMessage(e instanceof ApiError || e instanceof Error ? e.message : "The upload failed. Try again.")
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ""
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-[#64748B]">{field.evidence?.hint}</p>
      {files.map((f) => (
        <div key={f.documentId} className="flex items-center justify-between gap-3 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-3.5 py-2.5 text-sm text-[#14532D]">
          <span className="min-w-0 truncate">{f.filename}</span>
          <span className="shrink-0 text-xs font-semibold">Received</span>
        </div>
      ))}
      <input ref={input} id={id} type="file" accept={accept} capture={undefined} className="sr-only" disabled={disabled || busy} onChange={(e) => void pick(e.target.files?.[0])} />
      <label htmlFor={id} className={`${secondaryBtn} cursor-pointer ${disabled || busy ? "pointer-events-none opacity-50" : ""}`}>
        {busy ? "Uploading…" : files.length ? "Replace or add another" : "Choose a file or take a photo"}
      </label>
      {message ? <p role="alert" className="text-sm font-medium text-[#B91C1C]">{message}</p> : null}
    </div>
  )
}

function SensitiveControl({ field, id, collected, disabled }: { field: PlanField; id: string; collected: boolean; disabled: boolean }) {
  const [value, setValue] = useState("")
  const [masked, setMasked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  if (!field.collection.enabled) {
    return <p className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-3 text-sm leading-6 text-[#78350F]">The company will ask for this separately. It is not collected on this form.</p>
  }
  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api<{ masked: string }>("/api/driver-applications/sensitive", { method: "PUT", json: { fieldId: field.id, value } })
      setMasked(r.masked)
      setValue("")
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "This could not be saved.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      {collected || masked ? <p className="text-sm font-semibold text-[#14532D]">Received securely{masked ? ` (${masked})` : ""}. You can enter it again to replace it.</p> : null}
      <div className="flex gap-2">
        <input id={id} type="password" autoComplete="off" spellCheck={false} className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled || busy} />
        <button type="button" className={primaryBtn} disabled={disabled || busy || !value.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
      </div>
      <p className="text-xs text-[#64748B]">Stored encrypted. It is never shown again on this page.</p>
      {message ? <p role="alert" className="text-sm font-medium text-[#B91C1C]">{message}</p> : null}
    </div>
  )
}

export function FieldControl(props: {
  field: PlanField
  required: boolean
  value: unknown
  error?: string
  itemErrors?: Array<Record<string, string>>
  uploads: Array<{ documentId: string; filename: string; state: string; slot: string; fieldId: string }>
  sensitiveCollected: boolean
  locked: boolean
  onChange: (v: unknown) => void
  onBlur: () => void
  onUploaded: () => void
}) {
  const { field } = props
  const id = useId()
  const label = (
    <Labelled id={id} label={field.label} help={field.help} required={props.required} error={props.error}>
      {field.type === "repeatable" ? (
        <Repeatable field={field} value={props.value} onChange={props.onChange} errors={props.itemErrors} onBlur={props.onBlur} />
      ) : field.type === "upload" ? (
        <UploadControl field={field} id={id} files={props.uploads.filter((u) => u.fieldId === field.id)} disabled={props.locked} onChanged={props.onUploaded} />
      ) : field.type === "sensitive" ? (
        <SensitiveControl field={field} id={id} collected={props.sensitiveCollected} disabled={props.locked} />
      ) : (
        <Scalar type={field.type} value={props.value} onChange={props.onChange} id={id} options={field.options} optionsRef={field.optionsRef} error={props.error} hasHelp={Boolean(field.help)} onBlur={props.onBlur} />
      )}
    </Labelled>
  )
  return label
}
