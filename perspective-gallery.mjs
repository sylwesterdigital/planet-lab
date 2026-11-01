import {tracedFetch,openApiConsole} from './api-console.mjs';
import {getAiHeaders} from './ai-connections.mjs?v=0.4.29';
import {siteKey} from './scenario-core.mjs';
import {getProviderKey,setProviderKey} from './provider-keys.mjs';
const $=id=>document.getElementById(id);
const state={site:null,items:[],current:null,keys:{meta:'',xai:'',openai:''},busy:false,selecting:false,rect:null,history:[],future:[],drag:null,viewerScale:1};
let dbPromise=null;
function status(msg,error=false){const e=$('perspectiveStatus');if(e){e.textContent=msg;e.style.color=error?'#ffb4ae':''}}
function db(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open('planetlab-perspective-gallery-v1',1);req.onupgradeneeded=()=>{const s=req.result.createObjectStore('items',{keyPath:'id'});s.createIndex('site','site',{unique:false})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return dbPromise}
async function listSite(site){const database=await db();return new Promise((resolve,reject)=>{const req=database.transaction('items','readonly').objectStore('items').index('site').getAll(site);req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>b.created-a.created));req.onerror=()=>reject(req.error)})}
async function put(item){const database=await db();return new Promise((resolve,reject)=>{const req=database.transaction('items','readwrite').objectStore('items').put(item);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error)})}
async function removeItem(id){const database=await db();return new Promise((resolve,reject)=>{const req=database.transaction('items','readwrite').objectStore('items').delete(id);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error)})}
function overlay(){return $('perspectiveOverlay')} function selectionBox(){return $('perspectiveSelection')} function sceneCanvas(){return $('scene')}
function currentSite(){return siteKey(window.planetLabApp?.anchor)}

