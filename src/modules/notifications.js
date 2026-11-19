import { getMember } from '../core/selectors.js';
import { S } from '../core/state.js';
import { renderNav } from '../core/ui.js';
import { openTaskDetail } from './tasks.js';
import { save } from '../services/cloud.js';
import { escapeHtml } from '../utils/helpers.js';

// ============ NOTIFICATIONS PANEL ============
export function toggleNotifications() {
  const panel = document.getElementById('notifPanel');
  if (panel.classList.contains('hidden')) {
    renderNotifications();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

export function closeNotifications() {
  document.getElementById('notifPanel').classList.add('hidden');
}

export function renderNotifications() {
  const list = document.getElementById('notifList');
  const mine = S.state.notifications
    .filter(n => n.forMemberId === S.currentMemberId)
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  if (mine.length === 0) {
    list.innerHTML = `<div class="p-8 text-center text-gray-400 text-sm">Sin notificaciones.</div>`;
    return;
  }
  list.innerHTML = mine.map(n => {
    const from = getMember(n.fromMemberId);
    return `
      <div class="p-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${n.read?'':'bg-blue-50'}" onclick="openNotification('${n.id}')">
        <div class="flex items-start gap-2">
          ${from ? `<span class="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0" style="background:${from.color}">${escapeHtml(from.name[0])}</span>` : ''}
          <div class="flex-1 min-w-0">
            <div class="text-sm ${n.read?'text-gray-600':'font-medium'}">${escapeHtml(n.text)}</div>
            <div class="text-[11px] text-gray-500 mt-0.5">${new Date(n.createdAt).toLocaleString('es-AR')}</div>
          </div>
          ${n.read?'':'<span class="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-2"></span>'}
        </div>
      </div>
    `;
  }).join('');
}

export function openNotification(id) {
  const n = S.state.notifications.find(x => x.id === id);
  if (!n) return;
  n.read = true;
  save();
  closeNotifications();
  renderNav();
  if (n.taskId) openTaskDetail(n.taskId);
}

export function markAllRead() {
  S.state.notifications.forEach(n => { if (n.forMemberId === S.currentMemberId) n.read = true; });
  save();
  renderNav();
  renderNotifications();
}
