import {tracedFetch,openApiConsole} from './api-console.mjs';
import {getAiHeaders} from './ai-connections.mjs?v=0.4.32';
import {siteKey} from './scenario-core.mjs';
import {getProviderKey,setProviderKey} from './provider-keys.mjs';

const $=id=>document.getElementById(id);
const state={
 site:null,
 items:[],
 current:null,
 keys:{meta:'',xai:'',openai:''},
 busy:false,
 selecting:false,
 rect:null,
 history:[],
 future:[],
 drag:null,
 viewerScale:1,
 composition:{
  selecting:false,
  rect:null,
  drag:null,
  history:[],
  future:[]
 }
};
let dbPromise=null;

function status(msg,error=false){
 const e=$('perspectiveStatus');
 if(e){e.textContent=msg;e.style.color=error?'#ffb4ae':''}
}
function db(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open('planetlab-perspective-gallery-v2',2);
  req.onupgradeneeded=()=>{
   const database=req.result;
   const store=database.objectStoreNames.contains('items')
    ? req.transaction.objectStore('items')
    : database.createObjectStore('items',{keyPath:'id'});
   if(!store.indexNames.contains('site'))store.createIndex('site','site',{unique:false});
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
 });
 return dbPromise;
}
async function listSite(site){
 const database=await db();
 return new Promise((resolve,reject)=>{
  const req=database.transaction('items','readonly').objectStore('items').index('site').getAll(site);
  req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>b.created-a.created));
  req.onerror=()=>reject(req.error);
 });
}
async function put(item){
 const database=await db();
 return new Promise((resolve,reject)=>{
  const req=database.transaction('items','readwrite').objectStore('items').put(stripRuntimeFields(item));
  req.onsuccess=()=>resolve();
  req.onerror=()=>reject(req.error);
 });
}
async function removeItem(id){
 const database=await db();
 return new Promise((resolve,reject)=>{
  const req=database.transaction('items','readwrite').objectStore('items').delete(id);
  req.onsuccess=()=>resolve();
  req.onerror=()=>reject(req.error);
 });
}

function stripRuntimeFields(item){
 return JSON.parse(JSON.stringify(item,(key,value)=>key.startsWith('_')?undefined:value));
}
function overlay(){return $('perspectiveOverlay')}
function selectionBox(){return $('perspectiveSelection')}
function sceneCanvas(){return $('scene')}
function currentSite(){return siteKey(window.planetLabApp?.anchor)}
function previewModal(){return $('perspectivePreviewModal')}
function previewImage(){return $('perspectivePreviewImage')}
function previewBusy(){return $('perspectivePreviewBusy')}
function viewer(){return $('perspectiveGalleryViewer')}
function viewerFrame(){return $('galleryViewerFrame')}
function viewerStage(){return $('galleryViewerStage')}
function viewerSelection(){return $('galleryViewerSelection')}
function viewerLayerList(){return $('galleryViewerLayers')}
function viewerHistoryList(){return $('galleryViewerHistory')}
function currentItem(){return state.items.find(i=>i.id===state.current)||null}
function selected(){return currentItem()}

function hidePreview(){
 const m=previewModal();
 if(m)m.hidden=true;
 const image=previewImage();
 if(image){image.hidden=true;image.removeAttribute('src')}
 if(previewBusy())previewBusy().hidden=true;
}
function aspectRatio(){return $('perspectiveAspect')?.value||'free'}
function resolution(){return Math.max(512,Number($('perspectiveResolution').value)||1024)}
function siteWorld(){return window.planetLabApp?.world}
function hasOpenComposition(){return !viewer().hidden && !!currentItem()}
function activeSourceMode(){return hasOpenComposition()?'composition':'perspective'}

function setBusy(on,message=''){
 const hint=$('perspectiveBusyHint');
 if(hint)hint.textContent=on?(message||'Processing…'):'Idle';
 const busy=previewBusy();
 if(busy){busy.hidden=!on;busy.textContent=message||'Processing with AI…';}
 const generate=$('perspectiveGenerate');
 if(generate){generate.disabled=on;generate.textContent=on?'Generating…':'Generate perspective concept'}
 const review=$('perspectiveReview');
 if(review)review.disabled=on;
 const addPatch=$('galleryViewerDrawPatch');
 if(addPatch)addPatch.disabled=on;
}

function outputSize(longEdge=1024,rect=state.rect){
 const choice=aspectRatio();
 const canvas=sceneCanvas();const view=canvas?.getBoundingClientRect();
 let ratio=(rect&&rect.w&&rect.h)?(rect.w*(view?.width||1))/Math.max(rect.h*(view?.height||1),.0001):1;
 if(choice!=='free'){const [rw,rh]=choice.split(':').map(Number); if(rw>0&&rh>0)ratio=rw/rh;}
 let width,height;
 if(ratio>=1){width=longEdge;height=Math.max(512,Math.round(longEdge/ratio));}
 else{height=longEdge;width=Math.max(512,Math.round(longEdge*ratio));}
 return {width:Math.max(64,width),height:Math.max(64,height),ratio};
}

