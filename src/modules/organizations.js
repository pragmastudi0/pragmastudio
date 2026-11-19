import { RPC_CREATE_ORG } from '../core/db.js';
import { S } from '../core/state.js';
import { closeModal, openModal, showToast } from '../core/ui.js';
import { escapeHtml } from '../utils/helpers.js';
import { continueWithOrg, fetchMemberships, setActiveOrg } from '../services/cloud.js';

// ============ ORGANIZACIONES (Fase 1 SaaS) ============
// Resolución de la organización activa + onboarding + selector. La identidad de
// miembro dentro de cada organización sigue viviendo en el documento por-org.

function orgName(m) { return m?.organizations?.name || m?.org_id || 'Organización'; }

// Decide la organización activa. Devuelve el org_id, o null si mostró UI
// (onboarding / selector) y el flujo continúa por un handler.
export async function resolveActiveOrg() {
  const ms = S.memberships || [];
  if (ms.length === 0) { openOnboarding(); return null; }
  let stored = null;
  try { stored = localStorage.getItem('ps_active_org'); } catch {}
  if (stored && ms.some(m => m.org_id === stored)) return stored;
  if (ms.length === 1) return ms[0].org_id;
  openOrgPicker();
  return null;
}

export function renderOrgChip() {
  const el = document.getElementById('orgChip');
  if (!el) return;
  const name = orgName(S.activeMembership);
  const switchable = (S.memberships || []).length > 1;
  el.innerHTML = `
    <button onclick="openOrgSwitcher()" class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition text-left" title="Organización activa">
      <span class="flex items-center gap-2 min-w-0">
        <span class="w-5 h-5 rounded-md bg-gray-900 text-white text-[11px] font-semibold flex items-center justify-center">${escapeHtml((name[0] || '?').toUpperCase())}</span>
        <span class="text-sm font-medium truncate">${escapeHtml(name)}</span>
      </span>
      ${switchable ? '<span class="text-[11px] text-gray-400">cambiar</span>' : ''}
    </button>`;
}

export function openOrgSwitcher() {
  const ms = S.memberships || [];
  if (ms.length <= 1) return openOnboarding(ms.length === 0);
  openOrgPicker();
}

export function openOrgPicker() {
  const ms = S.memberships || [];
  const rows = ms.map(m => `
    <button onclick="psSelectOrg('${escapeHtml(m.org_id)}')" class="w-full flex items-center justify-between gap-2 p-3 rounded-xl border border-gray-200 hover:border-gray-900 transition text-left">
      <span class="flex items-center gap-2">
        <span class="w-7 h-7 rounded-lg bg-gray-900 text-white text-xs font-semibold flex items-center justify-center">${escapeHtml((orgName(m)[0] || '?').toUpperCase())}</span>
        <span>
          <span class="block text-sm font-medium">${escapeHtml(orgName(m))}</span>
          <span class="block text-[11px] text-gray-500">${escapeHtml(m.role || '')}</span>
        </span>
      </span>
      ${m.org_id === S.activeOrgId ? '<span class="chip">activa</span>' : ''}
    </button>`).join('');
  openModal(`
    <div class="p-6">
      <h2 class="text-lg font-semibold mb-1">Elegí una organización</h2>
      <p class="text-sm text-gray-500 mb-4">Tus datos están aislados por organización.</p>
      <div class="space-y-2">${rows}</div>
      <div class="pt-4 mt-4 border-t border-gray-100">
        <button onclick="openOrgOnboarding()" class="btn-ghost text-sm">+ Crear nueva organización</button>
      </div>
    </div>`);
}

export function openOnboarding(forced = true) {
  openModal(`
    <div class="p-6">
      <h2 class="text-lg font-semibold mb-1">${forced ? 'Creá tu organización' : 'Nueva organización'}</h2>
      <p class="text-sm text-gray-500 mb-4">Es el espacio aislado de tu empresa: clientes, finanzas y facturación propios.</p>
      <form onsubmit="psCreateOrg(event)" class="space-y-3">
        <div>
          <label class="text-xs text-gray-500">Nombre de la empresa</label>
          <input id="newOrgName" class="input" required autofocus placeholder="Mi Empresa S.A." />
        </div>
        <div class="flex justify-end gap-2 pt-2">
          ${forced ? '' : '<button type="button" onclick="closeModal()" class="btn-ghost text-sm">Cancelar</button>'}
          <button type="submit" class="btn-primary" id="newOrgBtn">Crear organización</button>
        </div>
      </form>
    </div>`);
}

function slugify(name) {
  const base = (name || 'org').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function psCreateOrg(e) {
  if (e && e.preventDefault) e.preventDefault();
  const name = (document.getElementById('newOrgName')?.value || '').trim();
  if (!name) return;
  const btn = document.getElementById('newOrgBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creando...'; }
  try {
    const { data, error } = await S.sb.rpc(RPC_CREATE_ORG, { p_name: name, p_slug: slugify(name) });
    if (error) throw error;
    const newOrgId = data; // el RPC devuelve el uuid de la organización
    await fetchMemberships();
    setActiveOrg(newOrgId);
    closeModal();
    await continueWithOrg(newOrgId);
    showToast('Organización creada', 'success', 2500);
  } catch (err) {
    showToast('No se pudo crear la organización: ' + (err.message || err), 'info', 5000);
    if (btn) { btn.disabled = false; btn.textContent = 'Crear organización'; }
  }
}

export async function psSelectOrg(orgId) {
  closeModal();
  await continueWithOrg(orgId);
  renderOrgChip();
}
