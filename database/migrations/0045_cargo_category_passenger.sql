-- 0045: Cargo Information catalogue - Passenger.
--
-- Adds one active catalogue value, PASSENGER, to public.cargo_categories so the Company/Profile Cargo Information can record that a company carries
-- passengers. Driver onboarding reads it (together with Hazardous Materials) from company_cargo_category_periods; it is the single source of truth.
-- Additive and idempotent: no existing category, company record, period, constraint, policy or grant changes. Existing cargo records keep their meaning.

INSERT INTO public.cargo_categories (code, display_name, sort_order)
VALUES ('PASSENGER', 'Passenger', 70)
ON CONFLICT (code) DO NOTHING;
