(function(){
"use strict";
/* ================= helpers ================= */
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const CT=window.COUNTRIES;
const AP={}; for(const a of window.AIRPORTS) AP[a[0]]={code:a[0],city:a[1],cc:a[2],lat:a[3],lon:a[4],tz:a[5]};
const numToCC={}; for(const cc in CT) numToCC[CT[cc].num]=cc;
const flag=cc=>cc&&/^[A-Z]{2}$/.test(cc)?String.fromCodePoint(...[...cc].map(c=>127397+c.charCodeAt(0))):"";
const K_KEY="abigya-key",K_TRIPS="abigya-trips",K_AP="abigya-airports";
const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch{return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}};
Object.assign(AP,ls.get(K_AP,{}));
let key=ls.get(K_KEY,""), trips=ls.get(K_TRIPS,[]);
let tab="up", selId=null, mapMode="routes", guideMode="hers", selCountry=null, world=null, confirmDel=null;

function toast(msg){const t=$("toast");t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,3200);}
function saveTrips(){ls.set(K_TRIPS,trips);}

/* ================= time ================= */
const dtfC={};
function dtf(tz){return dtfC[tz]||(dtfC[tz]=new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}));}
function tzOff(ms,tz){const p={};for(const x of dtf(tz).formatToParts(new Date(ms)))p[x.type]=x.value;return Math.round((Date.UTC(+p.year,p.month-1,+p.day,(+p.hour)%24,+p.minute,+p.second)-ms)/6e4)*6e4;}
function zoned(date,time,tz){const[y,m,d]=date.split("-").map(Number);const[h,mi]=time.split(":").map(Number);const g=Date.UTC(y,m-1,d,h,mi);if(!tz)return g;const o1=tzOff(g,tz);let u=g-o1;const o2=tzOff(u,tz);if(o2!==o1)u=g-o2;return u;}
const tzOf=code=>AP[code]?.tz||"UTC";
function fmtT(ms,tz){return new Intl.DateTimeFormat("en-GB",{timeZone:tz,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(ms);}
function fmtD(ms,tz){return new Intl.DateTimeFormat("en-GB",{timeZone:tz,weekday:"short",day:"numeric",month:"short"}).format(ms);}
function localDate(ms,tz){const p={};for(const x of dtf(tz||"UTC").formatToParts(new Date(ms)))p[x.type]=x.value;return p.year+"-"+p.month+"-"+p.day;}
function utcLabel(ms,tz){if(!tz||tz==="UTC")return "UTC";const o=tzOff(ms,tz)/36e5;const a=Math.abs(o);return "UTC"+(o>=0?"+":"−")+(Number.isInteger(a)?a:a.toFixed(1));}
function dur(ms){ms=Math.max(0,ms);const m=Math.round(ms/6e4);const d=Math.floor(m/1440),h=Math.floor(m%1440/60),mm=m%60;return (d?d+"d ":"")+(d||h?h+"h ":"")+mm+"m";}
function ago(ms){const m=Math.round((Date.now()-ms)/6e4);return m<1?"just now":m<60?m+" min ago":dur(Date.now()-ms)+" ago";}
function hav(a,b){if(!a||!b||a.lat==null||b.lat==null)return 0;const R=6371,t=x=>x*Math.PI/180;const dl=t(b.lat-a.lat),dn=t(b.lon-a.lon);const h=Math.sin(dl/2)**2+Math.cos(t(a.lat))*Math.cos(t(b.lat))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
const parseUtc=s=>{if(!s)return null;const v=Date.parse(String(s).replace(" ","T")+"Z");return isNaN(v)?null:v;};
const tsMs=(ts,utcStr)=>ts?ts*1000:parseUtc(utcStr);
const normFlight=s=>{const n=String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"");return /^\d+$/.test(n)?"ET"+n:n;};
const showFlight=s=>normFlight(s).replace(/^([A-Z0-9]{2})(\d)/,"$1 $2");
const apOf=v=>String(v||"").trim().slice(0,3).toUpperCase();
const cityOf=c=>AP[c]?.city||c;
const liveLinks=fl=>{const n=normFlight(fl),num=n.replace(/^ET/,"");return [
  ["FlightAware","https://www.flightaware.com/live/flight/ETH"+encodeURIComponent(num)],
  ["Flightradar24","https://www.flightradar24.com/data/flights/"+encodeURIComponent(n.toLowerCase())]];};

/* ================= API (AirLabs) ================= */
async function api(path,params){
  if(!key)throw new Error("Add your AirLabs key first (Settings).");
  if(key==="demo")return demoApi(path,params);
  const u=new URL("https://airlabs.co/api/v9/"+path);
  for(const k in params)u.searchParams.set(k,params[k]);
  u.searchParams.set("api_key",key);
  let r;
  try{r=await fetch(u.toString());}catch(e){throw new Error("Couldn't reach AirLabs. Check your internet connection.");}
  let j=null;try{j=await r.json();}catch{}
  if(j&&j.error){const m=j.error.message||j.error.code||"AirLabs error";
    if(/key/i.test(m)&&/(invalid|wrong|unknown)/i.test(m))throw new Error("AirLabs doesn't recognise that API key. Check it in Settings.");
    if(/limit/i.test(m))throw new Error("This month's free AirLabs lookups are used up.");
    throw new Error(m);}
  if(!r.ok)throw new Error("AirLabs answered with an error ("+r.status+").");
  return j?j.response:null;
}
async function ensureAirport(code){
  if(!code||AP[code])return AP[code];
  try{const r=await api("airports",{iata_code:code});const a=Array.isArray(r)?r[0]:r;
    if(a){AP[code]={code,city:a.city||a.name||code,cc:a.country_code||"",lat:a.lat,lon:a.lng,tz:a.timezone||null};const ex=ls.get(K_AP,{});ex[code]=AP[code];ls.set(K_AP,ex);}
  }catch{}
  return AP[code];
}
function tripFromFlight(f){
  const sd=tsMs(f.dep_time_ts,f.dep_time_utc), sa=tsMs(f.arr_time_ts,f.arr_time_utc);
  return {
    flight:normFlight(f.flight_iata||f.flight_icao||""),from:f.dep_iata,to:f.arr_iata,
    date:(f.dep_time||"").slice(0,10)||(sd?localDate(sd,tzOf(f.dep_iata)):""),
    schedDep:sd,schedArr:sa,
    estDep:tsMs(f.dep_estimated_ts,f.dep_estimated_utc),estArr:tsMs(f.arr_estimated_ts,f.arr_estimated_utc),
    actDep:tsMs(f.dep_actual_ts,f.dep_actual_utc),actArr:tsMs(f.arr_actual_ts,f.arr_actual_utc),
    status:f.status||null,delayMin:f.delayed||f.dep_delayed||f.arr_delayed||0,
    depTerm:f.dep_terminal||"",depGate:f.dep_gate||"",arrTerm:f.arr_terminal||"",arrGate:f.arr_gate||"",baggage:f.arr_baggage||"",
    lat:f.lat??null,lng:f.lng??null,dir:f.dir??null,alt:f.alt??null,posAt:f.updated?f.updated*1000:null,
    checkedAt:Date.now()
  };
}

/* ================= trip state ================= */
const bestDep=t=>t.actDep||t.estDep||t.schedDep;
const bestArr=t=>t.actArr||t.estArr||t.schedArr;
function status(t,now=Date.now()){
  if(t.status==="cancelled")return "cancelled";
  if(t.status==="diverted")return "diverted";
  const d=bestDep(t),a=bestArr(t);
  if(t.status==="landed"||t.actArr||(a&&now>=a))return "landed";
  if(t.status==="en-route"||t.status==="active"||t.actDep||(d&&now>=d))return "air";
  if((t.delayMin||0)>=15)return "delayed";
  return d&&d-now<864e5?"soon":"upcoming";
}
const SLABEL={air:"In the air",landed:"Landed",upcoming:"Scheduled",soon:"Departs soon",delayed:"Delayed",cancelled:"Cancelled",diverted:"Diverted"};
function all(){const now=Date.now();return trips.filter(t=>t.schedDep&&t.from&&t.to).map(t=>Object.assign({},t,{st:status(t,now)})).sort((a,b)=>bestDep(a)-bestDep(b));}
function upsertTrip(nt){
  // same flight on the same departure date = same trip
  const i=trips.findIndex(t=>t.flight===nt.flight&&t.from===nt.from&&t.date===nt.date);
  if(i>=0){trips[i]=Object.assign({},trips[i],nt);saveTrips();return trips[i];}
  nt.id="t"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);trips.push(nt);saveTrips();return nt;
}
async function refreshTrip(t,{quiet}={}){
  try{
    const f=await api("flight",{flight_iata:t.flight});
    if(!f||!f.dep_iata){if(!quiet)toast("AirLabs has no live data for "+showFlight(t.flight)+" right now.");t.checkedAt=Date.now();saveTrips();return false;}
    const nt=tripFromFlight(f);
    const same=nt.from===t.from&&nt.to===t.to&&Math.abs(Date.parse(nt.date)-Date.parse(t.date))<=864e5;
    if(!same){if(!quiet)toast("AirLabs is showing "+showFlight(t.flight)+" on "+(nt.date||"another day")+", not this trip yet.");t.checkedAt=Date.now();saveTrips();return false;}
    Object.assign(t,nt);saveTrips();if(!quiet)toast("Updated "+showFlight(t.flight));return true;
  }catch(e){if(!quiet)toast(e.message);return false;}
  finally{rerender();}
}

/* ================= clocks ================= */
function tickClocks(){
  const now=Date.now();$("clkMe").textContent=fmtT(now);$("clkAdd").textContent=fmtT(now,"Africa/Addis_Ababa");
  const list=all();let ap=null;
  if(!list.some(c=>c.st==="air")){const past=list.filter(c=>c.st==="landed");if(past.length)ap=AP[past[past.length-1].to];}
  if(ap&&ap.tz){$("clkHerBox").hidden=false;$("clkHerLbl").textContent="Abigya · "+ap.city;$("clkHer").textContent=fmtT(now,ap.tz);}else $("clkHerBox").hidden=true;
}

/* ================= hero ================= */
function pickHero(list){return list.find(c=>c.st==="air")||list.find(c=>["soon","upcoming","delayed"].includes(c.st))||list.filter(c=>c.st!=="cancelled").pop()||list[list.length-1]||null;}
function timeBox(label,code,sched,est,act){
  const tz=tzOf(code),best=act||est||sched,kind=act?"Actual":est?"Estimated":"Scheduled";
  const moved=best&&sched&&Math.abs(best-sched)>=5*6e4;
  return '<div class="tbox"><span class="eyebrow">'+label+' '+esc(code)+' · '+kind+'</span><span class="big">'+fmtT(best,tz)+(moved?'<s>'+fmtT(sched,tz)+'</s>':"")+'</span><span class="sub">'+fmtD(best,tz)+' · '+utcLabel(best,tz)+'</span><span class="sub">Your time '+fmtT(best)+', '+fmtD(best)+'</span></div>';
}
function renderHero(){
  const list=all(),c=pickHero(list),main=$("heroMain"),side=$("heroSide"),now=Date.now();
  if(!c){main.innerHTML='<div class="eyebrow">No trips yet</div><div class="count">Type her flight number below<small>For example ET 673. The app fetches the route, departure and landing times, and keeps them up to date.</small></div>';side.innerHTML="";return;}
  const F=AP[c.from]||{code:c.from,city:c.from},T=AP[c.to]||{code:c.to,city:c.to};
  const d=bestDep(c),a=bestArr(c);let count,sub,pct=null;
  if(c.st==="air"){pct=Math.min(1,Math.max(0,(now-d)/(a-d)));count="Lands in "+dur(a-now);sub="Touches down "+fmtT(a,tzOf(c.to))+" in "+T.city+" · "+fmtT(a)+" your time";}
  else if(c.st==="landed"){count="Landed "+dur(now-a)+" ago";sub="She's in "+T.city+(CT[T.cc]?", "+CT[T.cc].n:"")+(T.tz?". It's "+fmtT(now,T.tz)+" there now.":".");}
  else if(c.st==="cancelled"){count="Flight cancelled";sub="Check with her or the airline for the new flight.";}
  else{count="Departs in "+dur(d-now);sub="Takes off "+fmtT(d,tzOf(c.from))+" from "+F.city+" · "+fmtT(d)+" your time"+(c.delayMin>=15?" · delayed "+c.delayMin+" min":"");}
  main.innerHTML='<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="pill s-'+c.st+'">'+SLABEL[c.st]+'</span><span class="mono" style="font-weight:700">'+esc(showFlight(c.flight))+'</span><span class="note">'+esc(fmtD(d,tzOf(c.from)))+'</span></div>'+
   '<div class="route" style="margin-top:14px"><span class="code">'+esc(c.from)+'</span><span class="arrow"></span><span class="code">'+esc(c.to)+'</span></div>'+
   '<div class="cities"><span>'+flag(F.cc)+' '+esc(F.city)+'</span><span>'+esc(T.city)+' '+flag(T.cc)+'</span></div>'+
   '<div class="count">'+esc(count)+'<small>'+esc(sub)+'</small></div>'+
   (pct!=null?'<div class="progress"><i style="width:'+(pct*100).toFixed(1)+'%"></i></div>':"");
  const gate=[c.depTerm&&"Terminal "+c.depTerm,c.depGate&&"Gate "+c.depGate].filter(Boolean).join(" · "), arrInfo=[c.arrTerm&&"Terminal "+c.arrTerm,c.arrGate&&"Gate "+c.arrGate,c.baggage&&"Bags: belt "+c.baggage].filter(Boolean).join(" · ");
  side.innerHTML='<div class="times">'+timeBox("Departs",c.from,c.schedDep,c.estDep,c.actDep)+timeBox("Lands",c.to,c.schedArr,c.estArr,c.actArr)+'</div>'+
   ((gate||arrInfo)?'<div class="note" style="margin-top:10px">'+esc([gate&&c.from+": "+gate,arrInfo&&c.to+": "+arrInfo].filter(Boolean).join("  |  "))+'</div>':"")+
   '<div class="note" style="margin-top:6px">'+dur(a-d)+' flight · '+Math.round(hav(F,T)).toLocaleString()+' km · '+(c.checkedAt?"updated "+ago(c.checkedAt):"not checked yet")+'</div>'+
   '<div class="links"><button class="btn primary" id="heroRefresh">Refresh now</button>'+liveLinks(c.flight).map(([n,u])=>'<a class="btn" target="_blank" rel="noopener" href="'+esc(u)+'">'+n+' ↗</a>').join("")+
   (CT[T.cc]?'<button class="btn ghost" id="heroGuide">'+flag(T.cc)+' '+esc(CT[T.cc].n)+' guide</button>':"")+'</div>';
  $("heroRefresh").onclick=async e=>{e.target.disabled=true;const t=trips.find(x=>x.id===c.id);if(t)await refreshTrip(t);};
  if($("heroGuide"))$("heroGuide").onclick=()=>selectCountry(T.cc,true);
}

/* ================= lookup by flight number ================= */
function resCard(t,btnHtml){
  const F=AP[t.from]||{city:t.from},T=AP[t.to]||{city:t.to},s=status(t);
  const row=(lbl,code,sch,est,act)=>{const tz=tzOf(code);const parts=[];if(sch)parts.push("sched "+fmtT(sch,tz));if(est&&!act)parts.push("est "+fmtT(est,tz));if(act)parts.push("actual "+fmtT(act,tz));return '<dt>'+lbl+'</dt><dd>'+parts.join(" · ")+(sch?' <span class="note">('+fmtD(act||est||sch,tz)+')</span>':"")+'</dd>';};
  return '<div class="res"><div class="top2"><div class="rt">'+esc(showFlight(t.flight))+' · '+esc(t.from)+' → '+esc(t.to)+'<small>'+flag(F.cc)+' '+esc(F.city)+' to '+esc(T.city)+' '+flag(T.cc)+'</small></div><span class="pill s-'+s+'">'+SLABEL[s]+'</span></div>'+
    '<dl class="kv">'+row("Departs",t.from,t.schedDep,t.estDep,t.actDep)+row("Lands",t.to,t.schedArr,t.estArr,t.actArr)+
    (s==="landed"&&bestArr(t)?'<dt>Landed</dt><dd>'+dur(Date.now()-bestArr(t))+' ago</dd>':"")+
    (s==="air"?'<dt>Lands in</dt><dd>'+dur(bestArr(t)-Date.now())+'</dd>':"")+'</dl>'+(btnHtml||"")+'</div>';
}
$("lookForm").addEventListener("submit",async e=>{
  e.preventDefault();const fl=normFlight($("lookIn").value),out=$("lookOut");
  if(!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(fl)){out.innerHTML='<p class="err">Type a flight number like ET 673.</p>';return;}
  if(!key){openSetup();return;}
  $("lookGo").disabled=true;out.innerHTML='<p class="note">Looking up '+esc(showFlight(fl))+'…</p>';
  try{
    const f=await api("flight",{flight_iata:fl});
    if(!f||!f.dep_iata){out.innerHTML='<p class="err">AirLabs has no current flight for '+esc(showFlight(fl))+'. It only knows flights from about a day before departure. For later dates, use "Where is she going?".</p>';return;}
    await Promise.all([ensureAirport(f.dep_iata),ensureAirport(f.arr_iata)]);
    const t=upsertTrip(tripFromFlight(f));selId=t.id;
    out.innerHTML=resCard(t,'<div class="note">Saved to her trips. It refreshes by itself while she’s travelling.</div>');
    rerender();
  }catch(err){out.innerHTML='<p class="err">'+esc(err.message)+'</p>';}
  finally{$("lookGo").disabled=false;}
});

/* ================= find by destination ================= */
let found=[];
async function routesFor(from,to){const r=await api("routes",{airline_iata:"ET",dep_iata:from,arr_iata:to});return Array.isArray(r)?r:[];}
function tripFromRoute(r,date){
  const from=r.dep_iata,to=r.arr_iata,dTz=AP[from]?.tz,aTz=AP[to]?.tz;
  const dep=dTz&&r.dep_time?zoned(date,r.dep_time,dTz):parseUtc(date+" "+(r.dep_time_utc||r.dep_time));
  let arr=r.duration?dep+r.duration*6e4:null;
  if(!arr&&r.arr_time){arr=aTz?zoned(date,r.arr_time,aTz):parseUtc(date+" "+(r.arr_time_utc||r.arr_time));let n=0;while(arr<=dep&&n++<2)arr+=864e5;}
  return {flight:normFlight(r.flight_iata||("ET"+r.flight_number)),from,to,date,schedDep:dep,schedArr:arr,estDep:null,estArr:null,actDep:null,actArr:null,status:null,delayMin:0,checkedAt:null};
}
const DAYS=["sun","mon","tue","wed","thu","fri","sat"];
function runsOn(r,date){if(!Array.isArray(r.days)||!r.days.length)return true;const d=DAYS[new Date(date+"T12:00:00Z").getUTCDay()];return r.days.map(x=>String(x).toLowerCase().slice(0,3)).includes(d);}
$("findForm").addEventListener("submit",async e=>{
  e.preventDefault();const from=apOf($("findFrom").value),to=apOf($("findTo").value),date=$("findDate").value,out=$("findOut");
  if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to)){out.innerHTML='<p class="err">Pick both airports (3-letter codes like ADD and FRA).</p>';return;}
  if(from===to){out.innerHTML='<p class="err">The two airports are the same.</p>';return;}
  if(!date){out.innerHTML='<p class="err">Pick the date she flies.</p>';return;}
  if(!key){openSetup();return;}
  $("findGo").disabled=true;out.innerHTML='<p class="note">Searching Ethiopian Airlines flights…</p>';
  try{
    await Promise.all([ensureAirport(from),ensureAirport(to)]);
    let legs=[],via=false;
    const direct=(await routesFor(from,to)).filter(r=>runsOn(r,date));
    if(direct.length)legs=[direct.map(r=>tripFromRoute(r,date))];
    else if(from!=="ADD"&&to!=="ADD"){
      via=true;await ensureAirport("ADD");
      const a=(await routesFor(from,"ADD")).filter(r=>runsOn(r,date)).map(r=>tripFromRoute(r,date));
      legs=[a];
      if(a.length){const firstArr=Math.min(...a.map(t=>t.schedArr||Infinity));const nd=localDate(firstArr,AP.ADD.tz);
        const dates=[nd];const next=new Date(Date.parse(nd)+864e5).toISOString().slice(0,10);dates.push(next);
        const rb=await routesFor("ADD",to);let b=[];for(const dd of dates)b=b.concat(rb.filter(r=>runsOn(r,dd)).map(r=>tripFromRoute(r,dd)));
        legs.push(b.filter(t=>t.schedDep>firstArr+45*6e4).sort((x,y)=>x.schedDep-y.schedDep).slice(0,4));}
    }
    found=legs.flat();
    if(!found.length){out.innerHTML='<p class="err">No Ethiopian Airlines flights found for that route and day. Try another date, or look up her flight number on the day.</p>';return;}
    let html=via?'<p class="note">No direct flight, so here are both legs through Addis Ababa (ADD). Add the ones she takes.</p>':'';
    legs.forEach((lg,i)=>{if(via)html+='<div class="eyebrow">Leg '+(i+1)+(i===0?": "+from+" → ADD":": ADD → "+to)+'</div>';
      html+=lg.sort((x,y)=>x.schedDep-y.schedDep).map(t=>resCard(t,'<div><button class="btn primary" data-add="'+found.indexOf(t)+'">Add to her trips</button></div>')).join("")||'<p class="note">None found for this leg.</p>';});
    out.innerHTML=html;
  }catch(err){out.innerHTML='<p class="err">'+esc(err.message)+'</p>';}
  finally{$("findGo").disabled=false;}
});
$("findOut").addEventListener("click",e=>{const b=e.target.closest("[data-add]");if(!b)return;const t=found[+b.dataset.add];if(!t)return;
  const s=upsertTrip(Object.assign({},t));selId=s.id;b.textContent="Added ✓";b.disabled=true;toast("Added "+showFlight(t.flight)+" on "+fmtD(t.schedDep,tzOf(t.from)));rerender();});

