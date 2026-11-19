import { PRIORITY, STATUS } from '../core/constants.js';
import { currentMember, getMember, getProject } from '../core/selectors.js';
import { S } from '../core/state.js';
import { viewHeader } from '../core/ui.js';
import { monthBalance } from './finance.js';
import { daysBetween, escapeAttr, escapeHtml, fmt, fmtMoney, todayISO } from '../utils/helpers.js';

// ============ HOME ============
export function renderHome() {
  const today = todayISO();
  const me = S.currentMemberId;
  const myTasks = S.state.tasks.filter(t => t.status !== 'COMPLETED' && (!t.assigneeId || t.assigneeId === me));
  const dueToday = myTasks.filter(t => t.dueDate && t.dueDate <= today);
  const thisWeek = myTasks.filter(t => {
    if (!t.dueDate) return false;
    const diff = daysBetween(today, t.dueDate);
    return diff >= 0 && diff <= 7;
  });
  const blocked = S.state.tasks.filter(t => t.status === 'BLOCKED' && (!t.assigneeId || t.assigneeId === me));
  const greeting = new Date().getHours() < 12 ? 'Buen día' : new Date().getHours() < 19 ? 'Buenas tardes' : 'Buenas noches';

  return `
    ${viewHeader(`${greeting}, ${currentMember()?.name || ''}`, 'Qué se hace hoy',
      `<button class="btn-primary" onclick="openTaskModal()">+ Nueva tarea</button>`)}

    <div class="px-4 md:px-10 pb-10 space-y-6">

      <section>
        <h2 class="text-xs uppercase tracking-wider text-gray-500 mb-3">Vence hoy o antes (${dueToday.length})</h2>
        <div class="card p-2">
          ${dueToday.length === 0
            ? `<div class="text-gray-400 text-sm p-4">Nada urgente. ✺</div>`
            : dueToday.map(taskRow).join('')}
        </div>
      </section>

      ${blocked.length > 0 ? `
      <section>
        <h2 class="text-xs uppercase tracking-wider text-red-600 mb-3">⚠ Bloqueadas (${blocked.length})</h2>
        <div class="card p-2">
          ${blocked.map(taskRow).join('')}
        </div>
      </section>` : ''}

      <section>
        <h2 class="text-xs uppercase tracking-wider text-gray-500 mb-3">Esta semana (${thisWeek.length})</h2>
        <div class="card p-2">
          ${thisWeek.length === 0
            ? `<div class="text-gray-400 text-sm p-4">Vacío.</div>`
            : thisWeek.map(taskRow).join('')}
        </div>
      </section>

      <section class="grid grid-cols-4 gap-4">
        ${statCard('Tareas activas', myTasks.length)}
        ${statCard('Proyectos activos', S.state.projects.filter(p=>p.status==='ACTIVE').length)}
        ${statCard('Clientes', S.state.clients.length)}
        ${statCard('Balance del mes', fmtMoney(monthBalance()))}
      </section>

    </div>
  `;
}

export function statCard(label, value) {
  return `
    <div class="card p-5">
      <div class="text-xs text-gray-500">${label}</div>
      <div class="text-2xl font-semibold mt-1">${value}</div>
    </div>
  `;
}

export function taskRow(t) {
  const p = getProject(t.projectId);
  const assignee = getMember(t.assigneeId);
  const isOverdue = t.dueDate && t.dueDate < todayISO() && t.status !== 'COMPLETED';
  return `
    <div class="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer" onclick="openTaskDetail('${t.id}')">
      <span class="chip ${STATUS[t.status].color}">${STATUS[t.status].label}</span>
      <div class="flex-1">
        <div class="text-sm font-medium">${escapeHtml(t.title)}</div>
        <div class="text-xs text-gray-500">${p ? escapeHtml(p.name) : 'Sin proyecto'}</div>
      </div>
      ${assignee ? `<span class="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold" style="background:${assignee.color}" title="${escapeAttr(assignee.name)}">${escapeHtml(assignee.name[0])}</span>` : '<span class="w-6"></span>'}
      <span class="chip ${PRIORITY[t.priority].color}">${PRIORITY[t.priority].label}</span>
      <span class="text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'} w-20 text-right">${fmt(t.dueDate)}</span>
    </div>
  `;
}
