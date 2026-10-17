export type PickupRequest={entityId:number;expected:string};
export type VisibleItem={id:number;name:string;count:number;position:{x:number;y:number;z:number}};
export type PickupResult={kind:'pickup';target:PickupRequest|null;inventoryGained:{name:string;count:number}[];status:'finished'|'failed'|'cancelled';elapsedMs:number;detail?:string;attribution:'inventory_delta_not_proof_of_target_origin'};
export function validatePickup(p:PickupRequest){if(!p||!Number.isSafeInteger(p.entityId)||p.entityId<0||typeof p.expected!=='string'||!/^[a-z0-9_]+$/.test(p.expected))throw Error('Invalid pickup target');}
export function readPickupResult(text:string):PickupResult|undefined{try{const r=JSON.parse(text);return r.kind==='pickup'&&Array.isArray(r.inventoryGained)?r:undefined;}catch{return undefined;}}