/* ================= map ================= */
const svg=d3.select("#map svg"),W=960,H=505,proj=d3.geoNaturalEarth1(),path=d3.geoPath(proj);
function visited(list){const s=new Set(),now=Date.now();for(const c of list){if(c.st==="cancelled")continue;if(bestDep(c)<=now&&AP[c.from])s.add(AP[c.from].cc);if(c.st==="landed"&&AP[c.to])s.add(AP[c.to].cc);}return s;}
function renderMap(){
  if(!world)return;
  const list=all().filter(c=>AP[c.from]?.lat!=null&&AP[c.to]?.lat!=null),vis=visited(list),visNum=new Set([...vis].map(cc=>CT[cc]?.num).filter(Boolean));
  if(mapMode==="world"||!list.length)proj.fitExtent([[6,6],[W-6,H-6]],{type:"Sphere"});
  else{const pts=[];for(const c of list)for(const a of[AP[c.from],AP[c.to]])for(const[dx,dy]of[[-14,-9],[14,9]])pts.push([Math.max(-179,Math.min(179,a.lon+dx)),Math.max(-80,Math.min(84,a.lat+dy))]);proj.fitExtent([[24,24],[W-24,H-24]],{type:"MultiPoint",coordinates:pts});}
  svg.selectAll("*").remove();
  const cs=getComputedStyle(document.documentElement),v=n=>cs.getPropertyValue(n).trim();
  svg.append("path").datum({type:"Sphere"}).attr("d",path).attr("fill",v("--ocean"));
  svg.append("path").datum(d3.geoGraticule10()).attr("d",path).attr("fill","none").attr("stroke",v("--line")).attr("stroke-width",.5);
  svg.append("g").selectAll("path").data(world).join("path").attr("d",path)
    .attr("fill",d=>visNum.has(String(d.id))?v("--visited"):v("--land")).attr("stroke",v("--ocean")).attr("stroke-width",.6)
    .style("cursor",d=>numToCC[String(d.id)]?"pointer":"default").on("click",(e,d)=>{const cc=numToCC[String(d.id)];if(cc)selectCountry(cc,true);})
    .append("title").text(d=>d.properties.name);
  const g=svg.append("g").attr("fill","none");
  for(const c of list){const A=AP[c.from],B=AP[c.to];const isSel=c.id===selId,col=c.st==="air"?v("--air"):c.st==="landed"?v("--accent"):v("--muted");
    g.append("path").datum({type:"LineString",coordinates:[[A.lon,A.lat],[B.lon,B.lat]]}).attr("d",path).attr("stroke",col).attr("stroke-width",isSel||c.st==="air"?2.6:1.4).attr("stroke-dasharray",c.st==="landed"||c.st==="air"?null:"4 4").attr("stroke-linecap","round").attr("opacity",isSel||c.st==="air"?1:.8);}
  const used=new Map();for(const c of list){used.set(c.from,AP[c.from]);used.set(c.to,AP[c.to]);}
  const ag=svg.append("g");
  for(const a of used.values()){const p=proj([a.lon,a.lat]);if(!p)continue;
    ag.append("circle").attr("cx",p[0]).attr("cy",p[1]).attr("r",a.code==="ADD"?5:3.6).attr("fill",a.code==="ADD"?v("--ink"):v("--surface")).attr("stroke",v("--ink")).attr("stroke-width",1.4);
    ag.append("text").attr("x",p[0]+7).attr("y",p[1]-6).text(a.code).attr("fill",v("--ink")).attr("font-family","JetBrains Mono, monospace").attr("font-size",11).attr("font-weight",700).attr("paint-order","stroke").attr("stroke",v("--ocean")).attr("stroke-width",3);}
  const air=list.find(c=>c.st==="air");
  if(air){const A=AP[air.from],B=AP[air.to],now=Date.now();let pos,ang;
    if(air.lat!=null&&air.lng!=null&&air.posAt&&now-air.posAt<30*6e4){pos=[air.lng,air.lat];const p=proj(pos);const q=proj([B.lon,B.lat]);ang=air.dir!=null?air.dir-90:Math.atan2(q[1]-p[1],q[0]-p[0])*180/Math.PI;}
    else{const t=Math.min(.999,Math.max(0,(now-bestDep(air))/(bestArr(air)-bestDep(air))));const ip=d3.geoInterpolate([A.lon,A.lat],[B.lon,B.lat]);pos=ip(t);const p=proj(pos),q=proj(ip(Math.min(1,t+.01)));ang=Math.atan2(q[1]-p[1],q[0]-p[0])*180/Math.PI;}
    const p=proj(pos);if(p){const pg=svg.append("g").attr("transform","translate("+p[0]+","+p[1]+") rotate("+(ang+90)+")");
      pg.append("circle").attr("r",13).attr("fill",v("--air")).attr("opacity",.18);
      pg.append("path").attr("d","M0,-11 L2,-4 L10,1 L10,3 L2,1 L1.5,7 L4,9 L4,10.5 L0,9.5 L-4,10.5 L-4,9 L-1.5,7 L-2,1 L-10,3 L-10,1 L-2,-4 Z").attr("fill",v("--air")).attr("stroke",v("--surface")).attr("stroke-width",.8);
      pg.append("title").text("Abigya on "+showFlight(air.flight));}}
  const done=list.filter(c=>c.st==="landed"),aps=new Set();done.forEach(c=>{aps.add(c.from);aps.add(c.to);});
  const km=done.reduce((s,c)=>s+hav(AP[c.from],AP[c.to]),0),hrs=done.reduce((s,c)=>s+(bestArr(c)-bestDep(c)),0)/36e5;
  $("stats").innerHTML=[[done.length,"flights flown"],[vis.size,"countries"],[aps.size,"airports"],[Math.round(hrs),"hours in the air"],[Math.round(km).toLocaleString(),"km flown"],[(km/40075).toFixed(2),"times round the Earth"]].map(([b,s])=>'<div class="stat"><b>'+b+'</b><span>'+s+'</span></div>').join("");
}

