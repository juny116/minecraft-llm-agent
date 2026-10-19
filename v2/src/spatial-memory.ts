import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';import {dirname,join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import type {SeenBlock,Position} from './vision.js';import {key} from './vision.js';import type {Snapshot} from './types.js';
type Region={places:SeenBlock[];containers:NonNullable<Snapshot['containers']>};
type Index={schema:2;profile:string;regions:Record<string,{chunks:string[];containers:Region['containers']}>};
export class SpatialMemory{
 private data:Index;private cache=new Map<string,SeenBlock[]>();private dirtyChunks=new Set<string>();private dirty=false;private lastWrite=0;
 constructor(private file:string,profile:string){
  const raw=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{schema:2,profile,regions:{}};
  if(![1,2].includes(raw.schema)||raw.profile!==profile||!raw.regions||Object.keys(raw.regions).length>8)throw Error('Invalid spatial memory; preserve file');
  this.data={schema:2,profile,regions:{}};
  for(const [dimension,r]of Object.entries(raw.regions)as [string,any][]){
   if(!Array.isArray(r.containers)||r.containers.length>16||r.containers.some((c:any)=>!c.position||!Number.isFinite(c.observedAt)||!Array.isArray(c.items)))throw Error('Invalid spatial memory containers');
   if(raw.schema===1){if(!Array.isArray(r.places))throw Error('Invalid spatial memory region');this.validate(r.places);this.update(dimension,r.places,r.containers);}
   else{if(!Array.isArray(r.chunks)||r.chunks.some((x:any)=>typeof x!=='string'||!/^[-\d]+,[-\d]+$/.test(x)))throw Error('Invalid spatial chunk index');this.data.regions[dimension]={chunks:r.chunks,containers:r.containers};}
  }
 }
 private validate(xs:SeenBlock[]){if(xs.some(b=>typeof b.name!=='string'||!Number.isFinite(b.lastSeen)||!b.position||![b.position.x,b.position.y,b.position.z].every(Number.isFinite)))throw Error('Invalid spatial memory cells');}
 private cacheKey(d:string,c:string){return JSON.stringify([d,c]);}
 private path(d:string,c:string){return join(this.file+'.chunks',createHash('sha256').update(d).digest('hex').slice(0,16),c+'.json');}
 private read(d:string,c:string){const k=this.cacheKey(d,c);if(!this.cache.has(k)){const p=this.path(d,c);if(!existsSync(p)&&this.data.regions[d]?.chunks.includes(c))throw Error('Missing spatial chunk; preserve index');const xs=existsSync(p)?JSON.parse(readFileSync(p,'utf8')):[];if(!Array.isArray(xs))throw Error('Invalid spatial chunk');this.validate(xs);this.cache.set(k,xs);}return this.cache.get(k)!;}
 get(dimension:string,position?:Position,radius=48):Region{
  const r=this.data.regions[dimension];if(!r)return {places:[],containers:[]};
  const chunks=r.chunks.filter(c=>{if(!position)return true;const [x,z]=c.split(',').map(Number);return x*16<=position.x+radius&&(x+1)*16>=position.x-radius&&z*16<=position.z+radius&&(z+1)*16>=position.z-radius;});
  const places=chunks.flatMap(c=>this.read(dimension,c)).filter(b=>!position||Math.hypot(b.position.x-position.x,b.position.z-position.z)<=radius);
  return structuredClone({places,containers:r.containers});
 }
 update(dimension:string,places:SeenBlock[],containers:Region['containers']){
  if(!dimension)return;if(!this.data.regions[dimension]&&Object.keys(this.data.regions).length>=8)throw Error('Spatial dimension capacity reached; preserve memory');this.validate(places);
  const r=this.data.regions[dimension]??={chunks:[],containers:[]};
  const groups=new Map<string,SeenBlock[]>();for(const b of places){const c=`${Math.floor(b.position.x/16)},${Math.floor(b.position.z/16)}`;if(!groups.has(c))groups.set(c,[]);groups.get(c)!.push(b);}
  for(const [c,xs]of groups){const m=new Map(this.read(dimension,c).map(b=>[key(b.position),b]));for(const b of xs)if(!m.has(key(b.position))||m.get(key(b.position))!.lastSeen<=b.lastSeen)m.set(key(b.position),structuredClone(b));const k=this.cacheKey(dimension,c);this.cache.set(k,[...m.values()]);this.dirtyChunks.add(k);if(!r.chunks.includes(c))r.chunks.push(c);}
  r.containers=structuredClone(containers.slice(-16));this.dirty=true;
 }
 flush(force=false){
  if(!this.dirty||!force&&Date.now()-this.lastWrite<5000)return;
  const atomic=(p:string,data:any)=>{mkdirSync(dirname(p),{recursive:true,mode:0o700});const tmp=p+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(data),{mode:0o600});renameSync(tmp,p);};
  for(const k of this.dirtyChunks){const [d,c]=JSON.parse(k);atomic(this.path(d,c),this.cache.get(k));}atomic(this.file,this.data);this.dirtyChunks.clear();this.lastWrite=Date.now();this.dirty=false;
  // Disk chunks persist; cache eviction never deletes remembered terrain.
  while(this.cache.size>64)this.cache.delete(this.cache.keys().next().value!);
 }
}
