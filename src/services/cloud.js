import { TABLES } from '../core/db.js';
import { CLIENT_ID, DEFAULT_STATE, S } from '../core/state.js';
import { render, renderNav, showToast } from '../core/ui.js';
import { isLoggedIn, renderLoginOverlay, setMemberFromAuthUser } from './auth.js';
import { renderOrgChip, resolveActiveOrg } from '../modules/organizations.js';

// ============ CLOUD SYNC (Supabase, multiempresa — Fase 1) ============
// Config por variables de entorno (Vite). La anon key ya NO se commitea.
// Fallback: configuración local pegada en el setupOverlay.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export function getSupabaseConfig() {
  if (SUPABASE_URL && SUPABASE_KEY) return { url: SUPABASE_URL, key: SUPABASE_KEY };
  try {
    const raw = localStorage.getItem('pragma_supabase_config');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setSyncStatus(text, color) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.innerHTML = `<span class="w-1.5 h-1.5 rounded-full" style="background:${color}"></span><span>${text}</span>`;
}

export async function initSupabase() {
  const config = getSupabaseConfig();
  if (!config) {
    document.getElementById('setupOverlay').classList.remove('hidden');
    setSyncStatus('Solo local', '#999');
    return;
  }
  try {
    S.sb = supabase.createClient(config.url, config.key);
    setSyncStatus('Conectando...', '#fbbf24');

    const { data: { session } } = await S.sb.auth.getSession();
    if (session?.user) {
      S._currentAuthUser = session.user;
    }

    S.sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        S._currentAuthUser = null;
        if (event === 'SIGNED_OUT') {
          showToast('Sesión cerrada', 'info', 2000);
          setTimeout(() => location.reload(), 800);
        }
      } else if (event === 'SIGNED_IN' && session?.user) {
        S._currentAuthUser = session.user;
      } else if (event === 'USER_DELETED' || event === 'USER_UPDATED') {
        location.reload();
      }
    });

    if (!isLoggedIn()) {
      // Sin sesión — mostrar login y no intentar fetch (RLS bloquea).
      renderLoginOverlay();
      setSyncStatus('Esperando login', '#fbbf24');
      return;
    }

    await bootstrapAfterAuth();
  } catch (err) {
    console.error('Supabase init error:', err);
    setSyncStatus('Error de conexión', '#ef4444');
    if (err.message && err.message.toLowerCase().includes('row-level security')) {
      renderLoginOverlay();
      return;
    }
    alert('Error al conectar con Supabase:\n\n' + (err.message || err));
  }
}

// ============ TENENCIA ============
// Carga las membresías del usuario autenticado (qué organizaciones puede usar).
export async function fetchMemberships() {
  if (!S.sb || !S._currentAuthUser) { S.memberships = []; return []; }
  const { data, error } = await S.sb
    .from(TABLES.memberships)
    .select('org_id, role, legacy_member_id, display_name, color, organizations:' + TABLES.organizations + '(name, slug)')
    .eq('user_id', S._currentAuthUser.id);
  if (error) { console.error('fetchMemberships:', error); S.memberships = []; return []; }
  S.memberships = data || [];
  return S.memberships;
}

export function setActiveOrg(orgId) {
  S.activeOrgId = orgId;
  S.activeMembership = (S.memberships || []).find(m => m.org_id === orgId) || null;
  try { localStorage.setItem('ps_active_org', orgId); } catch {}
}

// Orquesta el arranque post-login: membresías → organización activa → estado.
export async function bootstrapAfterAuth() {
  if (!S.sb || !S._currentAuthUser) return;
  await fetchMemberships();
  const orgId = await resolveActiveOrg();   // puede mostrar onboarding/selector y devolver null
  if (!orgId) return;                       // la UI continuará vía continueWithOrg()
  await continueWithOrg(orgId);
}

// Fija la organización y carga su documento + realtime + identidad.
export async function continueWithOrg(orgId) {
  setActiveOrg(orgId);
  await loadStateFromCloud();
  subscribeRealtime();
  setMemberFromAuthUser(S._currentAuthUser);
  renderOrgChip();
  renderNav();
  render();
}

