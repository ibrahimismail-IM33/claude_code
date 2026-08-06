/* Guards the bound on cloudLoad.
 *
 * PostgREST caps a response at 1000 rows and returns no error when it does.
 * cloudLoad used to ask for every hydrant in one unbounded request, so a
 * register past 1000 would have loaded the first 1000 and silently dropped the
 * rest — hydrants missing from the map, missing from search, and counted
 * nowhere, with nothing on screen to say so. The same failure mode as the
 * dashboard scan bug, which would have reported 120 hydrants as never
 * inspected.
 *
 * Latent at Kunak's 188. Certain at roughly five districts.
 *
 * Run:  node tests/hydrant-paging.js       (needs playwright + chromium)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'epb-page-'));
const APP  = path.join(TMP, 'app.html');
fs.writeFileSync(APP, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace('function isAdmin(){ return IS_ADMIN === true; }', 'function isAdmin(){ return true; }'));
const URL = 'file://' + APP;
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let pass=0, fail=0;
const check=(name,got,want)=>{ const ok=JSON.stringify(got)===JSON.stringify(want);
  console.log((ok?'  PASS  ':'  FAIL  ')+name+'  got='+JSON.stringify(got)+(ok?'':'  want='+JSON.stringify(want)));
  ok?pass++:fail++; };

async function boot(b, total){
  const p = await b.newPage({ viewport:{width:1280,height:950} });
  p.on('pageerror',e=>{ console.log('  PAGEERROR', e.message); fail++; });
  await p.addInitScript(() => {
    const noop=()=>{};
    const layer=()=>({_l:[],addTo(){return this;},clearLayers(){this._l=[];window.__markers=[];},addLayer(m){this._l.push(m);window.__markers.push(m);}});
    window.__markers=[];
    window.L={map:()=>({on:noop,invalidateSize:noop,fitBounds:noop,setView:noop}),
      control:{zoom:()=>({addTo:noop})}, tileLayer:()=>({addTo:noop}),
      layerGroup:layer, markerClusterGroup:layer, divIcon:o=>o, latLngBounds:a=>a,
      marker:(ll,o)=>({_ll:ll,bindTooltip(){return this;},on(){return this;}})};
  });
  await p.addInitScript(n => {
    // n hydrants on the "server" — more than one PostgREST page
    window.__hyd=[];
    for(let i=1;i<=n;i++) window.__hyd.push({id:i,label:'A'+i,lat:4.68+i/100000,lng:118.24+i/100000,
      status: i%10===0 ? 'swasta':'kerajaan', location:'Lokasi '+i, last_inspected:null});
    window.__ranges=[];              // every range() the app asked for
    window.__offline=false;

    const q=(rows)=>{
      const f={};
      const r=Promise.resolve().then(()=>{
        if(window.__offline) return {data:null,error:{message:'network'}};
        // PostgREST truncates at 1000 rows and reports NO error. An unranged
        // request therefore silently loses everything past the first page —
        // reproduce that here, or the test cannot show the bug it guards.
        if(f.from===undefined) return {data:rows.slice(0,1000), error:null};
        window.__ranges.push([f.from,f.to]);
        return {data: rows.slice(f.from, Math.min(f.to+1, f.from+1000)), error:null};
      });
      r.eq=()=>r; r.gte=()=>r; r.lte=()=>r; r.order=()=>r;
      r.limit=(k)=>{ return Promise.resolve({data:rows.slice(0,k), error:null}); };
      r.range=(a,bb)=>{ f.from=a; f.to=bb; return r; };
      return r;
    };
    // cloudLoad only runs from enterApp(), which only runs when getSession()
    // returns a real session. A null session means the app sits on the login
    // gate and never loads anything — which is exactly what made the first
    // version of this test assert against an app that had done nothing.
    const USER={id:'11111111-1111-1111-1111-111111111111', email:'admin@bomba.gov.my'};
    const profileQ=()=>{ const r=Promise.resolve({data:{role:'admin'},error:null});
      r.eq=()=>r; r.single=()=>Promise.resolve({data:{role:'admin'},error:null}); return r; };

    window.supabase={createClient:()=>({
      auth:{getUser:()=>Promise.resolve({data:{user:USER}}),
            getSession:()=>Promise.resolve({data:{session:{user:USER}}}),
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
      storage:{from:()=>({upload:()=>Promise.resolve({error:null}),getPublicUrl:()=>({data:{publicUrl:''}}),
                          createSignedUrls:()=>Promise.resolve({data:[],error:null})})},
      from:(t)=>({
        select:()=> t==='profiles' ? profileQ() : q(t==='hydrants'?window.__hyd:[]),
        upsert:()=>Promise.resolve({error:null}), insert:()=>Promise.resolve({error:null}),
        update:()=>({eq:()=>Promise.resolve({error:null})}),
        delete:()=>({eq:()=>Promise.resolve({error:null})})})})};
  }, total);
  await p.goto(URL); await p.waitForTimeout(2500);
  await p.evaluate(()=>document.getElementById('authGate').classList.add('hide'));
  return p;
}
const stored = p => p.evaluate(()=>{ const v=localStorage.getItem('bbpkunak_hydrants_v2');
                                     return v?JSON.parse(v).length:0; });

(async () => {
  const b = await chromium.launch({ executablePath: CHROMIUM });

  // ---------- T1: past the cap, every hydrant must still arrive ----------
  console.log('T1  2400 hydrants over 3 pages');
  let p = await boot(b, 2400);
  check('every hydrant loaded', await stored(p), 2400);
  check('asked for exactly 3 pages', await p.evaluate(()=>window.__ranges), [[0,999],[1000,1999],[2000,2999]]);
  check('no id lost or duplicated', await p.evaluate(()=>{
    const a=JSON.parse(localStorage.getItem('bbpkunak_hydrants_v2')).map(h=>h.id);
    return a.length===new Set(a).size && a[0]===1 && a[a.length-1]===2400; }), true);
  await p.close();

  // ---------- T2: exactly on the boundary ----------
  // 1000 rows come back full, so the app must ask again to learn there is no
  // more. Getting this wrong is an infinite loop or a lost final page.
  console.log('T2  exactly 1000 hydrants');
  p = await boot(b, 1000);
  check('all 1000 loaded',        await stored(p), 1000);
  check('asked for 2 pages',      await p.evaluate(()=>window.__ranges.length), 2);
  await p.close();

  // ---------- T3: Kunak-sized, still one request ----------
  console.log('T3  188 hydrants — unchanged behaviour today');
  p = await boot(b, 188);
  check('all 188 loaded',    await stored(p), 188);
  check('one request only',  await p.evaluate(()=>window.__ranges), [[0,999]]);
  await p.close();

  // ---------- T4: a failed page must not replace good local data ----------
  console.log('T4  a broken read keeps the local copy');
  p = await boot(b, 188);
  await p.evaluate(()=>{ localStorage.setItem('bbpkunak_hydrants_v2',
      JSON.stringify([{id:1,label:'LOCAL',lat:4.6,lng:118.2,status:'kerajaan',location:'Cache',lastInspected:''}]));
      window.__offline=true; window.__ranges=[]; });
  await p.evaluate(()=>{ window.dispatchEvent(new Event('focus')); });
  await p.waitForTimeout(1200);
  check('local copy untouched', await p.evaluate(()=>{
    const a=JSON.parse(localStorage.getItem('bbpkunak_hydrants_v2')); return a.length===1 && a[0].label==='LOCAL'; }), true);
  await p.close();

  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})();
