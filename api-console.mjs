/* Per-tab, privacy-preserving AI HTTP inspector. No persistent storage or telemetry. */
const el=id=>document.getElementById(id);
const events=[];
const LIMIT=100;
const MAX_TEXT=9000;
let selectedId=null;
let fontSize=11;
let filter='all';
let running=0;
let visible=false;
const SENSITIVE=/(?:api[_-]?key|authorization|cookie|csrf|password|secret|token|credential)/i;
function redact(value,depth=0){
  if(depth>12)return '[DEPTH LIMIT]';
  if(Array.isArray(value))return value.slice(0,60).map(v=>redact(v,depth+1));
  if(value&&typeof value==='object'){
    const out={};for(const [key,val] of Object.entries(value).slice(0,100))out[key]=SENSITIVE.test(key)?'[REDACTED]':redact(val,depth+1);
    return out;
  }
  if(typeof value==='string'){
    if(value.startsWith('data:image/'))return '[IMAGE DATA OMITTED, '+value.length+' chars]';
    const str=value.length>MAX_TEXT?value.slice(0,MAX_TEXT)+' … [TRUNCATED]':value;
    return str.replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').replace(/(api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;}]+/gi,'$1=[REDACTED]');
  }
  return value;
}
function parseBody(body){
  if(body===undefined||body===null)return null;
  if(typeof body!=='string')return '[BINARY / NON-JSON BODY]';
  try{const data=JSON.parse(body);if(data&&typeof data==='object'&&typeof data.image==='string')data.image='[IMAGE DATA OMITTED]';return redact(data)}catch{return redact(body)}
}
function textToObject(text){
  try{return redact(JSON.parse(text))}catch{return redact(text)}
}
function serial(entry){return JSON.stringify(entry,null,2)}
function draw(){
  const list=el('apiLogList');if(!list)return;
  const subset=events.filter(e=>filter!=='errors'||e.status>=400||e.error).slice().reverse();
  list.replaceChildren();
  for(const event of subset){
    const item=document.createElement('button');item.type='button';item.className='api-log-item';
    item.classList.toggle('active',event.id===selectedId);
    const status=event.error?'NET':event.status||'…';
    const color=event.error||event.status>=400?'bad':event.status>=200&&event.status<400?'good':'muted';
    const stamp=document.createElement('span');stamp.textContent=new Date(event.timestamp).toLocaleTimeString();stamp.className='muted';
    const badge=document.createElement('span');badge.textContent=String(status);badge.className='api-code '+color;
    const endpoint=document.createElement('span');endpoint.textContent=event.path;endpoint.className='api-path';
    const duration=document.createElement('span');duration.textContent=`${event.durationMs}ms`;duration.className='muted';
    item.append(stamp,badge,endpoint,duration);
    item.addEventListener('click',()=>{selectedId=event.id;draw()});list.append(item);
  }
  const chosen=events.find(e=>e.id===selectedId) || events.at(-1);
  el('apiLogDetail').textContent=chosen?serial(chosen):'No API requests yet. Use Test connection or Generate building.';
  el('apiLogCount').textContent=`${events.length} request${events.length===1?'':'s'} · ${running} active`;
  el('apiLogDetail').style.fontSize=fontSize+'px';
}
function add(entry){
  events.push(entry);if(events.length>LIMIT)events.shift();selectedId=entry.id;
  if(entry.error||entry.status>=400){const btn=el('apiConsoleTop');btn?.classList.add('api-alert')}
  draw();
}
export function openApiConsole(){
  const pane=el('apiConsole');if(!pane)return;
  pane.hidden=false;visible=true;
  el('apiConsoleTop')?.classList.remove('api-alert');
  draw();
}
export function closeApiConsole(){el('apiConsole').hidden=true;visible=false;}
export async function tracedFetch(path,options={}){
  const started=performance.now();
  const id=(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2);
  const method=(options.method||'GET').toUpperCase();
  const url=new URL(path,location.href);
  const record={id,timestamp:new Date().toISOString(),method,path:url.pathname,status:null,durationMs:0,
    request:{headers:{'Content-Type':options.headers?.['Content-Type']||'application/json',Authorization:'[REDACTED / BYOK header omitted]', 'X-PlanetLab-Debug':'1'},body:parseBody(options.body)},
    response:null,upstream:null,error:null};
  const headers=new Headers(options.headers||{});
  headers.set('X-PlanetLab-Debug','1');
  running+=1;draw();
  try{
    const response=await fetch(path,{...options,headers,cache:'no-store'});
    record.status=response.status;
    // The API returns JSON; skip large or unexpected response types.
    const length=Number(response.headers.get('content-length'))||0;
    if(length>750000||(response.ok&&url.pathname==='/api/ai/scenario-edit')){record.response='[GENERATED IMAGE RESPONSE OMITTED]'}
    else{
      const raw=await response.clone().text();
      const parsed=textToObject(raw.slice(0,30000));
      if(parsed&&typeof parsed==='object'&&typeof parsed.image==='string')parsed.image='[GENERATED IMAGE OMITTED]';
      if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&'_trace' in parsed){record.upstream=parsed._trace;delete parsed._trace}
      record.response=parsed;
    }
    return response;
  }catch(error){record.error=String(error?.message||error);throw error}
  finally{
    record.durationMs=Math.round(performance.now()-started);
    running-=1;add(redact(record));
  }
}
function downloadJson(data,name){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setMinimised(on){
  const panel=el('apiConsole');if(!panel)return;
  panel.classList.toggle('minimised',Boolean(on));
  const button=el('apiConsoleMin');button.textContent=on?'+':'−';
  button.title=on?'Restore console':'Minimise console';
  button.setAttribute('aria-label',on?'Restore console':'Minimise console');
}
function setup(){
  const panel=el('apiConsole');if(!panel)return;
  el('apiConsoleTop').addEventListener('click',openApiConsole);
  el('apiConsoleAi').addEventListener('click',openApiConsole);
  el('apiConsoleStudio').addEventListener('click',openApiConsole);
  el('apiConsoleClose').addEventListener('click',closeApiConsole);
  el('apiConsoleMin').addEventListener('click',()=>setMinimised(!panel.classList.contains('minimised')));
  el('apiLogClear').addEventListener('click',()=>{events.length=0;selectedId=null;draw()});
  el('apiLogExport').addEventListener('click',()=>downloadJson({source:'Planet Lab API console',exportedAt:new Date().toISOString(),redacted:true,requests:events},'planetlab-api-logs.json'));
  el('apiLogCopy').addEventListener('click',async()=>{
    const entry=events.find(e=>e.id===selectedId)||events.at(-1);if(!entry)return;
    try{await navigator.clipboard.writeText(serial(entry));el('apiLogCopy').textContent='Copied';setTimeout(()=>{el('apiLogCopy').textContent='Copy selected'},1100)}
    catch{el('apiLogDetail').focus();const sel=window.getSelection(),range=document.createRange();range.selectNodeContents(el('apiLogDetail'));sel.removeAllRanges();sel.addRange(range)}
  });
  el('apiLogLess').addEventListener('click',()=>{fontSize=Math.max(6,fontSize-1);draw()});
  el('apiLogMore').addEventListener('click',()=>{fontSize=Math.min(26,fontSize+1);draw()});
  el('apiLogFilter').addEventListener('change',e=>{filter=e.target.value;draw()});
  // Only the title bar moves the window. Native resize handle changes dimensions.
  const handle=el('apiConsoleHandle');let dragging=null;
  handle.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))return;
    const r=panel.getBoundingClientRect();dragging={id:e.pointerId,dx:e.clientX-r.left,dy:e.clientY-r.top};
    handle.setPointerCapture(e.pointerId);e.preventDefault();
  });
  handle.addEventListener('pointermove',e=>{
    if(!dragging||dragging.id!==e.pointerId)return;
    const x=Math.max(0,Math.min(innerWidth-90,e.clientX-dragging.dx));
    const y=Math.max(0,Math.min(innerHeight-40,e.clientY-dragging.dy));
    panel.style.left=x+'px';panel.style.top=y+'px';panel.style.right='auto';panel.style.bottom='auto';
  });
  for(const kind of ['pointerup','pointercancel'])handle.addEventListener(kind,()=>{dragging=null});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&visible&&el('aiSetupBackdrop')?.hidden)closeApiConsole()});
  draw();
}
setup();
window.planetLabApiConsole={open:openApiConsole,getCount:()=>events.length};
