import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {VRButton} from 'three/addons/webxr/VRButton.js';
import {STAGES, TYPES, LEVELS, TEAM_ROLES, hash, mulberry32, planetElevation, terrainHeight, chooseSite, atLand, citySpec, generateCity} from './planner.mjs?v=0.4.3';
const $=id=>document.getElementById(id);
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
const colors={sea:'#24526e',earth:'#7f8f68',stone:'#a6a39b',path:'#b9a48d'};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const MATERIALS={};
function mat(color,metalness=0,opacity=1){let k=color+'|'+metalness+'|'+opacity;if(!MATERIALS[k])MATERIALS[k]=new THREE.MeshStandardMaterial({color,metalness,roughness:metalness?.49:.87,transparent:opacity!==1,opacity});return MATERIALS[k]}
function box(parent,x,y,z,w,h,d,color,opts={}){const o=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.02,w),Math.max(.02,h),Math.max(.02,d)),mat(color,opts.metalness||0,opts.opacity??1));o.position.set(x,y,z);o.castShadow=opts.shadows!==false;o.receiveShadow=true;parent.add(o);return o}
function cylinder(parent,x,y,z,r1,r2,h,color,sides=8){const o=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,sides),mat(color));o.position.set(x,y,z);o.castShadow=true;parent.add(o);return o}
function triangleRoof(parent,x,y,z,w,depth,color,slope=.38){const roof=new THREE.Group();roof.position.set(x,y,z);parent.add(roof);const rise=w*slope*.5;for(let s of [-1,1]){let slab=box(roof,s*w*.25,rise*.54,0,w*.56,.14,depth+.18,color);slab.rotation.z=-s*Math.atan2(rise,w*.5)}return roof}
function tree(parent,x,y,z,scale=1){cylinder(parent,x,y+.45*scale,z,.08*scale,.1*scale,.9*scale,'#6e6654');const canopy=cylinder(parent,x,y+1.23*scale,z,.05*scale,.75*scale,1.55*scale,'#428b68',7);canopy.rotation.y=.31;}
function clearGroup(g){for(const o of [...g.children]){o.traverse(a=>{if(a.geometry)a.geometry.dispose();if(a.material&&!Object.values(MATERIALS).includes(a.material)){if(Array.isArray(a.material))a.material.forEach(m=>m.dispose());else a.material.dispose()}});g.remove(o)}}
class WorldView{
 constructor(canvas,changeSite,changeAnchor){
  this.canvas=canvas;this.changeSite=changeSite;this.changeAnchor=changeAnchor;this.mode='region';this.config=null;this.site=[0,0];this.plan=null;
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#10212a');
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true});this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));this.renderer.xr.enabled=true;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
  this.camera=new THREE.PerspectiveCamera(44,1,.1,600);this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.minDistance=10;this.controls.maxDistance=220;this.controls.maxPolarAngle=Math.PI*.48;
  this.scene.add(new THREE.HemisphereLight('#bddbff','#3b412f',2.4));let sun=new THREE.DirectionalLight('#ffefd4',3.0);sun.position.set(-48,90,50);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-110;sun.shadow.camera.right=110;sun.shadow.camera.bottom=-110;sun.shadow.camera.top=110;sun.shadow.camera.near=1;sun.shadow.camera.far=250;sun.shadow.bias=-.0006;this.scene.add(sun);
  this.planetGroup=new THREE.Group();this.regionGroup=new THREE.Group();this.buildGroup=new THREE.Group();this.robotsGroup=new THREE.Group();this.markersGroup=new THREE.Group();this.ghostGroup=new THREE.Group();this.scene.add(this.planetGroup,this.regionGroup,this.buildGroup,this.robotsGroup,this.markersGroup,this.ghostGroup);
  this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.terrain=null;this.globe=null;this.selection=null;
  let down=null;canvas.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);canvas.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>6)return;this.click(e)});
  window.addEventListener('resize',()=>this.resize());this.resize();this.setMode('region');
 }
 resize(){const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return;this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix()}
 setMode(mode){this.mode=mode;const region=mode==='region';this.planetGroup.visible=!region;this.regionGroup.visible=region;this.buildGroup.visible=region;this.robotsGroup.visible=region;this.markersGroup.visible=region;this.ghostGroup.visible=region;this.controls.maxPolarAngle=region?Math.PI*.48:Math.PI;this.controls.enablePan=region;this.resetCamera()}
 resetCamera(){if(this.mode==='planet'){this.camera.position.set(0,8,83);this.controls.target.set(0,0,0);this.controls.minDistance=38;this.controls.maxDistance=160}else{this.camera.position.set(57,68,89);this.controls.target.set(0,2,0);this.controls.minDistance=10;this.controls.maxDistance=210}this.controls.update()}
 buildPlanet(seed){clearGroup(this.planetGroup);const globeGeo=new THREE.SphereGeometry(28,120,72),arr=globeGeo.attributes.position,clrs=[];const sea=new THREE.Color('#245476'),coast=new THREE.Color('#b3ba84'),grass=new THREE.Color('#4b9878'),mountain=new THREE.Color('#c2b7a1'),ice=new THREE.Color('#dee6db');
 for(let i=0;i<arr.count;i++){let x=arr.getX(i)/28,y=arr.getY(i)/28,z=arr.getZ(i)/28,n=planetElevation(x,y,z,seed);let c;if(n<0)c=sea.clone().lerp(new THREE.Color('#31779a'),clamp(n+.2,0,.2)*1.9);else if(n<.04)c=coast.clone();else if(n<.17)c=grass.clone();else c=mountain.clone();if(Math.abs(y)>.83)c.lerp(ice,clamp((Math.abs(y)-.83)*6,0,1));clrs.push(c.r,c.g,c.b)}
 globeGeo.setAttribute('color',new THREE.Float32BufferAttribute(clrs,3));this.globe=new THREE.Mesh(globeGeo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));this.planetGroup.add(this.globe);
 let atmosphere=new THREE.Mesh(new THREE.SphereGeometry(28.55,48,32),new THREE.MeshBasicMaterial({color:'#79bfd2',transparent:true,opacity:.07,side:THREE.BackSide}));this.planetGroup.add(atmosphere);
 const random=mulberry32(hash(seed+'stars'));let pts=[];for(let i=0;i<350;i++){const a=random()*Math.PI*2,b=Math.acos(random()*2-1),r=130+random()*60;pts.push(r*Math.sin(b)*Math.cos(a),r*Math.cos(b),r*Math.sin(b)*Math.sin(a))}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));this.planetGroup.add(new THREE.Points(geo,new THREE.PointsMaterial({color:'#a0b9d8',size:.35,sizeAttenuation:true})))
 }
 generateTerrain(config){this.config=config;clearGroup(this.regionGroup);clearGroup(this.buildGroup);clearGroup(this.markersGroup);clearGroup(this.ghostGroup);
  const size=156,sub=104;const geo=new THREE.PlaneGeometry(size,size,sub,sub);geo.rotateX(-Math.PI/2);const p=geo.attributes.position,c=[];const sea=new THREE.Color('#2d6079'),shore=new THREE.Color('#bea981'),plain=new THREE.Color('#739c77'),forest=new THREE.Color('#467d65'),peak=new THREE.Color('#9eaaa3');
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),y=terrainHeight(x,z,config);p.setY(i,y);let col;if(y<=.35)col=sea.clone();else if(y<1.7)col=shore.clone();else if(y<6.5)col=plain.clone().lerp(forest,clamp((y-2)/10,0,.5));else col=forest.clone().lerp(peak,clamp((y-6.5)/16,0,1));c.push(col.r,col.g,col.b)}geo.setAttribute('color',new THREE.Float32BufferAttribute(c,3));geo.computeVertexNormals();
  this.terrain=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));this.terrain.receiveShadow=true;this.regionGroup.add(this.terrain);
  const water=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshStandardMaterial({color:colors.sea,transparent:true,opacity:.77,roughness:.3,metalness:.2,depthWrite:false}));water.rotation.x=-Math.PI/2;water.position.y=.23;this.regionGroup.add(water);
  const rnd=mulberry32(hash(config.seed+'vegetation|'+config.geography));
  for(let n=0;n<235;n++){const x=(rnd()-.5)*146,z=(rnd()-.5)*146,y=terrainHeight(x,z,config);if(y<1.5||y>20||rnd()>.69||Math.hypot(x-this.site[0],z-this.site[1])<27)continue;tree(this.regionGroup,x,y,z,.65+rnd()*.85)}
  this.setSite(this.site);this.drawSelection();
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
 click(e){const b=this.canvas.getBoundingClientRect();this.pointer.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);if(this.mode==='planet'&&this.globe){const hit=this.raycaster.intersectObject(this.globe)[0];if(hit){const p=hit.point.clone().normalize(),lat=Math.asin(p.y)*180/Math.PI,lon=Math.atan2(p.z,p.x)*180/Math.PI;this.changeAnchor({lat:Math.round(lat*10)/10,lon:Math.round(lon*10)/10});return}}if(this.mode==='region'&&this.terrain){const hit=this.raycaster.intersectObject(this.terrain)[0];if(hit){const site=chooseSite([hit.point.x,hit.point.z],this.config);this.changeSite(site);return}}}
 makePart(task){const g=new THREE.Group(),{type,stage,x,z,meta}=task,y=this.height(x,z);g.position.set(x,y,z);const bkind=meta.kind||type,w=meta.width||2.8,d=meta.depth||2.2,h=meta.floors>6?meta.floors*1.25:Math.max(2.6,(meta.floors||1)*2.9);const palette=['#ddc2a7','#bcb9a7','#c3cbd1','#c9a8a2'];
 if(type==='road'||type==='arterial'){const wide=meta.width||2.1;box(g,0,.04,0,meta.axis==='z'?wide:this.plan.cellSize, .09,meta.axis==='z'?this.plan.cellSize:wide,'#536775');if(type==='arterial'){const line=box(g,0,.095,0,meta.axis==='z'?.065:1.55,.012,meta.axis==='z'?1.55:.065,'#e8cf9e');} }
 else if(type==='path'){const m=box(g,0,.09,0,2.4,.08,.6,'#c1ae8f');m.rotation.y=meta.rotation||0}
 else if(type==='rail'){let rail=box(g,0,.15,0,meta.width||3.5,.14,.9,'#786f67');rail.rotation.y=meta.rotation||0;for(let s of [-.26,.26]){const m=box(g,0,.26,s,meta.width||3.5,.08,.08,'#bbcacd');m.rotation.y=meta.rotation||0}}
 else if(type==='survey'){cylinder(g,0,1,0,.12,.22,2,'#a5f5ed');const cone=new THREE.Mesh(new THREE.ConeGeometry(.55,.75,6),mat('#c4e7ee'));cone.position.y=2.25;g.add(cone)}
 else if(type==='grid'){box(g,0,.22,0,2.2,.4,2.2,'#788a94');for(let s of [-.65,.65]){let p=cylinder(g,s,1.9,0,.09,.1,3.4,'#b5aaa2');box(g,s,3.4,0,1.15,.09,.09,'#edcf84')}}
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
 this.buildGroup.add(g);g.userData.task=task;return g;
 }
 render(){this.controls.update();if(this.mode==='planet')this.planetGroup.rotation.y+=.00025;this.renderer.render(this.scene,this.camera)}
}
class Robot{
 constructor(view,index,role,base){this.view=view;this.index=index;this.role=role;this.capabilities=TEAM_ROLES[(index)%TEAM_ROLES.length][3];this.name=`${role}-${String(index+1).padStart(2,'0')}`;this.color=TEAM_ROLES[(index)%TEAM_ROLES.length][2];this.busy=false;this.status='Standby';this.task=null;this.goal=null;this.timer=0;this.phase=0;this.home=base;this.position=[...base];this.state='idle';
 this.group=new THREE.Group();this.view.robotsGroup.add(this.group);
 box(this.group,0,.95,0,.48,.62,.38,this.color);box(this.group,0,1.46,0,.42,.35,.37,'#e4edf1');for(let x of [-.11,.11])box(this.group,x,1.51,.2,.065,.055,.025,'#243c46');this.left=box(this.group,-.14,.31,0,.15,.52,.19,'#6d8791');this.right=box(this.group,.14,.31,0,.15,.52,.19,'#6d8791');box(this.group,-.32,.95,0,.12,.47,.14,'#b4d2cf');box(this.group,.32,.95,0,.12,.47,.14,'#b4d2cf');box(this.group,0,1.12,.21,.25,.14,.05,'#2c4551');
 this.reset();}
 reset(){this.state='idle';this.busy=false;this.task=null;this.status='Standby';this.position=[...this.home];this.place()}
 place(){const [x,z]=this.position;this.group.position.set(x,this.view.height(x,z)+.05,z)}
 assign(task,done){this.task=task;this.done=done;this.busy=true;this.status=`${task.stage}: ${task.type}`;this.goal=[task.x,task.z];this.state='walk'}
 update(dt){this.phase+=dt*8;const walk=this.state==='walk';this.left.rotation.x=walk?Math.sin(this.phase)*.5:0;this.right.rotation.x=walk?-Math.sin(this.phase)*.5:0;
 if(walk){let dx=this.goal[0]-this.position[0],dz=this.goal[1]-this.position[1],dist=Math.hypot(dx,dz),step=Math.min(dist,15*dt);if(dist>.02){this.position[0]+=dx/dist*step;this.position[1]+=dz/dist*step;this.group.rotation.y=Math.atan2(dx,dz)}this.place();if(dist<=step+.02){this.state='work';this.timer=.28+Math.min(1.3,(this.task.meta.floors||1)*.045)}}
 else if(this.state==='work'){this.timer-=dt;this.group.rotation.z=Math.sin(this.phase*2)*.06;if(this.timer<=0){this.group.rotation.z=0;this.state='idle';this.busy=false;this.status='Standby';let completed=this.task;this.task=null;this.done(completed,this)}}
 }
}
class CityApp{
 constructor(){this.events=[];this.time=0;this.last=0;this.lastUi=0;this.running=true;this.plan=null;this.anchor={lat:11.2,lon:-35.4};this.site=[0,0];this.robots=[];this.config=null;this.world=new WorldView($('scene'),site=>this.changeSite(site),anchor=>this.changeAnchor(anchor));this.installEvents();this.generateWorld();this.createPlan();this.loop=this.loop.bind(this);this.world.renderer.setAnimationLoop(this.loop);const xrButton=VRButton.createButton(this.world.renderer);xrButton.style.position='static';xrButton.style.width='100%';xrButton.style.marginTop='8px';xrButton.style.background='#263a45';document.getElementById('xrControls').appendChild(xrButton)}
 log(msg){this.events.unshift({time:this.time,msg});this.events=this.events.slice(0,45)}
 readConfig(){return citySpec({seed:$('seed').value||'ODYSSEY-7',geography:$('geography').value,anchor:this.anchor,profile:$('profile').value,level:$('level').value,budget:$('budget').value,teams:$('teams').value,brief:$('brief').value,site:this.site})}
 generateWorld(){this.running=false;this.config=this.readConfig();this.world.buildPlanet(this.config.seed);this.site=chooseSite([0,0],this.config);this.config.site=this.site;this.world.setSite(this.site);this.world.generateTerrain(this.config);this.world.setMode('region');this.plan=null;this.events=[];this.removeRobots();this.log('Planet terrain generated. Select settlement site or generate a masterplan.');this.updateLocation();this.drawMap();this.updateUi()}
 removeRobots(){for(const a of this.robots){this.world.robotsGroup.remove(a.group);a.group.traverse(o=>o.geometry?.dispose())}this.robots=[]}
 changeAnchor(anchor){this.anchor=anchor;this.generateWorld();this.world.setMode('region');this.updateMode();this.log(`Planet location selected: ${anchor.lat}°, ${anchor.lon}°`);this.updateUi()}
 changeSite(site){this.site=site;this.world.setSite(site);this.updateLocation();this.drawMap();this.log('New site proposed — generate masterplan to update layout.');this.updateUi()}
 updateLocation(){const [x,z]=this.site;$('siteText').textContent=`Site: x ${x.toFixed(1)}, z ${z.toFixed(1)} · Planet ${this.anchor.lat.toFixed(1)}°, ${this.anchor.lon.toFixed(1)}°. Click the terrain to relocate.`;$('locationTag').innerHTML=`<b>${this.world.mode.toUpperCase()}</b> · ${this.config.geography} · ${this.anchor.lat.toFixed(1)}°, ${this.anchor.lon.toFixed(1)}°`}
 createPlan(){this.running=false;this.config=this.readConfig();this.plan=generateCity(this.config);this.world.setPlan(this.plan,$('showPlan').checked);this.world.setVoluntaryZone($('freeZone').checked);this.removeRobots();this.robots=[];
 const baseX=clamp(this.site[0]-25,-70,70),baseZ=clamp(this.site[1]-25,-70,70);for(let i=0;i<this.config.teams;i++){const role=TEAM_ROLES[i][0],start=[baseX+(i%6)*1.8,baseZ+Math.floor(i/6)*2.0];this.robots.push(new Robot(this.world,i,role,start))}
 this.time=0;this.events=[];this._complete=null;this.log(`${this.config.profile} / ${this.config.level} masterplan created: ${this.plan.stats.tasks} tasks.`);this.log(`Funding $${this.plan.stats.estimatedCost.toFixed(2)}M / $${this.config.budget.toFixed(2)}M. ${this.plan.stats.deferred} tasks deferred.`);this.running=true;this.world.setMode('region');this.updateMode();this.drawMap();this.updateUi()}
 installEvents(){
  $('planetMode').onclick=()=>{this.world.setMode('planet');this.updateMode()};$('regionMode').onclick=()=>{this.world.setMode('region');this.updateMode()};
  $('newWorld').onclick=()=>this.generateWorld();$('newSite').onclick=()=>this.changeSite(chooseSite([this.site[0]+12,this.site[1]+11],this.readConfig()));
  $('plan').onclick=()=>this.createPlan();$('restart').onclick=()=>this.createPlan();$('toggle').onclick=()=>{this.running=!this.running;this.updateUi()};$('camera').onclick=()=>this.world.resetCamera();
  $('showPlan').onchange=()=>this.world.setHints($('showPlan').checked);$('freeZone').onchange=()=>{this.world.setVoluntaryZone($('freeZone').checked);this.updateUi()};
  $('export').onclick=()=>{if(!this.plan)return;const data={...this.plan,governance:$('freeZone').checked?'voluntary-free-zone':'unspecified',tasks:this.plan.tasks.map(t=>({...t}))};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='planet-city-'+this.config.seed.replace(/[^a-z0-9_-]/gi,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  $('map').onclick=e=>{const r=e.currentTarget.getBoundingClientRect(),x=((e.clientX-r.left)/r.width-.5)*156,z=((e.clientY-r.top)/r.height-.5)*156;this.changeSite(chooseSite([x,z],this.readConfig()))};
 }
 updateMode(){let p=this.world.mode==='planet';$('planetMode').classList.toggle('active',p);$('regionMode').classList.toggle('active',!p);$('sceneHelp').innerHTML=p?'Drag to orbit · Scroll to zoom<br/>Click globe to explore a new region':'Drag to orbit · Scroll to zoom<br/>Click terrain to propose a settlement site';this.updateLocation()}
 chooseTask(robot){const pending=this.plan.tasks.filter(t=>t.status==='queued');if(!pending.length)return null;const earliest=Math.min(...pending.map(t=>STAGES.findIndex(s=>s[0]===t.stage)));const tasks=pending.filter(t=>STAGES.findIndex(s=>s[0]===t.stage)===earliest);const matched=tasks.filter(t=>robot.capabilities.includes(t.stage));const choices=matched.length?matched:tasks;return choices.reduce((a,b)=>!a||Math.hypot(b.x-robot.position[0],b.z-robot.position[1])<Math.hypot(a.x-robot.position[0],a.z-robot.position[1])?b:a,null)}
 update(dt){if(!this.plan)return;this.time+=dt;
  for(const bot of this.robots)bot.update(dt);
  for(const bot of this.robots){if(bot.busy)continue;const task=this.chooseTask(bot);if(task){task.status='assigned';bot.assign(task,(t,r)=>{t.status='installed';this.world.makePart(t);if(['survey','arterial','power','data','tower','park','airport','stadium'].includes(t.type)&&this.events.length<35||t.type==='airport'){this.log(`${r.name}: installed ${TYPES[t.type]?.[0]||t.type}`)} });}}
  if(this.plan.tasks.every(t=>t.status==='installed')&&this._complete!==this.plan){this._complete=this.plan;this.running=false;this.log('Masterplan construction finished. All funded tasks installed.')}
 }
 updateUi(){const p=this.plan,stats=p?.stats,done=p?.tasks.filter(t=>t.status==='installed').length||0,total=p?.tasks.length||0,perc=total?Math.round(done/total*100):0;
  $('status').textContent=this.world.mode==='planet'?'PLANET OVERVIEW':!p?'WORLD READY':total&&done===total?'SETTLEMENT COMPLETE':this.running?'ROBOT TEAMS ACTIVE':'PAUSED';
  $('homesCount').textContent=stats?.buildings||'0';$('roadCount').textContent=stats?.roads||'0';$('allocated').textContent='$'+(stats?.estimatedCost||0).toFixed(1);$('remaining').textContent='$'+Math.max(0,(stats?.budget||0)-(stats?.estimatedCost||0)).toFixed(1);
  $('planTag').innerHTML=p?`<b>${p.config.level.toUpperCase()}</b> · ${p.config.profile} · ${p.gridSize}×${p.gridSize} plots${$('freeZone').checked?' · voluntary-zone':''}`:'No masterplan';
  $('progressText').textContent=`${done} / ${total} installed · ${perc}%`;$('bar').style.width=perc+'%';$('phaseName').textContent=done===total&&total?'CONSTRUCTION COMPLETE':(p?STAGES.find(s=>p.tasks.some(t=>t.stage===s[0]&&t.status!=='installed'))?.[1]:'Waiting for plan')||'Finishing';
  $('stages').innerHTML=STAGES.map(([stage])=>{const list=p?.tasks.filter(t=>t.stage===stage)||[];return `<span title="${stage}" class="${list.length&&list.every(t=>t.status==='installed')?'done':list.some(t=>t.status==='assigned')?'current':''}"></span>`}).join('');
  $('toggle').textContent=this.running?'Ⅱ Pause teams':'▶ Resume teams';
  $('teamList').innerHTML=this.robots.map(r=>`<div class="team"><div class="dot" style="background:${r.color}">${r.role[0]}</div><div><strong>${r.name}</strong><small>${r.capabilities.join(' / ')}</small></div><span class="team-state">${r.status}</span></div>`).join('');
  const counts={};for(const t of p?.tasks||[]){const stage=t.stage;counts[stage]??={done:0,total:0};counts[stage].total++;if(t.status==='installed')counts[stage].done++}
  $('catalog').innerHTML=STAGES.filter(s=>counts[s[0]]).map(([key,name])=>`<div class="catalog"><span>${name}</span><span>${counts[key].done}/${counts[key].total}</span></div>`).join('');
  $('feed').innerHTML=this.events.slice(0,16).map(e=>`<p><time>${String(Math.floor(e.time/60)).padStart(2,'0')}:${String(Math.floor(e.time%60)).padStart(2,'0')}</time>${e.msg}</p>`).join('');
  $('mapNote').textContent=p?`${stats.protectedLots} plots reserved or unsuitable · ${stats.deferred} jobs deferred by budget · seed ${p.config.seed}`:'Awaiting planned zoning and route network.';
 }
 drawMap(){const canvas=$('map'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);let config=this.readConfig();let sx=w/100,sz=h/68;for(let i=0;i<100;i++)for(let j=0;j<68;j++){let x=(i+.5)/100*156-78,z=(j+.5)/68*156-78,y=terrainHeight(x,z,config);ctx.fillStyle=y<.28?'#28617c':y<1.6?'#b0ad87':y<7?'#547c60':'#8b9d8a';ctx.fillRect(i*sx,j*sz,sx+1,sz+1)}
 if(this.plan){let p=this.plan;for(const g of p.landuse){const px=(g.x+78)/156*w,py=(g.z+78)/156*h,size=p.cellSize/156*w;let col={road:'#6a8294',arterial:'#6a8294',park:'#7fc783',forest:'#3c7850',protected:'#2d6880',unfunded:'#8d6872',unassigned:'#628d70',home:'#d9b394',tower:'#b39cce',data:'#7298d9',factory:'#bf8f67',farm:'#ad9c57',hotel:'#e2bda3',spa:'#88caca',mall:'#cbb2bd',stadium:'#b6c4cc',airport:'#a6b7ce',station:'#88b8bb'}[g.usage]||'#d1b7a5';ctx.fillStyle=col;ctx.fillRect(px-size*.39,py-size*.39,size*.78,size*.78)}}
 ctx.strokeStyle='#d8f7ba';ctx.lineWidth=2;let x=(this.site[0]+78)/156*w,y=(this.site[1]+78)/156*h;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(x-10,y);ctx.lineTo(x+10,y);ctx.moveTo(x,y-10);ctx.lineTo(x,y+10);ctx.stroke();
 }
 loop(now){try{const realDt=Math.min(.05,(now-this.last)/1000||.016);this.last=now;if(this.running&&this.world.mode==='region')this.update(realDt*Number($('speed').value));if(now-this.lastUi>300){this.updateUi();this.lastUi=now}this.world.render()}catch(e){console.error(e);this.running=false;$('error').style.display='block';$('error').textContent='Simulation error: '+e.message}}
}
try{window.planetLabApp=new CityApp()}catch(e){console.error(e);$('error').style.display='block';$('error').textContent='Unable to start Three.js: '+e.message+'\nServe the directory over HTTP and ensure Three.js CDN access.';$('status').textContent='ERROR'}
