import { PRIORITY, STATUS, STATUS_ORDER } from '../core/constants.js';
import { getMember, getProject, getTask, notify, parseMentions, pushHistory, renderMentions } from '../core/selectors.js';
import { S } from '../core/state.js';
import { closeModal, openModal, render, showToast, viewHeader } from '../core/ui.js';
import { taskRow } from './dashboard.js';
import { save } from '../services/cloud.js';
import { escapeAttr, escapeHtml, fmt, todayISO, uid } from '../utils/helpers.js';

export function renderTasks() {
  return `
    ${viewHeader('Tareas', `${S.state.tasks.length} en total`,
      `<div class="flex gap-1 bg-gray-100 rounded-lg p-1">
         <button class="px-3 py-1 rounded-md text-sm ${S.tasksViewMode==='list'?'bg-white shadow-sm':''}" onclick="tasksViewMode='list'; render()">Lista</button>
         <button class="px-3 py-1 rounded-md text-sm ${S.tasksViewMode==='kanban'?'bg-white shadow-sm':''}" onclick="tasksViewMode='kanban'; render()">Tablero</button>
         <button class="px-3 py-1 rounded-md text-sm ${S.tasksViewMode==='gantt'?'bg-white shadow-sm':''}" onclick="tasksViewMode='gantt'; render()">Gantt</button>
       </div>
       <button class="btn-primary" onclick="openTaskModal()">+ Nueva</button>`
    )}

    <div class="px-4 md:px-10 pb-4 flex gap-2">
      <select class="input max-w-xs" onchange="tasksFilter.projectId=this.value; render()">
        <option value="">Todos los proyectos</option>
        ${S.state.projects.map(p => `<option value="${p.id}" ${S.tasksFilter.projectId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
    </div>

    <div class="px-4 md:px-10 pb-10">
      ${S.tasksViewMode === 'kanban' ? renderKanban() : S.tasksViewMode === 'gantt' ? renderGantt() : renderTaskList()}
    </div>
  `;
}

export function filteredTasks() {
  return S.state.tasks.filter(t =>
    (!S.tasksFilter.projectId || t.projectId === S.tasksFilter.projectId) &&
    (!S.tasksFilter.status    || t.status    === S.tasksFilter.status)
  );
}

export function renderKanban() {
  const tasks = filteredTasks();
  return `
    <div class="flex gap-4 overflow-x-auto scroll-hide pb-4">
      ${STATUS_ORDER.map(s => {
        const colTasks = tasks.filter(t => t.status === s);
        return `
          <div class="kanban-col flex-1">
            <div class="flex items-center justify-between mb-3 px-1">
              <div class="flex items-center gap-2">
                <span class="chip ${STATUS[s].color}">${STATUS[s].label}</span>
                <span class="text-xs text-gray-500">${colTasks.length}</span>
              </div>
            </div>
            <div>
              ${colTasks.map(t => kanbanCard(t)).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export function kanbanCard(t) {
  const p = getProject(t.projectId);
  const assignee = getMember(t.assigneeId);
  const isOverdue = t.dueDate && t.dueDate < todayISO() && t.status !== 'COMPLETED';
  return `
    <div class="task-card" onclick="openTaskDetail('${t.id}')">
      <div class="flex items-center justify-between mb-2">
        ${p ? `<span class="text-xs font-medium truncate" style="color:${p?.color || '#6b7280'}">● ${escapeHtml(p.name)}</span>` : '<span></span>'}
        <span class="chip ${PRIORITY[t.priority].color}">${PRIORITY[t.priority].label}</span>
      </div>
      <div class="text-sm font-medium">${escapeHtml(t.title)}</div>
      <div class="flex items-center justify-between mt-2">
        ${t.dueDate ? `<span class="text-xs ${isOverdue?'text-red-600 font-medium':'text-gray-500'}">${isOverdue?'⚠ ':''}${fmt(t.dueDate)}</span>` : '<span></span>'}
        ${assignee ? `<span class="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold" style="background:${assignee.color}" title="${escapeAttr(assignee.name)}">${escapeHtml(assignee.name[0])}</span>` : ''}
      </div>
      ${t.status === 'BLOCKED' && t.blockedReason ? `<div class="text-xs text-red-600 mt-2 italic">${escapeHtml(t.blockedReason)}</div>` : ''}
    </div>
  `;
}

export function renderTaskList() {
  const tasks = filteredTasks();
  if (tasks.length === 0) return `<div class="card p-10 text-center text-gray-400">No hay tareas. Creá la primera.</div>`;
  return `
    <div class="card">
      ${tasks.map(taskRow).join('<div class="border-t border-gray-100"></div>')}
    </div>
  `;
}

// ============ GANTT ============
export function renderGantt() {
  const tasks = filteredTasks().filter(t => t.startDate && t.dueDate);
  if (tasks.length === 0) return `<div class="card p-10 text-center text-gray-400">Necesitás tareas con fecha de inicio y fin para ver el Gantt.</div>`;

  // Compute date range
  const dates = tasks.flatMap(t => [new Date(t.startDate), new Date(t.dueDate)]);
  let minDate = new Date(Math.min(...dates));
  let maxDate = new Date(Math.max(...dates));
  // Pad 2 days each side
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 2);
  const totalDays = Math.max(1, Math.round((maxDate - minDate) / 86400000));
  const dayWidth = 32; // px per day
  const chartWidth = totalDays * dayWidth;

  // Group tasks by project
  const byProject = {};
  tasks.forEach(t => {
    if (!byProject[t.projectId]) byProject[t.projectId] = [];
    byProject[t.projectId].push(t);
  });

  // Build day headers (show every 2 days for density)
  let headers = '';
  for (let i = 0; i <= totalDays; i++) {
    const d = new Date(minDate); d.setDate(d.getDate() + i);
    const isMonday = d.getDay() === 1;
    const isFirst = d.getDate() === 1;
    headers += `<div class="inline-block text-center text-[10px] ${isFirst?'font-bold':'text-gray-500'} border-l ${isMonday?'border-gray-300':'border-gray-100'}" style="width:${dayWidth}px;height:28px;line-height:28px">${d.getDate()}${isFirst?'/'+(d.getMonth()+1):''}</div>`;
  }

  // Today marker
  const today = new Date(); today.setHours(0,0,0,0);
  const todayOffset = Math.round((today - minDate) / 86400000) * dayWidth;
  const showToday = today >= minDate && today <= maxDate;

  // Rows
  let rows = '';
  Object.entries(byProject).forEach(([pid, ptasks]) => {
    const proj = getProject(pid);
    rows += `
      <div class="flex items-center border-b border-gray-100" style="height:36px">
        <div class="w-56 flex-shrink-0 px-3 text-xs font-semibold truncate flex items-center gap-2 bg-gray-50">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${proj?.color || '#9ca3af'}"></span>
          ${escapeHtml(proj?.name || '—')}
        </div>
        <div class="relative" style="width:${chartWidth}px;height:100%"></div>
      </div>
    `;
    ptasks.forEach(t => {
      const start = new Date(t.startDate);
      const end = new Date(t.dueDate);
      const offsetDays = Math.round((start - minDate) / 86400000);
      const durDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
      const left = offsetDays * dayWidth;
      const width = durDays * dayWidth - 4;
      const overdue = end < today && t.status !== 'COMPLETED';
      const bg = t.status === 'COMPLETED' ? '#86efac' : t.status === 'BLOCKED' ? '#fca5a5' : t.status === 'IN_PROGRESS' ? '#93c5fd' : t.status === 'IN_REVIEW' ? '#fcd34d' : '#d1d5db';
      rows += `
        <div class="flex items-center border-b border-gray-100 hover:bg-gray-50" style="height:32px">
          <div class="w-56 flex-shrink-0 px-3 pl-8 text-xs truncate cursor-pointer" onclick="openTaskDetail('${t.id}')" title="${escapeAttr(t.title)}">${escapeHtml(t.title)}</div>
          <div class="relative" style="width:${chartWidth}px;height:100%">
            <div class="absolute rounded-md shadow-sm cursor-pointer flex items-center px-2 text-[11px] font-medium text-gray-800 overflow-hidden ${overdue ? 'ring-2 ring-red-400' : ''}"
                 style="left:${left}px;top:6px;height:20px;width:${width}px;background:${bg}"
                 onclick="openTaskDetail('${t.id}')" title="${escapeAttr(t.title)} · ${fmt(t.startDate)} → ${fmt(t.dueDate)}">
              ${escapeHtml(t.title)}
            </div>
          </div>
        </div>
      `;
    });
  });

  return `
    <div class="card overflow-hidden">
      <div class="overflow-x-auto">
        <div style="min-width:${chartWidth + 224}px">
          <div class="flex border-b border-gray-200 bg-gray-50 sticky top-0">
            <div class="w-56 flex-shrink-0 px-3 text-xs font-semibold flex items-center" style="height:28px">Tarea</div>
            <div class="relative" style="width:${chartWidth}px">
              ${headers}
              ${showToday ? `<div class="absolute top-0 bottom-0 border-l-2 border-red-500 pointer-events-none" style="left:${todayOffset}px;height:28px"></div>` : ''}
            </div>
          </div>
          <div class="relative">
            ${rows}
            ${showToday ? `<div class="absolute top-0 bottom-0 border-l-2 border-red-400 opacity-50 pointer-events-none" style="left:${224+todayOffset}px;width:2px"></div>` : ''}
          </div>
        </div>
      </div>
      <div class="px-4 py-2 text-xs text-gray-500 flex gap-4 flex-wrap border-t border-gray-100">
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:#d1d5db"></span>Pendiente</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:#93c5fd"></span>En progreso</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:#fcd34d"></span>En revisión</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:#86efac"></span>Completada</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:#fca5a5"></span>Bloqueada</span>
        <span class="flex items-center gap-1"><span class="border-l-2 border-red-500 h-3"></span>Hoy</span>
      </div>
    </div>
  `;
}

// ---- Task modal ----
export function openTaskModal(id) {
  const t = id ? getTask(id) : { id: null, title: '', description: '', status: 'PENDING', priority: 'MEDIUM', projectId: S.state.projects[0]?.id || '', assigneeId: S.currentMemberId, startDate: todayISO(), dueDate: '', estimatedHrs: '', actualHrs: '' };
  const isNew = !id;
  const isDone = t.status === 'COMPLETED';
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar tarea' : 'Nueva tarea'}</h2>
      <form id="taskForm" class="space-y-3" onsubmit="saveTask(event)">
        <input type="hidden" name="id" value="${t.id || ''}" />
        <div>
          <label class="text-xs text-gray-500">Título</label>
          <input name="title" class="input" required autofocus value="${escapeAttr(t.title)}" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Descripción</label>
          <textarea name="description" class="input" rows="2">${escapeHtml(t.description || '')}</textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500">Proyecto</label>
            <select name="projectId" required>
              ${S.state.projects.length === 0 ? '<option value="">(Creá un proyecto primero)</option>' :
                S.state.projects.map(p => `<option value="${p.id}" ${t.projectId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Prioridad</label>
            <select name="priority">
              ${Object.entries(PRIORITY).map(([k,v]) => `<option value="${k}" ${t.priority===k?'selected':''}>${v.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Estado</label>
            <select name="status">
              ${STATUS_ORDER.map(k => `<option value="${k}" ${t.status===k?'selected':''}>${STATUS[k].label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Asignado a</label>
            <select name="assigneeId">
              <option value="">Sin asignar</option>
              ${S.state.members.map(m => `<option value="${m.id}" ${t.assigneeId===m.id?'selected':''}>${escapeHtml(m.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Fecha límite</label>
            <input type="date" name="dueDate" class="input" value="${t.dueDate || ''}" />
          </div>
          <div>
            <label class="text-xs text-gray-500">Fecha inicio</label>
            <input type="date" name="startDate" class="input" value="${t.startDate || ''}" />
          </div>
          <div>
            <label class="text-xs text-gray-500">Horas estimadas</label>
            <input type="number" step="0.25" name="estimatedHrs" class="input" value="${t.estimatedHrs || ''}" placeholder="0" />
          </div>
          ${!isNew ? `
          <div>
            <label class="text-xs text-gray-500">Horas reales ${isDone ? '' : '<span class="text-gray-400">(al finalizar)</span>'}</label>
            <input type="number" step="0.25" name="actualHrs" class="input" value="${t.actualHrs || ''}" placeholder="0" />
          </div>` : ''}
        </div>
        <div id="blockedReasonBox" class="${t.status === 'BLOCKED' ? '' : 'hidden'}">
          <label class="text-xs text-red-600">Motivo del bloqueo <b>(obligatorio)</b></label>
          <textarea name="blockedReason" class="input" rows="2">${escapeHtml(t.blockedReason || '')}</textarea>
        </div>
        <div class="flex justify-between pt-3">
          <div>${id ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="deleteTask('${id}')">Eliminar</button>` : ''}</div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);

  const statusSel = document.querySelector('#taskForm select[name="status"]');
  statusSel.addEventListener('change', (e) => {
    document.getElementById('blockedReasonBox').classList.toggle('hidden', e.target.value !== 'BLOCKED');
  });
}

export function saveTask(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());

  if (data.status === 'BLOCKED' && !data.blockedReason?.trim()) {
    alert('Tenés que escribir un motivo para marcarla como bloqueada.');
    return;
  }
  if (!data.projectId) {
    alert('Creá un proyecto primero.');
    return;
  }

  data.estimatedHrs = data.estimatedHrs ? Number(data.estimatedHrs) : null;
  data.actualHrs    = data.actualHrs    ? Number(data.actualHrs)    : null;

  // Si se completa y no cargó horas reales, pedirlas
  if (data.status === 'COMPLETED' && !data.actualHrs) {
    const hrs = prompt('¿Cuántas horas te llevó realmente?' + (data.estimatedHrs ? ` (estimaste ${data.estimatedHrs}h)` : ''), data.estimatedHrs || '');
    if (hrs === null) return;
    const n = Number(hrs);
    if (!isNaN(n) && n > 0) data.actualHrs = n;
  }

  if (data.id) {
    const t = getTask(data.id);
    const oldStatus = t.status;
    const oldAssignee = t.assigneeId;
    Object.assign(t, data);
    if (data.status !== oldStatus) {
      pushHistory(t.id, 'status', oldStatus, data.status);
      if (data.status === 'COMPLETED') t.completedAt = new Date().toISOString();
    }
    if (data.assigneeId && data.assigneeId !== oldAssignee && data.assigneeId !== S.currentMemberId) {
      notify(data.assigneeId, t.id, `Te asignaron: ${t.title}`);
      const m = getMember(data.assigneeId);
      showToast(`Asignada a ${m?.name || 'miembro'} · ${S.state.emailConfig?.enabled ? '✉ Email enviado' : ''}`, 'success');
    }
    t.updatedAt = new Date().toISOString();
  } else {
    const t = {
      ...data,
      id: uid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: data.status === 'COMPLETED' ? new Date().toISOString() : null,
    };
    S.state.tasks.push(t);
    pushHistory(t.id, 'created', null, null);
    if (data.assigneeId && data.assigneeId !== S.currentMemberId) {
      notify(data.assigneeId, t.id, `Te asignaron: ${t.title}`);
      const m = getMember(data.assigneeId);
      showToast(`Asignada a ${m?.name || 'miembro'} · ${S.state.emailConfig?.enabled ? '✉ Email enviado' : ''}`, 'success');
    }
  }
  save();
  closeModal();
  render();
}

export function deleteTask(id) {
  if (!confirm('¿Eliminar esta tarea?')) return;
  S.state.tasks = S.state.tasks.filter(t => t.id !== id);
  S.state.comments = S.state.comments.filter(c => c.taskId !== id);
  S.state.history  = S.state.history.filter(h => h.taskId !== id);
  save(); closeModal(); render();
}

// ---- Task detail ----
export function openTaskDetail(id) {
  const t = getTask(id);
  const p = getProject(t.projectId);
  const comments = S.state.comments.filter(c => c.taskId === id).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const history  = S.state.history.filter(h => h.taskId === id).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const feed = [...comments.map(c => ({type:'comment', ...c})), ...history.map(h => ({type:'history', ...h}))].sort((a,b) => a.createdAt.localeCompare(b.createdAt));

  openModal(`
    <div class="p-6">
      <div class="flex items-start justify-between mb-2">
        <div class="flex-1 pr-4">
          <div class="flex items-center gap-2 mb-1">
            ${p ? `<span class="text-xs font-medium" style="color:${p?.color || '#6b7280'}">● ${escapeHtml(p.name)}</span>` : ''}
            <span class="chip ${PRIORITY[t.priority].color}">${PRIORITY[t.priority].label}</span>
          </div>
          <h2 class="text-xl font-semibold">${escapeHtml(t.title)}</h2>
        </div>
        <button class="btn-ghost text-sm" onclick="openTaskModal('${t.id}')">Editar</button>
      </div>

      ${t.description ? `<p class="text-sm text-gray-700 my-3">${escapeHtml(t.description)}</p>` : ''}

      <div class="flex flex-wrap gap-2 my-4">
        <span class="chip ${STATUS[t.status].color}">${STATUS[t.status].label}</span>
        ${t.dueDate ? `<span class="chip bg-gray-100 text-gray-700">Vence ${fmt(t.dueDate)}</span>` : ''}
        ${t.estimatedHrs ? `<span class="chip bg-gray-100 text-gray-700">Est: ${t.estimatedHrs}h</span>` : ''}
        ${t.actualHrs ? `<span class="chip bg-gray-100 text-gray-700">Real: ${t.actualHrs}h</span>` : ''}
      </div>

      <div class="grid grid-cols-5 gap-1 mb-4">
        ${STATUS_ORDER.map(s => `
          <button class="chip ${t.status===s?STATUS[s].color:'bg-gray-100 text-gray-500'} py-2" onclick="quickStatus('${t.id}','${s}')">${STATUS[s].label}</button>
        `).join('')}
      </div>

      ${t.status === 'BLOCKED' && t.blockedReason ? `
        <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <div class="text-xs font-semibold text-red-700 mb-1">Motivo del bloqueo</div>
          <div class="text-sm text-red-900">${escapeHtml(t.blockedReason)}</div>
        </div>
      ` : ''}

      <h3 class="text-xs uppercase tracking-wider text-gray-500 mb-2">Actividad</h3>
      <div class="space-y-2 max-h-60 overflow-y-auto mb-3">
        ${feed.length === 0 ? '<div class="text-sm text-gray-400">Sin actividad aún.</div>' : feed.map(e => {
          if (e.type === 'comment') {
            const author = getMember(e.authorId);
            return `<div class="bg-gray-50 rounded-lg p-3 text-sm">
              <div class="flex items-center gap-2 mb-1">
                ${author ? `<span class="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold" style="background:${author.color}">${escapeHtml(author.name[0])}</span><span class="text-xs font-medium">${escapeHtml(author.name)}</span>` : ''}
                <span class="text-xs text-gray-500">${new Date(e.createdAt).toLocaleString('es-AR')}</span>
              </div>
              <div class="text-gray-900">${renderMentions(e.content)}</div>
            </div>`;
          } else {
            const msg = e.action === 'created' ? 'Tarea creada' : `Estado: ${STATUS[e.from]?.label || e.from} → ${STATUS[e.to]?.label || e.to}`;
            return `<div class="text-xs text-gray-500 px-3">${msg} · ${new Date(e.createdAt).toLocaleString('es-AR')}</div>`;
          }
        }).join('')}
      </div>

      <form onsubmit="addComment(event, '${t.id}')" class="flex gap-2">
        <input name="content" class="input" placeholder="Comentario... (@nombre para notificar)" required />
        <button class="btn-primary">Enviar</button>
      </form>
      <p class="text-[11px] text-gray-400 mt-1">Miembros: ${S.state.members.map(m => '@' + m.name).join(', ')}</p>
    </div>
  `);
}

export function quickStatus(taskId, status) {
  const t = getTask(taskId);
  if (status === 'BLOCKED' && !t.blockedReason) {
    const reason = prompt('Motivo del bloqueo (obligatorio):');
    if (!reason?.trim()) return;
    t.blockedReason = reason.trim();
  }
  if (status === 'COMPLETED' && !t.actualHrs) {
    const hrs = prompt('¿Cuántas horas te llevó realmente?' + (t.estimatedHrs ? ` (estimaste ${t.estimatedHrs}h)` : ''), t.estimatedHrs || '');
    if (hrs === null) return;
    const n = Number(hrs);
    if (!isNaN(n) && n > 0) t.actualHrs = n;
  }
  const oldStatus = t.status;
  t.status = status;
  t.updatedAt = new Date().toISOString();
  if (status === 'COMPLETED') t.completedAt = new Date().toISOString();
  pushHistory(taskId, 'status', oldStatus, status);
  save();
  openTaskDetail(taskId);
}

export function addComment(e, taskId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const content = fd.get('content');
  const mentions = parseMentions(content);
  S.state.comments.push({
    id: uid(),
    taskId,
    authorId: S.currentMemberId,
    content,
    mentions,
    createdAt: new Date().toISOString(),
  });
  const task = getTask(taskId);
  mentions.forEach(mid => notify(mid, taskId, `Te mencionaron en "${task.title}"`));
  save();
  openTaskDetail(taskId);
}
