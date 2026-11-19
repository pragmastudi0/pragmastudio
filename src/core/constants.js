// ============ CONSTANTES (enums / display) ============
// Constantes genéricas, cross-cutting, sin estado — extraídas verbatim de index.html.
// Las constantes de dominio (DOLAR_SOURCES, MEMBER_ROLES, PAYMENT_VARS, las del cotizador)
// viven junto a su módulo, no acá.

// --- Tareas ---
export const STATUS = {
  PENDING:     { label: 'Pendiente',   color: 'bg-gray-200 text-gray-700' },
  IN_PROGRESS: { label: 'En progreso', color: 'bg-blue-100 text-blue-700' },
  IN_REVIEW:   { label: 'En revisión', color: 'bg-amber-100 text-amber-800' },
  COMPLETED:   { label: 'Completada',  color: 'bg-green-100 text-green-700' },
  BLOCKED:     { label: 'Bloqueada',   color: 'bg-red-100 text-red-700' },
};
export const STATUS_ORDER = ['PENDING','IN_PROGRESS','IN_REVIEW','BLOCKED','COMPLETED'];
export const PRIORITY = {
  LOW:    { label: 'Baja',   color: 'bg-gray-100 text-gray-600' },
  MEDIUM: { label: 'Media',  color: 'bg-blue-50 text-blue-700' },
  HIGH:   { label: 'Alta',   color: 'bg-orange-100 text-orange-700' },
  URGENT: { label: 'Urgente',color: 'bg-red-100 text-red-700' },
};

// --- Finanzas: estados de ingreso/gasto y categorías de gasto ---
export const INCOME_STATUS = {
  PENDING:   { label: 'Pendiente',  color: 'bg-amber-100 text-amber-800' },
  CHARGED:   { label: 'Cobrado',    color: 'bg-green-100 text-green-700' },
  CONFIRMED: { label: 'Confirmado', color: 'bg-green-100 text-green-700' },
};
export const EXPENSE_STATUS = {
  PENDING: { label: 'Pendiente', color: 'bg-amber-100 text-amber-800' },
  PAID:    { label: 'Pagado',    color: 'bg-gray-100 text-gray-700' },
};
export const EXPENSE_CAT = {
  FIXED:      'Fijo',
  VARIABLE:   'Variable',
  INVESTMENT: 'Inversión',
};

// --- Proyectos ---
export const PROJECT_STATUS = {
  LEAD:             { label: 'Lead',              color: 'bg-gray-100 text-gray-700' },
  POSSIBLE:         { label: 'Posible',           color: 'bg-blue-50 text-blue-700' },
  IN_DEVELOPMENT:   { label: 'En desarrollo',     color: 'bg-amber-100 text-amber-800' },
  ACTIVE_RECURRING: { label: 'Activo mensualidad',color: 'bg-green-100 text-green-700' },
  PAUSED:           { label: 'Pausado',           color: 'bg-yellow-100 text-yellow-700' },
  DONE:             { label: 'Terminado',         color: 'bg-purple-100 text-purple-700' },
  ARCHIVED:         { label: 'Archivado',         color: 'bg-gray-50 text-gray-500' },
};
export const PROJECT_STATUS_ORDER = ['LEAD','POSSIBLE','IN_DEVELOPMENT','ACTIVE_RECURRING','PAUSED','DONE','ARCHIVED'];
export const PROJECT_TYPE = {
  SYSTEM: { label: 'Sistema', hint: 'Mensualidad' },
  WEB:    { label: 'Web',     hint: 'Inicio/fin' },
  OTHER:  { label: 'Otro',    hint: 'Cualquier otro' },
};
export const PROJECT_TYPE_ORDER = ['SYSTEM','WEB','OTHER'];
// Paleta de colores standard para proyectos (8 colores)
export const PROJECT_COLORS = [
  { value: '#6b7280', name: 'Gris' },
  { value: '#3b82f6', name: 'Azul' },
  { value: '#8b5cf6', name: 'Violeta' },
  { value: '#ec4899', name: 'Rosa' },
  { value: '#10b981', name: 'Verde' },
  { value: '#f59e0b', name: 'Ámbar' },
  { value: '#f97316', name: 'Naranja' },
  { value: '#ef4444', name: 'Rojo' },
];
export const DEFAULT_PROJECT_COLOR = '#6b7280';

// --- Documentos / Recursos ---
export const DOC_CATEGORIES = ['Contrato', 'Propuesta', 'Brief', 'Plantilla', 'Legal', 'Guía interna', 'Otro'];
export const RES_CATEGORIES = ['Diseño', 'Desarrollo', 'IA', 'Marketing', 'Productividad', 'Finanzas', 'Otro'];

// --- Navegación (orden de vistas en el sidebar) ---
export const NAV = [
  { key: 'tasks',     label: 'Tareas',      icon: '☰' },
  { key: 'projects',  label: 'Proyectos',   icon: '◫' },
  { key: 'clients',   label: 'Clientes',    icon: '⊙' },
  { key: 'budgets',   label: 'Presupuestos',icon: '$' },
  { key: 'finance',   label: 'Finanzas',    icon: '◷' },
  { key: 'reports',   label: 'Reportes',    icon: '◈' },
  { key: 'documents', label: 'Documentos', icon: '▤' },
  { key: 'resources', label: 'Recursos',   icon: '◇' },
  { key: 'team',      label: 'Equipo',     icon: '◐' },
  { key: 'guide',     label: 'Manual',     icon: '?' },
];

// --- Meses ---
export const MONTH_NAMES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
export const MONTH_NAMES_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// --- Datos fiscales (clientes / facturación) ---
export const CLIENT_DOC_TYPES = [
  { v: '99', label: 'Consumidor Final' },
  { v: '80', label: 'CUIT' },
  { v: '86', label: 'CUIL' },
  { v: '96', label: 'DNI' },
];
export const DOC_TYPE_LABELS = CLIENT_DOC_TYPES.reduce((m, d) => (m[d.v] = d.label, m), {});
// Condición frente al IVA (informativa; el backend actual no la envía a AFIP).
export const CONDICION_IVA = ['Responsable Inscripto', 'Monotributo', 'Exento', 'Consumidor Final'];
