/* Regression test for the P0 fixed on 2026-08-03.
 *
 * THE BUG: an officer filled a record card with no signal. The save failed
 * ("Local only"), the card sat in localStorage, and the next time that card
 * was opened with a working connection openForm rebuilt it from the cloud
 * and wrote that back over the cache. The typing was gone from the screen
 * AND from the device, and had never reached the server. Silent, permanent
 * loss of inspection data, in exactly the conditions the app is built for.
 *
 * Run:  node tests/p0-offline-sync.js       (needs playwright + chromium)
 *
 * It stands the app up in Chromium with a stub Supabase client and a stub
 * Leaflet (the real ones need network), drives the real UI, and asserts on
 * what actually reaches the "server".
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

// the controls under test are admin-only, so stand the app up as an admin
const ROOT = path.join(__dirname, '..');
const TMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'epb-test-'));
const APP  = path.join(TMP, 'app.html');
fs.writeFileSync(APP, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('function isAdmin(){ return IS_ADMIN === true; }', 'function isAdmin(){ return true; }'));
const URL = 'file://' + APP;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let pass=0, fail=0;
const check=(name,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want);
  console.log((ok?'  PASS  ':'  FAIL  ')+name+'  got='+JSON.stringify(got)+(ok?'':'  want='+JSON.stringify(want)));
  ok?pass++:fail++; };


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
    window.__hyd=[{id:1,label:'A01',lat:4.6853,lng:118.2457,status:'kerajaan',location:'Balai Bomba Kunak',last_inspected:null}];
    window.__recs=seed;
    window.__offline=false; window.__writes=0;
    const q=d=>{const r=Promise.resolve({data:d,error:null});r.eq=()=>r;r.gte=()=>r;r.lte=()=>r;r.order=()=>r;r.range=()=>r;r.limit=()=>r;return r;};
    const qerr=()=>{const r=Promise.resolve({data:null,error:{message:'network'}});r.eq=()=>r;r.gte=()=>r;r.lte=()=>r;r.order=()=>r;r.range=()=>r;r.limit=()=>r;return r;};
    window.supabase={createClient:()=>({
      auth:{getUser:()=>Promise.resolve({data:{user:null}}),getSession:()=>Promise.resolve({data:{session:null}}),
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
      storage:{from:()=>({upload:()=>Promise.resolve({error:null}),getPublicUrl:()=>({data:{publicUrl:''}})})},
      from:(t)=>({
        select:()=> window.__offline ? qerr() : q(t==='hydrants'?window.__hyd.slice():t==='hydrant_records'?JSON.parse(JSON.stringify(window.__recs)):[]),
        upsert:(rows)=>{ if(window.__offline) return Promise.resolve({error:{message:'network'}});
           if(t==='hydrant_records'){ window.__writes++; [].concat(rows).forEach(r=>{
              const i=window.__recs.findIndex(x=>x.section===r.section&&x.row_index===r.row_index);
              if(i>=0) window.__recs[i]=Object.assign({},window.__recs[i],r); else window.__recs.push(Object.assign({signed:false},r)); }); }
           return Promise.resolve({error:null}); },
        insert:()=>Promise.resolve({error:null}), update:()=>({eq:()=>Promise.resolve({error:null})}),
        delete:()=>({eq:()=>Promise.resolve({error:null})})})})};
  }, seedRecs);
  await p.goto(URL); await p.waitForTimeout(1500);
  await p.evaluate(()=>document.getElementById('authGate').classList.add('hide'));
  return p;
}
const CELL='.ftab.pengujian input.fin[data-row="0"]:not(.fin-date)';
const openCard = async p => { await p.evaluate(()=>window.__clickMarker(0)); await p.waitForTimeout(300);
                              await p.click('#dOpenForm'); await p.waitForTimeout(1200); };
const cloudVal = p => p.evaluate(()=>{ const r=window.__recs.find(x=>x.section==='pengujian'&&x.row_index===0);
                                       return r? (r.data.penguji||'') : null; });

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM });

  // ---------- T1: the original P0 ----------
  console.log('T1  offline edit survives and reaches the server');
  let p = await boot(b, []);
  await p.evaluate(()=>{ window.__offline=true; });
  await openCard(p);
  await p.fill(CELL,'DATA LAPANGAN');
  await p.click('#fSave'); await p.waitForTimeout(700);
  check('save reports local-only', await p.evaluate(()=>document.querySelector('#fSave').textContent), '⚠ Local only');
  check('parked in pending', await p.evaluate(()=>!!localStorage.getItem('bbpkunak_pending_1')), true);
  await p.evaluate(()=>document.querySelector('#fClose').click()); await p.waitForTimeout(400);
  await p.evaluate(()=>{ window.__offline=false; });          // signal returns
  await openCard(p);
  check('cell still on screen', await p.evaluate(s=>document.querySelector(s).value, CELL), 'DATA LAPANGAN');
  check('reached the cloud',    await cloudVal(p), 'DATA LAPANGAN');
  check('pending cleared',      await p.evaluate(()=>localStorage.getItem('bbpkunak_pending_1')), null);
  check('no warning banner',    await p.evaluate(()=>!!document.querySelector('#fPending')), false);
  await p.close();

  // ---------- T2: contested row -> cloud wins, officer warned ----------
  console.log('T2  office edited the same row meanwhile');
  p = await boot(b, [{hydrant_id:1,section:'pengujian',row_index:0,data:{tarikh:'',penguji:'ASAL',statik:'',semasa:'',gpm:'',catatan:'',tt:''},signed:false}]);
  await openCard(p);                                           // base = ASAL
  await p.evaluate(()=>{ window.__offline=true; });
  await p.fill(CELL,'TAIP DI LAPANGAN');
  await p.click('#fSave'); await p.waitForTimeout(700);
  await p.evaluate(()=>document.querySelector('#fClose').click()); await p.waitForTimeout(300);
  await p.evaluate(()=>{                                       // the office changes it
    window.__offline=false;
    window.__recs[0].data.penguji='DIUBAH DI PEJABAT'; });
  await openCard(p);
  check('cloud version shown',  await p.evaluate(s=>document.querySelector(s).value, CELL), 'DIUBAH DI PEJABAT');
  check('cloud not overwritten',await cloudVal(p), 'DIUBAH DI PEJABAT');
  check('officer is warned',    await p.evaluate(()=>!!document.querySelector('#fPending')), true);
  check('warning shows typing', await p.evaluate(()=>{ const e=document.querySelector('#fPending');
      return !!e && e.textContent.indexOf('TAIP DI LAPANGAN')>=0; }), true);
  await p.close();

  // ---------- T3: signed row is never overwritten ----------
  console.log('T3  row got signed elsewhere while offline');
  p = await boot(b, [{hydrant_id:1,section:'pengujian',row_index:0,data:{tarikh:'',penguji:'ASAL',statik:'',semasa:'',gpm:'',catatan:'',tt:''},signed:false}]);
  await openCard(p);
  await p.evaluate(()=>{ window.__offline=true; });
  await p.fill(CELL,'CUBA TIMPA');
  await p.click('#fSave'); await p.waitForTimeout(700);
  await p.evaluate(()=>document.querySelector('#fClose').click()); await p.waitForTimeout(300);
  await p.evaluate(()=>{ window.__offline=false; window.__recs[0].signed=true; });
  await openCard(p);
  check('signed row untouched', await cloudVal(p), 'ASAL');
  check('officer is warned',    await p.evaluate(()=>!!document.querySelector('#fPending')), true);
  await p.close();

  // ---------- T4: auto-push on reconnect, card closed ----------
  console.log('T4  phone put away, pushes itself when signal returns');
  p = await boot(b, []);
  await p.evaluate(()=>{ window.__offline=true; });
  await openCard(p);
  await p.fill(CELL,'AUTO PUSH');
  await p.click('#fSave'); await p.waitForTimeout(700);
  await p.evaluate(()=>document.querySelector('#fClose').click()); await p.waitForTimeout(400);
  check('pin shows the mark', await p.evaluate(()=>JSON.stringify(window.__markers[0]._icon.html).indexOf('hydrant-pending')>=0), true);
  await p.evaluate(()=>{ window.__offline=false; window.dispatchEvent(new Event('online')); });
  await p.waitForTimeout(1500);
  check('pushed without opening', await cloudVal(p), 'AUTO PUSH');
  check('pending cleared',        await p.evaluate(()=>localStorage.getItem('bbpkunak_pending_1')), null);
  check('pin mark gone',          await p.evaluate(()=>JSON.stringify(window.__markers[0]._icon.html).indexOf('hydrant-pending')>=0), false);
  await p.close();

  // ---------- T5: normal online save is unchanged ----------
  console.log('T5  ordinary online save still behaves');
  p = await boot(b, []);
  await openCard(p);
  await p.fill(CELL,'BIASA');
  await p.click('#fSave'); await p.waitForTimeout(700);
  check('save reports cloud', await p.evaluate(()=>document.querySelector('#fSave').textContent), 'Saved to cloud ✓');
  check('in the cloud',       await cloudVal(p), 'BIASA');
  check('nothing pending',    await p.evaluate(()=>localStorage.getItem('bbpkunak_pending_1')), null);
  check('no banner',          await p.evaluate(()=>!!document.querySelector('#fPending')), false);
  await p.close();

  console.log('\n'+pass+' passed, '+fail+' failed');
  await b.close();
  process.exit(fail?1:0);
})();
