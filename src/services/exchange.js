// ============ Servicio: cotización USD ============
// Obtiene la cotización del dólar desde APIs públicas (Bluelytics / dolarapi) y la
// guarda en el estado. Extraído verbatim de index.html.
//
// Dependencias del estado/funciones compartidas se inyectan con initExchange() para
// no acoplar el módulo al monolito (patrón de la capa services/). No reasigna `state`:
// sólo muta sus propiedades, por eso alcanza con getState() devolviendo la referencia viva.

export const DOLAR_SOURCES = [
  { key: 'blue',    label: 'Blue',     desc: 'Mercado paralelo' },
  { key: 'oficial', label: 'Oficial',  desc: 'BCRA' },
  { key: 'mep',     label: 'MEP/Bolsa',desc: 'AL30' },
  { key: 'cripto',  label: 'Cripto',   desc: 'Stablecoin' },
  { key: 'tarjeta', label: 'Tarjeta',  desc: 'Oficial + impuestos' },
];

let _deps = {
  getState: () => ({}),
  save: () => {},
  render: () => {},
  showToast: () => {},
};

export function initExchange(deps) { _deps = { ..._deps, ...deps }; }

export async function fetchBluelyticsBlue({ silent = false } = {}) {
  const { getState, save, render, showToast } = _deps;
  const state = getState();
  try {
    if (!silent) showToast('Buscando dólar blue...', 'info', 1500);
    const res = await fetch('https://api.bluelytics.com.ar/v2/latest');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const rate = Number(data?.blue?.value_avg);
    if (!rate || isNaN(rate)) throw new Error('No rate');
    state.exchangeRate = Math.round(rate);
    state.exchangeRateSource = 'bluelytics';
    state.exchangeRateUpdatedAt = data.last_update || new Date().toISOString();
    save();
    if (!silent) showToast(`✓ Dólar blue: $${rate.toLocaleString('es-AR')} (Bluelytics)`, 'success', 3500);
    render();
    return rate;
  } catch (err) {
    console.warn('Bluelytics fetch failed:', err);
    if (!silent) alert('No se pudo obtener la cotización del blue. Cargala manual.\n\n' + (err.message || err));
    return null;
  }
}

export async function autoFetchBlueIfStale() {
  const { getState } = _deps;
  const state = getState();
  // Auto-fetch on boot if rate is older than 4h or never set
  const last = state.exchangeRateUpdatedAt ? new Date(state.exchangeRateUpdatedAt).getTime() : 0;
  const ageHours = (Date.now() - last) / 1000 / 3600;
  if (ageHours > 4) {
    await fetchBluelyticsBlue({ silent: true });
  }
}

export async function fetchDollarRate(source = 'blue') {
  const { getState, save, render, showToast } = _deps;
  const state = getState();
  try {
    showToast('Buscando cotización...', 'info', 1500);
    const res = await fetch(`https://dolarapi.com/v1/dolares/${source}`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const rate = Number(data.venta || data.compra);
    if (!rate || isNaN(rate)) throw new Error('No rate');
    state.exchangeRate = Math.round(rate);
    state.exchangeRateSource = source;
    state.exchangeRateUpdatedAt = data.fechaActualizacion || new Date().toISOString();
    save();
    showToast(`✓ Dólar ${source}: $${rate.toLocaleString('es-AR')}`, 'success', 3500);
    render();
  } catch (err) {
    console.error('fetchDollarRate error:', err);
    alert('No se pudo obtener la cotización. Cargala manual.\n\n' + (err.message || err));
  }
}
