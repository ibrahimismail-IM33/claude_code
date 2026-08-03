/* Guards the signature-link change (2026-08-03).
 *
 * Signature images were served from a public bucket: anyone with the URL
 * could fetch an officer's signature without logging in. The card now asks
 * for a short-lived signed link when it opens.
 *
 * The two cases that make this safe to deploy against a live system are T3
 * and T4: if signing is unavailable — because the bucket is still public,
 * or the device is offline — the card falls back to the stored value and
 * the officer sees the signature exactly as before. There is no moment
 * where a signature fails to display.
 *
 * Run:  node tests/signature-links.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'epb-sig-'));
const APP  = path.join(TMP, 'app.html');
fs.writeFileSync(APP, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('function isAdmin(){ return IS_ADMIN === true; }', 'function isAdmin(){ return true; }'));
const URL = 'file://' + APP;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let pass=0,fail=0;
const check=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  console.log((ok?'  PASS  ':'  FAIL  ')+n+'  got='+JSON.stringify(g)+(ok?'':'  want='+JSON.stringify(w)));ok?pass++:fail++;};

async function boot(b, recs, mode){
  const p = await b.newPage({viewport:{width:1280,height:950}});
  p.on('pageerror',e=>{console.log('  PAGEERROR',e.message);fail++;});
  await p.addInitScript(()=>{const noop=()=>{};
    const layer=()=>({_l:[],addTo(){return this;},clearLayers(){this._l=[];window.__markers=[];},addLayer(m){this._l.push(m);window.__markers.push(m);}});
    window.__markers=[];
    window.L={map:()=>({on:noop,invalidateSize:noop,fitBounds:noop,setView:noop}),control:{zoom:()=>({addTo:noop})},
      tileLayer:()=>({addTo:noop}),layerGroup:layer,markerClusterGroup:layer,divIcon:o=>o,latLngBounds:a=>a,
      marker:(ll,o)=>{const m={_ll:ll,bindTooltip(){return m;},on(e,fn){if(e==='click')m._click=fn;return m;}};return m;}};
    window.__clickMarker=i=>window.__markers[i]._click();});
  await p.addInitScript(([recs,mode])=>{
    window.__hyd=[{id:1,label:'A01',lat:4.68,lng:118.24,status:'kerajaan',location:'Balai',last_inspected:null}];
    window.__recs=recs; window.__mode=mode; window.__signedCalls=[];
    const q=d=>{const r=Promise.resolve({data:d,error:null});r.eq=()=>r;r.gte=()=>r;r.lte=()=>r;r.order=()=>r;r.range=()=>r;r.limit=()=>r;return r;};
    window.supabase={createClient:()=>({
      auth:{getUser:()=>Promise.resolve({data:{user:null}}),getSession:()=>Promise.resolve({data:{session:null}}),
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
      storage:{from:()=>({
        upload:(pth)=>{window.__uploaded=pth;return Promise.resolve({error:null});},
        getPublicUrl:(pth)=>({data:{publicUrl:'https://proj.supabase.co/storage/v1/object/public/signatures/'+pth}}),
        createSignedUrls:(paths,ttl)=>{ window.__signedCalls.push({paths,ttl});
          if(window.__mode==='fail') return Promise.resolve({data:null,error:{message:'nope'}});
          if(window.__mode==='throw') return Promise.reject(new Error('offline'));
          return Promise.resolve({data:paths.map(x=>({path:x,signedUrl:'https://proj.supabase.co/storage/v1/object/sign/signatures/'+x+'?token=TOK'}))}); }
      })},
      from:t=>({select:()=>q(t==='hydrants'?window.__hyd.slice():t==='hydrant_records'?JSON.parse(JSON.stringify(window.__recs)):[]),
        upsert:(rows)=>{[].concat(rows).forEach(r=>{if(r.section){const i=window.__recs.findIndex(x=>x.section===r.section&&x.row_index===r.row_index);
            if(i>=0)window.__recs[i]=Object.assign({},window.__recs[i],r);else window.__recs.push(r);}});return Promise.resolve({error:null});},
        insert:()=>Promise.resolve({error:null}),update:()=>({eq:()=>Promise.resolve({error:null})}),
        delete:()=>({eq:()=>Promise.resolve({error:null})})})})};
  },[recs,mode]);
  await p.goto(URL);
  await p.waitForTimeout(1500);
  await p.evaluate(()=>document.getElementById('authGate').classList.add('hide'));
  await p.evaluate(()=>window.__clickMarker(0)); await p.waitForTimeout(300);
  await p.click('#dOpenForm'); await p.waitForTimeout(1400);
  return p;
}
const imgSrc = p => p.evaluate(()=>{const i=document.querySelector('.ftab.pengujian img.sigimg');return i?i.getAttribute('src'):null;});
const LEGACY = [{hydrant_id:1,section:'pengujian',row_index:0,data:{tarikh:'2026-07-01',penguji:'Ali'},signed:true,
  signature:'https://proj.supabase.co/storage/v1/object/public/signatures/1/pengujian_0_123.png'}];
const NEWSTYLE = [{hydrant_id:1,section:'pengujian',row_index:0,data:{tarikh:'2026-07-01',penguji:'Ali'},signed:true,
  signature:'1/pengujian_0_456.png'}];

(async()=>{
  const b=await chromium.launch({executablePath: CHROMIUM});

  console.log('T1  legacy row (public URL already in the database)');
  let p=await boot(b,LEGACY,'ok');
  check('path extracted from old URL', await p.evaluate(()=>window.__signedCalls[0].paths), ['1/pengujian_0_123.png']);
  check('link expiry requested', await p.evaluate(()=>window.__signedCalls[0].ttl), 3600);
  check('renders the signed link', (await imgSrc(p)||'').indexOf('/object/sign/')>=0, true);
  await p.close();

  console.log('T2  row stored as a path');
  p=await boot(b,NEWSTYLE,'ok');
  check('path used as-is', await p.evaluate(()=>window.__signedCalls[0].paths), ['1/pengujian_0_456.png']);
  check('renders the signed link', (await imgSrc(p)||'').indexOf('/object/sign/')>=0, true);
  await p.close();

  console.log('T3  signing service returns an error (bucket still public)');
  p=await boot(b,LEGACY,'fail');
  check('falls back to stored URL', (await imgSrc(p)||'').indexOf('/object/public/')>=0, true);
  check('image still shown', !!(await imgSrc(p)), true);
  await p.close();

  console.log('T4  offline / request rejects');
  p=await boot(b,LEGACY,'throw');
  check('falls back, no broken image', (await imgSrc(p)||'').indexOf('/object/public/')>=0, true);
  await p.close();

  console.log('T5  a new signature stores the PATH, not a public URL');
  p=await boot(b,[],'ok');
  await p.evaluate(()=>{
    const b=document.querySelector('.ftab.pengujian .sigbtn'); b.click();
  });
  await p.waitForTimeout(400);
  await p.evaluate(()=>{
    const c=document.createElement('canvas'); c.width=10;c.height=10;
    const d=c.toDataURL('image/png');
    const inp=document.getElementById('sigFile');
    // drive the app's own resize->confirm path by faking the file input result
    const f=new File([Uint8Array.from(atob(d.split(',')[1]),ch=>ch.charCodeAt(0))],'s.png',{type:'image/png'});
    const dt=new DataTransfer(); dt.items.add(f); inp.files=dt.files;
    inp.dispatchEvent(new Event('change'));
  });
  await p.waitForTimeout(900);
  await p.evaluate(()=>document.getElementById('sigOk').click());
  await p.waitForTimeout(900);
  const stored = await p.evaluate(()=>{const r=window.__recs.find(x=>x.section==='pengujian'&&x.row_index===0);return r?r.signature:null;});
  check('stored value is a path', stored && stored.indexOf('http')<0 && stored.indexOf('/pengujian_0_')>0, true);
  check('not a public URL',       (stored||'').indexOf('/object/public/')>=0, false);
  await p.close();

  console.log('\n'+pass+' passed, '+fail+' failed');
  await b.close(); process.exit(fail?1:0);
})();
