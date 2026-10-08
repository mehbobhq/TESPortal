#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"

psql \
  --no-password \
  --set=ON_ERROR_STOP=1 <<'SQL'
BEGIN;

CREATE TEMP TABLE tes_authz_test_ids (
  key text PRIMARY KEY,
  id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO public.organizations (legal_name, normalized_legal_name, status)
VALUES
  ('TES Authorization Verification Customer A', 'tes authorization verification customer a', 'active'),
  ('TES Authorization Verification Customer B', 'tes authorization verification customer b', 'active')
RETURNING id;

WITH created AS (
  SELECT id, row_number() OVER (ORDER BY id) AS rn
  FROM public.organizations
  WHERE legal_name IN (
    'TES Authorization Verification Customer A',
    'TES Authorization Verification Customer B'
  )
    AND normalized_legal_name IN (
      'tes authorization verification customer a',
      'tes authorization verification customer b'
    )
)
INSERT INTO tes_authz_test_ids (key, id)
SELECT CASE rn WHEN 1 THEN 'org_a' ELSE 'org_b' END, id
FROM created;

INSERT INTO public.customers (organization_id)
SELECT id FROM tes_authz_test_ids WHERE key IN ('org_a','org_b')
RETURNING id, organization_id;

INSERT INTO tes_authz_test_ids (key, id)
SELECT CASE o.key WHEN 'org_a' THEN 'customer_a' ELSE 'customer_b' END, c.id
FROM public.customers c
JOIN tes_authz_test_ids o ON o.id = c.organization_id
WHERE o.key IN ('org_a','org_b');

INSERT INTO public.actors (actor_type, status)
VALUES ('HUMAN', 'active')
RETURNING id \gset test_actor_

INSERT INTO tes_authz_test_ids (key, id) VALUES ('actor', :'test_actor_id');

INSERT INTO public.actor_relationships (actor_id, relationship_type, status)
VALUES (:'test_actor_id', 'TES_STAFF', 'active')
RETURNING id \gset relationship_

INSERT INTO tes_authz_test_ids (key, id) VALUES ('relationship', :'relationship_id');

INSERT INTO public.relationship_assignments (
  relationship_id, scope_type, customer_id, status
)
SELECT :'relationship_id', 'CUSTOMER', id, 'active'
FROM tes_authz_test_ids WHERE key = 'customer_a'
RETURNING id \gset assignment_

INSERT INTO tes_authz_test_ids (key, id) VALUES ('assignment', :'assignment_id');

INSERT INTO public.capabilities (code, display_name, is_active)
VALUES ('TES_AUTHZ_VERIFICATION', 'TES Authorization Verification', true)
RETURNING id \gset capability_

INSERT INTO tes_authz_test_ids (key, id) VALUES ('capability', :'capability_id');

INSERT INTO public.relationship_capability_grants (
  relationship_id, capability_id, assignment_id, status
)
VALUES (:'relationship_id', :'capability_id', :'assignment_id', 'active')
RETURNING id \gset grant_

-- Valid customer + capability must allow.
SELECT EXISTS (
  SELECT 1
  FROM public.actor_relationships ar
  JOIN public.relationship_assignments ra
    ON ra.relationship_id = ar.id
   AND ra.status = 'active'
   AND ra.scope_type = 'CUSTOMER'
   AND ra.customer_id = (SELECT id FROM tes_authz_test_ids WHERE key = 'customer_a')
  JOIN public.relationship_capability_grants rcg
    ON rcg.relationship_id = ar.id
   AND rcg.status = 'active'
   AND (rcg.assignment_id IS NULL OR rcg.assignment_id = ra.id)
  JOIN public.capabilities c
    ON c.id = rcg.capability_id
   AND c.is_active = true
   AND c.code = 'TES_AUTHZ_VERIFICATION'
  WHERE ar.actor_id = :'test_actor_id'
    AND ar.status = 'active'
) AS valid_allow \gset

\if :valid_allow
\else
  \echo 'ERROR: valid relationship/scope/capability did not authorize.'
  \quit 3
\endif

-- Wrong customer must deny.
SELECT NOT EXISTS (
  SELECT 1
  FROM public.actor_relationships ar
  JOIN public.relationship_assignments ra
    ON ra.relationship_id = ar.id
   AND ra.status = 'active'
   AND ra.scope_type = 'CUSTOMER'
   AND ra.customer_id = (SELECT id FROM tes_authz_test_ids WHERE key = 'customer_b')
  JOIN public.relationship_capability_grants rcg
    ON rcg.relationship_id = ar.id
   AND rcg.status = 'active'
   AND (rcg.assignment_id IS NULL OR rcg.assignment_id = ra.id)
  JOIN public.capabilities c
    ON c.id = rcg.capability_id
   AND c.is_active = true
   AND c.code = 'TES_AUTHZ_VERIFICATION'
  WHERE ar.actor_id = :'test_actor_id'
    AND ar.status = 'active'
) AS wrong_customer_denied \gset

\if :wrong_customer_denied
\else
  \echo 'ERROR: wrong customer was authorized.'
  \quit 3
\endif

-- Missing capability must deny.
SELECT NOT EXISTS (
  SELECT 1
  FROM public.actor_relationships ar
  JOIN public.relationship_assignments ra
    ON ra.relationship_id = ar.id
   AND ra.status = 'active'
   AND ra.scope_type = 'CUSTOMER'
   AND ra.customer_id = (SELECT id FROM tes_authz_test_ids WHERE key = 'customer_a')
  JOIN public.relationship_capability_grants rcg
    ON rcg.relationship_id = ar.id
   AND rcg.status = 'active'
   AND (rcg.assignment_id IS NULL OR rcg.assignment_id = ra.id)
  JOIN public.capabilities c
    ON c.id = rcg.capability_id
   AND c.is_active = true
   AND c.code = 'TES_AUTHZ_MISSING'
  WHERE ar.actor_id = :'test_actor_id'
    AND ar.status = 'active'
) AS missing_capability_denied \gset

\if :missing_capability_denied
\else
  \echo 'ERROR: missing capability was authorized.'
  \quit 3
\endif

-- Suspended relationship must deny.
UPDATE public.actor_relationships SET status = 'suspended' WHERE id = :'relationship_id';
SELECT NOT EXISTS (
  SELECT 1
  FROM public.actor_relationships ar
  JOIN public.relationship_assignments ra ON ra.relationship_id = ar.id AND ra.status = 'active'
  JOIN public.relationship_capability_grants rcg
    ON rcg.relationship_id = ar.id AND rcg.status = 'active'
   AND (rcg.assignment_id IS NULL OR rcg.assignment_id = ra.id)
  JOIN public.capabilities c
    ON c.id = rcg.capability_id AND c.is_active = true AND c.code = 'TES_AUTHZ_VERIFICATION'
  WHERE ar.actor_id = :'test_actor_id'
    AND ar.status = 'active'
    AND ra.scope_type = 'CUSTOMER'
    AND ra.customer_id = (SELECT id FROM tes_authz_test_ids WHERE key = 'customer_a')
) AS suspended_relationship_denied \gset
UPDATE public.actor_relationships SET status = 'active' WHERE id = :'relationship_id';

\if :suspended_relationship_denied
\else
  \echo 'ERROR: suspended relationship was authorized.'
  \quit 3
\endif

-- Suspended assignment must deny.
UPDATE public.relationship_assignments SET status = 'suspended' WHERE id = :'assignment_id';
SELECT NOT EXISTS (
  SELECT 1
  FROM public.actor_relationships ar
  JOIN public.relationship_assignments ra ON ra.relationship_id = ar.id AND ra.status = 'active'
  JOIN public.relationship_capability_grants rcg
    ON rcg.relationship_id = ar.id AND rcg.status = 'active'
   AND (rcg.assignment_id IS NULL OR rcg.assignment_id = ra.id)
  JOIN public.capabilities c
    ON c.id = rcg.capability_id AND c.is_active = true AND c.code = 'TES_AUTHZ_VERIFICATION'
  WHERE ar.actor_id = :'test_actor_id'
    AND ar.status = 'active'
    AND ra.scope_type = 'CUSTOMER'
    AND ra.customer_id = (SELECT id FROM tes_authz_test_ids WHERE key = 'customer_a')
) AS suspended_assignment_denied \gset
UPDATE public.relationship_assignments SET status = 'active' WHERE id = :'assignment_id';

\if :suspended_assignment_denied
\else
  \echo 'ERROR: suspended assignment was authorized.'
  \quit 3
\endif

-- Suspended grant must deny.
UPDATE public.relationship_capability_grants SET status = 'suspended' WHERE id = :'grant_id';
SELECT NOT EXISTS (
  SELECT 1
  FROM public.actor_relationships ar
  JOIN public.relationship_assignments ra ON ra.relationship_id = ar.id AND ra.status = 'active'
  JOIN public.relationship_capability_grants rcg
    ON rcg.relationship_id = ar.id AND rcg.status = 'active'
   AND (rcg.assignment_id IS NULL OR rcg.assignment_id = ra.id)
  JOIN public.capabilities c
    ON c.id = rcg.capability_id AND c.is_active = true AND c.code = 'TES_AUTHZ_VERIFICATION'
  WHERE ar.actor_id = :'test_actor_id'
    AND ar.status = 'active'
    AND ra.scope_type = 'CUSTOMER'
    AND ra.customer_id = (SELECT id FROM tes_authz_test_ids WHERE key = 'customer_a')
) AS suspended_grant_denied \gset
UPDATE public.relationship_capability_grants SET status = 'active' WHERE id = :'grant_id';

\if :suspended_grant_denied
\else
  \echo 'ERROR: suspended grant was authorized.'
  \quit 3
\endif

-- Cross-relationship assignment must not be borrowable.
INSERT INTO public.actors (actor_type, status)
VALUES ('HUMAN', 'active')
RETURNING id \gset other_actor_

INSERT INTO public.actor_relationships (actor_id, relationship_type, status)
VALUES (:'other_actor_id', 'TES_STAFF', 'active')
RETURNING id \gset other_relationship_

INSERT INTO public.relationship_assignments (
  relationship_id, scope_type, customer_id, status
)
SELECT :'other_relationship_id', 'CUSTOMER', id, 'active'
FROM tes_authz_test_ids WHERE key = 'customer_a'
RETURNING id \gset other_assignment_

UPDATE public.relationship_capability_grants
SET assignment_id = :'other_assignment_id'
WHERE id = :'grant_id';

SELECT NOT EXISTS (
  SELECT 1
  FROM public.actor_relationships ar
  JOIN public.relationship_assignments ra
    ON ra.relationship_id = ar.id
   AND ra.status = 'active'
   AND ra.scope_type = 'CUSTOMER'
   AND ra.customer_id = (SELECT id FROM tes_authz_test_ids WHERE key = 'customer_a')
  JOIN public.relationship_capability_grants rcg
    ON rcg.relationship_id = ar.id
   AND rcg.status = 'active'
   AND (rcg.assignment_id IS NULL OR rcg.assignment_id = ra.id)
  JOIN public.capabilities c
    ON c.id = rcg.capability_id
   AND c.is_active = true
   AND c.code = 'TES_AUTHZ_VERIFICATION'
  WHERE ar.actor_id = :'test_actor_id'
    AND ar.status = 'active'
) AS cross_relationship_assignment_denied \gset

\if :cross_relationship_assignment_denied
\else
  \echo 'ERROR: grant borrowed an assignment from another relationship.'
  \quit 3
\endif

\echo 'TES authorization verification matrix passed.'
ROLLBACK;
SQL
