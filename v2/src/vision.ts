export type Position = { x: number; y: number; z: number };
export type SeenBlock = { name: string; position: Position; lastSeen: number };
export const VISION = { range: 16, horizontalDegrees: 90, verticalDegrees: 60, columns: 25, rows: 17 };
export function viewDirection(yaw: number, pitch: number): Position {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}
export function sampleView(yaw: number, pitch: number, cast: (direction: Position) => {name: string; position: Position} | null, now: number, wide=false): SeenBlock[] {
  const seen = new Map<string, SeenBlock>();
  for (let y = 0; y < VISION.rows; y++) for (let x = 0; x < VISION.columns; x++) {
    const h = Math.tan(VISION.horizontalDegrees * Math.PI / 360) * (2*x/(VISION.columns-1)-1);
    const v = Math.tan((wide?90:VISION.verticalDegrees) * Math.PI / 360) * (1-2*y/(VISION.rows-1));
    const forward = viewDirection(yaw, pitch), right = {x: Math.cos(yaw), y: 0, z: -Math.sin(yaw)};
    const up = {x: Math.sin(yaw)*Math.sin(pitch), y: Math.cos(pitch), z: Math.cos(yaw)*Math.sin(pitch)};
    const d = {x: forward.x+h*right.x+v*up.x, y: forward.y+v*up.y, z: forward.z+h*right.z+v*up.z};
    const length = Math.hypot(d.x,d.y,d.z);
    const hit = cast({x:d.x/length,y:d.y/length,z:d.z/length});
    if(hit) seen.set(key(hit.position), {...hit, position:{...hit.position}, lastSeen:now});
  }
  return [...seen.values()];
}
export function key(p: Position) { return `${p.x},${p.y},${p.z}`; }
export class PlaceMemory {
  private blocks = new Map<string, SeenBlock>();
  observe(blocks: SeenBlock[]) {
    for (const b of blocks) { this.blocks.delete(key(b.position)); this.blocks.set(key(b.position), structuredClone(b)); }
    while(this.blocks.size>8192) this.blocks.delete(this.blocks.keys().next().value!);
  }
  snapshot() { return structuredClone([...this.blocks.values()]); }
  hasSupport(p: Position) { const b=this.blocks.get(key({x:p.x,y:p.y-1,z:p.z}));return !!b&&!['air','cave_air','void_air','water','lava'].includes(b.name); }
  clear() { this.blocks.clear(); }
}
// Bounded prompt view; retain landmarks before common terrain, then recent cells.
export function summarizePlaces(blocks: SeenBlock[], limit = 128): SeenBlock[] {
  const terrain = new Set(['grass_block','dirt','stone','bedrock','sand','water']);
  return [...blocks].sort((a,b)=>Number(terrain.has(a.name))-Number(terrain.has(b.name)) || b.lastSeen-a.lastSeen).slice(0,limit);
}

// A visible top/side face remains interactable even when the center ray enters
// an adjacent solid block first. Each candidate still needs FOV and first-hit proof.
export function visibleBlockFace(eye:Position,yaw:number,pitch:number,p:Position,cast:(direction:Position,length:number)=>Position|null,omnidirectional=false){
 const forward=viewDirection(yaw,pitch);
 for(const [x,y,z] of [[.5,.5,.5],[.5,.999,.5],[.5,.001,.5],[.001,.5,.5],[.999,.5,.5],[.5,.5,.001],[.5,.5,.999]]){
  const point={x:p.x+x,y:p.y+y,z:p.z+z},dx=point.x-eye.x,dy=point.y-eye.y,dz=point.z-eye.z,length=Math.hypot(dx,dy,dz);
  if(!length||length>(omnidirectional?48:VISION.range))continue;
  const d={x:dx/length,y:dy/length,z:dz/length};
  if(!omnidirectional&&d.x*forward.x+d.y*forward.y+d.z*forward.z<Math.cos(Math.PI/6))continue;
  const hit=cast(d,length+.01);if(hit&&key(hit)===key(p))return point;
 }
 return null;
}

// Automatic local sensing abstracts head turns, never body movement or x-ray.
export function sampleSurroundings(cast:(direction:Position)=>{name:string;position:Position}|null,now:number):SeenBlock[]{
 const blocks=new Map<string,SeenBlock>();
 for(const [yaw,pitch]of [[0,0],[Math.PI/2,0],[Math.PI,0],[3*Math.PI/2,0],[0,Math.PI/2],[0,-Math.PI/2]])for(const b of sampleView(yaw,pitch,cast,now,true))blocks.set(key(b.position),b);
 return [...blocks.values()];
}

export const NEAR_DETAIL_RADIUS=12;
// Inspect possible target geometry locally, but release a block's identity only
// after a first-hit ray proves an exposed face. Unknown chunks are never air.
export function sampleNearSurfaces(eye:Position,read:(p:Position)=>{name:string;boundingBox?:string}|null,cast:(d:Position,length:number)=>Position|null,now:number,previous:SeenBlock[]=[],radius=NEAR_DETAIL_RADIUS):SeenBlock[]{
 const seen=new Map<string,SeenBlock>(),old=new Set(previous.map(b=>key(b.position))),cache=new Map<string,ReturnType<typeof read>>();
 const at=(p:Position)=>{const k=key(p);if(!cache.has(k))cache.set(k,read(p));return cache.get(k)!;};
 const air=(b:ReturnType<typeof read>)=>!!b&&['air','cave_air','void_air'].includes(b.name);
 for(let y=Math.floor(eye.y-radius);y<=Math.floor(eye.y+radius);y++)for(let z=Math.floor(eye.z-radius);z<=Math.floor(eye.z+radius);z++)for(let x=Math.floor(eye.x-radius);x<=Math.floor(eye.x+radius);x++){
  const p={x,y,z},dx=x+.5-eye.x,dy=y+.5-eye.y,dz=z+.5-eye.z,len=Math.hypot(dx,dy,dz);if(len>radius)continue;
  const b=at(p);if(!b)continue;
  if(air(b)){
   // Reobserve a removed remembered block; do not report the whole air volume.
   if(old.has(key(p))&&len>0&&!cast({x:dx/len,y:dy/len,z:dz/len},len))seen.set(key(p),{name:b.name,position:p,lastSeen:now});
   continue;
  }
  for(const [a,c,d] of [[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){
   const target={x:x+.5+a*.499,y:y+.5+c*.499,z:z+.5+d*.499};
   if(a*(eye.x-target.x)+c*(eye.y-target.y)+d*(eye.z-target.z)<=0)continue;
   const n=at({x:x+a,y:y+c,z:z+d});if(!n||!(air(n)||n.boundingBox==='empty'))continue;
   const dx=target.x-eye.x,dy=target.y-eye.y,dz=target.z-eye.z,len=Math.hypot(dx,dy,dz);
   const hit=cast({x:dx/len,y:dy/len,z:dz/len},len+.01);
   if(hit&&key(hit)===key(p)){seen.set(key(p),{name:b.name,position:p,lastSeen:now});break;}
  }
 }
 return [...seen.values()];
}
