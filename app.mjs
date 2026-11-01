import {fetchSiteBuildings} from './earth-buildings.mjs';
import {fetchEarthGrid,sceneElevation,validateEarthGrid,sampleElevation} from './earth-terrain.mjs';
import {loadSiteImagery,geoUV} from './earth-imagery.mjs';
import * as THREE from 'three';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {VRButton} from 'three/addons/webxr/VRButton.js';
import {STAGES, TYPES, LEVELS, TEAM_ROLES, hash, mulberry32, planetElevation, planetSurfaceHeight, terrainHeight, chooseSite, assessTerrain, citySpec, generateCity} from './planner.mjs?v=0.4.19';
const $=id=>document.getElementById(id);
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const colors={sea:'#24526e',earth:'#7f8f68',stone:'#a6a39b',path:'#b9a48d'};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const MATERIALS={};
function mat(color,metalness=0,opacity=1){let k=color+'|'+metalness+'|'+opacity;if(!MATERIALS[k])MATERIALS[k]=new THREE.MeshStandardMaterial({color,metalness,roughness:metalness?.49:.87,transparent:opacity!==1,opacity});return MATERIALS[k]}
function box(parent,x,y,z,w,h,d,color,opts={}){const o=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.02,w),Math.max(.02,h),Math.max(.02,d)),mat(color,opts.metalness||0,opts.opacity??1));o.position.set(x,y,z);o.castShadow=opts.shadows!==false;o.receiveShadow=true;parent.add(o);return o}
function cylinder(parent,x,y,z,r1,r2,h,color,sides=8){const o=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,sides),mat(color));o.position.set(x,y,z);o.castShadow=true;parent.add(o);return o}
function triangleRoof(parent,x,y,z,w,depth,color,slope=.38){const roof=new THREE.Group();roof.position.set(x,y,z);parent.add(roof);const rise=w*slope*.5;for(let s of [-1,1]){let slab=box(roof,s*w*.25,rise*.54,0,w*.56,.14,depth+.18,color);slab.rotation.z=-s*Math.atan2(rise,w*.5)}return roof}
function tree(parent,x,y,z,scale=1){cylinder(parent,x,y+.45*scale,z,.08*scale,.1*scale,.9*scale,'#6e6654');const canopy=new THREE.Mesh(new THREE.IcosahedronGeometry(.83*scale,1),mat('#567f67'));canopy.position.set(x,y+1.3*scale,z);canopy.castShadow=true;parent.add(canopy);}
function clearGroup(g){for(const o of [...g.children]){o.traverse(a=>{if(a.geometry)a.geometry.dispose();if(a.material&&!Object.values(MATERIALS).includes(a.material)){if(Array.isArray(a.material))a.material.forEach(m=>{m.map?.dispose();m.dispose()});else{a.material.map?.dispose();a.material.dispose()}}});g.remove(o)}}
class WorldView{
 constructor(canvas,changeSite,changeAnchor){
  this.canvas=canvas;this.changeSite=changeSite;this.changeAnchor=changeAnchor;this.mode='region';this.config=null;this.site=[0,0];this.plan=null;
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#10212a');
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true});this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));this.renderer.xr.enabled=true;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
  this.camera=new THREE.PerspectiveCamera(44,1,.1,600);this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.minDistance=.25;this.controls.maxDistance=220;this.controls.maxPolarAngle=Math.PI*.42;
  this.scene.add(new THREE.HemisphereLight('#bddbff','#3b412f',2.4));let sun=new THREE.DirectionalLight('#ffefd4',3.0);sun.position.set(-48,90,50);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-110;sun.shadow.camera.right=110;sun.shadow.camera.bottom=-110;sun.shadow.camera.top=110;sun.shadow.camera.near=1;sun.shadow.camera.far=250;sun.shadow.bias=-.0006;this.scene.add(sun);
  this.planetGroup=new THREE.Group();this.regionGroup=new THREE.Group();this.buildGroup=new THREE.Group();this.existingGroup=new THREE.Group();this.displayMode='massing';this.mappedBuildingsVisible=true;this.onlyExistingBuildings=false;this.robotsGroup=new THREE.Group();this.vegetationGroup=new THREE.Group();this.regionGroup.add(this.vegetationGroup);this.showAgents=false;this.showVegetation=false;this.markersGroup=new THREE.Group();this.ghostGroup=new THREE.Group();this.scenarioOutline=new THREE.Group();this.scenarioLayerGroup=new THREE.Group();this.scene.add(this.scenarioOutline,this.scenarioLayerGroup);this.scenarioSelecting=false;this.baseImageryCanvas=null;this.bookmarkGroup=new THREE.Group();this.scene.add(this.bookmarkGroup);this.scene.add(this.planetGroup,this.regionGroup,this.existingGroup,this.buildGroup,this.robotsGroup,this.markersGroup,this.ghostGroup);this.studioGroup=new THREE.Group();this.scene.add(this.studioGroup);
  this.pinGroup=new THREE.Group();this.planetGroup.add(this.pinGroup);this.pinIndex=[];this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.terrain=null;this.globe=null;this.selection=null;
  let down=null;canvas.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);canvas.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)return;this.click(e)});
  window.addEventListener('resize',()=>this.resize());this.resize();this.setMode('region');
 }
 resize(){const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return;this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix()}
 setMode(mode){this.mode=mode;const region=mode==='region';this.planetGroup.visible=!region;this.regionGroup.visible=region&&!this.onlyExistingBuildings;this.buildGroup.visible=region&&!this.onlyExistingBuildings;this.existingGroup.visible=region&&this.mappedBuildingsVisible;this.studioGroup.visible=region&&!this.onlyExistingBuildings;this.robotsGroup.visible=region&&this.showAgents&&!this.onlyExistingBuildings;this.vegetationGroup.visible=region&&this.showVegetation&&!this.onlyExistingBuildings;this.markersGroup.visible=region;this.ghostGroup.visible=region&&!this.onlyExistingBuildings;this.bookmarkGroup.visible=region;this.scenarioOutline.visible=region&&!this.onlyExistingBuildings;this.scenarioLayerGroup.visible=region&&!this.onlyExistingBuildings;this.controls.maxPolarAngle=region?Math.PI*.42:Math.PI;this.controls.enablePan=region;this.controls.enabled=region;this.canvas.style.visibility=region?'visible':'hidden';if(this.earthMap){region?this.earthMap.hide():this.earthMap.show()}const form=document.getElementById('earthSearch');if(form)form.hidden=region;const mapStatus=document.getElementById('earthStatus');if(mapStatus)mapStatus.hidden=region;this.resetCamera();if(region&&this.displayMode==='plan')this.setDisplayMode('plan')}
 resetCamera(){if(this.mode==='planet'){this.camera.position.set(0,8,83);this.controls.target.set(0,0,0);this.controls.minDistance=38;this.controls.maxDistance=160}else{const h=this.config?.geoSource==='earth-dem'?this.height(...this.site):2;this.camera.position.set(this.site[0]+57,h+68,this.site[1]+89);this.controls.target.set(this.site[0],h,this.site[1]);this.controls.minDistance=.25;this.controls.maxDistance=210}this.controls.update()}
 setDisplayMode(mode){
  this.displayMode=mode;
  if(mode==='plan'){
   this.controls.maxPolarAngle=Math.PI*.42;
   this.camera.position.set(this.site[0]+.001,125,this.site[1]+.001);
   this.controls.target.set(this.site[0],0,this.site[1]);
   this.controls.update();
  }else{
   this.resetCamera();
  }
 }
 setAgentVisibility(value){this.showAgents=!!value;this.robotsGroup.visible=this.mode==='region'&&this.showAgents}
 setVegetationVisibility(value){this.showVegetation=!!value;this.vegetationGroup.visible=this.mode==='region'&&this.showVegetation}
 buildPlanet(seed){
  clearGroup(this.planetGroup);this.planetGroup.add(this.pinGroup);this.renderPlacePins(this.pinIndex);
  const radius=28,globeGeo=new THREE.SphereGeometry(radius,192,128),arr=globeGeo.attributes.position,clrs=[];
  const sea=new THREE.Color('#205477'),coast=new THREE.Color('#c1b48e'),plain=new THREE.Color('#578c65'),
   forest=new THREE.Color('#3d7157'),rock=new THREE.Color('#8e9791'),snow=new THREE.Color('#e2e5dc');
  for(let i=0;i<arr.count;i++){
   const x=arr.getX(i)/radius,y=arr.getY(i)/radius,z=arr.getZ(i)/radius;
   const continental=planetElevation(x,y,z,seed),elev=planetSurfaceHeight([x,y,z],seed);
   let c;
   if(continental<=0)c=sea.clone().lerp(new THREE.Color('#367896'),clamp(continental+.25,0,.25)*1.6);
   else if(elev<2)c=coast.clone();
   else if(elev<12)c=plain.clone().lerp(forest,clamp((elev-2)/16,0,.72));
   else c=forest.clone().lerp(rock,clamp((elev-12)/42,0,1));
   if(elev>45||Math.abs(y)>.87)c.lerp(snow,clamp((Math.max(elev-45,0))/30+(Math.abs(y)-.87)*5,0,1));
   if(continental>0)arr.setXYZ(i,x*(radius+Math.min(.55,elev*.006)),y*(radius+Math.min(.55,elev*.006)),z*(radius+Math.min(.55,elev*.006)));
   clrs.push(c.r,c.g,c.b);
  }
  globeGeo.setAttribute('color',new THREE.Float32BufferAttribute(clrs,3));globeGeo.computeVertexNormals();
  this.globe=new THREE.Mesh(globeGeo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));
  this.planetGroup.add(this.globe);
  const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(28.85,48,32),new THREE.MeshBasicMaterial({color:'#79bfd2',transparent:true,opacity:.06,side:THREE.BackSide}));
  this.planetGroup.add(atmosphere);
  const random=mulberry32(hash(seed+'stars')),pts=[];
  for(let i=0;i<350;i++){const a=random()*Math.PI*2,b=Math.acos(random()*2-1),r=130+random()*60;pts.push(r*Math.sin(b)*Math.cos(a),r*Math.cos(b),r*Math.sin(b)*Math.sin(a))}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));this.planetGroup.add(new THREE.Points(geo,new THREE.PointsMaterial({color:'#a0b9d8',size:.35,sizeAttenuation:true})));
 }
 renderPlacePins(items=[]){
  this.pinIndex=items;if(!this.pinGroup)return;clearGroup(this.pinGroup);
  for(const entry of items){
   if(!Number.isFinite(entry.anchor?.lat)||!Number.isFinite(entry.anchor?.lon))continue;
   const lat=entry.anchor.lat*Math.PI/180,lon=entry.anchor.lon*Math.PI/180;
   const n=new THREE.Vector3(Math.cos(lat)*Math.cos(lon),Math.sin(lat),Math.cos(lat)*Math.sin(lon));
   const pin=new THREE.Mesh(new THREE.SphereGeometry(entry.starred?.52:.42,12,10),
    new THREE.MeshBasicMaterial({color:entry.draft?'#f4a86f':entry.starred?'#ffd684':'#a8f4d3',depthTest:true}));
   pin.position.copy(n.clone().multiplyScalar(29));pin.userData.placeId=entry.id;this.pinGroup.add(pin);
   // Label faces the viewer; it is still occluded by the planet on its far side.
   const canvas=document.createElement('canvas');canvas.width=280;canvas.height=64;
   const ctx=canvas.getContext('2d');ctx.fillStyle='rgba(10,27,36,.92)';ctx.fillRect(0,0,280,64);
   ctx.fillStyle='#e6f6ef';ctx.font='bold 24px system-ui';ctx.fillText(String(entry.title||'Saved site').slice(0,22),12,41,260);
   const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
   const label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:true,depthWrite:false}));
   label.position.copy(n.clone().multiplyScalar(30.5));label.scale.set(7.8,1.8,1);this.pinGroup.add(label);
  }
 }
 generateTerrain(config){this.config=config;clearGroup(this.regionGroup);this.vegetationGroup=new THREE.Group();this.regionGroup.add(this.vegetationGroup);this.vegetationGroup.visible=this.showVegetation;clearGroup(this.buildGroup);clearGroup(this.existingGroup);clearGroup(this.studioGroup);clearGroup(this.markersGroup);clearGroup(this.ghostGroup);
  this._siteImageToken=null;this.baseImageryCanvas=null;clearGroup(this.scenarioOutline);this.clearScenarioLayers();clearGroup(this.bookmarkGroup);const size=156,sub=104;const geo=new THREE.PlaneGeometry(size,size,sub,sub);geo.rotateX(-Math.PI/2);const p=geo.attributes.position,c=[];const sea=new THREE.Color('#2d6079'),shore=new THREE.Color('#bea981'),plain=new THREE.Color('#739c77'),forest=new THREE.Color('#467d65'),peak=new THREE.Color('#9eaaa3');
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),y=terrainHeight(x,z,config);p.setY(i,y);let col;if(config.geoSource==='earth-dem'){const altitude=sampleElevation(config.dem,x,z);col=altitude<=.25?sea.clone():altitude<5?shore.clone():altitude<1000?plain.clone().lerp(forest,clamp((altitude-5)/450,0,.8)):forest.clone().lerp(peak,clamp((altitude-1000)/1800,0,1))}else if(y<=.35)col=sea.clone();else if(y<1.7)col=shore.clone();else if(y<6.5)col=plain.clone().lerp(forest,clamp((y-2)/10,0,.5));else col=forest.clone().lerp(peak,clamp((y-6.5)/16,0,1));c.push(col.r,col.g,col.b)}geo.setAttribute('color',new THREE.Float32BufferAttribute(c,3));geo.computeVertexNormals();
  this.terrain=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));this.terrain.receiveShadow=true;this.regionGroup.add(this.terrain);
  // A satellite texture uses the same geographic bounds as the DEM.
  if(config.geoSource==='earth-dem'&&config.dem?.anchor){
   const uv=geo.attributes.uv;for(let i=0;i<uv.count;i++){const [u,v]=geoUV(p.getX(i),p.getZ(i));uv.setXY(i,u,v)}
   this.refreshImagery();
  }
  const water=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshStandardMaterial({color:colors.sea,transparent:true,opacity:.77,roughness:.3,metalness:.2,depthWrite:false}));water.rotation.x=-Math.PI/2;water.position.y=config.geoSource==='earth-dem'?2-config.dem.centerAltitude/10:.23;if(config.geoSource!=='earth-dem'||config.dem.heights.some(h=>h<=.25))this.regionGroup.add(water);
  const rnd=mulberry32(hash(config.seed+'vegetation|'+config.anchor.lat+'|'+config.anchor.lon));
  for(let n=0;n<235;n++){const x=(rnd()-.5)*146,z=(rnd()-.5)*146,y=terrainHeight(x,z,config);if(y<1.5||y>20||rnd()>.69||Math.hypot(x-this.site[0],z-this.site[1])<27)continue;tree(this.vegetationGroup,x,y,z,.65+rnd()*.85)}
  this.setSite(this.site);this.drawSelection();if(config.geoSource==='earth-dem'){const h=this.height(...this.site);this.controls.target.set(this.site[0],h,this.site[1]);this.camera.position.set(this.site[0]+57,h+68,this.site[1]+89);this.controls.update()}
 }
 refreshImagery(){
  if(this.config?.geoSource!=='earth-dem'||!this.terrain)return;
  const mesh=this.terrain,token=Symbol('site-imagery');this._siteImageToken=token;
  const key=window.planetLabApp?.imageryKey||'';
  const tileTemplate=this.earthMap?.tileTemplate||'';
  loadSiteImagery(this.config.dem.anchor,{maptilerKey:key,tileTemplate}).then(canvas=>{
   if(this._siteImageToken!==token||this.terrain!==mesh)return;
   this.baseImageryCanvas=canvas;this.applyImageCanvas(canvas);
   window.dispatchEvent(new Event('planetlab:imagery-ready'));
   const note=document.getElementById('imageryState');if(note)note.textContent=key?'High-resolution aerial imagery active':'Sentinel-2 imagery (2016 · approx. 10 m/pixel)';
  }).catch(error=>{
   const note=document.getElementById('imageryState');if(note)note.textContent=error.message;
   console.warn('Site imagery unavailable:',error.message);
  });
 }
 applyImageCanvas(canvas){
  if(!this.terrain||!canvas)return;
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
  const previous=this.terrain.material;
  this.terrain.material=new THREE.MeshStandardMaterial({map:texture,roughness:1,side:THREE.DoubleSide});
  previous.map?.dispose();previous.dispose();
 }
 // Keep the selection on top of the terrain and at a constant, readable screen width.
 // WebGL LineBasicMaterial ignores linewidth on most browsers; Line2 uses pixel widths.
 scenarioCorner(point){
  if(!point||!this.config)return;
  const y=this.height(point.x,point.z)+.9;
  const halo=new THREE.Mesh(new THREE.SphereGeometry(.9,16,12),
   new THREE.MeshBasicMaterial({color:0x180608,depthTest:false,depthWrite:false,toneMapped:false}));
  const core=new THREE.Mesh(new THREE.SphereGeometry(.63,16,12),
   new THREE.MeshBasicMaterial({color:0xff2438,depthTest:false,depthWrite:false,toneMapped:false}));
  const dot=new THREE.Mesh(new THREE.SphereGeometry(.23,12,8),
   new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false,depthWrite:false,toneMapped:false}));
  for(const marker of [halo,core,dot]){marker.position.set(point.x,y,point.z);marker.renderOrder=103;this.scenarioOutline.add(marker)}
 }
 drawScenarioFirstCorner(point){
  clearGroup(this.scenarioOutline);
  this.scenarioOutline.visible=this.mode==='region';
  this.scenarioCorner(point);
 }
 drawScenarioBounds(bounds){
  clearGroup(this.scenarioOutline);
  this.scenarioOutline.visible=this.mode==='region';
  this.scenarioJobBounds=bounds||null;
  if(!bounds||!this.config)return;
  const points=[],edges=[
   [bounds.xMin,bounds.zMin,bounds.xMax,bounds.zMin],
   [bounds.xMax,bounds.zMin,bounds.xMax,bounds.zMax],
   [bounds.xMax,bounds.zMax,bounds.xMin,bounds.zMax],
   [bounds.xMin,bounds.zMax,bounds.xMin,bounds.zMin]
  ];
  // Sample terrain height along the rectangle, so its outline follows the surface.
  for(const [ax,az,bx,bz] of edges){
   const steps=Math.max(2,Math.ceil(Math.hypot(bx-ax,bz-az)/1.5));
   for(let i=0;i<steps;i++){
    const t=i/steps,x=ax+(bx-ax)*t,z=az+(bz-az)*t;
    points.push(x,this.height(x,z)+.9,z);
   }
  }
  points.push(points[0],points[1],points[2]);
  this.scenarioOutlinePoints=points;
  // Dark outside stroke makes the 7-pixel red outline visible on any imagery.
  for(const [width,color,order] of [[12,0x160307,100],[7,0xff2438,101]]){
   const geometry=new LineGeometry();geometry.setPositions(points);
   const material=new LineMaterial({color,linewidth:width,worldUnits:false,depthTest:false,depthWrite:false,toneMapped:false});
   material.resolution.set(this.canvas.clientWidth||1,this.canvas.clientHeight||1);
   const line=new Line2(geometry,material);line.frustumCulled=false;line.renderOrder=order;
   this.scenarioOutline.add(line);
  }
  for(const [x,z] of [[bounds.xMin,bounds.zMin],[bounds.xMax,bounds.zMin],
                       [bounds.xMax,bounds.zMax],[bounds.xMin,bounds.zMax]]){
   this.scenarioCorner({x,z});
  }
  if(this.scenarioJobActive)this.drawScenarioJobEffect(bounds);
 }
 drawScenarioJobEffect(bounds){
  if(!bounds||!this.scenarioOutlinePoints?.length)return;
  const geometry=new LineGeometry();geometry.setPositions(this.scenarioOutlinePoints);
  const colors=new Array(this.scenarioOutlinePoints.length).fill(1);
  geometry.setColors(colors);
  const material=new LineMaterial({vertexColors:true,linewidth:10,worldUnits:false,transparent:true,opacity:.98,depthTest:false,depthWrite:false,toneMapped:false});
  material.resolution.set(this.canvas.clientWidth||1,this.canvas.clientHeight||1);
  const line=new Line2(geometry,material);line.frustumCulled=false;line.renderOrder=104;
  line.name='scenario-job-effect';this.scenarioOutline.add(line);
  this.scenarioJobLine=line;this.scenarioJobLastFrame=0;
 }
 setScenarioJob(active,bounds=null){
  this.scenarioJobActive=!!active;
  if(bounds)this.scenarioJobBounds=bounds;
  const prior=this.scenarioOutline.getObjectByName('scenario-job-effect');
  if(prior){this.scenarioOutline.remove(prior);prior.geometry?.dispose();prior.material?.dispose()}
  this.scenarioJobLine=null;
  if(this.scenarioJobActive&&this.scenarioJobBounds)this.drawScenarioJobEffect(this.scenarioJobBounds);
 }
 // Keep full provider pixels on a dedicated terrain-conforming overlay mesh:
 // drawing a 2K edited crop into a 512px full-site canvas loses all fine detail.
 clearScenarioLayers(){
  for(const child of [...this.scenarioLayerGroup.children]){
   this.scenarioLayerGroup.remove(child);
   child.geometry.dispose();child.material.map?.dispose();child.material.dispose();
   child.userData.imageBitmap?.close?.();
  }
 }
 addScenarioLayer(bounds,imageBitmap,alpha=1,split=0){
  const x0=Math.max(bounds.xMin,split),x1=bounds.xMax;
  if(x1<=x0)return false;
  const z0=bounds.zMin,z1=bounds.zMax;
  const nx=Math.max(4,Math.min(64,Math.ceil((x1-x0)/2))),nz=Math.max(4,Math.min(64,Math.ceil((z1-z0)/2)));
  const verts=[],uvs=[],indices=[];
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
   const x=x0+(x1-x0)*ix/nx,z=z0+(z1-z0)*iz/nz;
   verts.push(x,this.height(x,z)+.16,z);
   uvs.push((x-bounds.xMin)/(bounds.xMax-bounds.xMin),(z-bounds.zMin)/(bounds.zMax-bounds.zMin));
  }
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
   const a=iz*(nx+1)+ix,b=a+1,c=a+nx+1,d=c+1;
   indices.push(a,c,b,b,c,d);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();
  const texture=new THREE.Texture(imageBitmap);texture.needsUpdate=true;texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
  const material=new THREE.MeshBasicMaterial({map:texture,transparent:alpha<1,opacity:alpha,depthWrite:alpha>=1,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1});
  const mesh=new THREE.Mesh(geo,material);mesh.renderOrder=20+this.scenarioLayerGroup.children.length;
  mesh.userData.imageBitmap=imageBitmap;this.scenarioLayerGroup.add(mesh);return true;
 }
 showExistingBuildings(data){
  clearGroup(this.existingGroup);
  if(!data||this.config?.geoSource!=='earth-dem')return;
  const known=new THREE.MeshStandardMaterial({color:'#dbe1df',roughness:.87,transparent:true,opacity:.92,side:THREE.DoubleSide});
  const estimated=new THREE.MeshStandardMaterial({color:'#b5c3d3',roughness:.9,transparent:true,opacity:.83,side:THREE.DoubleSide});
  const outlineMaterial=new THREE.LineBasicMaterial({color:'#fff0b3',transparent:true,opacity:.67,depthTest:true});
  for(const building of data.buildings){
   const ring=building.outline;
   const h=building.heightMetres??building.estimatedHeightMetres;
   if(h!==null&&h!==undefined){
    // Footprints are surveyed OSM outlines. Height is explicit in metres OR
    // estimated from tagged storeys, and clearly distinguished in the UI.
    // Each base corner follows the DEM: buildings remain upright on sloping ground.
    const vertices=[],indices=[];
    const roofY=Math.max(...ring.map(([x,z])=>this.height(x,z)))+h/10;
    for(const [x,z] of ring){const ground=this.height(x,z);vertices.push(x,ground+.04,z,x,roofY,z)}
    for(let i=0;i<ring.length;i++){const j=(i+1)%ring.length,a=2*i,b=2*j;indices.push(a,b,a+1,b,b+1,a+1)}
    const shapePoints=ring.map(([x,z])=>new THREE.Vector2(x,z));
    const triangles=THREE.ShapeUtils.triangulateShape(shapePoints,[]);
    for(const [a,b,c] of triangles)indices.push(2*a+1,2*b+1,2*c+1);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,building.heightMetres!==null?known:estimated);
    mesh.receiveShadow=true;mesh.castShadow=true;
    mesh.userData={osmId:building.id,heightMetres:h,heightSource:building.heightMetres!==null?'recorded':'estimated-from-storeys',kind:'mapped-building'};
    this.existingGroup.add(mesh);
   }else{
    const points=ring.map(([x,z])=>new THREE.Vector3(x,this.height(x,z)+.18,z));
    const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points),outlineMaterial);
    line.userData={osmId:building.id,kind:'mapped-footprint'};this.existingGroup.add(line);
   }
  }
  this.setFootprintVisibility(document.getElementById('showBuildingOutlines')?.checked!==false);
 }
 setFootprintVisibility(visible){this.existingGroup.children.forEach(o=>{if(o.userData.kind==='mapped-footprint')o.visible=!!visible})}
 setExistingBuildingVisibility(visible){this.mappedBuildingsVisible=!!visible;this.existingGroup.visible=this.mode==='region'&&this.mappedBuildingsVisible}
 setExistingBuildingIsolation(visible){this.onlyExistingBuildings=!!visible;this.setMode(this.mode)}
 showViewBookmarks(entries=[]){
  clearGroup(this.bookmarkGroup);
  if(this.config?.geoSource!=='earth-dem')return;
  for(const entry of entries){
   const site=entry.site;
   if(!Array.isArray(site)||site.length!==2||site.some(v=>!Number.isFinite(v)||Math.abs(v)>77))continue;
   const [x,z]=site,y=this.height(x,z)+.6;
   const mesh=new THREE.Mesh(new THREE.SphereGeometry(.9,12,10),new THREE.MeshBasicMaterial({color:'#ffdb89',depthTest:true}));
   mesh.position.set(x,y,z);mesh.userData.bookmarkId=entry.id;this.bookmarkGroup.add(mesh);
  }
 }
 setSite(site){this.site=site;if(!this.config)return;clearGroup(this.markersGroup);let [x,z]=site,y=terrainHeight(x,z,this.config)+.55;const ring=new THREE.Mesh(new THREE.TorusGeometry(4.1,.13,8,60),new THREE.MeshBasicMaterial({color:'#c5ff93',depthWrite:false}));ring.rotation.x=Math.PI/2;ring.position.set(x,y,z);this.markersGroup.add(ring);const pin=cylinder(this.markersGroup,x,y+1.2,z,.16,.2,2.3,'#c3ef9f');pin.rotation.z=.08}
 setPlan(plan,showHints){this.plan=plan;clearGroup(this.buildGroup);this.setHints(showHints)}
 setVoluntaryZone(enabled){
  const old=this.markersGroup.getObjectByName('voluntary-boundary');if(old){this.markersGroup.remove(old);old.geometry.dispose();old.material.dispose()}
  if(!enabled||!this.plan)return;
  const radius=this.plan.cellSize*this.plan.gridSize*.56;
  const pts=[];for(let i=0;i<=100;i++){const a=i/100*Math.PI*2,x=this.site[0]+Math.cos(a)*radius,z=this.site[1]+Math.sin(a)*radius;pts.push(V(x,this.height(x,z)+.4,z))}
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:'#a8d5f4',transparent:true,opacity:.88}));line.name='voluntary-boundary';this.markersGroup.add(line);
 }
 setHints(visible){clearGroup(this.ghostGroup);if(!this.plan)return;this.ghostGroup.visible=visible;
  for(const g of this.plan.landuse){if(g.usage==='road'||g.usage==='protected'||g.usage==='unassigned'||g.usage==='unfunded')continue;
    const base=box(this.ghostGroup,g.x,terrainHeight(g.x,g.z,this.config)+.08,g.z,2.1,.035,2.1,'#a3c0af',{opacity:.24,shadows:false});base.userData.hint=true;
  }
 }
 height(x,z){return terrainHeight(x,z,this.config)}
 drawSelection(){if(!this.selection)return;}
 click(e){const b=this.canvas.getBoundingClientRect();this.pointer.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);if(this.mode==='planet'&&this.globe){
  const pinHit=this.raycaster.intersectObjects(this.pinGroup.children.filter(p=>p.userData.placeId),false)[0];
  const globeHit=this.raycaster.intersectObject(this.globe)[0];
  if(pinHit?.object?.userData?.placeId && (!globeHit||pinHit.distance<globeHit.distance)){
    window.dispatchEvent(new CustomEvent('planetlab:open-pin',{detail:{id:pinHit.object.userData.placeId}}));return;
  }
  const hit=globeHit;if(hit){const p=this.planetGroup.worldToLocal(hit.point.clone()).normalize(),lat=Math.asin(p.y)*180/Math.PI,lon=Math.atan2(p.z,p.x)*180/Math.PI;this.changeAnchor({lat:Math.round(lat*10)/10,lon:Math.round(lon*10)/10});return}}if(this.mode==='region'&&this.terrain){
  if(this.scenarioSelecting){const patchHit=this.raycaster.intersectObject(this.terrain)[0];
   if(patchHit){window.dispatchEvent(new CustomEvent('planetlab:scenario-point',{detail:{x:patchHit.point.x,z:patchHit.point.z}}))}return}
  const bookmark=this.raycaster.intersectObjects(this.bookmarkGroup.children)[0];
  if(bookmark?.object?.userData.bookmarkId){window.dispatchEvent(new CustomEvent('planetlab:open-view-bookmark',{detail:{id:bookmark.object.userData.bookmarkId}}));return}
  const meshHit=this.raycaster.intersectObjects(this.buildGroup.children,true).find(intersection=>{
    let ancestor=intersection.object;
    while(ancestor&&ancestor!==this.buildGroup){if(ancestor.userData?.task?.meta?.kind)return true;ancestor=ancestor.parent}
    return false;
  });
  if(meshHit){
    let ancestor=meshHit.object;
    while(ancestor&&ancestor!==this.buildGroup&&!ancestor.userData?.task)ancestor=ancestor.parent;
    const task=ancestor?.userData?.task;
    if(task?.meta?.kind){window.dispatchEvent(new CustomEvent('planetlab:building-selected',{detail:{task}}));return}
  }
  const hit=this.raycaster.intersectObject(this.terrain)[0];if(hit){const site=chooseSite([hit.point.x,hit.point.z],this.config);this.changeSite(site);return}}}
 makePart(task){const g=new THREE.Group(),{type,stage,x,z,meta}=task,y=this.height(x,z);g.position.set(x,y,z);const bkind=meta.kind||type,w=meta.width||2.8,d=meta.depth||2.2,h=meta.floors>6?meta.floors*1.25:Math.max(2.6,(meta.floors||1)*2.9);const palette=['#ddc2a7','#bcb9a7','#c3cbd1','#c9a8a2'];
 if(type==='road'||type==='arterial'){
  const wide=meta.width||.75,sideX=meta.axis==='z'?wide:this.plan.cellSize,
   sideZ=meta.axis==='x'?wide:this.plan.cellSize;
  const strip=(sx,sz)=>{const geo=new THREE.PlaneGeometry(sx,sz,8,8);geo.rotateX(-Math.PI/2);
   const pos=geo.attributes.position;for(let i=0;i<pos.count;i++)pos.setY(i,this.height(x+pos.getX(i),z+pos.getZ(i))-y+.12);
   geo.computeVertexNormals();const surface=new THREE.Mesh(geo,mat('#536775'));surface.receiveShadow=true;g.add(surface)};
  strip(sideX,sideZ);
  if(meta.axis==='junction')strip(wide,this.plan.cellSize);
 }
 else if(type==='path'){const m=box(g,0,.09,0,1.5,.07,.24,'#c1ae8f');m.rotation.y=meta.rotation||0}
 else if(type==='rail'){let rail=box(g,0,.15,0,meta.width||3.5,.14,.9,'#786f67');rail.rotation.y=meta.rotation||0;for(let s of [-.26,.26]){const m=box(g,0,.26,s,meta.width||3.5,.08,.08,'#bbcacd');m.rotation.y=meta.rotation||0}}
 else if(type==='survey'){cylinder(g,0,1,0,.12,.22,2,'#a5f5ed');const cone=new THREE.Mesh(new THREE.ConeGeometry(.55,.75,6),mat('#c4e7ee'));cone.position.y=2.25;g.add(cone)}
 else if(type==='grid'){box(g,0,.22,0,2.2,.4,2.2,'#788a94');for(let s of [-.65,.65]){let p=cylinder(g,s,1.9,0,.09,.1,3.4,'#b5aaa2');box(g,s,3.4,0,1.15,.09,.09,'#edcf84')}}
 else if(type==='wastewater'){box(g,0,.25,0,2.7,.5,1.8,'#6d818a');for(const px of [-.5,.5])cylinder(g,px,.82,0,.44,.44,.72,'#82a5ad',12)}
 else if(type==='drain'){box(g,0,.07,0,2,.12,1.2,'#607b7d');for(let q=-2;q<=2;q++)box(g,q*.27,.16,0,.05,.05,1.1,'#a8c1c0')}
 else if(type==='water'){cylinder(g,0,1.05,0,.85,.86,2.1,'#78a7b4',12);cylinder(g,0,2.2,0,.95,.95,.2,'#9fb8c2',12)}
 else if(stage==='nature'){const s=meta.size||3;box(g,0,.08,0,s,.1,s,type==='forest'?'#528759':'#6ba965');if(type==='pond'){const pond=new THREE.Mesh(new THREE.CylinderGeometry(1.0,1.0,.08,18),mat('#69b7c9'));pond.position.y=.18;g.add(pond)}else{const r=mulberry32(hash(task.id));for(let i=0;i<(meta.trees||3);i++)tree(g,(r()-.5)*s*.8,.12,(r()-.5)*s*.8,.5+r()*.4)}}
 else if(stage==='foundation'){box(g,0,.18,0,w+.25,.36,d+.25,'#9ea6a4');box(g,0,.37,0,w,.07,d,'#c8c0af')}
 else if(stage==='structure'){
  const base=bkind==='data'?'#8aa6c2':bkind==='factory'?'#ac9383':bkind==='farm'?'#b9aa74':palette[meta.tone||0];const m=box(g,0,.48+h*.5,0,w,h,d,base);m.rotation.y=meta.orientation||0;
  if(bkind==='power'){for(let i=-1;i<=1;i++)cylinder(g,i*w*.24,1+h+.5,0,.18,.23,2.9,'#c2c4c1',12)}
  if(bkind==='factory'){for(let i=0;i<3;i++)cylinder(g,-w*.3+i*w*.3,1+h+.25,0,.1,.16,1.3,'#a8b9bb',12)}
  if(bkind==='stadium'){box(g,0,.48+h+.35,0,w*1.12,.4,d*1.12,'#b9cbd3')}
  if(bkind==='airport'){box(g,0,.48+h*.9,0,w*1.3,.26,d*1.25,'#c8d9df')}
 }
 else if(stage==='facade'){
  const high=h;const floors=clamp(Math.round(high/2.9),1,22);const count=clamp(Math.round(w/.72),2,8);const glass=bkind==='data'?'#405d76':'#426c83';
  for(let floor=0;floor<floors;floor++){
    const yy=.9+floor*(high/floors);
    for(let k=0;k<count;k++){const xx=-w*.42+(k+.5)*(w*.84/count);box(g,xx,yy+.5,d/2+.023,w*.64/count,.45,.047,glass,{metalness:.25});box(g,xx,yy+.5,-d/2-.023,w*.64/count,.45,.047,glass,{metalness:.25})}
  }
  box(g,0,1.23,d/2+.048,.65,1.9,.075,'#8e7257');box(g,0,1.98,d/2+.095,.13,.08,.025,'#e1c594')
 }
 else if(stage==='roof'){
  const roofY=.5+h+.24;
  if(['home','cottage','workers','farm','temporary'].includes(bkind))triangleRoof(g,0,roofY,0,w+.15,d+.23,bkind==='farm'?'#8b6546':'#677b7e');
  else{box(g,0,roofY,0,w+.3,.25,d+.32,bkind==='data'?'#6b8293':'#66777f');if(bkind==='data'){for(let i=0;i<3;i++)box(g,-w*.3+i*w*.29,roofY+.25,0,.55,.36,.7,'#9ab1b9')}}
 }
 if(this.plan?.schema==='planet.city.plan.v2'&&['foundation','structure','facade','roof'].includes(stage))g.scale.setScalar(.1);
 this.buildGroup.add(g);g.userData.task=task;return g;
 }
 render(){if(this.mode==='planet')return;this.controls.update();
  if(this.scenarioJobActive&&this.scenarioJobLine){
   const now=performance.now();if(now-(this.scenarioJobLastFrame||0)>45){
    this.scenarioJobLastFrame=now;const points=this.scenarioOutlinePoints||[],colors=[];
    for(let i=0;i<points.length/3;i++){
     const c=new THREE.Color().setHSL((now*.00027+i/Math.max(1,points.length/3))%1,.95,.55);
     colors.push(c.r,c.g,c.b);
    }
    this.scenarioJobLine.geometry.setColors(colors);
   }
  }
  this.renderer.render(this.scene,this.camera);
 }
}
class Robot{
 constructor(view,index,role,base){this.view=view;this.index=index;this.role=role;this.capabilities=TEAM_ROLES[(index)%TEAM_ROLES.length][3];this.name=`${role}-${String(index+1).padStart(2,'0')}`;this.color=TEAM_ROLES[(index)%TEAM_ROLES.length][2];this.busy=false;this.status='Standby';this.task=null;this.goal=null;this.timer=0;this.phase=0;this.home=base;this.position=[...base];this.state='idle';
 this.group=new THREE.Group();this.view.robotsGroup.add(this.group);
 // Technical autonomous field rover, intentionally schematic (no humanoid face).
 box(this.group,0,.34,0,.82,.3,1.08,'#485965',{metalness:.25});
 for(const x of [-.48,.48])for(const z of [-.36,.36]){
  const wheel=cylinder(this.group,x,.17,z,.22,.22,.16,'#28333b',12);
  wheel.rotation.z=Math.PI/2;
 }
 box(this.group,0,.56,.1,.64,.18,.55,'#566d78',{metalness:.2});
 box(this.group,0,.72,-.25,.42,.11,.22,this.color);
 cylinder(this.group,0,1.04,0,.045,.06,.58,'#b7c1c5',10);
 const sensor=box(this.group,0,1.36,0,.3,.16,.26,'#273f4f',{metalness:.2});
 const tool=box(this.group,.3,.73,.29,.13,.54,.13,'#a3b2b9',{metalness:.3});
 this.left=sensor;this.right=tool;this.group.scale.setScalar(.16);
 this.reset();}
 reset(){this.state='idle';this.busy=false;this.task=null;this.status='Standby';this.position=[...this.home];this.place()}
 place(){const [x,z]=this.position;this.group.position.set(x,this.view.height(x,z)+.05,z)}
 assign(task,done){this.task=task;this.done=done;this.busy=true;this.status=`${task.stage}: ${task.type}`;this.goal=[task.x,task.z];this.state='walk'}
 update(dt){this.phase+=dt*8;const walk=this.state==='walk';this.left.rotation.y=walk?Math.sin(this.phase)*.11:0;this.right.rotation.x=walk?Math.sin(this.phase)*.09:0;
 if(walk){let dx=this.goal[0]-this.position[0],dz=this.goal[1]-this.position[1],dist=Math.hypot(dx,dz),step=Math.min(dist,15*dt);if(dist>.02){this.position[0]+=dx/dist*step;this.position[1]+=dz/dist*step;this.group.rotation.y=Math.atan2(dx,dz)}this.place();if(dist<=step+.02){this.state='work';this.timer=.28+Math.min(1.3,(this.task.meta.floors||1)*.045)}}
 else if(this.state==='work'){this.timer-=dt;this.group.rotation.z=Math.sin(this.phase*2)*.06;if(this.timer<=0){this.group.rotation.z=0;this.state='idle';this.busy=false;this.status='Standby';let completed=this.task;this.task=null;this.done(completed,this)}}
 }
}
class CityApp{
 constructor(){this.events=[];this.time=0;this.last=0;this.lastUi=0;this.running=true;this.plan=null;this.anchor={lat:51.5074,lon:-0.1278};this.earthDem=null;this.siteBuildings=null;this.buildingsState='idle';this.imageryKey='';this.geoSource='earth-dem';this.site=[0,0];this.robots=[];this.config=null;this.world=new WorldView($('scene'),site=>this.changeSite(site),anchor=>this.changeAnchor(anchor));this.installEvents();this.config=null;this.world.setMode('planet');this.updateMode();this.updateUi();this.updateBuildingCoverage();this.initEarthMap();this.loop=this.loop.bind(this);this.world.renderer.setAnimationLoop(this.loop);this.setupXR()}
 async setupXR(){
  const target=$('xrControls');
  if(!navigator.xr?.isSessionSupported || !window.isSecureContext)return;
  try{
    if(!await navigator.xr.isSessionSupported('immersive-vr'))return;
    const button=VRButton.createButton(this.world.renderer);
    target.appendChild(button);target.hidden=false;
  }catch(error){console.info('WebXR VR unavailable:',error?.message||error)}
 }
 log(msg){this.events.unshift({time:this.time,msg});this.events=this.events.slice(0,45)}
 readConfig(){const input={seed:$('seed').value||'ODYSSEY-7',geography:$('geography').value,anchor:this.anchor,profile:$('profile').value,level:$('level').value,budget:$('budget').value,teams:$('teams').value,brief:$('brief').value,site:this.site};if(this.geoSource==='earth-dem'&&this.earthDem){input.geoSource=this.geoSource;input.dem=this.earthDem;if(this.buildingsState==='ready')input.existingBuildings=this.siteBuildings}return citySpec(input)}
 generateWorld(){this.running=false;this.config=this.readConfig();if(this.geoSource!=='earth-dem')this.world.buildPlanet(this.config.seed);this.site=this.geoSource==='earth-dem'?[0,0]:(chooseSite([0,0],this.config)||[0,0]);this.config.site=this.site;this.world.setSite(this.site);this.world.generateTerrain(this.config);if(this.buildingsState==='ready')this.world.showExistingBuildings(this.siteBuildings);this.world.setMode('region');window.dispatchEvent(new Event('planetlab:site-changed'));this.plan=null;this.events=[];this.removeRobots();this.log('Planet terrain generated. Select settlement site or generate a masterplan.');this.updateLocation();this.drawMap();this.updateUi()}
 removeRobots(){for(const a of this.robots){this.world.robotsGroup.remove(a.group);a.group.traverse(o=>o.geometry?.dispose())}this.robots=[]}
 async changeAnchor(anchor){return this.selectEarthSite(anchor)}
 async initEarthMap(){try{const container=$('earthMap');container.hidden=false;const {EarthMap}=await import('./earth-map.mjs?v=0.4.19');this.world.earthMap=new EarthMap(container,anchor=>this.selectEarthSite(anchor));this.world.earthMap.show();this.world.earthMap.connectSearch($('earthSearch'),$('earthQuery'),$('earthStatus'));this.world.earthMap.map.resize();const status=$('earthStatus');status.textContent='Click a real location on Earth to inspect terrain.';window.dispatchEvent(new Event('planetlab:earth-ready'));}catch(error){$('earthStatus').textContent='Earth map unavailable: '+error.message;console.error(error)}}
 async selectEarthSite(anchor){const ticket=this._earthRequest=(this._earthRequest||0)+1;const status=$('earthStatus');this.world.setMode('planet');status.textContent=`Loading measured elevation near ${anchor.lat.toFixed(4)}°, ${anchor.lon.toFixed(4)}°…`;this.world.earthMap?.focus(anchor);try{const dem=await fetchEarthGrid(anchor);if(ticket!==this._earthRequest)return;this.siteBuildings=null;this.buildingsState='loading';this.updateBuildingCoverage();this.geoSource='earth-dem';this.anchor=anchor;this.earthDem=dem;this.site=[0,0];this.generateWorld();this.updateMode();this.log(`Earth elevation loaded at ${anchor.lat}°, ${anchor.lon}°`);window.dispatchEvent(new Event('planetlab:site-selected'));status.textContent=`Real elevation loaded · ${Math.round(dem.centerAltitude)} m above sea level${dem.artifactsCorrected?` · ${dem.artifactsCorrected} isolated DEM outliers interpolated`:''}`;this.updateUi();this.loadBuildings(ticket);return true;}catch(error){if(ticket!==this._earthRequest)return;status.textContent=`Real elevation unavailable: ${error.message}. No synthetic terrain substituted.`;this.world.setMode('planet');this.updateMode();console.error(error);return false}}
 async loadBuildings(ticket=this._earthRequest){
  if(!this.earthDem)return;
  this.buildingsState='loading';this.updateBuildingCoverage();
  const anchor={...this.anchor};
  try{
   const data=await fetchSiteBuildings(anchor);
   if(ticket!==this._earthRequest)return;
   this.siteBuildings=data;this.buildingsState='ready';this.world.showExistingBuildings(data);
  }catch(error){
   if(ticket!==this._earthRequest)return;
   this.siteBuildings=null;this.buildingsState='unavailable';
   console.warn('Mapped building footprints:',error.message);
  }
  this.updateBuildingCoverage();
 }
 updateBuildingCoverage(){
  const note=$('existingBuildingsState');if(!note)return;
  const status=this.buildingsState;
  if(status==='loading')note.textContent='Loading real building footprints…';
  else if(status==='ready'){
   const buildings=this.siteBuildings.buildings,measured=buildings.filter(b=>b.heightMetres!==null).length,estimated=buildings.filter(b=>b.heightMetres===null&&b.estimatedHeightMetres!==null).length;
   note.textContent=`${buildings.length} mapped footprints from OpenStreetMap · ${measured} measured heights · ${estimated} approximate 3D from mapped storeys · ${buildings.length-measured-estimated} outline only. Rendered locally in the browser with Three.js; no invented heights for untagged buildings.`;
  }else if(status==='unavailable')note.textContent='Building data unavailable. Planning paused; retry loading.';
  else note.textContent='Select an Earth location to load mapped buildings.';
  $('plan').disabled=this.geoSource==='earth-dem'&&status!=='ready';
 }
 changeSite(site){if(!site){this.log('No safe site identified inside the selected region. Choose another location on the globe.');this.updateUi();return}this.site=site;this.world.setSite(site);this.updateLocation();this.drawMap();window.dispatchEvent(new Event('planetlab:site-changed'));this.log('New site proposed — generate masterplan to update layout.');this.updateUi()}
 updateLocation(){const [x,z]=this.site;$('siteText').textContent=`Site: x ${x.toFixed(1)}, z ${z.toFixed(1)} · ${this.geoSource==='earth-dem'?'Earth':'Legacy planet'} ${this.anchor.lat.toFixed(4)}°, ${this.anchor.lon.toFixed(4)}°.`;$('locationTag').innerHTML=`<b>${this.world.mode==='planet'?'EARTH':this.geoSource==='earth-dem'?'DEM REGION':'LEGACY REGION'}</b> · ${this.anchor.lat.toFixed(4)}°, ${this.anchor.lon.toFixed(4)}°`}
 createPlan(){this.running=false;if(this.geoSource==='earth-dem'&&this.buildingsState!=='ready'){this.updateBuildingCoverage();return}if(!this.config){$('earthStatus').textContent='Choose an Earth location before planning.';return}this.config=this.readConfig();this.plan=generateCity(this.config);this.world.setPlan(this.plan,$('showPlan').checked);this.world.setVoluntaryZone($('freeZone').checked);this.removeRobots();this.robots=[];
 const baseX=clamp(this.site[0]-25,-70,70),baseZ=clamp(this.site[1]-25,-70,70);for(let i=0;i<this.config.teams;i++){const role=TEAM_ROLES[i][0],start=[baseX+(i%6)*1.8,baseZ+Math.floor(i/6)*2.0];this.robots.push(new Robot(this.world,i,role,start))}
 this.time=0;this.events=[];this._complete=null;this.log(`${this.config.profile} / ${this.config.level}: ${this.plan.feasibility.status} · ${this.plan.stats.tasks} tasks.`);this.log(`Funding $${this.plan.stats.estimatedCost.toFixed(2)}M / $${this.config.budget.toFixed(2)}M. ${this.plan.stats.deferred} tasks deferred.`);this.running=this.plan.feasibility.status==='screened'&&this.plan.tasks.length>0;this.world.setMode('region');this.updateMode();this.drawMap();this.updateUi()}
 installEvents(){
  $('planetMode').onclick=()=>{this.world.setMode('planet');this.updateMode()};$('regionMode').onclick=()=>{if(!this.config){$('earthStatus').textContent='Choose an Earth location on the map first.';return}this.world.setMode('region');this.updateMode()};
  $('newWorld').onclick=()=>{if(this.geoSource==='earth-dem'){if(!this.earthDem){this.world.setMode('planet');return}this.selectEarthSite(this.anchor)}else this.generateWorld()};$('newSite').onclick=()=>this.changeSite(chooseSite([this.site[0]+12,this.site[1]+11],this.readConfig()));
  $('retryBuildings').onclick=()=>this.loadBuildings();$('showBuildingOutlines').onchange=e=>this.world.setFootprintVisibility(e.target.checked);$('showExistingBuildings3d').onchange=e=>this.world.setExistingBuildingVisibility(e.target.checked);$('showOnlyExistingBuildings').onchange=e=>this.world.setExistingBuildingIsolation(e.target.checked);$('applyImagery').onclick=async()=>{
  const button=$('applyImagery'),key=$('imageryKey').value.trim(),note=$('imageryState');
  button.disabled=true;note.textContent='Checking imagery provider…';
  try{
   if(!this.world.earthMap)throw new Error('Earth globe not loaded');
   await this.world.earthMap.setImageryKey(key);
   this.imageryKey=key;
   if(this.world.mode==='region')this.world.refreshImagery();
   else note.textContent=key?'MapTiler satellite imagery enabled':'Using free Sentinel-2 imagery';
   $('imageryKey').value='';
  }catch(error){note.textContent=error.message;console.warn('MapTiler imagery setup:',error.message)}
  finally{button.disabled=false}
 };
  $('plan').onclick=()=>this.createPlan();$('restart').onclick=()=>this.createPlan();$('toggle').onclick=()=>{this.running=!this.running;this.updateUi()};$('camera').onclick=()=>this.world.resetCamera();
  $('showPlan').onchange=()=>this.world.setHints($('showPlan').checked);
  const selectView=(view)=>{for(const [name,id] of [['massing','viewMassing'],['plan','viewPlan'],['agents','viewAgents']]){$(id).classList.toggle('active',name===view);$(id).setAttribute('aria-pressed',String(name===view))}this.world.setAgentVisibility(view==='agents');this.world.setDisplayMode(view==='plan')};
  $('viewMassing').onclick=()=>selectView('massing');$('viewPlan').onclick=()=>selectView('plan');$('viewAgents').onclick=()=>selectView('agents');$('showVegetation').onchange=e=>this.world.setVegetationVisibility(e.target.checked);$('freeZone').onchange=()=>{this.world.setVoluntaryZone($('freeZone').checked);this.updateUi()};
  $('export').onclick=()=>{if(!this.plan)return;const data={...this.plan,governance:$('freeZone').checked?'voluntary-free-zone':'unspecified',tasks:this.plan.tasks.map(t=>({...t}))};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='planet-city-'+this.config.seed.replace(/[^a-z0-9_-]/gi,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  $('map').onclick=e=>{const r=e.currentTarget.getBoundingClientRect(),x=((e.clientX-r.left)/r.width-.5)*156,z=((e.clientY-r.top)/r.height-.5)*156;this.changeSite(chooseSite([x,z],this.readConfig()))};
 }
 updateMode(){let p=this.world.mode==='planet';$('planetMode').classList.toggle('active',p);$('regionMode').classList.toggle('active',!p);$('sceneHelp').innerHTML=p?'Real Earth · Drag to rotate · Zoom to explore<br/>Click a location to load measured elevation':'Measured local relief · Drag to orbit<br/>Click terrain to propose a site';this.updateLocation();window.dispatchEvent(new Event('planetlab:view-changed'))}
 chooseTask(robot){const pending=this.plan.tasks.filter(t=>t.status==='queued');if(!pending.length)return null;const earliest=Math.min(...pending.map(t=>STAGES.findIndex(s=>s[0]===t.stage)));const tasks=pending.filter(t=>STAGES.findIndex(s=>s[0]===t.stage)===earliest);const matched=tasks.filter(t=>robot.capabilities.includes(t.stage));const choices=matched.length?matched:tasks;return choices.reduce((a,b)=>!a||Math.hypot(b.x-robot.position[0],b.z-robot.position[1])<Math.hypot(a.x-robot.position[0],a.z-robot.position[1])?b:a,null)}
 update(dt){if(!this.plan)return;this.time+=dt;
  for(const bot of this.robots)bot.update(dt);
  for(const bot of this.robots){if(bot.busy)continue;const task=this.chooseTask(bot);if(task){task.status='assigned';bot.assign(task,(t,r)=>{t.status='installed';this.world.makePart(t);if(['survey','arterial','power','data','tower','park','airport','stadium'].includes(t.type)&&this.events.length<35||t.type==='airport'){this.log(`${r.name}: installed ${TYPES[t.type]?.[0]||t.type}`)} });}}
  if(this.plan.tasks.every(t=>t.status==='installed')&&this._complete!==this.plan){this._complete=this.plan;this.running=false;this.log('Masterplan construction finished. All funded tasks installed.')}
 }
 updateUi(){const p=this.plan,stats=p?.stats,done=p?.tasks.filter(t=>t.status==='installed').length||0,total=p?.tasks.length||0,perc=total?Math.round(done/total*100):0;
  $('status').textContent=this.world.mode==='planet'?'EARTH OVERVIEW':!p?'WORLD READY':p.feasibility?.status==='blocked'?'SITE UNSUITABLE':p.feasibility?.status==='incomplete'?'PLAN INCOMPLETE':total&&done===total?'SETTLEMENT COMPLETE':this.running?'ROBOT TEAMS ACTIVE':'PAUSED';
  $('homesCount').textContent=stats?.buildings||'0';$('roadCount').textContent=stats?.roads||'0';$('allocated').textContent='$'+(stats?.estimatedCost||0).toFixed(1);$('remaining').textContent='$'+Math.max(0,(stats?.budget||0)-(stats?.estimatedCost||0)).toFixed(1);
  $('planTag').innerHTML=p?`<b>${p.config.level.toUpperCase()}</b> · ${p.config.profile} · ${p.gridSize}×${p.gridSize} plots${$('freeZone').checked?' · voluntary-zone':''}`:'No masterplan';
  $('progressText').textContent=`${done} / ${total} installed · ${perc}%`;$('bar').style.width=perc+'%';$('phaseName').textContent=p?.feasibility?.status==='blocked'?'NO BUILDABLE SITE':p?.feasibility?.status==='incomplete'?'NETWORK OR UTILITIES UNFUNDED':done===total&&total?'CONSTRUCTION COMPLETE':(p?STAGES.find(s=>p.tasks.some(t=>t.stage===s[0]&&t.status!=='installed'))?.[1]:'Waiting for plan')||'Finishing';
  $('stages').innerHTML=STAGES.map(([stage])=>{const list=p?.tasks.filter(t=>t.stage===stage)||[];return `<span title="${stage}" class="${list.length&&list.every(t=>t.status==='installed')?'done':list.some(t=>t.status==='assigned')?'current':''}"></span>`}).join('');
  $('toggle').textContent=this.running?'Ⅱ Pause teams':'▶ Resume teams';
  $('teamList').innerHTML=this.robots.map(r=>`<div class="team"><div class="dot" style="background:${r.color}">${r.role[0]}</div><div><strong>${r.name}</strong><small>${r.capabilities.join(' / ')}</small></div><span class="team-state">${r.status}</span></div>`).join('');
  const counts={};for(const t of p?.tasks||[]){const stage=t.stage;counts[stage]??={done:0,total:0};counts[stage].total++;if(t.status==='installed')counts[stage].done++}
  $('catalog').innerHTML=STAGES.filter(s=>counts[s[0]]).map(([key,name])=>`<div class="catalog"><span>${name}</span><span>${counts[key].done}/${counts[key].total}</span></div>`).join('');
  $('feed').innerHTML=this.events.slice(0,16).map(e=>`<p><time>${String(Math.floor(e.time/60)).padStart(2,'0')}:${String(Math.floor(e.time%60)).padStart(2,'0')}</time>${e.msg}</p>`).join('');
  $('mapNote').textContent=p?`${stats.protectedLots} plots reserved or unsuitable · ${stats.deferred} jobs deferred by budget · seed ${p.config.seed}`:'Awaiting planned zoning and route network.';
  const insight=$('feasibilityList');if(insight){insight.replaceChildren();if(p?.feasibility){$('feasibilityState').textContent=p.feasibility.status.toUpperCase()+' · '+p.feasibility.roadAccessParcels+' road-access parcels';for(const message of p.feasibility.findings){const li=document.createElement('li');li.textContent=message;insight.appendChild(li)}}else{$('feasibilityState').textContent='Select a site to assess';const li=document.createElement('li');li.textContent='Terrain, flood exposure, connected roads, and service dependencies will be screened before buildings are placed.';insight.appendChild(li)}}
 }
 drawMap(){const canvas=$('map'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);let config=this.readConfig();let sx=w/100,sz=h/68;for(let i=0;i<100;i++)for(let j=0;j<68;j++){let x=(i+.5)/100*156-78,z=(j+.5)/68*156-78,y=terrainHeight(x,z,config);ctx.fillStyle=y<.28?'#28617c':y<1.6?'#b0ad87':y<7?'#547c60':'#8b9d8a';ctx.fillRect(i*sx,j*sz,sx+1,sz+1)}
 if(this.plan){let p=this.plan;for(const g of p.landuse){const px=(g.x+78)/156*w,py=(g.z+78)/156*h,size=p.cellSize/156*w;let col={road:'#6a8294',arterial:'#6a8294',park:'#7fc783',forest:'#3c7850',protected:'#2d6880',unfunded:'#8d6872',unassigned:'#628d70',home:'#d9b394',tower:'#b39cce',data:'#7298d9',factory:'#bf8f67',farm:'#ad9c57',hotel:'#e2bda3',spa:'#88caca',mall:'#cbb2bd',stadium:'#b6c4cc',airport:'#a6b7ce',station:'#88b8bb'}[g.usage]||'#d1b7a5';ctx.fillStyle=col;ctx.fillRect(px-size*.39,py-size*.39,size*.78,size*.78)}}
 ctx.strokeStyle='#d8f7ba';ctx.lineWidth=2;let x=(this.site[0]+78)/156*w,y=(this.site[1]+78)/156*h;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(x-10,y);ctx.lineTo(x+10,y);ctx.moveTo(x,y-10);ctx.lineTo(x,y+10);ctx.stroke();
 }
 loop(now){try{const realDt=Math.min(.05,(now-this.last)/1000||.016);this.last=now;if(this.running&&this.world.mode==='region')this.update(realDt*Number($('speed').value));if(now-this.lastUi>300){this.updateUi();this.lastUi=now}this.world.render()}catch(e){console.error(e);this.running=false;$('error').style.display='block';$('error').textContent='Simulation error: '+e.message}}
}
try{window.planetLabApp=new CityApp();window.dispatchEvent(new Event('planetlab:app-ready'))}catch(e){console.error(e);$('error').style.display='block';$('error').textContent='Unable to start Three.js: '+e.message+'\nServe the directory over HTTP and ensure Three.js CDN access.';$('status').textContent='ERROR'}
