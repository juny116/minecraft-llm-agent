import {parseThreatResponse} from './threat-response.js';

import {parseProcedure} from './procedure.js';
import {actions,type Plan,type Snapshot,type WorkIntent} from './types.js';
export function intentSatisfied(intent:WorkIntent|undefined,s:Snapshot){
 return !!intent?.desiredInventory.length&&intent.desiredInventory.every(target=>(s.inventory??[]).filter(i=>i.name===target.item).reduce((n,i)=>n+i.count,0)>=target.count);
}
export function parseIntent(raw:any,parseProposal:(raw:unknown)=>Plan,allowProcedure=false):Plan{
 // Lossless compatibility for an unambiguous field-placement mistake.
 if(raw?.constraints!==undefined){
  if(raw?.intent?.constraints!==undefined)throw Error('Invalid work intent: ambiguous root and intent constraints; return only intent.constraints');
  raw={...raw,intent:{...raw.intent,constraints:raw.constraints}};delete raw.constraints;
 }
 // JSON null and an empty step list are how models write an omitted procedure: CONT4 had 8 procedure:null and
 // 6 threatResponse:null repairs; in CONT5 all three steps:[] repairs failed in both repair passes.
 const omitted=raw?.procedure==null||Array.isArray(raw.procedure.steps)&&!raw.procedure.steps.length;
 if(!omitted&&!allowProcedure)throw Error('Invalid procedure: direct workflow does not execute procedures');
 const procedure=omitted?undefined:parseProcedure(raw.procedure);
 const i=raw?.intent;
 for(const [field,value] of [['goal',raw?.goal],['intent.description',i?.description]] as const){
  if(typeof value==='string'&&value.length>400)throw Error(`Invalid work intent: ${field} length ${value.length} exceeds 400 characters; shorten this field while preserving the intended outcome`);
 }
 if(typeof raw?.goal!=='string'||!raw.goal.trim()||raw.goal.length>400||!i||typeof i.description!=='string'||!i.description.trim()||i.description.length>400
 ||!Array.isArray(i.desiredInventory)||i.desiredInventory.length>8||i.desiredInventory.some((t:any)=>!t||!/^[a-z0-9_]+$/.test(t.item)||!Number.isInteger(t.count)||t.count<1||t.count>2304)
 ||!Array.isArray(i.constraints)||i.constraints.length>6||i.constraints.some((x:any)=>typeof x!=='string'||!x.trim()||x.length>500))throw Error('Invalid work intent: description, desiredInventory [{item,count}], constraints [text]');
 if(raw.steps?.length||raw.mine||raw.destination)throw Error('Invalid intent: JEV chooses mine/move targets, not planner steps');
 if(raw.proposals!==undefined&&(!Array.isArray(raw.proposals)||raw.proposals.length>6))throw Error('Invalid intent proposals');
 const proposals=(raw.proposals??[]).map((p:any)=>{
  if(!actions.includes(p?.preferred))throw Error('Invalid intent proposal action: use craft/equip/place_table/place_block/inspect_container/deposit/withdraw/give; build is a parameter field, not an action');
  if(p?.intent||p?.proposals||p?.steps?.length||['mine','move','idle','look'].includes(p?.preferred))throw Error('Invalid intent proposal: no recursive plan or mine/move targets');
  return parseProposal(p);
 });
 const threatResponse=raw.threatResponse==null?undefined:parseThreatResponse(raw.threatResponse);
 return {...(procedure?{procedure}:{}),...(threatResponse?{threatResponse}:{}),goal:raw.goal,preferred:'look',intent:structuredClone({description:i.description,desiredInventory:i.desiredInventory,constraints:i.constraints}),proposals,steps:[]};
}
