// ============ STATE ============
const DEFAULT_STATE = {
  user: { name: "Gonzalo" },
  members: [{ id: 'me', name: 'Gonzalo', color: '#3b82f6' }],
  projects: [],
  tasks: [],
  incomes: [],
  expenses: [],
  comments: [],       // { id, taskId, authorId, content, mentions: [memberId], createdAt }
  history: [],        // { id, taskId, action, from, to, createdAt }
  notifications: [],  // { id, forMemberId, fromMemberId, taskId, text, read, createdAt }
  documents: [],      // { id, title, url, category, description, createdAt }
  resources: [],      // { id, title, url, category, description, createdAt }
  emailConfig: { enabled: false, serviceId: '', templateId: '', publicKey: '' },
  recurringChargeLog: [],         // { id, projectId, month, amount?, chargedAt, chargedBy, exchangeRate, note }
  recurringExpensePayments: [],   // { id, expenseId, month, amount?, paidAt, paidBy, exchangeRate, note }
  incomePayments: [],             // { id, incomeId, amount, date, paidAt, paidBy, exchangeRate, note }
  expensePayments: [],            // { id, expenseId, amount, date, paidAt, paidBy, exchangeRate, note }
  pragmaPhone: '',
  paymentMessageTemplate: 'Hola {name}! 👋\n\nTe paso el recordatorio del pago mensual del proyecto *{project}* correspondiente a {month}.\n\nMonto: {amount}\n\n¡Gracias!\nPragma Studio',
  defaultCurrency: 'ARS',
  exchangeRate: 1200,             // ARS por USD
  exchangeRateSource: 'manual',   // 'manual' | 'blue' | 'oficial' | 'mep' | 'cripto' | 'tarjeta'
  exchangeRateUpdatedAt: null,
  budgets: [],                    // Presupuestos: { id, code, clientName, category, pricingModel, currency, status, items, riskFactors, contingencyPct, ... }
  invoices: [],                   // Facturas AFIP: { id, incomeId, projectId, cae, number, ptoVta, cbteTipo, typeName, date, amount, currency, clientName, clientDocType, clientDocNumber, issuedAt, issuedBy }
  clients: [],                    // Clientes (datos fiscales): { id, name, docType, docNumber, condicionIVA, notes }
};

// Constantes genéricas (enums/display) extraídas a src/core/constants.js (refactor modular).
import {
  STATUS, STATUS_ORDER, PRIORITY, INCOME_STATUS, EXPENSE_STATUS, EXPENSE_CAT,
  PROJECT_STATUS, PROJECT_STATUS_ORDER, PROJECT_TYPE, PROJECT_TYPE_ORDER,
  PROJECT_COLORS, DEFAULT_PROJECT_COLOR, DOC_CATEGORIES, RES_CATEGORIES, NAV,
  MONTH_NAMES_SHORT, MONTH_NAMES_FULL, CLIENT_DOC_TYPES, DOC_TYPE_LABELS, CONDICION_IVA,
} from '../core/constants.js';

// Servicios (capa services/) — reciben sus dependencias vía init…() en el BOOT.
import {
  DOLAR_SOURCES, fetchBluelyticsBlue, autoFetchBlueIfStale, fetchDollarRate, initExchange,
} from '../services/exchange.js';
import { sendNotificationEmail, testEmail, initEmail } from '../services/email.js';

// Identidad local (no se sincroniza — cada dispositivo/persona tiene la suya)
let currentMemberId = localStorage.getItem('pragma_current_member') || 'me';

// ============ LOGIN (Supabase Auth) ============
// Mapeo email → datos del miembro. Si entra un email nuevo, se crea miembro genérico.
// Para agregar/cambiar: editá este mapeo y pusheá. El email debe coincidir EXACTO con el de Supabase Auth.
const MEMBER_MAP = {
  'gonbenedetto1@gmail.com':  { memberId: 'me',      name: 'Gonzalo', color: '#3b82f6' },
  'gasparquintana00@gmail.com': { memberId: 'gaspar', name: 'Gaspar',  color: '#ec4899' },
  'faculamosimo@gmail.com':   { memberId: 'facundo', name: 'Facundo', color: '#10b981' },
};

let _currentAuthUser = null;  // user de Supabase Auth

function getAuthUser() { return _currentAuthUser; }
function isLoggedIn() { return !!_currentAuthUser; }

// Encuentra o crea el miembro local correspondiente al user de auth y setea currentMemberId
function setMemberFromAuthUser(user) {
  if (!user || !user.email) return;
  const email = user.email.toLowerCase();
  // 1. Buscar miembro existente con ese email
  let member = state.members.find(m => (m.email || '').toLowerCase() === email);
  if (!member) {
    // 2. Mapeo predefinido
    const def = MEMBER_MAP[email];
    if (def) {
      member = state.members.find(m => m.id === def.memberId);
      if (member) {
        if (!member.email) { member.email = email; save(); }
      } else {
        member = { id: def.memberId, name: def.name, color: def.color, email };
        state.members.push(member); save();
      }
    } else {
      // 3. Miembro genérico
      member = { id: uid(), name: email.split('@')[0], color: '#6b7280', email };
      state.members.push(member); save();
    }
  }
  currentMemberId = member.id;
  localStorage.setItem('pragma_current_member', member.id);
}

async function attemptLogin(email, password) {
  if (!sb) return { ok: false, error: 'Conexión a Supabase no disponible' };
  const { data, error } = await sb.auth.signInWithPassword({ email: (email||'').trim(), password });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('invalid')) return { ok: false, error: 'Email o contraseña incorrectos' };
    if (msg.includes('email not confirmed')) return { ok: false, error: 'Email no confirmado en Supabase' };
    return { ok: false, error: error.message };
  }
  _currentAuthUser = data.user;
  return { ok: true };
}

async function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  try { await sb?.auth.signOut(); } catch (e) {}
  _currentAuthUser = null;
  localStorage.removeItem('pragma_current_member');
  location.reload();
}