function normalizeRect(a,b,bounds,lockedRatio=null){
 let w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);
 const dirX=b.x>=a.x?1:-1,dirY=b.y>=a.y?1:-1;
 if(lockedRatio&&lockedRatio>0){
  if(w/Math.max(h,.0001)>lockedRatio)h=w/lockedRatio; else w=h*lockedRatio;
 }
 let x=a.x+(dirX<0?-w:0),y=a.y+(dirY<0?-h:0);
 if(x<0){w+=x;x=0} if(y<0){h+=y;y=0} if(x+w>1)w=1-x; if(y+h>1)h=1-y;
 return {x,y,w,h};
}
function normalizeSceneRect(a,b){
 const choice=aspectRatio();
 let ratio=null;
 if(choice!=='free'){
  const [rw,rh]=choice.split(':').map(Number);
  const view=sceneCanvas()?.getBoundingClientRect();
  const viewRatio=(view?.width||1)/(view?.height||1);
  if(rw>0&&rh>0)ratio=(rw/rh)/viewRatio;
 }
 return normalizeRect(a,b,null,ratio);
}

function drawRect(rect){
 const box=selectionBox();if(!box)return;
 if(!rect){box.classList.remove('active');box.style.display='none';return;}
 box.style.display='block';box.classList.add('active');
 box.style.left=(rect.x*100)+'%';box.style.top=(rect.y*100)+'%';
 box.style.width=(rect.w*100)+'%';box.style.height=(rect.h*100)+'%';
}
function setRect(rect,push=true){
 state.rect=rect?{...rect}:null;drawRect(state.rect);
 if(rect&&push){state.history.push({...rect});if(state.history.length>24)state.history.shift();state.future=[]}
 if(rect){
  try{captureView(rect,outputSize(1024,rect));status('Perspective patch ready. Press Enter to review the exact image that will be sent to AI.')}catch(error){status(error.message,true)}
 }
}
function enableSelection(enable){
 state.selecting=!!enable;
 const o=overlay();o.hidden=!enable&&!state.rect;o.classList.toggle('active',enable);
 $('drawingModeBanner').hidden=!enable;
 $('perspectivePick').classList.toggle('drawing-active',enable);
 $('perspectivePick').setAttribute('aria-pressed',String(enable));
 $('perspectivePick').textContent=enable?'Cancel drawing':'Draw perspective patch';
 if(!enable){state.drag=null;const controls=siteWorld()?.controls;if(controls&&siteWorld()?.mode==='region')controls.enabled=true}
 status(enable?'DRAWING MODE: drag on the map to draw your rectangle.':state.rect?'Patch ready. Review image or generate concept.':'Draw a rectangle on the current 3D view to begin.');
}
function pointerPoint(ev){const r=overlay().getBoundingClientRect();const x=(ev.clientX-r.left)/r.width,y=(ev.clientY-r.top)/r.height;return {x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))}}
function onPointerDown(ev){if(!state.selecting||siteWorld()?.mode!=='region')return;ev.preventDefault();state.drag={start:pointerPoint(ev),current:pointerPoint(ev)};siteWorld()?.controls&&(siteWorld().controls.enabled=false);updateDrag()}
function updateDrag(){if(!state.drag)return;drawRect(normalizeSceneRect(state.drag.start,state.drag.current))}
function onPointerMove(ev){if(!state.drag)return;ev.preventDefault();state.drag.current=pointerPoint(ev);updateDrag()}
function onPointerUp(ev){
 if(!state.drag)return;ev.preventDefault();state.drag.current=pointerPoint(ev);
 const a=state.drag.start,b=state.drag.current;state.drag=null;siteWorld()?.controls&&(siteWorld().controls.enabled=true);
 const rect=normalizeSceneRect(a,b);
 if(rect.w<0.03||rect.h<0.03){status('Perspective patch too small. Drag a larger rectangle.',true);drawRect(state.rect);return}
 setRect(rect,true);enableSelection(false);$('perspectiveReview').focus({preventScroll:true});
}

