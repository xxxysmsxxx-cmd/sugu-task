const $ = (s) => document.querySelector(s);
const state = { tasks: [], filter: 'inbox', demo: new URLSearchParams(location.search).has('demo'), user: null };
const labels = { inbox: '未着手', doing: '進行中', done: '完了' };
const order = ['inbox', 'doing', 'done'];
let toastTimer;

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function demoStore() { localStorage.setItem('sugu-demo-tasks', JSON.stringify(state.tasks)); }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '通信に失敗しました');
  return data;
}
function dateText(value) { if (!value) return ''; const d = new Date(value + 'T00:00:00'); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth()+1}/${d.getDate()} 期限`; }
function render() {
  for (const s of order) $(`[data-count="${s}"]`).textContent = state.tasks.filter(t => t.status === s).length;
  const visible = state.tasks.filter(t => t.status === state.filter).sort((a,b) => b.updated_at.localeCompare(a.updated_at));
  $('#countLabel').textContent = `${state.tasks.filter(t => t.status !== 'done').length} 件の未完了`;
  $('#taskList').replaceChildren(...visible.map(taskElement));
  $('#empty').hidden = visible.length > 0;
  $('#emptyText').textContent = `${labels[state.filter]}のタスクはありません`;
  document.querySelectorAll('.tab').forEach(el => { const on = el.dataset.filter === state.filter; el.classList.toggle('active', on); on ? el.setAttribute('aria-current','page') : el.removeAttribute('aria-current'); });
}
function taskElement(task) {
  const article = document.createElement('article'); article.className = `task ${task.status}`; article.dataset.id = task.id;
  const inner = document.createElement('div'); inner.className = 'task-inner';
  const check = document.createElement('button'); check.className = 'task-check'; check.type = 'button'; check.setAttribute('aria-label', task.status === 'done' ? '未着手に戻す' : '完了にする'); check.textContent = '✓'; check.onclick = () => updateStatus(task, task.status === 'done' ? 'inbox' : 'done');
  const body = document.createElement('div'); body.className = 'task-body';
  const title = document.createElement('div'); title.className = 'task-title'; title.textContent = task.title;
  const meta = document.createElement('div'); meta.className = 'task-meta';
  const badge = document.createElement('span'); badge.className = 'task-status'; badge.textContent = labels[task.status]; meta.append(badge);
  if (task.due_date) { const due = document.createElement('span'); due.textContent = dateText(task.due_date); meta.append(due); }
  body.append(title,meta);
  const actions = document.createElement('div'); actions.className = 'task-actions';
  const move = document.createElement('button'); move.className = 'icon-button'; move.type = 'button'; move.setAttribute('aria-label','次の状態に移動'); move.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>'; move.onclick = () => updateStatus(task, order[(order.indexOf(task.status)+1)%3]);
  const del = document.createElement('button'); del.className = 'icon-button'; del.type = 'button'; del.setAttribute('aria-label','タスクを削除'); del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>'; del.onclick = () => removeTask(task);
  actions.append(move,del); inner.append(check,body,actions); article.append(inner); wireSwipe(inner,task); return article;
}
function wireSwipe(el, task) {
  let startX=0,startY=0,delta=0,dragging=false;
  el.addEventListener('pointerdown',e => { if (e.target.closest('button')) return; startX=e.clientX;startY=e.clientY;delta=0;dragging=true; });
  el.addEventListener('pointermove',e => { if (!dragging) return; const dx=e.clientX-startX,dy=e.clientY-startY; if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>12){dragging=false;return;} delta=Math.max(-90,Math.min(90,dx)); if(Math.abs(delta)>6) el.style.transform=`translateX(${delta}px)`; });
  const end=()=>{if(!dragging)return;dragging=false;el.style.transform='';if(Math.abs(delta)>55){const current=order.indexOf(task.status);const next=order[Math.max(0,Math.min(2,current+(delta<0?1:-1)))];if(next!==task.status)updateStatus(task,next);}};
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
}
async function addTask(title, due_date=null) {
  const clean=title.trim(); if(!clean)return;
  let task;
  if(state.demo){task={id:crypto.randomUUID(),title:clean,note:'',status:'inbox',due_date,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};state.tasks.unshift(task);demoStore();}
  else {task=await api('/api/tasks',{method:'POST',body:JSON.stringify({title:clean,due_date})});state.tasks.unshift(task);}
  state.filter='inbox';render();toast('追加しました');
}
async function updateStatus(task,status) {
  const previous=task.status; task.status=status;task.updated_at=new Date().toISOString();render();
  try { if(state.demo) demoStore(); else Object.assign(task,await api(`/api/tasks/${encodeURIComponent(task.id)}`,{method:'PATCH',body:JSON.stringify({status})})); toast(`${labels[status]}に移動しました`); }
  catch(e){task.status=previous;render();toast(e.message);}
}
async function removeTask(task) {
  const index=state.tasks.indexOf(task);state.tasks.splice(index,1);render();
  try {if(state.demo)demoStore();else await api(`/api/tasks/${encodeURIComponent(task.id)}`,{method:'DELETE'});toast('削除しました');}
  catch(e){state.tasks.splice(index,0,task);render();toast(e.message);}
}
async function init() {
  const today=new Date();$('#todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'long'}).format(today);
  try {
    if(state.demo){state.user={name:'デモ',email:'demo@example.com'};state.tasks=JSON.parse(localStorage.getItem('sugu-demo-tasks')||'[]');}
    else {const session=await api('/api/session');if(!session.authenticated){$('#skeleton').hidden=true;$('#signin').hidden=false;return;}state.user=session.user;state.tasks=await api('/api/tasks');}
    $('#avatarText').textContent=(state.user.name||state.user.email||'?').slice(0,1).toUpperCase();$('#accountEmail').textContent=state.demo?'デモモード':state.user.email;
    render();$('#skeleton').hidden=true;$('#shell').hidden=false;
    const input=$('#quickInput'); if(location.hash==='#add')input.focus();
  } catch(e){$('#skeleton').hidden=true;$('#signin').hidden=false;toast(e.message);}
}
$('#quickForm').addEventListener('submit',async e=>{e.preventDefault();const input=$('#quickInput');const title=input.value;input.value='';try{await addTask(title);}catch(err){input.value=title;toast(err.message);}});
document.querySelectorAll('.tab').forEach(el=>el.addEventListener('click',()=>{state.filter=el.dataset.filter;render();}));
$('#focusButton').onclick=()=>{window.scrollTo({top:0,behavior:'smooth'});setTimeout(()=>$('#quickInput').focus(),180);};
$('#homeButton').onclick=()=>{state.filter='inbox';render();window.scrollTo({top:0,behavior:'smooth'});};
$('#aiButton').onclick=()=>$('#aiDialog').showModal();$('#aiCancel').onclick=()=>$('#aiDialog').close();
$('#accountButton').onclick=()=>$('#accountDialog').showModal();
$('#aiForm').addEventListener('submit',async e=>{e.preventDefault();const text=$('#aiText').value.trim();if(!text)return;const button=$('#aiSubmit');button.disabled=true;button.textContent='整理中…';try{if(state.demo){toast('AI整理はログイン後に利用できます');return;}const result=await api('/api/ai/parse',{method:'POST',body:JSON.stringify({text})});for(const item of result.tasks)await addTask(item.title,item.due_date||null);$('#aiText').value='';$('#aiDialog').close();toast(`${result.tasks.length}件のタスクを追加しました`);}catch(err){toast(err.message);}finally{button.disabled=false;button.textContent='タスクを作成';}});
init();
