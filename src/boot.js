import { exportData, importData } from './core/persistence.js';
import { currentMember, getMember, getTask } from './core/selectors.js';
import { DEFAULT_STATE, S } from './core/state.js';
import { closeModal, closeSidebar, go, render, renderNav, showToast, toggleSidebar } from './core/ui.js';
import { addBudgetItem, addSuggestedModule, autoFillHours, deleteBudget, generateBudgetPdf, openBudgetModal, removeBudgetItem, saveBudget, updateBudgetLivePreview, updateBudgetSuggestions, updatePricingDescription } from './modules/budgets_ui.js';
import { openProjectProfileModal, saveProjectProfile } from './modules/clients.js';
import { copyPaymentMsg, deleteExpense, deleteIncome, navYear, openExchangeRateModal, openExpenseModal, openFinanceBreakdown, openIncomeModal, openPaymentsModal, openRangePickerInline, removePayment, renderPaymentsModal, resetPaymentMsg, saveExpense, saveIncome, saveManualRate, selectFinanceMonth, sendPaymentNow, sendPaymentReminder, setBaseCurrency, setFinanceMode, setPaymentAmount, submitPayment, toggleRecurringFields, updatePaymentConversionPreview } from './modules/finance.js';
import { backToEditInvoice, confirmEmitInvoice, deleteClient, deleteRecurringExpenseFull, openClientModal, openInvoiceListModal, openInvoiceModal, openInvoicePdf, previewInvoice, saveClient, updateInvoiceDocPlaceholder } from './modules/invoices.js';
import { markAllRead, openNotification, toggleNotifications } from './modules/notifications.js';
import { copyPromptText, deleteProject, dragColLeave, dragColOver, dragProjectEnd, dragProjectStart, dropProject, openProjectDetail, openProjectModal, openPromptModal, saveProject } from './modules/projects.js';
import { addComment, deleteTask, openTaskDetail, openTaskModal, quickStatus, saveTask } from './modules/tasks.js';
import { deleteMember, insertTemplateVar, openMemberModal, openMemberPicker, saveEmailConfig, saveFinanceSettings, saveMember, updateTemplatePreview } from './modules/team.js';
import { handleLogin, logout, renderLoginOverlay } from './services/auth.js';
import { getSupabaseConfig, initSupabase, reconfigureCloud, save, saveSupabaseConfig, setSyncStatus, skipSetup } from './services/cloud.js';
import { initEmail, testEmail } from './services/email.js';
import { autoFetchBlueIfStale, fetchBluelyticsBlue, fetchDollarRate, initExchange } from './services/exchange.js';

document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

// Close panel on outside click
document.addEventListener('click', (e) => {
  const panel = document.getElementById('notifPanel');
  const bell = document.getElementById('bellBtn');
  if (!panel.classList.contains('hidden') && !panel.contains(e.target) && !bell.contains(e.target)) {
    panel.classList.add('hidden');
  }
});

document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!confirm('Esto reemplaza todos los datos actuales. ¿Continuar?')) return;
      S.state = { ...structuredClone(DEFAULT_STATE), ...imported };
      save(); render();
    } catch {
      alert('Archivo inválido.');
    }
  };
  reader.readAsText(file);
});

// ============ KEYBOARD ============
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); openTaskModal(); }
  if (e.key === 'Escape') closeModal();
});

// ============ BOOT ============
// Inyectar dependencias en los servicios (capa services/) antes de usarlos.
initExchange({ getState: () => S.state, save, render, showToast });

initEmail({ getState: () => S.state, getMember, getTask, currentMember, showToast });

// Mostrar overlay de login por defecto hasta que Supabase confirme sesión
renderLoginOverlay();

renderNav();

render();

// Migración: si todavía tenés la plantilla vieja redundante, pasala a la nueva
(function migratePaymentTemplate() {
  const OLD = 'Hola {name}! 👋\n\nTe paso el recordatorio del pago mensual del proyecto *{project}* correspondiente a {month}.\n\nMonto: {amount} (≈ {amountARS} al cambio de hoy, cotización USD {rate})\n\n¡Gracias!\nPragma Studio';
  const NEW = 'Hola {name}! 👋\n\nTe paso el recordatorio del pago mensual del proyecto *{project}* correspondiente a {month}.\n\nMonto: {amount}\n\n¡Gracias!\nPragma Studio';
  if (S.state.paymentMessageTemplate === OLD) {
    S.state.paymentMessageTemplate = NEW;
    save();
  }
})();

// Show pending notifications toast on app load + auto-refresh blue dollar
setTimeout(() => {
  const unread = (S.state.notifications || []).filter(n => n.forMemberId === S.currentMemberId && !n.read);
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
  ['financeMode',        () => S.financeMode,        (v) => (S.financeMode = v)],
  ['financeMonth',       () => S.financeMonth,       (v) => (S.financeMonth = v)],
  ['financeFrom',        () => S.financeFrom,        (v) => (S.financeFrom = v)],
  ['financeTo',          () => S.financeTo,          (v) => (S.financeTo = v)],
  ['promptStyle',        () => S.promptStyle,        (v) => (S.promptStyle = v)],
  ['tasksViewMode',      () => S.tasksViewMode,      (v) => (S.tasksViewMode = v)],
  ['tasksFilter',        () => S.tasksFilter,        (v) => (S.tasksFilter = v)],
  ['projectsViewMode',   () => S.projectsViewMode,   (v) => (S.projectsViewMode = v)],
  ['projectsListStatus', () => S.projectsListStatus, (v) => (S.projectsListStatus = v)],
  ['projectsTypeFilter', () => S.projectsTypeFilter, (v) => (S.projectsTypeFilter = v)],
  ['budgetsFilterStatus',() => S.budgetsFilterStatus,(v) => (S.budgetsFilterStatus = v)],
].forEach(([k, get, set]) => Object.defineProperty(window, k, { get, set, configurable: true }));
