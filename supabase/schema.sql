-- =============================================================
-- ARISE Candidate Registration & Certificate Portal
-- Hardened Supabase schema: table, RLS, storage, RPC functions
-- Run this whole file in the Supabase SQL Editor.
-- Re-running is safe: it upgrades an existing install in place.
-- =============================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- 1. Candidates table
-- -------------------------------------------------------------
create table if not exists public.candidates (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text        not null,
  email               text        unique,                       -- optional; unique when present
  registration_number text        not null unique,
  exam_year           int         not null,                    -- derived from the year of registration
  passport_url        text,                                    -- null until attached (bulk-imported rows start without one)
  -- New Student Registration fields --------------------------------
  phone               text,
  state_of_origin     text,
  lga                 text,
  date_of_birth       date,
  occupation          text        not null,
  religion            text        not null,
  last_institution    text,
  marital_status      text,
  next_of_kin_name    text,
  next_of_kin_phone   text,
  gender              text,
  course              text,
  class_schedule      text,
  address             text,
  -----------------------------------------------------------------
  certificate_url     text,                                   -- null until admin issues it
  is_verified         boolean     not null default false,     -- true once certificate issued
  issue_date          date,                                   -- set when certificate issued
  created_at          timestamptz not null default now()
);

-- Upgrade older installs that predate the New Student Registration fields.
alter table public.candidates alter column email drop not null;
-- Bulk CSV imports create rows WITHOUT a passport (attached later by an
-- admin), so the column is nullable. Public register_candidate and manual
-- admin_add_candidate still REQUIRE a valid passport — only the import path
-- allows null.
alter table public.candidates alter column passport_url drop not null;
alter table public.candidates add column if not exists phone             text;
alter table public.candidates add column if not exists state_of_origin   text;
alter table public.candidates add column if not exists lga               text;
alter table public.candidates add column if not exists date_of_birth     date;
alter table public.candidates add column if not exists occupation        text;
alter table public.candidates add column if not exists religion          text;
alter table public.candidates add column if not exists last_institution  text;
alter table public.candidates add column if not exists marital_status    text;
alter table public.candidates add column if not exists next_of_kin_name  text;
alter table public.candidates add column if not exists next_of_kin_phone text;
alter table public.candidates add column if not exists gender            text;
alter table public.candidates add column if not exists course            text;
alter table public.candidates add column if not exists class_schedule    text;
alter table public.candidates add column if not exists address           text;

-- Occupation & religion are required. Backfill any legacy rows first so the
-- NOT NULL constraint applies cleanly on existing installs (re-run safe).
update public.candidates set occupation = 'Unknown' where occupation is null;
update public.candidates set religion   = 'Other'   where religion   is null;
alter table public.candidates alter column occupation set not null;
alter table public.candidates alter column religion   set not null;

-- Case-insensitive email lookups + fast reg-number lookups
create unique index if not exists candidates_email_lower_idx
  on public.candidates (lower(email));
create index if not exists candidates_reg_idx
  on public.candidates (registration_number);

-- -------------------------------------------------------------
-- 2. Auto-generated registration numbers: ARISE/{year}/{seq}
--    A per-year counter table keeps sequences dense & unique.
-- -------------------------------------------------------------
create table if not exists public.reg_counters (
  exam_year int primary key,
  last_seq  int not null default 0
);

