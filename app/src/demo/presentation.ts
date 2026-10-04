import type { DemoState } from './types';

/** Display labels only. Signed document bytes and identity commitments stay exact. */
export const displayText = (value: string) => value.replace(/\bTEST\s+/gi, '').replace(/\bTEST$/gi, '').trim();
export function presentationState(state: DemoState): DemoState {
 const record = <T extends {title:string;status?:string}>(item:T):T => ({...item,title:displayText(item.title),...(item.status?{status:displayText(item.status)}:{})});
 return {...state,
  positions:state.positions.map(p=>({...p,name:displayText(p.name),instrument:displayText(p.instrument),restriction:p.restriction?displayText(p.restriction):undefined})),
  vehicles:state.vehicles.map(v=>({...v,name:displayText(v.name),policy:displayText(v.policy),eligibilityStatus:displayText(v.eligibilityStatus),agreement:v.agreement?record(v.agreement):undefined})),
  receipts:state.receipts.map(r=>({...record(r),detail:r.detail?displayText(r.detail):undefined})),
  agreements:state.agreements?.map(record),institutionAgreements:state.institutionAgreements?.map(record),documentDrafts:state.documentDrafts?.map(record),
  setup:{...state.setup,message:state.setup.message?displayText(state.setup.message):undefined,mintDescription:state.setup.mintDescription?displayText(state.setup.mintDescription):undefined},
  workspace:state.workspace?{...state.workspace,status:displayText(state.workspace.status),records:state.workspace.records.map(r=>({...r,label:displayText(r.label),value:displayText(r.value)})),actions:state.workspace.actions?.map(a=>({...a,label:displayText(a.label),description:displayText(a.description),disabledReason:a.disabledReason?displayText(a.disabledReason):undefined,fields:a.fields.map(f=>({...f,label:displayText(f.label),options:f.options?.map(o=>({...o,label:displayText(o.label)}))}))}))}:undefined,
 };
}