/* ================= board ================= */
function renderBoard(){
  const list=all();let rows=tab==="up"?list.filter(c=>!["landed","cancelled"].includes(c.st)):tab==="past"?list.filter(c=>["landed","cancelled"].includes(c.st)).reverse():list;
  const b=$("board");
  if(!rows.length){b.innerHTML='<div class="empty">'+(tab==="up"?"No upcoming trips. Look up her flight number or search where she's going.":"Nothing here yet.")+'</div>';return;}
  b.innerHTML='<div class="row headr"><span>Date</span><span>Flight</span><span>Route</span><span>Departs → Lands (local)</span><span>Status</span><span></span></div>'+rows.map(c=>{
    const d=bestDep(c),a=bestArr(c);
    return '<div class="row'+(c.id===selId?" sel":"")+'" data-id="'+esc(c.id)+'"><span class="c-date mono">'+esc(fmtD(d,tzOf(c.from)))+'</span><span class="fl">'+esc(showFlight(c.flight))+'</span>'+
      '<span class="rt">'+esc(c.from)+' → '+esc(c.to)+'<small>'+esc(cityOf(c.from))+' to '+esc(cityOf(c.to))+'</small></span>'+
      '<span class="tm">'+fmtT(d,tzOf(c.from))+' → '+(a?fmtT(a,tzOf(c.to)):"--:--")+'<small>'+esc(fmtD(d,tzOf(c.from)))+(a?' · '+dur(a-d):"")+'</small></span>'+
      '<span class="st"><span class="pill s-'+c.st+'">'+SLABEL[c.st]+'</span></span>'+
      '<span class="act"><button class="icon" data-ref="'+esc(c.id)+'">Refresh</button><button class="icon'+(confirmDel===c.id?" danger":"")+'" data-del="'+esc(c.id)+'">'+(confirmDel===c.id?"Sure?":"Delete")+'</button></span></div>';}).join("");
}
$("board").addEventListener("click",async e=>{
  const rf=e.target.closest("[data-ref]"),dl=e.target.closest("[data-del]");
  if(rf){e.stopPropagation();rf.disabled=true;rf.textContent="…";const t=trips.find(x=>x.id===rf.dataset.ref);if(t)await refreshTrip(t);return;}
  if(dl){const id=dl.dataset.del;if(confirmDel===id){confirmDel=null;trips=trips.filter(t=>t.id!==id);saveTrips();rerender();}else{confirmDel=id;renderBoard();setTimeout(()=>{if(confirmDel===id){confirmDel=null;renderBoard();}},4000);}return;}
  const row=e.target.closest(".row[data-id]");if(row){selId=row.dataset.id===selId?null:row.dataset.id;const c=all().find(x=>x.id===selId);renderBoard();renderMap();if(c&&AP[c.to]&&CT[AP[c.to].cc])selectCountry(AP[c.to].cc,false);}
});
function seg(ids,val){for(const[id,v]of ids)$(id).setAttribute("aria-pressed",String(v===val));}
function setTab(t){tab=t;seg([["tbUp","up"],["tbPast","past"],["tbAll","all"]],t);renderBoard();}
$("tbUp").onclick=()=>setTab("up");$("tbPast").onclick=()=>setTab("past");$("tbAll").onclick=()=>setTab("all");
$("mvRoutes").onclick=()=>{mapMode="routes";seg([["mvRoutes","routes"],["mvWorld","world"]],"routes");renderMap();};
$("mvWorld").onclick=()=>{mapMode="world";seg([["mvRoutes","routes"],["mvWorld","world"]],"world");renderMap();};

