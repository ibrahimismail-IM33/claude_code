import { createClient } from '@supabase/supabase-js';

// The Supabase seam.
//
// The regression suites stub the backend by assigning `window.supabase` before
// the app boots, and they have done since long before V2 existed. That seam is
// why those suites are framework-agnostic, and it is the whole reason they can
// serve as the migration contract (docs/V2-ROADMAP.md): a test that has to be
// edited to go green has stopped being evidence.
//
// So V2 honours the same seam rather than inventing a new one. The alternative
// — extracting a module that V1 also imports — was considered and rejected: V1
// is one static file with no build step, and making the live app fetch ES
// modules would change what officers run, add requests to the critical path on
// a phone in the field, and break the publish contract that copies exactly
// index.html, _headers and vendor/. All for no user-visible benefit.
//
// This does mean a `window` branch in shipped code. It is not a new attack
// surface: setting window.supabase already requires script execution, and an
// attacker with that has the session anyway.
let client = null;

export function getClient(url, key) {
  if (client) return client;
  const stub = typeof window !== 'undefined' && window.supabase;
  client = stub ? stub.createClient(url, key) : createClient(url, key);
  return client;
}

// Tests drive several scenarios against one page load; without this the first
// scenario's stub would be cached for the rest of the run.
export function resetClient() {
  client = null;
}
