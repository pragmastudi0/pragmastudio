import { CLIENT_ID, DEFAULT_STATE, S } from '../core/state.js';
import { render, renderNav, showToast } from '../core/ui.js';
import { isLoggedIn, renderLoginOverlay, setMemberFromAuthUser } from './auth.js';

// ============ CLOUD SYNC (Supabase) ============
export const SUPABASE_URL = 'https://vvstklprisbqngocgsal.supabase.co';

export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2c3RrbHByaXNicW5nb2Nnc2FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTQyNzEsImV4cCI6MjA5MjIzMDI3MX0.Q7LywZvDUQh6g-EpuX3_rXmiygwP8rlOD_KmIR9eze8';

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

    // Check existing Supabase Auth session
    const { data: { session } } = await S.sb.auth.getSession();
    if (session?.user) {
      S._currentAuthUser = session.user;
      setMemberFromAuthUser(session.user);
    }

    // Listen for auth state changes (login, logout, expiry)
    S.sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        S._currentAuthUser = null;
        if (event === 'SIGNED_OUT') {
          showToast('Sesión cerrada', 'info', 2000);
          setTimeout(() => location.reload(), 800);
        }
      } else if (event === 'SIGNED_IN' && session?.user) {
        S._currentAuthUser = session.user;
        setMemberFromAuthUser(session.user);
      } else if (event === 'USER_DELETED' || event === 'USER_UPDATED') {
        location.reload();
      }
    });

    if (!isLoggedIn()) {
      // No hay sesión — mostrar overlay de login y no intentar fetch (RLS bloquea)
      renderLoginOverlay();
      setSyncStatus('Esperando login', '#fbbf24');
      return;
    }

    await loadStateFromCloud();
    subscribeRealtime();
  } catch (err) {
    console.error('Supabase init error:', err);
    setSyncStatus('Error de conexión', '#ef4444');
    if (err.message && err.message.toLowerCase().includes('row-level security')) {
      // No autenticado — mostrar login
      renderLoginOverlay();
      return;
    }
    alert('Error al conectar con Supabase:\n\n' + (err.message || err));
  }
}

export async function loadStateFromCloud() {
  if (!S.sb) return;
  setSyncStatus('Cargando...', '#fbbf24');
  const { data, error } = await S.sb.from('pragma_state').select('*').eq('id', 'main').maybeSingle();
  if (error) {
    setSyncStatus('Error de carga', '#ef4444');
    throw error;
  }
  if (data && data.data) {
    S.state = { ...structuredClone(DEFAULT_STATE), ...data.data };
    localStorage.setItem('pragma_state', JSON.stringify(S.state));
    // Re-resolver member ahora que tenemos members frescos del cloud
    if (S._currentAuthUser) setMemberFromAuthUser(S._currentAuthUser);
  } else {
    // First-time: push local state
    await S.sb.from('pragma_state').upsert({ id: 'main', data: S.state, writer: CLIENT_ID });
  }
  S.cloudReady = true;
  setSyncStatus('Sincronizado', '#22c55e');
}

export function subscribeRealtime() {
  if (!S.sb || S.sbChannel) return;
  S.sbChannel = S.sb.channel('pragma-state-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'pragma_state', filter: 'id=eq.main' },
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
  if (!S.sb || !S.cloudReady) return;
  clearTimeout(S.saveTimer);
  setSyncStatus('Guardando...', '#fbbf24');
  S.saveTimer = setTimeout(async () => {
    try {
      const { error } = await S.sb.from('pragma_state').upsert({
        id: 'main',
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
