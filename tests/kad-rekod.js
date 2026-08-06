/* The Kad Rekod Pili Bomba is a MANDATORY record under MS ISO — see
 * docs/KAD-REKOD.md. This suite guards the rules that are easy to break by
 * accident and expensive to break in the field.
 *
 * 1. A card is exactly 2 pages, and the two pages of one card always stay
 *    together and in order.
 * 2. On SCREEN the newest card is on top, because it is the only one anyone
 *    writes on. In PRINT the order is reversed back to oldest-first, because a
 *    filed paper record reads forward in time. That split is done with
 *    flex-direction on .fsheet while the DOM stays chronological — reverse the
 *    render loop instead and the paper comes out backwards, which is invisible
 *    on screen and would only be found by whoever files the card.
 * 3. Card numbers are permanent and chronological: the oldest is always Kad 1.
 *    A signed, filed card must never be renumbered by the arrival of a new one.
 * 4. A new card appears when the last row of any section is COMPLETE AND
 *    SAVED — not on the first keystroke, and it must still happen offline.
 *
 * Run:  node tests/kad-rekod.js       (needs playwright + chromium)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'epb-kad-'));
const APP  = path.join(TMP, 'app.html');
fs.writeFileSync(APP, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('function isAdmin(){ return IS_ADMIN === true; }', 'function isAdmin(){ return true; }'));
const URL = 'file://' + APP;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let pass=0, fail=0;
const check=(name,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want);
  console.log((ok?'  PASS  ':'  FAIL  ')+name+'  got='+JSON.stringify(got)+(ok?'':'  want='+JSON.stringify(want)));
  ok?pass++:fail++; };

const PENG_PER = 15;      // rows per card in the Pengujian section
const row = (i, data, signed) => ({hydrant_id:1, section:'pengujian', row_index:i,
  data:Object.assign({tarikh:'',penguji:'',statik:'',semasa:'',gpm:'',catatan:'',tt:''}, data),
  signed:!!signed});
// A complete row: Tarikh plus at least one other field.
const done = (i, signed) => row(i, {tarikh:'2026-08-0'+((i%9)+1), penguji:'P'+i}, signed);

async function boot(b, seedRecs){
  const p = await b.newPage({ viewport:{width:1280,height:950} });
  p.on('pageerror',e=>{ console.log('  PAGEERROR', e.message); fail++; });
  await p.addInitScript(() => {
    const noop=()=>{};
    const layer=()=>({_l:[],addTo(){return this;},clearLayers(){this._l=[];window.__markers=[];},addLayer(m){this._l.push(m);window.__markers.push(m);}});
    window.__markers=[];
    window.L={map:()=>({on:noop,invalidateSize:noop,fitBounds:noop,setView:noop}),
      control:{zoom:()=>({addTo:noop})}, tileLayer:()=>({addTo:noop}),
      layerGroup:layer, markerClusterGroup:layer, divIcon:o=>o, latLngBounds:a=>a,
      marker:(ll,o)=>{const m={_ll:ll,bindTooltip(){return m;},on(e,fn){if(e==='click')m._click=fn;return m;}};return m;}};
    window.__clickMarker=i=>window.__markers[i]._click();
  });
  await p.addInitScript(seed => {
    localStorage.setItem('bbpkunak_hydrants_v2', JSON.stringify([{id:1,label:'A01',
      lat:4.6853,lng:118.2457,status:'kerajaan',location:'Balai Bomba Kunak',lastInspected:''}]));
    window.__hyd=[{id:1,label:'A01',lat:4.6853,lng:118.2457,status:'kerajaan',location:'Balai Bomba Kunak',last_inspected:''}];
    window.__recs=seed;
    window.__offline=false;

    const q=d=>{const r=Promise.resolve({data:d,error:null});
      r.eq=()=>r;r.gte=()=>r;r.lte=()=>r;r.order=()=>r;r.range=()=>r;r.limit=()=>r;return r;};
    const qerr=()=>{const r=Promise.resolve({data:null,error:{message:'network'}});
      r.eq=()=>r;r.gte=()=>r;r.lte=()=>r;r.order=()=>r;r.range=()=>r;r.limit=()=>r;return r;};
    const delQ=()=>{const r=Promise.resolve({error:window.__offline?{message:'network'}:null});
      r.eq=()=>r; return r;};

    window.supabase={createClient:()=>({
      auth:{getUser:()=>Promise.resolve({data:{user:null}}),getSession:()=>Promise.resolve({data:{session:null}}),
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
      storage:{from:()=>({upload:()=>Promise.resolve({error:null}),getPublicUrl:()=>({data:{publicUrl:''}}),
                          createSignedUrls:()=>Promise.resolve({data:[],error:null})})},
      from:(t)=>({
        select:()=> window.__offline ? qerr()
          : q(t==='hydrants'?window.__hyd.slice():t==='hydrant_records'?JSON.parse(JSON.stringify(window.__recs)):[]),
        upsert:(rows)=>{
          if(window.__offline) return Promise.resolve({error:{message:'network'}});
          if(t==='hydrant_records'){ [].concat(rows).forEach(r=>{
            const i=window.__recs.findIndex(x=>x.section===r.section&&x.row_index===r.row_index);
            if(i>=0) window.__recs[i]=Object.assign({},window.__recs[i],r);
            else window.__recs.push(Object.assign({signed:false},r)); }); }
          return Promise.resolve({error:null}); },
        insert:()=>Promise.resolve({error:null}),
        update:()=>({eq:()=>Promise.resolve({error:null})}),
        delete:()=>delQ()})})};
  }, seedRecs);
  await p.goto(URL); await p.waitForTimeout(1500);
  await p.evaluate(()=>document.getElementById('authGate').classList.add('hide'));
  return p;
}

const cell = (k,i) => `input.fin[data-sec="pengujian"][data-row="${i}"][data-k="${k}"]`;
const openCard = async p => { await p.evaluate(()=>window.__clickMarker(0)); await p.waitForTimeout(300);
                              await p.click('#dOpenForm'); await p.waitForTimeout(1400); };
const save = async p => { await p.click('#fSave'); await p.waitForTimeout(900); };
const cards = p => p.evaluate(()=>document.querySelectorAll('.fcard').length);
const pages = p => p.evaluate(()=>document.querySelectorAll('.fpage').length);
// Card labels in DOM order — which is always chronological.
const labels = p => p.evaluate(()=>[...document.querySelectorAll('.fcard')]
  .map(c=>{const k=c.querySelector('.kadno'); return k?k.textContent.trim():null;}));
// Vertical position of each card as actually laid out, in DOM order.
const tops = p => p.evaluate(()=>[...document.querySelectorAll('.fcard')]
  .map(c=>Math.round(c.getBoundingClientRect().top)));

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM });

  // ---------- T1: two cards, ordering, numbering ----------
  console.log('T1  a full Pengujian column gives a second card');
  const full = []; for(let i=0;i<PENG_PER;i++) full.push(done(i));
  let p = await boot(b, full);
  await openCard(p);

  check('two cards',            await cards(p), 2);
  check('four pages',           await pages(p), 4);
  check('two pages per card',   await p.evaluate(()=>[...document.querySelectorAll('.fcard')]
                                       .map(c=>c.querySelectorAll('.fpage').length)), [2,2]);
  // Page 1 of a card carries Kerosakan+Pemantauan, page 2 Pengujian+Kompaun.
  // If a flex change ever reorders pages inside a card this goes red.
  check('pages in order within each card', await p.evaluate(()=>[...document.querySelectorAll('.fcard')]
    .every(c=>{ const pg=c.querySelectorAll('.fpage');
      return !!pg[0].querySelector('table.ftab.kerosakan') && !!pg[1].querySelector('table.ftab.pengujian'); })), true);

  check('numbers are chronological in the DOM', await labels(p), ['Kad 1/2','Kad 2/2']);
  check('TERKINI marks the newest card only', await p.evaluate(()=>[...document.querySelectorAll('.fcard')]
    .map(c=>!!c.querySelector('.terkini'))), [false,true]);

  let t = await tops(p);
  check('on screen the newest card is above the oldest', t[1] < t[0], true);

  // ---------- T2: print puts it back in chronological order ----------
  // This is the assertion most likely to be wrong and is invisible on screen.
  console.log('T2  print order is oldest-first');
  await p.emulateMedia({ media:'print' });
  await p.waitForTimeout(200);
  t = await tops(p);
  check('in print Kad 1 comes before Kad 2', t[0] < t[1], true);
  check('TERKINI is not printed', await p.evaluate(()=>
    getComputedStyle(document.querySelector('.terkini')).display), 'none');
  check('the card number IS printed', await p.evaluate(()=>
    getComputedStyle(document.querySelector('.kadno')).display !== 'none'), true);
  await p.emulateMedia({ media:'screen' });
  await p.close();

  // ---------- T3: three cards — odd counts are where flex goes wrong ----------
  console.log('T3  three cards keep the same rules');
  const two = []; for(let i=0;i<PENG_PER*2;i++) two.push(done(i));
  p = await boot(b, two);
  await openCard(p);
  check('three cards',                 await cards(p), 3);
  check('six pages',                   await pages(p), 6);
  check('numbers 1..3 chronological',  await labels(p), ['Kad 1/3','Kad 2/3','Kad 3/3']);
  t = await tops(p);
  check('screen order is newest to oldest', t[2] < t[1] && t[1] < t[0], true);
  await p.emulateMedia({ media:'print' });
  await p.waitForTimeout(200);
  t = await tops(p);
  check('print order is oldest to newest', t[0] < t[1] && t[1] < t[2], true);
  await p.emulateMedia({ media:'screen' });
  await p.close();

  // ---------- T4: growth needs a COMPLETE row, and a save ----------
  console.log('T4  a stray keystroke does not create a card');
  const almost = []; for(let i=0;i<PENG_PER-1;i++) almost.push(done(i));
  p = await boot(b, almost);
  await openCard(p);
  check('one card to begin with', await cards(p), 1);

  const last = PENG_PER-1;
  await p.fill(cell('penguji',last), 'X');
  await p.waitForTimeout(300);
  check('one field typed, still one card', await cards(p), 1);

  await p.fill(cell('tarikh',last), '2026-08-05');
  await p.waitForTimeout(300);
  check('row complete but unsaved, still one card', await cards(p), 1);

  await save(p);
  check('saved, now two cards', await cards(p), 2);
  check('the new card is on top', await p.evaluate(()=>{
    const c=[...document.querySelectorAll('.fcard')];
    return c[1].getBoundingClientRect().top < c[0].getBoundingClientRect().top; }), true);
  check('the completed row survived the re-render',
    await p.evaluate(s=>document.querySelector(s).value, cell('penguji',last)), 'X');
  await p.close();

  // ---------- T5: offline officers still get a new card ----------
  console.log('T5  the new card appears with no signal');
  p = await boot(b, almost);
  await openCard(p);
  await p.evaluate(()=>{ window.__offline=true; });
  await p.fill(cell('tarikh',last), '2026-08-05');
  await p.fill(cell('penguji',last), 'LUAR TALIAN');
  await save(p);
  check('offline save still grows the card', await cards(p), 2);
  check('the typing is still on screen',
    await p.evaluate(s=>document.querySelector(s).value, cell('penguji',last)), 'LUAR TALIAN');
  await p.close();

  // ---------- T6: a signed row in an older card stays locked ----------
  console.log('T6  growing the card does not unlock a signed row');
  const signed = []; for(let i=0;i<PENG_PER;i++) signed.push(done(i, i===0));
  p = await boot(b, signed);
  await openCard(p);
  check('two cards', await cards(p), 2);
  check('the signed row is still marked', await p.evaluate(()=>
    document.querySelectorAll('table.ftab.pengujian tr.rowsigned').length), 1);
  check('its inputs are still disabled', await p.evaluate(()=>
    [...document.querySelectorAll('tr.rowsigned input.fin')].every(i=>i.disabled||i.readOnly)), true);
  check('the signed row is in Kad 1, not the new one', await p.evaluate(()=>{
    const c=[...document.querySelectorAll('.fcard')];
    return !!c[0].querySelector('tr.rowsigned') && !c[1].querySelector('tr.rowsigned'); }), true);
  await p.close();

  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