create or replace function public.next_registration_number(p_year int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
begin
  insert into public.reg_counters (exam_year, last_seq)
    values (p_year, 1)
  on conflict (exam_year)
    do update set last_seq = public.reg_counters.last_seq + 1
  returning last_seq into v_seq;

  return 'ARISE/ICT/' || p_year::text || '/' || lpad(v_seq::text, 4, '0');
end;
$$;

-- -------------------------------------------------------------
-- 2b. Rate limiting
--     A tiny fixed-window counter table + helper. Every public and
--     privileged entry point calls rate_limit_try() with a key and
--     limit; it returns true while the key stays within its window.
--     Deny-by-default: RLS is on and only SECURITY DEFINER functions
--     (and the service-role Edge Functions) may touch it.
-- -------------------------------------------------------------
create table if not exists public.rate_limits (
  key            text primary key,
  window_start   timestamptz not null default now(),
  attempt_count  int not null default 0
);
alter table public.rate_limits enable row level security;
-- (No policies — deny by default.)

-- Consume one slot for `p_key`; returns true if the count is still
-- within `p_limit` over the rolling `p_window_seconds`. Stale rows can
-- be purged with: delete from public.rate_limits where window_start < now() - interval '7 days';
create or replace function public.rate_limit_try(
  p_key             text,
  p_limit           int,
  p_window_seconds  int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff    timestamptz := now() - (p_window_seconds * interval '1 second');
  v_new_count int;
begin
  insert into public.rate_limits as r (key, window_start, attempt_count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    attempt_count = case
      when r.window_start < v_cutoff then 1
      else r.attempt_count + 1
    end,
    window_start = case
      when r.window_start < v_cutoff then now()
      else r.window_start
    end
  returning r.attempt_count into v_new_count;

  return v_new_count <= p_limit;
end;
$$;

-- -------------------------------------------------------------
-- 3. Registration RPC — the ONLY public write path.
--    Runs as definer so anon can insert without a broad
--    table-level INSERT grant. Validates + assigns reg number.
--    The registration year is derived server-side (never trusted
--    from the client), so the form no longer collects it.
-- -------------------------------------------------------------
-- Drop the previous 4-argument signature if this DB was created
-- by an earlier version of this file.
drop function if exists public.register_candidate(text, text, int, text);
-- Drop the 15-argument signature (pre occupation/religion) too.
drop function if exists public.register_candidate(
  text, text, text, text, text, date, text, text,
  text, text, text, text, text, text, text
);

create or replace function public.register_candidate(
  p_full_name         text,
  p_email             text,
  p_phone             text,
  p_state_of_origin   text,
  p_lga               text,
  p_date_of_birth     date,
  p_occupation        text,
  p_religion          text,
  p_last_institution  text,
  p_marital_status    text,
  p_next_of_kin_name  text,
  p_next_of_kin_phone text,
  p_gender            text,
  p_course            text,
  p_class_schedule    text,
  p_address           text,
  p_passport_url      text
)
returns table (registration_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg        text;
  v_year       int  := extract(year from now())::int;
  v_name       text := btrim(p_full_name);
  v_email      text := nullif(lower(btrim(p_email)), '');
  v_phone      text := btrim(p_phone);
  v_occupation text := nullif(btrim(p_occupation), '');
  v_religion   text := nullif(btrim(p_religion), '');
begin
  -- Rate limit: at most 10 registrations per hour per phone number.
  if not public.rate_limit_try('register:' || v_phone, 10, 3600) then
    raise exception 'RATE_LIMITED';
  end if;

  -- Basic server-side validation (never trust the client)
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'INVALID_NAME';
  end if;
  -- Email is optional; only validate + dedupe when one is supplied.
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  if v_phone is null or char_length(regexp_replace(v_phone, '\D', '', 'g')) < 7 then
    raise exception 'INVALID_PHONE';
  end if;
  if v_occupation is null then
    raise exception 'INVALID_OCCUPATION';
  end if;
  if v_religion is null then
    raise exception 'INVALID_RELIGION';
  end if;
  -- The passport reference must be an object path produced by the
  -- upload-passport Edge Function (a UUID + image extension), not an
  -- arbitrary URL supplied by the client.
  if p_passport_url is null
     or p_passport_url !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png)$' then
    raise exception 'INVALID_PASSPORT';
  end if;

  if v_email is not null
     and exists (select 1 from public.candidates where lower(email) = v_email) then
    raise exception 'EMAIL_EXISTS';
  end if;

  v_reg := public.next_registration_number(v_year);

  insert into public.candidates (
    full_name, email, registration_number, exam_year, passport_url,
    phone, state_of_origin, lga, date_of_birth, occupation, religion,
    last_institution, marital_status, next_of_kin_name, next_of_kin_phone,
    gender, course, class_schedule, address
  )
  values (
    v_name, v_email, v_reg, v_year, p_passport_url,
    v_phone, nullif(btrim(p_state_of_origin), ''), nullif(btrim(p_lga), ''),
    p_date_of_birth, v_occupation, v_religion,
    nullif(btrim(p_last_institution), ''),
    nullif(btrim(p_marital_status), ''), nullif(btrim(p_next_of_kin_name), ''),
    nullif(btrim(p_next_of_kin_phone), ''), nullif(btrim(p_gender), ''),
    nullif(btrim(p_course), ''), nullif(btrim(p_class_schedule), ''),
    nullif(btrim(p_address), '')
  );

  return query select v_reg;
end;
$$;

-- -------------------------------------------------------------
-- 4. Verification RPC — the ONLY public read path.
--    Requires BOTH registration number AND phone to match.
--    Returns a single profile row or nothing. No broad SELECT.
--    Phone is compared on digits only, so formatting differences
--    (spaces, dashes, +234 vs 0…) don't block a legitimate match.
-- -------------------------------------------------------------
-- Return shape changed from the old email-based version, so drop first.
drop function if exists public.verify_candidate(text, text);

create or replace function public.verify_candidate(
  p_reg   text,
  p_phone text
)
returns table (
  full_name           text,
  registration_number text,
  passport_url        text,
  marital_status      text,
  state_of_origin     text,
  course              text,
  age                 int,
  is_verified         boolean,
  issue_date          date,
  has_certificate     boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Rate limit per registration number: 30 lookups / 5 minutes.
  if not public.rate_limit_try('verify:' || btrim(p_reg), 30, 300) then
    raise exception 'RATE_LIMITED';
  end if;

  return query
  select
    c.full_name,
    c.registration_number,
    c.passport_url,
    c.marital_status,
    c.state_of_origin,
    c.course,
    case
      when c.date_of_birth is not null
      then extract(year from age(c.date_of_birth))::int
      else null
    end as age,
    c.is_verified,
    c.issue_date,
    (c.certificate_url is not null) as has_certificate
  from public.candidates c
  where c.registration_number = btrim(p_reg)
    and c.phone is not null
    and regexp_replace(c.phone, '\D', '', 'g')
        = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
  limit 1;
end;
$$;

-- -------------------------------------------------------------
-- 5. Row Level Security
--    RLS ON, and NO anon policies for select/insert/update.
--    The public paths above are SECURITY DEFINER functions,
--    so the anon role never touches the table directly.
--    The service-role key (admin server) bypasses RLS.
-- -------------------------------------------------------------
alter table public.candidates enable row level security;
alter table public.reg_counters enable row level security;
-- (No permissive policies added on purpose — deny by default.)

-- The `certificate` and `passport` Edge Functions connect with the
-- SERVICE-ROLE key, which bypasses RLS but STILL needs a table-level
-- SELECT grant — without it the function's candidate lookup fails with
-- "permission denied for table candidates" (SQLSTATE 42501). Safe:
-- service_role is server-only (it lives as an Edge Function secret and
-- never reaches the browser).
grant select on public.candidates to service_role;

-- Let the anon & authenticated roles EXECUTE the vetted RPCs only.
grant execute on function public.register_candidate(
  text, text, text, text, text, date, text, text, text, text,
  text, text, text, text, text, text, text
) to anon, authenticated;
grant execute on function public.verify_candidate(text, text) to anon, authenticated;
-- next_registration_number is internal; do not grant to anon.
revoke execute on function public.next_registration_number(int) from public;
-- rate_limit_try is internal: called by definer functions (owner rights)
-- and by the service-role Edge Functions. Never exposed to browser roles.
grant execute on function public.rate_limit_try(text, int, int) to service_role;

-- =============================================================
-- 6. Storage buckets
--    Run in SQL editor OR create via Dashboard → Storage.
-- =============================================================
insert into storage.buckets (id, name, public)
values ('passports', 'passports', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('certificates', 'certificates', false)
on conflict (id) do nothing;

-- Passports are PRIVATE. Photos upload through the `upload-passport`
-- Edge Function (service role, validated server-side for magic bytes +
-- size), and are served to students as short-lived signed URLs from the
-- `passport` Edge Function after a successful two-factor lookup.
-- Allowlisted admins may read/manage files (e.g. the admin console).
update storage.buckets set public = false where id = 'passports';

drop policy if exists "passports public read" on storage.objects;
drop policy if exists "passports anon upload" on storage.objects;

drop policy if exists "admins read passports" on storage.objects;
create policy "admins read passports"
  on storage.objects for select to authenticated
  using ( bucket_id = 'passports' and public.is_admin() );

drop policy if exists "admins upload passports" on storage.objects;
create policy "admins upload passports"
  on storage.objects for insert to authenticated
  with check ( bucket_id = 'passports' and public.is_admin() );

drop policy if exists "admins update passports" on storage.objects;
create policy "admins update passports"
  on storage.objects for update to authenticated
  using ( bucket_id = 'passports' and public.is_admin() )
  with check ( bucket_id = 'passports' and public.is_admin() );

drop policy if exists "admins delete passports" on storage.objects;
create policy "admins delete passports"
  on storage.objects for delete to authenticated
  using ( bucket_id = 'passports' and public.is_admin() );

-- Certificates: PRIVATE. No anon policies at all.
-- Only the service-role key (admin server) reads/writes here,
-- and downloads are handed out as short-lived signed URLs.

-- =============================================================
-- 7. Admin portal — allowlist, gate, RLS, storage & RPCs
--    Admins sign in with Supabase Auth (email + password + MFA).
--    The DATABASE enforces who is an admin, so it can't be
--    bypassed from the browser. No service-role key is used
--    anywhere on the client — only the anon key + a logged-in
--    admin session, gated by the policies below.
-- =============================================================

-- 7a. The admin allowlist. RLS is ON with NO policies, so nobody
--     can read it directly — only the SECURITY DEFINER is_admin()
--     below sees it. Add an admin by inserting their (lowercased)
--     email AFTER you create their user in Auth → Users.
create table if not exists public.admin_emails (
  email      text primary key,
  admin_role text not null default 'super-admin'
                check (admin_role in ('super-admin', 'admin')),
  created_at timestamptz not null default now()
);
-- Existing deployments predate the role column; add it idempotently.
-- Default 'super-admin' preserves every current admin's full access.
alter table public.admin_emails
  add column if not exists admin_role text not null default 'super-admin'
    check (admin_role in ('super-admin', 'admin'));
alter table public.admin_emails enable row level security;
-- (No policies — deny by default.)

-- >>> EDIT ME: add each admin's email (lowercase). Re-run safe. <<<
-- Super-admin (full access incl. Security Monitor + admin management):
--   insert into public.admin_emails (email, admin_role)
--   values ('you@example.com', 'super-admin')
--   on conflict (email) do nothing;
-- Plain admin (students / stories / certificates only):
--   insert into public.admin_emails (email, admin_role)
--   values ('staff@example.com', 'admin')
--   on conflict (email) do nothing;

-- 7b. Is the current caller an allowlisted admin?
--     SECURITY DEFINER so it can read admin_emails past RLS.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admin_emails
    where email = lower(coalesce(auth.email(), ''))
  );
$$;
grant execute on function public.is_admin() to authenticated;

-- 7b2. Is the current caller a SUPER-admin (role = 'super-admin')?
--      Coarse is_admin() above still gates the whole portal; this stricter
--      check gates ONLY the sensitive surfaces: the Security Monitor, the
--      audit log and admin management. Plain 'admin' members stay full
--      operational users but are denied here.
create or replace function public.is_admin_role()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admin_emails
    where email = lower(coalesce(auth.email(), ''))
      and admin_role = 'super-admin'
  );
$$;
grant execute on function public.is_admin_role() to authenticated;

-- 7c. Let allowlisted admins READ the candidates table (for the
--     admin list/search). Anon still can't — this policy is scoped
--     to authenticated admins only. Writes stay funneled through the
--     vetted definer RPCs below (no table-level write policy).
drop policy if exists "admins read candidates" on public.candidates;
create policy "admins read candidates"
  on public.candidates for select
  to authenticated
  using ( public.is_admin() );

-- RLS filters WHICH rows an admin sees, but Postgres still needs a
-- table-level SELECT grant for the authenticated role to run SELECT at
-- all — without it the query fails with "permission denied for table
-- candidates" before RLS is even evaluated. Safe: the policy above still
-- restricts reads to allowlisted admins, and anon is never granted.
grant select on public.candidates to authenticated;

-- 7d. Certificate bucket policies — allowlisted admins may manage
--     files in the PRIVATE certificates bucket. Anon still has none;
--     students never read here directly (they get signed URLs from
--     the Edge Function).
drop policy if exists "admins read certificates" on storage.objects;
create policy "admins read certificates"
  on storage.objects for select to authenticated
  using ( bucket_id = 'certificates' and public.is_admin() );

drop policy if exists "admins upload certificates" on storage.objects;
create policy "admins upload certificates"
  on storage.objects for insert to authenticated
  with check ( bucket_id = 'certificates' and public.is_admin() );

drop policy if exists "admins update certificates" on storage.objects;
create policy "admins update certificates"
  on storage.objects for update to authenticated
  using ( bucket_id = 'certificates' and public.is_admin() )
  with check ( bucket_id = 'certificates' and public.is_admin() );

drop policy if exists "admins delete certificates" on storage.objects;
create policy "admins delete certificates"
  on storage.objects for delete to authenticated
  using ( bucket_id = 'certificates' and public.is_admin() );

-- 7e. Issue a certificate. Admin-only. Refuses to mark a candidate
--     "issued" unless the PDF is actually present at {id}.pdf, so a
--     failed upload can never flip the status. Sets is_verified so
--     the student's profile shows Graduated + the download unlocks.
--     (File existence is proven by the upload-certificate Edge Function,
--     which writes to external S3 storage before this RPC is called.)
--     Also records the action in the audit log (§9).
create or replace function public.admin_issue_certificate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  update public.candidates
     set certificate_url = p_id::text || '.pdf',
         is_verified     = true,
         issue_date      = current_date
   where id = p_id;

  if not found then
    raise exception 'NO_CANDIDATE';
  end if;

  insert into public.admin_audit_log (admin_email, action, candidate_id, detail)
  values (lower(coalesce(auth.email(), '')), 'issue_certificate', p_id, p_id::text || '.pdf');
end;
$$;
grant execute on function public.admin_issue_certificate(uuid) to authenticated;

-- 7f. Revoke a certificate. Admin-only. Clears the issued state so
--     the student can no longer download. (The file itself is removed
--     by the client via the storage delete policy above.)
create or replace function public.admin_revoke_certificate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  update public.candidates
     set certificate_url = null,
         is_verified     = false,
         issue_date      = null
   where id = p_id;

  if not found then
    raise exception 'NO_CANDIDATE';
  end if;

  insert into public.admin_audit_log (admin_email, action, candidate_id, detail)
  values (lower(coalesce(auth.email(), '')), 'revoke_certificate', p_id, '');
end;
$$;
grant execute on function public.admin_revoke_certificate(uuid) to authenticated;

-- 7g. Add a previously (manually / paper) registered student. Admin-only.
--     Mirrors register_candidate's server-side validation but is gated by
--     is_admin(), so the browser can create a row without any table-level
--     INSERT grant and without the service-role key. The registration number
--     is still generated server-side (never trusted from the client); an
--     optional p_exam_year lets past cohorts get the correct
--     ARISE/ICT/{year}/#### number (defaults to the current year). Returns the
--     new row's id + reg number so the portal can jump straight to uploading
--     that student's certificate.
create or replace function public.admin_add_candidate(
  p_full_name         text,
  p_email             text,
  p_phone             text,
  p_state_of_origin   text,
  p_lga               text,
  p_date_of_birth     date,
  p_occupation        text,
  p_religion          text,
  p_last_institution  text,
  p_marital_status    text,
  p_next_of_kin_name  text,
  p_next_of_kin_phone text,
  p_gender            text,
  p_course            text,
  p_class_schedule    text,
  p_address           text,
  p_passport_url      text,
  p_exam_year         int default null
)
returns table (id uuid, registration_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg        text;
  v_year       int  := coalesce(p_exam_year, extract(year from now())::int);
  v_name       text := btrim(p_full_name);
  v_email      text := nullif(lower(btrim(p_email)), '');
  v_phone      text := btrim(p_phone);
  v_occupation text := nullif(btrim(p_occupation), '');
  v_religion   text := nullif(btrim(p_religion), '');
  v_id         uuid;
begin
  -- The DB is the source of truth for who may write here.
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  -- Same server-side validation as public registration (never trust the client).
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'INVALID_NAME';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  -- Phone is required: verify_candidate keys on reg number + phone, so a row
  -- without a phone could never be verified by the student.
  if v_phone is null or char_length(regexp_replace(v_phone, '\D', '', 'g')) < 7 then
    raise exception 'INVALID_PHONE';
  end if;
  if v_occupation is null then
    raise exception 'INVALID_OCCUPATION';
  end if;
  if v_religion is null then
    raise exception 'INVALID_RELIGION';
  end if;
  -- Every field except email is required when an admin adds a student by
  -- hand. This is the admin portal's own enforcement point (the public
  -- register_candidate path is intentionally unchanged). The client's
  -- required attributes are a first layer; this rejects any row that would
  -- be written with a missing value regardless of what the client sends.
  if nullif(btrim(p_state_of_origin), '') is null
     or nullif(btrim(p_lga), '') is null
     or p_date_of_birth is null
     or nullif(btrim(p_last_institution), '') is null
     or nullif(btrim(p_marital_status), '') is null
     or nullif(btrim(p_next_of_kin_name), '') is null
     or nullif(btrim(p_next_of_kin_phone), '') is null
     or nullif(btrim(p_gender), '') is null
     or nullif(btrim(p_course), '') is null
     or nullif(btrim(p_class_schedule), '') is null
     or nullif(btrim(p_address), '') is null then
    raise exception 'MISSING_FIELD';
  end if;
  -- The passport reference must be an object path produced by the
  -- upload-passport Edge Function (a UUID + image extension), not an
  -- arbitrary URL supplied by the client.
  if p_passport_url is null
     or p_passport_url !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png)$' then
    raise exception 'INVALID_PASSPORT';
  end if;
  if v_year < 2000 or v_year > extract(year from now())::int + 1 then
    raise exception 'INVALID_YEAR';
  end if;

  if v_email is not null
     and exists (select 1 from public.candidates where lower(email) = v_email) then
    raise exception 'EMAIL_EXISTS';
  end if;

  v_reg := public.next_registration_number(v_year);

  insert into public.candidates (
    full_name, email, registration_number, exam_year, passport_url,
    phone, state_of_origin, lga, date_of_birth, occupation, religion,
    last_institution, marital_status, next_of_kin_name, next_of_kin_phone,
    gender, course, class_schedule, address
  )
  values (
    v_name, v_email, v_reg, v_year, p_passport_url,
    v_phone, btrim(p_state_of_origin), btrim(p_lga),
    p_date_of_birth, v_occupation, v_religion,
    btrim(p_last_institution),
    btrim(p_marital_status), btrim(p_next_of_kin_name),
    btrim(p_next_of_kin_phone), btrim(p_gender),
    btrim(p_course), btrim(p_class_schedule),
    btrim(p_address)
  )
  returning candidates.id into v_id;

  insert into public.admin_audit_log (admin_email, action, candidate_id, detail)
  values (lower(coalesce(auth.email(), '')), 'add_candidate', v_id, v_reg);

  return query select v_id, v_reg;
end;
$$;
grant execute on function public.admin_add_candidate(
  text, text, text, text, text, date, text, text, text, text,
  text, text, text, text, text, text, text, int
) to authenticated;


-- -------------------------------------------------------------
-- 7b. Bulk CSV import — same validation as admin_add_candidate,
--     EXCEPT the passport is optional. Imported rows start with
--     passport_url = NULL and the admin attaches each photo later
--     (see admin_set_passport below). This is the ONLY path that
--     allows a missing passport; the public register_candidate and
--     manual admin_add_candidate still require one.
-- -------------------------------------------------------------
create or replace function public.admin_import_candidate(
  p_full_name         text,
  p_email             text,
  p_phone             text,
  p_state_of_origin   text,
  p_lga               text,
  p_date_of_birth     date,
  p_occupation        text,
  p_religion          text,
  p_last_institution  text,
  p_marital_status    text,
  p_next_of_kin_name  text,
  p_next_of_kin_phone text,
  p_gender            text,
  p_course            text,
  p_class_schedule    text,
  p_address           text,
  p_exam_year         int default null
)
returns table (id uuid, registration_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reg        text;
  v_year       int  := coalesce(p_exam_year, extract(year from now())::int);
  v_name       text := btrim(p_full_name);
  v_email      text := nullif(lower(btrim(p_email)), '');
  v_phone      text := btrim(p_phone);
  v_occupation text := nullif(btrim(p_occupation), '');
  v_religion   text := nullif(btrim(p_religion), '');
  v_id         uuid;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  -- Same server-side validation as the manual add path.
  if v_name is null or char_length(v_name) < 2 then
    raise exception 'INVALID_NAME';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  if v_phone is null or char_length(regexp_replace(v_phone, '\D', '', 'g')) < 7 then
    raise exception 'INVALID_PHONE';
  end if;
  if v_occupation is null then
    raise exception 'INVALID_OCCUPATION';
  end if;
  if v_religion is null then
    raise exception 'INVALID_RELIGION';
  end if;
  if nullif(btrim(p_state_of_origin), '') is null
     or nullif(btrim(p_lga), '') is null
     or p_date_of_birth is null
     or nullif(btrim(p_last_institution), '') is null
     or nullif(btrim(p_marital_status), '') is null
     or nullif(btrim(p_next_of_kin_name), '') is null
     or nullif(btrim(p_next_of_kin_phone), '') is null
     or nullif(btrim(p_gender), '') is null
     or nullif(btrim(p_course), '') is null
     or nullif(btrim(p_class_schedule), '') is null
     or nullif(btrim(p_address), '') is null then
    raise exception 'MISSING_FIELD';
  end if;
  if v_year < 2000 or v_year > extract(year from now())::int + 1 then
    raise exception 'INVALID_YEAR';
  end if;

  if v_email is not null
     and exists (select 1 from public.candidates where lower(email) = v_email) then
    raise exception 'EMAIL_EXISTS';
  end if;

  v_reg := public.next_registration_number(v_year);

  insert into public.candidates (
    full_name, email, registration_number, exam_year, passport_url,
    phone, state_of_origin, lga, date_of_birth, occupation, religion,
    last_institution, marital_status, next_of_kin_name, next_of_kin_phone,
    gender, course, class_schedule, address
  )
  values (
    v_name, v_email, v_reg, v_year, null,           -- no passport on import
    v_phone, btrim(p_state_of_origin), btrim(p_lga),
    p_date_of_birth, v_occupation, v_religion,
    btrim(p_last_institution),
    btrim(p_marital_status), btrim(p_next_of_kin_name),
    btrim(p_next_of_kin_phone), btrim(p_gender),
    btrim(p_course), btrim(p_class_schedule),
    btrim(p_address)
  )
  returning candidates.id into v_id;

  insert into public.admin_audit_log (admin_email, action, candidate_id, detail)
  values (lower(coalesce(auth.email(), '')), 'import_candidate', v_id, v_reg);

  return query select v_id, v_reg;
end;
$$;
grant execute on function public.admin_import_candidate(
  text, text, text, text, text, date, text, text, text, text,
  text, text, text, text, text, text, int
) to authenticated;


-- -------------------------------------------------------------
-- 7c. Attach a passport to an existing row (bulk-imported rows
--     start without one). Photo must still come from the
--     upload-passport Edge Function — only validated object paths
--     (UUID + image extension) are accepted.
-- -------------------------------------------------------------
create or replace function public.admin_set_passport(
  p_candidate_id   uuid,
  p_passport_url   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN';
  end if;

  if p_passport_url is null
     or p_passport_url !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png)$' then
    raise exception 'INVALID_PASSPORT';
  end if;

  update public.candidates
     set passport_url = p_passport_url
   where id = p_candidate_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.admin_audit_log (admin_email, action, candidate_id, detail)
  values (lower(coalesce(auth.email(), '')), 'attach_passport', p_candidate_id, p_passport_url);
end;
$$;
grant execute on function public.admin_set_passport(uuid, text) to authenticated;


-- =============================================================
-- 8. Alumni experiences ("Success Stories") — public submissions
--    with admin moderation. Same hardening model as candidates:
--    RLS deny-by-default; every public path is a SECURITY DEFINER
--    RPC; admins read via an is_admin() policy. No photo/storage,
--    no service-role work — stories are public text.
-- =============================================================
create table if not exists public.experiences (
  id          uuid        primary key default gen_random_uuid(),
  full_name   text        not null,
  program     text,                              -- course taken (from COURSES)
  phone       text        not null,              -- PRIVATE: admin vetting only; never in public read
  experience  text        not null,
  status      text        not null default 'pending'
                check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now()
);

create index if not exists experiences_status_idx
  on public.experiences (status, created_at desc);

-- 8a. RLS: deny-by-default. Public paths are the RPCs below.
alter table public.experiences enable row level security;

-- Allowlisted admins read the full queue (incl. private phone + status).
drop policy if exists "admins read experiences" on public.experiences;
create policy "admins read experiences"
  on public.experiences for select
  to authenticated
  using ( public.is_admin() );

-- Same gotcha as §7c: an RLS SELECT policy STILL needs a table-level SELECT
-- grant, else the query fails with "permission denied for table" (42501)
-- before the policy is evaluated. The policy still limits reads to admins.
grant select on public.experiences to authenticated;
-- The `health` Edge Function probes tables with the service-role key, which
-- bypasses RLS but still needs a table-level SELECT grant.
grant select on public.experiences to service_role;

-- 8b. Public READ — narrow projection: NO phone, NO status internals.
create or replace function public.list_approved_experiences()
returns table (
  id         uuid,
  full_name  text,
  program    text,
  experience text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select e.id, e.full_name, e.program, e.experience, e.created_at
  from public.experiences e
  where e.status = 'approved'
  order by e.created_at desc
  limit 200;
$$;
grant execute on function public.list_approved_experiences() to anon, authenticated;

-- 8c. Public WRITE — forces status='pending' server-side (client can't set it),
--     validates everything (never trust the client), raises UPPER_SNAKE codes.
create or replace function public.submit_experience(
  p_full_name  text,
  p_program    text,
  p_phone      text,
  p_experience text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name       text := btrim(p_full_name);
  v_program    text := nullif(btrim(p_program), '');
  v_phone      text := btrim(p_phone);
  v_experience text := btrim(p_experience);
begin
  -- Rate limit: at most 3 story submissions per 24 hours per phone.
  if not public.rate_limit_try('story:' || v_phone, 3, 86400) then
    raise exception 'RATE_LIMITED';
  end if;

  if v_name is null or char_length(v_name) < 2 then
    raise exception 'INVALID_NAME';
  end if;
  if v_program is null then
    raise exception 'INVALID_PROGRAM';
  end if;
  if v_phone is null or char_length(regexp_replace(v_phone, '\D', '', 'g')) < 7 then
    raise exception 'INVALID_PHONE';
  end if;
  if v_experience is null
     or char_length(v_experience) < 40
     or char_length(v_experience) > 1200 then
    raise exception 'INVALID_EXPERIENCE';
  end if;

  -- status is hard-coded here; there is no p_status parameter to abuse.
  insert into public.experiences (full_name, program, phone, experience, status)
  values (v_name, v_program, v_phone, v_experience, 'pending');
end;
$$;
grant execute on function public.submit_experience(text, text, text, text) to anon, authenticated;

-- 8d. Admin moderation — is_admin()-gated, modeled on admin_issue/revoke_certificate.
create or replace function public.admin_approve_experience(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  update public.experiences set status = 'approved' where id = p_id;
  if not found then raise exception 'NO_EXPERIENCE'; end if;
  insert into public.admin_audit_log (admin_email, action, detail)
  values (lower(coalesce(auth.email(), '')), 'approve_story', p_id::text);
end;
$$;
grant execute on function public.admin_approve_experience(uuid) to authenticated;

create or replace function public.admin_reject_experience(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  update public.experiences set status = 'rejected' where id = p_id;
  if not found then raise exception 'NO_EXPERIENCE'; end if;
  insert into public.admin_audit_log (admin_email, action, detail)
  values (lower(coalesce(auth.email(), '')), 'reject_story', p_id::text);
end;
$$;
grant execute on function public.admin_reject_experience(uuid) to authenticated;

-- =============================================================
-- 9. Admin audit log
--    Write-only by design: only the SECURITY DEFINER admin RPCs
--    insert here; allowlisted admins may read for accountability.
--    There is deliberately no UI yet — query it in the SQL editor:
--      select * from public.admin_audit_log order by created_at desc;
-- =============================================================
create table if not exists public.admin_audit_log (
  id           uuid primary key default gen_random_uuid(),
  admin_email  text not null,
  action       text not null,
  candidate_id uuid,
  detail       text,
  created_at   timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;

drop policy if exists "admins read audit log" on public.admin_audit_log;
drop policy if exists "super admins read audit log" on public.admin_audit_log;
create policy "super admins read audit log"
  on public.admin_audit_log for select
  to authenticated
  using ( public.is_admin_role() );

grant select on public.admin_audit_log to authenticated;

-- =============================================================
-- 10. Security monitoring: login attempts + alerts
--     The admin login UI records every sign-in attempt (success or
--     failure) through the `log-login-attempt` Edge Function, which
--     also mints a real-time brute-force alert when failed attempts
--     spike. Allowlisted admins read both tables; writes happen only
--     via the service-role Edge Function (never from the browser).
-- =============================================================
create table if not exists public.security_login_attempts (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  outcome    text not null check (outcome in ('success', 'failed')),
  ip         text,
  created_at timestamptz not null default now()
);
alter table public.security_login_attempts enable row level security;

-- Legacy policy name from before roles existed; RLS ORs policies together, so
-- it MUST be dropped or every plain admin could keep reading the table.
drop policy if exists "admins read login attempts" on public.security_login_attempts;
drop policy if exists "super admins read login attempts" on public.security_login_attempts;
create policy "super admins read login attempts"
  on public.security_login_attempts for select
  to authenticated
  using ( public.is_admin_role() );

grant select on public.security_login_attempts to authenticated, service_role;
-- Writes happen only from the service-role `log-login-attempt` Edge Function,
-- so give service_role table-level INSERT on both tables (it bypasses RLS but
-- still needs the grant, exactly like SELECT above).
grant insert on public.security_login_attempts to service_role;

create table if not exists public.security_alerts (
  id         uuid primary key default gen_random_uuid(),
  alert_type text not null,
  severity   text not null default 'high',
  title      text not null,
  detail     text,
  status     text not null default 'open' check (status in ('open', 'dismissed')),
  created_at timestamptz not null default now()
);
alter table public.security_alerts enable row level security;

drop policy if exists "admins read security alerts" on public.security_alerts;
drop policy if exists "super admins read security alerts" on public.security_alerts;
create policy "super admins read security alerts"
  on public.security_alerts for select
  to authenticated
  using ( public.is_admin_role() );

grant select on public.security_alerts to authenticated, service_role;
grant insert on public.security_alerts to service_role;

-- Admin dismisses a resolved alert. SUPER-admin only (plain admins can't
-- see the alerts at all). Audited like every other admin action.
create or replace function public.dismiss_security_alert(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_role() then raise exception 'NOT_SUPER_ADMIN'; end if;
  update public.security_alerts set status = 'dismissed' where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.admin_audit_log (admin_email, action, detail)
  values (lower(coalesce(auth.email(), '')), 'dismiss_alert', p_id::text);
end;
$$;
grant execute on function public.dismiss_security_alert(uuid) to authenticated;

-- =============================================================
-- 11. Close the direct RPC holes now that hCaptcha-gated proxies exist.
--     register_candidate, verify_candidate and submit_experience are only
--     reachable through the `register` / `verify` / `share-story` Edge
--     Functions (which verify the CAPTCHA token server-side). Postgres
--     grants EXECUTE to PUBLIC by default, so revoking from anon/authenticated
--     alone isn't enough — revoke from PUBLIC and hand execute back to the
--     service-role key the Edge Functions use (browser roles lose it entirely).
-- =============================================================
revoke execute on function public.register_candidate(
  text, text, text, text, text, date, text, text, text, text,
  text, text, text, text, text, text, text
) from public;
revoke execute on function public.register_candidate(
  text, text, text, text, text, date, text, text, text, text,
  text, text, text, text, text, text, text
) from anon, authenticated;
revoke execute on function public.verify_candidate(text, text) from public;
revoke execute on function public.verify_candidate(text, text) from anon, authenticated;
revoke execute on function public.submit_experience(text, text, text, text) from public;
revoke execute on function public.submit_experience(text, text, text, text) from anon, authenticated;

grant execute on function public.register_candidate(
  text, text, text, text, text, date, text, text, text, text,
  text, text, text, text, text, text, text
) to service_role;
grant execute on function public.verify_candidate(text, text) to service_role;
grant execute on function public.submit_experience(text, text, text, text) to service_role;

-- =============================================================
-- 12. Admin management (super-admin only)
--     Lets a super-admin add/change/remove admin members from the
--     Settings screen instead of the SQL editor. Every RPC is
--     SECURITY DEFINER, gated by is_admin_role(), and audited.
--     Guards: the LAST super-admin can never be demoted or removed,
--     so the system can't accidentally lock itself out of managing
--     its own access.
-- =============================================================
create or replace function public.list_admin_members()
returns table (email text, admin_role text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  -- Must be gated explicitly: SECURITY DEFINER bypasses RLS, and SQL-language
  -- functions can't hold a guard — only PL/pgSQL can raise NOT_SUPER_ADMIN.
  if not public.is_admin_role() then raise exception 'NOT_SUPER_ADMIN'; end if;
  return query
    select a.email, a.admin_role, a.created_at
    from public.admin_emails a
    order by (a.admin_role = 'super-admin') desc, a.email asc;
end;
$$;
grant execute on function public.list_admin_members() to authenticated;

create or replace function public.add_admin_member(
  p_email text,
  p_role  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_role  text := btrim(p_role);
begin
  if not public.is_admin_role() then raise exception 'NOT_SUPER_ADMIN'; end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  if v_role not in ('super-admin', 'admin') then
    raise exception 'INVALID_ROLE';
  end if;
  -- The new member must already exist as a confirmed Auth user, else the
  -- add would silently produce someone who can't sign in.
  if not exists (
    select 1 from auth.users u
    where lower(u.email) = v_email
      and u.email_confirmed_at is not null
      and u.deleted_at is null
  ) then
    raise exception 'NO_AUTH_USER';
  end if;
  if exists (select 1 from public.admin_emails where email = v_email) then
    raise exception 'ALREADY_MEMBER';
  end if;

  insert into public.admin_emails (email, admin_role)
  values (v_email, v_role);

  insert into public.admin_audit_log (admin_email, action, detail)
  values (lower(coalesce(auth.email(), '')), 'add_admin_member',
          v_email || ' as ' || v_role);
end;
$$;
grant execute on function public.add_admin_member(text, text) to authenticated;

create or replace function public.update_admin_role(
  p_email text,
  p_role  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_role  text := btrim(p_role);
  v_super int;
begin
  if not public.is_admin_role() then raise exception 'NOT_SUPER_ADMIN'; end if;
  if v_role not in ('super-admin', 'admin') then
    raise exception 'INVALID_ROLE';
  end if;
  if not exists (select 1 from public.admin_emails where email = v_email) then
    raise exception 'NOT_FOUND';
  end if;
  if v_email = lower(coalesce(auth.email(), '')) and v_role <> 'super-admin' then
    -- Demoting yourself is only safe while another super-admin remains.
    select count(*) into v_super
    from public.admin_emails where admin_role = 'super-admin';
    if v_super <= 1 then raise exception 'LAST_SUPER_ADMIN'; end if;
  end if;

  update public.admin_emails set admin_role = v_role where email = v_email;

  insert into public.admin_audit_log (admin_email, action, detail)
  values (lower(coalesce(auth.email(), '')), 'update_admin_role',
          v_email || ' -> ' || v_role);
end;
$$;
grant execute on function public.update_admin_role(text, text) to authenticated;

create or replace function public.remove_admin_member(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_super int;
  v_role  text;
begin
  if not public.is_admin_role() then raise exception 'NOT_SUPER_ADMIN'; end if;
  select admin_role into v_role from public.admin_emails where email = v_email;
  if v_role is null then raise exception 'NOT_FOUND'; end if;
  if v_role = 'super-admin' then
    select count(*) into v_super
    from public.admin_emails where admin_role = 'super-admin';
    if v_super <= 1 then raise exception 'LAST_SUPER_ADMIN'; end if;
  end if;

  delete from public.admin_emails where email = v_email;

  insert into public.admin_audit_log (admin_email, action, detail)
  values (lower(coalesce(auth.email(), '')), 'remove_admin_member', v_email);
end;
$$;
grant execute on function public.remove_admin_member(text) to authenticated;