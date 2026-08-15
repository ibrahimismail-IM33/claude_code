-- ============================================================================
--  e-Pili Bomba Kunak — 5th (optional): close the RPC surface
--
--  WHY
--    PostgREST publishes every function in the `public` schema as an RPC
--    endpoint, and every function is created with an implicit EXECUTE grant to
--    PUBLIC. Ours are therefore callable by anyone who can reach the API,
--    signed in or not.
--
--    There are FIVE functions in `public`, not two. The first version of this
--    script said "both of our SECURITY DEFINER helpers" and closed only
--    is_admin() and handle_new_user(); the three trigger functions were missed
--    entirely. Found 2026-08-07 from a Supabase security advisory — a check
--    nobody was running. Count them before claiming a surface is closed.
--
--  HOW BAD IS IT
--    Not bad. This is surface reduction and accuracy, not a fix:
--      * search_path is pinned on all of them, so none can be tricked into
--        resolving a name to an attacker's object — the usual escalation route
--        for SECURITY DEFINER is closed already.
--      * is_admin() takes no arguments and only reports on the caller. A
--        stranger calling it is told "no".
--      * handle_new_user(), lock_signed_records(), protect_signed_rows() and
--        stamp_row_audit() all return trigger, so Postgres refuses to run them
--        outside a trigger context. They cannot be invoked over RPC at all.
--
--    There is still no reason for any of them to be reachable, so revoke them.
--
--  AUTHENTICATED MUST KEEP EXECUTE ON is_admin()  ← do not "tidy" this away
--    Every write policy on hydrants, hydrant_records and jadual_pemeriksaan
--    calls public.is_admin(). An RLS policy expression is evaluated as the
--    CALLING role, not as the policy or function owner — so if `authenticated`
--    cannot execute is_admin(), the policy cannot either, and every write dies
--    with:
--
--        ERROR:  permission denied for function is_admin
--
--    The first draft of this script revoked from authenticated as well. It was
--    caught by running it against a real Postgres and trying an admin insert,
--    which returned exactly that error. Shipping it would have left every
--    officer unable to save anything. Assume nothing here; test it.
--
--    handle_new_user() is different: nothing calls it as a caller. It runs from
--    a trigger on auth.users, as the trigger's owner, so it can be closed to
--    everyone. Verified — a new user still gets a 'viewer' profile.
--
--  Safe to re-run.
--
--  APPLIED TO PRODUCTION 2026-08-06 (is_admin, handle_new_user) and again
--  2026-08-07 (the three trigger functions, and the search_path correction
--  below). Both times confirmed by an admin saving a Kad Rekod row from the
--  live app. That save is the verification — it proves the
--  write reached the database through RLS, so the policy called is_admin() and
--  it evaluated as `authenticated`. The verification query at the foot of this
--  file reports callable_by_api = f and looks like success EVEN WHEN EVERY
--  WRITE IS BLOCKED, so it is not sufficient on its own. After running this
--  script anywhere — including during a disaster recovery — sign in and save a
--  record before believing it worked.
-- ============================================================================

-- Close the RPC endpoint to the anonymous role and to the implicit PUBLIC
-- grant every function is created with, then hand back the one grant the RLS
-- policies genuinely need.
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

-- can_write(text) is the district-scoped write check (PRD §7.3). Like is_admin
-- it is called INSIDE RLS policy expressions, so it follows the same rule:
-- close the RPC endpoint to anon/PUBLIC, but `authenticated` MUST keep EXECUTE
-- or every district-scoped write dies. Same failure mode, same fix.
revoke execute on function public.can_write(text) from public, anon;
grant  execute on function public.can_write(text) to authenticated;

-- Trigger functions. Nothing calls these as a caller — each runs from its own
-- trigger, as the trigger's owner — so all three roles can lose EXECUTE.
revoke execute on function public.handle_new_user()      from public, anon, authenticated;
revoke execute on function public.lock_signed_records()  from public, anon, authenticated;
revoke execute on function public.protect_signed_rows()  from public, anon, authenticated;
revoke execute on function public.stamp_row_audit()      from public, anon, authenticated;

-- Correct a pin that never worked. 'public, pg_temp' as a SINGLE quoted string
-- names one schema that does not exist, so the pin silently did nothing while
-- reading like hardening; the working form is TWO quoted identifiers. Inert in
-- practice — that function only calls now(), current_setting() and jsonb
-- operators, all resolved from pg_catalog whatever search_path says — but the
-- first unqualified reference to a public table added there would break it.
--
-- Deliberately duplicated from supabase-audit-setup.sql, which holds the
-- canonical definition. THIS is the script people re-run when hardening, and a
-- fix it cannot deliver is a fix that does not get applied: the correction was
-- shipped in script 4, production was hardened by re-running script 5, and the
-- pin stayed broken. ALTER rather than a second CREATE OR REPLACE, so the two
-- files cannot drift on the body.
alter function public.stamp_row_audit() set search_path to 'public', 'pg_temp';


-- ---------------------------------------------------------------------------
--  Check it worked
--    Expect exactly:
--      function_name         anon   auth   search_path
--      can_write             f      t      search_path=public   ← t is CORRECT
--      handle_new_user       f      f      search_path=public
--      is_admin              f      t      search_path=public   ← t is CORRECT
--      lock_signed_records   f      f      search_path=public, pg_temp
--      protect_signed_rows   f      f      search_path=public, pg_temp
--      stamp_row_audit       f      f      search_path=public, pg_temp
--
--    auth_can_call = f on is_admin means the write policies are broken. That is
--    a failure, not a stricter result.
--
--    search_path must read  public, pg_temp  — TWO elements. If it comes back
--    quoted as a single "public, pg_temp" the pin is naming a schema that does
--    not exist and is doing nothing. The earlier version of this query did not
--    select it, which is exactly why that stayed broken on production while
--    every other column said success.
--
--    has_function_privilege() answers the question that matters — "could this
--    role run it" — including anything inherited through PUBLIC, which is the
--    grant that made the revoke necessary in the first place.
-- ---------------------------------------------------------------------------
select
  p.proname                                                 as function_name,
  has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_can_call,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can_call,
  coalesce(array_to_string(p.proconfig, ', '), '(none)')    as search_path
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_admin','can_write','handle_new_user','lock_signed_records',
                    'protect_signed_rows','stamp_row_audit')
order by p.proname;


-- ============================================================================
--  AFTER RUNNING THIS
--    Sign in to the app as an admin and save a Kad Rekod row. Every write
--    policy depends on is_admin(), so if anything here were wrong the symptom
--    is officers unable to save at all. Do not assume — check.
--
--    That save also exercises trg_stamp_audit, trg_lock_signed and
--    trg_protect_signed, so it proves the trigger revokes did not break the
--    triggers themselves.
-- ============================================================================
