export type Position = { x: number; y: number; z: number };
export type SeenBlock = { name: string; position: Position; lastSeen: number };
export const VISION = { range: 16, horizontalDegrees: 90, verticalDegrees: 60, columns: 25, rows: 17 };
export function viewDirection(yaw: number, pitch: number): Position {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}
export function sampleView(yaw: number, pitch: number, cast: (direction: Position) => {name: string; position: Position} | null, now: number): SeenBlock[] {
  const seen = new Map<string, SeenBlock>();
  for (let y = 0; y < VISION.rows; y++) for (let x = 0; x < VISION.columns; x++) {
    const h = Math.tan(VISION.horizontalDegrees * Math.PI / 360) * (2*x/(VISION.columns-1)-1);
    const v = Math.tan(VISION.verticalDegrees * Math.PI / 360) * (1-2*y/(VISION.rows-1));
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
    while(this.blocks.size>1024) this.blocks.delete(this.blocks.keys().next().value!);
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
export function visibleBlockFace(eye:Position,yaw:number,pitch:number,p:Position,cast:(direction:Position,length:number)=>Position|null){
 const forward=viewDirection(yaw,pitch);
 for(const [x,y,z] of [[.5,.5,.5],[.5,.999,.5],[.5,.001,.5],[.001,.5,.5],[.999,.5,.5],[.5,.5,.001],[.5,.5,.999]]){
  const point={x:p.x+x,y:p.y+y,z:p.z+z},dx=point.x-eye.x,dy=point.y-eye.y,dz=point.z-eye.z,length=Math.hypot(dx,dy,dz);
  if(!length||length>VISION.range)continue;
  const d={x:dx/length,y:dy/length,z:dz/length};
  if(d.x*forward.x+d.y*forward.y+d.z*forward.z<Math.cos(Math.PI/6))continue;
  const hit=cast(d,length+.01);if(hit&&key(hit)===key(p))return point;
 }
 return null;
}
