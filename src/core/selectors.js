import { DOC_TYPE_LABELS } from './constants.js';
import { S } from './state.js';
import { sendNotificationEmail } from '../services/email.js';
import { escapeHtml, uid } from '../utils/helpers.js';

// ============ HELPERS ============
export function getProject(id) { return S.state.projects.find(p => p.id === id); }

export function getTask(id)    { return S.state.tasks.find(t => t.id === id); }

export function getMember(id)  { return S.state.members.find(m => m.id === id); }

export function getClient(id)  { return (S.state.clients || []).find(c => c.id === id); }

// Etiqueta corta del cliente: nombre + documento (si tiene).
export function clientLabel(c) {
  if (!c) return '';
  const dt = c.docType && c.docType !== '99' ? DOC_TYPE_LABELS[c.docType] || '' : '';
  return dt && c.docNumber ? `${c.name} · ${dt} ${c.docNumber}` : c.name;
}

export function currentMember(){ return getMember(S.currentMemberId) || S.state.members[0]; }

export function parseMentions(text) {
  const mentions = [];
  S.state.members.forEach(m => {
    const re = new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) mentions.push(m.id);
  });
  return mentions;
}

export function renderMentions(text) {
  let out = escapeHtml(text);
  S.state.members.forEach(m => {
    const re = new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(re, `<span class="bg-blue-50 text-blue-700 rounded px-1">@${escapeHtml(m.name)}</span>`);
  });
  return out;
}

export function unreadCount() {
  return S.state.notifications.filter(n => n.forMemberId === S.currentMemberId && !n.read).length;
}

export function projectProgress(pid) {
  const tasks = S.state.tasks.filter(t => t.projectId === pid);
  if (tasks.length === 0) return 0;
  return Math.round(tasks.filter(t => t.status === 'COMPLETED').length / tasks.length * 100);
}

export function pushHistory(taskId, action, from, to) {
  S.state.history.push({ id: uid(), taskId, action, from, to, createdAt: new Date().toISOString() });
}

export function notify(forMemberId, taskId, text) {
  if (!forMemberId || forMemberId === S.currentMemberId) return;
  S.state.notifications.push({
    id: uid(),
    forMemberId,
    fromMemberId: S.currentMemberId,
    taskId,
    text,
    read: false,
    createdAt: new Date().toISOString(),
  });
  // Send email if configured
  sendNotificationEmail(forMemberId, taskId, text);
}
