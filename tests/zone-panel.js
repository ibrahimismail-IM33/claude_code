/* "Nombor pili terkini" — the zone panel on the dashboard.
 *
 * The panel exists to answer "what number does the next pili in this zone
 * get?", so its numbers have to be right about the register at all times.
 *
 * Zones are not stored anywhere: they are the leading letter of the label, and
 * the panel derives everything at render time. That is deliberate — the user's
 * hand-written table was already a row ahead of the seed data in this repo
 * before it was written down. These assertions guard the derivation, and the
 * two ways it could quietly lie:
 *
 *   1. A range implies contiguity. Delete a pili and "A01 – A114" would still
 *      claim 114 hydrants when 113 remain.
 *   2. A label that is not letter+number gets no row, so the rows could sum to
 *      less than the register holds with nothing on screen to say so.
 *
 * Both must be reported, not hidden.
 *
 * The panel also deliberately IGNORES the Awam/Swasta pills — the last number
 * in a zone is a fact about the register, not about a filter — while the zone
 * FILTER it applies does stack with them, like the two axes already do.
 *
 * Run:  node tests/zone-panel.js       (needs playwright + chromium)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'epb-zone-'));
const APP  = path.join(TMP, 'app.html');
fs.writeFileSync(APP, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('function isAdmin(){ return IS_ADMIN === true; }', 'function isAdmin(){ return true; }'));
const URL = 'file://' + APP;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let pass=0, fail=0;
const check=(name,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want);
  console.log((ok?'  PASS  ':'  FAIL  ')+name+'  got='+JSON.stringify(got)+(ok?'':'  want='+JSON.stringify(want)));
  ok?pass++:fail++; };

let nextId = 1;
const hyd = (label, status) => ({id:nextId++, label, lat:4.68+nextId/10000, lng:118.24+nextId/10000,
  status:status||'kerajaan', location:'Kunak', lastInspected:''});
// n pili in a zone, numbered from `from`
const zone = (z, from, to, status) => { const out=[];
  for(let i=from;i<=to;i++) out.push(hyd(z+(i<10?'0'+i:String(i)), status)); return out; };

async function boot(b, seed, viewport){
  nextId = 1;
  const p = await b.newPage({ viewport: viewport || {width:1280,height:950} });
  p.on('pageerror',e=>{ console.log('  PAGEERROR', e.message); fail++; });
  await p.addInitScript(() => {
    const noop=()=>{};
    const layer=()=>({_l:[],addTo(){return this;},
      clearLayers(){this._l=[];window.__markers=[];},
      addLayer(m){this._l.push(m);window.__markers.push(m);}});
    window.__markers=[];
    window.L={map:()=>({on:noop,invalidateSize:noop,fitBounds:noop,setView:noop}),
      control:{zoom:()=>({addTo:noop})}, tileLayer:()=>({addTo:noop}),
      layerGroup:layer, markerClusterGroup:layer, divIcon:o=>o, latLngBounds:a=>a,
      marker:(ll,o)=>({_ll:ll,bindTooltip(){return this;},on(){return this;}})};
    // No Supabase: the app runs from its local cache, which is all this suite
    // needs and keeps the register exactly what the test seeded.
    window.supabase=undefined;
  });
  await p.addInitScript(s => {
    localStorage.setItem('bbpkunak_hydrants_v2', JSON.stringify(s));
  }, seed);
  await p.goto(URL); await p.waitForTimeout(1000);
  await p.evaluate(()=>document.getElementById('authGate').classList.add('hide'));
  return p;
}

const toDash = async p => { await p.evaluate(()=>document.getElementById('tabDash').click());
                            await p.waitForTimeout(900); };
const rows = p => p.evaluate(()=>[...document.querySelectorAll('#dashZones .zrow')].map(r=>({
  z:r.querySelector('.zk').textContent,
  range:r.querySelector('.zr').textContent,
  count:r.querySelector('.zc').textContent,
  on:r.classList.contains('on'), warn:r.classList.contains('zwarn')})));
const note    = p => p.evaluate(()=>document.getElementById('dashZoneNote').textContent);
const visible = p => p.evaluate(()=>window.__markers.length);
const banner  = p => p.evaluate(()=>{ const b=document.getElementById('banner');
  return b.classList.contains('hide') ? null : b.textContent; });
const curTab  = p => p.evaluate(()=>document.getElementById('dashView').classList.contains('hide') ? 'map' : 'dash');
// Always go via the dashboard: the rows only exist there.
const pressZone = async (p,z) => {
  await p.evaluate(()=>document.getElementById('tabDash').click());
  await p.waitForTimeout(700);
  await p.click(`#dashZones .zrow[data-z="${z}"]`);
  await p.waitForTimeout(500);
};

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM });

  // ---------- T1: the register the user sketched ----------
  console.log('T1  zones derived from the labels');
  // A26 and A92-A107 are swasta in the real register; mirrored here so the
  // "panel ignores the pills" assertion has something to prove.
  const reg = [
    ...zone('A',1,25), hyd('A26','swasta'), ...zone('A',27,91),
    ...zone('A',92,107,'swasta'), ...zone('A',108,114),
    ...zone('B',1,27), ...zone('C',1,21), ...zone('D',1,13), ...zone('E',1,13),
  ];
  let p = await boot(b, reg);
  await toDash(p);
  check('one row per zone, in letter order', (await rows(p)).map(r=>r.z), ['A','B','C','D','E']);
  check('ranges', (await rows(p)).map(r=>r.range),
    ['A01 – A114','B01 – B27','C01 – C21','D01 – D13','E01 – E13']);
  check('counts', (await rows(p)).map(r=>r.count),
    ['114 pili','27 pili','21 pili','13 pili','13 pili']);
  check('counts sum to the register', reg.length, 188);
  check('no warning when every zone is contiguous', (await rows(p)).some(r=>r.warn), false);
  check('caption says it ignores the pills', /tidak mengikut penapis/.test(await note(p)), true);

  // ---------- T2: the panel does NOT follow the Awam/Swasta pills ----------
  console.log('T2  the register is the register, whatever the pill says');
  const before = await rows(p);
  await p.click('#pills .pill[data-s="kerajaan"]');
  await p.waitForTimeout(500);
  check('rows unchanged with the Awam pill on', await rows(p), before);
  check('the map itself DID narrow', await visible(p), 188-17);
  await p.click('#pills .pill[data-s="kerajaan"]');   // toggle back off
  await p.waitForTimeout(400);

  // ---------- T3: pressing a zone filters the map ----------
  console.log('T3  pressing a zone goes to the map, filtered');
  await pressZone(p,'B');
  check('switched to the map tab', await curTab(p), 'map');
  check('only zone B is visible',  await visible(p), 27);
  check('the banner names the zone', /Zon B/.test(await banner(p)||''), true);

  // ---------- T4: zone combines with Awam/Swasta, it does not replace it ----------
  console.log('T4  zone stacks with the other filters');
  await p.click('#pills .pill[data-s="swasta"]');
  await p.waitForTimeout(400);
  check('zone B + Swasta is empty (B has no swasta)', await visible(p), 0);
  check('banner shows both filters', /Swasta/.test(await banner(p)||'') && /Zon B/.test(await banner(p)||''), true);
  await pressZone(p,'B');          // toggle zone B off
  await pressZone(p,'A');          // and select zone A instead
  check('zone A + Swasta is the 17 private pili', await visible(p), 17);

  // ---------- T5: one tap on the banner clears everything ----------
  console.log('T5  the banner clears all three axes');
  await p.click('#banner'); await p.waitForTimeout(500);
  check('banner gone',        await banner(p), null);
  check('all pili visible',   await visible(p), 188);
  await toDash(p);
  check('no zone row left marked active', (await rows(p)).some(r=>r.on), false);
  await p.close();

  // ---------- T6: a gap must be reported, not hidden behind the range ----------
  console.log('T6  a missing pili is not swallowed by the range');
  // A01-A10 with A05 removed: the range still reads A01 – A10 but there are 9.
  const gapped = [...zone('A',1,4), ...zone('A',6,10), ...zone('B',1,3)];
  p = await boot(b, gapped);
  await toDash(p);
  check('range still spans the gap', (await rows(p))[0].range, 'A01 – A10');
  check('but the count is honest',   (await rows(p))[0].count, '9 pili');
  check('the row is flagged',        (await rows(p))[0].warn, true);
  check('and the caption says which zone', /Zon A/.test(await note(p)), true);
  check('the contiguous zone is not flagged', (await rows(p))[1].warn, false);
  await p.close();

  // ---------- T7: a new zone letter appears on its own ----------
  console.log('T7  a pili in a brand-new zone gets its own row');
  p = await boot(b, [...zone('A',1,3), ...zone('F',1,2)]);
  await toDash(p);
  check('zone F is listed', (await rows(p)).map(r=>r.z), ['A','F']);
  check('with its own range', (await rows(p))[1].range, 'F01 – F02');
  await p.close();

  // ---------- T8: a label that is not letter+number ----------
  console.log('T8  an odd label gets no row, but is not hidden');
  p = await boot(b, [...zone('A',1,3), hyd('PILI BARU'), hyd('123')]);
  await toDash(p);
  check('only real zones get rows', (await rows(p)).map(r=>r.z), ['A']);
  check('the caption reports the other two', /2 pili tidak mengikut format zon/.test(await note(p)), true);
  await p.close();

  // ---------- T9: no horizontal overflow on a phone ----------
  console.log('T9  360px — the panel must not push the page sideways');
  p = await boot(b, reg, {width:360,height:780});
  await toDash(p);
  check('page does not scroll sideways',
    await p.evaluate(()=>document.documentElement.scrollWidth<=360), true);
  check('the panel sits BELOW Pemeriksaan terkini on a phone', await p.evaluate(()=>{
    const rec=document.getElementById('dashRecent').closest('.dcard');
    const zon=document.getElementById('dashZones').closest('.dcard');
    return zon.getBoundingClientRect().top > rec.getBoundingClientRect().top; }), true);
  check('rows still correct at 360px', (await rows(p)).map(r=>r.z), ['A','B','C','D','E']);
  await p.close();

  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
