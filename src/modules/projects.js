import { DEFAULT_PROJECT_COLOR, PRIORITY, PROJECT_COLORS, PROJECT_STATUS, PROJECT_STATUS_ORDER, PROJECT_TYPE, PROJECT_TYPE_ORDER, STATUS } from '../core/constants.js';
import { clientLabel, getClient, getMember, getProject, projectProgress } from '../core/selectors.js';
import { S } from '../core/state.js';
import { closeModal, openModal, render, showToast, viewHeader } from '../core/ui.js';
import { getProjectTypes, projectTypesText } from './budgets_ui.js';
import { fmtAmount } from './invoices.js';
import { save } from '../services/cloud.js';
import { escapeAttr, escapeHtml, fmt, fmtMoney, todayISO, uid } from '../utils/helpers.js';

export function dragProjectStart(e, projectId) {
  S._draggingProjectId = projectId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', projectId);
  e.currentTarget.classList.add('dragging');
}

export function dragProjectEnd(e) {
  e.currentTarget.classList.remove('dragging');
  S._draggingProjectId = null;
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

export function dragColOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

export function dragColLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-over');
  }
}

export function dropProject(e, status) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const pid = S._draggingProjectId || e.dataTransfer.getData('text/plain');
  if (!pid) return;
  const p = getProject(pid);
  if (!p || p.status === status) return;
  p.status = status;
  save();
  render();
  showToast(`"${p.name}" → ${PROJECT_STATUS[status].label}`, 'success');
}

export function getFilteredProjectsByType() {
  return S.projectsTypeFilter
    ? S.state.projects.filter(p => getProjectTypes(p).includes(S.projectsTypeFilter))
    : S.state.projects;
}

export function renderProjects() {
  return `
    ${viewHeader('Proyectos', `${S.state.projects.length} en total`,
      `<div class="flex gap-1 bg-gray-100 rounded-lg p-1">
         <button class="px-3 py-1 rounded-md text-sm ${S.projectsViewMode==='kanban'?'bg-white shadow-sm font-medium':''}" onclick="projectsViewMode='kanban'; render()">Kanban</button>
         <button class="px-3 py-1 rounded-md text-sm ${S.projectsViewMode==='list'?'bg-white shadow-sm font-medium':''}" onclick="projectsViewMode='list'; render()">Lista</button>
       </div>
       <button class="btn-primary" onclick="openProjectModal()">+ Nuevo</button>`)}

    <div class="px-4 md:px-10 pb-4 flex flex-wrap gap-2">
      <button onclick="projectsTypeFilter=''; render()" class="chip ${S.projectsTypeFilter===''?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">Todos (${S.state.projects.length})</button>
      ${PROJECT_TYPE_ORDER.map(k => {
        const n = S.state.projects.filter(p => getProjectTypes(p).includes(k)).length;
        if (n === 0) return '';
        const t = PROJECT_TYPE[k];
        return `<button onclick="projectsTypeFilter='${k}'; render()" class="chip ${S.projectsTypeFilter===k?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">${t.label} (${n})</button>`;
      }).join('')}
    </div>

    <div class="px-4 md:px-10 pb-10">
      ${S.state.projects.length === 0
        ? `<div class="card p-10 text-center text-gray-400">Sin proyectos. Creá el primero.</div>`
        : (S.projectsViewMode === 'kanban' ? renderProjectsKanban() : renderProjectsList())
      }
    </div>
  `;
}

