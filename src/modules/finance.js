import { EXPENSE_CAT, MONTH_NAMES_FULL, MONTH_NAMES_SHORT } from '../core/constants.js';
import { getProject } from '../core/selectors.js';
import { S } from '../core/state.js';
import { closeModal, openModal, render, showToast } from '../core/ui.js';
import { canEmitInvoice, convertAt, fmtAmount, getAllInvoicesFor, getEffectiveRate, inRange, toBaseCurrencyForItem } from './invoices.js';
import { save } from '../services/cloud.js';
import { DOLAR_SOURCES } from '../services/exchange.js';
import { escapeAttr, escapeHtml, fmt, fmtMoney, lastDayOfMonth, monthsBetween, todayISO, uid } from '../utils/helpers.js';

export function getFinanceRange() {
  if (S.financeMode === 'month') {
    const [y, m] = S.financeMonth.split('-').map(Number);
    return { from: S.financeMonth + '-01', to: lastDayOfMonth(S.financeMonth), label: `${MONTH_NAMES_FULL[m-1]} ${y}` };
  }
  if (S.financeMode === 'year') {
    return { from: `${S.financeYear}-01-01`, to: `${S.financeYear}-12-31`, label: `Año ${S.financeYear}` };
  }
  return { from: S.financeFrom, to: S.financeTo, label: `${fmt(S.financeFrom)} → ${fmt(S.financeTo)}` };
}

export function isMonthCharged(projectId, month) {
  return (S.state.recurringChargeLog || []).some(r => r.projectId === projectId && r.month === month);
}

export function getChargeRecord(projectId, month) {
  return (S.state.recurringChargeLog || []).find(r => r.projectId === projectId && r.month === month);
}

export function toggleMonthCharged(projectId, month) {
  if (isMonthCharged(projectId, month)) {
    S.state.recurringChargeLog = S.state.recurringChargeLog.filter(r => !(r.projectId === projectId && r.month === month));
  } else {
    const rate = Number(S.state.exchangeRate) || 1200;
    S.state.recurringChargeLog.push({
      id: uid(),
      projectId,
      month,
      chargedAt: new Date().toISOString(),
      chargedBy: S.currentMemberId,
      exchangeRate: rate,
      exchangeRateSource: S.state.exchangeRateSource || 'manual',
    });
    const p = getProject(projectId);
    const inAR = (p && p.monthlyFeeCurrency === 'USD') ? ` · cotización $${rate.toLocaleString('es-AR')}` : '';
    showToast(`Pago marcado como cobrado${inAR}`, 'success');
  }
  save(); render();
}

