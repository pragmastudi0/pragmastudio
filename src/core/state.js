// ============ STATE ============
export const DEFAULT_STATE = {
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

export function load() {
  try {
    const raw = localStorage.getItem('pragma_state');
    if (!raw) return structuredClone(DEFAULT_STATE);
    return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
  } catch { return structuredClone(DEFAULT_STATE); }
}

export const CLIENT_ID = (() => {
  let id = localStorage.getItem('pragma_client_id');
  if (!id) { id = Math.random().toString(36).slice(2); localStorage.setItem('pragma_client_id', id); }
  return id;
})();

// ===== Runtime compartido (estado mutable del monolito) =====
export const S = {
  state: load(),
  currentView: 'tasks',
  currentTaskId: null,
  currentMemberId: localStorage.getItem('pragma_current_member') || 'me',
  _currentAuthUser: null,
  // Tenencia SaaS (Fase 1): organización activa y membresías del usuario.
  activeOrgId: null,
  memberships: [],
  activeMembership: null,
  sb: null,
  sbChannel: null,
  cloudReady: false,
  saveTimer: null,
  _draggingProjectId: null,
  tasksViewMode: 'kanban',
  tasksFilter: { projectId: '', status: '' },
  projectsViewMode: 'kanban',
  projectsListStatus: '',
  projectsTypeFilter: '',
  promptStyle: 'organize',
  docsFilter: '',
  resourcesFilter: '',
  budgetsFilterStatus: '',
  _budgetItemCounter: 0,
  financeMode: 'month',
  financeMonth: new Date().toISOString().slice(0,7),
  financeYear: String(new Date().getFullYear()),
  financeFrom: new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString().slice(0,10),
  financeTo: new Date().toISOString().slice(0,10),
  _currentPaymentsItem: null,
  _currentInvoiceItem: null,
  _currentInvoiceForm: null,
  _currentPaymentIncome: null,
};
