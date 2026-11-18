import type {Snapshot,Plan} from './types.js';
// All LLM-curated map entries, including archived/changed entries. No top-k filtering.
export function rememberedPlaces(s:Snapshot,_p?:Plan){return structuredClone(s.importantPlaces??[]);}
