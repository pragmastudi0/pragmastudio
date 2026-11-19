import { S } from '../core/state.js';
import { viewHeader } from '../core/ui.js';
import { statCard } from './dashboard.js';
import { MEMBER_ROLES } from './team.js';
import { escapeHtml } from '../utils/helpers.js';

// ============ REPORTS ============
export function renderReports() {
  const total = S.state.tasks.length;
  const completed = S.state.tasks.filter(t => t.status === 'COMPLETED').length;
  const blocked = S.state.tasks.filter(t => t.status === 'BLOCKED').length;
  const inProgress = S.state.tasks.filter(t => t.status === 'IN_PROGRESS').length;

  // Estimation accuracy
  const estimated = S.state.tasks.filter(t => t.estimatedHrs && t.actualHrs);
  const avgDeviation = estimated.length > 0
    ? Math.round(estimated.reduce((a,t) => a + (t.actualHrs - t.estimatedHrs) / t.estimatedHrs * 100, 0) / estimated.length)
    : null;

  // Completed last 30 days
  const since = new Date(); since.setDate(since.getDate() - 30);
  const recentlyDone = S.state.tasks.filter(t => t.completedAt && new Date(t.completedAt) >= since).length;

  // Workload per member: horas estimadas pendientes vs capacidad semanal
  const workload = S.state.members.map(m => {
    const activeTasks = S.state.tasks.filter(t => t.assigneeId === m.id && t.status !== 'COMPLETED');
    const blockedTasks = activeTasks.filter(t => t.status === 'BLOCKED');
    const estimatedHrsPending = activeTasks.reduce((sum, t) => sum + (Number(t.estimatedHrs) || 0), 0);
    const capacity = Number(m.weeklyCapacityHrs) || 30;
    const weeksOfLoad = capacity > 0 ? estimatedHrsPending / capacity : 0;
    let loadStatus = 'green';                   // < 1 semana
    if (weeksOfLoad > 4)      loadStatus = 'red';      // > 4 semanas: saturado
    else if (weeksOfLoad > 2) loadStatus = 'amber';    // 2-4 semanas: alto
    else if (weeksOfLoad > 1) loadStatus = 'yellow';   // 1-2 semanas: ok pero ya cargado
    return {
      member: m,
      role: MEMBER_ROLES.find(r => r.key === m.role),
      active: activeTasks.length,
      blocked: blockedTasks.length,
      done30d: S.state.tasks.filter(t => t.assigneeId === m.id && t.completedAt && new Date(t.completedAt) >= since).length,
      estimatedHrsPending,
      capacity,
      weeksOfLoad,
      loadStatus,
    };
  }).sort((a, b) => b.weeksOfLoad - a.weeksOfLoad);

  return `
    ${viewHeader('Reportes', 'Tu radar del trabajo')}

    <div class="px-4 md:px-10 pb-10 space-y-4 md:space-y-6">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        ${statCard('Total tareas', total)}
        ${statCard('Completadas', completed)}
        ${statCard('En progreso', inProgress)}
        ${statCard('Bloqueadas', blocked)}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        <div class="card p-5">
          <h3 class="font-semibold mb-3">Últimos 30 días</h3>
          <div class="text-3xl font-semibold">${recentlyDone}</div>
          <div class="text-sm text-gray-500">tareas completadas</div>
        </div>
        <div class="card p-5">
          <h3 class="font-semibold mb-3">Precisión de estimación</h3>
          ${avgDeviation === null
            ? '<div class="text-sm text-gray-400">Cargá tiempo estimado y real en tus tareas para ver este dato.</div>'
            : `<div class="text-3xl font-semibold ${Math.abs(avgDeviation)<20?'text-green-700':Math.abs(avgDeviation)<50?'text-amber-700':'text-red-600'}">${avgDeviation>0?'+':''}${avgDeviation}%</div>
               <div class="text-sm text-gray-500">desvío promedio (real vs estimado)</div>`}
        </div>
      </div>

      <div class="card p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold">Carga del equipo</h3>
          <span class="text-[11px] text-gray-500">Horas estimadas pendientes / capacidad semanal</span>
        </div>
        ${workload.length === 0 ? '<div class="text-sm text-gray-400">Sin miembros.</div>' : `
        <div class="space-y-4">
          ${workload.map(w => {
            const colors = {
              green: { bg: 'bg-green-500', text: 'text-green-700', label: 'OK' },
              yellow:{ bg: 'bg-blue-500',  text: 'text-blue-700',  label: 'Cargado' },
              amber: { bg: 'bg-amber-500', text: 'text-amber-700', label: 'Alto' },
              red:   { bg: 'bg-red-500',   text: 'text-red-700',   label: 'Saturado' },
            };
            const c = colors[w.loadStatus];
            const pct = Math.min(100, w.capacity > 0 ? (w.estimatedHrsPending / (w.capacity * 4)) * 100 : 0);
            return `
              <div>
                <div class="flex items-center gap-3 mb-1">
                  <span class="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style="background:${w.member.color}">${escapeHtml(w.member.name[0])}</span>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-sm font-medium">${escapeHtml(w.member.name)}</span>
                      ${w.role ? `<span class="text-[10px] text-gray-500 uppercase tracking-wider">${escapeHtml(w.role.label)}</span>` : ''}
                      ${w.blocked > 0 ? `<span class="chip bg-red-100 text-red-700">⚠ ${w.blocked} bloqueada${w.blocked>1?'s':''}</span>` : ''}
                    </div>
                  </div>
                  <span class="chip ${w.loadStatus==='red'?'bg-red-100 text-red-700':w.loadStatus==='amber'?'bg-amber-100 text-amber-700':w.loadStatus==='yellow'?'bg-blue-100 text-blue-700':'bg-green-100 text-green-700'} text-[10px]">${c.label}</span>
                </div>
                <div class="ml-10">
                  <div class="flex justify-between text-[11px] text-gray-600 mb-1">
                    <span><b>${w.estimatedHrsPending}h</b> estimadas pendientes · <b>${w.active}</b> tareas activas</span>
                    <span class="${c.text} font-semibold">${w.weeksOfLoad.toFixed(1)} sem. de trabajo</span>
                  </div>
                  <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full ${c.bg} transition-all" style="width:${pct}%"></div>
                  </div>
                  <div class="flex justify-between text-[10px] text-gray-400 mt-1">
                    <span>capacidad ${w.capacity}h/sem</span>
                    <span>${w.done30d} cerradas últ. 30d</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div class="mt-5 pt-4 border-t border-gray-100 text-[11px] text-gray-500 leading-relaxed">
          <b class="text-gray-700">Cómo leer este indicador:</b><br/>
          Cada barra muestra cuántas <b>semanas de trabajo</b> tiene cada uno acumuladas (horas estimadas ÷ capacidad semanal). Verde = al día (&lt;1 sem) · Azul = cargado (1-2) · Ámbar = alto (2-4) · Rojo = saturado (&gt;4). Si alguien queda rojo y otro verde, conviene rebalancear tareas.
        </div>`}
      </div>
    </div>
  `;
}
