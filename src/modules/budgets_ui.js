import { PROJECT_TYPE } from '../core/constants.js';
import { S } from '../core/state.js';
import { closeModal, openModal, render, showToast, viewHeader } from '../core/ui.js';
import { BUDGET_CATEGORIES, BUDGET_STATUS, BUDGET_STATUS_ORDER, COMMON_MODULES_BY_CATEGORY, COMPLEXITY_LEVELS, PRICING_MODELS, RISK_FACTORS_LIST } from './budgets/constants.js';
import { estimateBudget, getBudgetCategories } from './budgets/engine.js';
import { fmtAmount } from './invoices.js';
import { save } from '../services/cloud.js';
import { escapeAttr, escapeHtml, uid } from '../utils/helpers.js';

// Devuelve los tipos del proyecto como array (maneja legacy con projectType string)
export function getProjectTypes(p) {
  if (Array.isArray(p.projectTypes) && p.projectTypes.length) return p.projectTypes;
  if (p.projectType) return [p.projectType];
  return ['OTHER'];
}

export function projectTypesText(p) {
  return getProjectTypes(p).map(k => (PROJECT_TYPE[k] || PROJECT_TYPE.OTHER).label).join(' · ');
}

export function renderBudgets() {
  const all = (S.state.budgets || []);
  const filtered = S.budgetsFilterStatus
    ? all.filter(b => b.status === S.budgetsFilterStatus)
    : all;
  const sorted = filtered.slice().sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const totalBudgets = all.length;
  const sent = all.filter(b => b.status === 'SENT').length;
  const accepted = all.filter(b => b.status === 'ACCEPTED').length;
  const pipelineUSD = all.reduce((sum, b) => {
    if (b.status === 'REJECTED' || b.status === 'EXPIRED') return sum;
    const est = estimateBudget(b);
    const rate = Number(S.state.exchangeRate) || 1200;
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
        <button onclick="budgetsFilterStatus=''; render()" class="chip ${S.budgetsFilterStatus===''?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">Todos (${totalBudgets})</button>
        ${BUDGET_STATUS_ORDER.map(k => {
          const n = all.filter(b => b.status === k).length;
          if (n === 0) return '';
          const s = BUDGET_STATUS[k];
          return `<button onclick="budgetsFilterStatus='${k}'; render()" class="chip ${S.budgetsFilterStatus===k?'bg-black text-white':s.color} py-1.5 px-3 cursor-pointer">${s.label} (${n})</button>`;
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

export function budgetRow(b) {
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

export function openBudgetModal(id) {
  const existing = id ? (S.state.budgets || []).find(x => x.id === id) : null;
  const b = existing ? structuredClone(existing) : {
    id: null,
    code: `PRES-${new Date().getFullYear()}-${String(((S.state.budgets || []).length + 1)).padStart(4, '0')}`,
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
  S._budgetItemCounter = 0;

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

export function updatePricingDescription() {
  const sel = document.querySelector('select[name="pricingModel"]');
  const desc = document.getElementById('pricingDesc');
  if (!sel || !desc) return;
  const model = PRICING_MODELS.find(p => p.key === sel.value);
  if (model) desc.textContent = model.description;
}

export function updateBudgetSuggestions() {
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

export function addSuggestedModule(suggestion) {
  const list = document.getElementById('budgetItemsList');
  if (!list) return;
  const empty = document.getElementById('budgetItemsEmpty');
  if (empty) empty.remove();
  list.insertAdjacentHTML('beforeend', budgetItemHTML(suggestion));
  updateBudgetLivePreview();
}

export function budgetItemHTML(it) {
  const idx = S._budgetItemCounter++;
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

export function addBudgetItem() {
  const list = document.getElementById('budgetItemsList');
  if (!list) return;
  // Si tenía el placeholder italic, limpiar
  if (list.querySelector('.italic')) list.innerHTML = '';
  list.insertAdjacentHTML('beforeend', budgetItemHTML({}));
  updateBudgetLivePreview();
}

export function removeBudgetItem(idx) {
  const el = document.querySelector(`[data-item-idx="${idx}"]`);
  if (el) el.remove();
  updateBudgetLivePreview();
}

export function autoFillHours(idx, complexityKey) {
  const c = COMPLEXITY_LEVELS.find(x => x.key === complexityKey);
  if (!c) return;
  const inp = document.querySelector(`input[name="item_hours_${idx}"]`);
  if (inp) inp.value = c.default;
}

export function collectBudgetFromForm() {
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

export function updateBudgetLivePreview() {
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

export function saveBudget(e) {
  e.preventDefault();
  const b = collectBudgetFromForm();
  if (!b) return;
  if (b.items.length === 0) {
    if (!confirm('No agregaste ningún módulo. ¿Guardar igual?')) return;
  }

  S.state.budgets = S.state.budgets || [];

  if (b.id) {
    const existing = S.state.budgets.find(x => x.id === b.id);
    if (existing) {
      Object.assign(existing, b, { updatedAt: new Date().toISOString() });
    }
  } else {
    S.state.budgets.push({
      ...b,
      id: uid(),
      createdAt: new Date().toISOString(),
      createdBy: S.currentMemberId,
    });
  }

  save();
  closeModal();
  render();
  showToast('Presupuesto guardado', 'success');
}

export function deleteBudget(id) {
  const b = (S.state.budgets || []).find(x => x.id === id);
  if (!b) return;
  if (!confirm(`¿Eliminar el presupuesto "${b.clientName}"?\n\nEsta acción no se puede deshacer.`)) return;
  S.state.budgets = S.state.budgets.filter(x => x.id !== id);
  save();
  closeModal();
  render();
  showToast('Presupuesto eliminado', 'success');
}

// Vista para imprimir/guardar como PDF.
// mode: 'internal' (con costos y margen) | 'client' (limpia, sin info interna)
export function openBudgetPdfView(b, mode) {
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
export function generateBudgetPdf(mode) {
  const b = collectBudgetFromForm();
  if (!b) return;
  if (!b.clientName || (b.items || []).length === 0) {
    alert('Necesitás cargar al menos el cliente y un módulo para generar el PDF.');
    return;
  }
  // Si el budget existe en state, usamos esa versión (con createdAt etc)
  const existing = b.id ? (S.state.budgets || []).find(x => x.id === b.id) : null;
  const final = existing ? { ...existing, ...b } : { ...b, createdAt: new Date().toISOString() };
  openBudgetPdfView(final, mode);
}
