/* Regression test for the bug found in the field on 2026-08-04.
 *
 * THE BUG: an officer records an inspection against the wrong hydrant, clears
 * the row and saves. Reopen the card and the data is back.
 *
 * cloudFormSave only ever sent rows that still had content, and an upsert
 * does not delete what it is not sent — so the row survived untouched in the
 * database. openForm then rebuilt the card from the cloud (working exactly as
 * designed) and restored it to the screen AND to localStorage. There was no
 * .delete() on hydrant_records anywhere in the app: clearing a row was not
 * merely broken, it had never been possible. On a Kad Rekod — a legal
 * inspection record — an entry that cannot be withdrawn is worse than one
 * that is missing.
 *
 * Run:  node tests/clear-row.js        (needs playwright + chromium)
 *
 * Same approach as p0-offline-sync.js: the real page in real Chromium with a
 * stub Supabase client, driving the actual UI and asserting on what reaches
 * the "server". This file carries its own stub because it needs a delete()
 * that records what was asked for — the P0 stub only had a token one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'epb-clear-'));
const APP  = path.join(TMP, 'app.html');
fs.writeFileSync(APP, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('function isAdmin(){ return IS_ADMIN === true; }', 'function isAdmin(){ return true; }'));
const URL = 'file://' + APP;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let pass=0, fail=0;
const check=(name,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want);
  console.log((ok?'  PASS  ':'  FAIL  ')+name+'  got='+JSON.stringify(got)+(ok?'':'  want='+JSON.stringify(want)));
  ok?pass++:fail++; };

const row = (i, data, signed) => ({hydrant_id:1, section:'pengujian', row_index:i,
  data:Object.assign({tarikh:'',penguji:'',statik:'',semasa:'',gpm:'',catatan:'',tt:''}, data),
  signed:!!signed});

async function boot(b, seedRecs){
  const p = await b.newPage({ viewport:{width:1280,height:950} });
  p.on('pageerror',e=>{ console.log('  PAGEERROR', e.message); fail++; });
  await p.addInitScript(() => {
    const noop=()=>{};
    const layer=()=>({_l:[],addTo(){return this;},clearLayers(){this._l=[];window.__markers=[];},addLayer(m){this._l.push(m);window.__markers.push(m);}});
    window.__markers=[];
    window.L={map:()=>({on:noop,invalidateSize:noop,fitBounds:noop,setView:noop}),
      control:{zoom:()=>({addTo:noop})}, tileLayer:()=>({addTo:noop}),
      layerGroup:layer, markerClusterGroup:layer,
      divIcon:o=>o, latLngBounds:a=>a,
      marker:(ll,o)=>{const m={_ll:ll,_icon:o&&o.icon,bindTooltip(t){m._tip=t;return m;},on(e,fn){if(e==='click')m._click=fn;return m;}};return m;}};
    window.__clickMarker=i=>window.__markers[i]._click();
  });
  await p.addInitScript(seed => {
    // Seed the hydrant cache directly. Without this the app falls back to its
    // built-in INITIAL_HYDRANTS, whose A01 carries no inspection date — so
    // syncLastInspected would see "" already and skip the write, and the pin
    // badge assertions would silently test nothing.
    localStorage.setItem('bbpkunak_hydrants_v2', JSON.stringify([{id:1,label:'A01',
      lat:4.6853,lng:118.2457,status:'kerajaan',location:'Balai Bomba Kunak',
      lastInspected:'2026-08-02'}]));
    window.__hyd=[{id:1,label:'A01',lat:4.6853,lng:118.2457,status:'kerajaan',location:'Balai Bomba Kunak',last_inspected:'2026-08-02'}];
    window.__recs=seed;
    window.__deletes=[];        // every delete the app asked for
    window.__hydWrites=[];      // every hydrants upsert (the pin's date badge)
    window.__offline=false; window.__upsertFail=false; window.__deleteFail=false;

    const q=d=>{const r=Promise.resolve({data:d,error:null});
      r.eq=()=>r;r.gte=()=>r;r.lte=()=>r;r.order=()=>r;r.range=()=>r;r.limit=()=>r;return r;};
    const qerr=()=>{const r=Promise.resolve({data:null,error:{message:'network'}});
      r.eq=()=>r;r.gte=()=>r;r.lte=()=>r;r.order=()=>r;r.range=()=>r;r.limit=()=>r;return r;};

    // A delete that remembers what it was filtered on, so the test can assert
    // the app targeted the right (hydrant_id, section, row_index).
    const delQ=(t)=>{
      const f={};
      const r=Promise.resolve().then(()=>{
        if(window.__offline||window.__deleteFail) return {error:{message:'network'}};
        if(t==='hydrant_records'){
          window.__deletes.push({hydrant_id:f.hydrant_id, section:f.section, row_index:f.row_index});
          const i=window.__recs.findIndex(x=>x.section===f.section&&x.row_index===f.row_index);
          if(i>=0) window.__recs.splice(i,1);
        }
        return {error:null};
      });
      r.eq=(k,v)=>{ f[k]=v; return r; };
      return r;
    };

    window.supabase={createClient:()=>({
      auth:{getUser:()=>Promise.resolve({data:{user:null}}),getSession:()=>Promise.resolve({data:{session:null}}),
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
      storage:{from:()=>({upload:()=>Promise.resolve({error:null}),getPublicUrl:()=>({data:{publicUrl:''}}),
                          createSignedUrls:()=>Promise.resolve({data:[],error:null})})},
      from:(t)=>({
        select:()=> window.__offline ? qerr()
          : q(t==='hydrants'?window.__hyd.slice():t==='hydrant_records'?JSON.parse(JSON.stringify(window.__recs)):[]),
        upsert:(rows)=>{
          if(window.__offline||window.__upsertFail) return Promise.resolve({error:{message:'network'}});
          if(t==='hydrants'){ [].concat(rows).forEach(r=>window.__hydWrites.push(r)); }
          if(t==='hydrant_records'){ [].concat(rows).forEach(r=>{
            const i=window.__recs.findIndex(x=>x.section===r.section&&x.row_index===r.row_index);
            if(i>=0) window.__recs[i]=Object.assign({},window.__recs[i],r);
            else window.__recs.push(Object.assign({signed:false},r)); }); }
          return Promise.resolve({error:null}); },
        insert:()=>Promise.resolve({error:null}),
        update:()=>({eq:()=>Promise.resolve({error:null})}),
        delete:()=>delQ(t)})})};
  }, seedRecs);
  await p.goto(URL); await p.waitForTimeout(1500);
  await p.evaluate(()=>document.getElementById('authGate').classList.add('hide'));
  return p;
}

const cell = (k,i) => `input.fin[data-sec="pengujian"][data-row="${i||0}"][data-k="${k}"]`;
const openCard = async p => { await p.evaluate(()=>window.__clickMarker(0)); await p.waitForTimeout(300);
                              await p.click('#dOpenForm'); await p.waitForTimeout(1200); };
const closeCard = async p => { await p.evaluate(()=>document.querySelector('#fClose').click()); await p.waitForTimeout(400); };
const save = async p => { await p.click('#fSave'); await p.waitForTimeout(900); };
const deletes = p => p.evaluate(()=>window.__deletes);
const cloudRow = (p,i) => p.evaluate(n=>{ const r=window.__recs.find(x=>x.section==='pengujian'&&x.row_index===n);
                                          return r? (r.data.penguji||'') : null; }, i||0);
const pending = p => p.evaluate(()=>{ const v=localStorage.getItem('bbpkunak_pending_1'); return v?JSON.parse(v):null; });

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM });

  // ---------- T1: the bug itself ----------
  console.log('T1  clearing a row online actually removes it');
  let p = await boot(b, [row(0,{tarikh:'2026-08-02',penguji:'SALAH HIDRAN'})]);
  await openCard(p);
  check('row loaded from cloud', await p.evaluate(s=>document.querySelector(s).value, cell('penguji')), 'SALAH HIDRAN');
  await p.fill(cell('penguji'),'');
  await p.fill(cell('tarikh'),'');
  await save(p);
  check('a delete was sent', await deletes(p), [{hydrant_id:1, section:'pengujian', row_index:0}]);
  check('row gone from the server', await cloudRow(p), null);
  await closeCard(p);
  await openCard(p);
  check('still empty after reopen', await p.evaluate(s=>document.querySelector(s).value, cell('penguji')), '');
  check('nothing left pending',     await pending(p), null);
  await p.close();

  // ---------- T2: signed rows are untouchable ----------
  console.log('T2  a signed row is never deleted');
  p = await boot(b, [row(0,{tarikh:'2026-08-02',penguji:'DITANDATANGAN'},true)]);
  await openCard(p);
  await save(p);
  check('no delete attempted', await deletes(p), []);
  check('signed row intact',   await cloudRow(p), 'DITANDATANGAN');
  await p.close();

  // ---------- T3: cleared with no signal, pushed on reconnect ----------
  console.log('T3  clearing offline survives and reaches the server');
  p = await boot(b, [row(0,{tarikh:'2026-08-02',penguji:'SALAH HIDRAN'})]);
  await openCard(p);                                    // base recorded from the cloud
  await p.evaluate(()=>{ window.__offline=true; });
  await p.fill(cell('penguji'),'');
  await p.fill(cell('tarikh'),'');
  await save(p);
  const park = await pending(p);
  check('parked as a removal', (park&&park.rows||[]).some(r=>r.removed&&r.section==='pengujian'&&r.row_index===0), true);
  check('nothing deleted yet', await deletes(p), []);
  // The banner is drawn when a card is opened, not on save; the immediate
  // feedback for an offline save is the button itself. T4 covers the banner.
  check('save reports local-only', await p.evaluate(()=>document.querySelector('#fSave').textContent), '⚠ Local only');
  await closeCard(p);
  await p.evaluate(()=>{ window.__offline=false; });     // signal returns
  await openCard(p);
  check('delete reached the server', await deletes(p), [{hydrant_id:1, section:'pengujian', row_index:0}]);
  check('row gone',                  await cloudRow(p), null);
  check('pending cleared',           await pending(p), null);
  await p.close();

  // ---------- T4: contested removal -> cloud wins, officer warned ----------
  console.log('T4  someone else edited the row before the clear synced');
  p = await boot(b, [row(0,{tarikh:'2026-08-02',penguji:'ASAL'})]);
  await openCard(p);
  await p.evaluate(()=>{ window.__offline=true; });
  await p.fill(cell('penguji'),'');
  await p.fill(cell('tarikh'),'');
  await save(p);
  await closeCard(p);
  await p.evaluate(()=>{ window.__offline=false;
                         window.__recs[0].data.penguji='DIUBAH DI PEJABAT'; });
  await openCard(p);
  check('no delete sent',        await deletes(p), []);
  check('cloud row survives',    await cloudRow(p), 'DIUBAH DI PEJABAT');
  check('cloud version on screen',await p.evaluate(s=>document.querySelector(s).value, cell('penguji')), 'DIUBAH DI PEJABAT');
  check('officer warned',        await p.evaluate(()=>!!document.querySelector('#fPending')), true);
  check('removal still parked',  await p.evaluate(()=>{ const v=JSON.parse(localStorage.getItem('bbpkunak_pending_1')||'null');
                                                        return !!(v&&v.rows.some(r=>r.removed)); }), true);
  await p.close();

  // ---------- T5: the map pin must not keep advertising a cleared date ----------
  console.log('T5  the pin date badge follows the rows that remain');
  p = await boot(b, [row(0,{tarikh:'2026-08-02',penguji:'A'}), row(1,{tarikh:'2026-07-01',penguji:'B'})]);
  await openCard(p);
  await p.fill(cell('penguji'),''); await p.fill(cell('tarikh'),'');     // clear the newer one
  await save(p);
  check('badge falls back to the older date',
        await p.evaluate(()=>{ const w=window.__hydWrites; return w.length?w[w.length-1].last_inspected:'(none)'; }), '2026-07-01');
  await p.fill(cell('penguji',1),''); await p.fill(cell('tarikh',1),''); // clear the last one too
  await save(p);
  check('badge cleared when none remain',
        await p.evaluate(()=>{ const w=window.__hydWrites; return w.length?w[w.length-1].last_inspected:'(none)'; }), null);
  await p.close();

  // ---------- T6: a flush that fails must change nothing ----------
  console.log('T6  a failed flush keeps the parked work');
  p = await boot(b, [row(0,{tarikh:'2026-08-02',penguji:'ASAL'})]);
  await openCard(p);
  await p.evaluate(()=>{ window.__offline=true; });
  await p.fill(cell('penguji'),'TAIP DI LAPANGAN');
  await save(p);
  check('parked', await p.evaluate(()=>!!localStorage.getItem('bbpkunak_pending_1')), true);
  await closeCard(p);
  // reads succeed, writes do not — a flaky connection, not a clean outage
  await p.evaluate(()=>{ window.__offline=false; window.__upsertFail=true; });
  await openCard(p);
  check('still parked after a failed flush',
        await p.evaluate(()=>{ const v=JSON.parse(localStorage.getItem('bbpkunak_pending_1')||'null');
                               return !!(v&&v.rows.some(r=>r.data&&r.data.penguji==='TAIP DI LAPANGAN')); }), true);
  await p.close();

  // ---------- T7: clearing ONLY the date, with the rest of the row intact ----------
  // The row still has content, so it is not a removal — it is an ordinary
  // update that happens to blank one cell. Worth its own scenario because a
  // date input is not a text input and is easy to miss when collecting.
  console.log('T7  clearing just the date leaves the row but drops the date');
  p = await boot(b, [row(0,{tarikh:'2026-08-02',penguji:'PEGAWAI A'})]);
  await openCard(p);
  await p.fill(cell('tarikh'),'');
  await save(p);
  check('date cleared on the server', await p.evaluate(()=>{
    const r=window.__recs.find(x=>x.section==='pengujian'&&x.row_index===0); return r? r.data.tarikh : '(row gone)'; }), '');
  check('rest of the row kept',       await cloudRow(p), 'PEGAWAI A');
  check('no delete sent',             await deletes(p), []);
  await closeCard(p);
  await openCard(p);
  check('date still empty after reopen', await p.evaluate(s=>document.querySelector(s).value, cell('tarikh')), '');
  check('pin badge cleared',          await p.evaluate(()=>{ const w=window.__hydWrites;
                                        return w.length?w[w.length-1].last_inspected:'(none)'; }), null);
  await p.close();

  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
