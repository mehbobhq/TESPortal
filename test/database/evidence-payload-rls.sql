\set ON_ERROR_STOP on
-- Row level security matrix for migration 0032 (evidence payload lifecycle). Runs as the RUNTIME role; all rows roll back.
BEGIN;

INSERT INTO public.organizations(legal_name,normalized_legal_name,status) VALUES ('Payload RLS A','payload rls a','active') RETURNING id \gset oa_
INSERT INTO public.organizations(legal_name,normalized_legal_name,status) VALUES ('Payload RLS B','payload rls b','active') RETURNING id \gset ob_
INSERT INTO public.customers(organization_id) VALUES (:'oa_id') RETURNING id \gset ca_

INSERT INTO public.actors(actor_type,status) VALUES ('HUMAN','active') RETURNING id \gset actor_
INSERT INTO public.actor_relationships(actor_id,relationship_type,status) VALUES (:'actor_id','TES_STAFF','active') RETURNING id \gset rel_
INSERT INTO public.relationship_assignments(relationship_id,scope_type,status) VALUES (:'rel_id','SYSTEM','active') RETURNING id \gset sra_
INSERT INTO public.relationship_assignments(relationship_id,scope_type,customer_id,status) VALUES (:'rel_id','CUSTOMER',:'ca_id','active') RETURNING id \gset cra_
INSERT INTO public.relationship_capability_grants(relationship_id,capability_id,assignment_id,status)
SELECT :'rel_id',id,:'sra_id','active' FROM public.capabilities WHERE code IN ('EVIDENCE_READ','EVIDENCE_MANAGE','VEHICLE_READ');
INSERT INTO public.relationship_capability_grants(relationship_id,capability_id,assignment_id,status)
SELECT :'rel_id',id,:'cra_id','active' FROM public.capabilities WHERE code = 'ORGANIZATION_READ';

-- Owner-side fixture: a stored payload for tenant A (valid transitions only).
SELECT gen_random_uuid() AS doc, gen_random_uuid() AS batch, gen_random_uuid() AS src \gset
INSERT INTO public.evidence_documents(id,organization_id,document_type,document_title,gcs_bucket,gcs_object_name,sha256,mime_type,byte_size,source_channel)
VALUES (:'doc',:'oa_id','OTHER_EVIDENCE','rls fixture','rls-quarantine','quarantine/'||:'oa_id'||'/'||:'batch'||'/'||:'src'||'/source',repeat('a',64),'application/pdf',10,'staff_upload');
INSERT INTO public.evidence_payloads(evidence_document_id,organization_id,batch_id,source_file_id,quarantine_bucket,quarantine_object_name,declared_sha256,mime_type,byte_size,original_filename,uploaded_by_actor_id)
VALUES (:'doc',:'oa_id',:'batch',:'src','rls-quarantine','quarantine/'||:'oa_id'||'/'||:'batch'||'/'||:'src'||'/source',repeat('a',64),'application/pdf',10,'f.pdf',:'actor_id');
UPDATE public.evidence_payloads SET lifecycle_state='cleared',intake_object_name='intake/'||:'oa_id'||'/'||:'batch'||'/'||:'src'||'/source',intake_generation='1',cleared_at=now() WHERE evidence_document_id=:'doc';
UPDATE public.evidence_payloads SET lifecycle_state='stored',evidence_bucket='rls-evidence',evidence_object_name='evidence/'||:'oa_id'||'/'||:'doc'||'/source',evidence_generation='2',verified_sha256=declared_sha256,stored_at=now() WHERE evidence_document_id=:'doc';
INSERT INTO public.master_register_events(event_id,event_type,event_family,schema_version,catalogue_version,actor_type,actor_id,occurred_at,recorded_at,source)
VALUES (gen_random_uuid(),'DOCUMENT_VIEWED','ACCESS',1,1,'HUMAN',:'actor_id',now(),now(),'{"sourceType":"TEST"}'::jsonb) RETURNING event_id \gset ev_

SET LOCAL ROLE "tes-backend@tes-production-510007.iam";

-- No context: nothing is visible.
SELECT (SELECT count(*) FROM public.evidence_payloads) = 0 AND (SELECT count(*) FROM public.evidence_payload_access_events) = 0 AS ok \gset
\if :ok
\else
  \echo 'payload data visible without context'
  SELECT 1/0;
\endif

