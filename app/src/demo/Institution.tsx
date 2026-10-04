import { useState } from 'react';
import { Check, ChevronRight, FilePlus2, LoaderCircle, ShieldCheck, Wallet } from 'lucide-react';
import { Select, type SelectOption } from '../ui/Select';
import { ChainReference } from './ChainReference';
import { Button, Heading, money, Notice, Records, Rows } from './Common';
import { identities } from './fixtures';
import type { DemoGateway, DemoState, InstitutionProgress, Receipt, WorkspaceAction } from './types';
import './institution.css';
type Field=WorkspaceAction['fields'][number];
type Step={label:string;status:'waiting'|'pending'|'confirmed';hash?:Receipt['hash']};
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
 if(options)return options.some(option=>option.value===value&&!option.disabled);
 return field.type!=='amount'||/^\d+(?:\.\d{1,6})?$/.test(value);
}
const stepLabels=(action:WorkspaceAction)=>action.kind==='repay'?['Approve USDG','Repay obligation']:action.kind==='mandate'?['Set mandate','Set exposure cap']:action.kind==='register'?['Register holding']:['Process withdrawal queue'];
const actionIcon=(action:WorkspaceAction)=>action.kind==='register'?<FilePlus2 size={21}/>:action.kind==='mandate'?<ShieldCheck size={21}/>:<Wallet size={21}/>;
export function Institution({state,gateway,run,busy,refresh}:{state:DemoState;gateway:DemoGateway;run:<T>(task:()=>Promise<T>)=>Promise<T>;busy:boolean;refresh:()=>Promise<void>}) {
 const [tab,setTab]=useState<'overview'|'actions'|'transactions'>('overview');
 const [action,setAction]=useState<WorkspaceAction>();
 const [fields,setFields]=useState<Record<string,string>>({});
 const [review,setReview]=useState(false);
 const [progress,setProgress]=useState<InstitutionProgress>();
 const [steps,setSteps]=useState<Step[]>([]);
 const [authorized,setAuthorized]=useState(false);
 const [started,setStarted]=useState(false);
 const [error,setError]=useState('');
 const [receipt,setReceipt]=useState<Receipt>();
 const [refreshError,setRefreshError]=useState(false);
 const workspace=state.workspace;
 if(!workspace)return <section><Heading title="Your institution account." copy="Our team coordinates review, agreements and activation."/><Notice>Your wallet has no approved organization account. Submit an enquiry to discuss access.</Notice></section>;
 const delegated=Boolean(workspace.authorization);
 const openAction=(next:WorkspaceAction,inputs?:Record<string,string>,alreadyAuthorized=false)=>{
  setAction(next);setFields(inputs||Object.fromEntries(next.fields.map(field=>[field.key,field.value||''])));setReview(Boolean(inputs));
  setProgress(undefined);setSteps(stepLabels(next).map(label=>({label,status:'waiting'})));setAuthorized(alreadyAuthorized);setStarted(Boolean(inputs));setReceipt(undefined);setError('');setRefreshError(false);
 };
 const onProgress=(next:InstitutionProgress)=>{
  setProgress(next);
  if(['authorized','submitted','confirmed'].includes(next.phase))setAuthorized(true);
  if(next.stepIndex!==undefined&&['submitted','confirmed'].includes(next.phase)){
   setSteps(current=>{
    const result=[...current];
    for(let index=result.length;index<(next.totalSteps||next.stepIndex!+1);index++)result.push({label:`Transaction ${index+1}`,status:'waiting'});
    result[next.stepIndex!]={label:next.label||result[next.stepIndex!]?.label||`Transaction ${next.stepIndex!+1}`,status:next.phase==='confirmed'?'confirmed':'pending',hash:next.hash||result[next.stepIndex!]?.hash};return result;
   });
  }
  if(next.phase==='error')setError(next.message||'This action could not complete. Confirmed steps are retained below.');
 };
 const submit=()=>{
  if(!action)return;
  setStarted(true);setError('');setRefreshError(false);
  void run(async()=>{
   try{
    const result=await gateway.workspaceAction(action.id,fields,onProgress);setReceipt(result);
    try{await refresh();}catch{setRefreshError(true);}
   }catch(cause){setError(cause instanceof Error?cause.message:'This action could not complete. Your confirmed steps remain recorded.');}
  }).catch(()=>{});
 };
 const changeTab=(next:typeof tab)=>{setTab(next);setAction(undefined);setReceipt(undefined);};
 const nav=<nav className="dg-institution-tabs" aria-label="Institution pages">{(['overview','actions','transactions'] as const).map(item=><button key={item} disabled={busy} aria-current={tab===item?'page':undefined} onClick={()=>changeTab(item)}>{item==='overview'?'Overview':item==='actions'?'Actions':'Transaction history'}</button>)}</nav>;
 if(action){
  const valid=action.fields.every(field=>validField(field,fields[field.key]||''));
  const complete=receipt?.status==='confirmed';
  const execution=progress?.executionAccount||workspace.authorization?.executionWallet;
  const authorizationPending=progress?.phase==='authorization-requested';
  const waitingText=progress?.phase==='preparing'?'Preparing the exact action…':authorizationPending?'Sign this action in your wallet':progress?.phase==='authorized'?'Authorization received. Preparing transaction…':progress?.phase==='submitted'?`Waiting for ${progress.label||'transaction'} confirmation…`:progress?.phase==='confirmed'?'Transaction confirmed. Updating records…':'Processing your action…';
  return <section className="dg-institution"><Heading eyebrow={workspace.organization} title={receipt?'Action recorded.':review?'Review this action.':action.label} copy={action.description} back={busy?undefined:()=>{if(review&&!started)setReview(false);else{setAction(undefined);setReceipt(undefined);}}}/>
   <div className="dg-institution-action-layout"><form className="dg-panel dg-form" onSubmit={event=>{event.preventDefault();if(!valid)return;if(!review){setReview(true);return;}submit();}}>
    <span className="dg-institution-icon">{actionIcon(action)}</span><h2>{action.label}</h2>
    {review?<Rows items={action.fields.map(field=>[labelFor(field),displayValue(field,fields[field.key]||'')])}/>:action.fields.map(field=>{
     const options=optionsFor(field),label=labelFor(field);
     return <label className="dg-field" key={field.key}>{label}{options?
      <Select label={label} value={fields[field.key]||''} options={options} placeholder={options.length?'Choose an option':'No approved options available'} onValueChange={value=>setFields({...fields,[field.key]:value})} disabled={busy||!options.length}/>:
      <input required={field.required} inputMode={field.type==='amount'?'decimal':'text'} value={fields[field.key]||''} onChange={event=>setFields({...fields,[field.key]:event.target.value})} disabled={busy}/>
     }</label>;
    })}
    {review&&<p className="dg-caption">{delegated?'You authorize these exact details with your connected wallet. The institution’s execution wallet submits the transactions.':'Your authorized wallet submits these transactions to Arbitrum Sepolia.'}</p>}
    {!receipt&&<Button type="submit" busy={busy} disabled={!valid}>{!review?'Review action':busy?authorizationPending?'Waiting for authorization…':'Action in progress…':error?'Retry same action':authorized&&started?'Resume action':delegated?'Authorize action':'Confirm in wallet'}</Button>}
    {receipt&&<div className="dg-institution-result" role="status"><strong>{complete?'Action confirmed':receipt.status==='reverted'?'Transaction reverted':'Confirmation pending'}</strong><p>{receipt.title}</p>{receipt.hash&&<ChainReference value={receipt.hash} transaction/>}</div>}
    {error&&<Notice error><strong>Action needs attention</strong><p>{error}</p><p>Confirmed transactions stay recorded. Retry this same action to continue; do not create a duplicate.</p></Notice>}
    {refreshError&&<Notice>The transaction is recorded, but your account could not refresh. Use Refresh account to load the latest records.</Notice>}
    {receipt&&<div className="dg-actions"><Button onClick={()=>{setAction(undefined);setTab('overview');}}>Back to overview</Button><Button secondary onClick={()=>changeTab('transactions')}>View transactions</Button></div>}
   </form><aside className="dg-panel dg-institution-progress" aria-label="Action progress"><h2>{delegated?'One authorization. Clear execution.':'Transaction progress'}</h2><p>{delegated?`Your wallet signs once. ${steps.length===1?'One transaction records':`${steps.length} transactions record`} the action on Arbitrum Sepolia.`:'Confirm each requested transaction in your wallet.'}</p>
    {delegated&&<div className="dg-institution-step"><span className={authorized?'done':authorizationPending?'active':''}>{authorized?<Check size={16}/>:authorizationPending?<LoaderCircle size={16} className="dg-spin"/>:'1'}</span><div><strong>Wallet authorization</strong><small>{authorized?'Authorization confirmed':authorizationPending?'Awaiting your signature':'Required before execution'}</small></div></div>}
    {steps.map((step,index)=><div className="dg-institution-step" key={index}><span className={step.status==='confirmed'?'done':step.status==='pending'?'active':''}>{step.status==='confirmed'?<Check size={16}/>:step.status==='pending'?<LoaderCircle size={16} className="dg-spin"/>:String(index+(delegated?2:1))}</span><div><strong>{step.label}</strong><small>{step.status==='confirmed'?'Confirmed':step.status==='pending'?(step.hash?'Submitted · awaiting confirmation':'Submitting transaction'):'Waiting'}</small>{step.hash&&<ChainReference value={step.hash} transaction/>}</div></div>)}
    {busy&&<p className="dg-institution-live" role="status">{waitingText}</p>}
    {execution&&<div className="dg-institution-execution"><span>Institution execution wallet</span><ChainReference value={execution}/></div>}
   </aside></div>
  </section>;
 }
 const records=workspace.records;
 const mandates=records.filter(record=>record.id.startsWith('mandate-'));
 const metrics=records.filter(record=>['nav','cash','principal'].includes(record.id));
 const operating=records.filter(record=>!record.id.startsWith('mandate-')&&!['nav','cash','principal'].includes(record.id));
 return <section className="dg-institution"><Heading eyebrow={workspace.organization} title={workspace.title} copy="Manage your approved institutional account."/><div className="dg-institution-status"><span className="dg-badge">{workspace.status}</span>{delegated&&<span>Authorized team representative</span>}</div>{nav}
  {tab==='overview'&&Boolean(workspace.pendingActions?.length)&&<Notice><strong>An institution action is unfinished.</strong><p>Resume its saved transaction plan before starting a new action.</p><Button secondary disabled={busy} onClick={()=>setTab('actions')}>Review unfinished actions</Button></Notice>}
  {tab==='transactions'?<Records receipts={state.receipts}/>:tab==='actions'?<><Heading title="Institution actions" copy="Review every action before authorizing it."/>{workspace.pendingActions?.map(pending=>{const found=workspace.actions?.find(item=>item.id===pending.actionId);return found&&<div className="dg-panel dg-institution-pending" key={pending.id}><div><h2>Continue {found.label.toLowerCase()}</h2><p>This saved action has not completed. Resume its existing transaction plan.</p></div><Button disabled={busy} onClick={()=>openAction(found,pending.inputs,pending.authorized)}>Resume action</Button></div>;})}<div className="dg-institution-actions">{workspace.actions?.map(item=><article className="dg-panel" key={item.id}><span className="dg-institution-icon">{actionIcon(item)}</span><h2>{item.label}</h2><p>{item.description}</p>{item.disabledReason&&<p className="dg-caption">{item.disabledReason}</p>}<Button disabled={Boolean(item.disabledReason)||busy} onClick={()=>openAction(item)}>{item.label}<ChevronRight size={15}/></Button></article>)}</div></>:<>
   {metrics.length>0&&<div className="dg-institution-metrics">{metrics.map(item=><article className="dg-panel" key={item.id}><span>{item.label}</span><strong>{money(item.value.replace(/test USDG/i,'').trim())}</strong><small>TEST USDG</small></article>)}</div>}
   <div className="dg-institution-overview"><section className="dg-panel"><h2>Operating records</h2>{operating.length?<Rows items={operating.map(item=>[item.label,item.value])}/>:<p>No holdings or obligations have been recorded yet.</p>}<div className="dg-actions"><Button secondary onClick={()=>setTab('actions')}>Manage actions<ChevronRight size={15}/></Button></div></section><section className="dg-panel"><h2>Readiness & authority</h2><Rows items={workspace.checks.map(check=>[check.label,check.status])}/>{workspace.authorization&&<details className="dg-institution-authority"><summary>Wallet authority</summary><p>Connected representative</p><ChainReference value={workspace.authorization.representativeWallet}/><p>Institution execution wallet</p><ChainReference value={workspace.authorization.executionWallet}/><p className="dg-caption">Your signed authorization permits the exact reviewed operation. Confirmed transactions identify the execution wallet on the explorer.</p></details>}</section></div>
   {mandates.length>0&&<section className="dg-panel dg-institution-mandates"><h2>Originator mandates</h2><Rows items={mandates.map(item=>[item.label,item.value])}/></section>}
   <div className="dg-institution-quick">{workspace.actions?.map(item=><Button key={item.id} secondary disabled={Boolean(item.disabledReason)||busy} onClick={()=>openAction(item)}>{item.label}</Button>)}</div>
  </>}
 </section>;
}
