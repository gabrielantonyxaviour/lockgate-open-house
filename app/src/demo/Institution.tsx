import { useState } from 'react';
import { Select, type SelectOption } from '../ui/Select';
import { Button, Heading, Notice, Records, Rows } from './Common';
import { identities } from './fixtures';
import type { DemoGateway, DemoState, WorkspaceAction } from './types';
type Field=WorkspaceAction['fields'][number];
const labels:Record<string,string>={profileId:'TEST profile',routeMask:'Permitted routes',divisible:'Exit policy',originatorAddress:'Originator'};
function optionsFor(field:Field):SelectOption[]|undefined {
 if(field.options)return field.options;
 if(field.key==='profileId')return identities.map(profile=>({value:profile.id,label:`${profile.name} · ${profile.jurisdiction}`}));
 if(field.key==='routeMask')return [{value:'1',label:'Purchase claim rights'},{value:'2',label:'Finance an exit'},{value:'3',label:'Both permitted routes'}];
 if(field.key==='divisible')return [{value:'false',label:'Full exit only'},{value:'true',label:'Partial exits permitted'}];
 if(field.key==='originatorAddress')return [];
 return undefined;
}
const labelFor=(field:Field)=>labels[field.key]||field.label;
const displayValue=(field:Field,value:string)=>optionsFor(field)?.find(option=>option.value===value)?.label||value;
function validField(field:Field,value:string){
 if(!value.trim())return !field.required;
 const options=optionsFor(field);
 return !options||options.some(option=>option.value===value&&!option.disabled);
}
export function Institution({state,gateway,run,busy,refresh}:{state:DemoState;gateway:DemoGateway;run:<T>(task:()=>Promise<T>)=>Promise<T>;busy:boolean;refresh:()=>Promise<void>}) {
 const [action,setAction]=useState<WorkspaceAction>();
 const [fields,setFields]=useState<Record<string,string>>({});
 const [review,setReview]=useState(false);
 const workspace=state.workspace;
 if(!workspace)return <section><Heading title="Your onboarding workspace." copy="Your team coordinates review, agreements and activation."/><Notice>Your wallet has no approved organization workspace. A reviewed invitation is required.</Notice></section>;
 if(action){
  const valid=action.fields.every(field=>validField(field,fields[field.key]||''));
  return <section className="dg-narrow"><Heading title={review?'Review this action.':action.label} copy={action.description} back={()=>{if(review)setReview(false);else setAction(undefined);}}/>
   <form className="dg-panel dg-form" onSubmit={event=>{
    event.preventDefault();if(!valid)return;
    if(!review){setReview(true);return;}
    void run(async()=>{await gateway.workspaceAction(action.id,fields);await refresh();setAction(undefined);setReview(false);}).catch(()=>{});
   }}>
    {review?<Rows items={action.fields.map(field=>[labelFor(field),displayValue(field,fields[field.key]||'')])}/>:action.fields.map(field=>{
     const options=optionsFor(field),label=labelFor(field);
     return <label className="dg-field" key={field.key}>{label}{options?
      <Select label={label} value={fields[field.key]||''} options={options} placeholder={options.length?'Choose an option':'No approved options available'} onValueChange={value=>setFields({...fields,[field.key]:value})} disabled={busy||!options.length}/>:
      <input required={field.required} inputMode={field.type==='amount'?'decimal':'text'} value={fields[field.key]||''} onChange={event=>setFields({...fields,[field.key]:event.target.value})} disabled={busy}/>
     }</label>;
    })}
    <Notice>The authenticated service and contract check your scoped authority before this action can complete.</Notice>
    <Button type="submit" busy={busy} disabled={!valid}>{review?'Confirm in wallet':'Review action'}</Button>
   </form>
  </section>;
 }
 return <section><Heading eyebrow={workspace.organization} title={workspace.title} copy="Your authorized operating scope and current records."/><span className="dg-badge">{workspace.status}</span><div className="dg-columns"><section className="dg-panel"><h2>Readiness & authority</h2><Rows items={workspace.checks.map(c=>[c.label,c.status])}/></section><section className="dg-panel"><h2>Operating records</h2><Rows items={workspace.records.map(r=>[r.label,r.value])}/>{workspace.records.length===0&&<p>No records in this workspace.</p>}</section></div><div className="dg-vehicle-grid">{workspace.actions?.map(a=><article className="dg-panel" key={a.id}><h2>{a.label}</h2><p>{a.description}</p>{a.disabledReason&&<Notice>{a.disabledReason}</Notice>}<div className="dg-actions"><Button disabled={Boolean(a.disabledReason)||busy} onClick={()=>{setAction(a);setFields(Object.fromEntries(a.fields.map(f=>[f.key,f.value||''])));}}>{a.label}</Button></div></article>)}</div><Records receipts={state.receipts} agreements={state.agreements}/></section>;
}
