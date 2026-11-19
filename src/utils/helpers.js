// ============ HELPERS (puros) ============
// Funciones utilitarias sin estado ni side-effects, extraídas verbatim de index.html.
// Cubiertas por tests/helpers.test.js (las deterministas).

// ID aleatorio corto.
export function uid() { return Math.random().toString(36).slice(2, 10); }

// Fecha corta localizada (es-AR), ej. "05 ago". '—' si no hay fecha.
export function fmt(d) { if (!d) return '—'; const x = new Date(d); return x.toLocaleDateString('es-AR', { day:'2-digit', month:'short' }); }

// Monto en pesos sin decimales, ej. "$1.200".
export function fmtMoney(n) { return '$' + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

// Fecha de hoy en ISO corto (YYYY-MM-DD).
export function todayISO() { return new Date().toISOString().slice(0,10); }

// Días entre dos fechas (b - a), redondeado.
export function daysBetween(a,b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

// Último día de un mes "YYYY-MM" → "YYYY-MM-DD".
export function lastDayOfMonth(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${yyyymm}-${String(last).padStart(2,'0')}`;
}

// Lista de meses "YYYY-MM" entre dos fechas inclusive.
export function monthsBetween(fromDate, toDate) {
  const out = [];
  let [fy, fm] = fromDate.split('-').slice(0,2).map(Number);
  const [ty, tm] = toDate.split('-').slice(0,2).map(Number);
  while (fy < ty || (fy === ty && fm <= tm)) {
    out.push(`${fy}-${String(fm).padStart(2,'0')}`);
    fm++; if (fm > 12) { fm = 1; fy++; }
  }
  return out;
}

// Mes anterior a "YYYY-MM".
export function prevMonthKey(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return `${prevY}-${String(prevM).padStart(2,'0')}`;
}

// Escapa texto para interpolar en HTML (anti-XSS). Ver AGENTS.md §11.
export function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function escapeAttr(s) { return escapeHtml(s); }