function previewModal(){return $('perspectivePreviewModal')}
function previewImage(){return $('perspectivePreviewImage')}
function previewBusy(){return $('perspectivePreviewBusy')}
function hidePreview(){const m=previewModal();if(m)m.hidden=true;const image=previewImage();if(image){image.hidden=true;image.removeAttribute('src')}if(previewBusy())previewBusy().hidden=true}
function aspectRatio(){return $('perspectiveAspect')?.value||'free'}
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
function showPreview(size=1024){
 if(!state.rect)throw new Error('Draw a perspective patch first.');
 const dims=outputSize(size,state.rect);
 const uri=captureView(state.rect,dims);
 const image=previewImage();image.src=uri;image.hidden=false;
 previewModal().hidden=false;
 $('perspectivePreviewNote').textContent='This exact cropped perspective image will be sent to the selected AI provider at '+dims.width+' × '+dims.height+'.';
 return uri
}
function captureView(rect,size=1024){
 const world=window.planetLabApp?.world,canvas=sceneCanvas();
 if(!canvas||!world||world.mode!=='region')throw new Error('Open a local 3D terrain view first.');
 const bounds=canvas.getBoundingClientRect();
 if(bounds.width<2||bounds.height<2)throw new Error('The 3D scene is not visible.');
 const x=rect.x*canvas.width,y=rect.y*canvas.height,w=rect.w*canvas.width,h=rect.h*canvas.height;
 if(w<8||h<8)throw new Error('Draw a larger rectangle.');
 // WebGL default buffers may be cleared between frames. Render immediately
 // before copying the pixels, in the same JavaScript task.
 world.render();
 const dims=typeof size==='number'?{width:size,height:size}:size;
 const out=$('perspectiveCrop');out.width=dims.width;out.height=dims.height;
 const ctx=out.getContext('2d',{willReadFrequently:true});
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
 ctx.drawImage(canvas,x,y,w,h,0,0,dims.width,dims.height);
 // Reject a missing/blank WebGL frame rather than billing the user for it.
 const pixels=ctx.getImageData(0,0,Math.min(dims.width,64),Math.min(dims.height,64)).data;
 let visible=0;
 for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>16&&(pixels[i]>7||pixels[i+1]>7||pixels[i+2]>7))visible++;
 if(visible<40)throw new Error('Could not capture the 3D scene. Try again after the terrain renders.');
 // Encode the exact displayed preview as a bounded JPEG so the image-edit
 // endpoint can accept even a detailed 2048px perspective crop.
 let image='';
 for(const quality of [.9,.82,.72,.62]){
  image=out.toDataURL('image/jpeg',quality);
  if(image.length<=3_250_000)break;
 }
 if(!image.startsWith('data:image/jpeg;base64,')||image.length<500||image.length>3_250_000)
  throw new Error('The selected image is too large. Choose a smaller output resolution or a smaller crop.');
 return image;
}
function drawRect(rect){const box=selectionBox();if(!box)return; if(!rect){box.classList.remove('active');box.style.display='none';return;}box.style.display='block';box.classList.add('active');box.style.left=(rect.x*100)+'%';box.style.top=(rect.y*100)+'%';box.style.width=(rect.w*100)+'%';box.style.height=(rect.h*100)+'%';}
function setRect(rect,push=true){state.rect=rect?{...rect}:null;drawRect(state.rect);if(rect&&push){state.history.push({...rect});if(state.history.length>24)state.history.shift();state.future=[]}if(rect){try{captureView(rect,outputSize(1024,rect));status('Perspective patch ready. Press Enter to review the exact image that will be sent to AI.')}catch(error){status(error.message,true)}}}
function enableSelection(enable){
 state.selecting=!!enable;
 const o=overlay();o.hidden=!enable&&!state.rect;o.classList.toggle('active',enable);
 $('drawingModeBanner').hidden=!enable;
 $('perspectivePick').classList.toggle('drawing-active',enable);
 $('perspectivePick').setAttribute('aria-pressed',String(enable));
 $('perspectivePick').textContent=enable?'Cancel drawing':'Draw perspective patch';
 if(!enable){state.drag=null;const controls=window.planetLabApp?.world?.controls;if(controls&&window.planetLabApp?.world?.mode==='region')controls.enabled=true}
 status(enable?'DRAWING MODE: drag on the map to draw your rectangle.':state.rect?'Patch ready. Review image or generate concept.':'Draw a rectangle on the current 3D view to begin.');
}
$('drawingCancel').onclick=()=>enableSelection(false);
function pointerPoint(ev){const r=overlay().getBoundingClientRect();const x=(ev.clientX-r.left)/r.width,y=(ev.clientY-r.top)/r.height;return {x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))}}
function onPointerDown(ev){if(!state.selecting||window.planetLabApp?.world?.mode!=='region')return;ev.preventDefault();state.drag={start:pointerPoint(ev),current:pointerPoint(ev)};window.planetLabApp?.world?.controls&&(window.planetLabApp.world.controls.enabled=false);updateDrag()}
function normalizeRect(a,b){
 let w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);
 const dirX=b.x>=a.x?1:-1,dirY=b.y>=a.y?1:-1;
 const choice=aspectRatio();
 if(choice!=='free'){const [rw,rh]=choice.split(':').map(Number);const ratio=rw/rh;const view=sceneCanvas()?.getBoundingClientRect();const viewRatio=(view?.width||1)/(view?.height||1);
  if(ratio>0){const targetRatio=ratio/viewRatio;if(w/Math.max(h,.0001)>targetRatio)h=w/targetRatio; else w=h*targetRatio;}}
 let x=a.x+(dirX<0?-w:0),y=a.y+(dirY<0?-h:0);
 if(x<0){w+=x;x=0} if(y<0){h+=y;y=0} if(x+w>1)w=1-x; if(y+h>1)h=1-y;
 return {x,y,w,h};
}
function updateDrag(){if(!state.drag)return;drawRect(normalizeRect(state.drag.start,state.drag.current))}
function onPointerMove(ev){if(!state.drag)return;ev.preventDefault();state.drag.current=pointerPoint(ev);updateDrag()}
function onPointerUp(ev){if(!state.drag)return;ev.preventDefault();state.drag.current=pointerPoint(ev);const a=state.drag.start,b=state.drag.current;state.drag=null;window.planetLabApp?.world?.controls&&(window.planetLabApp.world.controls.enabled=true);const rect=normalizeRect(a,b);if(rect.w<0.03||rect.h<0.03){status('Perspective patch too small. Drag a larger rectangle.',true);drawRect(state.rect);return}setRect(rect,true);enableSelection(false);$('perspectiveReview').focus({preventScroll:true})}
function restoreView(view){const world=window.planetLabApp?.world;if(!world||!view)return;const c=world.camera,t=world.controls?.target;if(c&&view.camera&&['x','y','z'].every(k=>Number.isFinite(view.camera[k]))){c.position.set(view.camera.x,view.camera.y,view.camera.z)}if(t&&view.target&&['x','y','z'].every(k=>Number.isFinite(view.target[k]))){t.set(view.target.x,view.target.y,view.target.z);world.controls.update()}world.render?.()}
function selected(){return state.items.find(i=>i.id===state.current)||null}
function galleryThumb(item){if(item.url)return item.url;item.url=URL.createObjectURL(item.blob);return item.url}
function viewer(){return $('perspectiveGalleryViewer')}
function closeGallery(){viewer().hidden=true;$('galleryViewerImage').removeAttribute('src');state.viewerScale=1}
function showGalleryImage(id){
 const item=state.items.find(candidate=>candidate.id===id);
 if(!item)return;
 state.current=item.id;state.viewerScale=1;
 $('galleryViewerImage').src=galleryThumb(item);
 $('galleryViewerImage').style.transform='scale(1)';
 $('galleryViewerTitle').textContent=item.name||'Perspective concept';
 viewer().hidden=false;
 refreshGallery();
}
function nextGallery(direction){if(!state.items.length)return;const i=state.items.findIndex(item=>item.id===state.current);showGalleryImage(state.items[(i+direction+state.items.length)%state.items.length].id)}
function zoomGallery(direction){state.viewerScale=Math.max(.5,Math.min(5,state.viewerScale*(direction>0?1.25:.8)));$('galleryViewerImage').style.transform='scale('+state.viewerScale+')'}
$('galleryViewerClose').onclick=closeGallery;
$('galleryViewerPrevious').onclick=()=>nextGallery(-1);
$('galleryViewerNext').onclick=()=>nextGallery(1);
$('galleryViewerZoomIn').onclick=()=>zoomGallery(1);
$('galleryViewerZoomOut').onclick=()=>zoomGallery(-1);
$('galleryViewerFrame').onclick=()=>zoomGallery(1);
viewer().addEventListener('wheel',e=>{if(viewer().hidden)return;e.preventDefault();zoomGallery(e.deltaY<0?1:-1)},{passive:false});
document.addEventListener('keydown',e=>{
 if(viewer().hidden)return;
 if(e.key==='Escape'){closeGallery();e.stopImmediatePropagation()}
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
  const name=document.createElement('strong');name.textContent=item.name||item.prompt.slice(0,36);
  const meta=document.createElement('div');meta.className='hint';meta.textContent=item.provider+' · '+new Date(item.created).toLocaleString();
  wrap.append(name,meta);button.append(img,wrap);row.append(button);root.append(row);
 }
}

