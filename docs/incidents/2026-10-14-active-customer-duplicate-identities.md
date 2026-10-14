# Active Customers duplicate-identity incident — 2026-10-14

Status: OPEN, screenshot-confirmed, database cause unverified. No records modified.

Observed two active roster entries for "Power Way Logistics Inc", AB, CA:
- customer/roster Record ID 203434cf-2754-41ed-89f6-59d7bdc1f1f3
- customer/roster Record ID 5d54ed42-ba6e-49a2-8047-bdb51e8fdefb

## Repository findings (Oct 13 main)
- `lib/company-directory/service.ts:listCustomerDirectory` returns `c.id AS customer_id` as the roster `id`; this is the customer Record ID, **not** `organizations.id`. It also returns `organizationId` separately.
- Query LEFT JOINs all open `customer_engagements`. `0003` defines `customers.organization_id UNIQUE` and a unique partial index allowing only one open engagement per customer (subject to later migration changes).
- `0003` indexes `organizations.normalized_legal_name` but does not make it unique. `corporate-identity/operations.ts:createOrganization` checks authoritative identifier collisions, not identical-name candidates.
- Thus the screenshot is consistent with two distinct customers and possibly two organizations, but is **not proof** until the live rows and effective constraints are inspected. Do not merge or archive based on the screenshot alone.

## Read-only investigation SQL (run only after approved DB read access)
```sql
SELECT c.id AS customer_record_id, c.organization_id, o.legal_name,
       o.normalized_legal_name, o.country_code, o.region_code, o.status,
       count(e.id) FILTER (WHERE e.ended_at IS NULL) AS open_engagement_count
FROM public.customers c
JOIN public.organizations o ON o.id = c.organization_id
LEFT JOIN public.customer_engagements e ON e.customer_id = c.id
WHERE c.id IN (
  '203434cf-2754-41ed-89f6-59d7bdc1f1f3'::uuid,
  '5d54ed42-ba6e-49a2-8047-bdb51e8fdefb'::uuid
)
GROUP BY c.id, c.organization_id, o.legal_name, o.normalized_legal_name,
         o.country_code, o.region_code, o.status
ORDER BY c.id;
```

After confirming organization IDs, inspect organization_identifiers, aliases, addresses, engagements, contracts, evidence links, vehicles, drivers, filings and Master Register references for both identities. Run under an authorized read-only context with appropriate RLS; absence of rows without permission is not proof of absence.

## Required prevention behavior
1. During company creation, normalize legal name and search existing active, archived and merged organization candidates, including DBA aliases; compare country/region, authoritative identifiers and available contact/address context.
2. For a strong or unresolved candidate, stop creation and show a potential duplicate review with existing Record ID, status and navigable profile to authorized staff. Offer use existing organization and establish/reopen the customer relationship instead of creating another organization.
3. Identical names alone do not prove identical legal entities; authorized reviewer may proceed only after documented distinct-entity evidence and an audited override. Same authoritative identifier in same namespace is a hard collision.
4. Make the duplicate gate concurrency-safe in the transaction, with a deterministic lock keyed to normalized name and jurisdiction; an application-only preflight search is insufficient.
5. Reuse existing customer identity if the organization already has a customer relationship. Never generate a second customer identity for the same organization.
6. Before any existing duplicate reconciliation, produce a dependency and historical-record impact report. Preserve both IDs in immutable history; only use an audited merge/redirect after verifying domain references and no data loss.
7. Regression tests: exact duplicate, case/whitespace/punctuation variation, DBA match, concurrent requests, archived/merged candidates, same name distinct legal entities, existing organization to customer promotion, and no leaked cross-tenant details.

No SQL executed, no production records changed, and no duplicate-prevention runtime code implemented by this report.
