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
  invoiceEmailSubject: 'Factura {code} · Pragma Studio',
  invoiceEmailTemplate: 'Hola {clientName},\n\nTe adjuntamos la factura {code} correspondiente a {projectName}.\n\nMonto: {amount}\nCAE: {cae}\nFecha: {date}\n\n¡Gracias!\nPragma Studio',
  defaultCurrency: 'ARS',
  exchangeRate: 1200,             // ARS por USD
  exchangeRateSource: 'manual',   // 'manual' | 'blue' | 'oficial' | 'mep' | 'cripto' | 'tarjeta'
  exchangeRateUpdatedAt: null,
  budgets: [],                    // Presupuestos: { id, code, clientName, category, pricingModel, currency, status, items, riskFactors, contingencyPct, ... }
  invoices: [],                   // Facturas AFIP: { id, incomeId, projectId, cae, number, ptoVta, cbteTipo, typeName, date, amount, currency, clientName, clientDocType, clientDocNumber, condicionIVAReceptorId, issuedAt, issuedBy }
  clients: [],                    // Clientes (datos fiscales): { id, name, docType, docNumber, condicionIVA, email, notes }
};

const INCOME_STATUS = {
  PENDING:   { label: 'Pendiente',  color: 'bg-amber-100 text-amber-800' },
  CHARGED:   { label: 'Cobrado',    color: 'bg-green-100 text-green-700' },
  CONFIRMED: { label: 'Confirmado', color: 'bg-green-100 text-green-700' },
};
const EXPENSE_STATUS = {
  PENDING: { label: 'Pendiente', color: 'bg-amber-100 text-amber-800' },
  PAID:    { label: 'Pagado',    color: 'bg-gray-100 text-gray-700' },
};

const DOC_CATEGORIES = ['Contrato', 'Propuesta', 'Brief', 'Plantilla', 'Legal', 'Guía interna', 'Otro'];
const RES_CATEGORIES = ['Diseño', 'Desarrollo', 'IA', 'Marketing', 'Productividad', 'Finanzas', 'Otro'];

// Identidad local (no se sincroniza — cada dispositivo/persona tiene la suya)
let currentMemberId = localStorage.getItem('pragma_current_member') || 'me';