function viewerPointer(ev){
 const r=viewerStage().getBoundingClientRect();
 return {x:Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(ev.clientY-r.top)/r.height))};
}
function drawViewerRect(rect){
 const box=viewerSelection();
 if(!box)return;
 if(!rect){box.hidden=true;box.style.display='none';return;}
 box.hidden=false;box.style.display='block';
 box.style.left=(rect.x*100)+'%';box.style.top=(rect.y*100)+'%';box.style.width=(rect.w*100)+'%';box.style.height=(rect.h*100)+'%';
}
function compositionAspect(item){
 const w=item?.canvasWidth||item?.resolution||1024;
 const h=item?.canvasHeight||item?.resolution||1024;
 return `${w} / ${h}`;
}
function setCompositionRect(rect,push=true){
 state.composition.rect=rect?{...rect}:null;
 drawViewerRect(state.composition.rect);
 if(rect&&push){
  state.composition.history.push({type:'selection',rect:{...rect},at:Date.now(),label:'Selection updated'});
  if(state.composition.history.length>50)state.composition.history.shift();
  state.composition.future=[];
 }
 updateViewerMeta();
}
function enableCompositionSelection(enable){
 state.composition.selecting=!!enable;
 $('galleryViewerDrawPatch').classList.toggle('drawing-active',enable);
 $('galleryViewerDrawPatch').textContent=enable?'Cancel patch':'Draw patch on image';
 $('galleryViewerSelectionHint').textContent=enable?'Drag on the image to select the next AI patch.':state.composition.rect?'Patch ready on the composition.':'Select a composition patch to generate another layer.';
 if(!enable)state.composition.drag=null;
}
function onViewerPointerDown(ev){if(!state.composition.selecting)return;ev.preventDefault();state.composition.drag={start:viewerPointer(ev),current:viewerPointer(ev)};updateViewerDrag()}
function updateViewerDrag(){if(!state.composition.drag)return;const rect=normalizeRect(state.composition.drag.start,state.composition.drag.current,null,null);drawViewerRect(rect)}
function onViewerPointerMove(ev){if(!state.composition.drag)return;ev.preventDefault();state.composition.drag.current=viewerPointer(ev);updateViewerDrag()}
function onViewerPointerUp(ev){
 if(!state.composition.drag)return;ev.preventDefault();
 state.composition.drag.current=viewerPointer(ev);
 const rect=normalizeRect(state.composition.drag.start,state.composition.drag.current,null,null);
 state.composition.drag=null;
 if(rect.w<0.03||rect.h<0.03){status('Composition patch too small. Drag a larger rectangle.',true);drawViewerRect(state.composition.rect);return}
 setCompositionRect(rect,true);enableCompositionSelection(false);
 try{showPreview(resolution());status('Review the exact composition patch before generating the next layer.')}catch(error){status(error.message,true)}
}

function resetViewerHistory(){state.composition.history=[];state.composition.future=[];renderViewerHistory()}
function pushCompositionHistory(label='Updated composition'){
 const item=currentItem();
 if(!item)return;
 state.composition.history.push({label,at:Date.now(),layers:JSON.parse(JSON.stringify(item.layers))});
 if(state.composition.history.length>60)state.composition.history.shift();
 state.composition.future=[];
 renderViewerHistory();
}
function applyCompositionSnapshot(stack){
 const item=currentItem();
 if(!item||!stack)return;
 item.layers=JSON.parse(JSON.stringify(stack));
 if(!item.layers.some(layer=>layer.id===item.activeLayerId))item.activeLayerId=item.layers[item.layers.length-1]?.id||null;
 renderComposition();
 put(item).catch(()=>{});
}
function undoComposition(){
 const item=currentItem();
 if(!item||!state.composition.history.length){status('Nothing to undo in this composition.',true);return}
 state.composition.future.push({label:'redo',at:Date.now(),layers:JSON.parse(JSON.stringify(item.layers))});
 const previous=state.composition.history.pop();
 if(previous?.layers)applyCompositionSnapshot(previous.layers);
 renderViewerHistory();
 status('Composition change undone.');
}
function redoComposition(){
 const item=currentItem();
 if(!item||!state.composition.future.length){status('Nothing to redo in this composition.',true);return}
 state.composition.history.push({label:'undo',at:Date.now(),layers:JSON.parse(JSON.stringify(item.layers))});
 const next=state.composition.future.pop();
 if(next?.layers)applyCompositionSnapshot(next.layers);
 renderViewerHistory();
 status('Composition change restored.');
}

