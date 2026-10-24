"use client"

import { useId, useRef, useState } from "react"
import { CloudUpload, FileCheck2, Lock, Plus, Trash2 } from "lucide-react"
import type { ItemField, Option, OptionsRef } from "@/lib/driver-application/catalogue/types"
import type { PlanField } from "@/lib/driver-application/plan"
import { JURISDICTIONS } from "@/lib/jurisdictions"
import { evalCond } from "@/lib/driver-application/conditions"
import { ApiError, api, prepareFile } from "./api-client"

const inputCls =
  "w-full min-h-12 rounded-xl border border-[#C9D6EA] bg-white px-3.5 py-3 text-base text-[#0B1F44] shadow-[0_1px_0_rgba(11,31,68,0.04)] outline-none transition motion-reduce:transition-none placeholder:text-[#94A3B8] hover:border-[#9DB4DA] focus:border-[#1D4ED8] focus:ring-4 focus:ring-[#1D4ED8]/15 aria-[invalid=true]:border-[#B91C1C] aria-[invalid=true]:ring-[#B91C1C]/10 disabled:opacity-60"
const btn =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-[15px] font-semibold transition motion-reduce:transition-none focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1D4ED8]/30 disabled:cursor-not-allowed disabled:opacity-50"
export const primaryBtn = `${btn} bg-gradient-to-b from-[#2563EB] to-[#1D4ED8] text-white shadow-[0_6px_16px_-6px_rgba(29,78,216,0.65)] hover:from-[#1D4ED8] hover:to-[#1E40AF]`
export const secondaryBtn = `${btn} border border-[#C9D6EA] bg-white text-[#0B1F44] hover:bg-[#F3F7FE]`
export const ghostBtn = `${btn} text-[#1D4ED8] hover:bg-[#EAF2FF]`

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
    <div className="space-y-2">
      <label htmlFor={id} className="block text-[15px] font-semibold leading-snug text-[#0B1F44]">
        {label}
        {required ? <span aria-hidden className="ml-1 text-[#1D4ED8]">*</span> : <span className="ml-2 text-xs font-medium text-[#64748B]">Optional</span>}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {help ? <p id={`${id}-help`} className="text-[13px] leading-5 text-[#5B6B82]">{help}</p> : null}
      {children}
      {error ? <p id={`${id}-err`} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-[#B91C1C]"><span aria-hidden>●</span>{error}</p> : null}
    </div>
  )
}

function Scalar({ type, value, onChange, id, options, optionsRef, error, hasHelp, onBlur }: { type: string; value: unknown; onChange: (v: unknown) => void; id: string; options?: Option[]; optionsRef?: OptionsRef; error?: string; hasHelp: boolean; onBlur?: () => void }) {
  const aria = { "aria-invalid": error ? true : undefined, "aria-describedby": [hasHelp ? `${id}-help` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined } as const
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : ""
  switch (type) {
    case "textarea":
      return <textarea id={id} rows={4} className={`${inputCls} leading-6`} value={text} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} {...aria} />
    case "select":
      return (
        <select id={id} className={inputCls} value={text} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} {...aria}>
          <option value="">Select…</option>
          {optionsFor(options, optionsRef).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case "yesno":
      return (
        <div role="radiogroup" id={id} className="grid grid-cols-2 gap-3 sm:max-w-sm" {...aria}>
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border px-4 text-[15px] font-semibold transition motion-reduce:transition-none has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#1D4ED8]/30 ${value === v ? "border-[#1D4ED8] bg-[#EAF2FF] text-[#0B1F44] shadow-[inset_0_0_0_1px_#1D4ED8]" : "border-[#C9D6EA] bg-white text-[#334155] hover:bg-[#F3F7FE]"}`}>
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
            <label key={o.value} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[#C9D6EA] bg-white px-3.5 text-[15px] text-[#0B1F44] has-[:checked]:border-[#1D4ED8] has-[:checked]:bg-[#EAF2FF] has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#1D4ED8]/30">
              <input type="checkbox" className="h-5 w-5 accent-[#1D4ED8]" checked={picked.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value))} />
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

function entryName(field: PlanField): string {
  if (field.id.includes("address")) return "Address"
  if (field.id === "employment.history") return "Employer"
  if (field.id.includes("training")) return "Course"
  if (field.id.includes("accident")) return "Accident"
  if (field.id.includes("violation")) return "Conviction"
  if (field.id.includes("previous_names")) return "Name"
  if (field.id.includes("references")) return "Reference"
  if (field.id.includes("certificates")) return "Certificate"
  return "Entry"
}

function Repeatable({ field, value, onChange, errors, onBlur }: { field: PlanField; value: unknown; onChange: (v: unknown) => void; errors: Array<Record<string, string>> | undefined; onBlur: () => void }) {
  const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []
  const base = useId()
  const set = (i: number, key: string, v: unknown) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)))
  const max = field.validation?.maxItems ?? 30
  const name = entryName(field)
  return (
    <div className="space-y-4">
      {rows.map((row, i) => (
        <fieldset key={i} className="rounded-2xl border border-[#D6E2F5] bg-[#F7FAFF] p-4 sm:p-5">
          <legend className="sr-only">{name} {i + 1}</legend>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1D4ED8] text-[13px] font-bold text-white">{i + 1}</span>
              <span className="text-[15px] font-semibold text-[#0B1F44]">{name} {i + 1}</span>
            </div>
            <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[#B91C1C] hover:bg-[#FEF2F2] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#B91C1C]/20" onClick={() => { onChange(rows.filter((_, idx) => idx !== i)); onBlur() }}>
              <Trash2 aria-hidden className="h-4 w-4" />Remove<span className="sr-only"> {name} {i + 1}</span>
            </button>
          </div>
          <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
            {(field.itemFields ?? []).map((f: ItemField) => {
              if (f.appliesWhen && evalCond(f.appliesWhen, { ctx: {}, ans: {}, item: row } as never) === "F") return null
              const id = `${base}-${i}-${f.id}`
              const err = errors?.[i]?.[f.id]
              const wide = f.type === "textarea" || f.type === "yesno" || f.label.length > 58
              return (
                <div key={f.id} className={wide ? "md:col-span-2" : ""}>
                  <Labelled id={id} label={f.label} required={f.required} error={err}>
                    <Scalar type={f.type} value={row[f.id]} onChange={(v) => set(i, f.id, v)} id={id} options={f.options} optionsRef={f.optionsRef} error={err} hasHelp={false} onBlur={onBlur} />
                  </Labelled>
                </div>
              )
            })}
          </div>
        </fieldset>
      ))}
      {rows.length < max ? (
        <button type="button" className={secondaryBtn} onClick={() => onChange([...rows, {}])}>
          <Plus aria-hidden className="h-4 w-4" />Add {rows.length ? "another" : "a"} {name.toLowerCase()}
        </button>
      ) : null}
    </div>
  )
}