export async function loadStateFromCloud() {
  if (!S.sb || !S.activeOrgId) return;
  setSyncStatus('Cargando...', '#fbbf24');
  const { data, error } = await S.sb.from(TABLES.orgState).select('*').eq('org_id', S.activeOrgId).maybeSingle();
  if (error) {
    setSyncStatus('Error de carga', '#ef4444');
    throw error;
  }
  if (data && data.data) {
    S.state = { ...structuredClone(DEFAULT_STATE), ...data.data };
    localStorage.setItem('pragma_state', JSON.stringify(S.state));
    if (S._currentAuthUser) setMemberFromAuthUser(S._currentAuthUser);
  } else {
    // Organización nueva sin documento: inicializar con el estado por defecto.
    S.state = structuredClone(DEFAULT_STATE);
    localStorage.setItem('pragma_state', JSON.stringify(S.state));
    await S.sb.from(TABLES.orgState).upsert({ org_id: S.activeOrgId, data: S.state, writer: CLIENT_ID });
  }
  S.cloudReady = true;
  setSyncStatus('Sincronizado', '#22c55e');
}

export function subscribeRealtime() {
  if (!S.sb || S.sbChannel || !S.activeOrgId) return;
  S.sbChannel = S.sb.channel('ps-org-state-' + S.activeOrgId)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: TABLES.orgState, filter: `org_id=eq.${S.activeOrgId}` },
      (payload) => {
        const newRow = payload.new;
        if (!newRow || newRow.writer === CLIENT_ID) return;
        const prevNotifIds = new Set((S.state.notifications || []).map(n => n.id));
        S.state = { ...structuredClone(DEFAULT_STATE), ...newRow.data };
        localStorage.setItem('pragma_state', JSON.stringify(S.state));
        setSyncStatus('Sincronizado', '#22c55e');
        (S.state.notifications || []).forEach(n => {
          if (!prevNotifIds.has(n.id) && n.forMemberId === S.currentMemberId && !n.read) {
            showToast(n.text, 'info', 5000);
          }
        });
        renderNav();
        render();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') setSyncStatus('Sincronizado', '#22c55e');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncStatus('Sin tiempo real', '#fbbf24');
    });
}

export function save() {
  localStorage.setItem('pragma_state', JSON.stringify(S.state));
  if (!S.sb || !S.cloudReady || !S.activeOrgId) return;
  clearTimeout(S.saveTimer);
  setSyncStatus('Guardando...', '#fbbf24');
  S.saveTimer = setTimeout(async () => {
    try {
      const { error } = await S.sb.from(TABLES.orgState).upsert({
        org_id: S.activeOrgId,
        data: S.state,
        writer: CLIENT_ID,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setSyncStatus('Sincronizado', '#22c55e');
    } catch (err) {
      console.error('Save error:', err);
      setSyncStatus('Error al guardar', '#ef4444');
    }
  }, 500);
}

export function saveSupabaseConfig(e) {
  e.preventDefault();
  const url = document.getElementById('sbUrlInput').value.trim().replace(/\/$/, '');
  const key = document.getElementById('sbKeyInput').value.trim();
  if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
    alert('La URL debe ser tipo https://xxxxxx.supabase.co');
    return;
  }
  if (key.length < 20) {
    alert('La key parece incompleta.');
    return;
  }
  localStorage.setItem('pragma_supabase_config', JSON.stringify({ url, key }));
  document.getElementById('setupOverlay').classList.add('hidden');
  initSupabase();
}

export function skipSetup() {
  localStorage.setItem('pragma_cloud_skip', '1');
  document.getElementById('setupOverlay').classList.add('hidden');
  setSyncStatus('Solo local', '#999');
}

export function reconfigureCloud() {
  if (!confirm('Esto te va a pedir la config de Supabase de nuevo. ¿Seguir?')) return;
  localStorage.removeItem('pragma_supabase_config');
  localStorage.removeItem('pragma_cloud_skip');
  location.reload();
}