async function loadSite(){if(currentSite()===state.site&&state.items.length)return;hidePreview();closeGallery();enableSelection(false);state.site=currentSite();state.current=null;for(const item of state.items){if(item.url)URL.revokeObjectURL(item.url)}state.items=[];if(!state.site){refreshGallery();return}state.rect=null;state.history=[];state.future=[];drawRect(null);overlay().hidden=true;try{state.items=await listSite(state.site)}catch(error){status('Perspective gallery unavailable: '+error.message,true)}state.current=state.items[0]?.id||null;refreshGallery()}
function resolution(){return Math.max(512,Number($('perspectiveResolution').value)||1024)}
function setBusy(on,message=''){const hint=$('perspectiveBusyHint');if(hint)hint.textContent=on?(message||'Processing…'):'Idle';const busy=previewBusy();if(busy){busy.hidden=!on;busy.textContent=message||'Processing with AI…';}}
function captureForGeneration(){if(!state.rect)throw new Error('Draw a perspective patch first.');return captureView(state.rect,outputSize(resolution(),state.rect))}
$('perspectivePick').onclick=()=>{if(window.planetLabApp?.world?.mode!=='region'){status('Open a local terrain view first.',true);return}enableSelection(!state.selecting)};
$('perspectiveUndo').onclick=()=>{if(!state.history.length){status('Nothing to undo.',true);return}const current=state.history.pop();if(current)state.future.push(current);const previous=state.history[state.history.length-1];state.rect=previous?{...previous}:null;drawRect(state.rect);if(state.rect)captureView(state.rect,1024)};
$('perspectiveRedo').onclick=()=>{const rect=state.future.pop();if(!rect){status('Nothing to redo.',true);return}setRect(rect,false);state.history.push({...rect})};
$('perspectiveProvider').onchange=()=>{$('perspectiveKey').value='';$('perspectiveKey').placeholder='API key for '+$('perspectiveProvider').selectedOptions[0].text};
$('perspectiveOpen').onclick=()=>{const item=selected();if(!item){status('Select a gallery image first.',true);return}showGalleryImage(item.id)};
$('perspectiveViewpoint').onclick=()=>{const item=selected();if(!item){status('Select a gallery image first.',true);return}restoreView(item.view);status('Saved viewpoint restored.')};
$('perspectiveDelete').onclick=async()=>{const item=selected();if(!item)return;await removeItem(item.id);if(item.url)URL.revokeObjectURL(item.url);state.items=state.items.filter(i=>i.id!==item.id);state.current=state.items[0]?.id||null;refreshGallery();status('Perspective concept deleted.')};