/* ================= countries ================= */
function myCountries(){const m=new Map(),now=Date.now();for(const c of all()){if(c.st==="cancelled")continue;for(const[code,t]of[[c.from,bestDep(c)],[c.to,c.st==="landed"?0:Infinity]]){const cc=AP[code]?.cc;if(!cc)continue;if(!m.has(cc))m.set(cc,{n:0});if(t<=now)m.get(cc).n++;}}return m;}
function renderChips(){
  const m=myCountries();let ccs=(guideMode==="hers"?[...m.keys()]:Object.keys(CT)).filter(cc=>CT[cc]).sort((a,b)=>CT[a].n.localeCompare(CT[b].n));
  if(guideMode==="hers"&&!ccs.length){$("chips").innerHTML='<span class="note">Her countries show up here as trips are added. Tap "Whole network" to browse every country Ethiopian Airlines flies to.</span>';$("guide").innerHTML="";return;}
  if(!selCountry||!ccs.includes(selCountry)){const h=pickHero(all());const hc=h&&AP[h.to]?.cc;selCountry=hc&&ccs.includes(hc)?hc:ccs[0];}
  $("chips").innerHTML=ccs.map(cc=>{const o=m.get(cc);const tag=o?'<span class="n">'+(o.n?"×"+o.n:"next")+'</span>':"";return '<button class="chip" data-cc="'+cc+'" aria-pressed="'+(cc===selCountry)+'"><span class="flag">'+flag(cc)+'</span>'+esc(CT[cc].n)+tag+'</button>';}).join("");
  renderGuide();
}
$("chips").addEventListener("click",e=>{const b=e.target.closest("[data-cc]");if(b)selectCountry(b.dataset.cc,false);});
$("cgHers").onclick=()=>{guideMode="hers";seg([["cgHers","hers"],["cgAll","all"]],"hers");renderChips();};
$("cgAll").onclick=()=>{guideMode="all";seg([["cgHers","hers"],["cgAll","all"]],"all");renderChips();};
function selectCountry(cc,scroll){if(!CT[cc])return;if(guideMode==="hers"&&!myCountries().has(cc)){guideMode="all";seg([["cgHers","hers"],["cgAll","all"]],"all");}selCountry=cc;renderChips();if(scroll)$("guide").scrollIntoView({behavior:"smooth",block:"start"});}
function renderGuide(){
  const cc=selCountry,g=CT[cc];if(!g){$("guide").innerHTML="";return;}
  const cities=window.AIRPORTS.filter(a=>a[2]===cc),tz=cities[0]?.[5],o=myCountries().get(cc);
  const visits=o?(o.n?"Abigya has been here "+o.n+" time"+(o.n>1?"s":""):"Coming up on her trips"):"Not on her trips yet";
  $("guide").innerHTML='<div class="gtitle"><span class="flag" style="font-size:2rem">'+flag(cc)+'</span><h3>'+esc(g.n)+'</h3><span class="note">'+esc(visits)+'</span></div>'+
   '<div class="facts"><span>Airports <b>'+cities.map(a=>esc(a[1])+" ("+a[0]+")").join(", ")+'</b></span><span>Money <b>'+esc(g.cur)+'</b></span><span>Language <b>'+esc(g.lang)+'</b></span>'+(tz?'<span>Local time now <b class="mono">'+fmtT(Date.now(),tz)+'</b> ('+utcLabel(Date.now(),tz)+')</span>':"")+'</div>'+
   '<p class="known">'+esc(g.k)+'</p>'+
   '<div class="list"><h4>What to buy</h4><ul>'+g.b.map(x=>"<li>"+esc(x)+"</li>").join("")+'</ul></div>'+
   '<div class="list"><h4>What to eat</h4><ul>'+g.e.map(x=>"<li>"+esc(x)+"</li>").join("")+'</ul></div>'+
   '<div class="tip"><span class="eyebrow">Tip</span><div>'+esc(g.t)+'</div></div>';
}

