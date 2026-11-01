/* Browser-local, georeferenced AI concept imagery. Never overwrites Earth data. */
import {patchBounds,rasterRect,siteKey,validLayer} from './scenario-core.mjs';
import {getAiHeaders} from './ai-connections.mjs?v=0.4.24';
const $=id=>document.getElementById(id);
const state={site:null,selecting:false,first:null,bounds:null,layers:[],current:null,keys:{meta:'',xai:'',openai:''},busy:false};
let dbPromise;
function db(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const request=indexedDB.open('planetlab-scenarios-v1',1);
  request.onupgradeneeded=()=>{const store=request.result.createObjectStore('layers',{keyPath:'id'});store.createIndex('site','site',{unique:false})};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });return dbPromise;
}
async function listSite(site){const database=await db();return new Promise((resolve,reject)=>{
 const req=database.transaction('layers','readonly').objectStore('layers').index('site').getAll(site);
 req.onsuccess=()=>resolve(req.result.filter(validLayer).sort((a,b)=>a.created-b.created));req.onerror=()=>reject(req.error)
})}
async function put(layer){const database=await db();return new Promise((resolve,reject)=>{
 const req=database.transaction('layers','readwrite').objectStore('layers').put(layer);
 req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error)
})}
async function remove(id){const database=await db();return new Promise((resolve,reject)=>{
 const req=database.transaction('layers','readwrite').objectStore('layers').delete(id);
 req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error)
})}
function report(message,isError=false){$('scenarioStatus').textContent=message;$('scenarioStatus').style.color=isError?'#ffb4ae':''}
function selectedResolution(){return Number($('scenarioResolution')?.value||1024)||1024}
function patchPreview(){
 const base=window.planetLabApp?.world?.baseImageryCanvas;
 if(!base||!state.bounds)throw new Error('Wait for local aerial imagery, then select two terrain corners.');
 const rect=rasterRect(state.bounds,base.width,base.height);
 const preview=$('scenarioCrop');preview.width=512;preview.height=512;
 preview.getContext('2d').drawImage(base,rect.x,rect.y,rect.width,rect.height,0,0,512,512);
 const input=document.createElement('canvas');input.width=1024;input.height=1024;
 input.getContext('2d').drawImage(base,rect.x,rect.y,rect.width,rect.height,0,0,1024,1024);
 // JPEG bounds upload sizes even for complex satellite patches.
 return input.toDataURL('image/jpeg',.88);
}
function selected(){return state.layers.find(l=>l.id===state.current)||null}
function updateScene(){
 const sim=window.planetLabApp,world=sim?.world;
 if(!world?.baseImageryCanvas)return;
 const source=world.baseImageryCanvas,mode=$('scenarioMode').value;
 const token=updateScene.token=Symbol('scenario-compose');
 const applicable=mode==='original'?[]:state.layers.filter(layer=>layer.visible&&layer.site===state.site&&validLayer(layer));
 const split=mode==='split'?-78+156*Number($('scenarioSplit').value)/100:-78;
 async function compose(){
  const images=[];
  try{
   for(const layer of applicable){
    let bitmap;
    try{bitmap=await createImageBitmap(layer.blob)}catch{continue}
    if(token!==updateScene.token||siteKey(sim?.anchor)!==state.site||world.baseImageryCanvas!==source){bitmap.close();return}
    images.push({layer,bitmap});
   }
   if(token!==updateScene.token||siteKey(sim?.anchor)!==state.site||world.baseImageryCanvas!==source)return;
   world.clearScenarioLayers();
   for(const {layer,bitmap} of images){
    if(!world.addScenarioLayer(layer.bounds,bitmap,layer.opacity??1,split))bitmap.close();
   }
   images.length=0; // ownership transferred to the Three.js materials
   world.existingGroup.visible=world.mode==='region'&&(mode==='original'||!applicable.length||!$('scenarioHideBuildings').checked);
  }finally{
   for(const image of images)image.bitmap.close();
  }
 }
 compose().catch(error=>report('Could not display an edited patch: '+error.message,true));
}
function refreshLayerList(){
 const root=$('scenarioList');root.replaceChildren();
 if(!state.layers.length){root.textContent='No scenarios for this location.';return}
 for(const layer of state.layers){
  const row=document.createElement('div');row.className='scenario-layer'+(layer.id===state.current?' chosen':'');
  const enable=document.createElement('input');enable.type='checkbox';enable.checked=layer.visible;enable.title='Show overlay';enable.onchange=async()=>{layer.visible=enable.checked;await put(layer);updateScene()};
  const button=document.createElement('button');button.type='button';button.className='btn mini';
  button.textContent=(layer.name||layer.prompt.slice(0,24))+' · '+layer.provider;
  button.onclick=()=>{state.current=layer.id;state.bounds=layer.bounds;$('scenarioOpacity').value=Math.round((layer.opacity??1)*100);refreshLayerList();updateScene();window.planetLabApp?.world?.drawScenarioBounds(layer.bounds)};
  row.append(enable,button);root.append(row)
 }
}
function enableSelection(enable){
 state.selecting=enable;state.first=null;
 const world=window.planetLabApp?.world;
 if(world){world.scenarioSelecting=enable;world.drawScenarioBounds(enable?null:state.bounds)}
 $('scenarioPick').classList.toggle('scenario-picking',enable);
 $('scenarioPick').setAttribute('aria-pressed',String(enable));
 $('scenarioPick').textContent=enable?'Cancel selection · click corner 1':'Select patch (2 clicks)';
 if(world?.canvas)world.canvas.style.cursor=enable?'crosshair':'';
 if(enable)report('Click the first corner on the 3D terrain. A RED marker will appear.');
}
async function siteChanged(){
 const sim=window.planetLabApp,site=sim?.config?.geoSource==='earth-dem'?siteKey(sim.anchor):null;
 if(!site){enableSelection(false);state.site=null;state.layers=[];state.current=null;refreshLayerList();return}
 if(site===state.site){updateScene();return}
 enableSelection(false);state.site=site;state.bounds=null;state.current=null;
 try{const loaded=await listSite(site);if(state.site!==site)return;state.layers=loaded;state.current=loaded.at(-1)?.id||null}catch(error){state.layers=[];report('Browser scenario storage unavailable: '+error.message,true)}
 refreshLayerList();updateScene();report(state.layers.length?`${state.layers.length} local scenario(s) restored.`:'Select a patch to create a scenario.');
}
window.addEventListener('planetlab:scenario-point',event=>{
 if(!state.selecting)return;
 const point=event.detail;
 if(!state.first){state.first=point;window.planetLabApp?.world?.drawScenarioFirstCorner(point);$('scenarioPick').textContent='Cancel selection · click corner 2';report('Red marker placed. Click the opposite corner to complete the RED rectangle.');return}
 try{state.bounds=patchBounds(state.first,point);enableSelection(false);window.planetLabApp.world.drawScenarioBounds(state.bounds);
  patchPreview();report('Patch ready. Enter an edit instruction and choose AI provider.');}
 catch(error){enableSelection(false);report(error.message,true)}
});
$('scenarioPick').onclick=()=>{
 const sim=window.planetLabApp;
 if(!sim?.config||sim.world.mode!=='region'){report('Open a real Earth location in Local terrain first.',true);return}
 enableSelection(!state.selecting)
};
$('scenarioProvider').onchange=()=>{$('scenarioKey').value='';$('scenarioKey').placeholder='API key for '+$('scenarioProvider').selectedOptions[0].text;
 report(state.keys[$('scenarioProvider').value]?'Key available in this tab.':'Enter an API key to edit this patch.')};
