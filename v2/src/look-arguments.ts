import {selectValue,cameraSemantics,type Ask,type Question} from './parameter-supervisor.js';
import type {Snapshot} from './types.js';
export type LookBinding='sequential'|'batched'|'parallel-branches'|'relative-branches';
// Experimental binding only. Runtime defaults are unchanged.
export async function selectLookArguments(s:Snapshot,ask:Ask,mode:LookBinding){
 if(mode==='relative-branches')return selectRelativeLook(s,ask);
 const context={selectedAction:'look',boundArguments:{} as Record<string,unknown>,argumentContract:'coordinated',argumentSemantics:cameraSemantics(s)};
 if(mode==='sequential'){
  const yawDegrees=await selectValue('yawDegrees',Array.from({length:360},(_,i)=>i),ask,context);
  const pitchDegrees=await selectValue('pitchDegrees',Array.from({length:181},(_,i)=>i-90),ask,{...context,boundArguments:{yawDegrees}});
  return {yawDegrees,pitchDegrees};
 }
 const common='Choose one consistent absolute camera orientation for the already selected look action. All three answers apply together: yawDegrees = 45 * yawSector + yawOffset; pitchDegrees is independent absolute elevation. yawSector is 0..7, yawOffset 0..44; every integer yaw 0..359 is available. Pitch is -90..90. These are motor arguments, not truth claims. Use observations, current camera and the same task; no angle is preferred. There is no sequentially bound sector yet: make the sector and offset refer to the SAME intended heading. See argumentSemantics for direction conventions.';
 const q:Record<string,Question>={
  yawSector:{type:'choice',instructions:common,criteria:Object.fromEntries(Array.from({length:8},(_,i)=>['value_'+i,`sector=${i}; absolute yaw ${45*i}..${45*i+44} degrees`]))},
  yawOffset:{type:'choice',instructions:common,criteria:Object.fromEntries(Array.from({length:45},(_,i)=>['value_'+i,`offset=${i} degrees; resulting yaw in sectors 0..7: ${Array.from({length:8},(_,j)=>45*j+i).join(',')}`]))},
  pitchDegrees:{type:'choice',instructions:common,criteria:Object.fromEntries(Array.from({length:181},(_,i)=>['value_'+i,`absolute pitch=${i-90} degrees; delta=${i-90-(context.argumentSemantics.currentCameraDegrees?.pitch??0)} degrees`]))}
 };
 if(mode==='parallel-branches'){
  delete q.yawOffset;
  q.yawSector.instructions='Choose the absolute yaw sector for the intended look. Each yawInSector question independently proposes an exact angle conditional on that sector being chosen. Only the exact angle for YOUR selected sector is applied. Every integer angle remains available; no local correction or preference.';
  q.pitchDegrees.instructions='Choose absolute pitch for the same intended look. Pitch is applied with the exact yaw from YOUR selected sector. Other sector proposals are ignored. See argumentSemantics.';
  for(let sector=0;sector<8;sector++)q['yawInSector'+sector]={type:'choice',instructions:'If yaw sector '+sector+' is selected, which exact absolute yaw in this sector should be used for the current task? This question is a conditional proposal, not a request to change your sector choice. If another sector is selected this answer is ignored. Use current camera, observation and task. All supplied angles are selectable; no value is preferred.',criteria:Object.fromEntries(Array.from({length:45},(_,i)=>{const yaw=45*sector+i,from=context.argumentSemantics.currentCameraDegrees?.yaw??0;return ['value_'+yaw,`absolute yaw=${yaw} degrees; delta=${((yaw-from+540)%360)-180} degrees`];}))};
 }
 const out=await ask(q,{...context,argumentName:'cameraAngles',bindingContract:mode==='parallel-branches'?'conditional exact-yaw proposals; use only the model-selected branch and pitch':'joint sector+offset+pitch; deterministic decoding only'});
 const value=(name:string)=>{const a=out?.[name];if(a?.type!=='choice'||!Object.hasOwn(q[name].criteria,a.choice)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw Error('Invalid batched camera answer');return Number(a.choice.slice(6));};
 const sector=value('yawSector');
 if(mode==='parallel-branches'){for(let i=0;i<8;i++)value('yawInSector'+i);return {yawDegrees:value('yawInSector'+sector),pitchDegrees:value('pitchDegrees')-90};}
 return {yawDegrees:45*sector+value('yawOffset'),pitchDegrees:value('pitchDegrees')-90};
}

// Same 360 integer absolute headings, expressed as turns around the current heading.
// Rounding selects a coordinate origin only; it never selects a motor target.
async function selectRelativeLook(s:Snapshot,ask:Ask){
 const semantics=cameraSemantics(s),camera=semantics.currentCameraDegrees;
 if(!camera)throw Error('Relative look requires observed camera orientation');
 const from=camera.yaw,base=Math.round(from)%360;
 const q:Record<string,Question>={
  turnSector:{type:'choice',instructions:'Choose a camera turn range for the observation needed by the current task. Turns can face unseen directions. Each conditional exactTurn answer is used only if you choose its range. All integer absolute headings remain available.',criteria:{}},
  pitchDegrees:{type:'choice',instructions:'Choose absolute pitch for the same intended observation, -90 down, 0 horizontal, 90 up.',criteria:Object.fromEntries(Array.from({length:181},(_,i)=>['value_'+i,'absolute pitch '+(i-90)+'deg']))}
 };
 for(let k=0;k<8;k++){
  const lo=-180+45*k,hi=lo+44,first=(base+lo+360)%360,last=(base+hi+360)%360;
  q.turnSector.criteria['value_'+k]=`Turn ${lo}..${hi}deg from rounded current yaw ${base}deg; positive is left, negative right. Absolute yaw ${first}..${last}deg${first>last?' wrapping through 359 to 0':''}. ${lo<=0&&hi>=0?'Includes keeping the same heading.':''}`;
  q['exactTurn'+k]={type:'choice',instructions:'Conditional on this turn range being selected, choose the exact turn for the SAME task. Other ranges are ignored; no turn is preferred.',criteria:Object.fromEntries(Array.from({length:45},(_,i)=>{const turn=lo+i,yaw=(base+turn+360)%360;return ['value_'+i,`turn ${turn}deg; absolute yaw ${yaw}deg; actual delta ${((yaw-from+540)%360)-180}deg`];}))};
 }
 const out=await ask(q,{selectedAction:'look',argumentName:'cameraAngles',boundArguments:{},argumentContract:'coordinated',argumentSemantics:{...semantics,meaning:'Yaw uses rounded current heading as a lattice origin only; actual motor target is the stated integer absolute yaw. No targets are filtered.'},bindingContract:'conditional relative-turn proposals; apply only the model-selected branch and pitch'});
 const value=(name:string)=>{const a=out?.[name];if(a?.type!=='choice'||!Object.hasOwn(q[name].criteria,a.choice)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw Error('Invalid relative camera answer');return Number(a.choice.slice(6));};
 const sector=value('turnSector');for(let k=0;k<8;k++)value('exactTurn'+k);
 return {yawDegrees:(base-180+45*sector+value('exactTurn'+sector)+360)%360,pitchDegrees:value('pitchDegrees')-90};
}
