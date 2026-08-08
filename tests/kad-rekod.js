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
const done = (i, signed) => {
  const r = row(i, {tarikh:'2026-08-0'+((i%9)+1), penguji:'P'+i}, signed);
  if (signed) r.signature = '1/pengujian_'+i+'_1.png';
  return r;
};

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
                          createSignedUrls:(paths)=>Promise.resolve({
                            data:(paths||[]).map(pp=>({path:pp, signedUrl:window.__sigUrl||''})),
                            error:null})})},
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

  // ---------- T7: a signature must print BLACK, not grey ----------
  // Found on the first real printout (2026-08-07): signatures came out pale
  // against solid-black table rules. They are photographed, and
  // stripSignatureBg never produces black ink — measured, the darkest pixel of
  // a typical signature was luminance 137 and NOT ONE pixel fell below 128.
  // A backlit screen flatters that; paper does not.
  //
  // The fix is print-only and render-side, because signed rows are permanent:
  // the image can never be re-uploaded, so a capture-side change would not
  // help a single already-filed record. These assertions guard the OUTCOME
  // (ink actually goes black on paper) and that the screen is left alone.
  console.log('T7  the signature prints black, and the screen is untouched');
  p = await boot(b, [done(0, true)]);
  // a photographed signature as stripSignatureBg leaves it: grey-brown ink,
  // never black, with stroke mid-tones ramped to partial alpha
  // The fixture carries RESIDUE as well as ink. On a badly-lit photo
  // stripSignatureBg cannot key the paper out cleanly and leaves it at
  // low-but-non-zero alpha. A clean fixture cannot reproduce the black box
  // (§4.15) — the first version of this test used one, which is exactly why it
  // stayed green while a black box printed.
  await p.evaluate(() => {
    const W=600,H=180,c=document.createElement('canvas'); c.width=W; c.height=H;
    const x=c.getContext('2d');
    // leftover paper: faint, textured, covering the whole frame
    const im0=x.getImageData(0,0,W,H), d0=im0.data;
    for(let i=0;i<d0.length;i+=4){
      d0[i]=150; d0[i+1]=146; d0[i+2]=140;
      d0[i+3]=40+((Math.random()*40)|0);          // alpha ~40-80 of 255
    }
    x.putImageData(im0,0,0);
    x.lineCap='round'; x.lineJoin='round';
    x.strokeStyle='rgb(70,64,58)'; x.lineWidth=9;
    x.beginPath(); x.moveTo(40,140);
    x.bezierCurveTo(140,20,200,170,270,90);
    x.bezierCurveTo(330,20,360,160,430,80);
    x.bezierCurveTo(470,40,520,120,560,70); x.stroke();
    const im=x.getImageData(0,0,W,H), d=im.data;
    for(let i=0;i<d.length;i+=4) if(d[i+3]>128) d[i+3]=Math.round(d[i+3]*0.62);
    x.putImageData(im,0,0);
    window.__sigUrl = c.toDataURL('image/png');
  });
  await openCard(p);
  check('the signature image rendered',
    await p.evaluate(()=>!!document.querySelector('img.sigimg')), true);

  /* Measures whichever signature image is actually VISIBLE in this medium —
   * the original on screen, the pre-rendered copy in print. Also counts grey
   * pixels, which is the number that separates "black ink" from "black box".
   * Nothing here measured that before, so a solid black rectangle satisfied
   * every assertion. */
  const inkOf = async (media) => {
    await p.emulateMedia({ media });
    await p.waitForTimeout(300);
    const sel = await p.evaluate(() => {
      const pr = document.querySelector('img.sigprint');
      if (pr && getComputedStyle(pr).display !== 'none') return 'img.sigprint';
      return 'img.sigimg';
    });
    const buf = await p.locator(sel).first().screenshot();
    const r = await p.evaluate(async b64 => {
      const img=new Image();
      await new Promise(r=>{ img.onload=r; img.src='data:image/png;base64,'+b64; });
      const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
      const x=c.getContext('2d');
      x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);   // paper behind it
      x.drawImage(img,0,0);
      const d=x.getImageData(0,0,c.width,c.height).data;
      let darkest=255, darkPx=0, greyPx=0, n=0;
      for(let i=0;i<d.length;i+=4){
        const L=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000;
        n++;
        if(L<darkest) darkest=L;
        if(L<128) darkPx++;
        else if(L<235) greyPx++;      // neither ink nor paper => residue
      }
      /* darkPct is the assertion that actually catches a black box, and it was
       * missing. greyPct alone does NOT: when the residue is blackened rather
       * than removed there is no grey left at all, so a grey-based check passes
       * on the very defect it was written for. Verified against the pre-fix
       * code — box: darkPct ~100, greyPct 0. */
      return { darkest:Math.round(darkest), darkPx,
               darkPct:+(darkPx/n*100).toFixed(1), greyPct:+(greyPx/n*100).toFixed(1) };
    }, buf.toString('base64'));
    r.via = sel;
    return r;
  };

  const scr = await inkOf('screen');
  const prn = await inkOf('print');
  // Pre-fix this was darkest=134, darkPx=0 — not one pixel below mid-grey.
  // Absolute pixel counts depend on the device scale factor, so assert the
  // shape of the result rather than a number tuned to this viewport.
  console.log('        screen', JSON.stringify(scr), ' print', JSON.stringify(prn));
  check('in print the ink reaches black',   prn.darkest < 40, true);
  check('in print there is solid dark ink', prn.darkPx > 0, true);
  /* This used to assert print carried >= 2x the dark pixels of screen. That
   * encoded the OLD mechanism — stacked drop-shadows amplifying alpha — and a
   * black box satisfies it beautifully. The new mechanism deliberately does not
   * inflate anything: it reproduces exactly the ink and drops the rest, so
   * keeping that assertion would force amplification, and the box, back.
   *
   * What actually separates a good print from the two failures: the ink reaches
   * black (above) and the residue is GONE. The source image here is mostly
   * residue, so screen is full of grey and print must not be. */
  check('the residue in the source is removed for print, not blackened',
        prn.greyPct * 5 < scr.greyPct, true);

  /* \u00a74.15 \u2014 the black box. The previous fix amplified alpha, which made the
   * ink solid AND blackened the leftover paper. Nothing measured that, so it
   * shipped. Grey is the tell: real ink is black and real paper is white, so a
   * healthy print has almost nothing in between. */
  /* THE assertion for \u00a74.15. A signature is strokes on paper: mostly white,
   * with a few percent of black. A black box is ~100% dark. Measured on the
   * pre-fix code this was 100; with the fix it is a few percent. */
  check('print is a signature, NOT a black box', prn.darkPct < 40, true);
  check('the print copy is what gets printed', prn.via, 'img.sigprint');

  await p.emulateMedia({ media:'screen' }); await p.waitForTimeout(150);
  check('no filter on screen \u2014 the officers\' view is unchanged',
    await p.evaluate(()=>getComputedStyle(document.querySelector('img.sigimg')).filter), 'none');
  check('the print copy is hidden on screen', await p.evaluate(()=>{
    const n=document.querySelector('img.sigprint');
    return n ? getComputedStyle(n).display : 'MISSING';
  }), 'none');
  check('the original is what officers see', scr.via, 'img.sigimg');

  await p.emulateMedia({ media:'print' }); await p.waitForTimeout(150);
  // The original is swapped out in print rather than filtered \u2014 measured:
  // neither a CSS nor an SVG filter survives PDF generation.
  check('the original is hidden in print', await p.evaluate(()=>
    getComputedStyle(document.querySelector('img.sigimg')).display), 'none');
  check('the print copy carries no filter of its own', await p.evaluate(()=>{
    const n=document.querySelector('img.sigprint');
    return n ? getComputedStyle(n).filter : 'MISSING';
  }), 'none');
  // .sigimg max-height was set in TWO @media print blocks at the same
  // specificity, so the later silently won and the mm-tuned value was dead.
  check('exactly one print height applies', await p.evaluate(()=>{
    const n=document.querySelector('img.sigprint');
    return n ? getComputedStyle(n).maxHeight : 'MISSING';
  }), '30px');
  await p.emulateMedia({ media:'screen' });
  await p.close();

  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
