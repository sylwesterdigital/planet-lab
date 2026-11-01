import {tracedFetch,openApiConsole} from './api-console.mjs?v=0.4.13';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {getAiHeaders,selectedModel,connected,openAiSetup} from './ai-connections.mjs?v=0.4.13';

const $=id=>document.getElementById(id);
let csrf='', activeUser=null, currentBuilding=null, buildingGroup=null, libraryGroup=null, currentJob=null;
const libLoader = new GLTFLoader();
const notice=(msg)=>{$('studioStatus').textContent=msg};
const showResult=(b,siteRelief)=>{
  const panel=$('buildingResult');if(!panel)return;panel.hidden=false;
  const gross=(Number(b.width)*Number(b.depth)*Number(b.floors)).toFixed(0);
  const rooms=Number(b.interiorRooms)||0;
  panel.replaceChildren();
  const heading=document.createElement('strong');heading.textContent=b.name||'Concept building';panel.append(heading);
  const info=document.createElement('p');info.textContent=`${b.width} × ${b.depth} m · ${b.floors} floor(s) · ${gross} m² gross floor area · ${rooms} room(s) per floor`;panel.append(info);
  const constraint=document.createElement('small');constraint.textContent=siteRelief>1.5
    ?`Site varies by roughly ${siteRelief.toFixed(1)} m beneath the footprint. Grading/foundation assessment needed; dimensions are conceptual.`
    :'Editable 3D massing only. No structural, energy, access or planning compliance checks.';panel.append(constraint);
};
async function api(path,options={}){
  const method=options.method||'GET';const headers={...(!(options.body instanceof FormData)&&options.body?{'Content-Type':'application/json'}:{}),...getAiHeaders(path),...(options.headers||{})};
  if(method!=='GET')headers['X-CSRF-Token']=csrf;
  const r=await tracedFetch(path,{credentials:'same-origin',...options,headers});
  const obj=await r.json().catch(()=>({error:'Invalid API response'}));
  if(!r.ok)throw new Error(obj.error||`HTTP ${r.status}`);
  return obj;
}
const asNumber=(id,low,hi)=>Math.max(low,Math.min(hi,Number($(id).value)||low));
function sim(){const s=window.planetLabApp;if(!s?.world)throw new Error('Three.js scene is unavailable');return s}
function box(group,x,y,z,w,h,d,color,extras={}){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.78,...extras}));
  m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;
}
function roof(group,w,h,d,style){
  if(style==='flat'){box(group,0,h+.2,0,w+.45,.33,d+.45,'#495d64');return}
  const slope=style==='gable'?.47:.24;
  for(const side of [-1,1]){
    const slab=box(group,side*w*.25,h+slope*w*.25,0,w*.57,.18,d+.55,'#66767a');
    slab.rotation.z=-side*Math.atan(slope);
  }
}
function specFromInputs(){
  return {name:'Edited building',width:asNumber('bWidth',3,30),depth:asNumber('bDepth',3,30),
    floors:asNumber('bFloors',1,20),floorHeight:3,
    roof:$('bRoof').value,style:$('bStyle').value,windowsPerSide:asNumber('bWindows',1,9),
    interiorRooms:asNumber('bRooms',1,16),editable:true,engineeringVerified:false,source:'user-edited',units:'m'};
}
function setInputs(b){
  for(const [id,key] of [['bWidth','width'],['bDepth','depth'],['bFloors','floors'],['bWindows','windowsPerSide'],['bRooms','interiorRooms'],['bRoof','roof'],['bStyle','style']])
    if($(id)&&b[key]!=null)$(id).value=String(b[key]);
}
function putBuilding(b,store=true){
  const s=sim();const x=s.site[0],z=s.site[1],w=Number(b.width),d=Number(b.depth),floors=Math.min(20,Number(b.floors)),fh=Number(b.floorHeight)||3,h=floors*fh;
  if(!Number.isFinite(w*d*h)||w<3||d<3||floors<1)throw new Error('Invalid geometry dimensions');
  const footprint=[[0,0],[-w/20,-d/20],[-w/20,d/20],[w/20,-d/20],[w/20,d/20]];
  const elevations=footprint.map(([dx,dz])=>s.world.height(x+dx,z+dz));
  if(elevations.some(y=>!Number.isFinite(y)))throw new Error('Terrain height unavailable at building site');
  if(Math.min(...elevations)<=.35)throw new Error('The proposed building footprint overlaps water or exposed shoreline. Select a drier site.');
  const relief=(Math.max(...elevations)-Math.min(...elevations))*10;
  const terrain=Math.max(...elevations);
  if(buildingGroup){s.world.studioGroup.remove(buildingGroup);buildingGroup.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose?.()})}
  buildingGroup=new THREE.Group();buildingGroup.name='planetlab-studio-building';
  buildingGroup.scale.setScalar(.1); // building dimensions in metres; 1 scene unit = 10 m
  s.world.studioGroup.add(buildingGroup); // Studio is visible only in local terrain mode.
  buildingGroup.position.set(x,terrain+.042,z);
  const material=String(b.material||'').toLowerCase();
  const color=material.includes('wood')||material.includes('timber')?'#b38a65':material.includes('brick')?'#b77869':material.includes('glass')?'#a1b6b4':
    ({modern:'#cfcbc0',industrial:'#8c999d',rustic:'#c6a780',futuristic:'#a8c8d3',traditional:'#dfc4b1'}[b.style]||'#c8c8c8');
  box(buildingGroup,0,-.2,0,w+.45,.4,d+.45,'#888c86');
  for(let floor=0;floor<floors;floor++){
    const bottom=floor*fh,top=bottom+fh;
    box(buildingGroup,0,bottom+.1,0,w,.19,d,'#a8a3a0');
    box(buildingGroup,-w/2,bottom+fh/2,0,.15,fh,d,color);
    box(buildingGroup,w/2,bottom+fh/2,0,.15,fh,d,color);
    box(buildingGroup,0,bottom+fh/2,-d/2,w,fh,.15,color);
    // Glazed frontage with transparent panels: openings are visibly readable rather than hidden in an opaque box.
    for(let i=0;i<Math.max(1,Math.min(9,b.windowsPerSide||3));i++){
      const count=Math.max(1,Math.min(9,b.windowsPerSide||3));
      const px=-w*.42+(i+.5)*w*.84/count;
      box(buildingGroup,px,bottom+fh*.57,d/2+.085,Math.min(.85,w*.75/count),.9,.055,'#598eab',{metalness:.35,roughness:.27});
    }
    if(floor===0){
      box(buildingGroup,0,1.05,d/2+.14,1.07,2.1,.12,'#68534a');
      box(buildingGroup,.38,1.12,d/2+.22,.07,.1,.045,'#dbd2a7');
    }
    // Interior partition pieces: intentionally simple editable primitives.
    const partitions=Math.min(5,Math.max(0,(b.interiorRooms||4)-1));
    for(let p=0;p<partitions;p++){
      const px=-w*.33+(p+1)*w*.66/(partitions+1);
      box(buildingGroup,px,bottom+fh*.45,0,.09,fh*.9,d*.66,'#b9afa3',{opacity:.4,transparent:true});
    }
    box(buildingGroup,0,top+.02,0,w,.15,d,'#aaa9a3');
  }
  roof(buildingGroup,w,h,d,b.roof);
  if(store){currentBuilding={...b};if(s.plan){s.plan.studioBuildings=[{...b,position:[x,z]}]}}
  showResult(b,relief);
  if(store){
    s.world.setMode('region');s.updateMode?.();
    s.world.camera.position.set(x+Math.max(5,w/5),terrain+Math.max(3,h/14),z+Math.max(6,d/4));
    s.world.controls.target.set(x,terrain+Math.max(.65,h/25),z);
    s.world.controls.update();
  }
  notice('3D building placed at selected site. Edit dimensions and rebuild to compare.');
}
function enterBuilding(){const s=sim(),b=currentBuilding;if(!b)throw new Error('Create a building first');
  const x=s.site[0],z=s.site[1],y=s.world.height(x,z);
  s.world.setMode('region');s.world.camera.position.set(x+Math.min(.12,b.width/40),y+.2,z+.08);
  s.world.controls.target.set(x,y+.17,z-.15);s.world.controls.update();
  notice('Building camera positioned. Orbit to inspect the conceptual model; this is not an interior walkthrough.');
}
function requireConnection(provider='meta'){
  if(!connected(provider)){
    openAiSetup();
    const error=new Error(`Connect your ${provider==='meta'?'Meta':'Tripo'} API key in AI Setup first.`);
    error.code='AI_KEY_REQUIRED';
    throw error;
  }
}
function currentWorld(){const value=Number($('worldList').value);if(!Number.isInteger(value)||value<1)throw new Error('Save and select a world first');return value}
async function studioAction(fn){try{await fn()}catch(e){notice(e.code==='AI_KEY_REQUIRED'?e.message:`Design not generated: ${e.message}`);if(e.code!=='AI_KEY_REQUIRED')console.error(e)}}
async function listMedia(){const id=currentWorld();const result=await api(`/api/worlds/${id}/media`);
  const select=$('assetList');select.replaceChildren(new Option('Select imported GLB',''));
  for(const item of result.media.filter(m=>/\.glb$/i.test(m.filename)))select.add(new Option(`${item.filename} (${(item.size/1048576).toFixed(1)} MB)`,item.id));
}
function placeAsset(id){const s=sim();if(!id)throw new Error('Select GLB asset');
  libLoader.load(`/api/media/${encodeURIComponent(id)}/raw`,gltf=>{
    if(!libraryGroup){libraryGroup=new THREE.Group();s.world.scene.add(libraryGroup)}
    const object=gltf.scene;const bounds=new THREE.Box3().setFromObject(object),size=new THREE.Vector3();bounds.getSize(size);
    const scale=2/Math.max(size.x,size.y,size.z,.01);object.scale.setScalar(scale);
    object.position.set(s.site[0]+3,s.world.height(s.site[0]+3,s.site[1]+3)+.2,s.site[1]+3);
    libraryGroup.add(object);notice('GLB placed on terrain near building.');
  },undefined,()=>notice('Unable to load GLB asset'));
}
$('aiBuilding').onclick=()=>studioAction(async()=>{
  requireConnection('meta');
  const button=$('aiBuilding');if(button.disabled)return;button.disabled=true;
  const oldLabel=button.textContent;button.textContent='Generating design…';
  try{
    notice('Meta is preparing a structured building specification.');
    const result=await api('/api/ai/building',{method:'POST',body:JSON.stringify({brief:$('aiBrief').value,tier:$('aiTier').value,model:selectedModel()})});
    currentBuilding=result.building;setInputs(result.building);putBuilding(result.building);
  }finally{button.disabled=false;button.textContent=oldLabel}
});
$('manualBuilding').onclick=()=>studioAction(()=>{const b=specFromInputs();putBuilding(b)});
$('enterBuilding').onclick=()=>studioAction(enterBuilding);
$('aiImage').onclick=()=>studioAction(async()=>{
  requireConnection('meta');notice('Generating concept image…');const id=currentWorld();const d=await api('/api/ai/image',{method:'POST',body:JSON.stringify({world_id:id,prompt:$('aiBrief').value})});
  $('conceptPreview').src=d.url;$('conceptPreview').hidden=false;notice('Concept image saved to world media.');
});
$('tripoCreate').onclick=()=>studioAction(async()=>{
  requireConnection('tripo');const id=currentWorld();const d=await api('/api/ai/tripo',{method:'POST',body:JSON.stringify({world_id:id,prompt:$('tripoPrompt').value})});
  currentJob=d.job_id;$('tripoProgress').textContent=`Task ${currentJob}: queued`;notice('Tripo 3D generation submitted. Use Check job to poll.');
});
$('tripoCheck').onclick=()=>studioAction(async()=>{
  requireConnection('tripo');if(!currentJob)throw new Error('Submit a Tripo job first');const d=await api(`/api/ai/tripo/${currentJob}`);
  $('tripoProgress').textContent=`${d.status} · ${d.progress||0}%`;
  $('tripoImport').disabled=!d.can_import;
});
$('tripoImport').onclick=()=>studioAction(async()=>{
  if(!currentJob)throw new Error('No task');const d=await api(`/api/ai/tripo/${currentJob}/import`,{method:'POST',body:'{}'});
  await listMedia();$('assetList').value=d.media_id;placeAsset(d.media_id);
});
$('analyseCity').onclick=()=>studioAction(async()=>{
  const s=sim(),p=s.plan;if(!p)throw new Error('Generate a masterplan first');
  const counts=new Map();for(const item of p.landuse||[]){counts.set(item.usage,(counts.get(item.usage)||0)+1)}
  const groups=[['Roads',['road','arterial'],'#7e9aaa'],['Residential',['home','workers','temporary','cottage','tower'],'#d6ad8d'],['Industry',['factory','data','power','farm'],'#cda278'],['Nature',['forest','park','pond','protected'],'#69a978'],['Other',['mall','hotel','spa','station','airport','stadium'],'#ba9bc7']];
  const chart=$('cityAnalysis'),ctx=chart.getContext('2d');ctx.clearRect(0,0,chart.width,chart.height);
  const vals=groups.map(([name,kinds,color])=>({name,value:kinds.reduce((sum,k)=>sum+(counts.get(k)||0),0),color}));
  const max=Math.max(1,...vals.map(v=>v.value));ctx.font='12px sans-serif';
  vals.forEach((v,i)=>{const y=12+i*30;ctx.fillStyle='#d8e6eb';ctx.fillText(v.name,9,y+14);ctx.fillStyle=v.color;ctx.fillRect(103,y+1,Math.round(v.value/max*165),16);ctx.fillStyle='#d8e6eb';ctx.fillText(String(v.value),274,y+14)});
  const structures=(p.tasks||[]).filter(t=>t.stage==='structure').length;
  $('cityAnalysisNote').textContent=`${structures} planned building structures · ${p.landuse.length} land-use cells · $${Number(p.stats?.estimatedCost||0).toFixed(2)}M estimated simulation cost. No live GIS or market valuation.`;
});
$('assetRefresh').onclick=()=>studioAction(listMedia);
$('assetPlace').onclick=()=>studioAction(()=>placeAsset($('assetList').value));
// Persist the parametric studio building alongside the original procedural blueprint.
window.planetLabStudio={applyStored:(plan)=>{const b=plan?.studioBuildings?.[0];if(b){currentBuilding=b;setInputs(b);putBuilding(b,false)}},getBuilding:()=>currentBuilding};
window.addEventListener('planetlab:site-changed',()=>{
  if(buildingGroup){const group=window.planetLabApp?.world?.studioGroup;group?.remove(buildingGroup);
    buildingGroup.traverse(o=>{o.geometry?.dispose();o.material?.dispose?.()});buildingGroup=null}
  currentBuilding=null;if($('buildingResult'))$('buildingResult').hidden=true;
});
window.addEventListener('planetlab:auth-changed', event=>{
  csrf=event.detail.csrf;activeUser=event.detail.user;
});
if(window.planetLabAuthState){csrf=window.planetLabAuthState.csrf;activeUser=window.planetLabAuthState.user;}