$('perspectivePreviewClose').onclick=()=>hidePreview();
$('perspectiveReview').onclick=()=>{try{showPreview(resolution());status('Review the exact crop before generating.')}catch(error){status(error.message,true)}};
$('perspectiveAspect').onchange=()=>{if(state.drag)updateDrag();if(state.rect)try{captureView(state.rect,outputSize(resolution(),state.rect));status('Aspect ratio updated.')}catch(error){status(error.message,true)}};
document.addEventListener('keydown',event=>{
 const tag=(event.target?.tagName||'').toUpperCase();
 if(event.key==='Escape'&&!previewModal().hidden){hidePreview();return}
 if(event.key==='Escape'&&state.selecting){enableSelection(false);return}
 if(event.key!=='Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)return;
 if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(tag))return;
 if(window.planetLabApp?.world?.mode!=='region'||!state.rect)return;
 event.preventDefault();
 try{showPreview(resolution());status('Preview opened: this exact image will be sent to AI.')}catch(error){status(error.message,true)}
});
previewModal().addEventListener('click',event=>{if(event.target===previewModal())hidePreview()});
$('perspectiveGenerate').onclick=async()=>{if(state.busy)return;const session=window.planetLabAuthState;const provider=$('perspectiveProvider').value;const prompt=$('perspectivePrompt').value.trim();const typed=$('perspectiveKey').value.trim();const metaHeaders=getAiHeaders('/api/ai/scenario-edit');const key=typed||getProviderKey(provider)||state.keys[provider]||(provider==='meta'?metaHeaders['X-PlanetLab-Meta-Key']:'');if(!session?.user||!session.csrf){status('Sign in to generate a perspective concept.',true);return}if(currentSite()!==state.site||!state.site){status('Load a site first.',true);return}if(!state.rect){status('Draw a perspective patch first.',true);return}if(prompt.length<4||prompt.length>1500){status('Enter a prompt (4–1500 characters).',true);return}if(!key){status('Open API Keys in the top bar to configure '+provider+'.',true);return}let source;try{source=showPreview(resolution())}catch(error){status(error.message,true);return}const button=$('perspectiveGenerate');state.busy=true;button.disabled=true;button.textContent='Generating…';setBusy(true,'Generating perspective concept…');status('Generating perspective concept…');const world=window.planetLabApp?.world;const itemView=world?{camera:{x:world.camera.position.x,y:world.camera.position.y,z:world.camera.position.z},target:{x:world.controls.target.x,y:world.controls.target.y,z:world.controls.target.z}}:null;try{const response=await tracedFetch('/api/ai/scenario-edit',{method:'POST',cache:'no-store',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf,['X-PlanetLab-'+(provider==='xai'?'XAI':provider==='meta'?'Meta':'OpenAI')+'-Key']:key},body:JSON.stringify({provider,prompt,image:source,size:resolution(),width:outputSize(resolution(),state.rect).width,height:outputSize(resolution(),state.rect).height,mode:'perspective'})});const result=await response.json().catch(()=>({error:'Invalid provider response'}));if(!response.ok){openApiConsole();throw new Error(result.error||`Image generation failed (HTTP ${response.status})`)}if(currentSite()!==state.site)throw new Error('Location changed while generating. Result was not saved.');const blob=await fetch(result.image).then(r=>r.blob());const item={id:crypto.randomUUID(),site:state.site,name:$('perspectiveSelectedName').value.trim()||prompt.slice(0,50),prompt,provider,model:result.model,created:Date.now(),blob,view:itemView,rect:{...state.rect},resolution:resolution()};await put(item);state.items.unshift(item);state.current=item.id;state.keys[provider]=key;if(typed)setProviderKey(provider,key);$('perspectiveKey').value='';refreshGallery();hidePreview();showGalleryImage(item.id);status('Perspective concept saved in gallery.')}catch(error){status(error.message,true)}finally{state.busy=false;button.disabled=false;button.textContent='Generate perspective concept';setBusy(false)}};
['pointerdown','pointermove','pointerup','pointerleave'].forEach(type=>overlay().addEventListener(type,ev=>({pointerdown:onPointerDown,pointermove:onPointerMove,pointerup:onPointerUp,pointerleave:onPointerUp})[type](ev)));
window.addEventListener('planetlab:site-selected',loadSite);window.addEventListener('planetlab:site-changed',loadSite);window.addEventListener('planetlab:view-changed',()=>{if(window.planetLabApp?.world?.mode==='planet')enableSelection(false)});if(window.planetLabApp?.config)loadSite();