function restoreView(view){
 const world=siteWorld();if(!world||!view)return;
 const c=world.camera,t=world.controls?.target;
 if(c&&view.camera&&['x','y','z'].every(k=>Number.isFinite(view.camera[k])))c.position.set(view.camera.x,view.camera.y,view.camera.z);
 if(t&&view.target&&['x','y','z'].every(k=>Number.isFinite(view.target[k]))){t.set(view.target.x,view.target.y,view.target.z);world.controls.update()}
 world.render?.();
}
function layerSrc(layer){
 if(layer.image)return layer.image;
 if(layer._url)return layer._url;
 if(layer.blob){layer._url=URL.createObjectURL(layer.blob);return layer._url;}
 return '';
}
function imageToDataUrl(source){
 if(!source)return Promise.resolve('');
 if(typeof source==='string'&&source.startsWith('data:'))return Promise.resolve(source);
 return fetch(source).then(r=>r.blob()).then(blobToDataUrl);
}
function blobToDataUrl(blob){
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=()=>reject(reader.error||new Error('Failed to load image data'));
  reader.readAsDataURL(blob);
 });
}
async function normalizeLoadedItem(item){
 const normalized={...item};
 if(Array.isArray(normalized.layers)&&normalized.layers.length){
  normalized.layers=normalized.layers.map((layer,index)=>({
   id:layer.id||crypto.randomUUID(),
   name:layer.name||`Layer ${index+1}`,
   type:layer.type||'generated',
   visible:layer.visible!==false,
   opacity:Number.isFinite(layer.opacity)?layer.opacity:1,
   rect:layer.rect||{x:0,y:0,w:1,h:1},
   image:layer.image||'',
   provider:layer.provider||normalized.provider||'',
   prompt:layer.prompt||normalized.prompt||'',
   created:layer.created||normalized.created||Date.now()
  }));
  normalized.activeLayerId=normalized.activeLayerId||normalized.layers[normalized.layers.length-1]?.id||null;
  return normalized;
 }
 const image=normalized.blob?await blobToDataUrl(normalized.blob):normalized.image||'';
 normalized.baseImage=normalized.baseImage||image;
 normalized.canvasWidth=normalized.canvasWidth||normalized.width||1024;
 normalized.canvasHeight=normalized.canvasHeight||normalized.height||1024;
 normalized.layers=[];
 if(normalized.baseImage)normalized.layers.push({id:'base-'+(normalized.id||crypto.randomUUID()),name:'Base source',type:'base',visible:true,opacity:1,rect:{x:0,y:0,w:1,h:1},image:normalized.baseImage,created:normalized.created||Date.now()});
 if(image)normalized.layers.push({id:crypto.randomUUID(),name:normalized.name||'AI concept',type:'generated',visible:true,opacity:1,rect:{x:0,y:0,w:1,h:1},image,provider:normalized.provider||'',prompt:normalized.prompt||'',created:normalized.created||Date.now()});
 normalized.activeLayerId=normalized.layers[normalized.layers.length-1]?.id||normalized.layers[0]?.id||null;
 delete normalized.blob;
 return normalized;
}
function galleryThumb(item){
 const top=[...(item.layers||[])].filter(layer=>layer.visible!==false).slice().reverse().find(Boolean) || item.layers?.[item.layers.length-1] || null;
 if(top)return layerSrc(top);
 if(item.baseImage)return item.baseImage;
 return '';
}

function closeGallery(){
 viewer().hidden=true;
 $('galleryViewerImage').removeAttribute('src');
 $('galleryViewerImage').hidden=true;
 viewerStage().replaceChildren();
 state.viewerScale=1;
 state.composition.rect=null;
 drawViewerRect(null);
 enableCompositionSelection(false);
 resetViewerHistory();
}
function renderViewerHistory(){
 const root=viewerHistoryList(); if(!root)return;
 root.replaceChildren();
 const entries=state.composition.history.slice(-6).reverse();
 if(!entries.length){root.textContent='No composition edits yet.';return}
 for(const entry of entries){
  const row=document.createElement('div'); row.className='viewer-history-item';
  row.textContent=(entry.label||'Edit')+' · '+new Date(entry.at||Date.now()).toLocaleTimeString();
  root.append(row);
 }
}
function updateViewerMeta(){
 const item=currentItem();
 $('galleryViewerMeta').textContent=item?`Layers: ${item.layers.length} · ${Math.round((state.composition.rect?.w||1)*100)}% width patch ready`:'';
}
function renderComposition(){
 const item=currentItem();
 if(!item)return;
 const stage=viewerStage();
 const selection=viewerSelection();
 stage.replaceChildren();
 if(selection)stage.append(selection);
 stage.style.aspectRatio=compositionAspect(item);
 stage.style.transform=`scale(${state.viewerScale})`;
 stage.style.transformOrigin='center center';
 const layers=item.layers||[];
 layers.forEach((layer,index)=>{
  if(layer.visible===false)return;
  const img=document.createElement('img');
  img.className='composition-layer';
  if(layer.id===item.activeLayerId)img.classList.add('selected');
  img.src=layerSrc(layer);
  img.alt=layer.name||`Layer ${index+1}`;
  img.style.left=((layer.rect?.x||0)*100)+'%';
  img.style.top=((layer.rect?.y||0)*100)+'%';
  img.style.width=((layer.rect?.w||1)*100)+'%';
  img.style.height=((layer.rect?.h||1)*100)+'%';
  img.style.opacity=String(layer.opacity??1);
  img.style.zIndex=String(index+1);
  img.addEventListener('click',ev=>{ev.stopPropagation();item.activeLayerId=layer.id;renderComposition();renderLayerList();});
  stage.append(img);
 });
 $('galleryViewerImage').hidden=true;
 renderLayerList();
 drawViewerRect(state.composition.rect);
 updateViewerMeta();
}
function renderLayerList(){
 const item=currentItem();
 const root=viewerLayerList(); if(!root)return;
 root.replaceChildren();
 if(!item?.layers?.length){root.textContent='No layers.';return}
 item.layers.forEach((layer,index)=>{
  const row=document.createElement('div'); row.className='viewer-layer-row'+(layer.id===item.activeLayerId?' active':'');
  const pick=document.createElement('button'); pick.type='button'; pick.className='viewer-layer-pick'; pick.textContent=layer.name||`Layer ${index+1}`; pick.onclick=()=>{item.activeLayerId=layer.id;renderComposition()};
  const eye=document.createElement('button'); eye.type='button'; eye.className='viewer-layer-eye'; eye.textContent=layer.visible===false?'Show':'Hide'; eye.onclick=async()=>{pushCompositionHistory((layer.visible===false?'Show ':'Hide ')+(layer.name||'layer')); layer.visible=layer.visible===false; await put(item); renderComposition();};
  row.append(pick,eye); root.append(row);
 });
}
function showGalleryImage(id){
 const item=state.items.find(candidate=>candidate.id===id);
 if(!item)return;
 state.current=item.id;
 state.viewerScale=1;
 $('galleryViewerTitle').textContent=item.name||'Perspective composition';
 viewer().hidden=false;
 state.composition.rect=null;
 drawViewerRect(null);
 enableCompositionSelection(false);
 resetViewerHistory();
 renderComposition();
 refreshGallery();
}
function nextGallery(direction){if(!state.items.length)return;const i=state.items.findIndex(item=>item.id===state.current);showGalleryImage(state.items[(i+direction+state.items.length)%state.items.length].id)}
function zoomGallery(direction){state.viewerScale=Math.max(.5,Math.min(4,state.viewerScale+(direction>0?.25:-.25)));renderComposition()}