$('scenarioMode').onchange=updateScene;
$('scenarioSplit').oninput=updateScene;
$('scenarioOpacity').oninput=async()=>{const layer=selected();if(!layer)return;layer.opacity=Number($('scenarioOpacity').value)/100;updateScene()};
$('scenarioOpacity').onchange=async()=>{const layer=selected();if(layer)await put(layer)};
$('scenarioHideBuildings').onchange=updateScene;
$('scenarioBuild').onclick=()=>{const sim=window.planetLabApp,layer=selected();const b=layer?.bounds||state.bounds;if(sim?.config&&b){const x=(b.xMin+b.xMax)/2,z=(b.zMin+b.zMax)/2;sim.changeSite([x,z]);}window.planetLabWorkflow?.show('build')};
$('scenarioDuplicate').onclick=async()=>{
 const layer=selected();if(!layer){report('Select a variant to duplicate.',true);return}
 const copy={...layer,id:crypto.randomUUID(),name:layer.name+' copy',created:Date.now(),visible:true};
 await put(copy);state.layers.push(copy);state.current=copy.id;refreshLayerList();updateScene();report('Variant duplicated.')
};
$('scenarioRemove').onclick=async()=>{
 const layer=selected();if(!layer)return;
 await remove(layer.id);state.layers=state.layers.filter(l=>l.id!==layer.id);state.current=null;
 refreshLayerList();updateScene();report('Scenario deleted. Original map imagery remains unchanged.');
};
$('scenarioGenerate').onclick=async()=>{
 const sim=window.planetLabApp,session=window.planetLabAuthState,button=$('scenarioGenerate');
 if(state.busy)return;
 if(!session?.user||!session.csrf){report('Sign in to generate an AI scenario.',true);return}
 if(siteKey(sim?.anchor)!==state.site||!state.bounds){report('Select a patch on the terrain first.',true);return}
 const provider=$('scenarioProvider').value,prompt=$('scenarioPrompt').value.trim();
 if(prompt.length<4||prompt.length>1500){report('Enter a prompt (4–1500 characters).',true);return}
 const typed=$('scenarioKey').value.trim(),metaHeaders=getAiHeaders('/api/ai/scenario-edit');
 const key=typed||state.keys[provider]||(provider==='meta'?metaHeaders['X-PlanetLab-Meta-Key']:'');
 if(!key){report('Enter your '+provider+' key; keys are only held in this tab.',true);return}
 let source;
 try{source=patchPreview()}catch(error){report(error.message,true);return}
 if(state.layers.length>=24){report('Maximum 24 local scenarios per site. Delete one to add another.',true);return}
 const requestSite=state.site,requestBounds={...state.bounds};
 state.busy=true;button.disabled=true;window.planetLabApp?.world?.setScenarioJob(true,requestBounds);report('Generating visual variant using '+provider+'… (one billed call)');
 try{
  const response=await fetch('/api/ai/scenario-edit',{method:'POST',cache:'no-store',credentials:'same-origin',
   headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf,
    ['X-PlanetLab-'+(provider==='xai'?'XAI':provider==='meta'?'Meta':'OpenAI')+'-Key']:key},
   body:JSON.stringify({provider,prompt,image:source,size:selectedResolution()})});
  const result=await response.json().catch(()=>({error:'Invalid provider response'}));
  if(!response.ok)throw new Error(result.error||`Image edit failed (HTTP ${response.status})`);
  if(siteKey(sim.anchor)!==requestSite||state.site!==requestSite)throw new Error('Location changed while generating. Result was not applied.');
  const output=await fetch(result.image).then(r=>r.blob());
  if(!output.type.startsWith('image/')||output.size>9_000_000)throw new Error('Unexpected edited-image format');
  const layer={id:crypto.randomUUID(),site:state.site,name:prompt.slice(0,45),bounds:requestBounds,provider,
   model:result.model,prompt,created:Date.now(),visible:true,opacity:1,renderSize:selectedResolution(),blob:output};
  await put(layer);state.layers.push(layer);state.current=layer.id;state.keys[provider]=key;$('scenarioKey').value='';
  $('scenarioMode').value='edited';$('scenarioOpacity').value='100';refreshLayerList();updateScene();
  report('Scenario saved in this browser. Base imagery and physical buildings are untouched.');
 }catch(error){report(error.message,true)}finally{state.busy=false;button.disabled=false;window.planetLabApp?.world?.setScenarioJob(false,requestBounds)}
};
window.addEventListener('planetlab:site-selected',siteChanged);
window.addEventListener('planetlab:site-changed',siteChanged);
window.addEventListener('planetlab:imagery-ready',()=>{siteChanged();updateScene()});
window.addEventListener('planetlab:view-changed',()=>{const sim=window.planetLabApp;if(sim?.world?.mode==='planet')enableSelection(false)});
if(window.planetLabApp?.config)siteChanged();
