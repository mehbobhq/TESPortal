/**
 * Worked queries over the Driver Event fact view (contract driver-event-fact/1). Every one runs against public.driver_event_facts_v1, which already
 * excludes duplicates, and each is executed by the database test suite so the documentation cannot drift from the schema.
 *
 * Reading rules that apply to all of them:
 *   - a NULL measure means "not collected"; it is never summed as zero. Use count(col) (events WITH the measure) next to count(*) to show coverage.
 *   - occurred_at is NULL for date-only events; use occurred_local_date for calendar grouping, and occurrence_precision = 'EXACT_DATETIME' for any hour-of-day analysis.
 *   - exposure (distance, driving hours) is not stored on the event. A rate joins an exposure source the analytics layer already owns; the query shows the join shape
 *     with that source passed in as a CTE.
 * $1 is the company (organization) id.
 */
export const BI_EXAMPLE_QUERIES: Readonly<Record<string, string>> = {
  recurrenceByDriver: `
SELECT category_code, driver_relationship_id, count(*) AS events,
       min(occurred_local_date) AS first_event, max(occurred_local_date) AS last_event
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1 AND driver_relationship_id IS NOT NULL AND record_state = 'RECORDED'
 GROUP BY category_code, driver_relationship_id
HAVING count(*) >= 2
 ORDER BY events DESC, category_code`,

  severityMixByMonth: `
SELECT date_trunc('month', occurred_local_date)::date AS month, category_code, severity_observed, count(*) AS events
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1 AND occurred_local_date IS NOT NULL
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3`,

  costAndDowntimeCoverage: `
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
 ORDER BY category_code`,

  ratePerThousandHours: `
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
 GROUP BY 1, 2, 3, e.driving_hours`,

  evidenceAndVerification: `
SELECT category_code,
       count(*)                                          AS events,
       count(*) FILTER (WHERE evidence_stored > 0)       AS with_stored_evidence,
       count(*) FILTER (WHERE evidence_verified > 0)     AS with_verified_evidence,
       count(*) FILTER (WHERE source_reliability = 'AUTHORITATIVE') AS authoritative
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1
 GROUP BY category_code
 ORDER BY category_code`,

  dataQuality: `
SELECT category_code, round(avg(data_quality_score), 3) AS avg_completeness,
       count(*) FILTER (WHERE quality_flags ? 'NO_EVIDENCE')       AS no_evidence,
       count(*) FILTER (WHERE quality_flags ? 'NO_DRIVER_LINK')    AS no_driver_link,
       count(*) FILTER (WHERE quality_flags ? 'OCCURRENCE_DATE_ONLY') AS date_only,
       count(*) FILTER (WHERE quality_flags ? 'DEVICE_SOURCED')    AS device_sourced
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1
 GROUP BY category_code
 ORDER BY category_code`,

  restrictionsAndFollowUp: `
SELECT event_id, category_code, resolution_state, restrictions_active, required_actions_open, next_action_due
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1 AND (restrictions_active > 0 OR required_actions_open > 0)
 ORDER BY restrictions_active DESC, next_action_due NULLS LAST`,

  correctionAndClosureTimeliness: `
SELECT category_code, count(*) AS events, sum(corrections_count) AS corrections,
       round(avg(hours_to_close), 1) AS avg_hours_to_close, count(hours_to_close) AS closed_events
  FROM public.driver_event_facts_v1
 WHERE organization_id = $1
 GROUP BY category_code
 ORDER BY category_code`,
}