$('galleryViewerClose').onclick=()=>closeGallery();
$('galleryViewerPrevious').onclick=()=>nextGallery(-1);
$('galleryViewerNext').onclick=()=>nextGallery(1);
$('galleryViewerZoomIn').onclick=()=>zoomGallery(1);
$('galleryViewerZoomOut').onclick=()=>zoomGallery(-1);
$('galleryViewerUndo').onclick=()=>undoComposition();
$('galleryViewerRedo').onclick=()=>redoComposition();
$('galleryViewerDrawPatch').onclick=()=>{if(!currentItem()){status('Open a composition first.',true);return}enableCompositionSelection(!state.composition.selecting)};
$('galleryViewerMoveUp').onclick=async()=>{
 const item=currentItem(); if(!item)return;
 const idx=item.layers.findIndex(layer=>layer.id===item.activeLayerId); if(idx<1){status('Selected layer is already at the top.',true);return}
 pushCompositionHistory('Move layer up');
 [item.layers[idx-1],item.layers[idx]]=[item.layers[idx],item.layers[idx-1]]; await put(item); renderComposition(); status('Layer moved up.');
};
$('galleryViewerMoveDown').onclick=async()=>{
 const item=currentItem(); if(!item)return;
 const idx=item.layers.findIndex(layer=>layer.id===item.activeLayerId); if(idx<0||idx>=item.layers.length-1){status('Selected layer is already at the bottom.',true);return}
 pushCompositionHistory('Move layer down');
 [item.layers[idx],item.layers[idx+1]]=[item.layers[idx+1],item.layers[idx]]; await put(item); renderComposition(); status('Layer moved down.');
};
$('galleryViewerToggle').onclick=async()=>{
 const item=currentItem(); const layer=item?.layers?.find(candidate=>candidate.id===item.activeLayerId); if(!layer){status('Select a layer first.',true);return}
 pushCompositionHistory(layer.visible===false?'Show layer':'Hide layer');
 layer.visible=layer.visible===false; await put(item); renderComposition(); status(layer.visible===false?'Layer hidden.':'Layer shown.');
};
$('galleryViewerDelete').onclick=async()=>{
 const item=currentItem(); const idx=item?.layers?.findIndex(candidate=>candidate.id===item.activeLayerId)??-1; if(idx<0){status('Select a layer first.',true);return}
 const layer=item.layers[idx]; if(layer.type==='base'){status('Base source layer cannot be deleted.',true);return}
 pushCompositionHistory('Delete layer');
 item.layers.splice(idx,1); item.activeLayerId=item.layers[Math.max(0,idx-1)]?.id||item.layers[0]?.id||null; await put(item); renderComposition(); status('Layer removed from the composition.');
};

viewerFrame().addEventListener('wheel',e=>{if(viewer().hidden)return;e.preventDefault();zoomGallery(e.deltaY<0?1:-1)},{passive:false});
['pointerdown','pointermove','pointerup','pointerleave'].forEach(type=>viewerFrame().addEventListener(type,ev=>({pointerdown:onViewerPointerDown,pointermove:onViewerPointerMove,pointerup:onViewerPointerUp,pointerleave:onViewerPointerUp})[type](ev)));
document.addEventListener('keydown',e=>{
 if(viewer().hidden)return;
 if(e.key==='Escape'){if(state.composition.selecting)enableCompositionSelection(false); else closeGallery();e.stopImmediatePropagation()}
 if(e.key==='ArrowLeft'){nextGallery(-1);e.preventDefault()}
 if(e.key==='ArrowRight'){nextGallery(1);e.preventDefault()}
});

