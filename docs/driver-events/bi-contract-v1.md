# Driver Event analytical contract — `driver-event-fact/1`

One fact row per **current, non-duplicate** Driver Event, published by the service whenever the event, its evidence, consequences, actions, restrictions or relationships change.
It is the Driver Events input to TES business intelligence and decision support; there is no separate analytics store. The fact is **derived** (recomputable from the canonical
tables) and carries its own data-quality and provenance indicators.

* Table `public.driver_event_bi_facts` (primary key `event_id, record_version`); view `public.driver_event_facts_v1` = current version of every event that is not a `DUPLICATE_OF` another.
* Access: SYSTEM scope, `DRIVER_EVENT_READ`. Company isolation by row-level security; every query filters `organization_id`.
* API: `GET /api/companies/{id}/driver-events/facts?from=&to=&category=` returns `{contract: "driver-event-fact/1", facts: [...]}`.

## Reading rules (part of the contract)

1. **NULL means not collected or not established. It is never zero.** A zero appears only where a person recorded *None confirmed*. Aggregate with `count(col)` beside `count(*)` to show coverage.
2. **Date-only occurrences have no instant.** `occurred_at` is NULL; use `occurred_local_date` for calendar grouping and filter `occurrence_precision = 'EXACT_DATETIME'` for hour-of-day analysis.
3. **Money is minor units of one currency.** A mixture of currencies yields NULL amounts and the `MIXED_CURRENCY` flag; nothing is converted.
4. **Exposure is not stored.** Rates join distance / driving hours from the trip and ELD fact layer on `driver_relationship_id`, `vehicle_id`, `occurred_local_date`. `exposure_basis` names the keys.
5. **One occurrence counts once.** A duplicate is excluded by the view; a repair order, citation, claim or maintenance record attaches to one event only; one invoice/claim reference carries one active consequence per kind (database-enforced).
6. **Linked is not verified.** `evidence_links_active` / `evidence_stored` / `evidence_verified` are separate; `source_reliability` is `AUTHORITATIVE` only when an authority-sourced event has a *person-verified* document.
7. **No regulatory conclusion is computed.** Reportability, reporting deadlines and compliance status are person-entered facts; the governing texts (49 CFR 390.15, 396.9 and Canadian equivalents) could not be verified in the build environment.

## Columns

| Group | Columns | Notes |
|---|---|---|
| Identity | `event_id, organization_id, record_version, contract_version, category, category_code, schema_version, status, record_state` | `record_state` DRAFT or RECORDED |
| Time | `occurrence_precision, occurred_at, occurred_time_zone, occurred_local_date, reported_at, reporting_lag_minutes` | lag NULL unless both instants exist; negative lag is flagged `REPORTED_BEFORE_OCCURRED` |
| Classification | `severity_observed, severity_potential, source_type, ingestion_origin, source_reliability` | reliability: AUTHORITATIVE / CORROBORATED / SELF_REPORTED / DEVICE_UNVERIFIED / UNKNOWN |
| Parties & assets | `driver_relationship_id, driver_person_id, vehicle_id, trailer_vehicle_id, jurisdiction_code, country, state_province, load_reference, shipment_reference, customer_reference` | canonical keys; join to the wider layer |
| Evidence & quality | `verification_state, evidence_links_active, evidence_stored, evidence_verified, data_quality_score, required_fields_total, required_fields_missing, quality_flags` | score = 1 − missing/total required (NULL when none apply) |
| Outcomes | `injuries_count, fatalities_count, tow_away, property_damage` | counts from INJURY consequences (units `injuries`, `fatalities`); tow-away / damage YES/NO/UNKNOWN |
| Disruption | `delay_minutes, downtime_minutes, service_interrupted, missed_service` | durations normalised to minutes from minutes/hours/days or a start–end window |
| Financial | `currency, cost_estimated_minor, cost_actual_minor, claim_amount_minor, recovery_amount_minor, net_impact_minor` | net = actual − recovery, only when both are established |
| Resolution | `actions_total, actions_open, required_actions_open, next_action_due, restrictions_active, restrictions_released, resolution_state, closed_at, hours_to_close` | resolution: DRAFT / OPEN / RESTRICTED / AWAITING_ACTIONS / CLOSED |
| Recurrence & exposure | `recurrence_driver_key, recurrence_vehicle_key, exposure_basis, corrections_count, derived_at` | keys are `<category>|driver:<id>` and `<category>|vehicle:<id>` |

