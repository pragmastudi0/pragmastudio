import { CLIENT_DOC_TYPES, CONDICION_IVA, DOC_TYPE_LABELS } from '../core/constants.js';
import { getClient, getProject } from '../core/selectors.js';
import { S } from '../core/state.js';
import { closeModal, openModal, render, showToast, viewHeader } from '../core/ui.js';
import { getChargeRecord, getExpensePaymentRecord, getPaymentSummary } from './finance.js';
import { save } from '../services/cloud.js';
import { escapeAttr, escapeHtml, todayISO, uid } from '../utils/helpers.js';

// ============================================================
// CLIENTES — datos fiscales, fuente única para facturación
// ============================================================
export function renderClients() {
  const clients = S.state.clients || [];
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
          const linked = S.state.projects.filter(p => p.clientId === c.id).length;
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

export function openClientModal(id) {
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

export function saveClient(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.docNumber) data.docNumber = String(data.docNumber).replace(/[^\d]/g, '');
  S.state.clients = S.state.clients || [];
  if (data.id) {
    Object.assign(getClient(data.id), data);
  } else {
    S.state.clients.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}

export function deleteClient(id) {
  const c = getClient(id);
  if (!c) return;
  const linked = S.state.projects.filter(p => p.clientId === id);
  let warning = `¿Eliminar al cliente ${c.name}?`;
  if (linked.length > 0) warning += `\n\n${linked.length} proyecto${linked.length>1?'s':''} quedará${linked.length>1?'n':''} sin cliente asignado.`;
  if (!confirm(warning)) return;
  S.state.clients = (S.state.clients || []).filter(x => x.id !== id);
  linked.forEach(p => { p.clientId = ''; });
  save(); closeModal(); render();
}

export function _incomeIdFor(item) {
  if (!item || !item.id) return null;
  return item.auto ? `auto:${item.projectId}:${item.month}` : item.id;
}

// Total cobrado convertido a ARS, usando la cotización CONGELADA de cada pago.
// AFIP factura siempre en pesos, así que tenemos que comparar contra ARS.
export function getCollectedInARS(item) {
  const s = getPaymentSummary(item);
  return s.payments.reduce((sum, p) => {
    const amt = p.amount != null ? Number(p.amount) : s.expected;
    const cur = p.currency || item.currency || 'ARS';
    const rate = Number(p.exchangeRate) || Number(S.state.exchangeRate) || 1200;
    return sum + (cur === 'USD' ? amt * rate : amt);
  }, 0);
}

export function getAllInvoicesFor(item) {
  const incomeId = _incomeIdFor(item);
  if (!incomeId) return [];
  return (S.state.invoices || []).filter(inv => inv.incomeId === incomeId && !inv.voided);
}

export function getInvoicedInARS(item) {
  return getAllInvoicesFor(item).reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
}

// Diferencia entre lo cobrado (en ARS) y lo ya facturado.
// Si > 0 → hay saldo para facturar.
export function getRemainingToInvoiceARS(item) {
  return Math.max(0, getCollectedInARS(item) - getInvoicedInARS(item));
}

// Mantengo nombres viejos para compat, pero ahora con semántica de "totalmente facturado"
export function hasInvoiceFor(item) {
  if (!item || !item.id) return false;
  const invoices = getAllInvoicesFor(item);
  if (invoices.length === 0) return false;
  return getRemainingToInvoiceARS(item) < 0.5; // tolerancia de centavos
}

export function getInvoiceFor(item) {
  const invoices = getAllInvoicesFor(item);
  return invoices[0] || null; // primera factura (las demás se muestran agrupadas)
}

// ¿Hay algo para facturar ahora? (cobrado > facturado)
export function canEmitInvoice(item) {
  return getRemainingToInvoiceARS(item) > 0.5;
}

export async function getAuthToken() {
  if (!S.sb) throw new Error('Supabase no disponible');
  const { data: { session } } = await S.sb.auth.getSession();
  if (!session?.access_token) throw new Error('Sesión expirada — re-loguéate');
  return session.access_token;
}

export async function callApi(path, opts = {}) {
  const token = await getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  // Contexto de organización (Fase 1): el backend exige membresía cuando viene.
  if (S.activeOrgId) headers['X-Org-Id'] = S.activeOrgId;
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json;
  try { json = await res.json(); } catch { json = { error: 'Respuesta inválida del servidor' }; }
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json;
}

export function openInvoiceModal(item) {
  S._currentInvoiceItem = item;
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
      ? Math.round(s.expected * (Number(S.state.exchangeRate) || 1200))
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
          ${cur === 'USD' ? `<p class="text-[11px] text-gray-500 mt-1">Original ingreso: US$${s.expected.toLocaleString('es-AR')} · cambio actual $${(Number(S.state.exchangeRate)||1200).toLocaleString('es-AR')}</p>` : ''}
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

export function previewInvoice(e) {
  e.preventDefault();
  if (!S._currentInvoiceItem) return;
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

  S._currentInvoiceForm = data;
  renderInvoicePreview();
}

export function renderInvoicePreview() {
  const item = S._currentInvoiceItem;
  const data = S._currentInvoiceForm;
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

export function backToEditInvoice() {
  // Re-render the form, then restore values from _currentInvoiceForm
  const item = S._currentInvoiceItem;
  const saved = S._currentInvoiceForm;
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

export function renderInvoiceLoading(currentStep) {
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

export async function confirmEmitInvoice() {
  if (!S._currentInvoiceItem || !S._currentInvoiceForm) return;
  const item = S._currentInvoiceItem;
  const data = S._currentInvoiceForm;

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
    S.state.invoices = S.state.invoices || [];
    S.state.invoices.push(invoice);
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

export function renderInvoiceSuccess(invoice) {
  S._currentInvoiceForm = null;
  S._currentInvoiceItem = null;
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

export function openInvoiceListModal(item) {
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

export function openInvoicePdf(invoice) {
  // Fallback: si la factura es vieja y no tiene snapshots, reconstruir desde el income
  if (!invoice._itemConcept || !invoice._projectName) {
    const inc = invoice.incomeId && !invoice.incomeId.startsWith('auto:')
      ? S.state.incomes.find(i => i.id === invoice.incomeId)
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

export function updateInvoiceDocPlaceholder(docType) {
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

export async function checkAfipStatus() {
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

export function reactivateRecurringExpense(expenseId) {
  const e = S.state.expenses.find(x => x.id === expenseId);
  if (!e) return;
  e.recurringEndDate = null;
  save(); render();
  showToast('Gasto fijo reactivado', 'success');
}

// Borrado total: elimina el gasto + todo el historial de pagos recurrentes
export function deleteRecurringExpenseFull(expenseId) {
  const e = S.state.expenses.find(x => x.id === expenseId);
  if (!e) return;
  const paymentsCount = (S.state.recurringExpensePayments || []).filter(r => r.expenseId === expenseId).length;
  const detail = paymentsCount > 0
    ? `\n\nSe va a borrar el gasto original y los ${paymentsCount} pago${paymentsCount>1?'s':''} registrado${paymentsCount>1?'s':''}.`
    : '';
  if (!confirm(`¿Eliminar completamente "${e.concept}"?${detail}\n\nEsto NO se puede deshacer.`)) return;
  S.state.expenses = S.state.expenses.filter(x => x.id !== expenseId);
  S.state.recurringExpensePayments = (S.state.recurringExpensePayments || []).filter(r => r.expenseId !== expenseId);
  save(); render();
  showToast('Gasto eliminado completamente', 'success');
}

export function inRange(date, from, to) {
  return date >= from && date <= to;
}

export function fmtAmount(n, currency) {
  const c = currency || S.state.defaultCurrency || 'ARS';
  const symbol = c === 'USD' ? 'US$' : '$';
  return symbol + (Number(n)||0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function toBaseCurrency(amount, fromCurrency, toCurrency) {
  const from = fromCurrency || 'ARS';
  const to = toCurrency || S.state.defaultCurrency || 'ARS';
  if (from === to) return Number(amount);
  const rate = Number(S.state.exchangeRate) || 1200;
  if (from === 'USD' && to === 'ARS') return Number(amount) * rate;
  if (from === 'ARS' && to === 'USD') return Number(amount) / rate;
  return Number(amount);
}

export function convertAt(amount, fromCurrency, toCurrency, rate) {
  const from = fromCurrency || 'ARS';
  const to = toCurrency || S.state.defaultCurrency || 'ARS';
  if (from === to) return Number(amount);
  const r = Number(rate) || 1200;
  if (from === 'USD' && to === 'ARS') return Number(amount) * r;
  if (from === 'ARS' && to === 'USD') return Number(amount) / r;
  return Number(amount);
}

// Cotización efectiva del item: la "congelada" si fue confirmado, o la actual si está pendiente
export function getEffectiveRate(item) {
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
  return Number(S.state.exchangeRate) || 1200;
}

export function toBaseCurrencyForItem(item, toCurrency) {
  return convertAt(item.amount, item.currency, toCurrency, getEffectiveRate(item));
}
