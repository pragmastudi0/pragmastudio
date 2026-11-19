import { currentMember } from '../core/selectors.js';
import { S } from '../core/state.js';
import { render, renderNav, showToast } from '../core/ui.js';
import { loadStateFromCloud, save, subscribeRealtime } from './cloud.js';
import { uid } from '../utils/helpers.js';

// ============ LOGIN (Supabase Auth) ============
// Mapeo email → datos del miembro. Si entra un email nuevo, se crea miembro genérico.
// Para agregar/cambiar: editá este mapeo y pusheá. El email debe coincidir EXACTO con el de Supabase Auth.
export const MEMBER_MAP = {
  'gonbenedetto1@gmail.com':  { memberId: 'me',      name: 'Gonzalo', color: '#3b82f6' },
  'gasparquintana00@gmail.com': { memberId: 'gaspar', name: 'Gaspar',  color: '#ec4899' },
  'faculamosimo@gmail.com':   { memberId: 'facundo', name: 'Facundo', color: '#10b981' },
};

export function getAuthUser() { return S._currentAuthUser; }

export function isLoggedIn() { return !!S._currentAuthUser; }

// Encuentra o crea el miembro local correspondiente al user de auth y setea currentMemberId
export function setMemberFromAuthUser(user) {
  if (!user || !user.email) return;
  const email = user.email.toLowerCase();
  // 1. Buscar miembro existente con ese email
  let member = S.state.members.find(m => (m.email || '').toLowerCase() === email);
  if (!member) {
    // 2. Mapeo predefinido
    const def = MEMBER_MAP[email];
    if (def) {
      member = S.state.members.find(m => m.id === def.memberId);
      if (member) {
        if (!member.email) { member.email = email; save(); }
      } else {
        member = { id: def.memberId, name: def.name, color: def.color, email };
        S.state.members.push(member); save();
      }
    } else {
      // 3. Miembro genérico
      member = { id: uid(), name: email.split('@')[0], color: '#6b7280', email };
      S.state.members.push(member); save();
    }
  }
  S.currentMemberId = member.id;
  localStorage.setItem('pragma_current_member', member.id);
}

export async function attemptLogin(email, password) {
  if (!S.sb) return { ok: false, error: 'Conexión a Supabase no disponible' };
  const { data, error } = await S.sb.auth.signInWithPassword({ email: (email||'').trim(), password });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('invalid')) return { ok: false, error: 'Email o contraseña incorrectos' };
    if (msg.includes('email not confirmed')) return { ok: false, error: 'Email no confirmado en Supabase' };
    return { ok: false, error: error.message };
  }
  S._currentAuthUser = data.user;
  return { ok: true };
}

export async function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  try { await S.sb?.auth.signOut(); } catch (e) {}
  S._currentAuthUser = null;
  localStorage.removeItem('pragma_current_member');
  location.reload();
}

export function renderLoginOverlay() {
  const overlay = document.getElementById('loginOverlay');
  if (!overlay) return;
  if (isLoggedIn()) { overlay.classList.add('hidden'); return; }
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8 fade-in">
      <div class="flex flex-col items-center mb-6">
        <img src="favicon.png" class="w-16 h-16 rounded-2xl mb-3" />
        <h1 class="text-xl font-semibold">Pragma Studio</h1>
        <p class="text-sm text-gray-500">Gestión de proyectos</p>
      </div>
      <form onsubmit="handleLogin(event)" class="space-y-3">
        <div>
          <label class="text-xs text-gray-500">Email</label>
          <input id="loginUser" type="email" name="email" class="input" required autofocus autocomplete="username" placeholder="tu@pragmastudio.com.ar" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Contraseña</label>
          <input type="password" name="password" class="input" required autocomplete="current-password" />
        </div>
        <div id="loginError" class="text-xs text-red-600 min-h-[16px]"></div>
        <button type="submit" class="btn-primary w-full" id="loginSubmitBtn">Ingresar</button>
      </form>
    </div>
  `;
  setTimeout(() => document.getElementById('loginUser')?.focus(), 50);
}

export async function handleLogin(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginSubmitBtn');
  errEl.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Ingresando...'; }
  const result = await attemptLogin(fd.get('email'), fd.get('password'));
  if (!result.ok) {
    errEl.textContent = result.error;
    if (btn) { btn.disabled = false; btn.textContent = 'Ingresar'; }
    return;
  }
  // Login OK
  setMemberFromAuthUser(S._currentAuthUser);
  document.getElementById('loginOverlay').classList.add('hidden');
  // Ahora que estamos autenticados, cargar el state y suscribir realtime
  try {
    await loadStateFromCloud();
    subscribeRealtime();
  } catch (err) {
    showToast('Error al cargar datos: ' + (err.message||err), 'info', 5000);
  }
  renderNav();
  render();
  showToast(`Hola ${currentMember()?.name || ''}`, 'success', 2500);
}
