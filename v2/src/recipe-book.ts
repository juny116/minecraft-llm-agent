// Java 1.21.1 unlock_recipes: 0 replaces known recipes, 1 adds, 2 removes.
// recipes2 is the initial highlight list, NOT a second source of knowledge.
export class RecipeBook {
  private known = new Set<string>();
  // Server catalog stays internal; unlock IDs gate every exposed recipe variant.
  private catalog = new Map<string,any>();
  private permissionCache = new Map<string,boolean>();
  declare(packet:{recipes?:any[]}){
    this.catalog.clear();this.permissionCache.clear();this.revision++;
    for(const r of packet.recipes??[])if(typeof r.name==='string'&&['minecraft:crafting_shaped','minecraft:crafting_shapeless'].includes(r.type))this.catalog.set(r.name,r);
  }
  get catalogSize(){return this.catalog.size;}
  permits(recipe:any){
    // Without the server catalog, unlock IDs (item names) remain the only gate; variants cannot be narrowed.
    if(!this.catalog.size)return this.known.size>0;
    const counts=new Map<number,number>();for(const d of recipe.delta??[])if(d.count<0)counts.set(d.id,(counts.get(d.id)??0)-d.count);
    const key=JSON.stringify([recipe.result,!!recipe.requiresTable,[...counts].sort(([a],[b])=>a-b)]),cached=this.permissionCache.get(key);if(cached!==undefined)return cached;
    const allowed=[...this.known].some(id=>{
      const r=this.catalog.get(id),d=r?.data;if(!d||d.result?.itemId!==recipe.result?.id||d.result?.itemCount!==recipe.result?.count)return false;
      const slots:any[]=r.type==='minecraft:crafting_shaped'?d.ingredients?.flat()??[]:d.ingredients??[];
      const needsTable=r.type==='minecraft:crafting_shaped'?d.gridWidth>2||d.gridHeight>2:slots.length>4;
      if(needsTable!==!!recipe.requiresTable)return false;
      const options=slots.map(slots=>[...new Set<number>(slots.filter((s:any)=>s.itemCount>0).map((s:any)=>s.itemId))]).filter(x=>x.length).sort((a,b)=>a.length-b.length);
      if(options.length!==[...counts.values()].reduce((a,b)=>a+b,0))return false;
      const left=new Map(counts);
      const match=(i:number):boolean=>i===options.length||options[i].some(item=>{const n=left.get(item)??0;if(!n)return false;left.set(item,n-1);const ok=match(i+1);left.set(item,n);return ok;});
      return match(0);
    });this.permissionCache.set(key,allowed);return allowed;
  }
  private initialized = false;
  apply(packet: { action: number; recipes1: string[]; recipes2?: string[] }) {
    this.permissionCache.clear();this.view=undefined;this.revision++;
    if (![0, 1, 2].includes(packet.action) || !Array.isArray(packet.recipes1)
      || packet.recipes1.some(id => typeof id !== 'string')) return;
    if (packet.action === 0) { this.known.clear(); this.initialized = true; }
    if (!this.initialized) return; // Never infer a full book from a partial update.
    for (const id of packet.recipes1) {
      if (packet.action === 2) this.known.delete(id); else this.known.add(id);
    }
  }
  reset() { this.catalog.clear();this.permissionCache.clear();this.known.clear(); this.initialized = false;this.view=undefined;this.revision++; }
  // Sorting ~1300 IDs on every call dominated snapshot cost; the view changes only through apply/reset.
  /** Increases whenever unlocked recipes or the catalog change; cache key for derived recipe data. */
  revision=0;
  private view?:{initialized:boolean;unlocked:string[]};
  snapshot() { this.view??={ initialized: this.initialized, unlocked: [...this.known].sort() };return {initialized:this.view.initialized,unlocked:[...this.view.unlocked]}; }
}