function UploadControl({ field, id, files, disabled, onChanged }: { field: PlanField; id: string; files: Array<{ documentId: string; filename: string; state: string; slot: string }>; disabled: boolean; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
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
  const off = disabled || busy
  return (
    <div className="space-y-3">
      {field.evidence?.hint ? <p className="text-[13px] leading-5 text-[#5B6B82]">{field.evidence.hint}</p> : null}
      {files.map((f) => (
        <div key={f.documentId} className="flex items-center gap-3 rounded-xl border border-[#BFD3F5] bg-[#EAF2FF] px-4 py-3 text-sm text-[#0B1F44]">
          <FileCheck2 aria-hidden className="h-5 w-5 shrink-0 text-[#1D4ED8]" />
          <span className="min-w-0 flex-1 truncate font-medium">{f.filename}</span>
          <span className="shrink-0 text-xs font-semibold text-[#1D4ED8]">Received</span>
        </div>
      ))}
      <input ref={input} id={id} type="file" accept={accept} className="sr-only" disabled={off} onChange={(e) => void pick(e.target.files?.[0])} />
      <label
        htmlFor={id}
        onDragOver={(e) => { e.preventDefault(); if (!off) setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!off) void pick(e.dataTransfer.files?.[0]) }}
        className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition motion-reduce:transition-none has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#1D4ED8]/30 ${over ? "border-[#1D4ED8] bg-[#EAF2FF]" : "border-[#B8CBE8] bg-white hover:bg-[#F3F7FE]"} ${off ? "pointer-events-none opacity-60" : ""}`}
      >
        <CloudUpload aria-hidden className="h-7 w-7 text-[#1D4ED8]" />
        <span className="text-[15px] font-semibold text-[#0B1F44]">{busy ? "Uploading…" : files.length ? "Replace this file" : "Choose a file or take a photo"}</span>
        <span className="text-xs text-[#5B6B82]">Photos are reduced automatically. PDF, JPG or PNG.</span>
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
    return (
      <p className="flex items-start gap-2.5 rounded-xl border border-[#D6E2F5] bg-[#F7FAFF] px-4 py-3 text-sm leading-6 text-[#334155]">
        <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[#1D4ED8]" />
        The company will ask for this separately. It is not collected on this form.
      </p>
    )
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
      {collected || masked ? <p className="text-sm font-semibold text-[#0B1F44]">Received securely{masked ? ` (${masked})` : ""}. Enter it again to replace it.</p> : null}
      <div className="flex gap-2">
        <input id={id} type="password" autoComplete="off" spellCheck={false} className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled || busy} />
        <button type="button" className={primaryBtn} disabled={disabled || busy || !value.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-[#5B6B82]"><Lock aria-hidden className="h-3.5 w-3.5" />Stored encrypted. It is never shown again on this page.</p>
      {message ? <p role="alert" className="text-sm font-medium text-[#B91C1C]">{message}</p> : null}
    </div>
  )
}

export function isWideField(field: PlanField): boolean {
  return ["textarea", "yesno", "multiselect", "repeatable", "upload", "sensitive"].includes(field.type) || field.label.length > 64 || Boolean(field.help && field.help.length > 90)
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
  return (
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
}
