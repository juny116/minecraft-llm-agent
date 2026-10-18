// A minified JSON string preserves all field names and values without provider-side
// pretty-print expansion. It is not a summary or a relevance filter.
export function encodeJevState(state:any):string{return JSON.stringify(state);}
export function decodeJevState(state:any){if(typeof state==='string'){try{return JSON.parse(state);}catch{return state;}}return state;}

export function jevStateForRequest(state:any,questions:unknown){
 // Preserve native structure for small requests. Large requests use the exact
 // same JSON values as minified text, avoiding server serialization expansion.
 return Buffer.byteLength(JSON.stringify({state,questions}))>28000?encodeJevState(state):state;
}