Quality flags: `NO_EVIDENCE, EVIDENCE_UNVERIFIED, NO_DRIVER_LINK, NO_VEHICLE_LINK, NO_JURISDICTION, OCCURRENCE_DATE_ONLY, OCCURRENCE_APPROXIMATE, OCCURRENCE_UNKNOWN, REQUIRED_FIELDS_MISSING, DEVICE_SOURCED, MIXED_CURRENCY, RECOVERY_NOT_COLLECTED, REPORTED_BEFORE_OCCURRED`.

## Example queries

`$1` is the company id. Each query below is executed by `test/lib/driver-events/driver-events.db.test.ts`.

### `recurrenceByDriver`

```sql
SELECT category_code, driver_relationship_id, count(*) AS events,
       min(occurred_local_date) AS first_event, max(occurred_local_date) AS last_event
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1 AND driver_relationship_id IS NOT NULL AND record_state = 'RECORDED'
 GROUP BY category_code, driver_relationship_id
HAVING count(*) >= 2
 ORDER BY events DESC, category_code
```

### `severityMixByMonth`

```sql
SELECT date_trunc('month', occurred_local_date)::date AS month, category_code, severity_observed, count(*) AS events
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1 AND occurred_local_date IS NOT NULL
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3
```

### `costAndDowntimeCoverage`

```sql
SELECT category_code,
       count(*)                          AS events,
       count(cost_actual_minor)          AS events_with_actual_cost,
       sum(cost_actual_minor)            AS actual_cost_minor_where_known,
       count(downtime_minutes)           AS events_with_downtime,
       sum(downtime_minutes)             AS downtime_minutes_where_known,
       count(*) FILTER (WHERE quality_flags ? 'MIXED_CURRENCY') AS events_with_mixed_currency
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1
 GROUP BY category_code
 ORDER BY category_code
```

### `ratePerThousandHours`

```sql
WITH exposure(driver_relationship_id, month, driving_hours) AS (
  -- supplied by the trip / ELD fact layer; shown here as the shape the join expects
  SELECT * FROM (VALUES (NULL::uuid, NULL::date, NULL::numeric)) AS x WHERE false
)
SELECT f.category_code, f.driver_relationship_id, date_trunc('month', f.occurred_local_date)::date AS month,
       count(*) AS events, e.driving_hours,
       round(count(*) * 1000.0 / nullif(e.driving_hours, 0), 3) AS events_per_1000_hours
  FROM public.driver_event_facts_v1 f
  JOIN exposure e ON e.driver_relationship_id = f.driver_relationship_id AND e.month = date_trunc('month', f.occurred_local_date)::date
 WHERE f.organization_id = $1 AND f.occurrence_precision IN ('EXACT_DATETIME', 'DATE_ONLY')
 GROUP BY 1, 2, 3, e.driving_hours
```

### `evidenceAndVerification`

```sql
SELECT category_code,
       count(*)                                          AS events,
       count(*) FILTER (WHERE evidence_stored > 0)       AS with_stored_evidence,
       count(*) FILTER (WHERE evidence_verified > 0)     AS with_verified_evidence,
       count(*) FILTER (WHERE source_reliability = 'AUTHORITATIVE') AS authoritative
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1
 GROUP BY category_code
 ORDER BY category_code
```

### `dataQuality`

```sql
SELECT category_code, round(avg(data_quality_score), 3) AS avg_completeness,
       count(*) FILTER (WHERE quality_flags ? 'NO_EVIDENCE')       AS no_evidence,
       count(*) FILTER (WHERE quality_flags ? 'NO_DRIVER_LINK')    AS no_driver_link,
       count(*) FILTER (WHERE quality_flags ? 'OCCURRENCE_DATE_ONLY') AS date_only,
       count(*) FILTER (WHERE quality_flags ? 'DEVICE_SOURCED')    AS device_sourced
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1
 GROUP BY category_code
 ORDER BY category_code
```

### `restrictionsAndFollowUp`

```sql
SELECT event_id, category_code, resolution_state, restrictions_active, required_actions_open, next_action_due
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1 AND (restrictions_active > 0 OR required_actions_open > 0)
 ORDER BY restrictions_active DESC, next_action_due NULLS LAST
```

### `correctionAndClosureTimeliness`

```sql
SELECT category_code, count(*) AS events, sum(corrections_count) AS corrections,
       round(avg(hours_to_close), 1) AS avg_hours_to_close, count(hours_to_close) AS closed_events
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1
 GROUP BY category_code
 ORDER BY category_code
```

