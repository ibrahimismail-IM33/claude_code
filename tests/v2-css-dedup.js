/* No selector may be defined identically in two stylesheets.
 *
 * CLAUDE.md §4.27: 29 selectors were defined byte-for-byte in more than one of
 * the V2 stylesheets. Nothing looked wrong because the copies agreed — until
 * one edit touched only the losing copy and silently did nothing, overridden by
 * an identical rule in a stylesheet about a different screen. Editing the wrong
 * copy is a real, recurring trap on this codebase.
 *
 * The duplicates were removed (the losing copy dropped, the winner kept, proven
 * behaviour-neutral by an effective-cascade invariant). This guard keeps them
 * gone: it flags any (media-context + selector + declarations) block that
 * appears identically in two files. It is CONTEXT-AWARE on purpose — a base
 * rule and its `@media` override legitimately share a selector, so those are
 * not duplicates.
 *
 * Cheap, no browser. Run:  node tests/v2-css-dedup.js
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'v2', 'src', 'styles');
// Import order is irrelevant to THIS check (it only asks "does an identical copy
// exist elsewhere"), but list the app's own sheets explicitly so a new one is a
// deliberate addition here rather than silently unguarded.
const FILES = ['tokens.css', 'shell.css', 'map.css', 'dashboard.css', 'profile.css', 'kad-rekod.css'];

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          got =' + JSON.stringify(got) + '\n          want=' + JSON.stringify(want)));
  ok ? pass++ : fail++;
};

/* Parse rule blocks: {context, selector, decls}. Skips comments; tracks one
 * level of @media nesting; normalizes declarations so whitespace/order do not
 * hide a duplicate. */
function blocks(text) {
  const out = [];
  let i = 0; const n = text.length; let header = ''; const stack = [];
  const norm = (d) => d.split(';').map((x) => x.trim()).filter(Boolean).sort().join(';');
  while (i < n) {
    if (text[i] === '/' && text[i + 1] === '*') { const j = text.indexOf('*/', i + 2); i = j === -1 ? n : j + 2; continue; }
    const c = text[i];
    if (c === '{') {
      const head = header.trim(); header = '';
      if (head.startsWith('@')) { stack.push(head); i++; continue; }
      let depth = 1; let j = i + 1;
      while (j < n && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') { const k = text.indexOf('*/', j + 2); j = k === -1 ? n : k + 2; continue; }
        if (text[j] === '{') depth++;
        else if (text[j] === '}') { depth--; if (depth === 0) break; }
        j++;
      }
      const decls = norm(text.slice(i + 1, j));
      const context = stack.join(' > ');
      head.split(',').forEach((sel) => out.push({ context, selector: sel.trim(), decls }));
      i = j + 1; continue;
    } else if (c === '}') { if (stack.length) stack.pop(); header = ''; i++; continue; }
    header += c; i++;
  }
  return out;
}

const seen = new Map();
FILES.forEach((f) => {
  const p = path.join(DIR, f);
  if (!fs.existsSync(p)) return;
  blocks(fs.readFileSync(p, 'utf8')).forEach((b) => {
    const key = b.context + '||' + b.selector + '||' + b.decls;
    (seen.get(key) || seen.set(key, []).get(key)).push(f);
  });
});

const identical = [];
for (const [key, files] of seen) {
  const uniq = [...new Set(files)];
  if (uniq.length > 1) identical.push(key.split('||')[1] + '  in ' + JSON.stringify(uniq));
}

check('no selector is defined identically in two stylesheets', identical.sort(), []);
// A sanity floor so a parser that silently returns nothing cannot pass: the
// stylesheets must yield a substantial number of rules.
const totalRules = [...seen.values()].reduce((a, v) => a + v.length, 0);
check('the parser actually saw the stylesheets (>200 rule/selector pairs)', totalRules > 200, true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
