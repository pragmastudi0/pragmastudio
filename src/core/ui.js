import { NAV } from './constants.js';
import { currentMember, unreadCount } from './selectors.js';
import { S } from './state.js';
import { renderBudgets } from '../modules/budgets_ui.js';
import { renderDocuments, renderResources } from '../modules/documents.js';
import { renderFinance } from '../modules/finance.js';
import { renderGuide } from '../modules/guide.js';
import { renderClients } from '../modules/invoices.js';
import { renderProjects } from '../modules/projects.js';
import { renderReports } from '../modules/reports.js';
import { renderTasks } from '../modules/tasks.js';
import { renderTeam } from '../modules/team.js';
import { escapeHtml } from '../utils/helpers.js';

// ---- Toast helper ----
export function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="text-lg flex-shrink-0">${type === 'success' ? '✓' : type === 'info' ? '🔔' : '!'}</span>
    <span class="text-sm flex-1">${escapeHtml(message)}</span>
  `;
  toast.onclick = () => toast.remove();
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s, transform .3s';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map(n => `
    <div class="nav-item ${S.currentView === n.key ? 'active' : ''}" onclick="go('${n.key}')">
      <span class="w-5 text-center opacity-70">${n.icon}</span>
      <span>${n.label}</span>
    </div>
  `).join('');
  const me = currentMember();
  document.getElementById('userInfo').innerHTML = `
    <button onclick="openMemberPicker()" class="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 transition">
      <span class="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold" style="background:${me?.color || '#666'}">${(me?.name || '?')[0]}</span>
      <span class="text-sm font-medium">${me?.name || 'Sin usuario'}</span>
    </button>
  `;
  // Bell badge
  const c = unreadCount();
  const badge = document.getElementById('bellBadge');
  if (c > 0) { badge.classList.remove('hidden'); badge.textContent = c > 9 ? '9+' : c; }
  else { badge.classList.add('hidden'); }
}

export function go(view) {
  S.currentView = view;
  S.currentTaskId = null;
  renderNav();
  render();
  closeSidebar();
}

export function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}

export function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

// ============ RENDER DISPATCH ============
export function render() {
  const main = document.getElementById('main');
  const views = {
    tasks: renderTasks,
    projects: renderProjects,
    clients: renderClients,
    budgets: renderBudgets,
    finance: renderFinance,
    reports: renderReports,
    documents: renderDocuments,
    resources: renderResources,
    team: renderTeam,
    guide: renderGuide,
  };
  main.innerHTML = views[S.currentView]();
  attachViewEvents();
}

// ============ HEADER TEMPLATE ============
export function viewHeader(title, subtitle, actions = '') {
  return `
    <div class="px-4 md:px-10 pt-8 md:pt-10 pb-4 md:pb-6 flex items-end justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">${title}</h1>
        ${subtitle ? `<p class="text-gray-500 mt-1 text-sm">${subtitle}</p>` : ''}
      </div>
      <div class="flex gap-2 flex-wrap items-center">${actions}</div>
    </div>
  `;
}

// ============ MODALS ============
export function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
}

export function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal').classList.remove('flex');
}

export function attachViewEvents() {}