-- A SYSTEM capability that is not EVIDENCE_* sees nothing.
SELECT set_config('tes.system_actor_id',:'actor_id',true);
SELECT set_config('tes.system_capability','VEHICLE_READ',true);
SELECT (SELECT count(*) FROM public.evidence_payloads) = 0 AS ok \gset
\if :ok
\else
  \echo 'VEHICLE_READ crossed the evidence payload boundary'
  SELECT 1/0;
\endif

-- A CUSTOMER context (even for tenant A, even with a valid assignment) never sees payload rows.
SELECT set_config('tes.system_actor_id','',true);
SELECT set_config('tes.system_capability','',true);
SELECT set_config('tes.customer_id',:'ca_id',true);
SELECT set_config('tes.customer_actor_id',:'actor_id',true);
SELECT set_config('tes.customer_capability','ORGANIZATION_READ',true);
SELECT (SELECT count(*) FROM public.evidence_payloads) = 0 AND (SELECT count(*) FROM public.evidence_documents) = 0 AS ok \gset
\if :ok
\else
  \echo 'customer context saw evidence payload data'
  SELECT 1/0;
\endif
SELECT set_config('tes.customer_id','',true);
SELECT set_config('tes.customer_actor_id','',true);
SELECT set_config('tes.customer_capability','',true);

-- EVIDENCE_READ reads, may append an access event for a stored payload, and changes nothing else.
SELECT set_config('tes.system_actor_id',:'actor_id',true);
SELECT set_config('tes.system_capability','EVIDENCE_READ',true);
SELECT (SELECT count(*) FROM public.evidence_payloads WHERE evidence_document_id = :'doc') = 1 AS ok \gset
\if :ok
\else
  \echo 'EVIDENCE_READ cannot read payloads'
  SELECT 1/0;
\endif
INSERT INTO public.evidence_payload_access_events(payload_id,evidence_document_id,organization_id,actor_id,master_register_event_id)
SELECT id, evidence_document_id, organization_id, :'actor_id', :'ev_event_id' FROM public.evidence_payloads WHERE evidence_document_id = :'doc';

DO $$
BEGIN
  BEGIN
    UPDATE public.evidence_payloads SET lifecycle_state = 'archived';
    IF FOUND THEN RAISE EXCEPTION 'EVIDENCE_READ updated a payload'; END IF;
  END;
  BEGIN
    INSERT INTO public.evidence_payloads(evidence_document_id,organization_id,batch_id,source_file_id,quarantine_bucket,quarantine_object_name,declared_sha256,mime_type,byte_size,original_filename,uploaded_by_actor_id)
    SELECT evidence_document_id,organization_id,gen_random_uuid(),gen_random_uuid(),'rls-quarantine','x',declared_sha256,mime_type,byte_size,'f.pdf',uploaded_by_actor_id FROM public.evidence_payloads LIMIT 1;
    RAISE EXCEPTION 'EVIDENCE_READ inserted a payload';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
END
$$;

-- The runtime role can never delete or truncate, and the access ledger and payload identity are never updatable by it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidence_payloads','evidence_payload_access_events'] LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I', t);
      RAISE EXCEPTION 'DELETE succeeded on %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('TRUNCATE public.%I', t);
      RAISE EXCEPTION 'TRUNCATE succeeded on %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  BEGIN
    UPDATE public.evidence_payload_access_events SET access_kind = access_kind;
    RAISE EXCEPTION 'UPDATE succeeded on the append-only access ledger';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;

-- EVIDENCE_MANAGE may archive (forward transition) but the database refuses a backward one.
SELECT set_config('tes.system_capability','EVIDENCE_MANAGE',true);
DO $$
BEGIN
  BEGIN
    UPDATE public.evidence_payloads SET lifecycle_state = 'cleared';
    RAISE EXCEPTION 'a stored payload moved backwards';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END
$$;
UPDATE public.evidence_payloads SET lifecycle_state = 'archived' WHERE evidence_document_id = :'doc';
SELECT (SELECT lifecycle_state FROM public.evidence_payloads WHERE evidence_document_id = :'doc') = 'archived' AS ok \gset
\if :ok
\else
  \echo 'EVIDENCE_MANAGE could not archive'
  SELECT 1/0;
\endif

RESET ROLE;
ROLLBACK;
\echo 'Evidence payload lifecycle RLS matrix passed.'
