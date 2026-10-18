/** Restore only visibility evidence omitted from model-facing snapshots.
 * This does not reconstruct hidden/historical indexes or prove route reachability. */
import type {Snapshot} from '../src/types.js';
export function replayValidationState(s:Snapshot):Snapshot{
 return {...s,observedDestinationKeys:[...new Set([...(s.observedDestinationKeys??[]),...(s.vision?.blocks??[]).map(b=>[b.position.x,b.position.y,b.position.z].join(','))])]};
}
