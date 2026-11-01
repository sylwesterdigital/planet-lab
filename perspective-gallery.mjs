import {tracedFetch,openApiConsole} from './api-console.mjs';
import {getAiHeaders} from './ai-connections.mjs?v=0.4.33';
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
  future:[],
  sourcePreview:null,
  sourceSize:null
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
async function listLegacySite(site){
 return new Promise(resolve=>{
  const req=indexedDB.open('planetlab-perspective-gallery-v1');
  req.onupgradeneeded=()=>{req.transaction.abort()};
  req.onerror=()=>resolve([]);
  req.onsuccess=()=>{
   const database=req.result;
   if(!database.objectStoreNames.contains('items')){database.close();resolve([]);return}
   const tx=database.transaction('items','readonly');
   const get=tx.objectStore('items').index('site').getAll(site);
   get.onsuccess=()=>{database.close();resolve(get.result||[])};
   get.onerror=()=>{database.close();resolve([])};
  };
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
 const box=viewerSelection();if(!box)return;
 if(!rect){box.hidden=true;box.style.display='none';return;}
 box.hidden=false;box.style.display='block';
 box.style.left=(rect.x*100)+'%';box.style.top=(rect.y*100)+'%';
 box.style.width=(rect.w*100)+'%';box.style.height=(rect.h*100)+'%';
}
function compositionAspect(item){
 const w=item?.canvasWidth||item?.resolution||1024;
 const h=item?.canvasHeight||item?.resolution||1024;
 return `${w} / ${h}`;
}
function setCompositionRect(rect,push=true){
 if(push&&rect){pushCompositionHistory('Patch selection')}
 state.composition.rect=rect?{...rect}:null;
 drawViewerRect(state.composition.rect);
 const item=currentItem();if(item){item.lastSelection=state.composition.rect;put(item).catch(error=>compositionStatus(error.message,true))}
 updateViewerMeta();updateCompositionPreview();
}
function compositionStatus(message,error=false){
 const note=$('galleryViewerStatus');
 if(note){note.textContent=message;note.style.color=error?'#ff8e9b':'#b9e6d7'}
 status(message,error);
}
function enableCompositionSelection(enable){
 state.composition.selecting=!!enable;
 const btn=$('galleryViewerDrawPatch');
 btn.classList.toggle('drawing-active',enable);
 btn.setAttribute('aria-pressed',String(enable));
 btn.textContent=enable?'✕ Cancel drawing':'▭ Draw patch';
 const stage=viewerStage();stage.classList.toggle('selecting',enable);
 const hit=$('galleryViewerDrawSurface');
 hit.hidden=!enable;
 const hint=$('galleryViewerSelectionHint');
 hint.textContent=enable?'DRAWING MODE — drag directly across the large image. Esc cancels.':state.composition.rect?'Patch selected. Set a prompt and generate another layer.':'Click Draw patch, then drag over the image.';
 if(!enable){state.composition.drag=null;}
 compositionStatus(enable?'Drawing mode active — drag on the image.':state.composition.rect?'Patch selected; ready for another AI generation.':'Choose Draw patch to start.');
}
function onViewerPointerDown(ev){
 if(!state.composition.selecting||ev.button!==0)return;
 ev.preventDefault();ev.stopPropagation();
 const hit=$('galleryViewerDrawSurface');
 hit.setPointerCapture?.(ev.pointerId);
 state.composition.drag={id:ev.pointerId,start:viewerPointer(ev),current:viewerPointer(ev)};
 updateViewerDrag();
}
function updateViewerDrag(){
 if(!state.composition.drag)return;
 drawViewerRect(normalizeRect(state.composition.drag.start,state.composition.drag.current,null,null));
}
function onViewerPointerMove(ev){
 if(!state.composition.drag||ev.pointerId!==state.composition.drag.id)return;
 ev.preventDefault();ev.stopPropagation();state.composition.drag.current=viewerPointer(ev);updateViewerDrag();
}
function onViewerPointerUp(ev){
 if(!state.composition.drag||ev.pointerId!==state.composition.drag.id)return;
 ev.preventDefault();ev.stopPropagation();
 state.composition.drag.current=viewerPointer(ev);
 const rect=normalizeRect(state.composition.drag.start,state.composition.drag.current,null,null);
 state.composition.drag=null;
 if(rect.w<0.02||rect.h<0.02){compositionStatus('Patch too small — drag a larger rectangle.',true);drawViewerRect(state.composition.rect);return}
 enableCompositionSelection(false);
 setCompositionRect(rect,true);
 // The crop preview stays INSIDE the visible editor. The old modal was behind it.
 compositionStatus('Patch selected. Cropped preview is shown alongside the layer stack.');
}
function onViewerPointerCancel(ev){
 if(!state.composition.drag)return;
 state.composition.drag=null;drawViewerRect(state.composition.rect);
}
function layerSnapshot(item){
 return {layers:item.layers.map(({image,blob,_url,...metadata})=>({...metadata})),activeLayerId:item.activeLayerId,rect:state.composition.rect?{...state.composition.rect}:null,operations:JSON.parse(JSON.stringify(item.operations||[]))};
}
function resetViewerHistory(){
 const item=currentItem();
 state.composition.history=item?.undoStack||[];
 state.composition.future=item?.redoStack||[];
 renderViewerHistory();
}
function pushCompositionHistory(label='Updated composition'){
 const item=currentItem();if(!item)return;
 item.undoStack ||= [];
 item.redoStack=[];
 item.undoStack.push({label,at:Date.now(),snapshot:layerSnapshot(item)});
 if(item.undoStack.length>35)item.undoStack.shift();
 state.composition.history=item.undoStack;
 state.composition.future=item.redoStack;
 renderViewerHistory();
}
function applyCompositionSnapshot(snapshot){
 const item=currentItem();if(!item||!snapshot)return;
 item.layers=snapshot.layers.map(layer=>({...layer}));
 item.operations=JSON.parse(JSON.stringify(snapshot.operations||[]));
 item.activeLayerId=snapshot.activeLayerId;
 if(!item.layers.some(layer=>layer.id===item.activeLayerId))item.activeLayerId=item.layers.at(-1)?.id||null;
 state.composition.rect=snapshot.rect?{...snapshot.rect}:null;
 item.lastSelection=state.composition.rect;
 renderComposition();
 put(item).catch(error=>compositionStatus('Cannot save history: '+error.message,true));
}
function undoComposition(){
 const item=currentItem();if(!item?.undoStack?.length){compositionStatus('Nothing to undo.',true);return}
 item.redoStack ||= [];
 item.redoStack.push({label:'Redo',at:Date.now(),snapshot:layerSnapshot(item)});
 const previous=item.undoStack.pop();
 applyCompositionSnapshot(previous.snapshot);
 resetViewerHistory();compositionStatus('Undo: '+previous.label);
}
function redoComposition(){
 const item=currentItem();if(!item?.redoStack?.length){compositionStatus('Nothing to redo.',true);return}
 item.undoStack ||= [];
 item.undoStack.push({label:'Undo',at:Date.now(),snapshot:layerSnapshot(item)});
 const next=item.redoStack.pop();
 applyCompositionSnapshot(next.snapshot);
 resetViewerHistory();compositionStatus('Redo applied.');
}
function restoreView(view){
 const world=siteWorld();if(!world||!view)return;
 const c=world.camera,t=world.controls?.target;
 if(c&&view.camera&&['x','y','z'].every(k=>Number.isFinite(view.camera[k])))c.position.set(view.camera.x,view.camera.y,view.camera.z);
 if(t&&view.target&&['x','y','z'].every(k=>Number.isFinite(view.target[k]))){t.set(view.target.x,view.target.y,view.target.z);world.controls.update()}
 world.render?.();
}
function layerSrc(layer,item=currentItem()){
 if(layer.image)return layer.image;
 if(item?.assets?.[layer.id])return item.assets[layer.id];
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
 normalized.assets ||= {};
 normalized.undoStack ||= [];
 normalized.redoStack ||= [];
 normalized.operations ||= [];
 if(Array.isArray(normalized.layers)&&normalized.layers.length){
  normalized.layers=normalized.layers.map((layer,index)=>{
   const id=layer.id||crypto.randomUUID();
   if(layer.image&&!normalized.assets[id])normalized.assets[id]=layer.image;
   return {id,name:layer.name||`Layer ${index+1}`,type:layer.type||'generated',visible:layer.visible!==false,
    opacity:Number.isFinite(layer.opacity)?layer.opacity:1,rect:layer.rect||{x:0,y:0,w:1,h:1},
    provider:layer.provider||normalized.provider||'',prompt:layer.prompt||normalized.prompt||'',
    model:layer.model||normalized.model||'',created:layer.created||normalized.created||Date.now()};
  });
  normalized.activeLayerId=normalized.activeLayerId||normalized.layers.at(-1)?.id||null;
  delete normalized.baseImage;delete normalized.blob;
  return normalized;
 }
 const image=normalized.blob?await blobToDataUrl(normalized.blob):normalized.image||'';
 normalized.canvasWidth=normalized.canvasWidth||normalized.width||1024;
 normalized.canvasHeight=normalized.canvasHeight||normalized.height||1024;
 normalized.layers=[];
 // Earlier releases saved only the generated result, not the source. Do not fake it.
 const base=normalized.baseImage||'';
 if(base){const id=crypto.randomUUID();normalized.assets[id]=base;normalized.layers.push({id,name:'Base source',type:'base',visible:true,opacity:1,rect:{x:0,y:0,w:1,h:1}})}
 if(image){const id=crypto.randomUUID();normalized.assets[id]=image;normalized.layers.push({id,name:normalized.name||'Imported AI concept',type:base?'generated':'base',visible:true,opacity:1,rect:{x:0,y:0,w:1,h:1},provider:normalized.provider||'',prompt:normalized.prompt||'',created:normalized.created||Date.now()})}
 normalized.activeLayerId=normalized.layers.at(-1)?.id||null;
 delete normalized.baseImage;delete normalized.blob;
 return normalized;
}
function galleryThumb(item){
 const top=[...(item.layers||[])].filter(layer=>layer.visible!==false).slice().reverse().find(Boolean) || item.layers?.[item.layers.length-1] || null;
 if(top)return layerSrc(top,item);
 if(item.baseImage)return item.baseImage;
 return '';
}

function closeGallery(){
 viewer().hidden=true;
 $('galleryViewerImage').removeAttribute('src');
 $('galleryViewerImage').hidden=true;
 viewerStage().querySelectorAll('.composition-layer').forEach(node=>node.remove());
 state.viewerScale=1;
 state.composition.rect=null;
 drawViewerRect(null);
 enableCompositionSelection(false);
 resetViewerHistory();
}
function renderViewerHistory(){
 const root=viewerHistoryList(); if(!root)return;
 root.replaceChildren();
 const entries=(currentItem()?.operations||[]).slice(-8).reverse();
 if(!entries.length){root.textContent='No generation steps yet.';return}
 for(const step of entries){
  const row=document.createElement('div');row.className='viewer-history-item';
  const op=step.type==='generate-layer'?'AI patch':step.type==='create-composition'?'Base generation':step.type||'Edit';
  const detail=step.prompt?` · ${step.prompt.slice(0,45)}`:'';
  row.textContent=op+detail+' · '+new Date(step.created||Date.now()).toLocaleTimeString();
  root.append(row);
 }
}
function updateViewerMeta(){
 const item=currentItem();
 $('galleryViewerMeta').textContent=item?`${item.layers.length} layers · ${item.canvasWidth||1024} × ${item.canvasHeight||1024} px${state.composition.rect?' · patch selected':''}`:'';
}
function renderComposition(){
 const item=currentItem();if(!item)return;
 const stage=viewerStage();
 // Preserve selection and pointer-capture nodes while replacing image layers.
 stage.querySelectorAll('.composition-layer').forEach(node=>node.remove());
 stage.style.aspectRatio=compositionAspect(item);
 stage.style.transform=`scale(${state.viewerScale})`;
 stage.style.transformOrigin='center center';
 (item.layers||[]).forEach((layer,index)=>{
  if(layer.visible===false)return;
  const img=document.createElement('img');
  img.className='composition-layer';
  img.draggable=false;
  img.src=layerSrc(layer,item);
  img.alt=layer.name||`Layer ${index+1}`;
  img.style.left=((layer.rect?.x||0)*100)+'%';
  img.style.top=((layer.rect?.y||0)*100)+'%';
  img.style.width=((layer.rect?.w||1)*100)+'%';
  img.style.height=((layer.rect?.h||1)*100)+'%';
  img.style.opacity=String(layer.opacity??1);
  img.style.zIndex=String(index+1);
  img.addEventListener('click',ev=>{
   if(state.composition.selecting)return;
   ev.stopPropagation();item.activeLayerId=layer.id;renderComposition();
  });
  stage.append(img);
 });
 $('galleryViewerImage').hidden=true;
 renderLayerList();
 drawViewerRect(state.composition.rect);
 updateViewerMeta();
 renderViewerHistory();
}
function layerActionButton(icon,title,onClick,disabled=false){
 const b=document.createElement('button');b.type='button';b.className='viewer-layer-action';
 b.textContent=icon;b.title=title;b.setAttribute('aria-label',title);
 b.disabled=disabled;b.onclick=event=>{event.stopPropagation();onClick()};return b;
}
function layerMutation(label,modify){
 const item=currentItem();if(!item)return;
 pushCompositionHistory(label);
 modify(item);
 renderComposition();refreshGallery();
 put(item).catch(error=>compositionStatus('Cannot save composition: '+error.message,true));
}
function moveLayer(id,direction){
 const item=currentItem();const idx=item?.layers.findIndex(l=>l.id===id)??-1;
 if(idx<0)return;
 // Layers are stored bottom -> top: up means index + 1.
 const dest=idx+direction;
 if(dest<0||dest>=item.layers.length)return;
 if(item.layers[idx].type==='base'||item.layers[dest].type==='base')return;
 layerMutation('Reorder layer',i=>{[i.layers[idx],i.layers[dest]]=[i.layers[dest],i.layers[idx]];i.activeLayerId=id});
}
function toggleLayer(id){
 const item=currentItem(),layer=item?.layers.find(l=>l.id===id);if(!layer)return;
 layerMutation(layer.visible?'Hide layer':'Show layer',i=>{
  const l=i.layers.find(l=>l.id===id);l.visible=!l.visible;i.activeLayerId=id;
 });
}
function deleteLayer(id){
 const item=currentItem(),idx=item?.layers.findIndex(l=>l.id===id)??-1;
 if(idx<0)return;
 if(item.layers[idx].type==='base'){compositionStatus('Base source cannot be deleted.',true);return}
 layerMutation('Delete layer',i=>{i.layers.splice(idx,1);i.activeLayerId=i.layers[Math.min(idx,i.layers.length-1)]?.id||null});
}
function renderLayerList(){
 const item=currentItem(),root=viewerLayerList();if(!root)return;
 root.replaceChildren();
 if(!item?.layers?.length){root.textContent='No layers.';return}
 // Highest visible row is also highest compositing z-index.
 for(let idx=item.layers.length-1;idx>=0;idx--){
  const layer=item.layers[idx];
  const row=document.createElement('div');row.className='viewer-layer-row'+(layer.id===item.activeLayerId?' active':'')+(layer.visible===false?' hidden-layer':'');
  row.dataset.layerId=layer.id;
  const thumb=document.createElement('img');thumb.className='viewer-layer-thumb';thumb.alt='';thumb.src=layerSrc(layer,item);
  const pick=document.createElement('button');pick.type='button';pick.className='viewer-layer-pick';
  pick.textContent=layer.name||`Layer ${idx+1}`;pick.title=pick.textContent;
  pick.onclick=()=>{item.activeLayerId=layer.id;renderComposition()};
  const actions=document.createElement('div');actions.className='viewer-layer-actions';
  actions.append(
   layerActionButton('↑','Move '+layer.name+' up',()=>moveLayer(layer.id,+1),idx===item.layers.length-1||layer.type==='base'),
   layerActionButton('↓','Move '+layer.name+' down',()=>moveLayer(layer.id,-1),idx===0||layer.type==='base'||item.layers[idx-1]?.type==='base'),
   layerActionButton(layer.visible===false?'◌':'👁',(layer.visible===false?'Show ':'Hide ')+layer.name,()=>toggleLayer(layer.id)),
   layerActionButton('🗑','Delete '+layer.name,()=>deleteLayer(layer.id),layer.type==='base')
  );
  row.append(thumb,pick,actions);root.append(row);
 }
}
function showGalleryImage(id){
 const item=state.items.find(candidate=>candidate.id===id);
 if(!item)return;
 state.current=item.id;
 state.viewerScale=1;
 $('galleryViewerPrompt').value=item.prompt||'Restore the selected area with photorealistic textures while preserving scene geometry and viewpoint.';
 $('galleryViewerProvider').value=['meta','xai','openai'].includes(item.provider)?item.provider:'xai';
 $('galleryViewerTitle').textContent=item.name||'Perspective composition';
 viewer().hidden=false;
 state.composition.rect=item.lastSelection?{...item.lastSelection}:null;
 drawViewerRect(state.composition.rect);
 enableCompositionSelection(false);
 resetViewerHistory();
 renderComposition();
 updateCompositionPreview();
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
$('galleryViewerDrawPatch').onclick=()=>{if(!currentItem()){compositionStatus('Open a composition first.',true);return}enableCompositionSelection(!state.composition.selecting)};
$('galleryViewerGenerate').onclick=()=>generatePerspective('composition');
$('galleryViewerPreview').onclick=()=>updateCompositionPreview();
$('galleryViewerProvider').onchange=()=>{$('perspectiveProvider').value=$('galleryViewerProvider').value};
viewerFrame().addEventListener('wheel',e=>{if(viewer().hidden)return;e.preventDefault();zoomGallery(e.deltaY<0?1:-1)},{passive:false});
const drawSurface=$('galleryViewerDrawSurface');
drawSurface.addEventListener('pointerdown',onViewerPointerDown);
drawSurface.addEventListener('pointermove',onViewerPointerMove);
drawSurface.addEventListener('pointerup',onViewerPointerUp);
drawSurface.addEventListener('pointercancel',onViewerPointerCancel);
drawSurface.addEventListener('lostpointercapture',onViewerPointerCancel);
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
  let raw=await listSite(state.site);
  if(!raw.length){const older=await listLegacySite(state.site);
   for(const old of older){try{await put(await normalizeLoadedItem(old))}catch(error){console.warn('Legacy composition import:',error.message)}}
   raw=await listSite(state.site);
  }
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
async function flattenLayersToData(item,rect,dims){
 const render=document.createElement('canvas');
 render.width=item.canvasWidth||item.resolution||1024;
 render.height=item.canvasHeight||item.resolution||1024;
 const rctx=render.getContext('2d');rctx.imageSmoothingEnabled=true;rctx.imageSmoothingQuality='high';
 // Concurrent image decode, strictly ordered compositing.
 const layers=(item.layers||[]).filter(layer=>layer.visible!==false);
 const images=await Promise.all(layers.map(layer=>new Promise((resolve,reject)=>{
  const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Layer image could not be decoded'));
  img.src=layerSrc(layer,item);
 })));
 layers.forEach((layer,i)=>{
  rctx.globalAlpha=Math.min(1,Math.max(0,Number(layer.opacity??1)));
  const box=layer.rect||{x:0,y:0,w:1,h:1};
  rctx.drawImage(images[i],box.x*render.width,box.y*render.height,box.w*render.width,box.h*render.height);
 });
 rctx.globalAlpha=1;
 const out=document.createElement('canvas');out.width=dims.width;out.height=dims.height;
 const ctx=out.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 const box=rect||{x:0,y:0,w:1,h:1};
 ctx.drawImage(render,box.x*render.width,box.y*render.height,box.w*render.width,box.h*render.height,0,0,dims.width,dims.height);
 let image='';
 for(const q of [.91,.83,.75,.65]){image=out.toDataURL('image/jpeg',q);if(image.length<=3_250_000)break}
 if(image.length>3_250_000)throw new Error('Patch image exceeds upload size; select a smaller region.');
 return {image,width:dims.width,height:dims.height};
}
function captureCompositionCrop(item,rect,longEdge=1024){
 if(!item)throw new Error('Open a composition first.');
 if(!rect)throw new Error('Draw a patch on the composition first.');
 const fullW=item.canvasWidth||item.resolution||1024,fullH=item.canvasHeight||item.resolution||1024;
 const ratio=Math.max((rect.w*fullW)/Math.max(rect.h*fullH,.0001),.01);
 let width,height;
 if(ratio>=1){width=longEdge;height=Math.max(512,Math.round(longEdge/ratio))}
 else{height=longEdge;width=Math.max(512,Math.round(longEdge*ratio))}
 return flattenLayersToData(item,rect,{width,height});
}
async function updateCompositionPreview(){
 const item=currentItem(),rect=state.composition.rect;
 const image=$('galleryViewerPatchPreview');const label=$('galleryViewerCropInfo');
 if(!image||!label)return;
 if(!item||!rect){image.hidden=true;image.removeAttribute('src');label.textContent='No patch selected';return}
 try{
  const result=await captureCompositionCrop(item,rect,Math.min(resolution(),1024));
  if(item!==currentItem()||state.composition.rect!==rect)return;
  image.src=result.image;image.hidden=false;
  label.textContent=`Selected crop ${result.width} × ${result.height} (exact composition coordinates)`;
 }catch(error){label.textContent='Preview failed: '+error.message;compositionStatus(error.message,true)}
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
 if(hasOpenComposition())return; // Composition previews stay in the visible editor.
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

async function generatePerspective(mode='scene'){
 if(state.busy)return;
 const isComposition=mode==='composition';
 const session=window.planetLabAuthState;
 const provider=isComposition?$('galleryViewerProvider').value:$('perspectiveProvider').value;
 const prompt=(isComposition?$('galleryViewerPrompt').value:$('perspectivePrompt').value).trim();
 const typed=$('perspectiveKey').value.trim();
 const metaHeaders=getAiHeaders('/api/ai/scenario-edit');
 const key=typed||getProviderKey(provider)||state.keys[provider]||(provider==='meta'?metaHeaders['X-PlanetLab-Meta-Key']:'');
 if(!session?.user||!session.csrf){compositionStatus('Sign in to generate an image.',true);return}
 if(currentSite()!==state.site||!state.site){compositionStatus('Load the site first.',true);return}
 if(prompt.length<4||prompt.length>1500){compositionStatus('Enter a prompt (4–1500 characters).',true);return}
 if(!key){compositionStatus('Configure the '+provider+' API key in Providers & Keys in the top bar.',true);return}
 if(isComposition&&!state.composition.rect){compositionStatus('Draw a patch on the image first.',true);return}
 if(!isComposition&&!state.rect){status('Draw a perspective patch first.',true);return}
 let sourcePayload,width,height;
 try{
  if(isComposition){
   const capture=await captureCompositionCrop(currentItem(),state.composition.rect,resolution());
   sourcePayload=capture.image;width=capture.width;height=capture.height;
  }else{
   const dims=outputSize(resolution(),state.rect);sourcePayload=captureView(state.rect,dims);width=dims.width;height=dims.height;
   previewImage().src=sourcePayload;previewImage().hidden=false;previewModal().hidden=false;
  }
 }catch(error){compositionStatus(error.message,true);return}
 const generationSite=state.site,compositionId=isComposition?currentItem()?.id:null,submissionRect=isComposition?{...state.composition.rect}:null;
 state.busy=true;setBusy(true,isComposition?'Generating selected composition patch…':'Generating perspective concept…');
 if(isComposition){
  $('galleryViewerGenerate').disabled=true;
  $('galleryViewerGenerate').textContent='Generating…';
  compositionStatus('Sending '+width+' × '+height+' selected patch to '+provider+'…');
 }else status('Generating perspective concept…');
 const world=siteWorld();
 const itemView=world?{camera:{x:world.camera.position.x,y:world.camera.position.y,z:world.camera.position.z},target:{x:world.controls.target.x,y:world.controls.target.y,z:world.controls.target.z}}:null;
 try{
  const result=await sendGenerationRequest({provider,key,prompt,source:sourcePayload,width,height,size:resolution()});
  const generatedImage=await providerResultToDataUrl(result.image);
  if(state.site!==generationSite)throw new Error('Location changed. Result was not saved.');
  state.keys[provider]=key;if(typed)setProviderKey(provider,key);$('perspectiveKey').value='';
  if(isComposition){
   const item=state.items.find(i=>i.id===compositionId);
   if(!item||currentItem()?.id!==compositionId)throw new Error('Composition changed while generating; result not added.');
   // Preserve the selection used when the job started, regardless of later UI changes.
   const rect={...submissionRect};
   pushCompositionHistory('Add AI layer');
   const id=crypto.randomUUID();
   item.assets[id]=generatedImage;
   item.layers.push({id,name:prompt.slice(0,48),type:'generated',visible:true,opacity:1,rect,provider,prompt,model:result.model,created:Date.now()});
   item.activeLayerId=id;
   item.operations=(item.operations||[]).concat({type:'generate-layer',provider,prompt,rect,created:Date.now(),camera:itemView});
   await put(item);renderComposition();refreshGallery();
   compositionStatus('New AI image saved as a layer in its exact patch position.');
  }else{
   const created=Date.now(),id=crypto.randomUUID(),baseId=crypto.randomUUID(),generatedId=crypto.randomUUID();
   const item={id,site:state.site,name:$('perspectiveSelectedName').value.trim()||prompt.slice(0,50),
    prompt,provider,model:result.model,created,view:itemView,rect:{...state.rect},resolution:resolution(),
    canvasWidth:width,canvasHeight:height,
    assets:{[baseId]:sourcePayload,[generatedId]:generatedImage},
    layers:[
     {id:baseId,name:'Base source',type:'base',visible:true,opacity:1,rect:{x:0,y:0,w:1,h:1},created},
     {id:generatedId,name:'AI concept',type:'generated',visible:true,opacity:1,rect:{x:0,y:0,w:1,h:1},provider,prompt,model:result.model,created}
    ],activeLayerId:generatedId,
    undoStack:[],redoStack:[],operations:[{type:'create-composition',provider,prompt,rect:{...state.rect},created,camera:itemView}]};
   await put(item);state.items.unshift(item);state.current=id;refreshGallery();hidePreview();showGalleryImage(item.id);
   status('Perspective composition saved. Select a patch to create more layers.');
  }
 }catch(error){compositionStatus(error.message,true)}finally{
  state.busy=false;setBusy(false);
  $('galleryViewerGenerate').disabled=false;$('galleryViewerGenerate').textContent='Generate selected patch';
 }
}
$('perspectiveGenerate').onclick=()=>generatePerspective('scene');
['pointerdown','pointermove','pointerup','pointerleave'].forEach(type=>overlay().addEventListener(type,ev=>({pointerdown:onPointerDown,pointermove:onPointerMove,pointerup:onPointerUp,pointerleave:onPointerUp})[type](ev)));
window.addEventListener('planetlab:site-selected',loadSite);
window.addEventListener('planetlab:site-changed',loadSite);
window.addEventListener('planetlab:view-changed',()=>{if(siteWorld()?.mode==='planet')enableSelection(false)});
if(window.planetLabApp?.config)loadSite();