function renderLoginOverlay() {
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

async function handleLogin(e) {
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
  setMemberFromAuthUser(_currentAuthUser);
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

let state = load();
let currentView = 'tasks';
let currentTaskId = null;

function load() {
  try {
    const raw = localStorage.getItem('pragma_state');
    if (!raw) return structuredClone(DEFAULT_STATE);
    return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
  } catch { return structuredClone(DEFAULT_STATE); }
}

// ============ CLOUD SYNC (Supabase) ============
const SUPABASE_URL = 'https://vvstklprisbqngocgsal.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2c3RrbHByaXNicW5nb2Nnc2FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTQyNzEsImV4cCI6MjA5MjIzMDI3MX0.Q7LywZvDUQh6g-EpuX3_rXmiygwP8rlOD_KmIR9eze8';

let sb = null;
let sbChannel = null;
let cloudReady = false;
let saveTimer = null;
const CLIENT_ID = (() => {
  let id = localStorage.getItem('pragma_client_id');
  if (!id) { id = Math.random().toString(36).slice(2); localStorage.setItem('pragma_client_id', id); }
  return id;
})();

function getSupabaseConfig() {
  if (SUPABASE_URL && SUPABASE_KEY) return { url: SUPABASE_URL, key: SUPABASE_KEY };
  try {
    const raw = localStorage.getItem('pragma_supabase_config');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSyncStatus(text, color) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.innerHTML = `<span class="w-1.5 h-1.5 rounded-full" style="background:${color}"></span><span>${text}</span>`;
}

async function initSupabase() {
  const config = getSupabaseConfig();
  if (!config) {
    document.getElementById('setupOverlay').classList.remove('hidden');
    setSyncStatus('Solo local', '#999');
    return;
  }
  try {
    sb = supabase.createClient(config.url, config.key);
    setSyncStatus('Conectando...', '#fbbf24');

    // Check existing Supabase Auth session
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      _currentAuthUser = session.user;
      setMemberFromAuthUser(session.user);
    }

    // Listen for auth state changes (login, logout, expiry)
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        _currentAuthUser = null;
        if (event === 'SIGNED_OUT') {
          showToast('Sesión cerrada', 'info', 2000);
          setTimeout(() => location.reload(), 800);
        }
      } else if (event === 'SIGNED_IN' && session?.user) {
        _currentAuthUser = session.user;
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

async function loadStateFromCloud() {
  if (!sb) return;
  setSyncStatus('Cargando...', '#fbbf24');
  const { data, error } = await sb.from('pragma_state').select('*').eq('id', 'main').maybeSingle();
  if (error) {
    setSyncStatus('Error de carga', '#ef4444');
    throw error;
  }
  if (data && data.data) {
    state = { ...structuredClone(DEFAULT_STATE), ...data.data };
    localStorage.setItem('pragma_state', JSON.stringify(state));
    // Re-resolver member ahora que tenemos members frescos del cloud
    if (_currentAuthUser) setMemberFromAuthUser(_currentAuthUser);
  } else {
    // First-time: push local state
    await sb.from('pragma_state').upsert({ id: 'main', data: state, writer: CLIENT_ID });
  }
  cloudReady = true;
  setSyncStatus('Sincronizado', '#22c55e');
}

function subscribeRealtime() {
  if (!sb || sbChannel) return;
  sbChannel = sb.channel('pragma-state-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'pragma_state', filter: 'id=eq.main' },
      (payload) => {
        const newRow = payload.new;
        if (!newRow || newRow.writer === CLIENT_ID) return;
        const prevNotifIds = new Set((state.notifications || []).map(n => n.id));
        state = { ...structuredClone(DEFAULT_STATE), ...newRow.data };
        localStorage.setItem('pragma_state', JSON.stringify(state));
        setSyncStatus('Sincronizado', '#22c55e');
        (state.notifications || []).forEach(n => {
          if (!prevNotifIds.has(n.id) && n.forMemberId === currentMemberId && !n.read) {
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

function save() {
  localStorage.setItem('pragma_state', JSON.stringify(state));
  if (!sb || !cloudReady) return;
  clearTimeout(saveTimer);
  setSyncStatus('Guardando...', '#fbbf24');
  saveTimer = setTimeout(async () => {
    try {
      const { error } = await sb.from('pragma_state').upsert({
        id: 'main',
        data: state,
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

function saveSupabaseConfig(e) {
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

function skipSetup() {
  localStorage.setItem('pragma_cloud_skip', '1');
  document.getElementById('setupOverlay').classList.add('hidden');
  setSyncStatus('Solo local', '#999');
}

function reconfigureCloud() {
  if (!confirm('Esto te va a pedir la config de Supabase de nuevo. ¿Seguir?')) return;
  localStorage.removeItem('pragma_supabase_config');
  localStorage.removeItem('pragma_cloud_skip');
  location.reload();
}
// Helpers puros extraídos a src/utils/helpers.js (refactor modular).
import {
  uid, fmt, fmtMoney, todayISO, daysBetween,
  lastDayOfMonth, monthsBetween, prevMonthKey, escapeHtml, escapeAttr,
} from '../utils/helpers.js';

// ============ CONSTANTS ============
// STATUS, STATUS_ORDER, PRIORITY, EXPENSE_CAT, PROJECT_STATUS(_ORDER) → src/core/constants.js (importados arriba).

// ============ PRESUPUESTOS ============
// Constantes y motor de estimación extraídos a src/modules/budgets/ (refactor modular).
// Reexportados a window más abajo si algún handler inline los necesitara (no es el caso hoy).
import {
  BUDGET_STATUS, BUDGET_STATUS_ORDER, BUDGET_CATEGORIES, PRICING_MODELS,
  COMMON_MODULES_BY_CATEGORY, COMPLEXITY_LEVELS, RISK_FACTORS_LIST, ROLE_RATES, DISCIPLINE_PCT,
} from '../modules/budgets/constants.js';
import { getBudgetCategories, estimateBudget } from '../modules/budgets/engine.js';

// PROJECT_TYPE(_ORDER), PROJECT_COLORS, DEFAULT_PROJECT_COLOR → src/core/constants.js (importados arriba).

// Devuelve los tipos del proyecto como array (maneja legacy con projectType string)
function getProjectTypes(p) {
  if (Array.isArray(p.projectTypes) && p.projectTypes.length) return p.projectTypes;
  if (p.projectType) return [p.projectType];
  return ['OTHER'];
}
function projectTypesText(p) {
  return getProjectTypes(p).map(k => (PROJECT_TYPE[k] || PROJECT_TYPE.OTHER).label).join(' · ');
}

// ============ HELPERS ============
function getProject(id) { return state.projects.find(p => p.id === id); }
function getTask(id)    { return state.tasks.find(t => t.id === id); }
function getMember(id)  { return state.members.find(m => m.id === id); }
function getClient(id)  { return (state.clients || []).find(c => c.id === id); }
// Etiqueta corta del cliente: nombre + documento (si tiene).
function clientLabel(c) {
  if (!c) return '';
  const dt = c.docType && c.docType !== '99' ? DOC_TYPE_LABELS[c.docType] || '' : '';
  return dt && c.docNumber ? `${c.name} · ${dt} ${c.docNumber}` : c.name;
}
function currentMember(){ return getMember(currentMemberId) || state.members[0]; }

function parseMentions(text) {
  const mentions = [];
  state.members.forEach(m => {
    const re = new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) mentions.push(m.id);
  });
  return mentions;
}

function renderMentions(text) {
  let out = escapeHtml(text);
  state.members.forEach(m => {
    const re = new RegExp(`@${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(re, `<span class="bg-blue-50 text-blue-700 rounded px-1">@${escapeHtml(m.name)}</span>`);
  });
  return out;
}

function unreadCount() {
  return state.notifications.filter(n => n.forMemberId === currentMemberId && !n.read).length;
}

function projectProgress(pid) {
  const tasks = state.tasks.filter(t => t.projectId === pid);
  if (tasks.length === 0) return 0;
  return Math.round(tasks.filter(t => t.status === 'COMPLETED').length / tasks.length * 100);
}

function pushHistory(taskId, action, from, to) {
  state.history.push({ id: uid(), taskId, action, from, to, createdAt: new Date().toISOString() });
}

function notify(forMemberId, taskId, text) {
  if (!forMemberId || forMemberId === currentMemberId) return;
  state.notifications.push({
    id: uid(),
    forMemberId,
    fromMemberId: currentMemberId,
    taskId,
    text,
    read: false,
    createdAt: new Date().toISOString(),
  });
  // Send email if configured
  sendNotificationEmail(forMemberId, taskId, text);
}

// ---- Toast helper ----
function showToast(message, type = 'info', duration = 4000) {
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

// ---- Email (EmailJS) → src/services/email.js (sendNotificationEmail, testEmail; importados arriba) ----

// ---- Drag and drop for projects ----
let _draggingProjectId = null;

function dragProjectStart(e, projectId) {
  _draggingProjectId = projectId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', projectId);
  e.currentTarget.classList.add('dragging');
}
function dragProjectEnd(e) {
  e.currentTarget.classList.remove('dragging');
  _draggingProjectId = null;
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}
function dragColOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}
function dragColLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-over');
  }
}
function dropProject(e, status) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const pid = _draggingProjectId || e.dataTransfer.getData('text/plain');
  if (!pid) return;
  const p = getProject(pid);
  if (!p || p.status === status) return;
  p.status = status;
  save();
  render();
  showToast(`"${p.name}" → ${PROJECT_STATUS[status].label}`, 'success');
}

// ============ NAV ============
// NAV → src/core/constants.js (importado arriba).

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map(n => `
    <div class="nav-item ${currentView === n.key ? 'active' : ''}" onclick="go('${n.key}')">
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

function go(view) {
  currentView = view;
  currentTaskId = null;
  renderNav();
  render();
  closeSidebar();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

// ============ RENDER DISPATCH ============
function render() {
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
  main.innerHTML = views[currentView]();
  attachViewEvents();
}

// ============ HEADER TEMPLATE ============
function viewHeader(title, subtitle, actions = '') {
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

// ============ HOME ============
function renderHome() {
  const today = todayISO();
  const me = currentMemberId;
  const myTasks = state.tasks.filter(t => t.status !== 'COMPLETED' && (!t.assigneeId || t.assigneeId === me));
  const dueToday = myTasks.filter(t => t.dueDate && t.dueDate <= today);
  const thisWeek = myTasks.filter(t => {
    if (!t.dueDate) return false;
    const diff = daysBetween(today, t.dueDate);
    return diff >= 0 && diff <= 7;
  });
  const blocked = state.tasks.filter(t => t.status === 'BLOCKED' && (!t.assigneeId || t.assigneeId === me));
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
        ${statCard('Proyectos activos', state.projects.filter(p=>p.status==='ACTIVE').length)}
        ${statCard('Clientes', state.clients.length)}
        ${statCard('Balance del mes', fmtMoney(monthBalance()))}
      </section>

    </div>
  `;
}

function statCard(label, value) {
  return `
    <div class="card p-5">
      <div class="text-xs text-gray-500">${label}</div>
      <div class="text-2xl font-semibold mt-1">${value}</div>
    </div>
  `;
}

function taskRow(t) {
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

// ============ TASKS ============
let tasksViewMode = 'kanban';
let tasksFilter = { projectId: '', status: '' };

function renderTasks() {
  return `
    ${viewHeader('Tareas', `${state.tasks.length} en total`,
      `<div class="flex gap-1 bg-gray-100 rounded-lg p-1">
         <button class="px-3 py-1 rounded-md text-sm ${tasksViewMode==='list'?'bg-white shadow-sm':''}" onclick="tasksViewMode='list'; render()">Lista</button>
         <button class="px-3 py-1 rounded-md text-sm ${tasksViewMode==='kanban'?'bg-white shadow-sm':''}" onclick="tasksViewMode='kanban'; render()">Tablero</button>
         <button class="px-3 py-1 rounded-md text-sm ${tasksViewMode==='gantt'?'bg-white shadow-sm':''}" onclick="tasksViewMode='gantt'; render()">Gantt</button>
       </div>
       <button class="btn-primary" onclick="openTaskModal()">+ Nueva</button>`
    )}

    <div class="px-4 md:px-10 pb-4 flex gap-2">
      <select class="input max-w-xs" onchange="tasksFilter.projectId=this.value; render()">
        <option value="">Todos los proyectos</option>
        ${state.projects.map(p => `<option value="${p.id}" ${tasksFilter.projectId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
    </div>

    <div class="px-4 md:px-10 pb-10">
      ${tasksViewMode === 'kanban' ? renderKanban() : tasksViewMode === 'gantt' ? renderGantt() : renderTaskList()}
    </div>
  `;
}

function filteredTasks() {
  return state.tasks.filter(t =>
    (!tasksFilter.projectId || t.projectId === tasksFilter.projectId) &&
    (!tasksFilter.status    || t.status    === tasksFilter.status)
  );
}

function renderKanban() {
  const tasks = filteredTasks();
  return `
    <div class="flex gap-4 overflow-x-auto scroll-hide pb-4">
      ${STATUS_ORDER.map(s => {
        const colTasks = tasks.filter(t => t.status === s);
        return `
          <div class="kanban-col flex-1">
            <div class="flex items-center justify-between mb-3 px-1">
              <div class="flex items-center gap-2">
                <span class="chip ${STATUS[s].color}">${STATUS[s].label}</span>
                <span class="text-xs text-gray-500">${colTasks.length}</span>
              </div>
            </div>
            <div>
              ${colTasks.map(t => kanbanCard(t)).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function kanbanCard(t) {
  const p = getProject(t.projectId);
  const assignee = getMember(t.assigneeId);
  const isOverdue = t.dueDate && t.dueDate < todayISO() && t.status !== 'COMPLETED';
  return `
    <div class="task-card" onclick="openTaskDetail('${t.id}')">
      <div class="flex items-center justify-between mb-2">
        ${p ? `<span class="text-xs font-medium truncate" style="color:${p?.color || '#6b7280'}">● ${escapeHtml(p.name)}</span>` : '<span></span>'}
        <span class="chip ${PRIORITY[t.priority].color}">${PRIORITY[t.priority].label}</span>
      </div>
      <div class="text-sm font-medium">${escapeHtml(t.title)}</div>
      <div class="flex items-center justify-between mt-2">
        ${t.dueDate ? `<span class="text-xs ${isOverdue?'text-red-600 font-medium':'text-gray-500'}">${isOverdue?'⚠ ':''}${fmt(t.dueDate)}</span>` : '<span></span>'}
        ${assignee ? `<span class="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold" style="background:${assignee.color}" title="${escapeAttr(assignee.name)}">${escapeHtml(assignee.name[0])}</span>` : ''}
      </div>
      ${t.status === 'BLOCKED' && t.blockedReason ? `<div class="text-xs text-red-600 mt-2 italic">${escapeHtml(t.blockedReason)}</div>` : ''}
    </div>
  `;
}

function renderTaskList() {
  const tasks = filteredTasks();
  if (tasks.length === 0) return `<div class="card p-10 text-center text-gray-400">No hay tareas. Creá la primera.</div>`;
  return `
    <div class="card">
      ${tasks.map(taskRow).join('<div class="border-t border-gray-100"></div>')}
    </div>
  `;
}

// ============ GANTT ============
function renderGantt() {
  const tasks = filteredTasks().filter(t => t.startDate && t.dueDate);
  if (tasks.length === 0) return `<div class="card p-10 text-center text-gray-400">Necesitás tareas con fecha de inicio y fin para ver el Gantt.</div>`;

  // Compute date range
  const dates = tasks.flatMap(t => [new Date(t.startDate), new Date(t.dueDate)]);
  let minDate = new Date(Math.min(...dates));
  let maxDate = new Date(Math.max(...dates));
  // Pad 2 days each side
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 2);
  const totalDays = Math.max(1, Math.round((maxDate - minDate) / 86400000));
  const dayWidth = 32; // px per day
  const chartWidth = totalDays * dayWidth;

  // Group tasks by project
  const byProject = {};
  tasks.forEach(t => {
    if (!byProject[t.projectId]) byProject[t.projectId] = [];
    byProject[t.projectId].push(t);
  });

  // Build day headers (show every 2 days for density)
  let headers = '';
  for (let i = 0; i <= totalDays; i++) {
    const d = new Date(minDate); d.setDate(d.getDate() + i);
    const isMonday = d.getDay() === 1;
    const isFirst = d.getDate() === 1;
    headers += `<div class="inline-block text-center text-[10px] ${isFirst?'font-bold':'text-gray-500'} border-l ${isMonday?'border-gray-300':'border-gray-100'}" style="width:${dayWidth}px;height:28px;line-height:28px">${d.getDate()}${isFirst?'/'+(d.getMonth()+1):''}</div>`;
  }

  // Today marker
  const today = new Date(); today.setHours(0,0,0,0);
  const todayOffset = Math.round((today - minDate) / 86400000) * dayWidth;
  const showToday = today >= minDate && today <= maxDate;

  // Rows
  let rows = '';
  Object.entries(byProject).forEach(([pid, ptasks]) => {
    const proj = getProject(pid);
    rows += `
      <div class="flex items-center border-b border-gray-100" style="height:36px">
        <div class="w-56 flex-shrink-0 px-3 text-xs font-semibold truncate flex items-center gap-2 bg-gray-50">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${proj?.color || '#9ca3af'}"></span>
          ${escapeHtml(proj?.name || '—')}
        </div>
        <div class="relative" style="width:${chartWidth}px;height:100%"></div>
      </div>
    `;
    ptasks.forEach(t => {
      const start = new Date(t.startDate);
      const end = new Date(t.dueDate);
      const offsetDays = Math.round((start - minDate) / 86400000);
      const durDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
      const left = offsetDays * dayWidth;
      const width = durDays * dayWidth - 4;
      const overdue = end < today && t.status !== 'COMPLETED';
      const bg = t.status === 'COMPLETED' ? '#86efac' : t.status === 'BLOCKED' ? '#fca5a5' : t.status === 'IN_PROGRESS' ? '#93c5fd' : t.status === 'IN_REVIEW' ? '#fcd34d' : '#d1d5db';
      rows += `
        <div class="flex items-center border-b border-gray-100 hover:bg-gray-50" style="height:32px">
          <div class="w-56 flex-shrink-0 px-3 pl-8 text-xs truncate cursor-pointer" onclick="openTaskDetail('${t.id}')" title="${escapeAttr(t.title)}">${escapeHtml(t.title)}</div>
          <div class="relative" style="width:${chartWidth}px;height:100%">
            <div class="absolute rounded-md shadow-sm cursor-pointer flex items-center px-2 text-[11px] font-medium text-gray-800 overflow-hidden ${overdue ? 'ring-2 ring-red-400' : ''}"
                 style="left:${left}px;top:6px;height:20px;width:${width}px;background:${bg}"
                 onclick="openTaskDetail('${t.id}')" title="${escapeAttr(t.title)} · ${fmt(t.startDate)} → ${fmt(t.dueDate)}">
              ${escapeHtml(t.title)}
            </div>
          </div>
        </div>
      `;
    });
  });

  return `
    <div class="card overflow-hidden">
      <div class="overflow-x-auto">
        <div style="min-width:${chartWidth + 224}px">
          <div class="flex border-b border-gray-200 bg-gray-50 sticky top-0">
            <div class="w-56 flex-shrink-0 px-3 text-xs font-semibold flex items-center" style="height:28px">Tarea</div>
            <div class="relative" style="width:${chartWidth}px">
              ${headers}
              ${showToday ? `<div class="absolute top-0 bottom-0 border-l-2 border-red-500 pointer-events-none" style="left:${todayOffset}px;height:28px"></div>` : ''}
            </div>
          </div>
          <div class="relative">
            ${rows}
            ${showToday ? `<div class="absolute top-0 bottom-0 border-l-2 border-red-400 opacity-50 pointer-events-none" style="left:${224+todayOffset}px;width:2px"></div>` : ''}
          </div>
        </div>
      </div>
      <div class="px-4 py-2 text-xs text-gray-500 flex gap-4 flex-wrap border-t border-gray-100">
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:#d1d5db"></span>Pendiente</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:#93c5fd"></span>En progreso</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:#fcd34d"></span>En revisión</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:#86efac"></span>Completada</span>
        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:#fca5a5"></span>Bloqueada</span>
        <span class="flex items-center gap-1"><span class="border-l-2 border-red-500 h-3"></span>Hoy</span>
      </div>
    </div>
  `;
}

// ============ PROJECTS ============
let projectsViewMode = 'kanban'; // 'kanban' | 'list'
let projectsListStatus = '';      // filter for list view
let projectsTypeFilter = '';      // 'SYSTEM' | 'WEB' | 'OTHER' | ''

function getFilteredProjectsByType() {
  return projectsTypeFilter
    ? state.projects.filter(p => getProjectTypes(p).includes(projectsTypeFilter))
    : state.projects;
}

function renderProjects() {
  return `
    ${viewHeader('Proyectos', `${state.projects.length} en total`,
      `<div class="flex gap-1 bg-gray-100 rounded-lg p-1">
         <button class="px-3 py-1 rounded-md text-sm ${projectsViewMode==='kanban'?'bg-white shadow-sm font-medium':''}" onclick="projectsViewMode='kanban'; render()">Kanban</button>
         <button class="px-3 py-1 rounded-md text-sm ${projectsViewMode==='list'?'bg-white shadow-sm font-medium':''}" onclick="projectsViewMode='list'; render()">Lista</button>
       </div>
       <button class="btn-primary" onclick="openProjectModal()">+ Nuevo</button>`)}

    <div class="px-4 md:px-10 pb-4 flex flex-wrap gap-2">
      <button onclick="projectsTypeFilter=''; render()" class="chip ${projectsTypeFilter===''?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">Todos (${state.projects.length})</button>
      ${PROJECT_TYPE_ORDER.map(k => {
        const n = state.projects.filter(p => getProjectTypes(p).includes(k)).length;
        if (n === 0) return '';
        const t = PROJECT_TYPE[k];
        return `<button onclick="projectsTypeFilter='${k}'; render()" class="chip ${projectsTypeFilter===k?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">${t.label} (${n})</button>`;
      }).join('')}
    </div>

    <div class="px-4 md:px-10 pb-10">
      ${state.projects.length === 0
        ? `<div class="card p-10 text-center text-gray-400">Sin proyectos. Creá el primero.</div>`
        : (projectsViewMode === 'kanban' ? renderProjectsKanban() : renderProjectsList())
      }
    </div>
  `;
}

function renderProjectsKanban() {
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

function renderProjectsList() {
  const all = getFilteredProjectsByType();
  const filtered = projectsListStatus ? all.filter(p => p.status === projectsListStatus) : all;
  const sorted = [...filtered].sort((a, b) => {
    const orderA = PROJECT_STATUS_ORDER.indexOf(a.status);
    const orderB = PROJECT_STATUS_ORDER.indexOf(b.status);
    if (orderA !== orderB) return orderA - orderB;
    return (a.name || '').localeCompare(b.name || '');
  });

  return `
    <div class="flex flex-wrap gap-2 mb-3">
      <button onclick="projectsListStatus=''; render()" class="chip ${projectsListStatus===''?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">Todos (${state.projects.length})</button>
      ${PROJECT_STATUS_ORDER.map(k => {
        const n = state.projects.filter(p => p.status === k).length;
        if (n === 0) return '';
        const sc = PROJECT_STATUS[k];
        return `<button onclick="projectsListStatus='${k}'; render()" class="chip ${projectsListStatus===k?'bg-black text-white':sc.color} py-1.5 px-3 cursor-pointer">${sc.label} (${n})</button>`;
      }).join('')}
    </div>

    <div class="card divide-y divide-gray-100">
      ${sorted.length === 0 ? '<div class="p-10 text-center text-gray-400 text-sm">Sin proyectos en esta categoría.</div>' : sorted.map(p => projectListRow(p)).join('')}
    </div>
  `;
}

function projectListRow(p) {
  const s = PROJECT_STATUS[p.status] || PROJECT_STATUS.LEAD;
  const pr = projectProgress(p.id);
  const taskCount = state.tasks.filter(t => t.projectId === p.id).length;
  const activeTasks = state.tasks.filter(t => t.projectId === p.id && t.status !== 'COMPLETED').length;
  const blockedTasks = state.tasks.filter(t => t.projectId === p.id && t.status === 'BLOCKED').length;
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

function projectCard(p) {
  const pr = projectProgress(p.id);
  const taskCount = state.tasks.filter(t => t.projectId === p.id).length;
  const activeTasks = state.tasks.filter(t => t.projectId === p.id && t.status !== 'COMPLETED').length;
  const blockedTasks = state.tasks.filter(t => t.projectId === p.id && t.status === 'BLOCKED').length;
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

function hasProfileData(p) {
  const keys = ['contactRole','contactPhone2','contactEmail2','companyName','taxId','industry','website','address','city','country','domain','domainProvider','domainExpiry','hostingProvider','serverInfo','adminUrl','credentialsLink','repoUrl','techStack','techNotes','instagram','facebook','linkedin','tiktok','source','firstContactDate','commercialNotes'];
  return keys.some(k => p[k]);
}

function renderProfileSection(p) {
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

function openProjectDetail(id) {
  const p = getProject(id);
  const s = PROJECT_STATUS[p.status] || PROJECT_STATUS.LEAD;
  const isClosed = p.status === 'DONE' || p.status === 'ARCHIVED';
  const tasks = state.tasks.filter(t => t.projectId === id);
  const completedTasks = tasks.filter(t => t.status === 'COMPLETED');
  const incomes = state.incomes.filter(i => i.projectId === id).reduce((a,b) => a + Number(b.amount||0), 0);
  const expenses = state.expenses.filter(e => e.projectId === id).reduce((a,b) => a + Number(b.amount||0), 0);

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

// ============ PROMPT GENERATOR ============
let promptStyle = 'organize'; // 'organize' | 'execute' | 'review'

function generateProjectPrompt(projectId, style) {
  const p = getProject(projectId);
  const allTasks = state.tasks.filter(t => t.projectId === projectId && t.status !== 'COMPLETED');
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

function openPromptModal(projectId) {
  const text = generateProjectPrompt(projectId, promptStyle);
  openModal(`
    <div class="p-6 max-w-2xl">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xl font-semibold">Prompt para Claude</h2>
        <button onclick="closeModal()" class="text-gray-400 hover:text-gray-900">✕</button>
      </div>

      <div class="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4 w-fit">
        <button onclick="promptStyle='organize'; openPromptModal('${projectId}')" class="px-3 py-1.5 rounded-md text-xs ${promptStyle==='organize'?'bg-white shadow-sm font-medium':''}">Organizar</button>
        <button onclick="promptStyle='execute'; openPromptModal('${projectId}')" class="px-3 py-1.5 rounded-md text-xs ${promptStyle==='execute'?'bg-white shadow-sm font-medium':''}">Resolver</button>
        <button onclick="promptStyle='review'; openPromptModal('${projectId}')" class="px-3 py-1.5 rounded-md text-xs ${promptStyle==='review'?'bg-white shadow-sm font-medium':''}">Revisar</button>
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

function copyPromptText() {
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

// ============ DOCUMENTS & RESOURCES ============
let docsFilter = '';
let resourcesFilter = '';

function faviconFor(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return null; }
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function renderLinkPanel(title, subtitle, items, filter, categories, setFilter, onAdd, onEdit) {
  const filtered = filter ? items.filter(i => i.category === filter) : items;
  const sorted = [...filtered].sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

  return `
    ${viewHeader(title, subtitle, `<button class="btn-primary" onclick="${onAdd}()">+ Nuevo</button>`)}

    <div class="px-4 md:px-10 pb-4 flex gap-2 flex-wrap">
      <button onclick="${setFilter}(''); render()" class="chip ${filter===''?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">Todos (${items.length})</button>
      ${categories.map(c => {
        const n = items.filter(i => i.category === c).length;
        if (n === 0) return '';
        return `<button onclick="${setFilter}('${c}'); render()" class="chip ${filter===c?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">${c} (${n})</button>`;
      }).join('')}
    </div>

    <div class="px-4 md:px-10 pb-10">
      ${sorted.length === 0 ? `
        <div class="card p-10 text-center text-gray-400">
          ${items.length === 0 ? 'Sin items todavía. Agregá el primero.' : 'Nada en esta categoría.'}
        </div>
      ` : `
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          ${sorted.map(i => {
            const favicon = faviconFor(i.url);
            const domain = domainOf(i.url);
            return `
              <div class="card p-5 hover:shadow-md transition-shadow group">
                <div class="flex items-start gap-3 mb-3">
                  ${favicon ? `<img src="${favicon}" class="w-8 h-8 rounded" onerror="this.style.display='none'" />` : '<div class="w-8 h-8 rounded bg-gray-100"></div>'}
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-sm truncate">${escapeHtml(i.title)}</div>
                    <div class="text-xs text-gray-500 truncate">${escapeHtml(domain || i.url)}</div>
                  </div>
                  <button class="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-gray-900" onclick="${onEdit}('${i.id}')">⋯</button>
                </div>
                ${i.description ? `<p class="text-xs text-gray-600 mb-3 line-clamp-2">${escapeHtml(i.description)}</p>` : ''}
                <div class="flex items-center justify-between">
                  <span class="chip bg-gray-100 text-gray-700">${escapeHtml(i.category || 'Otro')}</span>
                  <a href="${escapeAttr(i.url)}" target="_blank" class="text-xs text-blue-600 hover:underline flex items-center gap-1">
                    Abrir
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
                  </a>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

function renderDocuments() {
  return renderLinkPanel(
    'Documentos',
    'Contratos, propuestas, plantillas y guías internas',
    state.documents,
    docsFilter,
    DOC_CATEGORIES,
    'setDocsFilter',
    'openDocumentModal',
    'openDocumentModal'
  );
}
function setDocsFilter(f) { docsFilter = f; }

function renderResources() {
  return renderLinkPanel(
    'Recursos',
    'Apps, herramientas y links útiles',
    state.resources,
    resourcesFilter,
    RES_CATEGORIES,
    'setResourcesFilter',
    'openResourceModal',
    'openResourceModal'
  );
}
function setResourcesFilter(f) { resourcesFilter = f; }

// ---- Generic link modal ----
function openLinkModal(title, item, categories, onSave, onDelete, id) {
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar' : 'Nuevo'} ${title.toLowerCase()}</h2>
      <form onsubmit="${onSave}(event)" class="space-y-3">
        <input type="hidden" name="id" value="${item.id || ''}" />
        <div>
          <label class="text-xs text-gray-500">Título</label>
          <input name="title" class="input" required autofocus value="${escapeAttr(item.title)}" placeholder="Ej: Contrato base clientes" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Link</label>
          <input type="url" name="url" class="input" required value="${escapeAttr(item.url)}" placeholder="https://..." />
        </div>
        <div>
          <label class="text-xs text-gray-500">Categoría</label>
          <select name="category">
            ${categories.map(c => `<option value="${c}" ${item.category===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500">Descripción (opcional)</label>
          <textarea name="description" class="input" rows="2">${escapeHtml(item.description || '')}</textarea>
        </div>
        <div class="flex justify-between pt-3">
          <div>${id ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="${onDelete}('${id}')">Eliminar</button>` : ''}</div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);
}

function openDocumentModal(id) {
  const doc = id ? state.documents.find(d => d.id === id) : { id: null, title: '', url: '', category: DOC_CATEGORIES[0], description: '' };
  openLinkModal('Documento', doc, DOC_CATEGORIES, 'saveDocument', 'deleteDocument', id);
}
function saveDocument(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.id) {
    Object.assign(state.documents.find(d => d.id === data.id), data);
  } else {
    state.documents.push({ ...data, id: uid(), createdAt: new Date().toISOString() });
  }
  save(); closeModal(); render();
}
function deleteDocument(id) {
  if (!confirm('¿Eliminar documento?')) return;
  state.documents = state.documents.filter(d => d.id !== id);
  save(); closeModal(); render();
}

function openResourceModal(id) {
  const res = id ? state.resources.find(r => r.id === id) : { id: null, title: '', url: '', category: RES_CATEGORIES[0], description: '' };
  openLinkModal('Recurso', res, RES_CATEGORIES, 'saveResource', 'deleteResource', id);
}
function saveResource(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.id) {
    Object.assign(state.resources.find(r => r.id === data.id), data);
  } else {
    state.resources.push({ ...data, id: uid(), createdAt: new Date().toISOString() });
  }
  save(); closeModal(); render();
}
function deleteResource(id) {
  if (!confirm('¿Eliminar recurso?')) return;
  state.resources = state.resources.filter(r => r.id !== id);
  save(); closeModal(); render();
}

// ============ PRESUPUESTOS ============
let budgetsFilterStatus = '';

function renderBudgets() {
  const all = (state.budgets || []);
  const filtered = budgetsFilterStatus
    ? all.filter(b => b.status === budgetsFilterStatus)
    : all;
  const sorted = filtered.slice().sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const totalBudgets = all.length;
  const sent = all.filter(b => b.status === 'SENT').length;
  const accepted = all.filter(b => b.status === 'ACCEPTED').length;
  const pipelineUSD = all.reduce((sum, b) => {
    if (b.status === 'REJECTED' || b.status === 'EXPIRED') return sum;
    const est = estimateBudget(b);
    const rate = Number(state.exchangeRate) || 1200;
    const usd = b.currency === 'ARS' ? est.finalRevenue / rate : est.finalRevenue;
    return sum + usd;
  }, 0);
  const closeRate = sent + accepted > 0 ? Math.round(accepted / (sent + accepted) * 100) : 0;

  return `
    ${viewHeader('Presupuestos', `${totalBudgets} en total`,
      `<button class="btn-primary" onclick="openBudgetModal()">+ Nuevo presupuesto</button>`)}

    <div class="px-4 md:px-10 pb-10 space-y-4">

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="card p-4"><div class="text-xs text-gray-500">Total</div><div class="text-2xl font-semibold">${totalBudgets}</div></div>
        <div class="card p-4"><div class="text-xs text-gray-500">Enviados</div><div class="text-2xl font-semibold">${sent}</div></div>
        <div class="card p-4"><div class="text-xs text-gray-500">Aceptados</div><div class="text-2xl font-semibold text-green-700">${accepted}</div><div class="text-[11px] text-gray-500">${closeRate}% tasa cierre</div></div>
        <div class="card p-4"><div class="text-xs text-gray-500">Pipeline (USD)</div><div class="text-2xl font-semibold">US$${pipelineUSD.toLocaleString('es-AR',{maximumFractionDigits:0})}</div></div>
      </div>

      <div class="flex flex-wrap gap-2">
        <button onclick="budgetsFilterStatus=''; render()" class="chip ${budgetsFilterStatus===''?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">Todos (${totalBudgets})</button>
        ${BUDGET_STATUS_ORDER.map(k => {
          const n = all.filter(b => b.status === k).length;
          if (n === 0) return '';
          const s = BUDGET_STATUS[k];
          return `<button onclick="budgetsFilterStatus='${k}'; render()" class="chip ${budgetsFilterStatus===k?'bg-black text-white':s.color} py-1.5 px-3 cursor-pointer">${s.label} (${n})</button>`;
        }).join('')}
      </div>

      ${sorted.length === 0 ? `
        <div class="card p-10 text-center text-gray-400">
          ${totalBudgets === 0 ? 'Sin presupuestos. Creá el primero.' : 'Nada en esta categoría.'}
        </div>
      ` : `
        <div class="card divide-y divide-gray-100">
          ${sorted.map(b => budgetRow(b)).join('')}
        </div>
      `}
    </div>
  `;
}

function budgetRow(b) {
  const est = estimateBudget(b);
  const status = BUDGET_STATUS[b.status] || BUDGET_STATUS.DRAFT;
  const cats = getBudgetCategories(b);
  const catLabels = cats.map(k => BUDGET_CATEGORIES.find(c => c.key === k)?.label).filter(Boolean).join(' + ');
  const marginColors = { green: 'text-green-700', yellow: 'text-amber-700', red: 'text-red-600' };
  const d = b.createdAt ? new Date(b.createdAt) : null;
  const monthlyFee = Number(b.monthlyFee) || 0;
  return `
    <div class="p-4 hover:bg-gray-50 cursor-pointer flex items-center gap-3" onclick="openBudgetModal('${b.id}')">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-medium">${escapeHtml(b.clientName || 'Sin cliente')}</span>
          <span class="chip ${status.color}">${status.label}</span>
        </div>
        <div class="text-xs text-gray-500 mt-0.5 truncate">
          ${b.code || ''} · ${escapeHtml(catLabels || '—')} · ${(b.items || []).length} módulo${(b.items||[]).length!==1?'s':''} · ${est.finalHours.toFixed(0)}h
          ${d ? ' · ' + d.toLocaleDateString('es-AR') : ''}
        </div>
      </div>
      <div class="text-right">
        <div class="font-semibold">${fmtAmount(est.finalRevenue, b.currency || 'USD')}</div>
        ${monthlyFee > 0 ? `<div class="text-[11px] text-blue-700 font-medium">+ ${fmtAmount(monthlyFee, b.currency || 'USD')}/mes</div>` : ''}
        <div class="text-xs ${marginColors[est.marginStatus]} font-medium">${est.margin.toFixed(0)}% margen</div>
      </div>
    </div>
  `;
}

let _budgetItemCounter = 0;

function openBudgetModal(id) {
  const existing = id ? (state.budgets || []).find(x => x.id === id) : null;
  const b = existing ? structuredClone(existing) : {
    id: null,
    code: `PRES-${new Date().getFullYear()}-${String(((state.budgets || []).length + 1)).padStart(4, '0')}`,
    clientName: '',
    categories: ['WEB'],
    pricingModel: 'FIXED',
    currency: 'USD',
    status: 'DRAFT',
    items: [],
    riskFactors: [],
    contingencyPct: 12,
    monthlyFee: 0,
    notes: '',
  };

  const activeCats = getBudgetCategories(b);
  _budgetItemCounter = 0;

  openModal(`
    <div class="p-6">
      <div class="flex items-center justify-between mb-4 gap-3">
        <div class="flex-1 min-w-0">
          <h2 class="text-xl font-semibold">${id ? 'Editar presupuesto' : 'Nuevo presupuesto'}</h2>
          <p class="text-xs text-gray-500">${b.code}</p>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" onclick="generateBudgetPdf('internal')" class="btn-ghost text-xs flex items-center gap-1" title="PDF interno con costos y margen">
            📄 PDF interno
          </button>
          <button type="button" onclick="generateBudgetPdf('client')" class="btn-ghost text-xs flex items-center gap-1" title="PDF limpio para enviar al cliente">
            📤 PDF cliente
          </button>
          <button onclick="closeModal()" class="text-gray-400 hover:text-gray-900 text-lg ml-2">✕</button>
        </div>
      </div>

      <form id="budgetForm" oninput="updateBudgetLivePreview()" onsubmit="saveBudget(event)" class="space-y-5">
        <input type="hidden" name="id" value="${b.id || ''}" />
        <input type="hidden" name="code" value="${escapeAttr(b.code)}" />

        <!-- 1. Datos básicos -->
        <section>
          <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">1. Datos básicos</h3>
          <div class="grid grid-cols-2 gap-3">
            <div class="col-span-2">
              <label class="text-xs text-gray-500">Cliente</label>
              <input name="clientName" required class="input" value="${escapeAttr(b.clientName)}" placeholder="Ej: Galo Wines" />
            </div>
            <div class="col-span-2">
              <label class="text-xs text-gray-500 mb-1.5 block">Tipo de proyecto <span class="text-gray-400 text-[10px]">(podés elegir más de uno)</span></label>
              <div class="flex flex-wrap gap-1.5" id="categoryChips">
                ${BUDGET_CATEGORIES.map(c => {
                  const checked = activeCats.includes(c.key);
                  return `
                    <label class="cursor-pointer">
                      <input type="checkbox" name="cat_${c.key}" ${checked?'checked':''} class="peer sr-only" onchange="updateBudgetSuggestions(); updateBudgetLivePreview()" />
                      <span class="chip bg-gray-100 text-gray-700 peer-checked:bg-black peer-checked:text-white hover:bg-gray-200 transition px-3 py-1.5 cursor-pointer inline-block">${c.label}</span>
                    </label>
                  `;
                }).join('')}
              </div>
            </div>
            <div>
              <label class="text-xs text-gray-500">Modalidad de cobro</label>
              <select name="pricingModel" class="input" onchange="updatePricingDescription(); updateBudgetLivePreview()">
                ${PRICING_MODELS.map(p => `<option value="${p.key}" ${b.pricingModel===p.key?'selected':''}>${p.label}</option>`).join('')}
              </select>
              <p id="pricingDesc" class="text-[11px] text-gray-500 mt-1 leading-relaxed">${(PRICING_MODELS.find(p => p.key===b.pricingModel) || PRICING_MODELS[0]).description}</p>
            </div>
            <div>
              <label class="text-xs text-gray-500">Moneda</label>
              <select name="currency" class="input">
                <option value="USD" ${b.currency==='USD'?'selected':''}>USD</option>
                <option value="ARS" ${b.currency==='ARS'?'selected':''}>ARS</option>
              </select>
              <label class="text-xs text-gray-500 mt-3 block">Estado</label>
              <select name="status" class="input">
                ${BUDGET_STATUS_ORDER.map(k => `<option value="${k}" ${b.status===k?'selected':''}>${BUDGET_STATUS[k].label}</option>`).join('')}
              </select>
            </div>
          </div>
        </section>

        <!-- 2. Módulos -->
        <section>
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold">2. Módulos / Requerimientos</h3>
            <button type="button" onclick="addBudgetItem()" class="text-sm text-blue-600 hover:underline">+ Módulo en blanco</button>
          </div>

          <div id="budgetSuggestions" class="mb-2"></div>

          <div id="budgetItemsList" class="space-y-2">
            ${(b.items || []).map((it) => budgetItemHTML(it)).join('') || '<div class="text-sm text-gray-400 italic" id="budgetItemsEmpty">Sin módulos. Tocá una sugerencia arriba o creá uno en blanco.</div>'}
          </div>
        </section>

        <!-- 3. Riesgos -->
        <section>
          <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">3. Factores de riesgo</h3>
          <p class="text-[11px] text-gray-500 mb-2">Tildá los que apliquen. El % se suma a las horas totales.</p>
          <div class="space-y-1 max-h-60 overflow-y-auto border border-gray-100 rounded-lg p-2">
            ${RISK_FACTORS_LIST.map(r => {
              const active = (b.riskFactors || []).find(x => x.id === r.id);
              const val = active?.value ?? r.def;
              const options = [...new Set([r.min, r.def, r.max])];
              return `
                <label class="flex items-center gap-2 text-sm p-1.5 hover:bg-gray-50 rounded">
                  <input type="checkbox" name="risk_${r.id}" ${active?'checked':''} class="w-4 h-4" />
                  <span class="flex-1">${r.label}</span>
                  <span class="text-[10px] text-gray-400 mr-1">+${Math.round(r.min*100)}–${Math.round(r.max*100)}%</span>
                  <select name="riskval_${r.id}" class="input max-w-[80px] text-xs py-1">
                    ${options.map(v => `<option value="${v}" ${val==v?'selected':''}>+${Math.round(v*100)}%</option>`).join('')}
                  </select>
                </label>
              `;
            }).join('')}
          </div>
        </section>

        <!-- 4. Contingencia -->
        <section>
          <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">4. Contingencia</h3>
          <div class="bg-gray-50 rounded-lg p-3">
            <div class="flex items-center gap-3 mb-1">
              <input type="range" name="contingencyPct" min="0" max="30" step="1" value="${b.contingencyPct}" class="flex-1" oninput="document.getElementById('contLabel').textContent = this.value + '%'" />
              <span id="contLabel" class="text-sm font-bold min-w-[50px] text-right">${b.contingencyPct}%</span>
            </div>
            <p class="text-[11px] text-gray-600 leading-relaxed">
              Es el <b>extra "por las dudas"</b>: cubre lo que no podés prever (cambios menores, errores de estimación, problemas técnicos imprevistos).
              <br/><b>10-15%</b> si el alcance está bien definido · <b>16-20%</b> si hay incertidumbre.
            </p>
          </div>
        </section>

        <!-- 5. Mantenimiento mensual -->
        <section>
          <h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2">5. Mantenimiento / Suscripción mensual <span class="text-gray-400 normal-case font-normal">(opcional)</span></h3>
          <div class="bg-gray-50 rounded-lg p-3">
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-500">${b.currency}</span>
              <input type="number" name="monthlyFee" min="0" step="1" value="${b.monthlyFee || 0}" class="input flex-1" placeholder="0" />
              <span class="text-sm text-gray-500">/ mes</span>
            </div>
            <p class="text-[11px] text-gray-600 mt-2 leading-relaxed">
              Si vendés un sistema con cuota recurrente (soporte, mantenimiento, suscripción), ponelo acá.
              Va separado del precio inicial y aparece en el resumen como ingreso recurrente.
            </p>
          </div>
        </section>

        <!-- 6. Notas -->
        <section>
          <label class="text-xs text-gray-500">Notas internas (no salen al cliente)</label>
          <textarea name="notes" class="input" rows="2">${escapeHtml(b.notes || '')}</textarea>
        </section>

        <!-- LIVE PREVIEW (redesigned) -->
        <div id="budgetLivePreview" class="sticky bottom-0"></div>

        <div class="flex justify-between items-center pt-3 border-t border-gray-100">
          <div>${id ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="deleteBudget('${id}')">Eliminar</button>` : ''}</div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">${id ? 'Guardar cambios' : 'Crear presupuesto'}</button>
          </div>
        </div>
      </form>
    </div>
  `);

  setTimeout(() => { updateBudgetSuggestions(); updateBudgetLivePreview(); }, 30);
}

function updatePricingDescription() {
  const sel = document.querySelector('select[name="pricingModel"]');
  const desc = document.getElementById('pricingDesc');
  if (!sel || !desc) return;
  const model = PRICING_MODELS.find(p => p.key === sel.value);
  if (model) desc.textContent = model.description;
}

function updateBudgetSuggestions() {
  const container = document.getElementById('budgetSuggestions');
  if (!container) return;
  const fd = new FormData(document.getElementById('budgetForm'));
  const activeCats = BUDGET_CATEGORIES.filter(c => fd.get(`cat_${c.key}`) === 'on').map(c => c.key);

  // Junta sugerencias únicas de todas las categorías tildadas
  const seenTitles = new Set();
  const suggestions = [];
  activeCats.forEach(catKey => {
    (COMMON_MODULES_BY_CATEGORY[catKey] || []).forEach(m => {
      if (seenTitles.has(m.title)) return;
      seenTitles.add(m.title);
      suggestions.push(m);
    });
  });

  if (suggestions.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="bg-blue-50 border border-blue-100 rounded-lg p-2.5">
      <div class="text-[10px] uppercase tracking-wider text-blue-700 font-semibold mb-1.5">Sugerencias rápidas (click para agregar)</div>
      <div class="flex flex-wrap gap-1.5">
        ${suggestions.map((m, i) => `
          <button type="button" onclick='addSuggestedModule(${JSON.stringify(m).replace(/"/g, "&quot;")})' class="text-[11px] px-2.5 py-1 rounded-md bg-white border border-blue-200 hover:bg-blue-100 transition">
            + ${escapeHtml(m.title)}
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function addSuggestedModule(suggestion) {
  const list = document.getElementById('budgetItemsList');
  if (!list) return;
  const empty = document.getElementById('budgetItemsEmpty');
  if (empty) empty.remove();
  list.insertAdjacentHTML('beforeend', budgetItemHTML(suggestion));
  updateBudgetLivePreview();
}

function budgetItemHTML(it) {
  const idx = _budgetItemCounter++;
  const complexity = it.complexity || 'MEDIUM';
  const cmpx = COMPLEXITY_LEVELS.find(c => c.key === complexity) || COMPLEXITY_LEVELS[2];
  const hoursDev = it.hoursDev || cmpx.default;
  return `
    <div class="border border-gray-200 rounded-lg p-3 space-y-2 bg-white" data-item-idx="${idx}">
      <div class="flex items-center gap-2">
        <input name="item_title_${idx}" required class="input flex-1" placeholder="Ej: Módulo de facturación" value="${escapeAttr(it.title || '')}" />
        <button type="button" onclick="removeBudgetItem(${idx})" class="text-red-500 hover:bg-red-50 p-1.5 rounded text-sm" title="Eliminar módulo">✕</button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="text-[10px] text-gray-500 uppercase tracking-wider">Complejidad</label>
          <select name="item_complexity_${idx}" class="input text-sm" onchange="autoFillHours(${idx}, this.value); updateBudgetLivePreview()">
            ${COMPLEXITY_LEVELS.map(c => `<option value="${c.key}" ${complexity===c.key?'selected':''}>${c.label} (${c.min}–${c.max}h)</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-[10px] text-gray-500 uppercase tracking-wider">Horas dev</label>
          <input type="number" step="1" min="1" name="item_hours_${idx}" class="input text-sm" value="${hoursDev}" />
        </div>
      </div>
    </div>
  `;
}

function addBudgetItem() {
  const list = document.getElementById('budgetItemsList');
  if (!list) return;
  // Si tenía el placeholder italic, limpiar
  if (list.querySelector('.italic')) list.innerHTML = '';
  list.insertAdjacentHTML('beforeend', budgetItemHTML({}));
  updateBudgetLivePreview();
}

function removeBudgetItem(idx) {
  const el = document.querySelector(`[data-item-idx="${idx}"]`);
  if (el) el.remove();
  updateBudgetLivePreview();
}

function autoFillHours(idx, complexityKey) {
  const c = COMPLEXITY_LEVELS.find(x => x.key === complexityKey);
  if (!c) return;
  const inp = document.querySelector(`input[name="item_hours_${idx}"]`);
  if (inp) inp.value = c.default;
}

function collectBudgetFromForm() {
  const form = document.getElementById('budgetForm');
  if (!form) return null;
  const fd = new FormData(form);

  const items = [];
  document.querySelectorAll('#budgetItemsList [data-item-idx]').forEach(el => {
    const idx = el.dataset.itemIdx;
    items.push({
      title: fd.get(`item_title_${idx}`) || '',
      complexity: fd.get(`item_complexity_${idx}`) || 'MEDIUM',
      hoursDev: Number(fd.get(`item_hours_${idx}`)) || 0,
    });
  });

  const riskFactors = RISK_FACTORS_LIST
    .filter(r => fd.get(`risk_${r.id}`) === 'on')
    .map(r => ({ id: r.id, value: Number(fd.get(`riskval_${r.id}`)) || r.def }));

  // Multi-categoría desde los checkboxes
  const categories = BUDGET_CATEGORIES
    .filter(c => fd.get(`cat_${c.key}`) === 'on')
    .map(c => c.key);

  return {
    id: fd.get('id') || null,
    code: fd.get('code') || '',
    clientName: fd.get('clientName') || '',
    categories: categories.length > 0 ? categories : ['WEB'],
    pricingModel: fd.get('pricingModel') || 'FIXED',
    currency: fd.get('currency') || 'USD',
    status: fd.get('status') || 'DRAFT',
    items,
    riskFactors,
    contingencyPct: Number(fd.get('contingencyPct')) || 12,
    monthlyFee: Number(fd.get('monthlyFee')) || 0,
    notes: fd.get('notes') || '',
  };
}

function updateBudgetLivePreview() {
  const b = collectBudgetFromForm();
  if (!b) return;
  const est = estimateBudget(b);
  const preview = document.getElementById('budgetLivePreview');
  if (!preview) return;

  const marginConfig = {
    green:  { textColor: 'text-green-700',  bgColor: 'bg-green-50',  borderColor: 'border-green-200',  icon: '✓', label: 'Margen objetivo alcanzado' },
    yellow: { textColor: 'text-amber-700',  bgColor: 'bg-amber-50',  borderColor: 'border-amber-200',  icon: '⚠', label: 'Mínimo cumplido, sin colchón' },
    red:    { textColor: 'text-red-700',    bgColor: 'bg-red-50',    borderColor: 'border-red-200',    icon: '✕', label: 'Bajo el mínimo: requiere override de Dirección' },
  };
  const mc = marginConfig[est.marginStatus];
  const profit = est.finalRevenue - est.finalCost;
  const monthlyFee = Number(b.monthlyFee) || 0;
  const hasMonthlyFee = monthlyFee > 0;

  if (b.items.length === 0) {
    preview.innerHTML = `
      <div class="rounded-2xl bg-white shadow-lg border border-gray-200 p-6 text-center">
        <div class="text-4xl mb-2 opacity-30">$</div>
        <div class="text-gray-500 text-sm">Agregá al menos un módulo para ver el cálculo en vivo</div>
      </div>
    `;
    return;
  }

  preview.innerHTML = `
    <div class="rounded-2xl bg-white shadow-xl border border-gray-200 overflow-hidden">

      <!-- HEADER: precio total + badge margen -->
      <div class="p-5 pb-4">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="min-w-0">
            <div class="text-[11px] text-gray-500 uppercase tracking-wider font-semibold">Precio total</div>
            <div class="text-3xl md:text-4xl font-bold tracking-tight mt-0.5">${fmtAmount(est.finalRevenue, b.currency)}</div>
            <div class="text-xs text-gray-500 mt-1">${est.pricingModel.label}</div>
          </div>
          <div class="flex-shrink-0">
            <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full ${mc.bgColor} ${mc.textColor} border ${mc.borderColor}">
              <span class="text-base">${mc.icon}</span>
              <span class="text-sm font-bold">${est.margin.toFixed(0)}% margen</span>
            </div>
          </div>
        </div>

        ${hasMonthlyFee ? `
          <div class="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-3 mt-3">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-[10px] text-blue-600 uppercase tracking-wider font-semibold">+ Suscripción mensual</div>
                <div class="text-lg font-bold text-blue-700">${fmtAmount(monthlyFee, b.currency)} <span class="text-xs font-normal text-blue-600">/ mes</span></div>
              </div>
              <div class="text-right text-[11px] text-blue-600">
                ${fmtAmount(monthlyFee * 12, b.currency)}<br/>al año
              </div>
            </div>
          </div>
        ` : ''}
      </div>

      <!-- STATS GRID -->
      <div class="grid grid-cols-3 border-t border-gray-100">
        <div class="p-4 text-center border-r border-gray-100">
          <div class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">Horas totales</div>
          <div class="text-xl font-bold">${est.finalHours.toFixed(0)}h</div>
          <div class="text-[10px] text-gray-400">base ${est.baseHours.toFixed(0)}h</div>
        </div>
        <div class="p-4 text-center border-r border-gray-100">
          <div class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">Costo interno</div>
          <div class="text-xl font-bold text-gray-700">${fmtAmount(est.finalCost, b.currency)}</div>
          <div class="text-[10px] text-gray-400">${b.items.length} módulo${b.items.length!==1?'s':''}</div>
        </div>
        <div class="p-4 text-center">
          <div class="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-0.5">Ganancia</div>
          <div class="text-xl font-bold text-green-700">${fmtAmount(profit, b.currency)}</div>
          <div class="text-[10px] text-gray-400">objetivo ${est.targetMargin}%</div>
        </div>
      </div>

      <!-- STATUS BANNER -->
      <div class="${mc.bgColor} ${mc.textColor} px-5 py-2.5 flex items-center gap-2 text-xs font-medium border-t ${mc.borderColor}">
        <span class="text-sm">${mc.icon}</span>
        <span>${mc.label}</span>
      </div>

      ${(est.riskSum > 0 || est.contingencyPct > 0) ? `
        <div class="px-5 py-2 text-[11px] text-gray-600 bg-gray-50 border-t border-gray-100 flex flex-wrap items-center gap-3">
          ${est.riskSum > 0 ? `<span><span class="text-gray-400">Riesgo:</span> <b>+${(est.riskSum*100).toFixed(0)}%</b></span>` : ''}
          ${est.contingencyPct > 0 ? `<span><span class="text-gray-400">Contingencia:</span> <b>+${est.contingencyPct.toFixed(0)}%</b></span>` : ''}
          <span class="text-gray-400">·</span>
          <span><span class="text-gray-400">Mín. modalidad:</span> ${est.minMargin}%</span>
        </div>
      ` : ''}

      ${est.riskSum >= 1.0 ? `
        <div class="bg-red-50 border-t border-red-200 px-5 py-2.5 text-[11px] text-red-800">
          ⚠ <b>Riesgo total = 100%.</b> La política sugiere NO usar precio fijo. Considerá Discovery/PoC o T&M con tope.
        </div>
      ` : ''}

      <!-- DESGLOSE EXPANDIBLE -->
      <details class="border-t border-gray-100 text-xs">
        <summary class="px-5 py-2.5 cursor-pointer text-gray-600 hover:bg-gray-50 select-none flex items-center justify-between">
          <span>Ver desglose por disciplina</span>
          <span class="text-gray-400">▾</span>
        </summary>
        <div class="px-5 py-3 grid grid-cols-2 gap-x-6 gap-y-1 bg-gray-50/50">
          ${[
            ['Funcional', est.totalByDiscipline.functional],
            ['UX/UI', est.totalByDiscipline.ux],
            ['Desarrollo', est.totalByDiscipline.dev],
            ['QA / Testing', est.totalByDiscipline.qa],
            ['Capacitación', est.totalByDiscipline.training],
            ['Documentación', est.totalByDiscipline.docs],
            ['Project Mgmt', est.totalByDiscipline.pm],
          ].map(([label, h]) => `
            <div class="flex justify-between py-1 border-b border-gray-200/60">
              <span class="text-gray-600">${label}</span>
              <span class="font-medium">${h.toFixed(1)}h</span>
            </div>
          `).join('')}
        </div>
      </details>
    </div>
  `;
}

function saveBudget(e) {
  e.preventDefault();
  const b = collectBudgetFromForm();
  if (!b) return;
  if (b.items.length === 0) {
    if (!confirm('No agregaste ningún módulo. ¿Guardar igual?')) return;
  }

  state.budgets = state.budgets || [];

  if (b.id) {
    const existing = state.budgets.find(x => x.id === b.id);
    if (existing) {
      Object.assign(existing, b, { updatedAt: new Date().toISOString() });
    }
  } else {
    state.budgets.push({
      ...b,
      id: uid(),
      createdAt: new Date().toISOString(),
      createdBy: currentMemberId,
    });
  }

  save();
  closeModal();
  render();
  showToast('Presupuesto guardado', 'success');
}

function deleteBudget(id) {
  const b = (state.budgets || []).find(x => x.id === id);
  if (!b) return;
  if (!confirm(`¿Eliminar el presupuesto "${b.clientName}"?\n\nEsta acción no se puede deshacer.`)) return;
  state.budgets = state.budgets.filter(x => x.id !== id);
  save();
  closeModal();
  render();
  showToast('Presupuesto eliminado', 'success');
}

// Vista para imprimir/guardar como PDF.
// mode: 'internal' (con costos y margen) | 'client' (limpia, sin info interna)
function openBudgetPdfView(b, mode) {
  if (!b) { showToast('Guardá el presupuesto antes de generar PDF', 'info'); return; }
  const est = estimateBudget(b);
  const cats = getBudgetCategories(b);
  const catLabels = cats.map(k => BUDGET_CATEGORIES.find(c => c.key === k)?.label).filter(Boolean).join(' · ');
  const pricingModel = PRICING_MODELS.find(p => p.key === b.pricingModel) || PRICING_MODELS[0];
  const showCosts = mode === 'internal';
  const dateStr = new Date(b.createdAt || Date.now()).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  const monthlyFee = Number(b.monthlyFee) || 0;

  const esc = (s) => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(b.code)} · ${esc(b.clientName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; line-height: 1.55; padding: 50px 40px 40px; max-width: 820px; margin: 0 auto; background: #fff; }
  .topbar { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 25px; border-bottom: 3px solid #111; }
  .brand { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
  .brand-sub { font-size: 11px; color: #666; letter-spacing: 2px; text-transform: uppercase; margin-top: 4px; }
  .meta-right { text-align: right; font-size: 12px; color: #555; }
  .code { font-weight: 700; color: #111; font-size: 14px; }
  .internal-tag { display: inline-block; margin-top: 6px; padding: 3px 10px; background: #fee2e2; color: #991b1b; font-size: 10px; font-weight: 700; letter-spacing: 1px; border-radius: 99px; }
  h1 { font-size: 30px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 6px; }
  .lede { color: #666; font-size: 14px; margin-bottom: 35px; }
  h2 { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin: 35px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e5e5; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { text-align: left; padding: 10px 8px; background: #fafafa; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #666; border-bottom: 2px solid #e5e5e5; font-weight: 600; }
  td { padding: 10px 8px; border-bottom: 1px solid #f0f0f0; font-size: 13px; vertical-align: top; }
  td.r, th.r { text-align: right; }
  .chip { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 600; background: #f3f3f3; color: #444; text-transform: uppercase; letter-spacing: 0.5px; }
  .price-card { background: #111; color: #fff; padding: 28px; border-radius: 14px; margin: 18px 0; }
  .price-card .label { font-size: 10px; text-transform: uppercase; letter-spacing: 2px; opacity: 0.65; margin-bottom: 8px; }
  .price-card .amount { font-size: 42px; font-weight: 800; letter-spacing: -1px; }
  .price-card .sub { opacity: 0.7; font-size: 13px; margin-top: 6px; }
  .monthly-card { background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); color: #fff; padding: 18px 22px; border-radius: 12px; margin-top: 12px; display: flex; justify-content: space-between; align-items: center; }
  .monthly-card .ml-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.85; }
  .monthly-card .ml-amount { font-size: 24px; font-weight: 700; margin-top: 2px; }
  .monthly-card .ml-year { text-align: right; font-size: 11px; opacity: 0.85; }
  .summary-row { display: flex; gap: 12px; }
  .summary-cell { flex: 1; background: #fafafa; padding: 16px; border-radius: 10px; }
  .summary-cell .sl { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #888; }
  .summary-cell .sv { font-size: 22px; font-weight: 700; margin-top: 4px; }
  .summary-cell.green .sv { color: #047857; }
  .summary-cell.red .sv { color: #b91c1c; }
  ul { margin: 8px 0 8px 22px; }
  ul li { padding: 4px 0; font-size: 13px; }
  .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 11px; color: #999; text-align: center; }
  .print-btn { position: fixed; top: 16px; right: 16px; background: #111; color: white; border: none; padding: 10px 22px; border-radius: 99px; cursor: pointer; font-size: 13px; font-weight: 600; box-shadow: 0 6px 20px rgba(0,0,0,0.2); z-index: 100; }
  .print-btn:hover { background: #333; }
  @media print {
    body { padding: 15mm; max-width: none; }
    .no-print { display: none !important; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
    .price-card { page-break-inside: avoid; }
  }
</style>
</head>
<body>

<button class="print-btn no-print" onclick="window.print()">🖨 Imprimir / Guardar PDF</button>

<div class="topbar">
  <div>
    <div class="brand">PRAGMA STUDIO</div>
    <div class="brand-sub">Sistemas · Web · IA · Automatización</div>
  </div>
  <div class="meta-right">
    <div class="code">${esc(b.code)}</div>
    <div>${dateStr}</div>
    <div>Vigencia: ${b.validityDays || 30} días</div>
    ${mode === 'internal' ? '<div class="internal-tag">USO INTERNO</div>' : ''}
  </div>
</div>

<h1>${esc(b.clientName || 'Cliente')}</h1>
<div class="lede">${esc(catLabels)} · ${esc(pricingModel.label)} · ${b.currency || 'USD'}</div>

<h2>Alcance · ${est.items.length} ${est.items.length===1?'módulo':'módulos'}</h2>
<table>
  <thead>
    <tr>
      <th style="width:30px">#</th>
      <th>Módulo / requerimiento</th>
      <th style="width:140px">Complejidad</th>
      <th class="r" style="width:60px">Horas</th>
      ${showCosts ? '<th class="r" style="width:90px">Precio</th>' : ''}
    </tr>
  </thead>
  <tbody>
    ${est.items.map((it, idx) => {
      const cmpx = COMPLEXITY_LEVELS.find(c => c.key === it.complexity);
      return `
        <tr>
          <td style="color:#999">${idx + 1}</td>
          <td><strong>${esc(it.title)}</strong></td>
          <td><span class="chip">${esc(cmpx?.label || '—')}</span></td>
          <td class="r">${Number(it.hoursDev).toFixed(it.hoursDev < 1 ? 1 : 0)}h</td>
          ${showCosts ? `<td class="r">${fmtAmount(it.revenue, b.currency)}</td>` : ''}
        </tr>
      `;
    }).join('')}
  </tbody>
</table>

${(b.riskFactors || []).length > 0 ? `
  <h2>Factores de riesgo considerados</h2>
  <ul>
    ${b.riskFactors.map(rf => {
      const f = RISK_FACTORS_LIST.find(x => x.id === rf.id);
      if (!f) return '';
      return `<li>${esc(f.label)} <span style="color:#888;font-size:12px">(+${Math.round((rf.value || f.def) * 100)}%)</span></li>`;
    }).join('')}
  </ul>
` : ''}

<h2>Inversión</h2>
<div class="price-card">
  <div class="label">Precio total</div>
  <div class="amount">${fmtAmount(est.finalRevenue, b.currency)}</div>
  <div class="sub">${esc(pricingModel.label)}</div>
</div>

${monthlyFee > 0 ? `
  <div class="monthly-card">
    <div>
      <div class="ml-label">+ Mantenimiento mensual</div>
      <div class="ml-amount">${fmtAmount(monthlyFee, b.currency)} / mes</div>
    </div>
    <div class="ml-year">
      ${fmtAmount(monthlyFee * 12, b.currency)}<br/>al año
    </div>
  </div>
` : ''}

${showCosts ? `
  <h2>Desglose interno (no compartir al cliente)</h2>
  <div class="summary-row" style="margin-bottom: 14px;">
    <div class="summary-cell">
      <div class="sl">Horas totales</div>
      <div class="sv">${est.finalHours.toFixed(0)}h</div>
    </div>
    <div class="summary-cell red">
      <div class="sl">Costo interno</div>
      <div class="sv">${fmtAmount(est.finalCost, b.currency)}</div>
    </div>
    <div class="summary-cell green">
      <div class="sl">Ganancia</div>
      <div class="sv">${fmtAmount(est.finalRevenue - est.finalCost, b.currency)}</div>
    </div>
    <div class="summary-cell">
      <div class="sl">Margen</div>
      <div class="sv">${est.margin.toFixed(1)}%</div>
    </div>
  </div>
  <table>
    <tr><td>Horas base</td><td class="r">${est.baseHours.toFixed(1)}h</td></tr>
    <tr><td>Multiplicador de riesgo</td><td class="r">+${(est.riskSum * 100).toFixed(0)}%</td></tr>
    <tr><td>Contingencia</td><td class="r">+${est.contingencyPct.toFixed(0)}%</td></tr>
    <tr><td>Modalidad mín / obj</td><td class="r">${est.minMargin}% / ${est.targetMargin}%</td></tr>
  </table>
  ${b.notes ? `<h2>Notas internas</h2><p style="font-size:13px;color:#555;white-space:pre-wrap">${esc(b.notes)}</p>` : ''}
` : `
  <h2>Forma de pago</h2>
  <p style="font-size:13px;color:#555">A convenir.</p>

  <h2>Plazos</h2>
  <p style="font-size:13px;color:#555">A definir según prioridad del cliente.</p>

  <h2>Vigencia</h2>
  <p style="font-size:13px;color:#555">Esta propuesta tiene validez de <strong>${b.validityDays || 30} días</strong> desde su emisión.</p>
`}

<div class="footer">
  Generado por Pragma Studio · ${new Date().toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
</div>

<script>
  setTimeout(() => window.print(), 700);
<\/script>

</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert('El navegador bloqueó la ventana. Permití pop-ups en este sitio y volvé a intentar.');
    return;
  }
  win.document.write(html);
  win.document.close();
}

// Wrapper para usar desde el modal: lee el budget actual del form (si no fue guardado aún)
function generateBudgetPdf(mode) {
  const b = collectBudgetFromForm();
  if (!b) return;
  if (!b.clientName || (b.items || []).length === 0) {
    alert('Necesitás cargar al menos el cliente y un módulo para generar el PDF.');
    return;
  }
  // Si el budget existe en state, usamos esa versión (con createdAt etc)
  const existing = b.id ? (state.budgets || []).find(x => x.id === b.id) : null;
  const final = existing ? { ...existing, ...b } : { ...b, createdAt: new Date().toISOString() };
  openBudgetPdfView(final, mode);
}

// ============ TEAM ============
function renderTeam() {
  return `
    ${viewHeader('Equipo', `${state.members.length} miembros`,
      `<button class="btn-primary" onclick="openMemberModal()">+ Miembro</button>`)}

    <div class="px-4 md:px-10 pb-10 max-w-2xl space-y-6">
      <div class="card divide-y divide-gray-100">
        ${state.members.map(m => {
          const tasks = state.tasks.filter(t => t.assigneeId === m.id && t.status !== 'COMPLETED').length;
          const isMe = m.id === currentMemberId;
          const hasLogin = !!m.email;
          const role = MEMBER_ROLES.find(r => r.key === m.role);
          const cap = Number(m.weeklyCapacityHrs) || 30;
          return `
            <div class="p-4 flex items-center gap-3 hover:bg-gray-50 flex-wrap">
              <span class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0" style="background:${m.color}">${escapeHtml(m.name[0])}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium">${escapeHtml(m.name)}</span>
                  ${isMe ? '<span class="chip bg-blue-100 text-blue-700">Vos</span>' : ''}
                  ${role ? `<span class="chip bg-gray-100 text-gray-700">${escapeHtml(role.label)}</span>` : ''}
                  ${hasLogin ? `<span class="chip bg-purple-100 text-purple-700" title="Email: ${escapeAttr(m.email)}">🔑 ${escapeHtml(m.email)}</span>` : ''}
                </div>
                <div class="text-xs text-gray-500">${tasks} tarea${tasks!==1?'s':''} activa${tasks!==1?'s':''} · ${cap}h/sem disponibles</div>
              </div>
              <div class="flex gap-1 flex-wrap items-center">
                <button class="btn-ghost text-sm" onclick="openMemberModal('${m.id}')" title="Editar nombre, email y color">✎ Editar</button>
                ${isMe
                  ? '<span class="text-xs text-gray-400 px-2">no podés eliminarte</span>'
                  : `<button class="btn-ghost text-sm text-red-600 hover:bg-red-50" onclick="deleteMember('${m.id}')" title="Eliminar miembro">✕ Eliminar</button>`
                }
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <p class="text-xs text-gray-500">En comentarios escribí <b>@Nombre</b> para notificar a un miembro. El 🔑 indica el email asociado a su login (Supabase Auth).</p>

      ${renderEmailSettings()}
      ${renderFinanceSettings()}
      ${renderSecuritySettings()}
    </div>
  `;
}

function renderSecuritySettings() {
  return `
    <div class="card p-5">
      <h3 class="font-semibold mb-1">Seguridad de sesiones</h3>
      <p class="text-xs text-gray-500 mb-3">Login gestionado por <b>Supabase Auth</b>. Las contraseñas viven encriptadas en Supabase, no en este HTML.</p>
      <div class="space-y-2 text-xs text-gray-600">
        <div><b>Para cambiar tu contraseña:</b> Supabase Dashboard → Authentication → Users → click en el usuario → "Send password recovery"</div>
        <div><b>Para agregar un usuario:</b> Supabase Dashboard → Authentication → Users → "Add user" → email + contraseña. Después agregalo al MEMBER_MAP del HTML si querés mapearlo a un miembro existente.</div>
        <div><b>Para sacar a alguien del sistema:</b> Supabase Dashboard → Authentication → Users → click en el usuario → "Delete user". Pierde acceso inmediatamente.</div>
        <div><b>Para forzar logout de todos:</b> Supabase Dashboard → Authentication → Sessions → "Sign out all users". Tienen que volver a loguearse.</div>
      </div>
    </div>
  `;
}

function renderFinanceSettings() {
  const updatedLabel = state.exchangeRateUpdatedAt
    ? new Date(state.exchangeRateUpdatedAt).toLocaleString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
    : 'nunca';
  return `
    <div class="card p-5">
      <h3 class="font-semibold mb-1">Configuración de finanzas</h3>
      <p class="text-xs text-gray-500 mb-4">Moneda base, WhatsApp para cobros y mensaje plantilla</p>

      <form onsubmit="saveFinanceSettings(event)" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500">Moneda base</label>
            <select name="defaultCurrency" class="input">
              <option value="ARS" ${(state.defaultCurrency||'ARS')==='ARS'?'selected':''}>ARS (Pesos)</option>
              <option value="USD" ${state.defaultCurrency==='USD'?'selected':''}>USD (Dólares)</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Cotización USD ${state.exchangeRateSource==='bluelytics'?'<span class="text-green-700">· Blue auto</span>':''}</label>
            <button type="button" onclick="openExchangeRateModal()" class="input w-full text-left flex items-center justify-between hover:border-black transition">
              <span class="flex items-center gap-2">
                ${state.exchangeRateSource==='bluelytics'?'<span class="w-2 h-2 rounded-full bg-green-500"></span>':''}
                <span class="font-semibold">$${(state.exchangeRate || 1200).toLocaleString('es-AR')}</span>
              </span>
              <span class="text-xs text-gray-500">${updatedLabel}</span>
            </button>
          </div>
        </div>

        <div>
          <label class="text-xs text-gray-500">WhatsApp de Pragma <span class="text-gray-400">(remitente del recordatorio)</span></label>
          <input type="tel" name="pragmaPhone" class="input" value="${escapeAttr(state.pragmaPhone || '')}" placeholder="+54 9 11 5555-5555" />
        </div>

        <div>
          <label class="text-xs text-gray-500">Plantilla del mensaje de cobro</label>
          <textarea id="templateTextarea" name="paymentMessageTemplate" class="input font-mono text-xs" rows="7" oninput="updateTemplatePreview()">${escapeHtml(state.paymentMessageTemplate || '')}</textarea>
          <p class="text-[11px] text-gray-500 mt-1.5 mb-2">Click una variable para insertarla en el cursor:</p>
          <div class="flex flex-wrap gap-1.5">
            ${PAYMENT_VARS.map(v => `
              <button type="button" onclick="insertTemplateVar('${v.key}')" class="chip bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer border border-blue-200" title="${v.label}">
                <span class="font-mono">{${v.key}}</span>
                <span class="text-blue-500 text-[10px]">${v.label}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="bg-gray-50 rounded-lg p-3">
          <div class="text-xs text-gray-500 mb-1.5 uppercase tracking-wider font-semibold">Vista previa</div>
          <div id="templatePreview" class="text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">${escapeHtml(getTemplatePreview(state.paymentMessageTemplate || ''))}</div>
          <div class="text-[11px] text-gray-400 mt-2">Con datos de ejemplo</div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
      </form>
    </div>
  `;
}

function insertTemplateVar(key) {
  const ta = document.getElementById('templateTextarea');
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = `{${key}}`;
  ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + text.length;
  updateTemplatePreview();
}

function getTemplatePreview(tpl) {
  // Sample: simulamos una mensualidad de US$20 a la cotización actual
  const sampleAmountUSD = 20;
  const base = state.defaultCurrency || 'ARS';
  const rate = Number(state.exchangeRate) || 1200;
  const sampleInBase = base === 'ARS' ? sampleAmountUSD * rate : sampleAmountUSD;
  const sample = {
    name: 'Juan Pérez',
    client: 'Juan Pérez',
    project: 'CRM Inmobiliario',
    company: 'Inmobiliaria Pérez SA',
    role: 'Director',
    month: `${MONTH_NAMES_FULL[new Date().getMonth()]} ${new Date().getFullYear()}`,
    amount:         fmtAmount(sampleInBase, base),
    amountOriginal: fmtAmount(sampleAmountUSD, 'USD'),
    amountARS:      fmtAmount(sampleAmountUSD * rate, 'ARS'),
    amountUSD:      fmtAmount(sampleAmountUSD, 'USD'),
    rate:           '$' + rate.toLocaleString('es-AR'),
    date: new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' }),
  };
  let out = tpl || '';
  Object.entries(sample).forEach(([k, v]) => {
    // Función como reemplazo para evitar interpretación de $
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v ?? ''));
  });
  return out || '(plantilla vacía)';
}

function updateTemplatePreview() {
  const ta = document.getElementById('templateTextarea');
  const preview = document.getElementById('templatePreview');
  if (!ta || !preview) return;
  preview.textContent = getTemplatePreview(ta.value);
}

function saveFinanceSettings(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  state.defaultCurrency = data.defaultCurrency || 'ARS';
  state.pragmaPhone = data.pragmaPhone || '';
  state.paymentMessageTemplate = data.paymentMessageTemplate || '';
  save();
  showToast('Configuración guardada', 'success');
  render();
}

function renderEmailSettings() {
  const cfg = state.emailConfig || {};
  return `
    <div class="card p-5">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="font-semibold">Notificaciones por email</h3>
          <p class="text-xs text-gray-500 mt-0.5">Via EmailJS · Gratis hasta 200 emails/mes</p>
        </div>
        <span class="chip ${cfg.enabled?'bg-green-100 text-green-700':'bg-gray-100 text-gray-600'}">${cfg.enabled?'Activo':'Desactivado'}</span>
      </div>

      <details class="text-sm text-gray-600 mb-4">
        <summary class="cursor-pointer text-blue-600 hover:underline">¿Cómo configurar? (5 min, una vez)</summary>
        <ol class="list-decimal pl-5 mt-2 space-y-1 text-xs">
          <li>Andá a <a href="https://www.emailjs.com" target="_blank" class="text-blue-600 underline">emailjs.com</a> y creá cuenta gratis</li>
          <li><b>Email Services</b> → conectá tu Gmail/Outlook → copiá el <b>Service ID</b></li>
          <li><b>Email Templates</b> → crea uno con variables <code>{{to_email}}</code>, <code>{{to_name}}</code>, <code>{{from_name}}</code>, <code>{{message}}</code>, <code>{{task_title}}</code>, <code>{{task_url}}</code> → copiá el <b>Template ID</b></li>
          <li><b>Account → General</b> → copiá la <b>Public Key</b></li>
          <li>Pegá los 3 valores acá abajo, activá y dale Guardar</li>
        </ol>
      </details>

      <form onsubmit="saveEmailConfig(event)" class="space-y-3">
        <div class="flex items-center gap-2">
          <input type="checkbox" id="emailEnabled" name="enabled" ${cfg.enabled?'checked':''} class="w-4 h-4" />
          <label for="emailEnabled" class="text-sm font-medium">Enviar emails al asignar tareas o etiquetar</label>
        </div>
        <div><label class="text-xs text-gray-500">Service ID</label><input name="serviceId" class="input font-mono text-xs" value="${escapeAttr(cfg.serviceId||'')}" placeholder="service_xxxxxxx" /></div>
        <div><label class="text-xs text-gray-500">Template ID</label><input name="templateId" class="input font-mono text-xs" value="${escapeAttr(cfg.templateId||'')}" placeholder="template_xxxxxxx" /></div>
        <div><label class="text-xs text-gray-500">Public Key</label><input name="publicKey" class="input font-mono text-xs" value="${escapeAttr(cfg.publicKey||'')}" placeholder="usuario_xxxxxxx" /></div>
        <div class="flex justify-between gap-2 pt-2">
          <button type="button" class="btn-ghost text-sm" onclick="testEmail()" ${!cfg.enabled||!currentMember()?.email?'disabled':''}>Enviar test</button>
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
        ${!currentMember()?.email ? '<p class="text-xs text-amber-700">⚠ Cargá un email en tu perfil de miembro para probar.</p>' : ''}
      </form>
    </div>
  `;
}

function saveEmailConfig(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  state.emailConfig = {
    enabled: data.enabled === 'on',
    serviceId: data.serviceId || '',
    templateId: data.templateId || '',
    publicKey: data.publicKey || '',
  };
  save();
  render();
  showToast('Configuración guardada', 'success');
}

// testEmail → src/services/email.js (importado arriba).

const MEMBER_ROLES = [
  { key: 'FOUNDER',     label: 'Owner / Fundador' },
  { key: 'TECH_LEAD',   label: 'Lead técnico' },
  { key: 'BACKEND',     label: 'Dev Backend' },
  { key: 'FRONTEND',    label: 'Dev Frontend' },
  { key: 'FULLSTACK',   label: 'Dev Full-stack' },
  { key: 'AI',          label: 'Especialista IA' },
  { key: 'DESIGN',      label: 'Diseño UX/UI' },
  { key: 'PM',          label: 'Project Manager' },
  { key: 'SALES',       label: 'Marketing & Ventas' },
  { key: 'CS',          label: 'Customer Success' },
  { key: 'OTHER',       label: 'Otro' },
];

function openMemberModal(id) {
  const m = id ? getMember(id) : { id: null, name: '', email: '', role: '', weeklyCapacityHrs: 30, color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0') };
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar miembro' : 'Nuevo miembro'}</h2>
      <form onsubmit="saveMember(event)" class="space-y-3">
        <input type="hidden" name="id" value="${m.id || ''}" />
        <div><label class="text-xs text-gray-500">Nombre</label><input name="name" class="input" required autofocus value="${escapeAttr(m.name)}" /></div>
        <div><label class="text-xs text-gray-500">Email <span class="text-gray-400">(para login y notificaciones)</span></label><input type="email" name="email" class="input" value="${escapeAttr(m.email || '')}" placeholder="tu@email.com" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500">Rol</label>
            <select name="role" class="input">
              <option value="">Sin definir</option>
              ${MEMBER_ROLES.map(r => `<option value="${r.key}" ${m.role===r.key?'selected':''}>${r.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Capacidad semanal (hs)</label>
            <input type="number" name="weeklyCapacityHrs" class="input" min="0" max="60" value="${m.weeklyCapacityHrs || 30}" />
            <p class="text-[10px] text-gray-400 mt-0.5">Horas productivas reales por semana (no las del horario)</p>
          </div>
        </div>
        <div><label class="text-xs text-gray-500">Color</label><input type="color" name="color" class="input h-10" value="${m.color}" /></div>
        <div class="flex justify-between pt-3">
          <div>${id && id !== currentMemberId && state.members.length > 1 ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="deleteMember('${id}')">Eliminar</button>` : ''}</div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);
}

function saveMember(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.id) {
    Object.assign(getMember(data.id), data);
    if (data.id === currentMemberId) state.user.name = data.name;
  } else {
    state.members.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}

function deleteMember(id) {
  if (id === currentMemberId) {
    alert('No podés eliminarte a vos mismo. Hacé logout primero o pedile a otro miembro que te elimine.');
    return;
  }
  const m = getMember(id);
  if (!m) return;
  const activeTasks = state.tasks.filter(t => t.assigneeId === id && t.status !== 'COMPLETED').length;
  let warning = `¿Eliminar a ${m.name}?`;
  if (activeTasks > 0) warning += `\n\n${activeTasks} tarea${activeTasks>1?'s':''} activa${activeTasks>1?'s':''} queda${activeTasks>1?'n':''} sin asignar.`;
  if (m.email) warning += `\n\n⚠ ${m.name} tiene email asociado (${m.email}). Si vuelve a loguearse con ese email, se va a re-crear el miembro. Para evitarlo, borrá también el usuario desde Supabase → Authentication → Users.`;
  if (!confirm(warning)) return;

  state.members = state.members.filter(m => m.id !== id);
  state.tasks.forEach(t => { if (t.assigneeId === id) t.assigneeId = null; });
  // Limpiar comentarios huérfanos? No — los dejamos para mantener historial, sólo no resuelven al miembro.
  // Limpiar notificaciones dirigidas al eliminado
  state.notifications = (state.notifications || []).filter(n => n.forMemberId !== id);
  save();
  closeModal();
  render();
  showToast(`${m.name} eliminado`, 'success');
}

function openMemberPicker() {
  const me = currentMember();
  const auth = getAuthUser();
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-2">Tu sesión</h2>
      ${me ? `
        <div class="flex items-center gap-3 p-3 rounded-lg bg-gray-50 mb-4">
          <span class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold" style="background:${me.color}">${escapeHtml(me.name[0])}</span>
          <div class="flex-1">
            <div class="font-medium">${escapeHtml(me.name)}</div>
            <div class="text-xs text-gray-500">${escapeHtml(auth?.email || me.email || '')}</div>
          </div>
        </div>
      ` : ''}
      <div class="flex flex-col gap-2">
        <button class="btn-ghost w-full text-sm" onclick="closeModal(); go('team')">Administrar equipo</button>
        <button class="btn-ghost w-full text-sm text-red-600" onclick="closeModal(); logout()">⏏ Cerrar sesión</button>
      </div>
    </div>
  `);
}

// ============ FINANCE ============
let financeMode  = 'month';                                 // 'month' | 'year' | 'range'
let financeMonth = new Date().toISOString().slice(0,7);     // YYYY-MM
let financeYear  = String(new Date().getFullYear());
let financeFrom  = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString().slice(0,10);
let financeTo    = new Date().toISOString().slice(0,10);

// lastDayOfMonth, monthsBetween → src/utils/helpers.js (importados arriba).

// MONTH_NAMES_SHORT, MONTH_NAMES_FULL → src/core/constants.js (importados arriba).

function getFinanceRange() {
  if (financeMode === 'month') {
    const [y, m] = financeMonth.split('-').map(Number);
    return { from: financeMonth + '-01', to: lastDayOfMonth(financeMonth), label: `${MONTH_NAMES_FULL[m-1]} ${y}` };
  }
  if (financeMode === 'year') {
    return { from: `${financeYear}-01-01`, to: `${financeYear}-12-31`, label: `Año ${financeYear}` };
  }
  return { from: financeFrom, to: financeTo, label: `${fmt(financeFrom)} → ${fmt(financeTo)}` };
}

function isMonthCharged(projectId, month) {
  return (state.recurringChargeLog || []).some(r => r.projectId === projectId && r.month === month);
}
function getChargeRecord(projectId, month) {
  return (state.recurringChargeLog || []).find(r => r.projectId === projectId && r.month === month);
}
function toggleMonthCharged(projectId, month) {
  if (isMonthCharged(projectId, month)) {
    state.recurringChargeLog = state.recurringChargeLog.filter(r => !(r.projectId === projectId && r.month === month));
  } else {
    const rate = Number(state.exchangeRate) || 1200;
    state.recurringChargeLog.push({
      id: uid(),
      projectId,
      month,
      chargedAt: new Date().toISOString(),
      chargedBy: currentMemberId,
      exchangeRate: rate,
      exchangeRateSource: state.exchangeRateSource || 'manual',
    });
    const p = getProject(projectId);
    const inAR = (p && p.monthlyFeeCurrency === 'USD') ? ` · cotización $${rate.toLocaleString('es-AR')}` : '';
    showToast(`Pago marcado como cobrado${inAR}`, 'success');
  }
  save(); render();
}

function getAutoIncomes(month) {
  // Ingresos virtuales a partir de proyectos ACTIVE_RECURRING con mensualidad
  const out = [];
  state.projects.forEach(p => {
    if (p.status !== 'ACTIVE_RECURRING' || !p.monthlyFee) return;
    const startMonth = (p.startDate || '').slice(0, 7);
    if (startMonth && startMonth > month) return;
    const endMonth = (p.endDate || '').slice(0, 7);
    if (endMonth && endMonth < month) return;
    const charged = isMonthCharged(p.id, month);
    out.push({
      id: `auto-${p.id}-${month}`,
      amount: Number(p.monthlyFee),
      currency: p.monthlyFeeCurrency || state.defaultCurrency || 'ARS',
      date: month + '-01',
      month,
      concept: `Mensualidad · ${p.name}`,
      projectId: p.id,
      auto: true,
      status: charged ? 'CHARGED' : 'PENDING',
    });
  });
  return out;
}

function getAutoIncomesInRange(from, to) {
  const fromM = from.slice(0,7);
  const toM = to.slice(0,7);
  return monthsBetween(fromM + '-01', toM + '-01').flatMap(m => getAutoIncomes(m));
}

// ---- Auto expenses (gastos fijos recurrentes) ----
function getExpensePaymentRecord(expenseId, month) {
  return (state.recurringExpensePayments || []).find(r => r.expenseId === expenseId && r.month === month);
}
function isExpenseMonthPaid(expenseId, month) {
  return !!getExpensePaymentRecord(expenseId, month);
}

function getAutoExpenses(month) {
  // Genera gastos virtuales para meses posteriores a partir de gastos FIXED con recurring=true
  const out = [];
  state.expenses.forEach(e => {
    if (e.category !== 'FIXED') return;
    if (e.recurring === false) return;
    const expenseMonth = (e.date || '').slice(0, 7);
    if (!expenseMonth || expenseMonth >= month) return;        // sólo en meses POSTERIORES al original
    const endMonth = (e.recurringEndDate || '').slice(0, 7);
    if (endMonth && endMonth < month) return;                  // ya fue dado de baja
    const payment = getExpensePaymentRecord(e.id, month);
    out.push({
      id: `auto-exp-${e.id}-${month}`,
      sourceExpenseId: e.id,
      amount: Number(e.amount),
      currency: e.currency || 'ARS',
      date: month + '-01',
      month,
      concept: e.concept,
      category: e.category,
      projectId: e.projectId,
      auto: true,
      status: payment ? 'PAID' : 'PENDING',
      exchangeRateAtTime: payment?.exchangeRate || null,
    });
  });
  return out;
}

function getAutoExpensesInRange(from, to) {
  const fromM = from.slice(0,7);
  const toM = to.slice(0,7);
  return monthsBetween(fromM + '-01', toM + '-01').flatMap(m => getAutoExpenses(m));
}

// ---- Carry-over (arrastre) ----
// Sólo se arrastran INGRESOS con cobro PARCIAL (algo cobrado, falta resto).
// Y SÓLO en el mes inmediatamente siguiente al original — no se proyecta
// hacia futuros meses indefinidamente.
// prevMonthKey → src/utils/helpers.js (importado arriba).

// ---- Cash-flow: lista todos los pagos con su fecha real (no la fecha del item original) ----
function getAllCashFlowPayments(kind) {
  const out = [];

  if (kind === 'income') {
    // 1. Pagos explícitos sobre ingresos manuales
    (state.incomePayments || []).forEach(p => {
      const inc = state.incomes.find(i => i.id === p.incomeId);
      if (!inc) return;
      out.push({
        amount: Number(p.amount) || 0,
        currency: p.currency || inc.currency || 'ARS',
        date: (p.date || p.paidAt || '').slice(0, 10),
        exchangeRate: Number(p.exchangeRate) || Number(inc.exchangeRateAtTime) || Number(state.exchangeRate) || 1200,
      });
    });
    // 2. Pagos sobre mensualidades recurrentes (cobros)
    (state.recurringChargeLog || []).forEach(r => {
      const proj = getProject(r.projectId);
      if (!proj) return;
      const amount = r.amount != null ? Number(r.amount) : Number(proj.monthlyFee || 0);
      out.push({
        amount,
        currency: r.currency || proj.monthlyFeeCurrency || 'ARS',
        date: (r.date || r.chargedAt || '').slice(0, 10),       // ← prefiere r.date
        exchangeRate: Number(r.exchangeRate) || Number(state.exchangeRate) || 1200,
      });
    });
    // 3. Sintético: ingresos confirmados sin payment log (back-compat con data vieja)
    state.incomes.forEach(i => {
      if ((state.incomePayments || []).some(p => p.incomeId === i.id)) return;
      if ((i.status || 'CONFIRMED') !== 'CONFIRMED') return;
      out.push({
        amount: Number(i.amount) || 0,
        currency: i.currency || 'ARS',
        date: ((i.confirmedAt && i.confirmedAt.slice(0,10)) || i.date || '').slice(0, 10),
        exchangeRate: Number(i.exchangeRateAtTime) || Number(state.exchangeRate) || 1200,
      });
    });
  } else {
    // 1. Pagos explícitos sobre gastos manuales
    (state.expensePayments || []).forEach(p => {
      const exp = state.expenses.find(e => e.id === p.expenseId);
      if (!exp) return;
      out.push({
        amount: Number(p.amount) || 0,
        currency: p.currency || exp.currency || 'ARS',
        date: (p.date || p.paidAt || '').slice(0, 10),
        exchangeRate: Number(p.exchangeRate) || Number(exp.exchangeRateAtTime) || Number(state.exchangeRate) || 1200,
      });
    });
    // 2. Pagos sobre gastos fijos recurrentes
    (state.recurringExpensePayments || []).forEach(r => {
      const exp = state.expenses.find(e => e.id === r.expenseId);
      if (!exp) return;
      const amount = r.amount != null ? Number(r.amount) : Number(exp.amount || 0);
      out.push({
        amount,
        currency: r.currency || exp.currency || 'ARS',
        date: (r.date || r.paidAt || '').slice(0, 10),          // ← prefiere r.date
        exchangeRate: Number(r.exchangeRate) || Number(state.exchangeRate) || 1200,
      });
    });
    // 3. Sintético: gastos pagados sin payment log (back-compat con data vieja)
    state.expenses.forEach(e => {
      if ((state.expensePayments || []).some(p => p.expenseId === e.id)) return;
      if ((e.status || 'PAID') !== 'PAID') return;
      out.push({
        amount: Number(e.amount) || 0,
        currency: e.currency || 'ARS',
        date: ((e.paidAt && e.paidAt.slice(0,10)) || e.date || '').slice(0, 10),
        exchangeRate: Number(e.exchangeRateAtTime) || Number(state.exchangeRate) || 1200,
      });
    });
  }

  // Filtrar entries con fecha vacía (no se pueden ubicar en el tiempo)
  return out.filter(p => p.date);
}

// Arrastres encadenados: una vez parcial, se sigue mostrando en cada mes
// posterior hasta que se cobre 100%. Si no cobrás en junio → julio sigue
// mostrándolo. Si tampoco en julio → agosto. Y así.
// Sólo aplica en vista Mes; en Año/Rango no se muestra para no duplicar.
function getCarryOversForMonth(viewedMonth) {
  const incomes = [];

  // Manual incomes anteriores con saldo parcial
  state.incomes.forEach(i => {
    if (!i.date) return;
    const m = i.date.slice(0, 7);
    if (m >= viewedMonth) return;
    const tmp = { ...i, _kind: 'income' };
    const sum = getPaymentSummary(tmp);
    if (sum.status !== 'PARTIAL') return;
    incomes.push({ ...i, _kind: 'income', _carryOver: true, _carryOverFrom: m, _carryOverRemaining: sum.remaining });
  });

  // Recurring incomes (mensualidades) parciales de meses anteriores
  state.projects.forEach(p => {
    if (p.status !== 'ACTIVE_RECURRING' || !p.monthlyFee) return;
    const start = (p.startDate || '').slice(0, 7);
    if (!start) return;
    const end = (p.endDate || '').slice(0, 7);
    monthsBetween(start + '-01', viewedMonth + '-01').forEach(m => {
      if (m >= viewedMonth) return;
      if (end && m > end) return;
      const autoInc = getAutoIncomes(m).find(x => x.projectId === p.id);
      if (!autoInc) return;
      const sum = getPaymentSummary(autoInc);
      if (sum.status !== 'PARTIAL') return;
      incomes.push({ ...autoInc, _carryOver: true, _carryOverFrom: m, _carryOverRemaining: sum.remaining });
    });
  });

  return { incomes, expenses: [] };
}

function toggleExpenseMonthPaid(expenseId, month) {
  if (isExpenseMonthPaid(expenseId, month)) {
    state.recurringExpensePayments = state.recurringExpensePayments.filter(r => !(r.expenseId === expenseId && r.month === month));
  } else {
    state.recurringExpensePayments.push({
      id: uid(),
      expenseId,
      month,
      paidAt: new Date().toISOString(),
      paidBy: currentMemberId,
      exchangeRate: Number(state.exchangeRate) || 1200,
      exchangeRateSource: state.exchangeRateSource || 'manual',
    });
    showToast('Gasto marcado como pagado', 'success');
  }
  save(); render();
}

function cancelRecurringExpense(expenseId) {
  const e = state.expenses.find(x => x.id === expenseId);
  if (!e) return;
  if (!confirm(`¿Dar de baja el gasto fijo "${e.concept}"? Dejará de aparecer desde el próximo mes. Lo histórico se mantiene.`)) return;
  const today = new Date();
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  e.recurringEndDate = lastDayOfMonth.toISOString().slice(0, 10);
  save(); render();
  showToast('Gasto fijo dado de baja desde el próximo mes', 'success');
}

// ============ PARTIAL PAYMENTS ============
// Devuelve { expected, totalPaid, remaining, percent, status, payments[] }
function getPaymentSummary(item) {
  const expected = Number(item.amount) || 0;
  let payments = [];
  let kind = '';

  if (item.auto && item.sourceExpenseId) {
    kind = 'expense_recurring';
    payments = (state.recurringExpensePayments || []).filter(r => r.expenseId === item.sourceExpenseId && r.month === item.month);
  } else if (item.auto) {
    kind = 'income_recurring';
    payments = (state.recurringChargeLog || []).filter(r => r.projectId === item.projectId && r.month === item.month);
  } else if (item._kind === 'income') {
    kind = 'income';
    payments = (state.incomePayments || []).filter(p => p.incomeId === item.id);
    // Backwards compat: status=CONFIRMED sin pagos = pago completo sintético
    if (payments.length === 0 && (item.status || 'CONFIRMED') === 'CONFIRMED') {
      payments = [{ id: '__synth__'+item.id, amount: expected, exchangeRate: item.exchangeRateAtTime || state.exchangeRate, synthetic: true, paidAt: item.confirmedAt || item.date }];
    }
  } else if (item._kind === 'expense') {
    kind = 'expense';
    payments = (state.expensePayments || []).filter(p => p.expenseId === item.id);
    if (payments.length === 0 && (item.status || 'PAID') === 'PAID') {
      payments = [{ id: '__synth__'+item.id, amount: expected, exchangeRate: item.exchangeRateAtTime || state.exchangeRate, synthetic: true, paidAt: item.paidAt || item.date }];
    }
  }

  // Suma: si el pago tiene amount explícito úsalo, si no asume completo (legacy)
  const totalPaid = payments.reduce((sum, p) => sum + (p.amount != null ? Number(p.amount) : expected), 0);
  const remaining = Math.max(0, expected - totalPaid);
  const percent = expected > 0 ? Math.min(100, Math.round((totalPaid / expected) * 100)) : 0;
  let status;
  if (totalPaid <= 0) status = 'PENDING';
  else if (totalPaid >= expected) status = 'PAID';
  else status = 'PARTIAL';

  return { expected, totalPaid, remaining, percent, status, payments, kind };
}

// Devuelve { label, color } según el tipo (ingreso/gasto) y el estado del pago
function getPaymentChip(item) {
  const s = getPaymentSummary(item);
  const isInc = item._kind === 'income' || (item.auto && !item.sourceExpenseId);
  if (s.status === 'PAID')    return { label: isInc ? 'Cobrado' : 'Pagado',        color: 'bg-green-100 text-green-700' };
  if (s.status === 'PARTIAL') return { label: `${s.percent}% ${isInc?'cobrado':'pagado'}`, color: 'bg-blue-100 text-blue-700' };
  return                       { label: 'Pendiente',                                color: 'bg-amber-100 text-amber-800' };
}

function addPaymentToItem(item, amount, date, note) {
  const rate = Number(state.exchangeRate) || 1200;
  const userDate = date || todayISO();
  const base = {
    id: uid(),
    amount: Number(amount),
    currency: item.currency || 'ARS',           // ← guarda moneda explícita
    date: userDate,                             // ← fecha que el usuario eligió
    paidAt: new Date().toISOString(),           // ← timestamp de cuando se registró
    paidBy: currentMemberId,
    exchangeRate: rate,
    exchangeRateSource: state.exchangeRateSource || 'manual',
    note: note || '',
  };

  if (item.auto && item.sourceExpenseId) {
    state.recurringExpensePayments.push({ ...base, expenseId: item.sourceExpenseId, month: item.month });
  } else if (item.auto) {
    // chargedAt = user-chosen date (no el timestamp). El timestamp queda en paidAt.
    state.recurringChargeLog.push({ ...base, projectId: item.projectId, month: item.month, chargedAt: userDate, chargedBy: currentMemberId });
  } else if (item._kind === 'income') {
    const real = state.incomes.find(x => x.id === item.id);
    if (real) real.status = 'CONFIRMED';
    state.incomePayments.push({ ...base, incomeId: item.id });
  } else if (item._kind === 'expense') {
    const real = state.expenses.find(x => x.id === item.id);
    if (real) real.status = 'PAID';
    state.expensePayments.push({ ...base, expenseId: item.id });
  }
  save();
}

function removePayment(kind, paymentId) {
  if (paymentId.startsWith('__synth__')) {
    // Sintético: viene del status binario. Limpiar el status del item.
    const realId = paymentId.slice('__synth__'.length);
    const inc = state.incomes.find(x => x.id === realId);
    if (inc) { inc.status = 'PENDING'; inc.exchangeRateAtTime = null; inc.confirmedAt = null; }
    const exp = state.expenses.find(x => x.id === realId);
    if (exp) { exp.status = 'PENDING'; exp.exchangeRateAtTime = null; exp.paidAt = null; }
  } else if (kind === 'income_recurring') {
    state.recurringChargeLog = state.recurringChargeLog.filter(r => r.id !== paymentId);
  } else if (kind === 'expense_recurring') {
    state.recurringExpensePayments = state.recurringExpensePayments.filter(r => r.id !== paymentId);
  } else if (kind === 'income') {
    state.incomePayments = state.incomePayments.filter(r => r.id !== paymentId);
  } else if (kind === 'expense') {
    state.expensePayments = state.expensePayments.filter(r => r.id !== paymentId);
  }
  save();
}

let _currentPaymentsItem = null;
function openPaymentsModal(item) {
  _currentPaymentsItem = item;
  renderPaymentsModal();
}
function renderPaymentsModal() {
  const item = _currentPaymentsItem;
  if (!item) return;
  const s = getPaymentSummary(item);
  const isInc = item._kind === 'income' || (item.auto && !item.sourceExpenseId);
  const cur = item.currency || 'ARS';

  openModal(`
    <div class="p-6">
      <div class="flex items-start justify-between gap-3 mb-3">
        <div class="flex-1 min-w-0">
          <h2 class="text-xl font-semibold truncate">${escapeHtml(item.concept)}</h2>
          <p class="text-sm text-gray-500">${isInc ? 'Cobros' : 'Pagos'} registrados</p>
        </div>
        <button onclick="closeModal()" class="text-gray-400 hover:text-gray-900 text-lg">✕</button>
      </div>

      <div class="grid grid-cols-3 gap-2 mb-4">
        <div class="bg-gray-50 rounded-lg p-3">
          <div class="text-[11px] text-gray-500 uppercase">Esperado</div>
          <div class="font-semibold">${fmtAmount(s.expected, cur)}</div>
        </div>
        <div class="bg-green-50 rounded-lg p-3">
          <div class="text-[11px] text-green-700 uppercase">${isInc?'Cobrado':'Pagado'}</div>
          <div class="font-semibold text-green-700">${fmtAmount(s.totalPaid, cur)} <span class="text-xs font-normal">(${s.percent}%)</span></div>
        </div>
        <div class="bg-amber-50 rounded-lg p-3">
          <div class="text-[11px] text-amber-800 uppercase">Falta</div>
          <div class="font-semibold text-amber-800">${fmtAmount(s.remaining, cur)}</div>
        </div>
      </div>

      <div class="h-2 bg-gray-100 rounded-full overflow-hidden mb-4">
        <div class="h-full ${s.status==='PAID'?'bg-green-500':'bg-blue-500'} transition-all" style="width:${s.percent}%"></div>
      </div>

      <h3 class="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">Pagos (${s.payments.length})</h3>
      <div class="space-y-1 mb-5 max-h-48 overflow-y-auto">
        ${s.payments.length === 0 ? '<div class="text-sm text-gray-400 italic">Sin pagos todavía.</div>' : s.payments.map(p => `
          <div class="flex items-center justify-between py-2 border-b border-gray-100 text-sm group">
            <div class="flex-1 min-w-0">
              <div class="font-medium">${fmtAmount(p.amount != null ? p.amount : s.expected, cur)}</div>
              <div class="text-xs text-gray-500">${fmt(p.date || p.paidAt || p.chargedAt)}${p.note?` · ${escapeHtml(p.note)}`:''}${p.synthetic?' · <span class="italic">legacy</span>':''}</div>
            </div>
            <button onclick="removePayment('${s.kind}','${p.id}'); renderPaymentsModal()" class="opacity-0 group-hover:opacity-100 text-red-500 text-xs px-2 transition" title="Eliminar este pago">✕</button>
          </div>
        `).join('')}
      </div>

      <h3 class="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">Agregar pago</h3>
      <form onsubmit="submitPayment(event)" class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs text-gray-500">Monto en <b>${cur}</b></label>
            <div class="relative">
              <input id="paymentAmountInput" type="number" step="0.01" name="amount" class="input pr-12" required value="${s.remaining || ''}" oninput="updatePaymentConversionPreview()" />
              <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold pointer-events-none">${cur}</span>
            </div>
            <div id="paymentConversionPreview" class="text-[11px] text-blue-700 mt-1 font-medium min-h-[16px]"></div>
          </div>
          <div>
            <label class="text-xs text-gray-500">Fecha del pago</label>
            <input type="date" name="date" class="input" value="${todayISO()}" />
          </div>
        </div>
        <p class="text-[11px] text-gray-500">⚠ El monto se cuenta en <b>${cur}</b>. Si el cobro real fue en ${cur==='USD'?'pesos':'dólares'}, convertilo a ${cur} antes de cargarlo.</p>
        <div>
          <label class="text-xs text-gray-500">Nota (opcional)</label>
          <input type="text" name="note" class="input" placeholder="Ej: 1er adelanto, transferencia, etc." />
        </div>

        <div class="flex flex-wrap gap-1">
          <button type="button" onclick="setPaymentAmount(${s.remaining})" class="chip bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer">Falta (${fmtAmount(s.remaining, cur)})</button>
          <button type="button" onclick="setPaymentAmount(${s.expected * 0.5})" class="chip bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer">50%</button>
          <button type="button" onclick="setPaymentAmount(${s.expected * 0.25})" class="chip bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer">25%</button>
          <button type="button" onclick="setPaymentAmount(${s.expected})" class="chip bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer">Total</button>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-gray-100">
          <button type="button" class="btn-ghost" onclick="closeModal()">Cerrar</button>
          <button type="submit" class="btn-primary">Agregar pago</button>
        </div>
      </form>
    </div>
  `);

  // Mostrar la conversión apenas se abre, así detectás si la moneda está mal
  setTimeout(() => updatePaymentConversionPreview(), 30);
}

function setPaymentAmount(amount) {
  const inp = document.getElementById('paymentAmountInput');
  if (inp) inp.value = Number(amount).toFixed(2);
  updatePaymentConversionPreview();
}

// Live preview: muestra la conversión a la otra moneda al cambio actual
// para que el usuario detecte si está cargando en la moneda equivocada
function updatePaymentConversionPreview() {
  if (!_currentPaymentsItem) return;
  const inp = document.getElementById('paymentAmountInput');
  const preview = document.getElementById('paymentConversionPreview');
  if (!inp || !preview) return;
  const amount = Number(inp.value) || 0;
  if (amount <= 0) { preview.textContent = ''; return; }
  const cur = _currentPaymentsItem.currency || 'ARS';
  const rate = Number(state.exchangeRate) || 1200;
  if (cur === 'USD') {
    const ars = amount * rate;
    preview.innerHTML = `≈ $${ars.toLocaleString('es-AR', {maximumFractionDigits: 0})} ARS <span class="text-gray-400 font-normal">(al cambio actual $${rate.toLocaleString('es-AR')})</span>`;
  } else if (cur === 'ARS') {
    const usd = amount / rate;
    preview.innerHTML = `≈ US$${usd.toLocaleString('es-AR', {maximumFractionDigits: 2})} USD <span class="text-gray-400 font-normal">(al cambio actual $${rate.toLocaleString('es-AR')})</span>`;
  } else {
    preview.textContent = '';
  }
}

function submitPayment(e) {
  e.preventDefault();
  if (!_currentPaymentsItem) return;
  const data = Object.fromEntries(new FormData(e.target).entries());
  const amount = Number(data.amount);
  if (!amount || isNaN(amount)) return alert('Monto inválido');
  addPaymentToItem(_currentPaymentsItem, amount, data.date, data.note);
  // Refrescamos el item con el nuevo state
  if (_currentPaymentsItem.auto && _currentPaymentsItem.sourceExpenseId) {
    // Recompute auto-expense
    const fresh = getAutoExpenses(_currentPaymentsItem.month).find(x => x.sourceExpenseId === _currentPaymentsItem.sourceExpenseId);
    if (fresh) _currentPaymentsItem = { ...fresh, _kind: 'expense' };
  } else if (_currentPaymentsItem.auto) {
    const fresh = getAutoIncomes(_currentPaymentsItem.month).find(x => x.projectId === _currentPaymentsItem.projectId);
    if (fresh) _currentPaymentsItem = { ...fresh, _kind: 'income' };
  }
  renderPaymentsModal();
  // re-render main view in background
  render();
}

// ============================================================
// CLIENTES — datos fiscales, fuente única para facturación
// ============================================================
function renderClients() {
  const clients = state.clients || [];
  return `
    ${viewHeader('Clientes', `${clients.length} cliente${clients.length!==1?'s':''}`,
      `<button class="btn-primary" onclick="openClientModal()">+ Cliente</button>`)}

    <div class="px-4 md:px-10 pb-10 max-w-2xl space-y-6">
      <div class="card divide-y divide-gray-100">
        ${clients.length === 0 ? `
          <div class="p-8 text-center text-gray-400 text-sm">
            Todavía no cargaste clientes.<br/>
            Creá uno con sus datos fiscales para vincularlo a un proyecto y facturar más rápido.
          </div>
        ` : clients.map(c => {
          const linked = state.projects.filter(p => p.clientId === c.id).length;
          const dtLabel = DOC_TYPE_LABELS[c.docType] || 'Consumidor Final';
          return `
            <div class="p-4 flex items-center gap-3 hover:bg-gray-50 flex-wrap">
              <span class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 bg-gray-700">${escapeHtml((c.name||'?')[0].toUpperCase())}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium">${escapeHtml(c.name)}</span>
                  <span class="chip bg-gray-100 text-gray-700">${escapeHtml(dtLabel)}${c.docType !== '99' && c.docNumber ? ` ${escapeHtml(c.docNumber)}` : ''}</span>
                  ${c.condicionIVA ? `<span class="chip bg-blue-50 text-blue-700">${escapeHtml(c.condicionIVA)}</span>` : ''}
                </div>
                <div class="text-xs text-gray-500">${linked} proyecto${linked!==1?'s':''} vinculado${linked!==1?'s':''}${c.notes ? ` · ${escapeHtml(c.notes)}` : ''}</div>
              </div>
              <div class="flex gap-1 flex-wrap items-center">
                <button class="btn-ghost text-sm" onclick="openClientModal('${c.id}')" title="Editar cliente">✎ Editar</button>
                <button class="btn-ghost text-sm text-red-600 hover:bg-red-50" onclick="deleteClient('${c.id}')" title="Eliminar cliente">✕ Eliminar</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <p class="text-xs text-gray-500">Los datos fiscales que cargues acá precargan automáticamente el modal <b>Emitir Factura C</b> cuando el proyecto está vinculado a este cliente.</p>
    </div>
  `;
}

function openClientModal(id) {
  const c = id ? getClient(id) : { id: null, name: '', docType: '99', docNumber: '', condicionIVA: '', notes: '' };
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar cliente' : 'Nuevo cliente'}</h2>
      <form onsubmit="saveClient(event)" class="space-y-3">
        <input type="hidden" name="id" value="${c.id || ''}" />
        <div>
          <label class="text-xs text-gray-500">Razón social / Nombre</label>
          <input name="name" class="input" required autofocus value="${escapeAttr(c.name)}" placeholder="Ej: Galo Wines S.A." />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500">Tipo de documento</label>
            <select name="docType" class="input">
              ${CLIENT_DOC_TYPES.map(d => `<option value="${d.v}" ${(c.docType||'99')===d.v?'selected':''}>${d.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Número (sin guiones)</label>
            <input name="docNumber" class="input" value="${escapeAttr(c.docNumber || '')}" placeholder="Ej: 20424402142" />
          </div>
        </div>
        <div>
          <label class="text-xs text-gray-500">Condición frente al IVA</label>
          <select name="condicionIVA" class="input">
            <option value="">Sin definir</option>
            ${CONDICION_IVA.map(x => `<option value="${x}" ${c.condicionIVA===x?'selected':''}>${x}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500">Notas</label>
          <textarea name="notes" class="input" rows="2" placeholder="Datos fiscales extra, referencia, etc.">${escapeHtml(c.notes || '')}</textarea>
        </div>
        <div class="flex justify-between pt-3">
          <div>${id ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="deleteClient('${id}')">Eliminar</button>` : ''}</div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);
}

function saveClient(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.docNumber) data.docNumber = String(data.docNumber).replace(/[^\d]/g, '');
  state.clients = state.clients || [];
  if (data.id) {
    Object.assign(getClient(data.id), data);
  } else {
    state.clients.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}

function deleteClient(id) {
  const c = getClient(id);
  if (!c) return;
  const linked = state.projects.filter(p => p.clientId === id);
  let warning = `¿Eliminar al cliente ${c.name}?`;
  if (linked.length > 0) warning += `\n\n${linked.length} proyecto${linked.length>1?'s':''} quedará${linked.length>1?'n':''} sin cliente asignado.`;
  if (!confirm(warning)) return;
  state.clients = (state.clients || []).filter(x => x.id !== id);
  linked.forEach(p => { p.clientId = ''; });
  save(); closeModal(); render();
}

// ============================================================
// AFIP — Facturación Electrónica (Factura C / Monotributo)
// ============================================================

// Tipos de documento del receptor (AFIP). Reusado en el modal de cliente
// y en el modal de emisión de factura.
// CLIENT_DOC_TYPES, DOC_TYPE_LABELS, CONDICION_IVA → src/core/constants.js (importados arriba).

function _incomeIdFor(item) {
  if (!item || !item.id) return null;
  return item.auto ? `auto:${item.projectId}:${item.month}` : item.id;
}

// Total cobrado convertido a ARS, usando la cotización CONGELADA de cada pago.
// AFIP factura siempre en pesos, así que tenemos que comparar contra ARS.
function getCollectedInARS(item) {
  const s = getPaymentSummary(item);
  return s.payments.reduce((sum, p) => {
    const amt = p.amount != null ? Number(p.amount) : s.expected;
    const cur = p.currency || item.currency || 'ARS';
    const rate = Number(p.exchangeRate) || Number(state.exchangeRate) || 1200;
    return sum + (cur === 'USD' ? amt * rate : amt);
  }, 0);
}

function getAllInvoicesFor(item) {
  const incomeId = _incomeIdFor(item);
  if (!incomeId) return [];
  return (state.invoices || []).filter(inv => inv.incomeId === incomeId && !inv.voided);
}

function getInvoicedInARS(item) {
  return getAllInvoicesFor(item).reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
}

// Diferencia entre lo cobrado (en ARS) y lo ya facturado.
// Si > 0 → hay saldo para facturar.
function getRemainingToInvoiceARS(item) {
  return Math.max(0, getCollectedInARS(item) - getInvoicedInARS(item));
}

// Mantengo nombres viejos para compat, pero ahora con semántica de "totalmente facturado"
function hasInvoiceFor(item) {
  if (!item || !item.id) return false;
  const invoices = getAllInvoicesFor(item);
  if (invoices.length === 0) return false;
  return getRemainingToInvoiceARS(item) < 0.5; // tolerancia de centavos
}

function getInvoiceFor(item) {
  const invoices = getAllInvoicesFor(item);
  return invoices[0] || null; // primera factura (las demás se muestran agrupadas)
}

// ¿Hay algo para facturar ahora? (cobrado > facturado)
function canEmitInvoice(item) {
  return getRemainingToInvoiceARS(item) > 0.5;
}

async function getAuthToken() {
  if (!sb) throw new Error('Supabase no disponible');
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.access_token) throw new Error('Sesión expirada — re-loguéate');
  return session.access_token;
}

async function callApi(path, opts = {}) {
  const token = await getAuthToken();
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = { error: 'Respuesta inválida del servidor' }; }
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json;
}

let _currentInvoiceItem = null;

function openInvoiceModal(item) {
  _currentInvoiceItem = item;
  const s = getPaymentSummary(item);
  const p = item.projectId ? getProject(item.projectId) : null;
  const cur = item.currency || 'ARS';

  // Precarga: priorizá el cliente vinculado al proyecto; si no hay, caé a la
  // heurística vieja (project.taxId → CUIT, si no Consumidor Final).
  const client = p?.clientId ? getClient(p.clientId) : null;
  const projTaxId = (client?.docNumber || p?.taxId || '').replace(/[^\d]/g, '');
  const defaultDocType = client?.docType || (projTaxId.length === 11 ? '80' : '99');
  const defaultDocNumber = projTaxId;
  const defaultName = client?.name || p?.companyName || p?.contactName || p?.name || '';

  // Fechas servicio: por defecto el mes del ingreso (timezone-safe)
  const monthStr = item.month || todayISO().slice(0, 7);
  const [_y, _m] = monthStr.split('-').map(Number);
  const firstDay = `${monthStr}-01`;
  const lastDayNum = new Date(_y, _m, 0).getDate(); // día 0 del mes siguiente = último del mes actual
  const lastDay = `${monthStr}-${String(lastDayNum).padStart(2, '0')}`;

  // Monto a facturar: SALDO PENDIENTE de facturar = cobrado en ARS - ya facturado
  // Si nunca se facturó nada, equivale al total cobrado convertido a ARS.
  const remainingARS = getRemainingToInvoiceARS(item);
  const collectedARS = getCollectedInARS(item);
  const invoicedARS = getInvoicedInARS(item);
  let defaultAmount = remainingARS > 0 ? remainingARS : collectedARS;
  // Fallback: si no hay pagos aún (no debería pasar porque el botón no aparece)
  if (defaultAmount <= 0) {
    defaultAmount = cur === 'USD'
      ? Math.round(s.expected * (Number(state.exchangeRate) || 1200))
      : s.expected;
  }
  const prevInvoices = getAllInvoicesFor(item);
  const fmtARS = (n) => `$${Number(n).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  openModal(`
    <div class="p-4 sm:p-6">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div class="flex-1 min-w-0">
          <h2 class="text-lg sm:text-xl font-semibold">Emitir Factura C</h2>
          <p class="text-xs sm:text-sm text-gray-500 mt-0.5 truncate">${escapeHtml(item.concept)}${p ? ` · ${escapeHtml(p.name)}` : ''}</p>
        </div>
        <button onclick="closeModal()" class="text-gray-400 hover:text-gray-900 text-xl leading-none shrink-0">✕</button>
      </div>

      <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 text-xs text-amber-900">
        <b>⚠ Producción AFIP.</b> Esta factura tiene validez fiscal real. Verificá los datos antes de emitir.
        ${cur === 'USD' ? '<br><b>Atención:</b> la factura se emite en PESOS. Monto convertido al cambio actual.' : ''}
      </div>

      ${prevInvoices.length > 0 ? `
        <div class="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3 text-xs">
          <div class="font-semibold text-purple-900 mb-1.5">🧾 Ya facturado: ${prevInvoices.length} factura${prevInvoices.length>1?'s':''}</div>
          <div class="space-y-0.5 mb-2">
            ${prevInvoices.map(inv => `<div class="text-purple-800">· <b>${escapeHtml(inv.code)}</b> · ${fmtARS(inv.amount)} · ${escapeHtml(inv.date ? inv.date.slice(0,4)+'-'+inv.date.slice(4,6)+'-'+inv.date.slice(6,8) : '—')}</div>`).join('')}
          </div>
          <div class="grid grid-cols-3 gap-2 pt-2 border-t border-purple-200">
            <div><div class="text-[10px] uppercase tracking-wider text-purple-600">Cobrado total</div><div class="font-semibold text-purple-900">${fmtARS(collectedARS)}</div></div>
            <div><div class="text-[10px] uppercase tracking-wider text-purple-600">Ya facturado</div><div class="font-semibold text-purple-900">${fmtARS(invoicedARS)}</div></div>
            <div><div class="text-[10px] uppercase tracking-wider text-green-700">Saldo a facturar</div><div class="font-semibold text-green-700">${fmtARS(remainingARS)}</div></div>
          </div>
        </div>
      ` : ''}

      <form id="invoiceForm" onsubmit="previewInvoice(event)" class="space-y-3">
        <div>
          <label class="text-xs text-gray-500">Cliente (nombre / razón social)</label>
          <input name="clientName" class="input" value="${escapeAttr(defaultName)}" placeholder="Opcional, para tu registro" />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label class="text-xs text-gray-500">Tipo de documento</label>
            <select name="clientDocType" class="input" onchange="updateInvoiceDocPlaceholder(this.value)">
              <option value="99" ${defaultDocType==='99'?'selected':''}>Consumidor Final</option>
              <option value="80" ${defaultDocType==='80'?'selected':''}>CUIT</option>
              <option value="86" ${defaultDocType==='86'?'selected':''}>CUIL</option>
              <option value="96" ${defaultDocType==='96'?'selected':''}>DNI</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Número (sin guiones)</label>
            <input id="invoiceDocNumber" name="clientDocNumber" class="input" value="${escapeAttr(defaultDocNumber)}" placeholder="${defaultDocType==='99'?'(no requerido)':'Ej: 20424402142'}" />
          </div>
        </div>

        <div>
          <label class="text-xs text-gray-500">Concepto</label>
          <select name="concept" class="input">
            <option value="2" selected>Servicios</option>
            <option value="1">Productos</option>
            <option value="3">Productos y Servicios</option>
          </select>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2" id="invoiceServiceDates">
          <div>
            <label class="text-xs text-gray-500">Servicio desde</label>
            <input type="date" name="serviceFromDate" class="input" value="${firstDay}" />
          </div>
          <div>
            <label class="text-xs text-gray-500">Servicio hasta</label>
            <input type="date" name="serviceToDate" class="input" value="${lastDay}" />
          </div>
          <div>
            <label class="text-xs text-gray-500">Vto. de pago</label>
            <input type="date" name="dueDate" class="input" value="${lastDay}" />
          </div>
        </div>

        <div>
          <label class="text-xs text-gray-500">Monto a facturar <b>(ARS)</b></label>
          <div class="relative">
            <input type="number" step="0.01" name="amount" class="input pr-12" required value="${Number(defaultAmount).toFixed(2)}" />
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-semibold pointer-events-none">ARS</span>
          </div>
          <div class="flex flex-wrap gap-1 mt-1.5">
            ${remainingARS > 0 && remainingARS !== collectedARS ? `<button type="button" onclick="document.querySelector('[name=amount]').value='${remainingARS.toFixed(2)}'" class="chip bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer text-[10px]">Saldo pendiente · ${fmtARS(remainingARS)}</button>` : ''}
            ${collectedARS > 0 ? `<button type="button" onclick="document.querySelector('[name=amount]').value='${collectedARS.toFixed(2)}'" class="chip bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer text-[10px]">Total cobrado · ${fmtARS(collectedARS)}</button>` : ''}
          </div>
          ${cur === 'USD' ? `<p class="text-[11px] text-gray-500 mt-1">Original ingreso: US$${s.expected.toLocaleString('es-AR')} · cambio actual $${(Number(state.exchangeRate)||1200).toLocaleString('es-AR')}</p>` : ''}
        </div>

        <div id="invoiceErrorBox" class="hidden bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg p-3"></div>

        <div class="flex justify-end gap-2 pt-3 border-t border-gray-100">
          <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary">Ver vista previa →</button>
        </div>
      </form>
    </div>
  `);
}

// Saves form data so user can come back from preview without losing values
let _currentInvoiceForm = null;

function previewInvoice(e) {
  e.preventDefault();
  if (!_currentInvoiceItem) return;
  const data = Object.fromEntries(new FormData(e.target).entries());
  const errBox = document.getElementById('invoiceErrorBox');
  if (errBox) errBox.classList.add('hidden');

  const amount = Number(data.amount);
  if (!amount || amount <= 0) {
    if (errBox) { errBox.textContent = 'Monto inválido'; errBox.classList.remove('hidden'); }
    return;
  }
  if (data.clientDocType !== '99' && !String(data.clientDocNumber || '').replace(/[^\d]/g, '')) {
    if (errBox) { errBox.textContent = 'Falta el número de documento del cliente'; errBox.classList.remove('hidden'); }
    return;
  }

  _currentInvoiceForm = data;
  renderInvoicePreview();
}

function renderInvoicePreview() {
  const item = _currentInvoiceItem;
  const data = _currentInvoiceForm;
  if (!item || !data) return;

  const p = item.projectId ? getProject(item.projectId) : null;
  const amount = Number(data.amount);
  const concept = Number(data.concept) || 2;
  const conceptLabel = concept === 1 ? 'Productos' : concept === 3 ? 'Productos y Servicios' : 'Servicios';
  const docTypeMap = { '80': 'CUIT', '86': 'CUIL', '96': 'DNI', '99': 'Consumidor Final' };
  const docTypeLabel = docTypeMap[data.clientDocType] || 'Consumidor Final';
  const docNumber = data.clientDocType === '99' ? '—' : (data.clientDocNumber || '—');
  const clientName = data.clientName?.trim() || (data.clientDocType === '99' ? 'Consumidor Final' : 'Sin especificar');

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const fmtMoney = (n) => `$${Number(n).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  const today = todayISO();

  // Conceto descripción
  let detalle = item.concept || 'Servicios profesionales';
  if (p) detalle += ` — ${p.name}`;

  openModal(`
    <div class="p-4 sm:p-6 inv-slide-in">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div class="flex-1 min-w-0">
          <h2 class="text-lg sm:text-xl font-semibold">Vista previa</h2>
          <p class="text-xs sm:text-sm text-gray-500 mt-0.5">Verificá los datos antes de emitir en AFIP</p>
        </div>
        <button onclick="closeModal()" class="text-gray-400 hover:text-gray-900 text-xl leading-none shrink-0">✕</button>
      </div>

      <!-- Factura mock -->
      <div class="border-2 border-gray-300 rounded-lg overflow-hidden bg-white text-[13px] mb-4">
        <!-- Header con C centrado tipo AFIP -->
        <div class="border-b-2 border-gray-300 grid grid-cols-[1fr_auto_1fr]">
          <div class="p-3 sm:p-4">
            <div class="font-bold text-base">Pragma Studio</div>
            <div class="text-xs text-gray-600">Gaspar Quintana Ruiz</div>
            <div class="text-xs text-gray-600 mt-1">Responsable Monotributo</div>
          </div>
          <div class="border-x-2 border-gray-300 flex flex-col items-center justify-center px-4 sm:px-6 py-2 bg-gray-50">
            <div class="text-3xl sm:text-4xl font-bold leading-none">C</div>
            <div class="text-[10px] text-gray-600 mt-0.5">COD. 11</div>
          </div>
          <div class="p-3 sm:p-4 text-right">
            <div class="font-bold">FACTURA</div>
            <div class="text-xs text-gray-600 mt-1">Pto Vta: <b>00003</b></div>
            <div class="text-xs text-gray-600">Nro: <b class="text-gray-400">a asignar por AFIP</b></div>
            <div class="text-xs text-gray-600 mt-1">Fecha: <b>${fmtDate(today)}</b></div>
          </div>
        </div>

        <!-- Datos emisor -->
        <div class="p-3 sm:p-4 border-b border-gray-200 text-xs space-y-0.5">
          <div><span class="text-gray-500">CUIT:</span> <b>20-42440214-2</b></div>
          <div><span class="text-gray-500">Ingresos Brutos:</span> <span class="text-gray-400">(según corresponda)</span></div>
          <div><span class="text-gray-500">Inicio de actividades:</span> <span class="text-gray-400">(según AFIP)</span></div>
        </div>

        <!-- Cliente -->
        <div class="p-3 sm:p-4 border-b border-gray-200">
          <div class="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Cliente</div>
          <div class="font-semibold">${escapeHtml(clientName)}</div>
          <div class="text-xs text-gray-600 mt-1">
            <span class="text-gray-500">${escapeHtml(docTypeLabel)}:</span> <b>${escapeHtml(String(docNumber))}</b>
          </div>
          <div class="text-xs text-gray-600">
            <span class="text-gray-500">Condición frente al IVA:</span> ${data.clientDocType === '99' ? 'Consumidor Final' : 'A definir'}
          </div>
        </div>

        <!-- Período -->
        ${concept !== 1 ? `
          <div class="p-3 sm:p-4 border-b border-gray-200 text-xs grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <div class="text-[10px] uppercase tracking-wider text-gray-500">Servicio desde</div>
              <div class="font-medium">${fmtDate(data.serviceFromDate)}</div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-wider text-gray-500">Servicio hasta</div>
              <div class="font-medium">${fmtDate(data.serviceToDate)}</div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-wider text-gray-500">Vto. de pago</div>
              <div class="font-medium">${fmtDate(data.dueDate)}</div>
            </div>
          </div>
        ` : ''}

        <!-- Detalle -->
        <div class="border-b border-gray-200">
          <div class="grid grid-cols-[1fr_auto] bg-gray-100 px-3 sm:px-4 py-2 text-[10px] uppercase tracking-wider text-gray-600 font-semibold">
            <div>Descripción</div>
            <div>Importe</div>
          </div>
          <div class="grid grid-cols-[1fr_auto] px-3 sm:px-4 py-3 gap-3">
            <div>
              <div class="font-medium">${escapeHtml(detalle)}</div>
              <div class="text-[11px] text-gray-500 mt-0.5">Concepto: ${conceptLabel}</div>
            </div>
            <div class="font-semibold text-right">${fmtMoney(amount)}</div>
          </div>
        </div>

        <!-- Totales -->
        <div class="p-3 sm:p-4 bg-gray-50 text-right space-y-1">
          <div class="text-xs text-gray-500">Subtotal: <b class="text-gray-900">${fmtMoney(amount)}</b></div>
          <div class="text-xs text-gray-500">IVA: <b class="text-gray-900">$0,00</b> <span class="text-[10px]">(Monotributo)</span></div>
          <div class="text-base font-bold pt-1 border-t border-gray-300 mt-1">TOTAL: ${fmtMoney(amount)}</div>
        </div>

        <!-- CAE placeholder -->
        <div class="p-3 sm:p-4 bg-amber-50 border-t border-amber-200 text-xs text-amber-900">
          <b>CAE:</b> se asigna al confirmar · <b>Vto. CAE:</b> AFIP lo emite · <b>QR:</b> generado por AFIP
        </div>
      </div>

      <!-- Checklist de validación -->
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-xs text-blue-900 space-y-1">
        <div class="font-semibold mb-1">📋 Revisá:</div>
        <div>${data.clientDocType === '99' ? '○' : '✓'} Documento del cliente: <b>${escapeHtml(docTypeLabel)}${docNumber !== '—' ? ' ' + docNumber : ''}</b></div>
        <div>✓ Monto: <b>${fmtMoney(amount)} ARS</b></div>
        <div>✓ Concepto: <b>${conceptLabel}</b></div>
        ${concept !== 1 ? `<div>✓ Período: <b>${fmtDate(data.serviceFromDate)} → ${fmtDate(data.serviceToDate)}</b></div>` : ''}
      </div>

      <div id="invoiceErrorBox2" class="hidden bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg p-3 mb-3"></div>

      <div class="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-3 border-t border-gray-100">
        <button type="button" class="btn-ghost" onclick="backToEditInvoice()">← Volver a editar</button>
        <button type="button" id="invoiceConfirmBtn" class="btn-primary" onclick="confirmEmitInvoice()">🧾 Confirmar y emitir en AFIP</button>
      </div>
    </div>
  `);
}

function backToEditInvoice() {
  // Re-render the form, then restore values from _currentInvoiceForm
  const item = _currentInvoiceItem;
  const saved = _currentInvoiceForm;
  if (!item) return;
  openInvoiceModal(item);
  if (saved) {
    setTimeout(() => {
      const form = document.getElementById('invoiceForm');
      if (!form) return;
      for (const [k, v] of Object.entries(saved)) {
        const el = form.elements[k];
        if (el) el.value = v;
      }
      // sync placeholder
      if (typeof updateInvoiceDocPlaceholder === 'function') {
        updateInvoiceDocPlaceholder(saved.clientDocType || '99');
        const docInp = document.getElementById('invoiceDocNumber');
        if (docInp && saved.clientDocNumber) docInp.value = saved.clientDocNumber;
      }
    }, 20);
  }
}

function renderInvoiceLoading(currentStep) {
  // currentStep: 1 = validando, 2 = WSAA, 3 = CAE, 4 = guardando
  const step = (n, label, done, active) => `
    <div class="inv-step ${done?'done':active?'active':'pending'}">
      <div class="inv-step-dot">${done?'✓':active?'·':n}</div>
      <span class="text-sm font-medium">${label}</span>
    </div>
  `;
  return `
    <div class="p-8 inv-slide-in">
      <div class="flex flex-col items-center mb-8 mt-4">
        <div class="inv-spinner mb-5"></div>
        <h2 class="text-xl font-semibold text-gray-900">Emitiendo Factura C en AFIP</h2>
        <p class="text-sm text-gray-500 mt-1 inv-pulse-loading">No cierres la ventana...</p>
      </div>
      <div class="space-y-1.5 max-w-xs mx-auto">
        ${step(1, 'Validando datos',         currentStep > 1, currentStep === 1)}
        ${step(2, 'Autenticando con WSAA',   currentStep > 2, currentStep === 2)}
        ${step(3, 'Solicitando CAE a AFIP',  currentStep > 3, currentStep === 3)}
        ${step(4, 'Guardando comprobante',   currentStep > 4, currentStep === 4)}
      </div>
    </div>
  `;
}

async function confirmEmitInvoice() {
  if (!_currentInvoiceItem || !_currentInvoiceForm) return;
  const item = _currentInvoiceItem;
  const data = _currentInvoiceForm;

  // Reemplazá el modal entero con la pantalla de loading
  const modalContent = document.getElementById('modalContent');
  if (modalContent) modalContent.innerHTML = renderInvoiceLoading(1);

  // Pequeño delay visual para que se vea el "validando"
  await new Promise(r => setTimeout(r, 350));
  if (modalContent) modalContent.innerHTML = renderInvoiceLoading(2);
  await new Promise(r => setTimeout(r, 250));
  if (modalContent) modalContent.innerHTML = renderInvoiceLoading(3);

  try {
    const payload = {
      amount: Number(data.amount),
      concept: Number(data.concept) || 2,
      clientDocType: Number(data.clientDocType) || 99,
      clientDocNumber: data.clientDocType === '99' ? 0 : Number(String(data.clientDocNumber).replace(/[^\d]/g, '')),
      serviceFromDate: data.serviceFromDate,
      serviceToDate: data.serviceToDate,
      dueDate: data.dueDate,
    };
    const result = await callApi('/api/afip/emitir', { method: 'POST', body: payload });

    // CAE obtenido — pasamos al paso 4
    if (modalContent) modalContent.innerHTML = renderInvoiceLoading(4);
    await new Promise(r => setTimeout(r, 220));

    const incomeId = item.auto ? `auto:${item.projectId}:${item.month}` : item.id;
    const invoice = {
      id: uid(),
      incomeId,
      projectId: item.projectId || null,
      cae: result.cae,
      caeExpiry: result.caeExpiry,
      number: result.number,
      ptoVta: result.ptoVta,
      cbteTipo: result.cbteTipo,
      typeName: result.typeName || 'Factura C',
      code: `${String(result.ptoVta).padStart(5,'0')}-${String(result.number).padStart(8,'0')}`,
      date: result.date,
      amount: result.amount,
      currency: result.currency || 'PES',
      clientName: data.clientName || '',
      clientDocType: payload.clientDocType,
      clientDocNumber: payload.clientDocNumber,
      issuedAt: result.issuedAt,
      issuedBy: result.issuedBy,
      // Snapshot del item original para reconstruir PDF
      _itemConcept: item.concept,
      _projectName: item.projectId ? (getProject(item.projectId)?.name || '') : '',
      _serviceFromDate: data.serviceFromDate,
      _serviceToDate: data.serviceToDate,
      _dueDate: data.dueDate,
      _concept: payload.concept,
    };
    state.invoices = state.invoices || [];
    state.invoices.push(invoice);
    save();

    showToast(`Factura C ${invoice.code} emitida · CAE ${invoice.cae}`, 'success');
    renderInvoiceSuccess(invoice);
    // Render en background para refrescar la tabla
    render();
  } catch (err) {
    // Volvemos al preview con el error
    renderInvoicePreview();
    setTimeout(() => {
      const errBox = document.getElementById('invoiceErrorBox2');
      if (errBox) {
        errBox.innerHTML = `<b>Error de AFIP:</b> ${escapeHtml(err.message || String(err))}`;
        errBox.classList.remove('hidden');
      }
    }, 30);
  }
}

function renderInvoiceSuccess(invoice) {
  _currentInvoiceForm = null;
  _currentInvoiceItem = null;
  const fmtMoney = (n) => `$${Number(n).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  const fmtDateAfip = (s) => s && s.length === 8 ? `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}` : (s || '—');

  openModal(`
    <div class="p-8 inv-slide-in text-center">
      <div class="inv-success-circle mx-auto mb-5">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline class="inv-check-svg" points="20 6 9 17 4 12" style="stroke-dasharray:30;stroke-dashoffset:30"/>
        </svg>
      </div>
      <h2 class="text-2xl font-semibold text-gray-900">¡Factura emitida!</h2>
      <p class="text-sm text-gray-500 mt-1 mb-6">Validada por AFIP · Validez fiscal real</p>

      <div class="bg-gray-50 rounded-xl p-5 text-left mb-6 max-w-md mx-auto">
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div><div class="text-[10px] uppercase tracking-wider text-gray-500">Comprobante</div><div class="font-mono font-semibold">${escapeHtml(invoice.code)}</div></div>
          <div><div class="text-[10px] uppercase tracking-wider text-gray-500">Tipo</div><div class="font-semibold">${escapeHtml(invoice.typeName)}</div></div>
          <div class="col-span-2"><div class="text-[10px] uppercase tracking-wider text-gray-500">CAE</div><div class="font-mono font-semibold text-purple-700">${escapeHtml(invoice.cae)}</div></div>
          <div><div class="text-[10px] uppercase tracking-wider text-gray-500">Vto. CAE</div><div class="font-medium">${fmtDateAfip(invoice.caeExpiry)}</div></div>
          <div><div class="text-[10px] uppercase tracking-wider text-gray-500">Fecha</div><div class="font-medium">${fmtDateAfip(invoice.date)}</div></div>
          <div class="col-span-2 pt-2 border-t border-gray-200"><div class="text-[10px] uppercase tracking-wider text-gray-500">Total</div><div class="text-xl font-bold text-gray-900">${fmtMoney(invoice.amount)} ARS</div></div>
        </div>
      </div>

      <div class="flex flex-col-reverse sm:flex-row gap-2 justify-center max-w-md mx-auto">
        <button type="button" class="btn-ghost" onclick="closeModal()">Cerrar</button>
        <button type="button" class="btn-primary inline-flex items-center justify-center gap-2" onclick='openInvoicePdf(${JSON.stringify(invoice).replace(/"/g,"&quot;")})'>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Descargar PDF
        </button>
      </div>
    </div>
  `);
}

function openInvoiceListModal(item) {
  const invs = getAllInvoicesFor(item);
  const fmtMoney = (n) => `$${Number(n).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  const fmtDateAfip = (s) => s && s.length === 8 ? `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}` : (s || '—');
  openModal(`
    <div class="p-6 inv-slide-in">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div class="flex-1 min-w-0">
          <h2 class="text-lg font-semibold">${invs.length} Facturas emitidas</h2>
          <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(item.concept)}</p>
        </div>
        <button onclick="closeModal()" class="text-gray-400 hover:text-gray-900 text-xl leading-none shrink-0">✕</button>
      </div>
      <div class="space-y-2">
        ${invs.map(inv => `
          <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition">
            <div class="flex-1 min-w-0">
              <div class="font-mono text-sm font-semibold">${escapeHtml(inv.code)}</div>
              <div class="text-xs text-gray-500 mt-0.5">CAE ${escapeHtml(inv.cae)} · ${fmtDateAfip(inv.date)}</div>
            </div>
            <div class="text-right">
              <div class="font-semibold">${fmtMoney(inv.amount)}</div>
            </div>
            <button onclick='openInvoicePdf(${JSON.stringify(inv).replace(/"/g, "&quot;")})' class="btn-ghost text-xs px-3 py-1.5">PDF →</button>
          </div>
        `).join('')}
      </div>
    </div>
  `);
}

function openInvoicePdf(invoice) {
  // Fallback: si la factura es vieja y no tiene snapshots, reconstruir desde el income
  if (!invoice._itemConcept || !invoice._projectName) {
    const inc = invoice.incomeId && !invoice.incomeId.startsWith('auto:')
      ? state.incomes.find(i => i.id === invoice.incomeId)
      : null;
    if (inc) {
      invoice._itemConcept = invoice._itemConcept || inc.concept;
      invoice._projectName = invoice._projectName || (inc.projectId ? (getProject(inc.projectId)?.name || '') : '');
    } else if (invoice.projectId) {
      const proj = getProject(invoice.projectId);
      if (proj) invoice._projectName = invoice._projectName || proj.name;
    }
  }
  const fmtMoney = (n) => `$${Number(n).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  const fmtDateAfip = (s) => s && s.length === 8 ? `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}` : (s || '—');
  const fmtDateISO = (s) => {
    if (!s) return '—';
    const [y,m,d] = s.split('-');
    return `${d}/${m}/${y}`;
  };
  const docTypeMap = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI', 99: 'Consumidor Final' };
  const docTypeLabel = docTypeMap[invoice.clientDocType] || 'Consumidor Final';
  const docNumber = invoice.clientDocType === 99 ? '—' : (invoice.clientDocNumber || '—');
  const clientName = invoice.clientName || (invoice.clientDocType === 99 ? 'Consumidor Final' : 'Sin especificar');
  const concept = invoice._concept || 2;
  const conceptLabel = concept === 1 ? 'Productos' : concept === 3 ? 'Productos y Servicios' : 'Servicios';
  let detalle = invoice._itemConcept || 'Servicios profesionales';
  if (invoice._projectName) detalle += ` — ${invoice._projectName}`;

  // AFIP QR data (formato oficial): JSON base64
  const qrData = {
    ver: 1,
    fecha: invoice.date ? `${invoice.date.slice(0,4)}-${invoice.date.slice(4,6)}-${invoice.date.slice(6,8)}` : '',
    cuit: 20424402142,
    ptoVta: invoice.ptoVta,
    tipoCmp: invoice.cbteTipo,
    nroCmp: invoice.number,
    importe: Number(invoice.amount),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: invoice.clientDocType || 99,
    nroDocRec: Number(invoice.clientDocNumber || 0),
    tipoCodAut: 'E',
    codAut: Number(invoice.cae) || 0,
  };
  const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${btoa(JSON.stringify(qrData))}`;
  // QR como imagen (usa el servicio público de Google para generar el QR)
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}`;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(invoice.code)} · Factura C</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; padding: 0; font-size: 12px; line-height: 1.45; }
  .wrap { max-width: 800px; margin: 0 auto; }
  .head { display: grid; grid-template-columns: 1fr auto 1fr; border: 2px solid #111; border-bottom: 1px solid #111; }
  .emisor { padding: 16px; }
  .emisor h1 { margin: 0 0 4px 0; font-size: 18px; font-weight: 700; }
  .letter { border-left: 2px solid #111; border-right: 2px solid #111; padding: 12px 24px; text-align: center; background: #fafafa; }
  .letter .L { font-size: 56px; font-weight: 800; line-height: 1; color: #111; }
  .letter .cod { font-size: 10px; color: #555; margin-top: 4px; }
  .nro { padding: 16px; text-align: right; }
  .nro h2 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: 1px; }
  .nro .meta { font-size: 11px; color: #333; margin-top: 6px; }
  .nro .meta b { color: #111; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 2px solid #111; border-top: none; }
  .col { padding: 10px 16px; }
  .col + .col { border-left: 1px solid #ddd; }
  .label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
  .val { font-size: 12px; margin-top: 2px; }
  table.items { width: 100%; border-collapse: collapse; border: 2px solid #111; border-top: none; }
  table.items th { background: #f0f0f0; text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #ccc; }
  table.items td { padding: 12px 10px; vertical-align: top; font-size: 12px; }
  table.items td.r { text-align: right; }
  .totales { border: 2px solid #111; border-top: none; padding: 12px 16px; text-align: right; background: #fafafa; }
  .totales .ln { margin: 3px 0; font-size: 12px; }
  .totales .grand { font-size: 16px; font-weight: 700; border-top: 1px solid #111; padding-top: 6px; margin-top: 6px; }
  .cae-row { display: grid; grid-template-columns: 180px 1fr auto; gap: 16px; border: 2px solid #111; border-top: none; padding: 14px 16px; align-items: center; background: #fff; }
  .cae-row img { display: block; }
  .cae-info b { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }
  .footer { font-size: 10px; color: #666; text-align: center; padding: 12px 0; }
  .actions { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; z-index: 100; }
  .actions button { background: #111; color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-size: 13px; font-weight: 500; }
  .actions button.ghost { background: #fff; color: #111; border: 1px solid #ddd; }
  @media print { .actions { display: none; } body { font-size: 11px; } }
</style>
</head>
<body>
<div class="actions">
  <button class="ghost" onclick="window.close()">Cerrar</button>
  <button onclick="window.print()">Imprimir / Guardar PDF</button>
</div>
<div class="wrap">
  <div class="head">
    <div class="emisor">
      <h1>Pragma Studio</h1>
      <div>Gaspar Quintana Ruiz</div>
      <div style="margin-top:6px;font-size:11px;color:#555;">Responsable Monotributo</div>
      <div style="margin-top:6px;font-size:11px;"><b>CUIT:</b> 20-42440214-2</div>
    </div>
    <div class="letter">
      <div class="L">C</div>
      <div class="cod">COD. ${invoice.cbteTipo}</div>
    </div>
    <div class="nro">
      <h2>FACTURA</h2>
      <div class="meta">Pto Vta: <b>${String(invoice.ptoVta).padStart(5,'0')}</b></div>
      <div class="meta">Comprobante Nº: <b>${String(invoice.number).padStart(8,'0')}</b></div>
      <div class="meta">Fecha emisión: <b>${fmtDateAfip(invoice.date)}</b></div>
    </div>
  </div>

  <div class="row">
    <div class="col">
      <div class="label">Cliente</div>
      <div class="val"><b>${escapeHtml(clientName)}</b></div>
      <div class="val">${escapeHtml(docTypeLabel)}: <b>${escapeHtml(String(docNumber))}</b></div>
    </div>
    <div class="col">
      <div class="label">Condición frente al IVA</div>
      <div class="val">${invoice.clientDocType === 99 ? 'Consumidor Final' : 'A definir'}</div>
      <div class="val" style="margin-top:6px;"><span class="label" style="display:inline">Cond. de venta:</span> Contado / Transferencia</div>
    </div>
  </div>

  ${concept !== 1 ? `
  <div class="row">
    <div class="col">
      <div class="label">Servicio desde</div>
      <div class="val">${fmtDateISO(invoice._serviceFromDate)}</div>
    </div>
    <div class="col" style="grid-template-columns: 1fr 1fr; display:grid;">
      <div style="padding-right:8px;">
        <div class="label">Servicio hasta</div>
        <div class="val">${fmtDateISO(invoice._serviceToDate)}</div>
      </div>
      <div style="border-left:1px solid #ddd; padding-left:16px;">
        <div class="label">Vto. de pago</div>
        <div class="val">${fmtDateISO(invoice._dueDate)}</div>
      </div>
    </div>
  </div>
  ` : ''}

  <table class="items">
    <thead>
      <tr>
        <th style="width:60%">Descripción</th>
        <th class="r" style="width:20%">Cantidad</th>
        <th class="r" style="width:20%">Importe</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><b>${escapeHtml(detalle)}</b><div style="color:#666;font-size:11px;margin-top:2px;">Concepto: ${conceptLabel}</div></td>
        <td class="r">1</td>
        <td class="r">${fmtMoney(invoice.amount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totales">
    <div class="ln">Subtotal: <b>${fmtMoney(invoice.amount)}</b></div>
    <div class="ln" style="color:#666;">IVA: $0,00 <span style="font-size:10px">(Responsable Monotributo)</span></div>
    <div class="ln grand">TOTAL: ${fmtMoney(invoice.amount)}</div>
  </div>

  <div class="cae-row">
    <img src="${qrImg}" alt="QR AFIP" width="180" height="180" />
    <div class="cae-info">
      <div><span class="label" style="display:inline">CAE Nº:</span> <b>${escapeHtml(invoice.cae)}</b></div>
      <div style="margin-top:4px;"><span class="label" style="display:inline">Vto. CAE:</span> <b>${fmtDateAfip(invoice.caeExpiry)}</b></div>
      <div style="margin-top:8px;font-size:10px;color:#666;">Comprobante autorizado por AFIP. Esta factura tiene validez fiscal.</div>
    </div>
    <div style="font-size:10px;color:#777;text-align:center;line-height:1.3;">
      Verificá el<br/>comprobante<br/>escaneando el QR<br/>en afip.gob.ar
    </div>
  </div>

  <div class="footer">Pragma Studio · ${escapeHtml(invoice.code)} · Generado el ${new Date().toLocaleDateString('es-AR')}</div>
</div>
</body>
</html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('El navegador bloqueó la ventana. Permití pop-ups para descargar el PDF.');
    return;
  }
  w.document.write(html);
  w.document.close();
}

function updateInvoiceDocPlaceholder(docType) {
  const inp = document.getElementById('invoiceDocNumber');
  if (!inp) return;
  if (docType === '99') {
    inp.placeholder = '(no requerido)';
    inp.value = '';
  } else if (docType === '80') {
    inp.placeholder = 'CUIT (11 dígitos)';
  } else if (docType === '86') {
    inp.placeholder = 'CUIL (11 dígitos)';
  } else {
    inp.placeholder = 'DNI (7-8 dígitos)';
  }
}


async function checkAfipStatus() {
  try {
    const status = await callApi('/api/afip/estado');
    const lines = [
      `CUIT: ${status.cuit || '—'}`,
      `PV: ${status.ptoVta || '—'}`,
      `Producción: ${status.production ? 'SÍ' : 'no (homologación)'}`,
      `AFIP: ${status.afipConnection === 'ok' ? '✓ conectado' : '✗ ' + (status.afipError || 'error')}`,
      `Último Factura C: ${status.lastFacturaC ?? '—'}`,
    ];
    alert('Estado AFIP\n\n' + lines.join('\n'));
  } catch (err) {
    alert('Error: ' + (err.message || String(err)));
  }
}

function reactivateRecurringExpense(expenseId) {
  const e = state.expenses.find(x => x.id === expenseId);
  if (!e) return;
  e.recurringEndDate = null;
  save(); render();
  showToast('Gasto fijo reactivado', 'success');
}

// Borrado total: elimina el gasto + todo el historial de pagos recurrentes
function deleteRecurringExpenseFull(expenseId) {
  const e = state.expenses.find(x => x.id === expenseId);
  if (!e) return;
  const paymentsCount = (state.recurringExpensePayments || []).filter(r => r.expenseId === expenseId).length;
  const detail = paymentsCount > 0
    ? `\n\nSe va a borrar el gasto original y los ${paymentsCount} pago${paymentsCount>1?'s':''} registrado${paymentsCount>1?'s':''}.`
    : '';
  if (!confirm(`¿Eliminar completamente "${e.concept}"?${detail}\n\nEsto NO se puede deshacer.`)) return;
  state.expenses = state.expenses.filter(x => x.id !== expenseId);
  state.recurringExpensePayments = (state.recurringExpensePayments || []).filter(r => r.expenseId !== expenseId);
  save(); render();
  showToast('Gasto eliminado completamente', 'success');
}

function inRange(date, from, to) {
  return date >= from && date <= to;
}

function fmtAmount(n, currency) {
  const c = currency || state.defaultCurrency || 'ARS';
  const symbol = c === 'USD' ? 'US$' : '$';
  return symbol + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function toBaseCurrency(amount, fromCurrency, toCurrency) {
  const from = fromCurrency || 'ARS';
  const to = toCurrency || state.defaultCurrency || 'ARS';
  if (from === to) return Number(amount);
  const rate = Number(state.exchangeRate) || 1200;
  if (from === 'USD' && to === 'ARS') return Number(amount) * rate;
  if (from === 'ARS' && to === 'USD') return Number(amount) / rate;
  return Number(amount);
}

function convertAt(amount, fromCurrency, toCurrency, rate) {
  const from = fromCurrency || 'ARS';
  const to = toCurrency || state.defaultCurrency || 'ARS';
  if (from === to) return Number(amount);
  const r = Number(rate) || 1200;
  if (from === 'USD' && to === 'ARS') return Number(amount) * r;
  if (from === 'ARS' && to === 'USD') return Number(amount) / r;
  return Number(amount);
}

// Cotización efectiva del item: la "congelada" si fue confirmado, o la actual si está pendiente
function getEffectiveRate(item) {
  if (item.auto) {
    if (item.sourceExpenseId) {
      // Gasto fijo auto: chequear log de pagos recurrentes
      const record = getExpensePaymentRecord(item.sourceExpenseId, item.month);
      if (record && record.exchangeRate) return Number(record.exchangeRate);
    } else {
      // Mensualidad de proyecto
      const record = getChargeRecord(item.projectId, item.month);
      if (record && record.exchangeRate) return Number(record.exchangeRate);
    }
  } else if (item.exchangeRateAtTime) {
    return Number(item.exchangeRateAtTime);
  }
  return Number(state.exchangeRate) || 1200;
}

function toBaseCurrencyForItem(item, toCurrency) {
  return convertAt(item.amount, item.currency, toCurrency, getEffectiveRate(item));
}

// ---- USD exchange rate → src/services/exchange.js ----
// DOLAR_SOURCES, fetchBluelyticsBlue, autoFetchBlueIfStale, fetchDollarRate (importados arriba).

function openExchangeRateModal() {
  const updatedLabel = state.exchangeRateUpdatedAt
    ? new Date(state.exchangeRateUpdatedAt).toLocaleString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
    : 'nunca';
  let srcLabel = 'Manual';
  if (state.exchangeRateSource === 'bluelytics') srcLabel = 'Blue (Bluelytics)';
  else if (state.exchangeRateSource && state.exchangeRateSource !== 'manual') {
    srcLabel = DOLAR_SOURCES.find(s => s.key === state.exchangeRateSource)?.label || state.exchangeRateSource;
  }

  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-1">Cotización del dólar</h2>
      <p class="text-sm text-gray-500 mb-4">Actualizada: ${updatedLabel} · Fuente: ${srcLabel}</p>

      <div class="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4 mb-4">
        <div class="flex items-center justify-between mb-2">
          <div>
            <div class="text-xs uppercase tracking-wider text-blue-700 font-semibold">Dólar Blue automático</div>
            <div class="text-xs text-blue-600 mt-0.5">Bluelytics · usado para todas las conversiones</div>
          </div>
          <button onclick="fetchBluelyticsBlue().then(closeModal)" class="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center gap-2 transition">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
            Actualizar ahora
          </button>
        </div>
      </div>

      <form onsubmit="saveManualRate(event)" class="space-y-3">
        <div>
          <label class="text-xs text-gray-500">Valor manual (ARS por USD)</label>
          <div class="flex gap-2">
            <input type="number" step="1" name="rate" class="input flex-1 text-lg font-semibold" value="${state.exchangeRate || 1200}" autofocus />
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>

      <details class="mt-5 pt-4 border-t border-gray-100">
        <summary class="text-xs text-gray-500 uppercase tracking-wider font-semibold cursor-pointer hover:text-gray-900">Otras cotizaciones (dolarapi.com)</summary>
        <div class="grid grid-cols-2 gap-2 mt-3">
          ${DOLAR_SOURCES.map(s => `
            <button onclick="fetchDollarRate('${s.key}'); closeModal()" class="text-left p-3 rounded-lg border border-gray-200 hover:border-black hover:bg-gray-50 transition">
              <div class="font-medium text-sm">${s.label}</div>
              <div class="text-xs text-gray-500">${s.desc}</div>
            </button>
          `).join('')}
        </div>
      </details>
    </div>
  `);
}

function saveManualRate(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const rate = Number(data.rate);
  if (!rate || isNaN(rate)) return alert('Valor inválido');
  state.exchangeRate = rate;
  state.exchangeRateSource = 'manual';
  state.exchangeRateUpdatedAt = new Date().toISOString();
  save();
  closeModal();
  showToast('Cotización actualizada', 'success');
  render();
}

const PAYMENT_VARS = [
  { key: 'name',    label: 'Nombre contacto', resolve: (p, i) => p.contactName || '' },
  { key: 'client',  label: 'Cliente',         resolve: (p, i) => p.contactName || p.name || '' },
  { key: 'project', label: 'Proyecto',        resolve: (p, i) => p.name || '' },
  { key: 'company', label: 'Empresa',         resolve: (p, i) => p.companyName || p.name || '' },
  { key: 'role',    label: 'Cargo',           resolve: (p, i) => p.contactRole || '' },
  { key: 'month',   label: 'Mes',             resolve: (p, i) => {
      const [y, mm] = (i.month || i.date || '').split('-');
      return mm ? `${MONTH_NAMES_FULL[Number(mm)-1]} ${y}` : '';
    } },
  // {amount} → SIEMPRE convertido a moneda base (ARS por defecto) al cambio actual
  { key: 'amount', label: 'Monto (moneda base)', resolve: (p, i) => {
      const base = state.defaultCurrency || 'ARS';
      const rate = Number(state.exchangeRate) || 1200;
      const converted = convertAt(i.amount, i.currency, base, rate);
      return fmtAmount(converted, base);
    } },
  { key: 'amountOriginal', label: 'Monto original', resolve: (p, i) => fmtAmount(i.amount, i.currency) },
  { key: 'amountARS',  label: 'Monto en ARS hoy', resolve: (p, i) => {
      if (i.currency === 'ARS') return fmtAmount(i.amount, 'ARS');
      const rate = Number(state.exchangeRate) || 1200;
      return fmtAmount(Number(i.amount) * rate, 'ARS');
    } },
  { key: 'amountUSD',  label: 'Monto en USD hoy', resolve: (p, i) => {
      if (i.currency === 'USD') return fmtAmount(i.amount, 'USD');
      const rate = Number(state.exchangeRate) || 1200;
      return fmtAmount(Number(i.amount) / rate, 'USD');
    } },
  { key: 'rate',    label: 'Cotización USD',  resolve: () => '$' + (Number(state.exchangeRate)||1200).toLocaleString('es-AR') },
  { key: 'date',    label: 'Fecha hoy',       resolve: () => new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' }) },
];

function buildPaymentMessage(income) {
  const p = getProject(income.projectId);
  if (!p) return '';
  let msg = state.paymentMessageTemplate || '';
  PAYMENT_VARS.forEach(v => {
    // Función como reemplazo: evita interpretar $ como backreference
    msg = msg.replace(new RegExp(`\\{${v.key}\\}`, 'g'), () => String(v.resolve(p, income) ?? ''));
  });
  return msg;
}

function sendPaymentReminder(income) {
  const p = getProject(income.projectId);
  if (!p) return;
  if (!p.contactPhone) {
    alert('Este proyecto no tiene WhatsApp del cliente cargado. Editá el proyecto para agregarlo.');
    return;
  }
  openPaymentMessageModal(income);
}

let _currentPaymentIncome = null;

function openPaymentMessageModal(income) {
  _currentPaymentIncome = income;
  const p = getProject(income.projectId);
  const phone = (p.contactPhone || '').replace(/[^\d]/g, '');
  const msg = buildPaymentMessage(income);
  const itemCurrency = income.currency || 'ARS';
  const base = state.defaultCurrency || 'ARS';
  const rate = Number(state.exchangeRate) || 1200;
  const showCurrencyWarning = itemCurrency === 'ARS' && Number(income.amount) > 0 && Number(income.amount) <= 200;

  openModal(`
    <div class="p-6">
      <div class="flex items-center gap-2 mb-1">
        <span class="w-8 h-8 rounded-lg bg-green-600 text-white flex items-center justify-center flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
        </span>
        <h2 class="text-xl font-semibold">Recordatorio de pago</h2>
      </div>
      <p class="text-sm text-gray-500 mb-3">
        Para <b>${escapeHtml(p.contactName || p.name)}</b>
        · ${escapeHtml(p.contactPhone)}
      </p>

      <div class="bg-gray-50 rounded-lg p-3 mb-4 flex items-center justify-between text-sm">
        <div>
          <div class="text-xs text-gray-500">Mensualidad original</div>
          <div class="font-semibold">${fmtAmount(income.amount, itemCurrency)} <span class="text-xs text-gray-500 font-normal">${itemCurrency}</span></div>
        </div>
        ${itemCurrency !== base ? `
          <div class="text-right">
            <div class="text-xs text-gray-500">Al cambio actual</div>
            <div class="font-semibold">${fmtAmount(convertAt(income.amount, itemCurrency, base, rate), base)} <span class="text-xs text-gray-500 font-normal">${base}</span></div>
          </div>
        ` : ''}
        <button onclick="closeModal(); openProjectModal('${p.id}')" class="ml-2 text-xs text-blue-600 hover:underline whitespace-nowrap">Cambiar</button>
      </div>

      ${showCurrencyWarning ? `
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900">
          <b>¿Está bien la moneda?</b> El monto es ${fmtAmount(income.amount, itemCurrency)} en <b>${itemCurrency}</b>. Si en realidad cobrás <b>US$${income.amount}</b>, editá el proyecto y cambiá la moneda a USD.
          <button onclick="closeModal(); openProjectModal('${p.id}')" class="block mt-2 text-blue-700 underline">Editar proyecto →</button>
        </div>
      ` : ''}

      <label class="text-xs text-gray-500 font-semibold">Mensaje</label>
      <textarea id="paymentMsgText" class="input mt-1" rows="10" style="white-space:pre-wrap">${escapeHtml(msg)}</textarea>
      <p class="text-[11px] text-gray-500 mt-1">Editá lo que necesites antes de enviar. El mensaje se abrirá en WhatsApp para que vos lo mandes.</p>

      <div class="flex items-center gap-2 mt-3 text-xs text-gray-500">
        <button type="button" onclick="resetPaymentMsg()" class="text-blue-600 hover:underline">↺ Restaurar desde plantilla</button>
        <span>·</span>
        <button type="button" onclick="closeModal(); go('team')" class="text-blue-600 hover:underline">✎ Editar plantilla para próximas</button>
      </div>

      <div class="flex justify-end gap-2 pt-4 border-t border-gray-100 mt-4">
        <button onclick="closeModal()" class="btn-ghost">Cancelar</button>
        <button onclick="copyPaymentMsg()" class="btn-ghost" title="Copiar al portapapeles">📋 Copiar</button>
        <button onclick="sendPaymentNow('${phone}')" class="btn-primary" style="background:#16a34a">Enviar por WhatsApp</button>
      </div>
    </div>
  `);
}

function resetPaymentMsg() {
  if (!_currentPaymentIncome) return;
  const msg = buildPaymentMessage(_currentPaymentIncome);
  document.getElementById('paymentMsgText').value = msg;
  showToast('Mensaje restaurado', 'info', 1500);
}

function copyPaymentMsg() {
  const text = document.getElementById('paymentMsgText').value;
  navigator.clipboard.writeText(text).then(() => {
    showToast('✓ Copiado al portapapeles', 'success', 2000);
  });
}

function sendPaymentNow(phone) {
  const text = document.getElementById('paymentMsgText').value;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  closeModal();
}

function monthBalance(month) {
  const m = month || financeMonth;
  const inc = state.incomes.filter(i => i.date && i.date.startsWith(m)).reduce((a,b) => a + Number(b.amount||0), 0);
  const autoInc = getAutoIncomes(m).reduce((a,b) => a + Number(b.amount||0), 0);
  const exp = state.expenses.filter(e => e.date && e.date.startsWith(m)).reduce((a,b) => a + Number(b.amount||0), 0);
  return inc + autoInc - exp;
}

function setFinanceMode(m) { financeMode = m; render(); }

function setBaseCurrency(cur) {
  state.defaultCurrency = (cur === 'ARS' ? 'ARS' : 'USD');
  save();
  render();
}

function openFinanceBreakdown(kind) {
  const audit = window._financeAudit;
  if (!audit) { alert('Recargá la página y probá de nuevo'); return; }
  const rows = kind === 'income' ? audit.income : audit.expense;
  const totalARS = kind === 'income' ? audit.totalIncARS : audit.totalExpARS;
  const totalUSD = kind === 'income' ? audit.totalIncUSD : audit.totalExpUSD;
  const baseCur = audit.baseCur;
  const title = kind === 'income' ? 'Detalle de Cobrado' : 'Detalle de Pagado';
  const color = kind === 'income' ? 'text-green-700' : 'text-red-600';
  const rateNow = Number(state.exchangeRate) || 1200;

  // Ordenamos por mes y monto descendente
  const sorted = [...rows].sort((a,b) => a.monthKey.localeCompare(b.monthKey) || b.arsAmt - a.arsAmt);

  openModal(`
    <div class="p-6 inv-slide-in">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 class="text-lg font-semibold">${title}</h2>
          <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(audit.label)} · Tipo cambio actual $${rateNow.toLocaleString('es-AR')}</p>
        </div>
        <button onclick="closeModal()" class="text-gray-400 hover:text-gray-900 text-xl leading-none">✕</button>
      </div>

      <div class="bg-gray-50 rounded-lg p-4 mb-4 grid grid-cols-2 gap-3">
        <div>
          <div class="text-[10px] uppercase tracking-wider text-gray-500">Total en ARS</div>
          <div class="text-lg font-bold ${color}">${fmtAmount(totalARS, 'ARS')}</div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-wider text-gray-500">Total en USD</div>
          <div class="text-lg font-bold ${color}">${fmtAmount(totalUSD, 'USD')}</div>
        </div>
      </div>

      <div class="text-xs text-gray-500 mb-2 flex items-center justify-between">
        <span>${sorted.length} contribuciones · cada pago con su cotización congelada</span>
      </div>

      <div class="max-h-96 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
        ${sorted.length === 0 ? '<div class="p-6 text-center text-gray-400 text-sm">Sin movimientos en el período.</div>' : sorted.map(r => {
          const [yy, mm] = r.monthKey.split('-');
          const monthLabel = `${MONTH_NAMES_SHORT[Number(mm)-1]} '${yy.slice(2)}`;
          const it = r.it;
          const isCarry = it._carryOver;
          const isForeign = it._foreignPayment;
          const chipLabel = isCarry ? `arrastre ${it._carryOverFrom || ''}` : isForeign ? `arrastre ${it._originalPeriod || ''}` : (it.auto ? 'auto' : 'manual');
          const p = it.projectId ? getProject(it.projectId) : null;
          return `
            <div class="flex items-center gap-3 p-3 hover:bg-gray-50">
              <div class="text-[10px] font-semibold text-gray-500 uppercase w-14 shrink-0">${monthLabel}</div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">${escapeHtml(it.concept || '')}</div>
                <div class="text-[10px] text-gray-500 mt-0.5">${escapeHtml(chipLabel)}${p ? ' · ' + escapeHtml(p.name) : ''}</div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-sm font-semibold ${color}">${fmtAmount(baseCur === 'USD' ? r.usdAmt : r.arsAmt, baseCur)}</div>
                <div class="text-[10px] text-gray-400">${fmtAmount(baseCur === 'USD' ? r.arsAmt : r.usdAmt, baseCur === 'USD' ? 'ARS' : 'USD')}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <div class="mt-3 text-[11px] text-gray-500 leading-relaxed">
        <b>Cash basis</b>: cada pago cuenta en el mes en que se hizo, no en el período del comprobante.
        Los importes en la otra moneda usan el <b>tipo de cambio congelado al momento del pago</b>.
      </div>

      <div class="flex justify-end pt-4 mt-4 border-t border-gray-100">
        <button class="btn-ghost" onclick="closeModal()">Cerrar</button>
      </div>
    </div>
  `);
}

function getDisplayYear() {
  if (financeMode === 'year') return Number(financeYear);
  if (financeMode === 'range') return Number((financeFrom || todayISO()).slice(0,4));
  return Number((financeMonth || todayISO()).slice(0,4));
}

function navYear(delta) {
  const y = getDisplayYear() + delta;
  if (financeMode === 'year') {
    financeYear = String(y);
  } else if (financeMode === 'month') {
    const mm = financeMonth.slice(5, 7);
    financeMonth = `${y}-${mm}`;
  } else if (financeMode === 'range') {
    // Shift range by 1 year
    const shiftDate = (d) => {
      const [yy, mm, dd] = d.split('-');
      return `${Number(yy)+delta}-${mm}-${dd}`;
    };
    if (financeFrom) financeFrom = shiftDate(financeFrom);
    if (financeTo)   financeTo   = shiftDate(financeTo);
    financeYear = String(y);
  }
  render();
}

function selectFinanceMonth(monthKey) {
  financeMode = 'month';
  financeMonth = monthKey;
  render();
}

function openRangePickerInline() {
  if (financeMode === 'range') {
    // Si ya estaba activo, vuelvo al mes actual
    financeMode = 'month';
  } else {
    financeMode = 'range';
    // Inicializar rango si no estaba
    if (!financeFrom) financeFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10);
    if (!financeTo) financeTo = todayISO();
  }
  render();
}

function renderFinance() {
  const { from, to, label } = getFinanceRange();
  const baseCur = state.defaultCurrency || 'ARS';

  const realInc = state.incomes.filter(i => i.date && inRange(i.date, from, to))
    .map(i => ({ ...i, status: i.status || 'CONFIRMED' }));
  const autoInc = getAutoIncomesInRange(from, to);
  const realExp = state.expenses.filter(e => e.date && inRange(e.date, from, to))
    .map(e => ({ ...e, status: e.status || 'PAID' }));
  const autoExp = getAutoExpensesInRange(from, to);

  // Arrastres sólo en vista de Mes individual
  const carryOvers = financeMode === 'month' ? getCarryOversForMonth(financeMonth) : { incomes: [], expenses: [] };
  const inc = [...autoInc, ...realInc, ...carryOvers.incomes];
  const exp = [...autoExp, ...realExp, ...carryOvers.expenses];

  // Totals in base currency, separated by confirmed/pending
  // Mark _kind on items for summary lookup
  const incWithKind = inc.map(i => ({ ...i, _kind: 'income' }));
  const expWithKind = exp.map(e => ({ ...e, _kind: 'expense' }));

  function paidPart(item) {
    if (item._carryOver) return 0; // Ya se contó en su mes original
    const s = getPaymentSummary(item);
    const ratio = s.expected > 0 ? s.totalPaid / s.expected : 0;
    return toBaseCurrencyForItem(item, baseCur) * ratio;
  }
  function pendingPart(item) {
    const s = getPaymentSummary(item);
    const ratio = s.expected > 0 ? s.remaining / s.expected : 1;
    return toBaseCurrencyForItem(item, baseCur) * ratio;
  }

  const isIncConfirmed = (i) => {
    const s = getPaymentSummary(i);
    return s.status === 'PAID';
  };
  const isExpPaid = (e) => {
    const s = getPaymentSummary(e);
    return s.status === 'PAID';
  };

  // ===== Helper: cobrado/pagado de un item DENTRO de un rango de fechas =====
  // Filtra los pagos del item por la fecha real del pago y los suma en targetCur,
  // usando la cotización CONGELADA de cada pago (no mezcla denominaciones).
  function paidInRangeBase(item, mFrom, mTo, targetCur) {
    const s = getPaymentSummary(item);
    return s.payments
      .filter(p => {
        const d = (p.date || p.paidAt || p.chargedAt || '').slice(0, 10);
        return d && d >= mFrom && d <= mTo;
      })
      .reduce((sum, p) => {
        const amt = p.amount != null ? Number(p.amount) : s.expected;
        const cur = p.currency || item.currency || 'ARS';
        const rate = Number(p.exchangeRate) || Number(state.exchangeRate) || 1200;
        return sum + convertAt(amt, cur, targetCur, rate);
      }, 0);
  }
  function paidInMonthBase(item, monthKey, targetCur) {
    const lastDay = String(new Date(Number(monthKey.slice(0,4)), Number(monthKey.slice(5,7)), 0).getDate()).padStart(2,'0');
    return paidInRangeBase(item, `${monthKey}-01`, `${monthKey}-${lastDay}`, targetCur);
  }

  // Los totales se calculan MÁS ABAJO, iterando cada fila visible (así lo mostrado en la tabla
  // coincide exactamente con las cards). Esto va después de construir itemsByMonth.
  // Placeholders para no romper referencias tempranas:
  let incTotalARSFinal = 0, incTotalUSDFinal = 0, expTotalARSFinal = 0, expTotalUSDFinal = 0;
  let incTotalConfirmed = 0, expTotalPaid = 0;
  let incTotalPending = 0, expTotalPending = 0;
  let balanceARS = 0, balanceUSD = 0, balance = 0, margin = 0;

  // Detalle de contribuciones (para panel de auditoría clickeable)
  const rowContribInc = []; // { it, monthKey, arsAmt, usdAmt, kind, label }
  const rowContribExp = [];

  // Cash-flow real (panel auditoría)
  const allIncomeCashFlow = getAllCashFlowPayments('income');
  const allExpenseCashFlow = getAllCashFlowPayments('expense');
  const incomeInRange  = allIncomeCashFlow.filter(p => p.date && inRange(p.date, from, to));
  const expenseInRange = allExpenseCashFlow.filter(p => p.date && inRange(p.date, from, to));

  // Breakdown per month — también cash basis
  const monthsInRange = monthsBetween(from, to);
  const showBreakdown = monthsInRange.length > 1;
  const sumCashIn = (payments, mFrom, mTo, targetCur) => payments
    .filter(p => p.date && p.date >= mFrom && p.date <= mTo)
    .reduce((sum, p) => sum + convertAt(p.amount, p.currency, targetCur, p.exchangeRate), 0);
  const monthlyData = showBreakdown ? monthsInRange.map(m => {
    const lastDay = String(new Date(Number(m.slice(0,4)), Number(m.slice(5,7)), 0).getDate()).padStart(2,'0');
    const mFrom = `${m}-01`, mTo = `${m}-${lastDay}`;
    const i = sumCashIn(allIncomeCashFlow, mFrom, mTo, baseCur);
    const e = sumCashIn(allExpenseCashFlow, mFrom, mTo, baseCur);
    return { month: m, income: i, expense: e, balance: i - e };
  }) : [];
  const maxAbs = Math.max(1, ...monthlyData.map(d => Math.max(d.income, d.expense)));

  // ===== Construcción de filas: cash basis =====
  // Cada par (mes, item) genera UNA fila. Un mismo item puede aparecer en varios meses
  // si tuvo pagos en distintos meses (ej: 50% mayo + 50% julio → 2 filas).
  const itemsByMonth = {};
  const rowSeen = new Set(); // `${monthKey}|${itemKey}`
  function addRow(m, item) {
    // Key unificado para prevenir DOBLE FILA por mismo item en mismo mes
    // (evita: carry-over + foreign-payment del mismo item → se sumaría 2 veces)
    const itemKey = item.auto
      ? `${item._kind}-auto:${item.projectId || item.sourceExpenseId}:${item.month}`
      : `${item._kind}:${item.id}`;
    const k = `${m}|${itemKey}`;
    if (rowSeen.has(k)) return;
    rowSeen.add(k);
    if (!itemsByMonth[m]) itemsByMonth[m] = [];
    itemsByMonth[m].push({ ...item, _monthKey: m });
  }

  // (A) Items en su PERÍODO ORIGINAL dentro del rango (incluye carry-overs en vista mes)
  inc.forEach(i => {
    const m = i._carryOver ? financeMonth : (i.month || i.date || '').slice(0,7);
    addRow(m, { ...i, _kind: 'income' });
  });
  exp.forEach(e => {
    const m = e._carryOver ? financeMonth : (e.date || '').slice(0,7);
    addRow(m, { ...e, _kind: 'expense' });
  });

  // (B) Items con PAGOS dentro del rango pero período en OTRO mes → aparecen también en el mes del pago
  function addForeignPaymentRows() {
    (state.incomePayments || []).forEach(p => {
      const inc = state.incomes.find(x => x.id === p.incomeId);
      if (!inc) return;
      const d = (p.date || p.paidAt || '').slice(0,10);
      if (!d || !inRange(d, from, to)) return;
      const payM = d.slice(0,7);
      const itemM = (inc.date || '').slice(0,7);
      if (payM === itemM) return; // ya está en (A)
      addRow(payM, { ...inc, _kind: 'income', _foreignPayment: true, _originalPeriod: itemM });
    });
    (state.expensePayments || []).forEach(p => {
      const exp = state.expenses.find(x => x.id === p.expenseId);
      if (!exp) return;
      const d = (p.date || p.paidAt || '').slice(0,10);
      if (!d || !inRange(d, from, to)) return;
      const payM = d.slice(0,7);
      const itemM = (exp.date || '').slice(0,7);
      if (payM === itemM) return;
      addRow(payM, { ...exp, _kind: 'expense', _foreignPayment: true, _originalPeriod: itemM });
    });
    (state.recurringChargeLog || []).forEach(r => {
      const d = (r.date || r.chargedAt || '').slice(0,10);
      if (!d || !inRange(d, from, to)) return;
      const payM = d.slice(0,7);
      if (payM === r.month) return;
      const lastDay = String(new Date(Number(r.month.slice(0,4)), Number(r.month.slice(5,7)), 0).getDate()).padStart(2,'0');
      const autos = getAutoIncomesInRange(`${r.month}-01`, `${r.month}-${lastDay}`);
      const match = autos.find(a => a.projectId === r.projectId && a.month === r.month);
      if (match) addRow(payM, { ...match, _kind: 'income', _foreignPayment: true, _originalPeriod: r.month });
    });
    (state.recurringExpensePayments || []).forEach(r => {
      const d = (r.date || r.paidAt || '').slice(0,10);
      if (!d || !inRange(d, from, to)) return;
      const payM = d.slice(0,7);
      if (payM === r.month) return;
      const lastDay = String(new Date(Number(r.month.slice(0,4)), Number(r.month.slice(5,7)), 0).getDate()).padStart(2,'0');
      const autos = getAutoExpensesInRange(`${r.month}-01`, `${r.month}-${lastDay}`);
      const match = autos.find(a => a.sourceExpenseId === r.expenseId && a.month === r.month);
      if (match) addRow(payM, { ...match, _kind: 'expense', _foreignPayment: true, _originalPeriod: r.month });
    });
  }
  addForeignPaymentRows();

  Object.keys(itemsByMonth).forEach(m => {
    // Arrastres primero, luego foreign-payment, luego AUTO, luego manuales
    itemsByMonth[m].sort((a,b) =>
      (b._carryOver?1:0) - (a._carryOver?1:0)
      || (b._foreignPayment?1:0) - (a._foreignPayment?1:0)
      || (b.auto?1:0) - (a.auto?1:0)
      || (a.concept||'').localeCompare(b.concept||'')
    );
  });
  const sortedMonths = Object.keys(itemsByMonth).sort();

  // ===== TOTALES ROW-BASED =====
  // Iteramos cada fila visible y sumamos SOLO lo cobrado/pagado este mes.
  // Así el total = suma de lo que se ve en la columna INGRESO/EGRESO.
  sortedMonths.forEach(m => {
    itemsByMonth[m].forEach(it => {
      const isInc = it._kind === 'income';
      // Cash contribution del row = pagos hechos en este mes por este item.
      // Los carry-overs pueden tener un pago del mes actual (parcial) → cuenta.
      // Sin pago en el mes → 0 (solo pendiente, no cobrado).
      const arsAmt = paidInMonthBase(it, m, 'ARS');
      const usdAmt = paidInMonthBase(it, m, 'USD');
      if (arsAmt > 0.001 || usdAmt > 0.001) {
        const entry = { it, monthKey: m, arsAmt, usdAmt };
        if (isInc) { rowContribInc.push(entry); incTotalARSFinal += arsAmt; incTotalUSDFinal += usdAmt; }
        else       { rowContribExp.push(entry); expTotalARSFinal += arsAmt; expTotalUSDFinal += usdAmt; }
      }
    });
  });

  // Pendiente: items del período con saldo sin pagar (SOLO en vista mes)
  // Sumado en baseCur al tipo de cambio ACTUAL (porque aún no se cobró)
  const _rateNow = Number(state.exchangeRate) || 1200;
  const _pendingInBase = (item) => {
    const s = getPaymentSummary(item);
    if (item._carryOver) {
      const remaining = Number(item._carryOverRemaining) || 0;
      return convertAt(remaining, item.currency || 'ARS', baseCur, _rateNow);
    }
    return convertAt(s.remaining, item.currency || 'ARS', baseCur, _rateNow);
  };
  incTotalPending = (incWithKind || []).reduce((a, i) => a + _pendingInBase(i), 0);
  expTotalPending = (expWithKind || []).reduce((a, e) => a + _pendingInBase(e), 0);

  incTotalConfirmed = baseCur === 'USD' ? incTotalUSDFinal : incTotalARSFinal;
  expTotalPaid      = baseCur === 'USD' ? expTotalUSDFinal : expTotalARSFinal;
  balanceARS = incTotalARSFinal - expTotalARSFinal;
  balanceUSD = incTotalUSDFinal - expTotalUSDFinal;
  balance = baseCur === 'USD' ? balanceUSD : balanceARS;
  margin = incTotalConfirmed > 0 ? Math.round(balance / incTotalConfirmed * 100) : 0;

  // Exponer para openFinanceBreakdown
  window._financeAudit = {
    income: rowContribInc,
    expense: rowContribExp,
    baseCur,
    label,
    totalIncARS: incTotalARSFinal, totalIncUSD: incTotalUSDFinal,
    totalExpARS: expTotalARSFinal, totalExpUSD: expTotalUSDFinal,
  };

  // Year selector options
  const allYears = (() => {
    const yrs = new Set([new Date().getFullYear()]);
    state.incomes.forEach(i => i.date && yrs.add(Number(i.date.slice(0,4))));
    state.expenses.forEach(e => e.date && yrs.add(Number(e.date.slice(0,4))));
    state.projects.forEach(p => p.startDate && yrs.add(Number(p.startDate.slice(0,4))));
    return [...yrs].sort((a,b) => b-a);
  })();

  const displayYear = getDisplayYear();
  const showPending = financeMode === 'month';  // pending solo en vista mes

  return `
    <div class="px-4 md:px-10 pt-8 md:pt-10 pb-4">
      <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Finanzas</h1>
          <p class="text-gray-500 mt-1 text-sm">${label}</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-ghost" onclick="openIncomeModal()">+ Ingreso</button>
          <button class="btn-primary" onclick="openExpenseModal()">+ Gasto</button>
        </div>
      </div>

      <div class="space-y-2">
        <!-- Año navigation + USD chip -->
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-0.5 bg-gray-100 rounded-lg p-1">
            <button onclick="navYear(-1)" class="px-2 py-1 rounded-md hover:bg-white transition text-sm">‹</button>
            <span class="px-2 text-sm font-semibold min-w-[50px] text-center">${displayYear}</span>
            <button onclick="navYear(1)" class="px-2 py-1 rounded-md hover:bg-white transition text-sm">›</button>
          </div>
          <button onclick="setFinanceMode('year')" class="px-3 py-1.5 rounded-lg text-sm ${financeMode==='year'?'bg-black text-white':'bg-gray-100 text-gray-700 hover:bg-gray-200'} transition">Año completo</button>
          <button onclick="openRangePickerInline()" class="px-3 py-1.5 rounded-lg text-sm ${financeMode==='range'?'bg-black text-white':'bg-gray-100 text-gray-700 hover:bg-gray-200'} transition">Rango custom</button>

          <span class="hidden sm:inline text-gray-300">·</span>
          <div class="flex items-center gap-0.5 bg-gray-100 rounded-lg p-1" title="Moneda principal de display">
            <button onclick="setBaseCurrency('USD')" class="px-2.5 py-1 rounded-md text-xs font-semibold transition ${baseCur==='USD'?'bg-white shadow-sm text-gray-900':'text-gray-500 hover:text-gray-700'}">USD</button>
            <button onclick="setBaseCurrency('ARS')" class="px-2.5 py-1 rounded-md text-xs font-semibold transition ${baseCur==='ARS'?'bg-white shadow-sm text-gray-900':'text-gray-500 hover:text-gray-700'}">ARS</button>
          </div>
          <button onclick="openExchangeRateModal()" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-black hover:bg-gray-50 transition text-sm" title="${state.exchangeRateSource === 'bluelytics' ? 'Dólar blue auto · Bluelytics' : 'Cotización del dólar'}">
            ${state.exchangeRateSource === 'bluelytics' ? '<span class="w-2 h-2 rounded-full bg-green-500"></span>' : ''}
            <span class="text-gray-500 text-xs">${state.exchangeRateSource === 'bluelytics' ? 'Blue' : 'TC'}</span>
            <span class="font-semibold">$${(state.exchangeRate || 1200).toLocaleString('es-AR')}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-400"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
          </button>
        </div>

        <!-- Month pills (Ene-Dic) -->
        <div class="flex flex-wrap gap-1">
          ${MONTH_NAMES_SHORT.map((mName, idx) => {
            const mNum = String(idx+1).padStart(2,'0');
            const mKey = `${displayYear}-${mNum}`;
            const active = financeMode === 'month' && financeMonth === mKey;
            const isCurrent = mKey === new Date().toISOString().slice(0,7);
            return `<button onclick="selectFinanceMonth('${mKey}')" class="px-3 py-1.5 rounded-md text-sm transition ${active?'bg-black text-white':isCurrent?'bg-blue-50 text-blue-700 hover:bg-blue-100':'bg-gray-100 text-gray-700 hover:bg-gray-200'}">${mName}</button>`;
          }).join('')}
        </div>

        <!-- Range picker inline (visible only in range mode) -->
        ${financeMode === 'range' ? `
          <div class="flex flex-wrap items-center gap-2 pt-1">
            <span class="text-xs text-gray-500 uppercase tracking-wider">Rango:</span>
            <input type="date" class="input max-w-[150px]" value="${financeFrom}" onchange="financeFrom=this.value; render()" />
            <span class="text-gray-400 text-sm">→</span>
            <input type="date" class="input max-w-[150px]" value="${financeTo}" onchange="financeTo=this.value; render()" />
          </div>
        ` : ''}
      </div>
    </div>

    <div class="px-4 md:px-10 pb-10 space-y-4 md:space-y-6">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div class="card p-4 md:p-5 cursor-pointer hover:ring-2 hover:ring-green-200 transition" onclick="openFinanceBreakdown('income')" title="Click para ver el detalle de cada suma">
          <div class="text-xs text-gray-500 flex items-center gap-1">${showPending ? 'Cobrado' : 'Ingresos'} <span class="text-gray-300">ⓘ</span></div>
          <div class="text-xl md:text-2xl font-semibold text-green-700">${fmtAmount(baseCur==='USD'?incTotalUSDFinal:incTotalARSFinal, baseCur)}</div>
          ${showPending && incTotalPending > 0 ? `<div class="text-[11px] text-amber-700 mt-1">+ ${fmtAmount(incTotalPending, baseCur)} esperado este mes</div>` : ''}
        </div>
        <div class="card p-4 md:p-5 cursor-pointer hover:ring-2 hover:ring-red-200 transition" onclick="openFinanceBreakdown('expense')" title="Click para ver el detalle de cada suma">
          <div class="text-xs text-gray-500 flex items-center gap-1">${showPending ? 'Pagado' : 'Gastos'} <span class="text-gray-300">ⓘ</span></div>
          <div class="text-xl md:text-2xl font-semibold text-red-600">${fmtAmount(baseCur==='USD'?expTotalUSDFinal:expTotalARSFinal, baseCur)}</div>
          ${showPending && expTotalPending > 0 ? `<div class="text-[11px] text-amber-700 mt-1">+ ${fmtAmount(expTotalPending, baseCur)} esperado este mes</div>` : ''}
        </div>
        <div class="card p-4 md:p-5">
          <div class="text-xs text-gray-500">Balance</div>
          <div class="text-xl md:text-2xl font-semibold ${balance>=0?'text-green-700':'text-red-600'}">${fmtAmount(balance, baseCur)}</div>
        </div>
        <div class="card p-4 md:p-5">
          <div class="text-xs text-gray-500">Margen</div>
          <div class="text-xl md:text-2xl font-semibold">${margin}%</div>
          <div class="text-[11px] text-gray-400 mt-0.5">sobre cobrado</div>
        </div>
      </div>

      ${showBreakdown ? `
        <div class="card p-4 md:p-5">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold">Ingresos vs Gastos</h3>
            <div class="flex items-center gap-3 text-xs text-gray-500">
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-green-500"></span>Ingresos</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-red-500"></span>Gastos</span>
            </div>
          </div>
          <div class="bar-chart overflow-x-auto">
            ${monthlyData.map(d => {
              const [y, m] = d.month.split('-').map(Number);
              const incH = maxAbs > 0 ? (d.income / maxAbs) * 140 : 0;
              const expH = maxAbs > 0 ? (d.expense / maxAbs) * 140 : 0;
              return `
                <div class="bar-col" onclick="financeMode='month'; financeMonth='${d.month}'; render()" title="${MONTH_NAMES_FULL[m-1]} ${y}: +${fmtMoney(d.income)} / -${fmtMoney(d.expense)}">
                  <div class="bar-pair">
                    <div class="bar income" style="height:${incH}px"></div>
                    <div class="bar expense" style="height:${expH}px"></div>
                  </div>
                  <div class="bar-label">${MONTH_NAMES_SHORT[m-1]}<br/>${String(y).slice(2)}</div>
                </div>
              `;
            }).join('')}
          </div>

          <div class="mt-5 pt-4 border-t border-gray-100 space-y-1.5">
            ${monthlyData.map(d => {
              const [y, m] = d.month.split('-').map(Number);
              return `
                <div class="flex items-center justify-between text-sm py-1 hover:bg-gray-50 rounded px-2 cursor-pointer" onclick="financeMode='month'; financeMonth='${d.month}'; render()">
                  <span class="font-medium w-24">${MONTH_NAMES_SHORT[m-1]} ${y}</span>
                  <span class="text-green-700 hidden sm:inline">+${fmtMoney(d.income)}</span>
                  <span class="text-red-600 hidden sm:inline">−${fmtMoney(d.expense)}</span>
                  <span class="font-semibold ${d.balance>=0?'text-green-700':'text-red-600'}">${fmtMoney(d.balance)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <div class="card overflow-hidden">
        <div class="px-4 md:px-5 py-3 md:py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <h3 class="font-semibold">Movimientos</h3>
          <div class="flex items-center gap-3 text-xs text-gray-500">
            <span>Total: <b class="text-gray-900">${inc.length + exp.length}</b></span>
            <span class="hidden sm:inline">${inc.filter(i => !isIncConfirmed(i)).length + exp.filter(e => !isExpPaid(e)).length} pendientes</span>
          </div>
        </div>

        ${sortedMonths.length === 0 ? `
          <div class="p-10 text-center text-gray-400 text-sm">Sin movimientos en el período.</div>
        ` : `
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th class="text-left px-3 md:px-5 py-2.5 font-semibold w-20">Mes</th>
                  <th class="text-left px-3 py-2.5 font-semibold">Descripción</th>
                  <th class="text-right px-3 py-2.5 font-semibold">Ingreso</th>
                  <th class="text-right px-3 py-2.5 font-semibold">Egreso</th>
                  <th class="text-left px-3 py-2.5 font-semibold w-28">Estado</th>
                  <th class="text-right px-3 md:px-5 py-2.5 font-semibold w-32"></th>
                </tr>
              </thead>
              <tbody>
                ${sortedMonths.map(m => {
                  const items = itemsByMonth[m];
                  const [y, mm] = m.split('-').map(Number);
                  const monthLabel = mm ? `${MONTH_NAMES_SHORT[mm-1]} ${String(y).slice(2)}` : '—';
                  return items.map((it, idx) => {
                    const p = getProject(it.projectId);
                    const isInc = it._kind === 'income';
                    const status = getPaymentChip(it);
                    const sum = getPaymentSummary(it);
                    const isPending = sum.status !== 'PAID';
                    // ===== Monto a mostrar en INGRESO/EGRESO =====
                    // - Carry-over: muestra el pendiente
                    // - Foreign-payment: muestra el pago hecho en ESTE mes
                    // - Original period:
                    //     · Si está 100% cobrado en este mismo mes → muestra el total (igual que antes)
                    //     · Si hay pagos parciales → muestra lo cobrado en este mes (cash basis real)
                    //     · Si nada cobrado aún → muestra el total como "esperado" (con chip Pendiente)
                    const paidThisMonthARS = it._carryOver ? 0 : paidInMonthBase(it, it._monthKey, 'ARS');
                    const paidThisMonthUSD = it._carryOver ? 0 : paidInMonthBase(it, it._monthKey, 'USD');
                    const paidThisMonthOrig = it._carryOver ? 0 : paidInMonthBase(it, it._monthKey, it.currency || 'ARS');
                    const hasPaymentThisMonth = paidThisMonthARS > 0;
                    let displayAmount, displaySubtext = '';
                    if (it._carryOver) {
                      displayAmount = it._carryOverRemaining;
                    } else if (it._foreignPayment) {
                      // Solo el pago de este mes; la chip ARRASTRE ya muestra el período
                      displayAmount = paidThisMonthOrig;
                    } else if (hasPaymentThisMonth && sum.status !== 'PAID') {
                      // Partial paid this month: show what was paid this month
                      displayAmount = paidThisMonthOrig;
                      displaySubtext = `de ${fmtAmount(it.amount, it.currency)} total`;
                    } else {
                      // Full or no payment: show item amount
                      displayAmount = it.amount;
                    }
                    // Chip context-aware: para ARRASTRE/foreign-payment refleja LO QUE PASÓ ESTE MES,
                    // no el estado global (que sería confuso si el item ya está 100% pagado en otros meses)
                    let rowStatus;
                    if (it._carryOver && !hasPaymentThisMonth) {
                      rowStatus = { label: 'Pendiente', color: 'bg-amber-100 text-amber-800' };
                    } else if (it._foreignPayment || (it._carryOver && hasPaymentThisMonth)) {
                      rowStatus = { label: isInc ? 'Cobrado este mes' : 'Pagado este mes', color: isInc ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700' };
                    } else {
                      rowStatus = status;
                    }
                    return `
                      <tr class="border-t border-gray-100 hover:bg-gray-50 group">
                        ${idx === 0 ? `<td class="px-3 md:px-5 py-3 align-top font-medium text-gray-700 bg-gray-50/50" rowspan="${items.length}">${monthLabel}</td>` : ''}
                        <td class="px-3 py-2.5">
                          <div class="flex items-center gap-2 flex-wrap">
                            ${it.auto ? '<span class="text-[10px] chip bg-blue-100 text-blue-700">AUTO</span>' : ''}
                            ${(() => {
                              const fromPeriod = it._carryOver ? it._carryOverFrom : (it._foreignPayment ? it._originalPeriod : null);
                              if (!fromPeriod) return '';
                              const [yy, mm] = fromPeriod.split('-');
                              return `<span class="text-[10px] chip bg-amber-100 text-amber-800" title="Comprobante con período en ${fromPeriod}">ARRASTRE ${MONTH_NAMES_SHORT[Number(mm)-1]} ${yy.slice(2)}</span>`;
                            })()}
                            <span class="font-medium truncate">${escapeHtml(it.concept)}</span>
                          </div>
                          ${p ? `<div class="text-xs text-gray-500 mt-0.5">${escapeHtml(p.name)}${it.category && !isInc ? ' · ' + EXPENSE_CAT[it.category] : ''}</div>` : (it.category && !isInc ? `<div class="text-xs text-gray-500 mt-0.5">${EXPENSE_CAT[it.category]}</div>` : '')}
                        </td>
                        <td class="px-3 py-2.5 text-right ${isInc ? (it._carryOver ? 'text-amber-700 font-semibold' : 'text-green-700 font-semibold') : 'text-gray-300'}">
                          ${isInc ? `
                            ${fmtAmount(displayAmount, it.currency)}
                            ${it._carryOver ? '<span class="text-[10px] text-gray-400 font-normal">pendiente</span>' : ''}
                            ${displaySubtext ? `<div class="text-[10px] text-gray-500 font-normal italic">${displaySubtext}</div>` : ''}
                            ${it.currency !== baseCur && !it._carryOver && hasPaymentThisMonth ? `<div class="text-[10px] text-gray-400 font-normal" title="Cotización al momento del cobro">${fmtAmount(baseCur==='USD'?paidThisMonthUSD:paidThisMonthARS, baseCur)} 🔒</div>` : ''}
                            ${it.currency !== baseCur && it._carryOver && getEffectiveRate(it) ? `<div class="text-[10px] text-gray-400 font-normal">${fmtAmount(toBaseCurrencyForItem(it, baseCur), baseCur)} @ $${getEffectiveRate(it).toLocaleString('es-AR')}</div>` : ''}
                          ` : '—'}
                        </td>
                        <td class="px-3 py-2.5 text-right ${!isInc ? (it._carryOver ? 'text-amber-700 font-semibold' : 'text-red-600 font-semibold') : 'text-gray-300'}">
                          ${!isInc ? `
                            ${fmtAmount(displayAmount, it.currency)}
                            ${it._carryOver ? '<span class="text-[10px] text-gray-400 font-normal">pendiente</span>' : ''}
                            ${displaySubtext ? `<div class="text-[10px] text-gray-500 font-normal italic">${displaySubtext}</div>` : ''}
                            ${it.currency !== baseCur && !it._carryOver && hasPaymentThisMonth ? `<div class="text-[10px] text-gray-400 font-normal">${fmtAmount(baseCur==='USD'?paidThisMonthUSD:paidThisMonthARS, baseCur)} 🔒</div>` : ''}
                            ${it.currency !== baseCur && it._carryOver && getEffectiveRate(it) ? `<div class="text-[10px] text-gray-400 font-normal">${fmtAmount(toBaseCurrencyForItem(it, baseCur), baseCur)} @ $${getEffectiveRate(it).toLocaleString('es-AR')}</div>` : ''}
                          ` : '—'}
                        </td>
                        <td class="px-3 py-2.5">
                          <button onclick='openPaymentsModal(${JSON.stringify(it).replace(/'/g, "&apos;")})' class="chip ${rowStatus.color} cursor-pointer hover:opacity-80" title="Gestionar pagos (parciales o total)">${rowStatus.label}</button>
                        </td>
                        <td class="px-3 md:px-5 py-2.5 text-right">
                          <div class="flex items-center justify-end gap-1">
                            ${isInc ? (() => {
                              const invs = getAllInvoicesFor(it);
                              if (invs.length === 0) return '';
                              if (invs.length === 1) {
                                return `<button onclick='openInvoicePdf(${JSON.stringify(invs[0]).replace(/"/g, "&quot;")})' class="text-[10px] chip bg-purple-100 text-purple-700 hover:bg-purple-200 cursor-pointer transition" title="Click para descargar PDF · CAE ${invs[0].cae}">🧾 ${escapeHtml(invs[0].code || '#' + invs[0].number)}</button>`;
                              }
                              return `<button onclick='openInvoiceListModal(${JSON.stringify(it).replace(/"/g, "&quot;")})' class="text-[10px] chip bg-purple-100 text-purple-700 hover:bg-purple-200 cursor-pointer transition" title="Click para ver las ${invs.length} facturas">🧾 ${invs.length} facturas</button>`;
                            })() : ''}
                            ${isInc && canEmitInvoice(it) ? `
                              <button onclick='openInvoiceModal(${JSON.stringify(it).replace(/"/g, "&quot;")})' class="text-purple-700 hover:bg-purple-50 p-1.5 rounded-md transition" title="${getAllInvoicesFor(it).length > 0 ? 'Emitir factura por saldo pendiente' : 'Emitir factura AFIP'}">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="14" x2="15" y2="14"/><line x1="9" y1="18" x2="15" y2="18"/></svg>
                              </button>
                            ` : ''}
                            ${isInc && it.auto && isPending && p && p.contactPhone ? `
                              <button onclick="sendPaymentReminder(${JSON.stringify(it).replace(/"/g, '&quot;')})" class="text-green-700 hover:bg-green-50 p-1.5 rounded-md transition" title="Enviar recordatorio por WhatsApp">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
                              </button>
                            ` : ''}
                            ${it.auto && !isInc ? `
                              <button onclick="openExpenseModal('${it.sourceExpenseId}')" class="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-900 text-xs px-1.5 transition" title="Editar gasto original (acá podés ponerle &quot;Pagar hasta&quot; para dar de baja a futuro)">✎</button>
                              <button onclick="deleteRecurringExpenseFull('${it.sourceExpenseId}')" class="opacity-0 group-hover:opacity-100 text-red-500 text-xs px-1.5 transition" title="Eliminar completamente este gasto fijo (borra historial)">✕</button>
                            ` : ''}
                            ${!it.auto ? `
                              <button onclick="${isInc?'openIncomeModal':'openExpenseModal'}('${it.id}')" class="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-900 text-xs px-1.5 transition">✎</button>
                              <button onclick="${isInc?'deleteIncome':'deleteExpense'}('${it.id}')" class="opacity-0 group-hover:opacity-100 text-red-500 text-xs px-1.5 transition">✕</button>
                            ` : ''}
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('');
                }).join('')}
              </tbody>
              <tfoot class="bg-gray-50 font-semibold border-t-2 border-gray-200">
                <tr>
                  <td colspan="2" class="px-3 md:px-5 py-3 text-right text-xs uppercase tracking-wider text-gray-500">Total confirmado (${baseCur})</td>
                  <td class="px-3 py-3 text-right text-green-700">${fmtAmount(baseCur==='USD'?incTotalUSDFinal:incTotalARSFinal, baseCur)}</td>
                  <td class="px-3 py-3 text-right text-red-600">${fmtAmount(baseCur==='USD'?expTotalUSDFinal:expTotalARSFinal, baseCur)}</td>
                  <td colspan="2" class="px-3 md:px-5 py-3 text-right ${balance>=0?'text-green-700':'text-red-600'}">${fmtAmount(balance, baseCur)}</td>
                </tr>
                ${showPending && (incTotalPending > 0 || expTotalPending > 0) ? `
                  <tr class="text-amber-700">
                    <td colspan="2" class="px-3 md:px-5 py-2 text-right text-xs uppercase tracking-wider">Esperado este mes</td>
                    <td class="px-3 py-2 text-right">${incTotalPending > 0 ? '+' + fmtAmount(incTotalPending, baseCur) : '—'}</td>
                    <td class="px-3 py-2 text-right">${expTotalPending > 0 ? fmtAmount(expTotalPending, baseCur) : '—'}</td>
                    <td colspan="2"></td>
                  </tr>
                ` : ''}
              </tfoot>
            </table>
          </div>

          <details class="border-t border-gray-100 px-4 md:px-5 py-3 text-xs">
            <summary class="cursor-pointer text-gray-600 hover:text-gray-900 select-none">
              Ver detalle de cada pago del período (${incomeInRange.length + expenseInRange.length} pagos)
            </summary>
            <div class="mt-3 space-y-3">
              ${incomeInRange.length > 0 ? `
                <div>
                  <div class="text-[10px] uppercase tracking-wider text-green-700 font-semibold mb-1">Cobros (${incomeInRange.length})</div>
                  <div class="space-y-0.5 max-h-60 overflow-y-auto pr-2">
                    ${incomeInRange.sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(p => `
                      <div class="flex items-center justify-between gap-3 py-1 border-b border-gray-100">
                        <span class="text-gray-500 w-20 text-[10px]">${p.date || '—'}</span>
                        <span class="flex-1 truncate font-medium">${fmtAmount(p.amount, p.currency)}</span>
                        <span class="text-gray-500">→ ${fmtAmount(convertAt(p.amount, p.currency, 'ARS', p.exchangeRate), 'ARS')}</span>
                        <span class="text-gray-400 text-[10px]">@${(Number(p.exchangeRate)||1200).toLocaleString('es-AR')}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              ${expenseInRange.length > 0 ? `
                <div>
                  <div class="text-[10px] uppercase tracking-wider text-red-700 font-semibold mb-1">Pagos (${expenseInRange.length})</div>
                  <div class="space-y-0.5 max-h-60 overflow-y-auto pr-2">
                    ${expenseInRange.sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(p => `
                      <div class="flex items-center justify-between gap-3 py-1 border-b border-gray-100">
                        <span class="text-gray-500 w-20 text-[10px]">${p.date || '—'}</span>
                        <span class="flex-1 truncate font-medium">${fmtAmount(p.amount, p.currency)}</span>
                        <span class="text-gray-500">→ ${fmtAmount(convertAt(p.amount, p.currency, 'ARS', p.exchangeRate), 'ARS')}</span>
                        <span class="text-gray-400 text-[10px]">@${(Number(p.exchangeRate)||1200).toLocaleString('es-AR')}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
              <p class="text-[10px] text-gray-400 mt-2">Cada pago usa su cotización congelada al momento del cobro/pago. Los totales suman cada uno convertido a la moneda objetivo.</p>
            </div>
          </details>
        `}
      </div>

    </div>
  `;
}

function toggleItemStatus(kind, id) {
  if (kind === 'income') {
    const i = state.incomes.find(x => x.id === id);
    if (!i) return;
    const goingToConfirmed = !(i.status === 'CONFIRMED' || !i.status);
    i.status = goingToConfirmed ? 'CONFIRMED' : 'PENDING';
    if (goingToConfirmed) {
      i.exchangeRateAtTime = Number(state.exchangeRate) || 1200;
      i.exchangeRateSource = state.exchangeRateSource || 'manual';
      i.confirmedAt = new Date().toISOString();
    } else {
      i.exchangeRateAtTime = null;
      i.confirmedAt = null;
    }
  } else {
    const e = state.expenses.find(x => x.id === id);
    if (!e) return;
    const goingToPaid = !(e.status === 'PAID' || !e.status);
    e.status = goingToPaid ? 'PAID' : 'PENDING';
    if (goingToPaid) {
      e.exchangeRateAtTime = Number(state.exchangeRate) || 1200;
      e.exchangeRateSource = state.exchangeRateSource || 'manual';
      e.paidAt = new Date().toISOString();
    } else {
      e.exchangeRateAtTime = null;
      e.paidAt = null;
    }
  }
  save(); render();
}

// ============ REPORTS ============
function renderReports() {
  const total = state.tasks.length;
  const completed = state.tasks.filter(t => t.status === 'COMPLETED').length;
  const blocked = state.tasks.filter(t => t.status === 'BLOCKED').length;
  const inProgress = state.tasks.filter(t => t.status === 'IN_PROGRESS').length;

  // Estimation accuracy
  const estimated = state.tasks.filter(t => t.estimatedHrs && t.actualHrs);
  const avgDeviation = estimated.length > 0
    ? Math.round(estimated.reduce((a,t) => a + (t.actualHrs - t.estimatedHrs) / t.estimatedHrs * 100, 0) / estimated.length)
    : null;

  // Completed last 30 days
  const since = new Date(); since.setDate(since.getDate() - 30);
  const recentlyDone = state.tasks.filter(t => t.completedAt && new Date(t.completedAt) >= since).length;

  // Workload per member: horas estimadas pendientes vs capacidad semanal
  const workload = state.members.map(m => {
    const activeTasks = state.tasks.filter(t => t.assigneeId === m.id && t.status !== 'COMPLETED');
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
      done30d: state.tasks.filter(t => t.assigneeId === m.id && t.completedAt && new Date(t.completedAt) >= since).length,
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

// ============ GUIDE ============
function renderGuide() {
  return `
    ${viewHeader('Manual de uso', 'Las reglas del sistema')}

    <div class="px-4 md:px-10 pb-10 max-w-3xl space-y-6">
      <div class="card p-6">
        <h3 class="font-semibold mb-3">Estados de tarea</h3>
        <div class="space-y-3 text-sm">
          <div class="flex gap-3"><span class="chip ${STATUS.PENDING.color} w-28 text-center">Pendiente</span><span>Creada, aún no empezada. Es el default.</span></div>
          <div class="flex gap-3"><span class="chip ${STATUS.IN_PROGRESS.color} w-28 text-center">En progreso</span><span>Estás trabajando hoy. Tenela abierta mientras la hacés.</span></div>
          <div class="flex gap-3"><span class="chip ${STATUS.IN_REVIEW.color} w-28 text-center">En revisión</span><span>Terminaste, esperás feedback o aprobación.</span></div>
          <div class="flex gap-3"><span class="chip ${STATUS.COMPLETED.color} w-28 text-center">Completada</span><span>Aprobada. No vuelve a estado anterior.</span></div>
          <div class="flex gap-3"><span class="chip ${STATUS.BLOCKED.color} w-28 text-center">Bloqueada</span><span>No podés avanzar por un factor externo. <b>Requiere motivo escrito.</b></span></div>
        </div>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Cuándo usar "Bloqueada"</h3>
        <p class="text-sm text-gray-700 mb-3">Solo cuando hay un factor externo que te impide seguir. No cuando simplemente no tenés ganas o priorizaste otra cosa (eso es "Pendiente").</p>
        <p class="text-sm text-gray-700 mb-3"><b>Cómo destrabar:</b> en el detalle de la tarea, editá el motivo para dejar claro qué cambió, movela a "En progreso" o "En revisión" según corresponda, y sumá un comentario explicando.</p>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Cómo estimar tiempo</h3>
        <ul class="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>Cargá siempre <b>tiempo estimado</b> al crear la tarea.</li>
          <li>Al terminarla, actualizá <b>tiempo real</b>.</li>
          <li>El sistema te muestra tu desvío promedio en Reportes — ajustá tus estimaciones con ese dato.</li>
          <li>Regla práctica: si una tarea se estira 2x el estimado, partila en dos.</li>
        </ul>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Ritmo recomendado</h3>
        <ul class="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li><b>Todas las mañanas:</b> entrá a "Hoy", revisá tareas del día.</li>
          <li><b>Lunes:</b> revisá "Esta semana" y reordená prioridades.</li>
          <li><b>Fin de mes:</b> revisá "Finanzas" y cargá lo que falte.</li>
          <li><b>Al terminar una tarea:</b> comentá algo útil que hayas aprendido.</li>
        </ul>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Menciones y notificaciones</h3>
        <ul class="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>En cualquier comentario escribí <b>@Nombre</b> para notificar a ese miembro.</li>
          <li>Cuando asignás una tarea a alguien, le llega una notificación.</li>
          <li>La campana arriba a la izquierda muestra las notificaciones sin leer.</li>
          <li>Podés cambiar entre miembros haciendo click en tu nombre abajo del sidebar.</li>
        </ul>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Estados de proyecto</h3>
        <div class="text-sm text-gray-700 space-y-1">
          <div><b>Lead:</b> primer contacto, sin compromiso aún.</div>
          <div><b>Posible:</b> hay chance concreta de cerrarlo.</div>
          <div><b>En desarrollo:</b> estamos trabajando activamente.</div>
          <div><b>Activo mensualidad:</b> cliente recurrente cobrando fee fijo.</div>
          <div><b>Pausado:</b> detenido temporalmente.</div>
          <div><b>Terminado:</b> finalizado, sin actividad.</div>
          <div><b>Archivado:</b> fuera del radar.</div>
        </div>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Gantt</h3>
        <p class="text-sm text-gray-700">En Tareas → Gantt, las tareas que tengan fecha de inicio <b>y</b> fin se muestran como barras en el tiempo. La línea roja es hoy. Las barras con marco rojo están vencidas.</p>
      </div>

      <div class="card p-6 bg-green-50 border-green-200">
        <h3 class="font-semibold mb-2">✓ Tus datos están guardados</h3>
        <p class="text-sm text-gray-700 mb-3">Si configuraste Supabase, todo se sincroniza en tiempo real entre dispositivos y pestañas. Si no, los datos viven solo en este navegador.</p>
        <p class="text-sm text-gray-700">Estado actual: mirá el indicador en el sidebar (verde = sincronizado, gris = solo local).</p>
        <button onclick="reconfigureCloud()" class="btn-ghost text-sm mt-3">Reconfigurar sincronización</button>
      </div>
    </div>
  `;
}

// ============ MODALS ============
function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
  document.getElementById('modal').classList.add('flex');
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.getElementById('modal').classList.remove('flex');
}
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

// ---- Task modal ----
function openTaskModal(id) {
  const t = id ? getTask(id) : { id: null, title: '', description: '', status: 'PENDING', priority: 'MEDIUM', projectId: state.projects[0]?.id || '', assigneeId: currentMemberId, startDate: todayISO(), dueDate: '', estimatedHrs: '', actualHrs: '' };
  const isNew = !id;
  const isDone = t.status === 'COMPLETED';
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar tarea' : 'Nueva tarea'}</h2>
      <form id="taskForm" class="space-y-3" onsubmit="saveTask(event)">
        <input type="hidden" name="id" value="${t.id || ''}" />
        <div>
          <label class="text-xs text-gray-500">Título</label>
          <input name="title" class="input" required autofocus value="${escapeAttr(t.title)}" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Descripción</label>
          <textarea name="description" class="input" rows="2">${escapeHtml(t.description || '')}</textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500">Proyecto</label>
            <select name="projectId" required>
              ${state.projects.length === 0 ? '<option value="">(Creá un proyecto primero)</option>' :
                state.projects.map(p => `<option value="${p.id}" ${t.projectId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Prioridad</label>
            <select name="priority">
              ${Object.entries(PRIORITY).map(([k,v]) => `<option value="${k}" ${t.priority===k?'selected':''}>${v.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Estado</label>
            <select name="status">
              ${STATUS_ORDER.map(k => `<option value="${k}" ${t.status===k?'selected':''}>${STATUS[k].label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Asignado a</label>
            <select name="assigneeId">
              <option value="">Sin asignar</option>
              ${state.members.map(m => `<option value="${m.id}" ${t.assigneeId===m.id?'selected':''}>${escapeHtml(m.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Fecha límite</label>
            <input type="date" name="dueDate" class="input" value="${t.dueDate || ''}" />
          </div>
          <div>
            <label class="text-xs text-gray-500">Fecha inicio</label>
            <input type="date" name="startDate" class="input" value="${t.startDate || ''}" />
          </div>
          <div>
            <label class="text-xs text-gray-500">Horas estimadas</label>
            <input type="number" step="0.25" name="estimatedHrs" class="input" value="${t.estimatedHrs || ''}" placeholder="0" />
          </div>
          ${!isNew ? `
          <div>
            <label class="text-xs text-gray-500">Horas reales ${isDone ? '' : '<span class="text-gray-400">(al finalizar)</span>'}</label>
            <input type="number" step="0.25" name="actualHrs" class="input" value="${t.actualHrs || ''}" placeholder="0" />
          </div>` : ''}
        </div>
        <div id="blockedReasonBox" class="${t.status === 'BLOCKED' ? '' : 'hidden'}">
          <label class="text-xs text-red-600">Motivo del bloqueo <b>(obligatorio)</b></label>
          <textarea name="blockedReason" class="input" rows="2">${escapeHtml(t.blockedReason || '')}</textarea>
        </div>
        <div class="flex justify-between pt-3">
          <div>${id ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="deleteTask('${id}')">Eliminar</button>` : ''}</div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);

  const statusSel = document.querySelector('#taskForm select[name="status"]');
  statusSel.addEventListener('change', (e) => {
    document.getElementById('blockedReasonBox').classList.toggle('hidden', e.target.value !== 'BLOCKED');
  });
}

function saveTask(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());

  if (data.status === 'BLOCKED' && !data.blockedReason?.trim()) {
    alert('Tenés que escribir un motivo para marcarla como bloqueada.');
    return;
  }
  if (!data.projectId) {
    alert('Creá un proyecto primero.');
    return;
  }

  data.estimatedHrs = data.estimatedHrs ? Number(data.estimatedHrs) : null;
  data.actualHrs    = data.actualHrs    ? Number(data.actualHrs)    : null;

  // Si se completa y no cargó horas reales, pedirlas
  if (data.status === 'COMPLETED' && !data.actualHrs) {
    const hrs = prompt('¿Cuántas horas te llevó realmente?' + (data.estimatedHrs ? ` (estimaste ${data.estimatedHrs}h)` : ''), data.estimatedHrs || '');
    if (hrs === null) return;
    const n = Number(hrs);
    if (!isNaN(n) && n > 0) data.actualHrs = n;
  }

  if (data.id) {
    const t = getTask(data.id);
    const oldStatus = t.status;
    const oldAssignee = t.assigneeId;
    Object.assign(t, data);
    if (data.status !== oldStatus) {
      pushHistory(t.id, 'status', oldStatus, data.status);
      if (data.status === 'COMPLETED') t.completedAt = new Date().toISOString();
    }
    if (data.assigneeId && data.assigneeId !== oldAssignee && data.assigneeId !== currentMemberId) {
      notify(data.assigneeId, t.id, `Te asignaron: ${t.title}`);
      const m = getMember(data.assigneeId);
      showToast(`Asignada a ${m?.name || 'miembro'} · ${state.emailConfig?.enabled ? '✉ Email enviado' : ''}`, 'success');
    }
    t.updatedAt = new Date().toISOString();
  } else {
    const t = {
      ...data,
      id: uid(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: data.status === 'COMPLETED' ? new Date().toISOString() : null,
    };
    state.tasks.push(t);
    pushHistory(t.id, 'created', null, null);
    if (data.assigneeId && data.assigneeId !== currentMemberId) {
      notify(data.assigneeId, t.id, `Te asignaron: ${t.title}`);
      const m = getMember(data.assigneeId);
      showToast(`Asignada a ${m?.name || 'miembro'} · ${state.emailConfig?.enabled ? '✉ Email enviado' : ''}`, 'success');
    }
  }
  save();
  closeModal();
  render();
}

function deleteTask(id) {
  if (!confirm('¿Eliminar esta tarea?')) return;
  state.tasks = state.tasks.filter(t => t.id !== id);
  state.comments = state.comments.filter(c => c.taskId !== id);
  state.history  = state.history.filter(h => h.taskId !== id);
  save(); closeModal(); render();
}

// ---- Task detail ----
function openTaskDetail(id) {
  const t = getTask(id);
  const p = getProject(t.projectId);
  const comments = state.comments.filter(c => c.taskId === id).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const history  = state.history.filter(h => h.taskId === id).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const feed = [...comments.map(c => ({type:'comment', ...c})), ...history.map(h => ({type:'history', ...h}))].sort((a,b) => a.createdAt.localeCompare(b.createdAt));

  openModal(`
    <div class="p-6">
      <div class="flex items-start justify-between mb-2">
        <div class="flex-1 pr-4">
          <div class="flex items-center gap-2 mb-1">
            ${p ? `<span class="text-xs font-medium" style="color:${p?.color || '#6b7280'}">● ${escapeHtml(p.name)}</span>` : ''}
            <span class="chip ${PRIORITY[t.priority].color}">${PRIORITY[t.priority].label}</span>
          </div>
          <h2 class="text-xl font-semibold">${escapeHtml(t.title)}</h2>
        </div>
        <button class="btn-ghost text-sm" onclick="openTaskModal('${t.id}')">Editar</button>
      </div>

      ${t.description ? `<p class="text-sm text-gray-700 my-3">${escapeHtml(t.description)}</p>` : ''}

      <div class="flex flex-wrap gap-2 my-4">
        <span class="chip ${STATUS[t.status].color}">${STATUS[t.status].label}</span>
        ${t.dueDate ? `<span class="chip bg-gray-100 text-gray-700">Vence ${fmt(t.dueDate)}</span>` : ''}
        ${t.estimatedHrs ? `<span class="chip bg-gray-100 text-gray-700">Est: ${t.estimatedHrs}h</span>` : ''}
        ${t.actualHrs ? `<span class="chip bg-gray-100 text-gray-700">Real: ${t.actualHrs}h</span>` : ''}
      </div>

      <div class="grid grid-cols-5 gap-1 mb-4">
        ${STATUS_ORDER.map(s => `
          <button class="chip ${t.status===s?STATUS[s].color:'bg-gray-100 text-gray-500'} py-2" onclick="quickStatus('${t.id}','${s}')">${STATUS[s].label}</button>
        `).join('')}
      </div>

      ${t.status === 'BLOCKED' && t.blockedReason ? `
        <div class="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <div class="text-xs font-semibold text-red-700 mb-1">Motivo del bloqueo</div>
          <div class="text-sm text-red-900">${escapeHtml(t.blockedReason)}</div>
        </div>
      ` : ''}

      <h3 class="text-xs uppercase tracking-wider text-gray-500 mb-2">Actividad</h3>
      <div class="space-y-2 max-h-60 overflow-y-auto mb-3">
        ${feed.length === 0 ? '<div class="text-sm text-gray-400">Sin actividad aún.</div>' : feed.map(e => {
          if (e.type === 'comment') {
            const author = getMember(e.authorId);
            return `<div class="bg-gray-50 rounded-lg p-3 text-sm">
              <div class="flex items-center gap-2 mb-1">
                ${author ? `<span class="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold" style="background:${author.color}">${escapeHtml(author.name[0])}</span><span class="text-xs font-medium">${escapeHtml(author.name)}</span>` : ''}
                <span class="text-xs text-gray-500">${new Date(e.createdAt).toLocaleString('es-AR')}</span>
              </div>
              <div class="text-gray-900">${renderMentions(e.content)}</div>
            </div>`;
          } else {
            const msg = e.action === 'created' ? 'Tarea creada' : `Estado: ${STATUS[e.from]?.label || e.from} → ${STATUS[e.to]?.label || e.to}`;
            return `<div class="text-xs text-gray-500 px-3">${msg} · ${new Date(e.createdAt).toLocaleString('es-AR')}</div>`;
          }
        }).join('')}
      </div>

      <form onsubmit="addComment(event, '${t.id}')" class="flex gap-2">
        <input name="content" class="input" placeholder="Comentario... (@nombre para notificar)" required />
        <button class="btn-primary">Enviar</button>
      </form>
      <p class="text-[11px] text-gray-400 mt-1">Miembros: ${state.members.map(m => '@' + m.name).join(', ')}</p>
    </div>
  `);
}

function quickStatus(taskId, status) {
  const t = getTask(taskId);
  if (status === 'BLOCKED' && !t.blockedReason) {
    const reason = prompt('Motivo del bloqueo (obligatorio):');
    if (!reason?.trim()) return;
    t.blockedReason = reason.trim();
  }
  if (status === 'COMPLETED' && !t.actualHrs) {
    const hrs = prompt('¿Cuántas horas te llevó realmente?' + (t.estimatedHrs ? ` (estimaste ${t.estimatedHrs}h)` : ''), t.estimatedHrs || '');
    if (hrs === null) return;
    const n = Number(hrs);
    if (!isNaN(n) && n > 0) t.actualHrs = n;
  }
  const oldStatus = t.status;
  t.status = status;
  t.updatedAt = new Date().toISOString();
  if (status === 'COMPLETED') t.completedAt = new Date().toISOString();
  pushHistory(taskId, 'status', oldStatus, status);
  save();
  openTaskDetail(taskId);
}

function addComment(e, taskId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const content = fd.get('content');
  const mentions = parseMentions(content);
  state.comments.push({
    id: uid(),
    taskId,
    authorId: currentMemberId,
    content,
    mentions,
    createdAt: new Date().toISOString(),
  });
  const task = getTask(taskId);
  mentions.forEach(mid => notify(mid, taskId, `Te mencionaron en "${task.title}"`));
  save();
  openTaskDetail(taskId);
}

// ---- Project modal ----
function openProjectModal(id) {
  const p = id ? getProject(id) : { id: null, name: '', description: '', color: DEFAULT_PROJECT_COLOR, projectTypes: ['SYSTEM'], status: 'LEAD', startDate: todayISO(), endDate: '', budget: '', monthlyFee: '', monthlyFeeCurrency: state.defaultCurrency || 'ARS', clientId: '', contactName: '', contactEmail: '', contactPhone: '', systemUrl: '' };
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
                ${(state.clients||[]).map(c => `<option value="${c.id}" ${p.clientId===c.id?'selected':''}>${escapeHtml(clientLabel(c))}</option>`).join('')}
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

function saveProject(e) {
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
    state.projects.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}

function deleteProject(id) {
  const tasks = state.tasks.filter(t => t.projectId === id);
  if (tasks.length > 0 && !confirm(`Este proyecto tiene ${tasks.length} tareas asociadas. ¿Eliminar igual?`)) return;
  if (!confirm('¿Eliminar proyecto?')) return;
  state.projects = state.projects.filter(p => p.id !== id);
  state.tasks    = state.tasks.filter(t => t.projectId !== id);
  save(); closeModal(); render();
}

// ---- Client profile modal ----
function openProjectProfileModal(projectId) {
  const p = getProject(projectId);
  const v = {
    contactName:'', contactRole:'', contactPhone:'', contactPhone2:'',
    contactEmail:'', contactEmail2:'',
    companyName:'', taxId:'', industry:'', website:'',
    address:'', city:'', country:'',
    domain:'', domainProvider:'', domainExpiry:'',
    hostingProvider:'', serverInfo:'', adminUrl:'',
    credentialsLink:'', repoUrl:'', techStack:'', techNotes:'',
    instagram:'', facebook:'', linkedin:'', tiktok:'',
    source:'', firstContactDate:'', commercialNotes:'',
    ...p,
  };

  const fld = (name, label, type='text', value='', placeholder='', wide=false) => `
    <div class="${wide?'col-span-2':''}">
      <label class="text-xs text-gray-500">${label}</label>
      <input type="${type}" name="${name}" class="input" value="${escapeAttr(value||'')}" placeholder="${escapeAttr(placeholder)}" />
    </div>`;
  const txt = (name, label, value='', rows=2) => `
    <div class="col-span-2">
      <label class="text-xs text-gray-500">${label}</label>
      <textarea name="${name}" class="input" rows="${rows}">${escapeHtml(value||'')}</textarea>
    </div>`;
  const sec = (title) => `<h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mt-5 mb-2 pb-1 border-b border-gray-100">${title}</h3>`;

  openModal(`
    <div class="p-6">
      <div class="flex items-center gap-2 mb-1">
        <span class="w-3 h-3 rounded-full" style="background:${p?.color || '#9ca3af'}"></span>
        <h2 class="text-xl font-semibold">Perfil del cliente</h2>
      </div>
      <p class="text-sm text-gray-500 mb-4">${escapeHtml(p.name)}</p>

      <form onsubmit="saveProjectProfile(event, '${p.id}')">
        ${sec('Contacto principal')}
        <div class="grid grid-cols-2 gap-3">
          ${fld('contactName',  'Nombre',           'text',  v.contactName)}
          ${fld('contactRole',  'Cargo',            'text',  v.contactRole,  'Ej: CEO, Marketing')}
          ${fld('contactPhone', 'WhatsApp',         'tel',   v.contactPhone, '+54 9 11...')}
          ${fld('contactPhone2','Teléfono fijo',    'tel',   v.contactPhone2)}
          ${fld('contactEmail', 'Email principal',  'email', v.contactEmail)}
          ${fld('contactEmail2','Email secundario', 'email', v.contactEmail2)}
        </div>

        ${sec('Empresa')}
        <div class="grid grid-cols-2 gap-3">
          ${fld('companyName', 'Razón social', 'text', v.companyName)}
          ${fld('taxId',       'CUIT / Tax ID','text', v.taxId)}
          ${fld('industry',    'Industria',    'text', v.industry, 'Ej: Inmobiliario')}
          ${fld('website',     'Sitio web',    'url',  v.website,  'https://...')}
          ${fld('address',     'Dirección',    'text', v.address,  '', true)}
          ${fld('city',        'Ciudad',       'text', v.city)}
          ${fld('country',     'País',         'text', v.country)}
        </div>

        ${sec('Datos técnicos')}
        <div class="grid grid-cols-2 gap-3">
          ${fld('domain',          'Dominio',              'text', v.domain,          'empresa.com')}
          ${fld('domainProvider',  'Proveedor dominio',    'text', v.domainProvider,  'Ej: NIC.ar, GoDaddy')}
          ${fld('domainExpiry',    'Vencimiento dominio',  'date', v.domainExpiry)}
          ${fld('hostingProvider', 'Hosting',              'text', v.hostingProvider, 'Ej: Vercel, AWS')}
          ${fld('serverInfo',      'Server / IP',          'text', v.serverInfo)}
          ${fld('adminUrl',        'Panel admin',          'url',  v.adminUrl,        'https://...')}
          ${fld('credentialsLink', 'Credenciales (link)',  'url',  v.credentialsLink, '1Password, Bitwarden...')}
          ${fld('repoUrl',         'Repositorio',          'url',  v.repoUrl,         'github.com/...')}
          ${fld('techStack',       'Stack tecnológico',    'text', v.techStack,       'Next.js + Supabase', true)}
          ${txt('techNotes',       'Notas técnicas',       v.techNotes, 3)}
        </div>

        ${sec('Redes sociales')}
        <div class="grid grid-cols-2 gap-3">
          ${fld('instagram', 'Instagram', 'text', v.instagram, '@usuario')}
          ${fld('facebook',  'Facebook',  'text', v.facebook,  'facebook.com/...')}
          ${fld('linkedin',  'LinkedIn',  'url',  v.linkedin)}
          ${fld('tiktok',    'TikTok',    'text', v.tiktok,    '@usuario')}
        </div>

        ${sec('Comercial')}
        <div class="grid grid-cols-2 gap-3">
          ${fld('source',           'Cómo llegó',       'text', v.source, 'Referido, web, evento...')}
          ${fld('firstContactDate', 'Primer contacto',  'date', v.firstContactDate)}
          ${txt('commercialNotes',  'Notas comerciales', v.commercialNotes, 3)}
        </div>

        <div class="flex justify-end gap-2 pt-5 mt-4 border-t border-gray-100">
          <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary">Guardar perfil</button>
        </div>
      </form>
    </div>
  `);
}

function saveProjectProfile(e, projectId) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  Object.assign(getProject(projectId), data);
  save();
  closeModal();
  openProjectDetail(projectId);
}

// ---- Income / Expense modals ----
function openIncomeModal(id) {
  const i = id ? state.incomes.find(x => x.id === id) : { id: null, concept: '', amount: '', currency: state.defaultCurrency || 'ARS', date: todayISO(), projectId: '', status: 'CONFIRMED' };
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar ingreso' : 'Nuevo ingreso'}</h2>
      <form onsubmit="saveIncome(event)" class="space-y-3">
        <input type="hidden" name="id" value="${i.id || ''}" />
        <div><label class="text-xs text-gray-500">Concepto</label><input name="concept" class="input" required autofocus value="${escapeAttr(i.concept)}" /></div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="text-xs text-gray-500">Monto</label><input type="number" step="0.01" name="amount" class="input" required value="${i.amount}" /></div>
          <div>
            <label class="text-xs text-gray-500">Moneda</label>
            <select name="currency">
              <option value="ARS" ${(i.currency||'ARS')==='ARS'?'selected':''}>ARS</option>
              <option value="USD" ${i.currency==='USD'?'selected':''}>USD</option>
            </select>
          </div>
          <div><label class="text-xs text-gray-500">Fecha</label><input type="date" name="date" class="input" required value="${i.date}" /></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500">Proyecto</label>
            <select name="projectId">
              <option value="">Sin proyecto</option>
              ${state.projects.map(p => `<option value="${p.id}" ${i.projectId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Estado</label>
            <select name="status">
              <option value="CONFIRMED" ${(i.status||'CONFIRMED')==='CONFIRMED'?'selected':''}>Confirmado / Cobrado</option>
              <option value="PENDING"   ${i.status==='PENDING'?'selected':''}>Pendiente de cobro</option>
            </select>
          </div>
        </div>
        <div class="flex justify-${id?'between':'end'} gap-2 pt-3">
          ${id ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="deleteIncome('${id}')">Eliminar</button>` : ''}
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);
}

function saveIncome(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  data.amount = Number(data.amount);
  if (data.id) {
    const existing = state.incomes.find(x => x.id === data.id);
    const wasConfirmed = (existing.status || 'CONFIRMED') === 'CONFIRMED';
    const willBeConfirmed = (data.status || 'CONFIRMED') === 'CONFIRMED';
    if (willBeConfirmed && !wasConfirmed) {
      data.exchangeRateAtTime = Number(state.exchangeRate) || 1200;
      data.exchangeRateSource = state.exchangeRateSource || 'manual';
      data.confirmedAt = new Date().toISOString();
    } else if (!willBeConfirmed) {
      data.exchangeRateAtTime = null;
      data.confirmedAt = null;
    } else {
      data.exchangeRateAtTime = existing.exchangeRateAtTime || null;
    }
    Object.assign(existing, data);
  } else {
    if ((data.status || 'CONFIRMED') === 'CONFIRMED') {
      data.exchangeRateAtTime = Number(state.exchangeRate) || 1200;
      data.exchangeRateSource = state.exchangeRateSource || 'manual';
      data.confirmedAt = new Date().toISOString();
    }
    state.incomes.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}
function deleteIncome(id) {
  if (!confirm('¿Eliminar ingreso?')) return;
  state.incomes = state.incomes.filter(x => x.id !== id);
  save(); closeModal(); render();
}

function openExpenseModal(id) {
  const ex = id ? state.expenses.find(x => x.id === id) : { id: null, concept: '', amount: '', currency: state.defaultCurrency || 'ARS', date: todayISO(), category: 'VARIABLE', projectId: '', status: 'PAID', recurring: true, recurringEndDate: '' };
  const isFixed = (ex.category || 'VARIABLE') === 'FIXED';
  const isRecurring = ex.recurring !== false;
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar gasto' : 'Nuevo gasto'}</h2>
      <form onsubmit="saveExpense(event)" class="space-y-3">
        <input type="hidden" name="id" value="${ex.id || ''}" />
        <div><label class="text-xs text-gray-500">Concepto</label><input name="concept" class="input" required autofocus value="${escapeAttr(ex.concept)}" /></div>
        <div class="grid grid-cols-4 gap-3">
          <div><label class="text-xs text-gray-500">Monto</label><input type="number" step="0.01" name="amount" class="input" required value="${ex.amount}" /></div>
          <div>
            <label class="text-xs text-gray-500">Moneda</label>
            <select name="currency">
              <option value="ARS" ${(ex.currency||'ARS')==='ARS'?'selected':''}>ARS</option>
              <option value="USD" ${ex.currency==='USD'?'selected':''}>USD</option>
            </select>
          </div>
          <div><label class="text-xs text-gray-500">Fecha</label><input type="date" name="date" class="input" required value="${ex.date}" /></div>
          <div>
            <label class="text-xs text-gray-500">Categoría</label>
            <select name="category" onchange="toggleRecurringFields(this.value)">
              ${Object.entries(EXPENSE_CAT).map(([k,v]) => `<option value="${k}" ${ex.category===k?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500">Proyecto</label>
            <select name="projectId">
              <option value="">Sin proyecto</option>
              ${state.projects.map(p => `<option value="${p.id}" ${ex.projectId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Estado</label>
            <select name="status">
              <option value="PAID"    ${(ex.status||'PAID')==='PAID'?'selected':''}>Pagado</option>
              <option value="PENDING" ${ex.status==='PENDING'?'selected':''}>Pendiente</option>
            </select>
          </div>
        </div>

        <div id="recurringBox" class="${isFixed?'':'hidden'} bg-gray-50 rounded-lg p-3 space-y-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="recurring" ${isRecurring?'checked':''} class="w-4 h-4" />
            <span class="text-sm font-medium">Repetir este gasto cada mes</span>
          </label>
          <p class="text-[11px] text-gray-500">Va a aparecer automáticamente como <b>pendiente</b> en los meses siguientes. Los marcás como pagado cuando corresponda.</p>
          <div>
            <label class="text-xs text-gray-500">Pagar hasta <span class="text-gray-400">(opcional, si querés darlo de baja en una fecha futura)</span></label>
            <input type="date" name="recurringEndDate" class="input" value="${ex.recurringEndDate || ''}" />
          </div>
          ${id && ex.recurringEndDate ? `<p class="text-[11px] text-amber-700">⚠ Este gasto está dado de baja a partir de ${fmt(ex.recurringEndDate)}.</p>` : ''}
        </div>

        <div class="flex justify-${id?'between':'end'} gap-2 pt-3">
          ${id ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="deleteExpense('${id}')">Eliminar</button>` : ''}
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);
}

function toggleRecurringFields(category) {
  const box = document.getElementById('recurringBox');
  if (!box) return;
  if (category === 'FIXED') box.classList.remove('hidden');
  else box.classList.add('hidden');
}

function saveExpense(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  data.amount = Number(data.amount);
  // El checkbox sólo entra a FormData si está checked; si no está, queda undefined
  data.recurring = data.category === 'FIXED' ? (data.recurring === 'on') : false;
  data.recurringEndDate = data.recurringEndDate || null;
  if (data.id) {
    const existing = state.expenses.find(x => x.id === data.id);
    const wasPaid = (existing.status || 'PAID') === 'PAID';
    const willBePaid = (data.status || 'PAID') === 'PAID';
    if (willBePaid && !wasPaid) {
      data.exchangeRateAtTime = Number(state.exchangeRate) || 1200;
      data.exchangeRateSource = state.exchangeRateSource || 'manual';
      data.paidAt = new Date().toISOString();
    } else if (!willBePaid) {
      data.exchangeRateAtTime = null;
      data.paidAt = null;
    } else {
      data.exchangeRateAtTime = existing.exchangeRateAtTime || null;
    }
    Object.assign(existing, data);
  } else {
    if ((data.status || 'PAID') === 'PAID') {
      data.exchangeRateAtTime = Number(state.exchangeRate) || 1200;
      data.exchangeRateSource = state.exchangeRateSource || 'manual';
      data.paidAt = new Date().toISOString();
    }
    state.expenses.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}
function deleteExpense(id) {
  const e = state.expenses.find(x => x.id === id);
  const paymentsCount = e ? (state.recurringExpensePayments || []).filter(r => r.expenseId === id).length : 0;
  const detail = paymentsCount > 0
    ? `\n\nTambién se borrarán los ${paymentsCount} pago${paymentsCount>1?'s':''} recurrente${paymentsCount>1?'s':''} registrado${paymentsCount>1?'s':''}.`
    : '';
  if (!confirm(`¿Eliminar gasto?${detail}`)) return;
  state.expenses = state.expenses.filter(x => x.id !== id);
  state.recurringExpensePayments = (state.recurringExpensePayments || []).filter(r => r.expenseId !== id);
  save(); closeModal(); render();
}

// ============ NOTIFICATIONS PANEL ============
function toggleNotifications() {
  const panel = document.getElementById('notifPanel');
  if (panel.classList.contains('hidden')) {
    renderNotifications();
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

function closeNotifications() {
  document.getElementById('notifPanel').classList.add('hidden');
}

function renderNotifications() {
  const list = document.getElementById('notifList');
  const mine = state.notifications
    .filter(n => n.forMemberId === currentMemberId)
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

function openNotification(id) {
  const n = state.notifications.find(x => x.id === id);
  if (!n) return;
  n.read = true;
  save();
  closeNotifications();
  renderNav();
  if (n.taskId) openTaskDetail(n.taskId);
}

function markAllRead() {
  state.notifications.forEach(n => { if (n.forMemberId === currentMemberId) n.read = true; });
  save();
  renderNav();
  renderNotifications();
}

// Close panel on outside click
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notifPanel');
  const bell = document.getElementById('bellBtn');
  if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !bell.contains(e.target)) {
    panel.classList.add('hidden');
  }
});

// ============ EXPORT / IMPORT ============
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `pragma-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
function importData() {
  document.getElementById('fileInput').click();
}
document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!confirm('Esto reemplaza todos los datos actuales. ¿Continuar?')) return;
      state = { ...structuredClone(DEFAULT_STATE), ...imported };
      save(); render();
    } catch {
      alert('Archivo inválido.');
    }
  };
  reader.readAsText(file);
});

// ============ UTILS ============
// escapeHtml, escapeAttr → src/utils/helpers.js (importados arriba).

function attachViewEvents() {}

// ============ KEYBOARD ============
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); openTaskModal(); }
  if (e.key === 'Escape') closeModal();
});

// ============ BOOT ============
// Inyectar dependencias en los servicios (capa services/) antes de usarlos.
initExchange({ getState: () => state, save, render, showToast });
initEmail({ getState: () => state, getMember, getTask, currentMember, showToast });

// Mostrar overlay de login por defecto hasta que Supabase confirme sesión
renderLoginOverlay();
renderNav();
render();

// Migración: si todavía tenés la plantilla vieja redundante, pasala a la nueva
(function migratePaymentTemplate() {
  const OLD = 'Hola {name}! 👋\n\nTe paso el recordatorio del pago mensual del proyecto *{project}* correspondiente a {month}.\n\nMonto: {amount} (≈ {amountARS} al cambio de hoy, cotización USD {rate})\n\n¡Gracias!\nPragma Studio';
  const NEW = 'Hola {name}! 👋\n\nTe paso el recordatorio del pago mensual del proyecto *{project}* correspondiente a {month}.\n\nMonto: {amount}\n\n¡Gracias!\nPragma Studio';
  if (state.paymentMessageTemplate === OLD) {
    state.paymentMessageTemplate = NEW;
    save();
  }
})();

// Show pending notifications toast on app load + auto-refresh blue dollar
setTimeout(() => {
  const unread = (state.notifications || []).filter(n => n.forMemberId === currentMemberId && !n.read);
  if (unread.length > 0) {
    const recent = unread[unread.length - 1];
    showToast(`Tenés ${unread.length} notificación${unread.length>1?'es':''} sin leer · ${recent.text}`, 'info', 6000);
  }
  // Auto-fetch blue dollar (silently) if stale
  autoFetchBlueIfStale();
}, 800);

// Init cloud sync (or show setup if not configured)
if (getSupabaseConfig()) {
  initSupabase();
} else if (localStorage.getItem('pragma_cloud_skip')) {
  setSyncStatus('Solo local', '#999');
} else {
  document.getElementById('setupOverlay').classList.remove('hidden');
  setSyncStatus('Sin sincronizar', '#999');
}

// ============================================================
// WINDOW BRIDGE (refactor modular — ver docs/architecture/migration.md)
// Al pasar de <script> clásico (scope global) a módulo ES, los handlers
// inline del HTML (onclick="fn()", etc.) dejan de resolver contra el scope
// del módulo. Este puente re-expone en window EXACTAMENTE las funciones y
// variables referenciadas por handlers inline, preservando el comportamiento
// original sin modificar la lógica. Generado a partir del análisis de on*=.
// ------------------------------------------------------------
// 1) Funciones invocadas desde handlers inline (84).
Object.assign(window, {
  addBudgetItem, addComment, addSuggestedModule, autoFillHours, backToEditInvoice,
  closeModal, confirmEmitInvoice, copyPaymentMsg, copyPromptText, deleteBudget,
  deleteClient, deleteExpense, deleteIncome, deleteMember, deleteProject,
  deleteRecurringExpenseFull, deleteTask, dragColLeave, dragColOver, dragProjectEnd,
  dragProjectStart, dropProject, fetchBluelyticsBlue, fetchDollarRate, generateBudgetPdf,
  go, handleLogin, insertTemplateVar, logout, navYear,
  openBudgetModal, openClientModal, openExchangeRateModal, openExpenseModal, openFinanceBreakdown,
  openIncomeModal, openInvoiceListModal, openInvoiceModal, openInvoicePdf, openMemberModal,
  openMemberPicker, openNotification, openPaymentsModal, openProjectDetail, openProjectModal,
  openProjectProfileModal, openPromptModal, openRangePickerInline, openTaskDetail, openTaskModal,
  previewInvoice, quickStatus, reconfigureCloud, removeBudgetItem, removePayment,
  render, renderPaymentsModal, resetPaymentMsg, saveBudget, saveClient,
  saveEmailConfig, saveExpense, saveFinanceSettings, saveIncome, saveManualRate,
  saveMember, saveProject, saveProjectProfile, saveTask, selectFinanceMonth,
  sendPaymentNow, sendPaymentReminder, setBaseCurrency, setFinanceMode, setPaymentAmount,
  submitPayment, testEmail, toggleRecurringFields, updateBudgetLivePreview, updateBudgetSuggestions,
  updateInvoiceDocPlaceholder, updatePaymentConversionPreview, updatePricingDescription, updateTemplatePreview,
  // Handlers inline del shell index.html (setup overlay, sidebar, notificaciones, backup).
  closeSidebar, exportData, importData, markAllRead, saveSupabaseConfig,
  skipSetup, toggleNotifications, toggleSidebar,
});

// 2) Variables de estado de vista que los handlers inline REASIGNAN.
//    Se exponen como accessors get/set que proxyean a la variable del módulo,
//    de modo que `handler: financeMode='x'` escribe la misma binding que lee render().
[
  ['financeMode',        () => financeMode,        (v) => (financeMode = v)],
  ['financeMonth',       () => financeMonth,       (v) => (financeMonth = v)],
  ['financeFrom',        () => financeFrom,        (v) => (financeFrom = v)],
  ['financeTo',          () => financeTo,          (v) => (financeTo = v)],
  ['promptStyle',        () => promptStyle,        (v) => (promptStyle = v)],
  ['tasksViewMode',      () => tasksViewMode,      (v) => (tasksViewMode = v)],
  ['tasksFilter',        () => tasksFilter,        (v) => (tasksFilter = v)],
  ['projectsViewMode',   () => projectsViewMode,   (v) => (projectsViewMode = v)],
  ['projectsListStatus', () => projectsListStatus, (v) => (projectsListStatus = v)],
  ['projectsTypeFilter', () => projectsTypeFilter, (v) => (projectsTypeFilter = v)],
  ['budgetsFilterStatus',() => budgetsFilterStatus,(v) => (budgetsFilterStatus = v)],
].forEach(([k, get, set]) => Object.defineProperty(window, k, { get, set, configurable: true }));
