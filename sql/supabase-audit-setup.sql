-- ============================================================================
--  e-Pili Bomba Kunak — 4th (optional but recommended): edit audit trail
--
--  WHY
--    Signing was attributed (signed_by / signed_at) but ordinary editing was
--    not: any admin could change an unsigned row on a Kad Rekod and nothing
--    recorded who did it. On a compliance record that is the wrong way round.
--
--    updated_at also existed with only `default now()` and no trigger, so it
--    was written once on insert and never moved again — it was recording
--    creation time while claiming to be an update time.
--
--  THE IMPORTANT PART
--    The identity is taken from the login token inside the database. It is
--    NOT read from anything the browser sends and there is no fallback to a
--    client-supplied value, so a modified page cannot write someone else's
--    name into the audit column. Where there is no token at all (service
--    role, a restore, a scheduled job) the column is left NULL rather than
--    trusting the request body.
--
--  Safe to re-run.
-- ============================================================================

alter table public.hydrant_records add column if not exists updated_by text;
alter table public.hydrants        add column if not exists updated_by text;

create or replace function public.stamp_row_audit()
returns trigger
language plpgsql
security invoker
set search_path to 'public, pg_temp'
as $$
begin
  new.updated_at := now();
  new.updated_by := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  return new;
end;
$$;

-- Named to sort AFTER trg_lock_signed / trg_protect_signed: those reject any
-- change to a signed row, and that rejection must win before we stamp.
drop trigger if exists trg_stamp_audit on public.hydrant_records;
create trigger trg_stamp_audit
  before insert or update on public.hydrant_records
  for each row execute function public.stamp_row_audit();

drop trigger if exists trg_stamp_audit on public.hydrants;
create trigger trg_stamp_audit
  before insert or update on public.hydrants
  for each row execute function public.stamp_row_audit();

-- Expect: two rows, one per table
select c.relname as table_name, t.tgname as trigger_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal and t.tgname = 'trg_stamp_audit'
order by c.relname;
