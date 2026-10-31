import {tracedFetch,openApiConsole} from './api-console.mjs?v=0.4.9';
/* Session-only BYOK: never persist keys into cookies, Storage, URL or the server DB. */
const el=id=>document.getElementById(id);
const ephemeral = {meta:'',tripo:'',model:'muse-spark-1.3'};
let autoOpened=false;
let previousFocus=null;
export function connected(provider){return Boolean(ephemeral[provider]);}
export function getAiHeaders(path){
  const headers={};
  if(path.startsWith('/api/ai/')){
    if(path.includes('/tripo')){if(ephemeral.tripo)headers['X-PlanetLab-Tripo-Key']=ephemeral.tripo;}
    else if(ephemeral.meta)headers['X-PlanetLab-Meta-Key']=ephemeral.meta;
  }
  return headers;
}
export function selectedModel(){return ephemeral.model;}
function setStatus(message,state=''){
  const e=el('aiSetupStatus');e.textContent=message;e.className='ai-inline-status'+(state?' '+state:'');
  const inline=el('aiConnectionInline');
  inline.textContent=ephemeral.meta?`Meta ready in this tab · ${ephemeral.model}${ephemeral.tripo?' · Tripo connected':''}`:'No Meta key connected for this tab.';
}
export function openAiSetup(){
  previousFocus=document.activeElement;
  el('aiSetupBackdrop').hidden=false;
  el('aiMetaKey').value='';el('aiTripoKey').value='';
  setStatus(ephemeral.meta?'Meta key available in memory for this tab.':'Paste your Meta key and click Use key in this tab.');
  el('aiMetaModel').value=ephemeral.model;
  el('aiMetaKey').focus();
}
export function closeAiSetup(){
  el('aiSetupBackdrop').hidden=true;
  el('aiMetaKey').value='';el('aiTripoKey').value='';
  previousFocus?.focus?.();
}
function storeMeta(){
  const key=el('aiMetaKey').value.trim();
  if(key && (key.length<12 || key.length>4096 || /[\r\n]/.test(key)))throw new Error('Meta key must have 12–4096 characters.');
  if(!key && !ephemeral.meta)throw new Error('Paste your Meta API key first.');
  if(key)ephemeral.meta=key;
  ephemeral.model=el('aiMetaModel').value;
  el('aiMetaKey').value='';
  setStatus(`Meta key saved for this tab only · ${ephemeral.model}`,'success');
}
async function testMeta(){
  storeMeta();
  const session=window.planetLabAuthState;
  if(!session?.user)throw new Error('Sign in to Planet Lab first.');
  setStatus('Testing Muse Spark through Planet Lab…');
  const r=await tracedFetch('/api/ai/connection-test',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf,'X-PlanetLab-Meta-Key':ephemeral.meta},
    body:JSON.stringify({provider:'meta',model:ephemeral.model})
  });
  const data=await r.json().catch(()=>({error:`HTTP ${r.status}`}));
  if(!r.ok)throw new Error(data.error||`Connection failed (HTTP ${r.status})`);
  setStatus(`Connected to Meta Model API · ${data.model} · response: ${data.reply}`,'success');
}
el('aiSetupOpen').addEventListener('click',openAiSetup);
el('aiSetupTop').addEventListener('click',openAiSetup);
el('aiSetupClose').addEventListener('click',closeAiSetup);
el('aiSetupBackdrop').addEventListener('click',e=>{if(e.target===el('aiSetupBackdrop'))closeAiSetup()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('aiSetupBackdrop').hidden)closeAiSetup()});
el('aiKeyReveal').addEventListener('click',()=>{const input=el('aiMetaKey');input.type=input.type==='password'?'text':'password';el('aiKeyReveal').textContent=input.type==='password'?'Show':'Hide'});
el('aiSetupForm').addEventListener('submit',e=>{e.preventDefault();try{storeMeta()}catch(err){setStatus(err.message,'error')}});
el('aiTestKey').addEventListener('click',async()=>{const b=el('aiTestKey');b.disabled=true;openApiConsole();try{await testMeta()}catch(err){setStatus(err.message,'error');openApiConsole()}finally{b.disabled=false}});
el('aiTripoSave').addEventListener('click',()=>{
  const key=el('aiTripoKey').value.trim();
  if(key.length<12||key.length>4096||/[\r\n]/.test(key)){setStatus('Enter a valid Tripo key (12–4096 characters).','error');return}
  ephemeral.tripo=key;el('aiTripoKey').value='';setStatus('Tripo key ready for this tab. A generation request will verify it.','success');
});
el('aiStartDesign').addEventListener('click',()=>{
  if(!ephemeral.meta){setStatus('Enter your Meta key and click Use key in this tab first.','error');return}
  closeAiSetup();el('aiStudio').scrollIntoView({behavior:'smooth',block:'start'});el('aiBrief').focus();
});
window.addEventListener('planetlab:auth-changed',event=>{
  if(!event.detail.user){ephemeral.meta='';ephemeral.tripo='';autoOpened=false;closeAiSetup();return}
  if(!autoOpened){autoOpened=true;queueMicrotask(()=>{if(!connected('meta'))openAiSetup()})}
});
if(window.planetLabAuthState?.user&&!autoOpened){autoOpened=true;queueMicrotask(()=>openAiSetup())}
