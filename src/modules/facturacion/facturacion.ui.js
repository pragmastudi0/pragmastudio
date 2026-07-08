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
  // Condición IVA del receptor (obligatorio AFIP). Desde el cliente; si no, Consumidor Final.
  const defaultCondCode = client?.condicionIVA ? condicionIVACode(client.condicionIVA) : 5;
  // Email del cliente (para el paso de envío por email tras emitir).
  const defaultEmail = client?.email || p?.contactEmail || '';

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

        <div>
          <label class="text-xs text-gray-500">Email del cliente <span class="text-gray-400">(para enviar la factura)</span></label>
          <input type="email" name="clientEmail" class="input" value="${escapeAttr(defaultEmail)}" placeholder="cliente@empresa.com" />
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
          <label class="text-xs text-gray-500">Condición frente al IVA <span class="text-gray-400">(obligatorio AFIP)</span></label>
          <select name="condicionIVAReceptor" class="input">
            ${CONDICION_IVA_RECEPTOR.map(c => `<option value="${c.code}" ${defaultCondCode===c.code?'selected':''}>${c.label}</option>`).join('')}
          </select>
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
            <span class="text-gray-500">Condición frente al IVA:</span> ${escapeHtml(CONDICION_IVA_LABELS[Number(data.condicionIVAReceptor)] || 'Consumidor Final')}
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
      condicionIVAReceptorId: Number(data.condicionIVAReceptor) || 5,
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
      clientEmail: data.clientEmail || '',
      clientDocType: payload.clientDocType,
      clientDocNumber: payload.clientDocNumber,
      condicionIVAReceptorId: payload.condicionIVAReceptorId,
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
        <button type="button" class="btn-ghost inline-flex items-center justify-center gap-2" onclick='openInvoicePdf(${JSON.stringify(invoice).replace(/"/g,"&quot;")})'>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Descargar PDF
        </button>
        <button type="button" class="btn-primary inline-flex items-center justify-center gap-2" onclick='openSendInvoiceEmailModal(${JSON.stringify(invoice).replace(/"/g,"&quot;")})'>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z" fill="none"/><polyline points="22,6 12,13 2,6"/><path d="M2 6h20v12H2z"/></svg>
          Enviar por email
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

