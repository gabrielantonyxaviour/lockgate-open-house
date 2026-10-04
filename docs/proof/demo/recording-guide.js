(() => {
 const key='lockgate.recording.guide.v3';
 let saved={done:{},notes:{},take:0,step:0,mode:'rehearse'};
 try{saved={...saved,...JSON.parse(localStorage.getItem(key)||'{}')}}catch{}
 const takeNav=document.querySelector('#takes'),focus=document.querySelector('#focus'),mode=document.querySelector('#mode');
 let current=Math.min(recordingTakes.length-1,Math.max(0,Number(saved.take)||0)),step=Math.max(0,Number(saved.step)||0);
 mode.value=saved.mode==='record'?'record':'rehearse';
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function persist(){try{localStorage.setItem(key,JSON.stringify({...saved,take:current,step,mode:mode.value}))}catch{}}
 function render(){
  const take=recordingTakes[current];step=Math.min(step,take.steps.length-1);
  const count=recordingTakes.filter(item=>saved.done[item.id]).length;
  document.querySelector('#progress').textContent=`${count} of ${recordingTakes.length} takes recorded`;
  takeNav.innerHTML=recordingTakes.map((item,i)=>`<button data-take="${i}" ${i===current?'aria-current="step"':''}><span class="number">${saved.done[item.id]?'✓':String(i+1).padStart(2,'0')}</span><span class="label">${escape(item.title)}<small>${item.slots.length} footage slot${item.slots.length===1?'':'s'}</small></span></button>`).join('');
  focus.innerHTML=`<span class="eyebrow">Take ${String(current+1).padStart(2,'0')} · ${take.slots.reduce((sum,id)=>sum+(recordingSlots.find(s=>s.id===id)?.seconds||0),0)} seconds selected for edit</span><h2>${escape(take.title)}</h2><p class="actor">${escape(take.actor)}</p><code class="filename">${escape(take.file)}</code><div class="step-track" aria-hidden="true">${take.steps.map((_,i)=>`<span class="${i===step?'current':i<step?'past':''}"></span>`).join('')}</div><div class="step-count">Step ${step+1} of ${take.steps.length}</div><div class="instruction">${take.steps[step]}</div>${take.boundary?`<div class="boundary"><strong>${mode.value==='rehearse'?'Rehearsal: stop before signing or confirming':'Record the complete action and its result'}</strong>${take.boundary}</div>`:''}<div class="controls"><button id="previous" ${current===0&&step===0?'disabled':''}>← Previous</button><button class="next" id="next" ${current===recordingTakes.length-1&&step===take.steps.length-1?'disabled':''}>${step===take.steps.length-1?'Next take':'Next step'} →</button></div><div class="end-shot"><strong>End this take on</strong>${take.end}</div><label class="recorded"><input type="checkbox" id="recorded" ${saved.done[take.id]?'checked':''}>I saved the complete raw take</label><textarea class="notes" aria-label="Take notes" placeholder="Notes: filename, holding/deal reference, actual figures, anything to fix…">${escape(saved.notes[take.id]||'')}</textarea><p class="keyboard">Keyboard: ← previous step · → next step. Your progress is saved on this browser.</p>`;
  focus.querySelector('#previous').onclick=()=>move(-1);focus.querySelector('#next').onclick=()=>move(1);
  focus.querySelector('#recorded').onchange=e=>{saved.done[take.id]=e.target.checked;persist();render()};
  focus.querySelector('.notes').oninput=e=>{saved.notes[take.id]=e.target.value;persist()};persist();
 }
 function move(direction){const take=recordingTakes[current];if(direction>0){if(step<take.steps.length-1)step++;else if(current<recordingTakes.length-1){current++;step=0}}else if(step>0)step--;else if(current>0){current--;step=recordingTakes[current].steps.length-1}render()}
 takeNav.onclick=e=>{const button=e.target.closest('[data-take]');if(!button)return;current=Number(button.dataset.take);step=0;render()};
 document.querySelectorAll('[data-guide-open]').forEach(button=>button.onclick=()=>{current=Number(button.dataset.guideOpen);step=0;render();document.querySelector('#companion').scrollIntoView({block:'start'});});
 mode.onchange=()=>render();
 document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,button,a')||e.altKey||e.ctrlKey||e.metaKey)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?-1:1)}});
 document.querySelector('#slots').innerHTML=recordingSlots.map(slot=>`<tr><td>${escape(slot.id)}</td><td>${slot.seconds} sec</td><td><code>${escape(slot.file)}</code></td></tr>`).join('');
 render();
})();