export function renderProjectsKanban() {
  const all = getFilteredProjectsByType();
  return `
    <div class="flex gap-4 overflow-x-auto scroll-hide pb-4">
      ${PROJECT_STATUS_ORDER.map(k => {
        const s = PROJECT_STATUS[k];
        const colProjects = all.filter(p => p.status === k);
        return `
          <div class="kanban-col" style="width:280px;flex-shrink:0"
               ondragover="dragColOver(event)"
               ondragleave="dragColLeave(event)"
               ondrop="dropProject(event, '${k}')">
            <div class="flex items-center justify-between mb-3 px-1">
              <div class="flex items-center gap-2">
                <span class="chip ${s.color}">${s.label}</span>
                <span class="text-xs text-gray-500">${colProjects.length}</span>
              </div>
            </div>
            <div class="min-h-[60px]">
              ${colProjects.length === 0
                ? '<div class="text-xs text-gray-400 px-2 py-3 text-center border-2 border-dashed border-gray-200 rounded-lg">Arrastrá acá</div>'
                : colProjects.map(p => projectCard(p)).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

export function renderProjectsList() {
  const all = getFilteredProjectsByType();
  const filtered = S.projectsListStatus ? all.filter(p => p.status === S.projectsListStatus) : all;
  const sorted = [...filtered].sort((a, b) => {
    const orderA = PROJECT_STATUS_ORDER.indexOf(a.status);
    const orderB = PROJECT_STATUS_ORDER.indexOf(b.status);
    if (orderA !== orderB) return orderA - orderB;
    return (a.name || '').localeCompare(b.name || '');
  });

  return `
    <div class="flex flex-wrap gap-2 mb-3">
      <button onclick="projectsListStatus=''; render()" class="chip ${S.projectsListStatus===''?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">Todos (${S.state.projects.length})</button>
      ${PROJECT_STATUS_ORDER.map(k => {
        const n = S.state.projects.filter(p => p.status === k).length;
        if (n === 0) return '';
        const sc = PROJECT_STATUS[k];
        return `<button onclick="projectsListStatus='${k}'; render()" class="chip ${S.projectsListStatus===k?'bg-black text-white':sc.color} py-1.5 px-3 cursor-pointer">${sc.label} (${n})</button>`;
      }).join('')}
    </div>

    <div class="card divide-y divide-gray-100">
      ${sorted.length === 0 ? '<div class="p-10 text-center text-gray-400 text-sm">Sin proyectos en esta categoría.</div>' : sorted.map(p => projectListRow(p)).join('')}
    </div>
  `;
}

export function projectListRow(p) {
  const s = PROJECT_STATUS[p.status] || PROJECT_STATUS.LEAD;
  const pr = projectProgress(p.id);
  const taskCount = S.state.tasks.filter(t => t.projectId === p.id).length;
  const activeTasks = S.state.tasks.filter(t => t.projectId === p.id && t.status !== 'COMPLETED').length;
  const blockedTasks = S.state.tasks.filter(t => t.projectId === p.id && t.status === 'BLOCKED').length;
  return `
    <div class="p-3 md:p-4 hover:bg-gray-50 cursor-pointer flex items-center gap-3" onclick="openProjectDetail('${p.id}')">
      <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${p?.color || '#9ca3af'}"></span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold text-sm truncate">${escapeHtml(p.name)}</span>
          <span class="text-[10px] uppercase tracking-wider text-gray-500 font-medium">${escapeHtml(projectTypesText(p))}</span>
          <span class="chip ${s.color}">${s.label}</span>
          ${blockedTasks ? `<span class="chip bg-red-100 text-red-700">⚠ ${blockedTasks}</span>` : ''}
        </div>
        ${p.contactName ? `<div class="text-xs text-gray-500 truncate mt-0.5">${escapeHtml(p.contactName)}</div>` : ''}
      </div>
      ${p.status === 'ACTIVE_RECURRING' && p.monthlyFee ? `<div class="text-sm text-green-700 font-medium hidden sm:block whitespace-nowrap">${fmtAmount(p.monthlyFee, p.monthlyFeeCurrency)}/mes</div>` : ''}
      <div class="text-xs text-gray-500 hidden md:flex items-center gap-3 w-44">
        <div class="flex-1">
          <div class="h-1 bg-gray-100 rounded-full overflow-hidden"><div class="h-full ${p.status==='DONE'||p.status==='ARCHIVED'?'bg-purple-500':'bg-black'}" style="width:${pr}%"></div></div>
        </div>
        <span class="whitespace-nowrap">${activeTasks}/${taskCount} · ${pr}%</span>
      </div>
    </div>
  `;
}

export function projectCard(p) {
  const pr = projectProgress(p.id);
  const taskCount = S.state.tasks.filter(t => t.projectId === p.id).length;
  const activeTasks = S.state.tasks.filter(t => t.projectId === p.id && t.status !== 'COMPLETED').length;
  const blockedTasks = S.state.tasks.filter(t => t.projectId === p.id && t.status === 'BLOCKED').length;
  return `
    <div class="task-card draggable"
         draggable="true"
         ondragstart="dragProjectStart(event, '${p.id}')"
         ondragend="dragProjectEnd(event)"
         onclick="openProjectDetail('${p.id}')">
      <div class="flex items-center gap-2 mb-1">
        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${p?.color || '#9ca3af'}"></span>
        <span class="text-sm font-semibold truncate flex-1">${escapeHtml(p.name)}</span>
      </div>
      <div class="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1">${escapeHtml(projectTypesText(p))}</div>
      ${p.contactName ? `<div class="text-xs text-gray-500 truncate">${escapeHtml(p.contactName)}</div>` : ''}
      ${p.status === 'ACTIVE_RECURRING' && p.monthlyFee ? `<div class="text-xs text-green-700 font-medium mt-1">${fmtAmount(p.monthlyFee, p.monthlyFeeCurrency)}/mes</div>` : ''}
      ${taskCount > 0 ? `
        <div class="mt-3">
          <div class="flex justify-between text-[11px] text-gray-500 mb-1">
            <span>${activeTasks} activas${blockedTasks ? ' · ' + blockedTasks + ' bloqueada' + (blockedTasks>1?'s':'') : ''}</span>
            <span>${pr}%</span>
          </div>
          <div class="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full ${p.status==='DONE'||p.status==='ARCHIVED'?'bg-purple-500':'bg-black'} rounded-full" style="width:${pr}%"></div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

export function hasProfileData(p) {
  const keys = ['contactRole','contactPhone2','contactEmail2','companyName','taxId','industry','website','address','city','country','domain','domainProvider','domainExpiry','hostingProvider','serverInfo','adminUrl','credentialsLink','repoUrl','techStack','techNotes','instagram','facebook','linkedin','tiktok','source','firstContactDate','commercialNotes'];
  return keys.some(k => p[k]);
}

export function renderProfileSection(p) {
  const has = (...keys) => keys.some(k => p[k]);

  if (!hasProfileData(p) && !has('contactName','contactPhone','contactEmail')) {
    return `
      <div class="card p-4 border border-dashed border-gray-300 mb-4 text-center">
        <p class="text-sm text-gray-500 mb-2">Sin perfil del cliente todavía.</p>
        <button onclick="openProjectProfileModal('${p.id}')" class="btn-primary text-sm">+ Armar perfil del cliente</button>
      </div>
    `;
  }

  const block = (title, content) => content ? `
    <div>
      <div class="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">${title}</div>
      ${content}
    </div>
  ` : '';

  // Contact
  const contactContent = has('contactName','contactPhone','contactPhone2','contactEmail','contactEmail2','contactRole') ? `
    <div class="space-y-1 text-sm">
      ${p.contactName ? `<div class="font-medium">${escapeHtml(p.contactName)}${p.contactRole?` <span class="text-gray-500 font-normal">· ${escapeHtml(p.contactRole)}</span>`:''}</div>` : ''}
      ${p.contactPhone ? `<a href="https://wa.me/${p.contactPhone.replace(/[^\d]/g,'')}" target="_blank" class="block text-gray-700 hover:text-green-700">📱 ${escapeHtml(p.contactPhone)}</a>` : ''}
      ${p.contactPhone2 ? `<a href="tel:${escapeAttr(p.contactPhone2)}" class="block text-gray-700 hover:text-gray-900">☎ ${escapeHtml(p.contactPhone2)}</a>` : ''}
      ${p.contactEmail ? `<a href="mailto:${escapeAttr(p.contactEmail)}" class="block text-gray-700 hover:text-blue-700">✉ ${escapeHtml(p.contactEmail)}</a>` : ''}
      ${p.contactEmail2 ? `<a href="mailto:${escapeAttr(p.contactEmail2)}" class="block text-gray-700 hover:text-blue-700">✉ ${escapeHtml(p.contactEmail2)}</a>` : ''}
    </div>
  ` : '';

  // Company
  const companyMeta = [p.taxId, p.industry].filter(Boolean);
  const addr = [p.address, p.city, p.country].filter(Boolean);
  const companyContent = has('companyName','taxId','industry','website','address','city','country') ? `
    <div class="space-y-1 text-sm text-gray-700">
      ${p.companyName ? `<div class="font-medium">${escapeHtml(p.companyName)}</div>` : ''}
      ${companyMeta.length ? `<div class="text-gray-500 text-xs">${companyMeta.map(escapeHtml).join(' · ')}</div>` : ''}
      ${p.website ? `<a href="${escapeAttr(p.website)}" target="_blank" class="text-blue-600 hover:underline block">🌐 ${escapeHtml(p.website.replace(/^https?:\/\//,''))}</a>` : ''}
      ${addr.length ? `<div>📍 ${addr.map(escapeHtml).join(', ')}</div>` : ''}
    </div>
  ` : '';

  // Technical
  const techContent = has('domain','domainProvider','domainExpiry','hostingProvider','serverInfo','adminUrl','credentialsLink','repoUrl','techStack','techNotes') ? `
    <div class="space-y-1 text-sm text-gray-700">
      ${p.domain ? `<div><span class="text-gray-500">Dominio:</span> <span class="font-medium">${escapeHtml(p.domain)}</span>${p.domainProvider?` <span class="text-xs text-gray-500">(${escapeHtml(p.domainProvider)})</span>`:''}${p.domainExpiry?` <span class="text-xs ${p.domainExpiry<todayISO()?'text-red-600 font-medium':'text-gray-500'}">${p.domainExpiry<todayISO()?'⚠ venció':'vence'} ${fmt(p.domainExpiry)}</span>`:''}</div>` : ''}
      ${p.hostingProvider ? `<div><span class="text-gray-500">Hosting:</span> <span class="font-medium">${escapeHtml(p.hostingProvider)}</span></div>` : ''}
      ${p.serverInfo ? `<div><span class="text-gray-500">Server:</span> <span class="font-mono text-xs">${escapeHtml(p.serverInfo)}</span></div>` : ''}
      ${p.techStack ? `<div><span class="text-gray-500">Stack:</span> ${escapeHtml(p.techStack)}</div>` : ''}
      ${(p.adminUrl || p.credentialsLink || p.repoUrl) ? `
        <div class="flex flex-wrap gap-1.5 mt-2">
          ${p.adminUrl ? `<a href="${escapeAttr(p.adminUrl)}" target="_blank" class="chip bg-gray-100 text-gray-700 hover:bg-gray-200">⚙ Admin ↗</a>` : ''}
          ${p.credentialsLink ? `<a href="${escapeAttr(p.credentialsLink)}" target="_blank" class="chip bg-amber-100 text-amber-800 hover:bg-amber-200">🔒 Credenciales ↗</a>` : ''}
          ${p.repoUrl ? `<a href="${escapeAttr(p.repoUrl)}" target="_blank" class="chip bg-gray-900 text-white hover:bg-black">{ } Repo ↗</a>` : ''}
        </div>
      ` : ''}
      ${p.techNotes ? `<div class="mt-2 p-2 bg-gray-50 rounded text-xs whitespace-pre-wrap">${escapeHtml(p.techNotes)}</div>` : ''}
    </div>
  ` : '';

  // Social
  const socialContent = has('instagram','facebook','linkedin','tiktok') ? `
    <div class="flex flex-wrap gap-1.5">
      ${p.instagram ? `<a href="https://instagram.com/${escapeAttr(p.instagram.replace('@',''))}" target="_blank" class="chip bg-pink-100 text-pink-700 hover:bg-pink-200">IG ${escapeHtml(p.instagram)}</a>` : ''}
      ${p.facebook ? `<a href="${p.facebook.startsWith('http')?escapeAttr(p.facebook):'https://facebook.com/'+escapeAttr(p.facebook)}" target="_blank" class="chip bg-blue-100 text-blue-700 hover:bg-blue-200">Facebook ↗</a>` : ''}
      ${p.linkedin ? `<a href="${escapeAttr(p.linkedin)}" target="_blank" class="chip bg-blue-100 text-blue-800 hover:bg-blue-200">LinkedIn ↗</a>` : ''}
      ${p.tiktok ? `<a href="https://tiktok.com/@${escapeAttr(p.tiktok.replace('@',''))}" target="_blank" class="chip bg-gray-900 text-white hover:bg-black">TikTok ${escapeHtml(p.tiktok)}</a>` : ''}
    </div>
  ` : '';

  // Commercial
  const commercialContent = has('source','firstContactDate','commercialNotes') ? `
    <div class="space-y-1 text-sm text-gray-700">
      ${p.source ? `<div><span class="text-gray-500">Fuente:</span> ${escapeHtml(p.source)}</div>` : ''}
      ${p.firstContactDate ? `<div><span class="text-gray-500">Primer contacto:</span> ${fmt(p.firstContactDate)}</div>` : ''}
      ${p.commercialNotes ? `<div class="mt-1 p-2 bg-gray-50 rounded text-xs whitespace-pre-wrap">${escapeHtml(p.commercialNotes)}</div>` : ''}
    </div>
  ` : '';

  return `
    <div class="card p-4 md:p-5 mb-4">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold">Perfil del cliente</h3>
        <button onclick="openProjectProfileModal('${p.id}')" class="btn-ghost text-sm">Editar</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        ${block('Contacto', contactContent)}
        ${block('Empresa', companyContent)}
        ${block('Datos técnicos', techContent)}
        ${block('Redes sociales', socialContent)}
        ${block('Comercial', commercialContent)}
      </div>
    </div>
  `;
}

export function openProjectDetail(id) {
  const p = getProject(id);
  const s = PROJECT_STATUS[p.status] || PROJECT_STATUS.LEAD;
  const isClosed = p.status === 'DONE' || p.status === 'ARCHIVED';
  const tasks = S.state.tasks.filter(t => t.projectId === id);
  const completedTasks = tasks.filter(t => t.status === 'COMPLETED');
  const incomes = S.state.incomes.filter(i => i.projectId === id).reduce((a,b) => a + Number(b.amount||0), 0);
  const expenses = S.state.expenses.filter(e => e.projectId === id).reduce((a,b) => a + Number(b.amount||0), 0);

  const totalHrs = completedTasks.reduce((a,t) => a + (Number(t.actualHrs)||0), 0);

  openModal(`
    <div class="p-6">
      <div class="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${p?.color || '#9ca3af'}"></span>
            <h2 class="text-xl md:text-2xl font-semibold leading-tight">${escapeHtml(p.name)}</h2>
          </div>
          <div class="flex items-center gap-2 mt-2 flex-wrap">
            <span class="text-[10px] uppercase tracking-wider text-gray-500 font-medium">${escapeHtml(projectTypesText(p))}</span>
            <span class="chip ${s.color}">${s.label}</span>
            ${p.contactName ? `<span class="text-sm text-gray-500">· ${escapeHtml(p.contactName)}</span>` : ''}
          </div>
        </div>
        <div class="flex gap-1">
          <button class="btn-ghost text-sm" onclick="openProjectModal('${p.id}')">Editar</button>
          <button class="btn-ghost text-sm text-red-600" onclick="deleteProject('${p.id}')">Eliminar</button>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 mb-4">
        ${p.contactPhone ? `
          <a href="https://wa.me/${p.contactPhone.replace(/[^\d]/g, '')}" target="_blank" class="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition truncate">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
            ${escapeHtml(p.contactPhone)}
          </a>
        ` : `
          <button onclick="openProjectModal('${p.id}')" class="flex items-center justify-center gap-1 py-2.5 rounded-lg border-2 border-dashed border-gray-300 hover:border-green-600 hover:text-green-700 text-gray-500 text-sm font-medium transition">
            + WhatsApp
          </button>
        `}
        ${p.contactEmail ? `
          <a href="mailto:${p.contactEmail}" class="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gray-900 hover:bg-black text-white text-sm font-medium transition truncate">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>
            Email
          </a>
        ` : `
          <button onclick="openProjectModal('${p.id}')" class="flex items-center justify-center gap-1 py-2.5 rounded-lg border-2 border-dashed border-gray-300 hover:border-gray-700 hover:text-gray-900 text-gray-500 text-sm font-medium transition">
            + Email
          </button>
        `}
        ${p.systemUrl ? `
          <a href="${escapeAttr(p.systemUrl)}" target="_blank" class="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition truncate">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>
            Sistema
          </a>
        ` : `
          <button onclick="openProjectModal('${p.id}')" class="flex items-center justify-center gap-1 py-2.5 rounded-lg border-2 border-dashed border-gray-300 hover:border-blue-600 hover:text-blue-700 text-gray-500 text-sm font-medium transition">
            + Sistema
          </button>
        `}
      </div>

      ${p.description ? `<p class="text-sm text-gray-700 mb-4">${escapeHtml(p.description)}</p>` : ''}

      ${renderProfileSection(p)}

      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="bg-gray-50 p-3 rounded-lg"><div class="text-xs text-gray-500">Ingresos</div><div class="text-lg font-semibold">${fmtMoney(incomes)}</div></div>
        <div class="bg-gray-50 p-3 rounded-lg"><div class="text-xs text-gray-500">Gastos</div><div class="text-lg font-semibold">${fmtMoney(expenses)}</div></div>
      </div>

      ${p.status === 'ACTIVE_RECURRING' && p.monthlyFee ? `<div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm"><b>Mensualidad:</b> ${fmtMoney(p.monthlyFee)} / mes</div>` : ''}

      ${p.clientId && getClient(p.clientId) ? `<div class="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 text-sm flex items-center justify-between gap-2"><span><b>Cliente:</b> ${escapeHtml(clientLabel(getClient(p.clientId)))}</span><button class="btn-ghost text-xs" onclick="closeModal(); go('clients')">Ver clientes →</button></div>` : ''}

      ${isClosed ? `
        <div class="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
          <div class="text-xs uppercase tracking-wider text-purple-700 font-semibold mb-2">Historial — Proyecto ${p.status === 'DONE' ? 'terminado' : 'archivado'}</div>
          <div class="grid grid-cols-3 gap-3 text-center">
            <div><div class="text-lg font-semibold">${completedTasks.length}</div><div class="text-xs text-gray-600">Tareas completadas</div></div>
            <div><div class="text-lg font-semibold">${tasks.length}</div><div class="text-xs text-gray-600">Tareas totales</div></div>
            <div><div class="text-lg font-semibold">${totalHrs}h</div><div class="text-xs text-gray-600">Horas invertidas</div></div>
          </div>
        </div>
        <h3 class="text-xs uppercase tracking-wider text-gray-500 mb-2">Tareas realizadas</h3>
        <div class="space-y-1 max-h-64 overflow-y-auto">
          ${completedTasks.length === 0 ? '<div class="text-gray-400 text-sm">Sin tareas completadas.</div>' : completedTasks.map(t => {
            const assignee = getMember(t.assigneeId);
            return `
              <div class="flex items-center gap-2 py-2 border-b border-gray-100 cursor-pointer hover:bg-gray-50 px-2 rounded text-sm" onclick="closeModal(); openTaskDetail('${t.id}')">
                <span class="text-green-600">✓</span>
                <span class="flex-1 truncate">${escapeHtml(t.title)}</span>
                ${assignee ? `<span class="text-xs text-gray-500">${escapeHtml(assignee.name)}</span>` : ''}
                ${t.actualHrs ? `<span class="text-xs text-gray-500">${t.actualHrs}h</span>` : ''}
                <span class="text-xs text-gray-500">${fmt(t.completedAt)}</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-xs uppercase tracking-wider text-gray-500">Tareas (${tasks.length})</h3>
          ${tasks.filter(t => t.status !== 'COMPLETED').length > 0 ? `
            <button onclick="openPromptModal('${p.id}')" class="text-xs flex items-center gap-1 px-2 py-1 rounded-md bg-purple-50 text-purple-700 hover:bg-purple-100 font-medium">
              ✦ Prompt para Claude
            </button>
          ` : ''}
        </div>
        <div class="space-y-1 max-h-80 overflow-y-auto">
          ${tasks.length === 0 ? '<div class="text-gray-400 text-sm">Sin tareas.</div>' : tasks.map(t => `
            <div class="flex items-center gap-2 py-2 border-b border-gray-100 cursor-pointer hover:bg-gray-50 px-2 rounded" onclick="closeModal(); openTaskDetail('${t.id}')">
              <span class="chip ${STATUS[t.status].color}">${STATUS[t.status].label}</span>
              <span class="text-sm flex-1">${escapeHtml(t.title)}</span>
              <span class="text-xs text-gray-500">${fmt(t.dueDate)}</span>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `);
}

export function generateProjectPrompt(projectId, style) {
  const p = getProject(projectId);
  const allTasks = S.state.tasks.filter(t => t.projectId === projectId && t.status !== 'COMPLETED');
  const blocked = allTasks.filter(t => t.status === 'BLOCKED');
  const inReview = allTasks.filter(t => t.status === 'IN_REVIEW');
  const inProgress = allTasks.filter(t => t.status === 'IN_PROGRESS');
  const pending = allTasks.filter(t => t.status === 'PENDING');

  const order = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
  const grouped = order.map(prio => ({
    prio,
    label: PRIORITY[prio].label,
    tasks: allTasks.filter(t => t.priority === prio && t.status !== 'BLOCKED'),
  })).filter(g => g.tasks.length > 0);

  const taskBullet = (t) => {
    let line = `- **${t.title}**`;
    const meta = [];
    if (t.dueDate) meta.push(`vence ${fmt(t.dueDate)}`);
    if (t.estimatedHrs) meta.push(`~${t.estimatedHrs}h`);
    if (t.status === 'IN_PROGRESS') meta.push('en progreso');
    if (t.status === 'IN_REVIEW') meta.push('en revisión');
    if (meta.length) line += ` _(${meta.join(' · ')})_`;
    if (t.description) line += `\n  ${t.description.replace(/\n/g, '\n  ')}`;
    return line;
  };

  let out = `# ${p.name}\n\n`;
  if (p.description) out += `**Contexto:** ${p.description}\n\n`;
  if (p.systemUrl) out += `**Sistema:** ${p.systemUrl}\n\n`;

  out += `## Estado actual\n`;
  out += `- ${pending.length} pendientes · ${inProgress.length} en progreso · ${inReview.length} en revisión · ${blocked.length} bloqueadas\n\n`;

  if (grouped.length > 0) {
    out += `## Tareas por prioridad\n\n`;
    grouped.forEach(g => {
      out += `### ${g.label} (${g.tasks.length})\n`;
      g.tasks.forEach(t => { out += taskBullet(t) + '\n'; });
      out += '\n';
    });
  }

  if (blocked.length > 0) {
    out += `## ⚠ Bloqueadas\n\n`;
    blocked.forEach(t => {
      out += `- **${t.title}** — _Motivo:_ ${t.blockedReason || 'sin especificar'}\n`;
    });
    out += '\n';
  }

  out += `---\n\n`;

  if (style === 'organize') {
    out += `## Lo que necesito\n\n`;
    out += `Ayudame a organizar este trabajo:\n\n`;
    out += `1. Revisá el listado y sugerí un orden de ejecución óptimo\n`;
    out += `2. Identificá dependencias entre tareas (qué debe ir antes de qué)\n`;
    out += `3. Detectá tareas que se puedan agrupar o resolver de una sola vez\n`;
    out += `4. Avisame si ves algo ambiguo o que falte\n`;
    out += `5. Estimá si el conjunto es realista para el tiempo disponible\n`;
  } else if (style === 'execute') {
    out += `## Lo que necesito\n\n`;
    out += `Ayudame a resolver estas tareas. Para cada una:\n\n`;
    out += `1. Sugerí un enfoque concreto paso a paso\n`;
    out += `2. Identificá riesgos o cosas a tener en cuenta\n`;
    out += `3. Si necesitás más contexto, preguntame\n`;
    out += `4. Si una tarea no está clara, marcala como tal\n`;
    out += `5. Empezá por la de mayor prioridad y avanzá hacia abajo\n`;
  } else if (style === 'review') {
    out += `## Lo que necesito\n\n`;
    out += `Hacé un análisis crítico de esta carga de trabajo:\n\n`;
    out += `1. ¿Hay tareas mal definidas o demasiado vagas?\n`;
    out += `2. ¿Falta algo evidente para que el proyecto avance?\n`;
    out += `3. ¿Qué bloqueo es más urgente destrabar y cómo?\n`;
    out += `4. ¿Hay riesgo de scope creep o cosas fuera de objetivo?\n`;
    out += `5. Sugerí qué cortar, qué postergar y qué priorizar.\n`;
  }

  return out;
}

export function openPromptModal(projectId) {
  const text = generateProjectPrompt(projectId, S.promptStyle);
  openModal(`
    <div class="p-6 max-w-2xl">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xl font-semibold">Prompt para Claude</h2>
        <button onclick="closeModal()" class="text-gray-400 hover:text-gray-900">✕</button>
      </div>

      <div class="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 w-fit">
        <button onclick="promptStyle='organize'; openPromptModal('${projectId}')" class="px-3 py-1.5 rounded-md text-xs ${S.promptStyle==='organize'?'bg-white shadow-sm font-medium':''}">Organizar</button>
        <button onclick="promptStyle='execute'; openPromptModal('${projectId}')" class="px-3 py-1.5 rounded-md text-xs ${S.promptStyle==='execute'?'bg-white shadow-sm font-medium':''}">Resolver</button>
        <button onclick="promptStyle='review'; openPromptModal('${projectId}')" class="px-3 py-1.5 rounded-md text-xs ${S.promptStyle==='review'?'bg-white shadow-sm font-medium':''}">Revisar</button>
      </div>

      <p class="text-xs text-gray-500 mb-2">Editalo si querés antes de copiarlo.</p>
      <textarea id="promptText" class="input font-mono text-xs leading-relaxed" rows="18" style="white-space:pre">${escapeHtml(text)}</textarea>

      <div class="flex justify-end gap-2 mt-4">
        <a href="https://claude.ai/new" target="_blank" class="btn-ghost text-sm">Abrir Claude.ai ↗</a>
        <button onclick="copyPromptText()" id="copyPromptBtn" class="btn-primary">📋 Copiar</button>
      </div>
    </div>
  `);
}

export function copyPromptText() {
  const text = document.getElementById('promptText').value;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyPromptBtn');
    const original = btn.textContent;
    btn.textContent = '✓ Copiado';
    btn.classList.add('bg-green-600');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('bg-green-600');
    }, 1500);
  }).catch(() => {
    alert('No se pudo copiar. Seleccioná el texto y copialo manualmente.');
  });
}

// ---- Project modal ----
export function openProjectModal(id) {
  const p = id ? getProject(id) : { id: null, name: '', description: '', color: DEFAULT_PROJECT_COLOR, projectTypes: ['SYSTEM'], status: 'LEAD', startDate: todayISO(), endDate: '', budget: '', monthlyFee: '', monthlyFeeCurrency: S.state.defaultCurrency || 'ARS', clientId: '', contactName: '', contactEmail: '', contactPhone: '', systemUrl: '' };
  const pColor = p.color || DEFAULT_PROJECT_COLOR;
  const ptypes = getProjectTypes(p);
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar proyecto' : 'Nuevo proyecto'}</h2>
      <form onsubmit="saveProject(event)" class="space-y-3">
        <input type="hidden" name="id" value="${p.id || ''}" />
        <div>
          <label class="text-xs text-gray-500 mb-1 block">Tipo de proyecto <span class="text-gray-400">(podés elegir más de uno)</span></label>
          <div class="grid grid-cols-3 gap-2">
            ${PROJECT_TYPE_ORDER.map(k => {
              const t = PROJECT_TYPE[k];
              const checked = ptypes.includes(k);
              return `
                <label class="cursor-pointer">
                  <input type="checkbox" name="projectTypes" value="${k}" ${checked?'checked':''} class="peer sr-only" />
                  <span class="block p-3 rounded-lg border-2 border-gray-200 peer-checked:border-black peer-checked:bg-gray-50 hover:border-gray-400 transition text-center">
                    <div class="text-sm font-medium">${t.label}</div>
                    <div class="text-[10px] text-gray-500 mt-0.5">${t.hint}</div>
                  </span>
                </label>
              `;
            }).join('')}
          </div>
        </div>
        <div>
          <label class="text-xs text-gray-500">Nombre</label>
          <input name="name" class="input" required autofocus value="${escapeAttr(p.name)}" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Descripción</label>
          <textarea name="description" class="input" rows="2">${escapeHtml(p.description || '')}</textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label class="text-xs text-gray-500">Estado</label>
            <select name="status">
              ${PROJECT_STATUS_ORDER.map(k => `<option value="${k}" ${p.status===k?'selected':''}>${PROJECT_STATUS[k].label}</option>`).join('')}
            </select>
          </div>
          <div class="col-span-2">
            <label class="text-xs text-gray-500">Cliente <span class="text-gray-400">(para facturación)</span></label>
            <div class="flex gap-2">
              <select name="clientId" class="input flex-1">
                <option value="">— Sin cliente —</option>
                ${(S.state.clients||[]).map(c => `<option value="${c.id}" ${p.clientId===c.id?'selected':''}>${escapeHtml(clientLabel(c))}</option>`).join('')}
              </select>
              <button type="button" class="btn-ghost text-sm whitespace-nowrap" onclick="closeModal(); openClientModal();" title="Crear un cliente nuevo">+ Nuevo</button>
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-500">Contacto</label>
            <input name="contactName" class="input" value="${escapeAttr(p.contactName || '')}" placeholder="Nombre" />
          </div>
          <div>
            <label class="text-xs text-gray-500">WhatsApp</label>
            <input name="contactPhone" class="input" value="${escapeAttr(p.contactPhone || '')}" placeholder="+54 9 11 5555-5555" />
          </div>
          <div class="col-span-2">
            <label class="text-xs text-gray-500">Email contacto</label>
            <input type="email" name="contactEmail" class="input" value="${escapeAttr(p.contactEmail || '')}" />
          </div>
          <div class="col-span-2">
            <label class="text-xs text-gray-500">Link al sistema del cliente</label>
            <input type="url" name="systemUrl" class="input" value="${escapeAttr(p.systemUrl || '')}" placeholder="https://..." />
          </div>
          <div>
            <label class="text-xs text-gray-500">Inicio</label>
            <input type="date" name="startDate" class="input" value="${p.startDate || ''}" />
          </div>
          <div>
            <label class="text-xs text-gray-500">Fin</label>
            <input type="date" name="endDate" class="input" value="${p.endDate || ''}" />
          </div>
          <div>
            <label class="text-xs text-gray-500">Presupuesto total</label>
            <input type="number" name="budget" class="input" value="${p.budget || ''}" />
          </div>
          <div>
            <label class="text-xs text-gray-500">Mensualidad</label>
            <div class="flex gap-2 items-stretch">
              <input type="number" name="monthlyFee" class="input flex-1" value="${p.monthlyFee || ''}" placeholder="0" />
              <div class="flex gap-1 bg-gray-100 rounded-lg p-1">
                <label class="cursor-pointer">
                  <input type="radio" name="monthlyFeeCurrency" value="ARS" ${(p.monthlyFeeCurrency||'ARS')==='ARS'?'checked':''} class="peer sr-only" />
                  <span class="px-3 py-1.5 rounded-md text-sm font-medium block peer-checked:bg-white peer-checked:shadow-sm text-gray-600 peer-checked:text-black transition">ARS</span>
                </label>
                <label class="cursor-pointer">
                  <input type="radio" name="monthlyFeeCurrency" value="USD" ${p.monthlyFeeCurrency==='USD'?'checked':''} class="peer sr-only" />
                  <span class="px-3 py-1.5 rounded-md text-sm font-medium block peer-checked:bg-white peer-checked:shadow-sm text-gray-600 peer-checked:text-black transition">USD</span>
                </label>
              </div>
            </div>
            <p class="text-[11px] text-gray-400 mt-1">⚠ Si cobrás en dólares, elegí USD acá. Si no, los mensajes saldrán mal.</p>
          </div>
          <div class="col-span-2">
            <label class="text-xs text-gray-500 mb-1 block">Color</label>
            <div class="flex gap-2 flex-wrap">
              ${PROJECT_COLORS.map(c => `
                <label class="cursor-pointer" title="${c.name}">
                  <input type="radio" name="color" value="${c.value}" ${pColor===c.value?'checked':''} class="peer sr-only" />
                  <span class="block w-8 h-8 rounded-full transition peer-checked:ring-2 peer-checked:ring-offset-2 peer-checked:ring-black hover:scale-110" style="background:${c.value}"></span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
      </form>
    </div>
  `);
}

export function saveProject(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  data.budget     = data.budget     ? Number(data.budget)     : null;
  data.monthlyFee = data.monthlyFee ? Number(data.monthlyFee) : null;
  // Multi-select de tipos
  data.projectTypes = fd.getAll('projectTypes');
  if (data.projectTypes.length === 0) data.projectTypes = ['OTHER'];
  delete data.projectType;  // limpia campo legacy
  if (data.id) {
    Object.assign(getProject(data.id), data);
  } else {
    S.state.projects.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}

export function deleteProject(id) {
  const tasks = S.state.tasks.filter(t => t.projectId === id);
  if (tasks.length > 0 && !confirm(`Este proyecto tiene ${tasks.length} tareas asociadas. ¿Eliminar igual?`)) return;
  if (!confirm('¿Eliminar proyecto?')) return;
  S.state.projects = S.state.projects.filter(p => p.id !== id);
  S.state.tasks    = S.state.tasks.filter(t => t.projectId !== id);
  save(); closeModal(); render();
}
