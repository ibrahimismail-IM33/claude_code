-- ============================================================================
--  e-Pili Bomba Kunak — 5th (optional): close the RPC surface
--
--  WHY
--    PostgREST publishes every function in the `public` schema as an RPC
--    endpoint. Both of our SECURITY DEFINER helpers are therefore callable by
--    anyone who can reach the API, signed in or not.
--
--  HOW BAD IS IT
--    Not bad. This is surface reduction, not a fix:
--      * search_path is pinned on both, so neither can be tricked into
--        resolving a name to an attacker's object — the usual escalation route
--        for SECURITY DEFINER is closed already.
--      * is_admin() takes no arguments and only reports on the caller. A
--        stranger calling it is told "no".
--      * handle_new_user() returns trigger, so Postgres refuses to run it
--        outside a trigger context. It cannot be invoked over RPC at all.
--
--    There is still no reason for either to be reachable, so revoke them.
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
--  APPLIED TO PRODUCTION 2026-08-06, and confirmed by an admin saving a Kad
--  Rekod row from the live app. That save is the verification — it proves the
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

-- Nothing calls this as a caller; the trigger runs as its owner.
revoke execute on function public.handle_new_user() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
--  Check it worked
--    Expect exactly:
--      handle_new_user   anon_can_call f   auth_can_call f
--      is_admin          anon_can_call f   auth_can_call t   ← t is CORRECT
--
--    auth_can_call = f on is_admin means the write policies are broken. That is
--    a failure, not a stricter result.
--
--    has_function_privilege() answers the question that matters — "could this
--    role run it" — including anything inherited through PUBLIC, which is the
--    grant that made the revoke necessary in the first place.
-- ---------------------------------------------------------------------------
select
  p.proname                                                 as function_name,
  has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_can_call,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_admin','handle_new_user')
order by p.proname;


-- ============================================================================
--  AFTER RUNNING THIS
--    Sign in to the app as an admin and save a Kad Rekod row. Every write
--    policy depends on is_admin(), so if anything here were wrong the symptom
--    is officers unable to save at all. Do not assume — check.
-- ============================================================================