function refreshGallery(){
 const root=$('perspectiveGallery');root.replaceChildren();
 if(!state.items.length){root.textContent='No perspective concepts for this location.';return}
 for(const item of state.items){
  const row=document.createElement('div');row.className='perspective-item'+(item.id===state.current?' chosen':'');
  const button=document.createElement('button');button.type='button';button.className='perspective-thumb';
  button.setAttribute('aria-label','Open full-size image: '+(item.name||'Perspective concept'));
  button.onclick=()=>showGalleryImage(item.id);
  const img=document.createElement('img');img.alt='';img.src=galleryThumb(item);
  const wrap=document.createElement('div');
  const name=document.createElement('strong');name.textContent=item.name||item.prompt?.slice(0,36)||'Perspective concept';
  const meta=document.createElement('div');meta.className='hint';meta.textContent=(item.layers?.length||0)+' layers · '+new Date(item.created).toLocaleString();
  wrap.append(name,meta);button.append(img,wrap);row.append(button);root.append(row);
 }
}

async function loadSite(){
 if(currentSite()===state.site&&state.items.length)return;
 hidePreview();closeGallery();enableSelection(false);
 state.site=currentSite();state.current=null;
 state.items=[];
 if(!state.site){refreshGallery();return}
 state.rect=null;state.history=[];state.future=[];drawRect(null);overlay().hidden=true;
 try{
  const raw=await listSite(state.site);
  state.items=[];
  for(const item of raw)state.items.push(await normalizeLoadedItem(item));
 }catch(error){status('Perspective gallery unavailable: '+error.message,true)}
 state.current=state.items[0]?.id||null;refreshGallery()
}

function captureView(rect,size=1024){
 const world=siteWorld(),canvas=sceneCanvas();
 if(!canvas||!world||world.mode!=='region')throw new Error('Open a local 3D terrain view first.');
 const bounds=canvas.getBoundingClientRect();
 if(bounds.width<2||bounds.height<2)throw new Error('The 3D scene is not visible.');
 const x=rect.x*canvas.width,y=rect.y*canvas.height,w=rect.w*canvas.width,h=rect.h*canvas.height;
 if(w<8||h<8)throw new Error('Draw a larger rectangle.');
 world.render();
 const dims=typeof size==='number'?{width:size,height:size}:size;
 const out=$('perspectiveCrop');out.width=dims.width;out.height=dims.height;
 const ctx=out.getContext('2d',{willReadFrequently:true});
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.drawImage(canvas,x,y,w,h,0,0,dims.width,dims.height);
 const pixels=ctx.getImageData(0,0,Math.min(dims.width,64),Math.min(dims.height,64)).data;
 let visible=0; for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>16&&(pixels[i]>7||pixels[i+1]>7||pixels[i+2]>7))visible++;
 if(visible<40)throw new Error('Could not capture the 3D scene. Try again after the terrain renders.');
 let image='';
 for(const quality of [.9,.82,.72,.62]){image=out.toDataURL('image/jpeg',quality);if(image.length<=3_250_000)break}
 if(!image.startsWith('data:image/jpeg;base64,')||image.length<500||image.length>3_250_000)throw new Error('The selected image is too large. Choose a smaller output resolution or a smaller crop.');
 return image;
}
function captureCompositionCrop(item,rect,longEdge=1024){
 if(!item)throw new Error('Open a composition first.');
 if(!rect)throw new Error('Select a patch on the generated composition first.');
 const fullW=item.canvasWidth||item.resolution||1024;
 const fullH=item.canvasHeight||item.resolution||1024;
 const ratio=Math.max((rect.w*fullW)/Math.max(rect.h*fullH,.0001),0.01);
 let width,height;
 if(ratio>=1){width=longEdge;height=Math.max(512,Math.round(longEdge/ratio));} else {height=longEdge;width=Math.max(512,Math.round(longEdge*ratio));}
 const out=document.createElement('canvas'); out.width=width; out.height=height;
 const ctx=out.getContext('2d',{willReadFrequently:true});
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 const render=document.createElement('canvas'); render.width=fullW; render.height=fullH;
 const rctx=render.getContext('2d',{willReadFrequently:true});
 for(const layer of item.layers||[]){
  if(layer.visible===false)continue;
  const img=new Image(); img.src=layerSrc(layer);
  // synchronous drawing after decode is handled by pending promise collection
 }
 return flattenLayersToData(item,rect,{width,height},out,ctx,render,rctx);
}
function flattenLayersToData(item,rect,dims,out,ctx,render,rctx){
 const jobs=(item.layers||[]).filter(layer=>layer.visible!==false).map(layer=>new Promise((resolve,reject)=>{
  const img=new Image();
  img.onload=()=>{rctx.globalAlpha=Number.isFinite(layer.opacity)?layer.opacity:1;rctx.drawImage(img,(layer.rect?.x||0)*render.width,(layer.rect?.y||0)*render.height,(layer.rect?.w||1)*render.width,(layer.rect?.h||1)*render.height);resolve()};
  img.onerror=()=>reject(new Error('Failed to load a composition layer.'));
  img.src=layerSrc(layer);
 }));
 return Promise.all(jobs).then(()=>{
  const sx=(rect?.x||0)*render.width,sy=(rect?.y||0)*render.height,sw=(rect?.w||1)*render.width,sh=(rect?.h||1)*render.height;
  ctx.drawImage(render,sx,sy,sw,sh,0,0,dims.width,dims.height);
  return {image:out.toDataURL('image/jpeg',.9),width:dims.width,height:dims.height};
 });
}

