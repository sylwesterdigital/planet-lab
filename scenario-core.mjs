/* Pure coordinate/metadata operations for local image-edit scenarios. */
export const HALF=78;
export function patchBounds(a,b){
 if(![a?.x,a?.z,b?.x,b?.z].every(Number.isFinite))throw new Error('Choose two terrain points');
 const rect={xMin:Math.max(-HALF,Math.min(a.x,b.x)),xMax:Math.min(HALF,Math.max(a.x,b.x)),
             zMin:Math.max(-HALF,Math.min(a.z,b.z)),zMax:Math.min(HALF,Math.max(a.z,b.z))};
 if(rect.xMax-rect.xMin<3||rect.zMax-rect.zMin<3)throw new Error('Select a patch at least 30 × 30 metres');
 return rect;
}
export function rasterRect(rect,width,height){
 const x=Math.max(0,(rect.xMin+HALF)/(2*HALF))*width;
 const right=Math.min(1,(rect.xMax+HALF)/(2*HALF))*width;
 const y=Math.max(0,(HALF-rect.zMax)/(2*HALF))*height;
 const bottom=Math.min(1,(HALF-rect.zMin)/(2*HALF))*height;
 if(right-x<1||bottom-y<1)throw new Error('Selected area is too small in imagery');
 return {x,y,width:right-x,height:bottom-y};
}
export function siteKey(anchor){
 if(!anchor||!Number.isFinite(anchor.lat)||!Number.isFinite(anchor.lon))return null;
 return `${anchor.lat.toFixed(5)}:${anchor.lon.toFixed(5)}`;
}
export function validLayer(data){
 const b=data?.bounds;
 return !!data&&typeof data.id==='string'&&/^[a-z0-9-]{8,80}$/i.test(data.id)&&typeof data.site==='string'&&
  !!b&&[b.xMin,b.xMax,b.zMin,b.zMax].every(Number.isFinite)&&b.xMin>=-78&&b.xMax<=78&&b.zMin>=-78&&b.zMax<=78&&
  b.xMax>b.xMin&&b.zMax>b.zMin&&typeof data.prompt==='string'&&data.prompt.length<=1500&&
  ['meta','xai','openai'].includes(data.provider);
}