/* ================= settings ================= */
function openSetup(){$("setup").hidden=false;$("keyIn").value="";$("keyErr").textContent="";
  $("keyNow").hidden=!key;$("keyNow").textContent=key==="demo"?"Using demo data right now.":key?"A key is saved (ending …"+key.slice(-4)+"). Paste a new one to replace it.":"";
  $("setup").scrollIntoView({behavior:"smooth",block:"start"});$("keyIn").focus();}
$("openSettings").onclick=()=>{if($("setup").hidden)openSetup();else if(key)$("setup").hidden=true;};
$("keyForm").addEventListener("submit",async e=>{e.preventDefault();const k=$("keyIn").value.trim();if(!k){$("keyErr").textContent="Paste the key from your AirLabs dashboard.";return;}
  const old=key;key=k;$("keyErr").textContent="Checking the key…";
  try{await api("airports",{iata_code:"ADD"});ls.set(K_KEY,key);$("setup").hidden=true;toast("Key saved. You're ready.");}
  catch(err){key=old;$("keyErr").textContent=err.message;}});
$("useDemo").onclick=()=>{key="demo";ls.set(K_KEY,key);$("setup").hidden=true;toast("Demo data on. Try ET 673.");seedDemo();rerender();};

/* ================= demo API (no key) ================= */
function hashN(s){let h=7;for(const c of s)h=(h*31+c.charCodeAt(0))>>>0;return h;}
const DEMO_ROUTES={ET673:["DXB","ADD",-5.2,4.1],ET706:["ADD","FRA",-2,6.6],ET500:["ADD","IAD",20,17.2],ET308:["ADD","NBO",30,2.2],ET302:["ADD","NBO",4,2.2]};
function demoFlight(fl){
  const n=normFlight(fl);let d=DEMO_ROUTES[n];
  if(!d){const pool=["NBO","FRA","DXB","LOS","JNB","CAI","LHR","BKK","CAN","ACC","EBB","KGL"];const h=hashN(n);const other=pool[h%pool.length];const out=h%2===0;d=[out?"ADD":other,out?other:"ADD",((h%30)-12)/2,2+(h%9)];}
  const[from,to,startH,durH]=d;const now=Date.now();const dep=Math.round((now+startH*36e5)/3e5)*3e5,arr=dep+durH*36e5;
  const local=(ms,c)=>localDate(ms,tzOf(c))+" "+fmtT(ms,tzOf(c));
  const st=now>=arr?"landed":now>=dep?"en-route":"scheduled";
  const r={flight_iata:n,dep_iata:from,arr_iata:to,dep_time:local(dep,from),dep_time_ts:dep/1000,arr_time:local(arr,to),arr_time_ts:arr/1000,status:st,dep_terminal:from==="ADD"?"2":"",dep_gate:"A"+(hashN(n)%20+1),arr_baggage:st==="landed"?String(hashN(n)%9+1):""};
  if(st!=="scheduled")r.dep_actual_ts=(dep+7*6e4)/1000;
  if(st==="landed")r.arr_actual_ts=(arr-4*6e4)/1000;else r.arr_estimated_ts=(arr+3*6e4)/1000;
  if(st==="en-route"){const A=AP[from],B=AP[to],t=(now-dep)/(arr-dep),ip=d3.geoInterpolate([A.lon,A.lat],[B.lon,B.lat])(t);r.lng=ip[0];r.lat=ip[1];r.updated=now/1000;}
  return r;
}
function demoApi(path,p){return new Promise(res=>setTimeout(()=>{
  if(path==="flight")res(demoFlight(p.flight_iata));
  else if(path==="airports")res(AP[p.iata_code]?[{name:AP[p.iata_code].city,iata_code:p.iata_code,lat:AP[p.iata_code].lat,lng:AP[p.iata_code].lon,country_code:AP[p.iata_code].cc}]:[]);
  else if(path==="routes"){const A=AP[p.dep_iata],B=AP[p.arr_iata];if(!A||!B||(p.dep_iata!=="ADD"&&p.arr_iata!=="ADD"))return res([]);
    const durM=Math.round(hav(A,B)/780*60+35);const h=hashN(p.dep_iata+p.arr_iata);
    res([0,1].map(i=>({airline_iata:"ET",flight_iata:"ET"+(300+h%600+i*2),dep_iata:p.dep_iata,arr_iata:p.arr_iata,dep_time:String((8+i*12+h%3)%24).padStart(2,"0")+":"+(i?"45":"15"),duration:durM,days:["mon","tue","wed","thu","fri","sat","sun"]})));}
  else res(null);},350));}
