"use client"

import { Button } from "@/components/ui/button"
import { inputClass } from "./field-input"

type Item = { itemId: string; facts: Record<string, string | number | boolean | null>; evidenceIds?: string[]; [k: string]: unknown }
type Collection = { collectionId: string; collectionVersion: string; itemType: string; completeness: string; items: Item[]; [k: string]: unknown }

const human = (v: string) => v.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().replace(/(^|\s)\w/g, (c) => c.toUpperCase())
const newId = (prefix: string) => `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36)}`

/**
 * Corrects the detailed records of an event (parties, injured persons, violations, inspected equipment, items, materials ...). Nothing here overwrites history: the
 * correction is saved as a NEW version with its reason, the earlier version stays readable, and the history names each item that was added, changed or removed.
 */
export function ChildCollectionsEditor({ value, onChange, disabled }: { value: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void; disabled?: boolean }) {
  const entries = Object.entries(value).filter(([id, c]) => id !== "DRV.PERF.ADAPTER.ORIGINAL_WORDING" && c && typeof c === "object" && Array.isArray((c as Collection).items)) as [string, Collection][]
  if (!entries.length) return null
  const set = (id: string, next: Collection) => onChange({ ...value, [id]: next })
  return (
    <section className="rounded-2xl border border-border p-4" data-testid="child-collections-editor">
      <h3 className="text-sm font-bold text-foreground">Detail records</h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Correct the items recorded under this event. Added, changed and removed items are listed in the history with your reason; the earlier version stays as it was.</p>
      <div className="mt-3 space-y-4">
        {entries.map(([id, c]) => (
          <div key={id} data-collection={id}>
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold">{human(id.split(".").slice(-1)[0])} <span className="font-normal text-muted-foreground">({c.items.length})</span></h4>
              <Button type="button" size="xs" variant="outline" disabled={disabled} onClick={() => {
                const keys = [...new Set(c.items.flatMap((i) => Object.keys(i.facts)))]
                set(id, { ...c, items: [...c.items, { itemId: newId(c.itemType.slice(0, 3)), facts: Object.fromEntries(keys.map((k) => [k, null])), evidenceIds: [] }] })
              }}>Add item</Button>
            </div>
            {c.items.length === 0 ? <p className="text-[11px] text-muted-foreground">No items recorded.</p> : null}
            {c.items.map((item) => (
              <div key={item.itemId} className="mt-2 rounded-xl border border-border bg-muted/10 p-3" data-item={item.itemId}>
                <div className="flex items-center justify-between"><span className="text-[10px] text-muted-foreground">{item.itemId}</span>
                  <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => set(id, { ...c, items: c.items.filter((i) => i.itemId !== item.itemId) })}>Remove</Button></div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {Object.entries(item.facts).map(([k, v]) => (
                    <label key={k} className="text-[11px] font-semibold">{human(k)}
                      {typeof v === "boolean" ? (
                        <select className={inputClass} value={v ? "yes" : "no"} onChange={(e) => set(id, { ...c, items: c.items.map((i) => i.itemId === item.itemId ? { ...i, facts: { ...i.facts, [k]: e.target.value === "yes" } } : i) })}><option value="yes">Yes</option><option value="no">No</option></select>
                      ) : (
                        <input className={inputClass} type={typeof v === "number" ? "number" : "text"} step="any" value={v === null ? "" : String(v)} data-fact={k}
                          onChange={(e) => set(id, { ...c, items: c.items.map((i) => i.itemId === item.itemId ? { ...i, facts: { ...i.facts, [k]: e.target.value === "" ? null : typeof v === "number" ? Number(e.target.value) : e.target.value } } : i) })} />
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
