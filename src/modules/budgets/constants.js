// ============ PRESUPUESTOS — Constantes ============
// Datos puros del cotizador. Extraídos verbatim de index.html (refactor modular).
// Reglas de negocio comerciales reales: no alterar rates/márgenes/porcentajes sin
// pedido explícito (ver AGENTS.md §10.6).

export const BUDGET_STATUS = {
  DRAFT:    { label: 'Borrador',  color: 'bg-gray-100 text-gray-700' },
  SENT:     { label: 'Enviado',   color: 'bg-blue-100 text-blue-700' },
  ACCEPTED: { label: 'Aceptado',  color: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Rechazado', color: 'bg-red-100 text-red-700' },
  EXPIRED:  { label: 'Vencido',   color: 'bg-amber-100 text-amber-700' },
};
export const BUDGET_STATUS_ORDER = ['DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED'];

export const BUDGET_CATEGORIES = [
  { key: 'ERP',         label: 'Implementación ERP',      defaultPricing: 'IMPL_PLUS_MAINT' },
  { key: 'CRM',         label: 'CRM',                      defaultPricing: 'IMPL_PLUS_MAINT' },
  { key: 'ECOMMERCE',   label: 'Ecommerce',                defaultPricing: 'IMPL_PLUS_MAINT' },
  { key: 'AUTOMATION',  label: 'Automatizaciones',         defaultPricing: 'FIXED' },
  { key: 'INTEGRATION', label: 'Integraciones',            defaultPricing: 'FIXED' },
  { key: 'AI',          label: 'Inteligencia Artificial',  defaultPricing: 'EVOLUTIVE' },
  { key: 'WEB',         label: 'Desarrollo Web',           defaultPricing: 'FIXED' },
  { key: 'MOBILE',      label: 'Desarrollo Mobile',        defaultPricing: 'FIXED' },
  { key: 'CUSTOM',      label: 'Desarrollo a Medida',      defaultPricing: 'EVOLUTIVE' },
  { key: 'CONSULTING',  label: 'Consultoría',              defaultPricing: 'HOUR_BUCKET' },
];

export const PRICING_MODELS = [
  { key: 'FIXED',          label: 'Precio fijo',                       minMargin: 40, targetMargin: 52,
    description: 'Cobrás un monto cerrado al firmar. El cliente sabe exactamente cuánto va a pagar. Ideal cuando el alcance está claro y acotado.' },
  { key: 'HOUR_BUCKET',    label: 'Bolsa de horas / T&M',              minMargin: 45, targetMargin: 55,
    description: 'Cliente compra un paquete de horas y se consumen. Para soporte continuo o cuando el alcance va a cambiar.' },
  { key: 'SUBSCRIPTION',   label: 'Suscripción mensual',               minMargin: 55, targetMargin: 70,
    description: 'Solo cobrás mensual recurrente, sin desarrollo inicial. Para SaaS o cuando todo es uso continuo del producto.' },
  { key: 'IMPL_PLUS_MAINT',label: 'Implementación + mantenimiento',    minMargin: 40, targetMargin: 52,
    description: 'Un monto inicial por el desarrollo + mensual por soporte y mejoras. Lo más recomendado para sistemas (ERP/CRM).' },
  { key: 'EVOLUTIVE',      label: 'Desarrollo evolutivo',              minMargin: 45, targetMargin: 55,
    description: 'Cobrás por sprint o iteración sobre un backlog priorizado. Cliente paga por avance. Ideal para productos a largo plazo.' },
];

// Sugerencias de módulos típicos por categoría (clickeables al armar el presupuesto)
export const COMMON_MODULES_BY_CATEGORY = {
  ERP: [
    { title: 'Login y gestión de usuarios',  complexity: 'SIMPLE' },
    { title: 'Dashboard con métricas',        complexity: 'MEDIUM' },
    { title: 'ABM de clientes',               complexity: 'SIMPLE' },
    { title: 'ABM de productos',              complexity: 'SIMPLE' },
    { title: 'Módulo de facturación',         complexity: 'COMPLEX' },
    { title: 'Gestión de stock',              complexity: 'MEDIUM' },
    { title: 'Reportes y exportación',        complexity: 'MEDIUM' },
    { title: 'Integración con AFIP',          complexity: 'COMPLEX' },
  ],
  CRM: [
    { title: 'Login y usuarios',              complexity: 'SIMPLE' },
    { title: 'Pipeline de oportunidades',     complexity: 'MEDIUM' },
    { title: 'Gestión de leads',              complexity: 'SIMPLE' },
    { title: 'Email tracking',                complexity: 'COMPLEX' },
    { title: 'Dashboard de ventas',           complexity: 'MEDIUM' },
    { title: 'Integración con WhatsApp',      complexity: 'COMPLEX' },
  ],
  WEB: [
    { title: 'Landing page principal',        complexity: 'SIMPLE' },
    { title: 'Sección "Quiénes somos"',       complexity: 'VERY_SIMPLE' },
    { title: 'Catálogo de productos/servicios',complexity: 'MEDIUM' },
    { title: 'Formulario de contacto',        complexity: 'VERY_SIMPLE' },
    { title: 'Blog / noticias',               complexity: 'SIMPLE' },
    { title: 'SEO básico + Analytics',        complexity: 'SIMPLE' },
  ],
  ECOMMERCE: [
    { title: 'Catálogo con filtros',          complexity: 'MEDIUM' },
    { title: 'Carrito de compras',            complexity: 'MEDIUM' },
    { title: 'Checkout + pasarela de pagos',  complexity: 'COMPLEX' },
    { title: 'Panel administrativo',          complexity: 'COMPLEX' },
    { title: 'Gestión de envíos',             complexity: 'MEDIUM' },
    { title: 'Sincronización con stock',      complexity: 'MEDIUM' },
  ],
  MOBILE: [
    { title: 'Login con autenticación',       complexity: 'MEDIUM' },
    { title: 'Onboarding del usuario',        complexity: 'SIMPLE' },
    { title: 'Pantallas principales',         complexity: 'MEDIUM' },
    { title: 'Notificaciones push',           complexity: 'COMPLEX' },
    { title: 'Publicación en App/Play Store', complexity: 'SIMPLE' },
  ],
  AUTOMATION: [
    { title: 'Workflow de aprobación',        complexity: 'MEDIUM' },
    { title: 'Integración entre apps',        complexity: 'COMPLEX' },
    { title: 'Notificaciones automáticas',    complexity: 'SIMPLE' },
    { title: 'Reportes automáticos',          complexity: 'MEDIUM' },
  ],
  INTEGRATION: [
    { title: 'Integración con AFIP',          complexity: 'COMPLEX' },
    { title: 'Pasarela de pagos',             complexity: 'COMPLEX' },
    { title: 'WhatsApp Business API',         complexity: 'COMPLEX' },
    { title: 'Google Calendar / Sheets',      complexity: 'MEDIUM' },
  ],
  AI: [
    { title: 'Chatbot inteligente',           complexity: 'COMPLEX' },
    { title: 'Análisis de documentos',        complexity: 'COMPLEX' },
    { title: 'Recomendaciones personalizadas',complexity: 'VERY_COMPLEX' },
    { title: 'Generación de contenido',       complexity: 'MEDIUM' },
  ],
  CUSTOM: [
    { title: 'Relevamiento de requerimientos',complexity: 'MEDIUM' },
    { title: 'Arquitectura del sistema',      complexity: 'COMPLEX' },
    { title: 'Desarrollo del core',           complexity: 'VERY_COMPLEX' },
  ],
  CONSULTING: [
    { title: 'Jornada de consultoría',        complexity: 'SIMPLE' },
    { title: 'Auditoría técnica',             complexity: 'MEDIUM' },
    { title: 'Plan de mejora',                complexity: 'MEDIUM' },
  ],
};

// Matriz recalibrada para velocidad real con IA (Cursor + Claude + Supabase + Vercel)
export const COMPLEXITY_LEVELS = [
  { key: 'VERY_SIMPLE',  label: 'Muy simple',   min: 0.5, max: 1,  default: 1,  devSenior: false },
  { key: 'SIMPLE',       label: 'Simple',       min: 1,   max: 3,  default: 2,  devSenior: false },
  { key: 'MEDIUM',       label: 'Media',        min: 3,   max: 8,  default: 5,  devSenior: false },
  { key: 'COMPLEX',      label: 'Compleja',     min: 8,   max: 20, default: 12, devSenior: true  },
  { key: 'VERY_COMPLEX', label: 'Muy compleja', min: 20,  max: 50, default: 30, devSenior: true  },
];

export const RISK_FACTORS_LIST = [
  { id: 'INTEGRATION', label: 'Integración con terceros',           min: 0.15, max: 0.30, def: 0.20 },
  { id: 'UNKNOWN_API', label: 'API desconocida / sin documentación',min: 0.20, max: 0.40, def: 0.30 },
  { id: 'LEGACY',      label: 'Sistema legacy',                     min: 0.25, max: 0.50, def: 0.35 },
  { id: 'URGENT',      label: 'Plazo urgente',                      min: 0.20, max: 0.40, def: 0.30 },
  { id: 'UNCLEAR_REQ', label: 'Requerimientos poco definidos',      min: 0.20, max: 0.50, def: 0.30 },
  { id: 'CLIENT_DEP',  label: 'Dependencia del cliente',            min: 0.10, max: 0.25, def: 0.15 },
  { id: 'DATA_MIG',    label: 'Migración de datos',                 min: 0.15, max: 0.35, def: 0.25 },
  { id: 'AI',          label: 'Inteligencia Artificial',            min: 0.30, max: 0.60, def: 0.45 },
];

// Rates re-calibradas: costo muy bajo (tu tiempo + IA tools), sale moderado.
// Margen objetivo 85%+ porque la productividad con IA lo permite.
export const ROLE_RATES = {
  FUNCTIONAL: { cost: 3,  sale: 30 },
  UX:         { cost: 3,  sale: 30 },
  DEV_JR:     { cost: 2,  sale: 22 },
  DEV_SSR:    { cost: 4,  sale: 38 },
  DEV_SR:     { cost: 8,  sale: 55 },
  QA:         { cost: 2,  sale: 24 },
  PM:         { cost: 6,  sale: 45 },
  AI:         { cost: 12, sale: 70 },
};

export const DISCIPLINE_PCT = {
  functional: 0.25,
  ux:         0.15,
  qa:         0.20,
  training:   0.07,
  docs:       0.07,
  pm:         0.15,
};
