-- ============================================================================
--  e-Pili Bomba Kunak  ·  BBP Kunak, Sabah
--  FILE 2 of 2 — record cards, signatures, and the permanent row lock
--
--  HOW TO USE
--    Run supabase-setup.sql FIRST (it creates is_admin() and the hydrants
--    table that this file depends on), then paste all of this into
--    SQL Editor > New query > Run.
--    Safe to re-run: it will not duplicate or destroy existing data.
--
--  WHAT THIS SETS UP
--    hydrant_records ..... every row of every Kad Rekod Pili Bomba
--    signatures bucket ... storage for uploaded signature images
--    permanent row lock .. once a row is signed it can never be
--                          changed or deleted through the app
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Record card storage
--    One row here = one line of one section of one hydrant's card.
--    section is: 'header', 'kerosakan', 'pemantauan', 'pengujian', 'kompaun'
--    data holds that line's cell values as JSON.
-- ---------------------------------------------------------------------------
create table if not exists public.hydrant_records (
  hydrant_id bigint  not null references public.hydrants(id) on delete cascade,
  section    text    not null,
  row_index  int     not null,
  data       jsonb   not null default '{}'::jsonb,
  signed     boolean not null default false,
  signed_by  text,                       -- email of the admin who signed
  signed_at  timestamptz,
  signature  text,                       -- public URL of the signature image
  updated_at timestamptz default now(),
  primary key (hydrant_id, section, row_index)
);

-- If the table already existed before signatures were added, top it up.
alter table public.hydrant_records add column if not exists signed    boolean not null default false;
alter table public.hydrant_records add column if not exists signed_by text;
alter table public.hydrant_records add column if not exists signed_at timestamptz;
alter table public.hydrant_records add column if not exists signature text;

alter table public.hydrant_records enable row level security;


-- ---------------------------------------------------------------------------
-- 2. Who may do what
--    Read: any signed-in user.  Write: admins only.
--    The UPDATE and DELETE rules also require signed = false, so a signed
--    row falls outside the rule entirely and can never be touched.
-- ---------------------------------------------------------------------------
drop policy if exists "records read"                  on public.hydrant_records;
drop policy if exists "records insert"                on public.hydrant_records;
drop policy if exists "records update"                on public.hydrant_records;
drop policy if exists "records delete"                on public.hydrant_records;
drop policy if exists "auth read records"             on public.hydrant_records;
drop policy if exists "admin insert records"          on public.hydrant_records;
drop policy if exists "admin update records"          on public.hydrant_records;
drop policy if exists "admin delete records"          on public.hydrant_records;
drop policy if exists "admin update unsigned records" on public.hydrant_records;
drop policy if exists "admin delete unsigned records" on public.hydrant_records;

create policy "auth read records" on public.hydrant_records
  for select to authenticated using (true);

create policy "admin insert records" on public.hydrant_records
  for insert to authenticated with check (public.is_admin());

create policy "admin update unsigned records" on public.hydrant_records
  for update to authenticated
  using (public.is_admin() and coalesce(signed,false) = false)
  with check (public.is_admin());

create policy "admin delete unsigned records" on public.hydrant_records
  for delete to authenticated
  using (public.is_admin() and coalesce(signed,false) = false);


-- ---------------------------------------------------------------------------
-- 3. Hard lock on signed rows
--    A second, independent guard. Even if the policies above were ever
--    loosened by mistake, this trigger still refuses to let a signed row
--    be edited or deleted.
-- ---------------------------------------------------------------------------
create or replace function public.protect_signed_rows()
returns trigger
language plpgsql
as $$
begin
  if (TG_OP = 'UPDATE' and OLD.signed = true) then
    raise exception 'This row is signed and locked; it cannot be changed.';
  end if;
  if (TG_OP = 'DELETE' and OLD.signed = true) then
    raise exception 'This row is signed and locked; it cannot be deleted.';
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

drop trigger if exists trg_protect_signed on public.hydrant_records;
create trigger trg_protect_signed
  before update or delete on public.hydrant_records
  for each row execute function public.protect_signed_rows();


-- ---------------------------------------------------------------------------
-- 4. Signature image storage
--    The bucket is PRIVATE. An officer's signature is personal data and the
--    evidence that an inspection happened; a public bucket meant anyone
--    holding a URL could fetch one without ever logging in.
--
--    The app therefore asks for a 1-hour signed link when a card opens
--    (createSignedUrls, SIG_TTL = 3600) and falls back to whatever is stored
--    on the row if signing is unavailable, so a signature never fails to
--    display. New rows store the storage PATH; rows signed before this change
--    hold a full public URL and the path is extracted from it.
--
--    Reading requires a signed-in user. Only an admin may upload. There is
--    deliberately NO update or delete rule, so an uploaded signature image
--    can never be replaced or removed.
--
--    Keep this in step with production. These scripts are the disaster
--    recovery source of truth — RESTORE.md makes re-running everything in
--    sql/ a mandatory step, so a script that still said `public = true`
--    would silently re-expose every signature during a recovery.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('signatures','signatures', false)
on conflict (id) do update set public = false;

drop policy if exists "signatures read"   on storage.objects;
drop policy if exists "signatures write"  on storage.objects;
drop policy if exists "signatures upload" on storage.objects;
drop policy if exists "sig read"          on storage.objects;
drop policy if exists "sig upload"        on storage.objects;

-- `to authenticated` is the point of this policy. Without it the rule applies
-- to {public}, which includes anon — and a private bucket with an anon-readable
-- policy is not private at all.
create policy "signatures read" on storage.objects
  for select to authenticated
  using (bucket_id = 'signatures');

create policy "signatures write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'signatures' and public.is_admin());


-- ---------------------------------------------------------------------------
-- 5. Check it worked
--    Expect: records_table 1, lock_trigger 1, bucket 1, storage_policies 2,
--            bucket_is_private t, read_is_authenticated_only t
--
--    The last two are the ones to actually look at. Everything else here can
--    be right while the signatures sit open to the whole internet.
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='hydrant_records')      as records_table,
  (select count(*) from pg_trigger where tgname='trg_protect_signed')   as lock_trigger,
  (select count(*) from storage.buckets where id='signatures')          as bucket,
  (select count(*) from pg_policies
     where schemaname='storage' and tablename='objects'
       and policyname like 'signatures%')                              as storage_policies,
  (select not public from storage.buckets where id='signatures')        as bucket_is_private,
  (select roles = '{authenticated}' from pg_policies
     where schemaname='storage' and tablename='objects'
       and policyname='signatures read')                        as read_is_authenticated_only,
  (select count(*) from public.hydrant_records)                         as rows_saved_so_far;


-- ============================================================================
--  GOOD TO KNOW
--
--  * Signing is permanent by design. If a row is ever signed by mistake it
--    cannot be undone from the app — the trigger above has to be removed
--    temporarily to correct it.
--
--  * "Who signed" is only as meaningful as your accounts. If several people
--    share one admin login, every signature records that same address.
--    Individual accounts are strongly preferred.
-- ============================================================================