export function getAutoIncomes(month) {
  // Ingresos virtuales a partir de proyectos ACTIVE_RECURRING con mensualidad
  const out = [];
  S.state.projects.forEach(p => {
    if (p.status !== 'ACTIVE_RECURRING' || !p.monthlyFee) return;
    const startMonth = (p.startDate || '').slice(0, 7);
    if (startMonth && startMonth > month) return;
    const endMonth = (p.endDate || '').slice(0, 7);
    if (endMonth && endMonth < month) return;
    const charged = isMonthCharged(p.id, month);
    out.push({
      id: `auto-${p.id}-${month}`,
      amount: Number(p.monthlyFee),
      currency: p.monthlyFeeCurrency || S.state.defaultCurrency || 'ARS',
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

export function getAutoIncomesInRange(from, to) {
  const fromM = from.slice(0,7);
  const toM = to.slice(0,7);
  return monthsBetween(fromM + '-01', toM + '-01').flatMap(m => getAutoIncomes(m));
}

// ---- Auto expenses (gastos fijos recurrentes) ----
export function getExpensePaymentRecord(expenseId, month) {
  return (S.state.recurringExpensePayments || []).find(r => r.expenseId === expenseId && r.month === month);
}

export function isExpenseMonthPaid(expenseId, month) {
  return !!getExpensePaymentRecord(expenseId, month);
}

export function getAutoExpenses(month) {
  // Genera gastos virtuales para meses posteriores a partir de gastos FIXED con recurring=true
  const out = [];
  S.state.expenses.forEach(e => {
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

export function getAutoExpensesInRange(from, to) {
  const fromM = from.slice(0,7);
  const toM = to.slice(0,7);
  return monthsBetween(fromM + '-01', toM + '-01').flatMap(m => getAutoExpenses(m));
}

// ---- Cash-flow: lista todos los pagos con su fecha real (no la fecha del item original) ----
export function getAllCashFlowPayments(kind) {
  const out = [];

  if (kind === 'income') {
    // 1. Pagos explícitos sobre ingresos manuales
    (S.state.incomePayments || []).forEach(p => {
      const inc = S.state.incomes.find(i => i.id === p.incomeId);
      if (!inc) return;
      out.push({
        amount: Number(p.amount) || 0,
        currency: p.currency || inc.currency || 'ARS',
        date: (p.date || p.paidAt || '').slice(0, 10),
        exchangeRate: Number(p.exchangeRate) || Number(inc.exchangeRateAtTime) || Number(S.state.exchangeRate) || 1200,
      });
    });
    // 2. Pagos sobre mensualidades recurrentes (cobros)
    (S.state.recurringChargeLog || []).forEach(r => {
      const proj = getProject(r.projectId);
      if (!proj) return;
      const amount = r.amount != null ? Number(r.amount) : Number(proj.monthlyFee || 0);
      out.push({
        amount,
        currency: r.currency || proj.monthlyFeeCurrency || 'ARS',
        date: (r.date || r.chargedAt || '').slice(0, 10),       // ← prefiere r.date
        exchangeRate: Number(r.exchangeRate) || Number(S.state.exchangeRate) || 1200,
      });
    });
    // 3. Sintético: ingresos confirmados sin payment log (back-compat con data vieja)
    S.state.incomes.forEach(i => {
      if ((S.state.incomePayments || []).some(p => p.incomeId === i.id)) return;
      if ((i.status || 'CONFIRMED') !== 'CONFIRMED') return;
      out.push({
        amount: Number(i.amount) || 0,
        currency: i.currency || 'ARS',
        date: ((i.confirmedAt && i.confirmedAt.slice(0,10)) || i.date || '').slice(0, 10),
        exchangeRate: Number(i.exchangeRateAtTime) || Number(S.state.exchangeRate) || 1200,
      });
    });
  } else {
    // 1. Pagos explícitos sobre gastos manuales
    (S.state.expensePayments || []).forEach(p => {
      const exp = S.state.expenses.find(e => e.id === p.expenseId);
      if (!exp) return;
      out.push({
        amount: Number(p.amount) || 0,
        currency: p.currency || exp.currency || 'ARS',
        date: (p.date || p.paidAt || '').slice(0, 10),
        exchangeRate: Number(p.exchangeRate) || Number(exp.exchangeRateAtTime) || Number(S.state.exchangeRate) || 1200,
      });
    });
    // 2. Pagos sobre gastos fijos recurrentes
    (S.state.recurringExpensePayments || []).forEach(r => {
      const exp = S.state.expenses.find(e => e.id === r.expenseId);
      if (!exp) return;
      const amount = r.amount != null ? Number(r.amount) : Number(exp.amount || 0);
      out.push({
        amount,
        currency: r.currency || exp.currency || 'ARS',
        date: (r.date || r.paidAt || '').slice(0, 10),          // ← prefiere r.date
        exchangeRate: Number(r.exchangeRate) || Number(S.state.exchangeRate) || 1200,
      });
    });
    // 3. Sintético: gastos pagados sin payment log (back-compat con data vieja)
    S.state.expenses.forEach(e => {
      if ((S.state.expensePayments || []).some(p => p.expenseId === e.id)) return;
      if ((e.status || 'PAID') !== 'PAID') return;
      out.push({
        amount: Number(e.amount) || 0,
        currency: e.currency || 'ARS',
        date: ((e.paidAt && e.paidAt.slice(0,10)) || e.date || '').slice(0, 10),
        exchangeRate: Number(e.exchangeRateAtTime) || Number(S.state.exchangeRate) || 1200,
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
export function getCarryOversForMonth(viewedMonth) {
  const incomes = [];

  // Manual incomes anteriores con saldo parcial
  S.state.incomes.forEach(i => {
    if (!i.date) return;
    const m = i.date.slice(0, 7);
    if (m >= viewedMonth) return;
    const tmp = { ...i, _kind: 'income' };
    const sum = getPaymentSummary(tmp);
    if (sum.status !== 'PARTIAL') return;
    incomes.push({ ...i, _kind: 'income', _carryOver: true, _carryOverFrom: m, _carryOverRemaining: sum.remaining });
  });

  // Recurring incomes (mensualidades) parciales de meses anteriores
  S.state.projects.forEach(p => {
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

export function toggleExpenseMonthPaid(expenseId, month) {
  if (isExpenseMonthPaid(expenseId, month)) {
    S.state.recurringExpensePayments = S.state.recurringExpensePayments.filter(r => !(r.expenseId === expenseId && r.month === month));
  } else {
    S.state.recurringExpensePayments.push({
      id: uid(),
      expenseId,
      month,
      paidAt: new Date().toISOString(),
      paidBy: S.currentMemberId,
      exchangeRate: Number(S.state.exchangeRate) || 1200,
      exchangeRateSource: S.state.exchangeRateSource || 'manual',
    });
    showToast('Gasto marcado como pagado', 'success');
  }
  save(); render();
}

export function cancelRecurringExpense(expenseId) {
  const e = S.state.expenses.find(x => x.id === expenseId);
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
export function getPaymentSummary(item) {
  const expected = Number(item.amount) || 0;
  let payments = [];
  let kind = '';

  if (item.auto && item.sourceExpenseId) {
    kind = 'expense_recurring';
    payments = (S.state.recurringExpensePayments || []).filter(r => r.expenseId === item.sourceExpenseId && r.month === item.month);
  } else if (item.auto) {
    kind = 'income_recurring';
    payments = (S.state.recurringChargeLog || []).filter(r => r.projectId === item.projectId && r.month === item.month);
  } else if (item._kind === 'income') {
    kind = 'income';
    payments = (S.state.incomePayments || []).filter(p => p.incomeId === item.id);
    // Backwards compat: status=CONFIRMED sin pagos = pago completo sintético
    if (payments.length === 0 && (item.status || 'CONFIRMED') === 'CONFIRMED') {
      payments = [{ id: '__synth__'+item.id, amount: expected, exchangeRate: item.exchangeRateAtTime || S.state.exchangeRate, synthetic: true, paidAt: item.confirmedAt || item.date }];
    }
  } else if (item._kind === 'expense') {
    kind = 'expense';
    payments = (S.state.expensePayments || []).filter(p => p.expenseId === item.id);
    if (payments.length === 0 && (item.status || 'PAID') === 'PAID') {
      payments = [{ id: '__synth__'+item.id, amount: expected, exchangeRate: item.exchangeRateAtTime || S.state.exchangeRate, synthetic: true, paidAt: item.paidAt || item.date }];
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
export function getPaymentChip(item) {
  const s = getPaymentSummary(item);
  const isInc = item._kind === 'income' || (item.auto && !item.sourceExpenseId);
  if (s.status === 'PAID')    return { label: isInc ? 'Cobrado' : 'Pagado',        color: 'bg-green-100 text-green-700' };
  if (s.status === 'PARTIAL') return { label: `${s.percent}% ${isInc?'cobrado':'pagado'}`, color: 'bg-blue-100 text-blue-700' };
  return                       { label: 'Pendiente',                                color: 'bg-amber-100 text-amber-800' };
}

export function addPaymentToItem(item, amount, date, note) {
  const rate = Number(S.state.exchangeRate) || 1200;
  const userDate = date || todayISO();
  const base = {
    id: uid(),
    amount: Number(amount),
    currency: item.currency || 'ARS',           // ← guarda moneda explícita
    date: userDate,                             // ← fecha que el usuario eligió
    paidAt: new Date().toISOString(),           // ← timestamp de cuando se registró
    paidBy: S.currentMemberId,
    exchangeRate: rate,
    exchangeRateSource: S.state.exchangeRateSource || 'manual',
    note: note || '',
  };

  if (item.auto && item.sourceExpenseId) {
    S.state.recurringExpensePayments.push({ ...base, expenseId: item.sourceExpenseId, month: item.month });
  } else if (item.auto) {
    // chargedAt = user-chosen date (no el timestamp). El timestamp queda en paidAt.
    S.state.recurringChargeLog.push({ ...base, projectId: item.projectId, month: item.month, chargedAt: userDate, chargedBy: S.currentMemberId });
  } else if (item._kind === 'income') {
    const real = S.state.incomes.find(x => x.id === item.id);
    if (real) real.status = 'CONFIRMED';
    S.state.incomePayments.push({ ...base, incomeId: item.id });
  } else if (item._kind === 'expense') {
    const real = S.state.expenses.find(x => x.id === item.id);
    if (real) real.status = 'PAID';
    S.state.expensePayments.push({ ...base, expenseId: item.id });
  }
  save();
}

export function removePayment(kind, paymentId) {
  if (paymentId.startsWith('__synth__')) {
    // Sintético: viene del status binario. Limpiar el status del item.
    const realId = paymentId.slice('__synth__'.length);
    const inc = S.state.incomes.find(x => x.id === realId);
    if (inc) { inc.status = 'PENDING'; inc.exchangeRateAtTime = null; inc.confirmedAt = null; }
    const exp = S.state.expenses.find(x => x.id === realId);
    if (exp) { exp.status = 'PENDING'; exp.exchangeRateAtTime = null; exp.paidAt = null; }
  } else if (kind === 'income_recurring') {
    S.state.recurringChargeLog = S.state.recurringChargeLog.filter(r => r.id !== paymentId);
  } else if (kind === 'expense_recurring') {
    S.state.recurringExpensePayments = S.state.recurringExpensePayments.filter(r => r.id !== paymentId);
  } else if (kind === 'income') {
    S.state.incomePayments = S.state.incomePayments.filter(r => r.id !== paymentId);
  } else if (kind === 'expense') {
    S.state.expensePayments = S.state.expensePayments.filter(r => r.id !== paymentId);
  }
  save();
}

export function openPaymentsModal(item) {
  S._currentPaymentsItem = item;
  renderPaymentsModal();
}

export function renderPaymentsModal() {
  const item = S._currentPaymentsItem;
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

export function setPaymentAmount(amount) {
  const inp = document.getElementById('paymentAmountInput');
  if (inp) inp.value = Number(amount).toFixed(2);
  updatePaymentConversionPreview();
}

// Live preview: muestra la conversión a la otra moneda al cambio actual
// para que el usuario detecte si está cargando en la moneda equivocada
export function updatePaymentConversionPreview() {
  if (!S._currentPaymentsItem) return;
  const inp = document.getElementById('paymentAmountInput');
  const preview = document.getElementById('paymentConversionPreview');
  if (!inp || !preview) return;
  const amount = Number(inp.value) || 0;
  if (amount <= 0) { preview.textContent = ''; return; }
  const cur = S._currentPaymentsItem.currency || 'ARS';
  const rate = Number(S.state.exchangeRate) || 1200;
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

export function submitPayment(e) {
  e.preventDefault();
  if (!S._currentPaymentsItem) return;
  const data = Object.fromEntries(new FormData(e.target).entries());
  const amount = Number(data.amount);
  if (!amount || isNaN(amount)) return alert('Monto inválido');
  addPaymentToItem(S._currentPaymentsItem, amount, data.date, data.note);
  // Refrescamos el item con el nuevo state
  if (S._currentPaymentsItem.auto && S._currentPaymentsItem.sourceExpenseId) {
    // Recompute auto-expense
    const fresh = getAutoExpenses(S._currentPaymentsItem.month).find(x => x.sourceExpenseId === S._currentPaymentsItem.sourceExpenseId);
    if (fresh) S._currentPaymentsItem = { ...fresh, _kind: 'expense' };
  } else if (S._currentPaymentsItem.auto) {
    const fresh = getAutoIncomes(S._currentPaymentsItem.month).find(x => x.projectId === S._currentPaymentsItem.projectId);
    if (fresh) S._currentPaymentsItem = { ...fresh, _kind: 'income' };
  }
  renderPaymentsModal();
  // re-render main view in background
  render();
}

export function openExchangeRateModal() {
  const updatedLabel = S.state.exchangeRateUpdatedAt
    ? new Date(S.state.exchangeRateUpdatedAt).toLocaleString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
    : 'nunca';
  let srcLabel = 'Manual';
  if (S.state.exchangeRateSource === 'bluelytics') srcLabel = 'Blue (Bluelytics)';
  else if (S.state.exchangeRateSource && S.state.exchangeRateSource !== 'manual') {
    srcLabel = DOLAR_SOURCES.find(s => s.key === S.state.exchangeRateSource)?.label || S.state.exchangeRateSource;
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
            <input type="number" step="1" name="rate" class="input flex-1 text-lg font-semibold" value="${S.state.exchangeRate || 1200}" autofocus />
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

export function saveManualRate(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const rate = Number(data.rate);
  if (!rate || isNaN(rate)) return alert('Valor inválido');
  S.state.exchangeRate = rate;
  S.state.exchangeRateSource = 'manual';
  S.state.exchangeRateUpdatedAt = new Date().toISOString();
  save();
  closeModal();
  showToast('Cotización actualizada', 'success');
  render();
}

export const PAYMENT_VARS = [
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
      const base = S.state.defaultCurrency || 'ARS';
      const rate = Number(S.state.exchangeRate) || 1200;
      const converted = convertAt(i.amount, i.currency, base, rate);
      return fmtAmount(converted, base);
    } },
  { key: 'amountOriginal', label: 'Monto original', resolve: (p, i) => fmtAmount(i.amount, i.currency) },
  { key: 'amountARS',  label: 'Monto en ARS hoy', resolve: (p, i) => {
      if (i.currency === 'ARS') return fmtAmount(i.amount, 'ARS');
      const rate = Number(S.state.exchangeRate) || 1200;
      return fmtAmount(Number(i.amount) * rate, 'ARS');
    } },
  { key: 'amountUSD',  label: 'Monto en USD hoy', resolve: (p, i) => {
      if (i.currency === 'USD') return fmtAmount(i.amount, 'USD');
      const rate = Number(S.state.exchangeRate) || 1200;
      return fmtAmount(Number(i.amount) / rate, 'USD');
    } },
  { key: 'rate',    label: 'Cotización USD',  resolve: () => '$' + (Number(S.state.exchangeRate)||1200).toLocaleString('es-AR') },
  { key: 'date',    label: 'Fecha hoy',       resolve: () => new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' }) },
];

export function buildPaymentMessage(income) {
  const p = getProject(income.projectId);
  if (!p) return '';
  let msg = S.state.paymentMessageTemplate || '';
  PAYMENT_VARS.forEach(v => {
    // Función como reemplazo: evita interpretar $ como backreference
    msg = msg.replace(new RegExp(`\\{${v.key}\\}`, 'g'), () => String(v.resolve(p, income) ?? ''));
  });
  return msg;
}

export function sendPaymentReminder(income) {
  const p = getProject(income.projectId);
  if (!p) return;
  if (!p.contactPhone) {
    alert('Este proyecto no tiene WhatsApp del cliente cargado. Editá el proyecto para agregarlo.');
    return;
  }
  openPaymentMessageModal(income);
}

export function openPaymentMessageModal(income) {
  S._currentPaymentIncome = income;
  const p = getProject(income.projectId);
  const phone = (p.contactPhone || '').replace(/[^\d]/g, '');
  const msg = buildPaymentMessage(income);
  const itemCurrency = income.currency || 'ARS';
  const base = S.state.defaultCurrency || 'ARS';
  const rate = Number(S.state.exchangeRate) || 1200;
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

export function resetPaymentMsg() {
  if (!S._currentPaymentIncome) return;
  const msg = buildPaymentMessage(S._currentPaymentIncome);
  document.getElementById('paymentMsgText').value = msg;
  showToast('Mensaje restaurado', 'info', 1500);
}

export function copyPaymentMsg() {
  const text = document.getElementById('paymentMsgText').value;
  navigator.clipboard.writeText(text).then(() => {
    showToast('✓ Copiado al portapapeles', 'success', 2000);
  });
}

export function sendPaymentNow(phone) {
  const text = document.getElementById('paymentMsgText').value;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  closeModal();
}

export function monthBalance(month) {
  const m = month || S.financeMonth;
  const inc = S.state.incomes.filter(i => i.date && i.date.startsWith(m)).reduce((a,b) => a + Number(b.amount||0), 0);
  const autoInc = getAutoIncomes(m).reduce((a,b) => a + Number(b.amount||0), 0);
  const exp = S.state.expenses.filter(e => e.date && e.date.startsWith(m)).reduce((a,b) => a + Number(b.amount||0), 0);
  return inc + autoInc - exp;
}

export function setFinanceMode(m) { S.financeMode = m; render(); }

export function setBaseCurrency(cur) {
  S.state.defaultCurrency = (cur === 'ARS' ? 'ARS' : 'USD');
  save();
  render();
}

export function openFinanceBreakdown(kind) {
  const audit = window._financeAudit;
  if (!audit) { alert('Recargá la página y probá de nuevo'); return; }
  const rows = kind === 'income' ? audit.income : audit.expense;
  const totalARS = kind === 'income' ? audit.totalIncARS : audit.totalExpARS;
  const totalUSD = kind === 'income' ? audit.totalIncUSD : audit.totalExpUSD;
  const baseCur = audit.baseCur;
  const title = kind === 'income' ? 'Detalle de Cobrado' : 'Detalle de Pagado';
  const color = kind === 'income' ? 'text-green-700' : 'text-red-600';
  const rateNow = Number(S.state.exchangeRate) || 1200;

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

export function getDisplayYear() {
  if (S.financeMode === 'year') return Number(S.financeYear);
  if (S.financeMode === 'range') return Number((S.financeFrom || todayISO()).slice(0,4));
  return Number((S.financeMonth || todayISO()).slice(0,4));
}

export function navYear(delta) {
  const y = getDisplayYear() + delta;
  if (S.financeMode === 'year') {
    S.financeYear = String(y);
  } else if (S.financeMode === 'month') {
    const mm = S.financeMonth.slice(5, 7);
    S.financeMonth = `${y}-${mm}`;
  } else if (S.financeMode === 'range') {
    // Shift range by 1 year
    const shiftDate = (d) => {
      const [yy, mm, dd] = d.split('-');
      return `${Number(yy)+delta}-${mm}-${dd}`;
    };
    if (S.financeFrom) S.financeFrom = shiftDate(S.financeFrom);
    if (S.financeTo)   S.financeTo   = shiftDate(S.financeTo);
    S.financeYear = String(y);
  }
  render();
}

export function selectFinanceMonth(monthKey) {
  S.financeMode = 'month';
  S.financeMonth = monthKey;
  render();
}

export function openRangePickerInline() {
  if (S.financeMode === 'range') {
    // Si ya estaba activo, vuelvo al mes actual
    S.financeMode = 'month';
  } else {
    S.financeMode = 'range';
    // Inicializar rango si no estaba
    if (!S.financeFrom) S.financeFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0,10);
    if (!S.financeTo) S.financeTo = todayISO();
  }
  render();
}

export function renderFinance() {
  const { from, to, label } = getFinanceRange();
  const baseCur = S.state.defaultCurrency || 'ARS';

  const realInc = S.state.incomes.filter(i => i.date && inRange(i.date, from, to))
    .map(i => ({ ...i, status: i.status || 'CONFIRMED' }));
  const autoInc = getAutoIncomesInRange(from, to);
  const realExp = S.state.expenses.filter(e => e.date && inRange(e.date, from, to))
    .map(e => ({ ...e, status: e.status || 'PAID' }));
  const autoExp = getAutoExpensesInRange(from, to);

  // Arrastres sólo en vista de Mes individual
  const carryOvers = S.financeMode === 'month' ? getCarryOversForMonth(S.financeMonth) : { incomes: [], expenses: [] };
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
        const rate = Number(p.exchangeRate) || Number(S.state.exchangeRate) || 1200;
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
    const m = i._carryOver ? S.financeMonth : (i.month || i.date || '').slice(0,7);
    addRow(m, { ...i, _kind: 'income' });
  });
  exp.forEach(e => {
    const m = e._carryOver ? S.financeMonth : (e.date || '').slice(0,7);
    addRow(m, { ...e, _kind: 'expense' });
  });

  // (B) Items con PAGOS dentro del rango pero período en OTRO mes → aparecen también en el mes del pago
  function addForeignPaymentRows() {
    (S.state.incomePayments || []).forEach(p => {
      const inc = S.state.incomes.find(x => x.id === p.incomeId);
      if (!inc) return;
      const d = (p.date || p.paidAt || '').slice(0,10);
      if (!d || !inRange(d, from, to)) return;
      const payM = d.slice(0,7);
      const itemM = (inc.date || '').slice(0,7);
      if (payM === itemM) return; // ya está en (A)
      addRow(payM, { ...inc, _kind: 'income', _foreignPayment: true, _originalPeriod: itemM });
    });
    (S.state.expensePayments || []).forEach(p => {
      const exp = S.state.expenses.find(x => x.id === p.expenseId);
      if (!exp) return;
      const d = (p.date || p.paidAt || '').slice(0,10);
      if (!d || !inRange(d, from, to)) return;
      const payM = d.slice(0,7);
      const itemM = (exp.date || '').slice(0,7);
      if (payM === itemM) return;
      addRow(payM, { ...exp, _kind: 'expense', _foreignPayment: true, _originalPeriod: itemM });
    });
    (S.state.recurringChargeLog || []).forEach(r => {
      const d = (r.date || r.chargedAt || '').slice(0,10);
      if (!d || !inRange(d, from, to)) return;
      const payM = d.slice(0,7);
      if (payM === r.month) return;
      const lastDay = String(new Date(Number(r.month.slice(0,4)), Number(r.month.slice(5,7)), 0).getDate()).padStart(2,'0');
      const autos = getAutoIncomesInRange(`${r.month}-01`, `${r.month}-${lastDay}`);
      const match = autos.find(a => a.projectId === r.projectId && a.month === r.month);
      if (match) addRow(payM, { ...match, _kind: 'income', _foreignPayment: true, _originalPeriod: r.month });
    });
    (S.state.recurringExpensePayments || []).forEach(r => {
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
  const _rateNow = Number(S.state.exchangeRate) || 1200;
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
    S.state.incomes.forEach(i => i.date && yrs.add(Number(i.date.slice(0,4))));
    S.state.expenses.forEach(e => e.date && yrs.add(Number(e.date.slice(0,4))));
    S.state.projects.forEach(p => p.startDate && yrs.add(Number(p.startDate.slice(0,4))));
    return [...yrs].sort((a,b) => b-a);
  })();

  const displayYear = getDisplayYear();
  const showPending = S.financeMode === 'month';  // pending solo en vista mes

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
          <button onclick="setFinanceMode('year')" class="px-3 py-1.5 rounded-lg text-sm ${S.financeMode==='year'?'bg-black text-white':'bg-gray-100 text-gray-700 hover:bg-gray-200'} transition">Año completo</button>
          <button onclick="openRangePickerInline()" class="px-3 py-1.5 rounded-lg text-sm ${S.financeMode==='range'?'bg-black text-white':'bg-gray-100 text-gray-700 hover:bg-gray-200'} transition">Rango custom</button>

          <span class="hidden sm:inline text-gray-300">·</span>
          <div class="flex items-center gap-0.5 bg-gray-100 rounded-lg p-1" title="Moneda principal de display">
            <button onclick="setBaseCurrency('USD')" class="px-2.5 py-1 rounded-md text-xs font-semibold transition ${baseCur==='USD'?'bg-white shadow-sm text-gray-900':'text-gray-500 hover:text-gray-700'}">USD</button>
            <button onclick="setBaseCurrency('ARS')" class="px-2.5 py-1 rounded-md text-xs font-semibold transition ${baseCur==='ARS'?'bg-white shadow-sm text-gray-900':'text-gray-500 hover:text-gray-700'}">ARS</button>
          </div>
          <button onclick="openExchangeRateModal()" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-black hover:bg-gray-50 transition text-sm" title="${S.state.exchangeRateSource === 'bluelytics' ? 'Dólar blue auto · Bluelytics' : 'Cotización del dólar'}">
            ${S.state.exchangeRateSource === 'bluelytics' ? '<span class="w-2 h-2 rounded-full bg-green-500"></span>' : ''}
            <span class="text-gray-500 text-xs">${S.state.exchangeRateSource === 'bluelytics' ? 'Blue' : 'TC'}</span>
            <span class="font-semibold">$${(S.state.exchangeRate || 1200).toLocaleString('es-AR')}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-400"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
          </button>
        </div>

        <!-- Month pills (Ene-Dic) -->
        <div class="flex flex-wrap gap-1">
          ${MONTH_NAMES_SHORT.map((mName, idx) => {
            const mNum = String(idx+1).padStart(2,'0');
            const mKey = `${displayYear}-${mNum}`;
            const active = S.financeMode === 'month' && S.financeMonth === mKey;
            const isCurrent = mKey === new Date().toISOString().slice(0,7);
            return `<button onclick="selectFinanceMonth('${mKey}')" class="px-3 py-1.5 rounded-md text-sm transition ${active?'bg-black text-white':isCurrent?'bg-blue-50 text-blue-700 hover:bg-blue-100':'bg-gray-100 text-gray-700 hover:bg-gray-200'}">${mName}</button>`;
          }).join('')}
        </div>

        <!-- Range picker inline (visible only in range mode) -->
        ${S.financeMode === 'range' ? `
          <div class="flex flex-wrap items-center gap-2 pt-1">
            <span class="text-xs text-gray-500 uppercase tracking-wider">Rango:</span>
            <input type="date" class="input max-w-[150px]" value="${S.financeFrom}" onchange="financeFrom=this.value; render()" />
            <span class="text-gray-400 text-sm">→</span>
            <input type="date" class="input max-w-[150px]" value="${S.financeTo}" onchange="financeTo=this.value; render()" />
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

export function toggleItemStatus(kind, id) {
  if (kind === 'income') {
    const i = S.state.incomes.find(x => x.id === id);
    if (!i) return;
    const goingToConfirmed = !(i.status === 'CONFIRMED' || !i.status);
    i.status = goingToConfirmed ? 'CONFIRMED' : 'PENDING';
    if (goingToConfirmed) {
      i.exchangeRateAtTime = Number(S.state.exchangeRate) || 1200;
      i.exchangeRateSource = S.state.exchangeRateSource || 'manual';
      i.confirmedAt = new Date().toISOString();
    } else {
      i.exchangeRateAtTime = null;
      i.confirmedAt = null;
    }
  } else {
    const e = S.state.expenses.find(x => x.id === id);
    if (!e) return;
    const goingToPaid = !(e.status === 'PAID' || !e.status);
    e.status = goingToPaid ? 'PAID' : 'PENDING';
    if (goingToPaid) {
      e.exchangeRateAtTime = Number(S.state.exchangeRate) || 1200;
      e.exchangeRateSource = S.state.exchangeRateSource || 'manual';
      e.paidAt = new Date().toISOString();
    } else {
      e.exchangeRateAtTime = null;
      e.paidAt = null;
    }
  }
  save(); render();
}

// ---- Income / Expense modals ----
export function openIncomeModal(id) {
  const i = id ? S.state.incomes.find(x => x.id === id) : { id: null, concept: '', amount: '', currency: S.state.defaultCurrency || 'ARS', date: todayISO(), projectId: '', status: 'CONFIRMED' };
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
              ${S.state.projects.map(p => `<option value="${p.id}" ${i.projectId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
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

export function saveIncome(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  data.amount = Number(data.amount);
  if (data.id) {
    const existing = S.state.incomes.find(x => x.id === data.id);
    const wasConfirmed = (existing.status || 'CONFIRMED') === 'CONFIRMED';
    const willBeConfirmed = (data.status || 'CONFIRMED') === 'CONFIRMED';
    if (willBeConfirmed && !wasConfirmed) {
      data.exchangeRateAtTime = Number(S.state.exchangeRate) || 1200;
      data.exchangeRateSource = S.state.exchangeRateSource || 'manual';
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
      data.exchangeRateAtTime = Number(S.state.exchangeRate) || 1200;
      data.exchangeRateSource = S.state.exchangeRateSource || 'manual';
      data.confirmedAt = new Date().toISOString();
    }
    S.state.incomes.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}

export function deleteIncome(id) {
  if (!confirm('¿Eliminar ingreso?')) return;
  S.state.incomes = S.state.incomes.filter(x => x.id !== id);
  save(); closeModal(); render();
}

export function openExpenseModal(id) {
  const ex = id ? S.state.expenses.find(x => x.id === id) : { id: null, concept: '', amount: '', currency: S.state.defaultCurrency || 'ARS', date: todayISO(), category: 'VARIABLE', projectId: '', status: 'PAID', recurring: true, recurringEndDate: '' };
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
              ${S.state.projects.map(p => `<option value="${p.id}" ${ex.projectId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
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

export function toggleRecurringFields(category) {
  const box = document.getElementById('recurringBox');
  if (!box) return;
  if (category === 'FIXED') box.classList.remove('hidden');
  else box.classList.add('hidden');
}

export function saveExpense(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  data.amount = Number(data.amount);
  // El checkbox sólo entra a FormData si está checked; si no está, queda undefined
  data.recurring = data.category === 'FIXED' ? (data.recurring === 'on') : false;
  data.recurringEndDate = data.recurringEndDate || null;
  if (data.id) {
    const existing = S.state.expenses.find(x => x.id === data.id);
    const wasPaid = (existing.status || 'PAID') === 'PAID';
    const willBePaid = (data.status || 'PAID') === 'PAID';
    if (willBePaid && !wasPaid) {
      data.exchangeRateAtTime = Number(S.state.exchangeRate) || 1200;
      data.exchangeRateSource = S.state.exchangeRateSource || 'manual';
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
      data.exchangeRateAtTime = Number(S.state.exchangeRate) || 1200;
      data.exchangeRateSource = S.state.exchangeRateSource || 'manual';
      data.paidAt = new Date().toISOString();
    }
    S.state.expenses.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}

export function deleteExpense(id) {
  const e = S.state.expenses.find(x => x.id === id);
  const paymentsCount = e ? (S.state.recurringExpensePayments || []).filter(r => r.expenseId === id).length : 0;
  const detail = paymentsCount > 0
    ? `\n\nTambién se borrarán los ${paymentsCount} pago${paymentsCount>1?'s':''} recurrente${paymentsCount>1?'s':''} registrado${paymentsCount>1?'s':''}.`
    : '';
  if (!confirm(`¿Eliminar gasto?${detail}`)) return;
  S.state.expenses = S.state.expenses.filter(x => x.id !== id);
  S.state.recurringExpensePayments = (S.state.recurringExpensePayments || []).filter(r => r.expenseId !== id);
  save(); closeModal(); render();
}
