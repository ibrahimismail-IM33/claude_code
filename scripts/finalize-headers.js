#!/usr/bin/env node
/* Make dist/_headers right for the environment being built.
 *
 * THE PROBLEM THIS SOLVES
 *   Staging and production are now built from the SAME file — v2/public/_headers
 *   — by two Cloudflare Pages projects watching two branches of this one repo.
 *   Every header they need is identical except one:
 *
 *     X-Robots-Tag: noindex, nofollow
 *
 *   Staging MUST carry it. It holds real hydrant data and real officer logins,
 *   and a search result pointing at it is a support incident waiting to happen.
 *   Production must NOT: epilibomba.com is a public service and being absent
 *   from search results is a defect, not a safeguard.
 *
 * WHY THE SOURCE FILE KEEPS THE LINE
 *   Because the safe default has to be the one you get by doing nothing. A new
 *   branch, a new preview, a Pages project someone stands up next year — all of
 *   them are private unless this script is told otherwise. If the file shipped
 *   without the line and production added it, then every future environment
 *   would be indexable by omission, and nobody would notice until it was.
 *
 * HOW PRODUCTION IS IDENTIFIED
 *   CF_PAGES_BRANCH, which Cloudflare sets on every build. No dashboard
 *   variable to forget, no second place for the answer to live. Outside
 *   Cloudflare the variable is unset, so a local build behaves like staging —
 *   again, private by default.
 *
 * A NON-ZERO EXIT FAILS THE DEPLOYMENT, same as verify-bundle.js. This script
 * runs BEFORE it, and verify-bundle.js then re-checks the result independently:
 * this one decides, that one refuses to ship the wrong answer.
 *
 * Node only, no dependencies — it has to run in Cloudflare's build image.
 */
const fs = require('fs');
const path = require('path');

// The branch epilibomba.com is served from. If the production branch is ever
// renamed, this is the one place that has to change.
const PRODUCTION_BRANCH = process.env.EPB_PRODUCTION_BRANCH || 'main';
const branch = process.env.CF_PAGES_BRANCH || '(not a Cloudflare build)';
const isProduction = process.env.CF_PAGES_BRANCH === PRODUCTION_BRANCH;

const file = path.join(__dirname, '..', 'dist', '_headers');
if (!fs.existsSync(file)) {
  console.error('FAIL  dist/_headers is missing — v2/public/_headers did not get '
    + 'copied, so the CSP, the Permissions-Policy and everything else would be absent');
  process.exit(1);
}

const before = fs.readFileSync(file, 'utf8');
const ROBOTS = /^\s*X-Robots-Tag:.*$/gim;

console.log('branch: ' + branch + (isProduction ? '  → PRODUCTION' : '  → not production'));

if (isProduction) {
  if (!ROBOTS.test(before)) {
    // Not an error worth failing on — it is already in the desired state — but
    // say so, because it means the source file changed and the next reader
    // should know this step is no longer doing anything.
    console.log('  ok    no X-Robots-Tag to remove (already absent from the source)');
  } else {
    const after = before.replace(ROBOTS, '').replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(file, after);
    console.log('  ok    X-Robots-Tag removed — epilibomba.com is indexable');
  }
} else {
  /* The failure this guards is silent and expensive: staging indexed. Assert
   * rather than assume, because the whole point of keeping the line in the
   * source file is that it survives. */
  if (!/X-Robots-Tag:\s*noindex/i.test(before)) {
    console.error('\nBUNDLE REJECTED — the deployment will not go out:\n');
    console.error('  FAIL  this is not the production branch (' + branch + ') but '
      + 'dist/_headers carries no "X-Robots-Tag: noindex".');
    console.error('        A non-production environment holding real hydrant data and '
      + 'real\n        officer logins must never be indexable. Restore the line in '
      + 'v2/public/_headers.\n');
    process.exit(1);
  }
  console.log('  ok    X-Robots-Tag: noindex kept — this environment stays private');
}