async function showPreview(size=1024){
 let uri='',note='';
 if(hasOpenComposition()){
  const item=currentItem();
  const result=await captureCompositionCrop(item,state.composition.rect,size);
  uri=result.image; note='This exact cropped composition image will be sent to the selected AI provider at '+result.width+' × '+result.height+'.';
 }else{
  if(!state.rect)throw new Error('Draw a perspective patch first.');
  const dims=outputSize(size,state.rect);
  uri=captureView(state.rect,dims);
  note='This exact cropped perspective image will be sent to the selected AI provider at '+dims.width+' × '+dims.height+'.';
 }
 const image=previewImage();image.src=uri;image.hidden=false;
 previewModal().hidden=false;
 $('perspectivePreviewNote').textContent=note;
 return uri;
}
function captureForGeneration(){
 if(hasOpenComposition())return captureCompositionCrop(currentItem(),state.composition.rect,resolution());
 if(!state.rect)throw new Error('Draw a perspective patch first.');
 return Promise.resolve(captureView(state.rect,outputSize(resolution(),state.rect)));
}

$('perspectivePick').onclick=()=>{if(siteWorld()?.mode!=='region'){status('Open a local terrain view first.',true);return}enableSelection(!state.selecting)};
$('perspectiveUndo').onclick=()=>{if(!state.history.length){status('Nothing to undo.',true);return}const current=state.history.pop();if(current)state.future.push(current);const previous=state.history[state.history.length-1];state.rect=previous?{...previous}:null;drawRect(state.rect);if(state.rect)captureView(state.rect,1024)};
$('perspectiveRedo').onclick=()=>{const rect=state.future.pop();if(!rect){status('Nothing to redo.',true);return}setRect(rect,false);state.history.push({...rect})};
$('perspectiveProvider').onchange=()=>{$('perspectiveKey').value='';$('perspectiveKey').placeholder='API key for '+$('perspectiveProvider').selectedOptions[0].text};
$('perspectiveOpen').onclick=()=>{const item=selected();if(!item){status('Select a gallery image first.',true);return}showGalleryImage(item.id)};
$('perspectiveViewpoint').onclick=()=>{const item=selected();if(!item){status('Select a gallery image first.',true);return}restoreView(item.view);status('Saved viewpoint restored.')};
$('perspectiveDelete').onclick=async()=>{const item=selected();if(!item)return;await removeItem(item.id);state.items=state.items.filter(i=>i.id!==item.id);state.current=state.items[0]?.id||null;refreshGallery();if(viewer().hidden===false&&state.current)showGalleryImage(state.current);else closeGallery();status('Perspective concept deleted.')};
$('perspectivePreviewClose').onclick=()=>hidePreview();
$('perspectiveReview').onclick=async()=>{try{await showPreview(resolution());status('Review the exact crop before generating.')}catch(error){status(error.message,true)}};
$('perspectiveAspect').onchange=()=>{if(state.drag)updateDrag();if(state.rect)try{captureView(state.rect,outputSize(resolution(),state.rect));status('Aspect ratio updated.')}catch(error){status(error.message,true)}};

document.addEventListener('keydown',event=>{
 const tag=(event.target?.tagName||'').toUpperCase();
 if(event.key==='Escape'&&!previewModal().hidden){hidePreview();return}
 if(event.key==='Escape'&&state.selecting){enableSelection(false);return}
 if(event.key!=='Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)return;
 if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(tag))return;
 event.preventDefault();
 showPreview(resolution()).then(()=>status('Preview opened: this exact image will be sent to AI.')).catch(error=>status(error.message,true));
});
previewModal().addEventListener('click',event=>{if(event.target===previewModal())hidePreview()});

async function providerResultToDataUrl(resultImage){return imageToDataUrl(resultImage)}
async function sendGenerationRequest({provider,key,prompt,source,width,height,size}){
 const session=window.planetLabAuthState;
 const response=await tracedFetch('/api/ai/scenario-edit',{
  method:'POST',cache:'no-store',credentials:'same-origin',
  headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf,['X-PlanetLab-'+(provider==='xai'?'XAI':provider==='meta'?'Meta':'OpenAI')+'-Key']:key},
  body:JSON.stringify({provider,prompt,image:source,size,width,height,mode:'perspective'})
 });
 const result=await response.json().catch(()=>({error:'Invalid provider response'}));
 if(!response.ok){openApiConsole();throw new Error(result.error||`Image generation failed (HTTP ${response.status})`)}
 return result;
}

