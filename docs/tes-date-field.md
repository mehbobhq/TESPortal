# TES date and time fields

One implementation of every date control in TES: `components/ui/tes-date-field.tsx` (`TESDateField`, `TESTimeField`, `TESDateTimeField`), built on the pure helpers in `lib/dates/`.
`<Input type="date" | "time" | "datetime-local">` (`components/ui/input.tsx`) renders these components, so existing `<Input type="date" value onChange>` call sites use them without edits.

## Why the old controls looked wrong

The portal used the browser's native `<input type="date">` / `datetime-local` styled with the text-input class, plus two bespoke replacements (`DriverDateInput`, the legacy-drivers `Field`), plus ~60 raw `<input type="date">` elements with their own classes. Consequences (reproduced in Chromium; the WebKit points are documented behaviour and need a device check):

1. **Display depends on the browser, OS and locale.** The same stored date shows as `04/12/1985`, `12/04/1985` or `1985-04-12`, and the empty state shows `mm/dd/yyyy`, `dd/mm/yyyy` or `jj/mm/aaaa`; the `placeholder` attribute is ignored on native date inputs (legacy-drivers passed one that never appeared).
2. **Native segments ignore the control's box.** The text-input class sets a fixed `h-9`, `px-3` and `text-base md:text-[13px]`. Chromium lays the day/month/year segments out inside that box; iOS Safari applies its own intrinsic height, centred text and padding to native date inputs and ignores `h-9`/`px-3`, so the field renders narrower, taller and centred next to the other inputs (the "distorted" Date of Birth). The font-size switch at the `md` breakpoint also makes the segments jump in size.
3. **A value that is not exactly `YYYY-MM-DD` renders blank, silently.** An API/DB timestamp such as `2026-10-25T00:00:00.000Z` shows an empty field (the browser logs "does not conform to the required format") and the next save can write an empty date.
4. **Defaults were computed in UTC.** 36 sites defaulted "today" with `new Date().toISOString().slice(0, 10)`, which is tomorrow's date for anyone west of Greenwich after the evening: a calendar-date bug of the same family.
5. **`datetime-local` carries no time zone**, so an event time is ambiguous across zones.

## Contract

| | `TESDateField` | `TESDateTimeField` | `TESTimeField` |
|---|---|---|---|
| Value | `YYYY-MM-DD` or `""` | `YYYY-MM-DDTHH:mm` (wall clock) or `""`; with `timeZone`, also reports the UTC instant | `HH:mm` (24 h) or `""` |
| Meaning | A calendar date. No time, no zone, never converted. | A moment: date + time (+ IANA zone when an instant is required). | A wall-clock time. |

* **Date-only values never pass through a `Date` in the viewer's zone.** API values are normalised by reading the date part as written (`1985-04-12T00:00:00.000Z` → `1985-04-12`). Weekdays and day arithmetic use UTC maths on year/month/day only. "Today" is the viewer's calendar date (`todayLocalDate`) or a named zone's (`todayInZone`).
* **Typing:** digits only, dashes added as you type (`19850412` → `1985-04-12`); `1985/4/2` pasted is accepted; incomplete or impossible entries emit `""` (so the form never holds a value the field is not showing) and show a specific message (`2027 is not a leap year, so it has no 29 February.`).
* **Calendar:** month/year selectors (a date of birth is two selections), prev/next, Today, Clear (optional fields), disabled days outside `min`/`max`, full keyboard support (arrows, PageUp/PageDown, Shift+PageUp/Down, Home/End, Enter, Escape, ArrowDown on the input opens it).
* **Forms:** controlled (`value` + `onValueChange(value)` or input-style `onChange(e)` with `e.target.value`) or uncontrolled (`name` + `defaultValue`, read by `FormData` through a hidden input holding only a valid date). Invalid or out-of-range text sets a custom validity message so native submission is blocked.
* **Rules:** `required`, `min`, `max` (default 1900-01-01 … 2100-12-31), `disabled`, `readOnly`, `invalid`, `error`, `defaultViewDate`, `clearable`.
* **Zoned timestamps (`lib/dates/zoned.ts`):** wall-clock time in an IANA zone ⇄ UTC instant without the browser's zone; a time skipped by daylight saving is reported (`gap`), a repeated time is flagged and the earlier instant is used.
* **Do not use a date field for an event's occurrence time.** Use `TESDateTimeField` with `timeZone` and store the instant plus the zone.

## Migration coverage

Replaced automatically through `Input` (every `<Input type="date|time|datetime-local">`): company creation and edit, citations, canonical insurance terms, prospect/onboarding forms, legacy drivers, contracts panel, legal-name change, audit log filters, canonical registry, vehicle profile and inspection records.

Replaced by hand (raw `<input>` → `<Input>`): authorities forms and OCR workspace, business cards (EIN, GST, CRA, sales tax, incorporation, annual returns, audit cases), insurance forms (surety bond, transportation policy, workers' compensation, OCR workspace), OCR review (dynamic type), Driver Events panels and wizards (collision, cargo, spill, customer event, roadside, performance workflow and tab), driver list, company action modal, emission test record.

Other: `DriverDateInput` (profile, screening, qualifications, training) now wraps `TESDateField`; the applicant application's date question (`FieldControls`) uses `TESDateField` with `max`/`min` from the field's `notFuture`/`notPast` rules.

All 36 UI "today" defaults now use `todayLocalDate()`.

Not changed: server-side `new Date().toISOString().slice(0, 10)` in `lib/` (server code, UTC by design), and PDF/report formatting.
