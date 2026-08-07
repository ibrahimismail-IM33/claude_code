/* Every suite must actually run — in `npm test` AND in CI.
 *
 * This exists because it went wrong. The `test` chain in package.json was
 * patched by string replacement, and `test:v2dash` is a SUBSTRING of
 * `test:v2dashdata`, so the edit spliced the new entries into the middle of an
 * existing name and produced `npm run test:v2jadualdata`. Two suites silently
 * stopped running and one name did not exist at all.
 *
 * The wider lesson is older than that and is written into CLAUDE.md §3: the
 * suites in tests/ existed for months while nothing ran them. A test nobody
 * runs guards nothing, and a suite that quietly drops out of the chain is
 * indistinguishable from one that passes.
 *
 * Cheap, no browser. Run it first so a wiring mistake is the first thing you
 * see rather than the last.
 *
 * Run:  node tests/suite-wiring.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          got =' + JSON.stringify(got) + '\n          want=' + JSON.stringify(want)));
  ok ? pass++ : fail++; };

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'tests.yml'), 'utf8');

const scripts = Object.keys(pkg.scripts).filter((k) => k.startsWith('test:'));
// Split on && and pull the script name out of each "npm run <name>" step, so a
// mangled entry shows up as a name that does not exist rather than being
// swallowed by a loose substring match.
const chain = pkg.scripts.test.split('&&').map((s) => s.trim())
  .map((s) => (/^npm run ([\w:-]+)$/.exec(s) || [])[1]);

check('every step in the test chain is a real script', chain.filter((n) => !n || !pkg.scripts[n]), []);
check('every test:* script is in the chain', scripts.filter((n) => chain.indexOf(n) < 0), []);
check('no script runs twice', chain.filter((n, i) => chain.indexOf(n) !== i), []);

// CI runs each suite as its own step so a failure names itself in the Actions
// list. A suite in package.json but not in the workflow still fails locally —
// but the publish gate is what stops a broken build reaching officers, and the
// gate only knows what the workflow runs.
check('every suite is also a CI step', scripts.filter((n) => workflow.indexOf('npm run ' + n) < 0), []);

// Every suite file on disk should be wired to something. A file nobody invokes
// is the exact failure this guards.
const onDisk = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && f !== path.basename(__filename));
const invoked = scripts.map((n) => pkg.scripts[n]).join(' ');
check('every .js file in tests/ is invoked by a script',
  onDisk.filter((f) => invoked.indexOf(f) < 0), []);

// The gate itself. A CI job that reports red while the broken build ships
// anyway is decoration (CLAUDE.md §3).
const publish = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-to-site.yml'), 'utf8');
check('tests.yml is reusable by the publish gate', /workflow_call:/.test(workflow), true);
check('the publish job still depends on the tests', /needs:\s*test/.test(publish), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
