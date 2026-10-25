await import("/tmp/claude-0/-home-user-TESPortal/93514665-c9b6-5d17-a2b4-261f33d2a38e/scratchpad/wt-app/test/helpers/register-auth-test-loader.mjs")
const m = await import("@/lib/driver-performance-schema")
const want = (process.env.CATS ?? "").split("|")
for (const d of m.DRIVER_PERFORMANCE_CATEGORY_REGISTRY as any[]) {
  if (!want.includes(d.value)) continue
  console.log(`## ${d.value} (${d.fields.length})`)
  for (const f of d.fields) console.log(`${f.key}|${f.label}|${f.kind}${f.required ? "|REQ" : ""}${f.unit ? "|" + f.unit : ""}${f.options ? "|opts" + f.options.length : ""}${f.visibleWhen ? "|vw" : ""}${f.hiddenInCreation ? "|HID" : ""}`)
}