$('perspectiveGenerate').onclick=async()=>{
 if(state.busy)return;
 const session=window.planetLabAuthState;
 const provider=$('perspectiveProvider').value;
 const prompt=$('perspectivePrompt').value.trim();
 const typed=$('perspectiveKey').value.trim();
 const metaHeaders=getAiHeaders('/api/ai/scenario-edit');
 const key=typed||getProviderKey(provider)||state.keys[provider]||(provider==='meta'?metaHeaders['X-PlanetLab-Meta-Key']:'');
 if(!session?.user||!session.csrf){status('Sign in to generate a perspective concept.',true);return}
 if(currentSite()!==state.site||!state.site){status('Load a site first.',true);return}
 if(prompt.length<4||prompt.length>1500){status('Enter a prompt (4–1500 characters).',true);return}
 if(!key){status('Open API Keys in the top bar to configure '+provider+'.',true);return}
 let sourcePayload,width,height;
 try{
  const capture=await captureForGeneration();
  if(typeof capture==='string'){sourcePayload=capture;const dims=outputSize(resolution(),state.rect);width=dims.width;height=dims.height;}
  else{sourcePayload=capture.image;width=capture.width;height=capture.height;}
  previewImage().src=sourcePayload; previewImage().hidden=false; previewModal().hidden=false;
 }catch(error){status(error.message,true);return}
 state.busy=true;setBusy(true,'Generating perspective concept…');status('Generating perspective concept…');
 const world=siteWorld();
 const itemView=world?{camera:{x:world.camera.position.x,y:world.camera.position.y,z:world.camera.position.z},target:{x:world.controls.target.x,y:world.controls.target.y,z:world.controls.target.z}}:null;
 try{
  const result=await sendGenerationRequest({provider,key,prompt,source:sourcePayload,width,height,size:resolution()});
  const generatedImage=await providerResultToDataUrl(result.image);
  state.keys[provider]=key;if(typed)setProviderKey(provider,key);$('perspectiveKey').value='';
  if(hasOpenComposition()){
   const item=currentItem();
   pushCompositionHistory('Add AI layer');
   const rect=state.composition.rect?{...state.composition.rect}:{x:0,y:0,w:1,h:1};
   item.layers.push({id:crypto.randomUUID(),name:$('perspectiveSelectedName').value.trim()||prompt.slice(0,48),type:'generated',visible:true,opacity:1,rect,image:generatedImage,provider,prompt,model:result.model,created:Date.now()});
   item.activeLayerId=item.layers[item.layers.length-1].id;
   item.operations=(item.operations||[]).concat({type:'generate-layer',provider,prompt,rect,created:Date.now(),camera:itemView});
   await put(item);
   renderComposition(); refreshGallery(); hidePreview(); status('New layer added to the composition.');
  }else{
   const baseImage=sourcePayload;
   const created=Date.now();
   const item={
    id:crypto.randomUUID(),
    site:state.site,
    name:$('perspectiveSelectedName').value.trim()||prompt.slice(0,50),
    prompt,provider,model:result.model,created,view:itemView,rect:{...state.rect},resolution:resolution(),
    canvasWidth:width,canvasHeight:height,
    baseImage,
    layers:[
     {id:crypto.randomUUID(),name:'Base source',type:'base',visible:true,opacity:1,rect:{x:0,y:0,w:1,h:1},image:baseImage,created},
     {id:crypto.randomUUID(),name:'AI concept',type:'generated',visible:true,opacity:1,rect:{x:0,y:0,w:1,h:1},image:generatedImage,provider,prompt,model:result.model,created}
    ],
    activeLayerId:null,
    operations:[{type:'create-composition',provider,prompt,rect:{...state.rect},created,camera:itemView}]
   };
   item.activeLayerId=item.layers[item.layers.length-1].id;
   await put(item); state.items.unshift(item); state.current=item.id; refreshGallery(); hidePreview();showGalleryImage(item.id); status('Perspective composition saved in gallery.');
  }
 }catch(error){status(error.message,true)}finally{state.busy=false;setBusy(false)}
};

['pointerdown','pointermove','pointerup','pointerleave'].forEach(type=>overlay().addEventListener(type,ev=>({pointerdown:onPointerDown,pointermove:onPointerMove,pointerup:onPointerUp,pointerleave:onPointerUp})[type](ev)));
window.addEventListener('planetlab:site-selected',loadSite);
window.addEventListener('planetlab:site-changed',loadSite);
window.addEventListener('planetlab:view-changed',()=>{if(siteWorld()?.mode==='planet')enableSelection(false)});
if(window.planetLabApp?.config)loadSite();