function seedDemo(){
  if(trips.length)return;const now=Date.now();
  const mk=(fl,from,to,depMs,durH)=>{const t={flight:fl,from,to,date:localDate(depMs,tzOf(from)),schedDep:depMs,schedArr:depMs+durH*36e5,estDep:null,estArr:null,actDep:depMs+5*6e4,actArr:depMs+durH*36e5-6e4,status:"landed",delayMin:0,checkedAt:now};upsertTrip(t);};
  mk("ET500","ADD","IAD",now-4*864e5,17.2);mk("ET501","IAD","ADD",now-2.5*864e5,13.4);mk("ET672","ADD","DXB",now-1.3*864e5,4.1);
  upsertTrip(tripFromFlight(demoFlight("ET673")));
}

/* ================= auto refresh ================= */
async function autoRefresh(){
  if(!key||document.hidden)return;const now=Date.now();
  const due=trips.filter(t=>{const s=status(t,now);if(s==="cancelled")return false;if(s==="landed"&&t.actArr)return false;
    const d=bestDep(t),a=bestArr(t)||d+12*36e5;return now>d-3*36e5&&now<a+90*6e4&&(!t.checkedAt||now-t.checkedAt>10*6e4);});
  if(due.length)await refreshTrip(due[0],{quiet:true});
}

/* ================= boot ================= */
function rerender(){renderHero();renderBoard();renderMap();renderChips();tickClocks();}
$("apList").innerHTML=window.AIRPORTS.map(a=>'<option value="'+a[0]+'">'+esc(a[1]+", "+(CT[a[2]]?.n||a[2]))+'</option>').join("");
$("findDate").value=new Date().toISOString().slice(0,10);
fetch("world.json").then(r=>r.json()).then(t=>{world=topojson.feature(t,t.objects.countries).features;renderMap();}).catch(()=>{$("map").innerHTML='<div class="empty">The map couldn’t load. Her trips are still listed below.</div>';});
if(!key)openSetup();
rerender();
setInterval(()=>{renderHero();tickClocks();},30000);
setInterval(()=>{renderMap();renderBoard();autoRefresh();},60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden){rerender();autoRefresh();}});
setTimeout(autoRefresh,1500);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",renderMap);
})();
