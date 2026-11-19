# AGENTS.md — Guía para agentes de IA · Pragma Studio

> Documento de contexto e instrucciones permanentes para agentes de IA (Claude Code, Codex u otros)
> que trabajen sobre este repositorio. Describe cómo funciona el sistema **realmente**, sus reglas de
> negocio, sus convenciones y las precauciones obligatorias antes de modificar código.
>
> **Este archivo se basa en evidencia del código.** Donde algo no pudo verificarse se indica
> explícitamente como *hipótesis* o *sin verificar*. No inventes reglas de negocio: si no está en el
> código ni en este documento, verificalo antes de afirmarlo.
>
> Última auditoría: 2026-11-19 · Rama de la auditoría: `agentes-ia`
>
> **Refactor de arquitectura en curso** (rama `refactor/modularizar-frontend`): el frontend se está
> modularizando con **Vite + ES Modules**. La lógica dejó de estar en `index.html` y vive bajo `src/`
> (hoy mayormente en `src/legacy/app.js`, migrándose por módulos). Las **reglas de negocio no cambian**.
> Detalle en [`docs/architecture/`](docs/architecture/README.md). Las referencias de arquitectura de
> abajo (§2, §3, §8, §12) ya reflejan la nueva estructura.

---

## 1. Propósito del sistema

**Pragma Studio** es una aplicación interna de gestión para un estudio de software argentino
(Monotributo). Es una herramienta de uso propio del equipo (3 personas), no un producto multi-cliente.
Cubre, en una sola interfaz:

- **Gestión de proyectos y tareas** (Kanban, Gantt, lista) para el trabajo del estudio.
- **Finanzas**: ingresos, gastos, mensualidades recurrentes, pagos parciales, flujo de caja y
  conversión ARS/USD.
- **Presupuestos** (cotizador): motor de estimación de horas/costo/precio/margen por disciplina.
- **Clientes**: datos fiscales para facturación.
- **Facturación electrónica AFIP** (Factura C de Monotributo) vía funciones serverless.
- **Documentos y recursos**: enlaces organizados por categoría.
- **Equipo, notificaciones y un generador de prompts** para asistentes de IA.

Objetivo: centralizar la operación diaria del estudio (qué hacer hoy, cuánto se cobra/paga, qué se
presupuesta y qué se factura) en una herramienta rápida y sin fricción.

---

## 2. Arquitectura

### Stack (verificado)

| Capa | Tecnología | Dónde |
|------|-----------|-------|
| Frontend | **Vanilla JS + Vite + ES Modules** (sin framework, sin TypeScript) | `src/` (entrada `src/main.js`) |
| Estilos | **Tailwind CSS vía CDN** (`cdn.tailwindcss.com`) + CSS propio | `index.html` + `src/styles/base.css` |
| Backend | **Funciones serverless de Vercel** (Node.js 20.x, CommonJS) | `api/afip/*.js` |
| Base de datos / sync | **Supabase** (Postgres + Auth + Realtime) vía CDN `@supabase/supabase-js@2` | `src/legacy/app.js` |
| Email | **EmailJS** vía CDN `@emailjs/browser@4` (client-side) | `src/legacy/app.js` |
| Facturación | **`@afipsdk/afip.js`** (dep de runtime del backend) | `api/afip/`, `lib/afip-helpers.js` |
| Hosting | **Vercel** (build Vite + serverless; `vercel.json`) | — |

`package.json` declara `@afipsdk/afip.js` (backend) y, como devDeps, **Vite** y **Vitest**; scripts
`dev`, `build`, `preview`, `test`. El frontend se compila con Vite a `dist/`. Hay tests de
caracterización en `tests/` (funciones puras); aún no hay linter ni typecheck. Tailwind, Supabase y
EmailJS siguen cargándose por **CDN** desde `index.html` (decisión: riesgo visual cero, sin deps extra).

### Flujo de información

1. El navegador carga `index.html`, que importa `src/main.js` (módulo ES). El estado vive en un objeto
   `state` (hoy en `src/legacy/app.js`; expuesto a los handlers inline vía un `window-bridge`).
2. `state` se persiste en **dos lugares**: `localStorage['pragma_state']` (espejo local) y una **única
   fila** de Supabase (`pragma_state`, `id='main'`, columna `data jsonb`).
3. Los cambios se guardan con `save()` (debounce 500 ms) como **upsert del documento completo**.
4. **Realtime**: `subscribeRealtime()` escucha cambios en esa fila y re-hidrata `state` en todos los
   dispositivos; se evita el eco con `writer`/`CLIENT_ID`.
5. Para facturar, el cliente llama a `/api/afip/*` (serverless), que verifica el JWT de Supabase y habla
   con AFIP. El resultado (CAE) se guarda dentro de `state.invoices`.

### Dependencias entre componentes

- Frontend ↔ Supabase: directo desde el navegador con la **anon key** (persistencia + auth + realtime).
- Frontend → Serverless (`/api/afip`): sólo para facturación; autenticado con el access token de Supabase.
- Serverless → Supabase Auth REST: para validar el token (ver §6).
- Serverless → AFIP: vía `@afipsdk/afip.js` con cert/key en env vars.
- Frontend → APIs externas de cotización (`bluelytics`, `dolarapi`) y QR (`api.qrserver.com`).

---

## 3. Mapa del repositorio

```
/
├── index.html          # Shell: <head> (CDN + metas) + contenedores + <script type=module src=/src/main.js>.
├── pragma.html         # Variante local-only (sin Supabase/login). Ver §15 (legacy, no referenciada).
├── favicon.png         # Ícono / logo.
├── package.json        # Backend: @afipsdk/afip.js. devDeps: vite, vitest. Node 20.x. Scripts dev/build/preview/test.
├── vite.config.mjs     # Config de Vite (build → dist/).
├── vercel.json         # Build Vite + api/ serverless + fallback SPA.
├── .gitignore          # Ignora node_modules, dist, .env*, y cert/key AFIP (*.crt/*.key/*.pem/*.csr).
├── src/
│   ├── main.js         # Punto de entrada (importa estilos + app).
│   ├── styles/base.css # CSS extraído del <style> inline.
│   ├── legacy/app.js   # ★ Grueso de la lógica (monolito reubicado) + window-bridge. Se migra por módulos.
│   └── modules/budgets/{constants,engine}.js  # Cotizador ya modularizado (puro, testeado).
├── tests/              # Vitest — caracterización de funciones puras (budgets).
├── docs/architecture/  # Documentación del refactor (README, inventory, modules, decisions, migration).
├── api/afip/           # emitir.js (POST CAE) · estado.js (healthcheck) · ultimo.js (último nº).
└── lib/afip-helpers.js # verifyAuth() (valida JWT Supabase) + getAfipClient() (cert/key desde env).
```

**El grueso de la lógica está en `src/legacy/app.js`** (monolito reubicado, migrándose por módulos).
Está organizado por secciones marcadas con `// ============ NOMBRE ============`. Para ubicarte, buscá
esos encabezados: `STATE`, `LOGIN`, `CLOUD SYNC`, `CONSTANTS`, `PRESUPUESTOS` (motor ya en
`src/modules/budgets/`), `HELPERS`, `NAV`, `RENDER DISPATCH`, `HOME`, `TASKS`, `GANTT`, `PROJECTS`,
`PROMPT GENERATOR`, `DOCUMENTS & RESOURCES`, `TEAM`, `FINANCE`, `PARTIAL PAYMENTS`, bloque de
**facturación AFIP**, `REPORTS`, `GUIDE`, `MODALS`, `NOTIFICATIONS PANEL`, `EXPORT / IMPORT`, `UTILS`,
`KEYBOARD`, `BOOT`, y al final el `WINDOW BRIDGE`. Ver [`docs/architecture/`](docs/architecture/README.md).

---

## 4. Módulos funcionales

Las vistas se despachan en `render()` (`src/legacy/app.js`) según `currentView`. La navegación la define el
array `NAV`. Vistas: **Tareas, Proyectos, Clientes, Presupuestos, Finanzas, Reportes, Documentos,
Recursos, Equipo, Manual (guía)**.

### 4.1 Tareas (`renderTasks`, `renderKanban`, `renderGantt`, `taskRow`)
- Entidades: `state.tasks` `{ id, title, description, status, priority, projectId, assigneeId, dueDate, estimatedHrs, blockedReason, ... }`.
- Estados (`STATUS` / `STATUS_ORDER`): `PENDING → IN_PROGRESS → IN_REVIEW → BLOCKED → COMPLETED`.
  Prioridades (`PRIORITY`): `LOW/MEDIUM/HIGH/URGENT`.
- Vistas Kanban, lista y Gantt. Cambiar estado genera entradas en `state.history` y puede generar
  notificaciones (menciones en comentarios).
- Comentarios (`state.comments`) soportan **menciones** `@miembro` que crean `state.notifications`.

### 4.2 Proyectos (`renderProjects`, `renderProjectsKanban`, `saveProject`)
- `state.projects` `{ id, name, status, projectTypes[], monthlyFee, monthlyFeeCurrency, startDate, endDate, color, systemUrl, clientId?, ... }`.
- Estados (`PROJECT_STATUS` / `PROJECT_STATUS_ORDER`): `LEAD, POSSIBLE, IN_DEVELOPMENT,
  **ACTIVE_RECURRING**, PAUSED, DONE, ARCHIVED`.
- Tipos (`PROJECT_TYPE`): `SYSTEM` (mensualidad), `WEB` (inicio/fin), `OTHER`. Helper legacy-safe:
  `getProjectTypes()` (soporta `projectType` string viejo y `projectTypes[]` nuevo).
- **Regla crítica**: un proyecto `ACTIVE_RECURRING` con `monthlyFee` **genera ingresos virtuales
  mensuales** automáticamente en Finanzas (ver §4.5 / §10).

### 4.3 Clientes (`renderClients`, `saveClient`, modal de perfil fiscal)
- `state.clients` `{ id, name, docType, docNumber, condicionIVA, notes }`. Datos fiscales para precargar
  la emisión de facturas. Un proyecto puede vincularse a un cliente.

### 4.4 Presupuestos / Cotizador (`renderBudgets`, `estimateBudget`, `saveBudget`)
- `state.budgets` `{ id, code, clientName, categories[], pricingModel, currency, status, items[], riskFactors[], contingencyPct, ... }`.
- Estados (`BUDGET_STATUS`): `DRAFT, SENT, ACCEPTED, REJECTED, EXPIRED`.
- **Motor de estimación `estimateBudget(budget)`** (lógica de negocio central, ver §10):
  - Cada ítem tiene una **complejidad** (`COMPLEXITY_LEVELS`: `VERY_SIMPLE`…`VERY_COMPLEX`) que fija
    horas de desarrollo por defecto.
  - Sobre las horas de dev se derivan horas de otras disciplinas con `DISCIPLINE_PCT`
    (functional 25%, ux 15%, qa 20%, training 7%, docs 7%, pm 15%).
  - Costo y venta se calculan con `ROLE_RATES` (USD/hora por rol). Proyectos de categoría `AI` usan el
    rate `AI`; ítems `devSenior` usan `DEV_SR`, el resto `DEV_SSR`.
  - Se aplican **factores de riesgo** (`RISK_FACTORS_LIST`, sumados y topeados a 1.0) y una
    **contingencia** (`contingencyPct`, default 12%): `multiplier = (1 + riskSum) * (1 + contingency)`.
  - Se calcula **margen** y se clasifica (`green/yellow/red`) contra `minMargin`/`targetMargin` del
    modelo de pricing (`PRICING_MODELS`).
- Categorías (`BUDGET_CATEGORIES`) traen `defaultPricing` y módulos sugeridos
  (`COMMON_MODULES_BY_CATEGORY`).

### 4.5 Finanzas (`renderFinance`, sección `// FINANCE` y `// PARTIAL PAYMENTS`)
Es el módulo **más complejo y sensible** (ver §10 y §11). Entidades en `state`:
`incomes, expenses, recurringChargeLog, recurringExpensePayments, incomePayments, expensePayments`.

- **Modos de vista**: `month` / `year` / `range` (`financeMode`).
- **Ingresos/gastos virtuales (auto)**:
  - `getAutoIncomes(month)`: por cada proyecto `ACTIVE_RECURRING` con `monthlyFee` genera un ingreso
    virtual `id='auto-<projId>-<month>'`. No existe como fila real hasta que se "cobra".
  - `getAutoExpenses(month)`: por cada gasto `FIXED` con `recurring !== false`, genera gastos virtuales
    en los meses **posteriores** al original, hasta `recurringEndDate`.
- **Cobros/pagos de recurrentes**: `toggleMonthCharged()` / `toggleExpenseMonthPaid()` crean registros
  en `recurringChargeLog` / `recurringExpensePayments`, guardando **la cotización USD del momento**.
- **Pagos parciales** (`getPaymentSummary`, `addPaymentToItem`): un ingreso/gasto puede pagarse en
  varias cuotas. Estado derivado: `PENDING / PARTIAL / PAID`.
- **Arrastres (carry-over)** (`getCarryOversForMonth`): los ingresos con saldo **PARCIAL** de meses
  anteriores se "arrastran" y muestran en meses siguientes hasta cobrarse al 100%. **Sólo en vista
  Mes** (en Año/Rango no, para no duplicar).
- **Flujo de caja** (`getAllCashFlowPayments`): lista pagos reales por su **fecha real de pago**
  (no la fecha del ítem), con back-compat sintético para datos viejos sin payment log.

### 4.6 Facturación AFIP (frontend: bloque ~3751–4760; backend: `api/afip/`)
- Emite **Factura C** (`CbteTipo = 11`, Monotributo) para un ítem de ingreso.
- Flujo: `openInvoiceModal` → `confirmEmitInvoice` → `callApi('/api/afip/emitir')` → guarda el
  resultado en `state.invoices` `{ id, incomeId, cae, caeExpiry, number, code, ... , voided }`.
- Genera QR oficial AFIP (`https://www.afip.gob.ar/fe/qr/` + `api.qrserver.com`).
- `voided` marca facturas anuladas (no se re-cuentan). Ver §7.

### 4.7 Otros
- **Documentos / Recursos** (`state.documents`, `state.resources`): enlaces por categoría
  (`DOC_CATEGORIES`, `RES_CATEGORIES`). Modal genérico de link.
- **Equipo** (`renderTeam`): `state.members` `{ id, name, color, email? }`.
- **Reportes** (`renderReports`): métricas agregadas.
- **Generador de prompts** (`generateProjectPrompt`): arma un prompt Markdown del estado del proyecto
  para pegar en un asistente de IA (abre `claude.ai/new`).
- **Notificaciones** (`state.notifications`): por menciones; toasts en realtime.

---

## 5. Modelo de datos

**No hay esquema relacional.** Toda la aplicación guarda un **único documento JSON** en la tabla
`pragma_state` (una sola fila, `id='main'`, columna `data jsonb`). El "modelo" es la forma del objeto
`DEFAULT_STATE` (definido en `index.html`, sección `STATE`).

```
pragma_state (Postgres)
  id         text primary key   -- siempre 'main'
  data       jsonb              -- el objeto `state` completo
  writer     text               -- CLIENT_ID del último que escribió (dedup realtime)
  updated_at timestamptz
```

Colecciones dentro de `state.data` (todas son arrays dentro del JSON, **no tablas**):
`user, members, projects, tasks, incomes, expenses, comments, history, notifications, documents,
resources, recurringChargeLog, recurringExpensePayments, incomePayments, expensePayments, budgets,
invoices, clients`, más escalares de configuración (`defaultCurrency, exchangeRate,
exchangeRateSource, exchangeRateUpdatedAt, emailConfig, paymentMessageTemplate, pragmaPhone`).

**Restricciones / integridad (verificadas):**
- Las relaciones son **por `id` string** dentro del JSON (ej. `task.projectId → project.id`). No hay
  foreign keys ni cascada: **borrar una entidad no limpia sus referencias** automáticamente.
- IDs generados con `uid()` (random). Los ingresos/gastos virtuales usan IDs derivados
  (`auto-<...>`), que **no son filas persistidas**.
- Hay lógica de **back-compat** en varios lugares (campos `projectType` vs `projectTypes`, status
  binario vs payment logs, plantillas de mensaje). No rompas esos caminos legacy.

> **El esquema SQL real de Supabase no se pudo verificar desde el repo** (requiere acceso al proyecto).
> El `create table` de referencia está embebido en el overlay de setup de `index.html` (sección del
> `setupOverlay`). Validá contra el proyecto Supabase real antes de asumir columnas o políticas.

---

## 6. Autenticación y permisos

- **Auth**: Supabase Auth (email/contraseña). `attemptLogin` / `handleLogin`. La sesión se detecta en
  `initSupabase` (`getSession` + `onAuthStateChange`).
- **Miembros**: `MEMBER_MAP` mapea emails conocidos a `{ memberId, name, color }`. Un email nuevo crea
  un miembro genérico. `currentMemberId` es **identidad local por dispositivo** (en `localStorage`,
  no se sincroniza).
- **API serverless**: `verifyAuth()` (`lib/afip-helpers.js`) valida el Bearer token llamando a
  `${SUPABASE_URL}/auth/v1/user`. Todos los endpoints `/api/afip/*` exigen token válido.

> ⚠️ **Hallazgo de seguridad crítico (verificado): la protección de datos es sólo del lado del cliente.**
> La política RLS de `pragma_state` que el propio setup instala es `for all using (true) with check
> (true)` — es decir, **completamente abierta**. La `anon key` de Supabase está embebida en
> `index.html` (pública por diseño en Supabase, pero aquí **sin RLS restrictivo**). El login es una
> **puerta de UI**, no un control de acceso real a los datos: cualquiera con la URL del proyecto y la
> anon key podría leer/escribir `pragma_state`. **No** se debe tratar este sistema como aislado por
> usuario ni multi-tenant. Ver §11 y §14 para las precauciones.

**Credenciales y secretos:**
- Cert/key de AFIP: **solo** como env vars en Vercel (en base64), nunca en el repo (`.gitignore`
  excluye `*.crt/*.key/*.pem/*.csr`). Env vars esperadas: `AFIP_CUIT, AFIP_CERT, AFIP_KEY,
  AFIP_POINT_OF_SALE, AFIP_PRODUCTION, AFIP_SDK_TOKEN?`, `SUPABASE_URL, SUPABASE_SERVICE_KEY`.
- `AFIP_PRODUCTION='true'` activa el entorno real de AFIP. En falso, usa homologación.
- **Nunca** agregues secretos al frontend ni a este repo.

---

## 7. Integraciones externas

| Integración | Dónde | Propósito | Auth | Riesgo al tocar |
|-------------|-------|-----------|------|-----------------|
| **Supabase** (DB/Auth/Realtime) | `index.html` (sync) + `lib/afip-helpers.js` | Persistencia, login, sync en vivo | anon key (frontend) / service key (backend) | Alto: todo el estado depende de esto |
| **AFIP** (`@afipsdk/afip.js`) | `api/afip/*`, `lib/afip-helpers.js` | Emisión de Factura C (CAE) | cert/key en env vars | **Muy alto: emite comprobantes fiscales reales** |
| **app.afipsdk.com** | `getAfipClient()` | Proxy/SDK AFIP (token opcional gratis) | `AFIP_SDK_TOKEN` | Medio: límite de requests sin token |
| **EmailJS** | `index.html` (`sendNotificationEmail`, `testEmail`) | Recordatorios/avisos por email (client-side) | `emailConfig` en `state` | Bajo/Medio |
| **Bluelytics** (`api.bluelytics.com.ar`) | `fetchBluelyticsBlue` | Dólar blue (auto-refresh si >4h) | ninguna | Bajo |
| **dolarapi.com** | `fetchDollarRate` | Cotizaciones (blue/oficial/mep/cripto/tarjeta) | ninguna | Bajo |
| **api.qrserver.com** | render de factura | Imagen QR del comprobante | ninguna | Bajo |
| **WhatsApp** (`wa.me`) | recordatorios de pago | Links de mensaje con plantilla | ninguna | Bajo |

---

## 8. Convenciones de desarrollo

- **Vite + ES Modules (vanilla JS), sin framework.** La lógica vive en `src/` (hoy mayormente en
  `src/legacy/app.js`, migrándose a `src/modules|core|services|utils`). El JS es vanilla con template
  strings para render (`innerHTML`). **No introduzcas React/Vue ni TypeScript.** Correr/compilar:
  `npm run dev` / `npm run build`. Al tallar módulos, respetá las capas y el `window-bridge` (no rompas
  los handlers inline); ver [`docs/architecture/`](docs/architecture/README.md).
- **Idioma**: todo el código, la UI, los comentarios y los nombres de negocio están en **español**
  (con términos técnicos en inglés para estados/keys). Mantenelo.
- **Estado**: todo cambio de datos se hace mutando `state` y llamando `save()`. `save()` espeja a
  `localStorage` y hace upsert a Supabase (debounce 500 ms). **Nunca** persistas por fuera de `save()`.
- **Render**: tras mutar estado, llamá `render()` (y `renderNav()` si cambian contadores/nav). El
  patrón es "mutar → save → render".
- **IDs**: generá con `uid()`. Fechas: helpers `todayISO()`, `fmt()`, `daysBetween()`, `monthsBetween()`.
- **Escapado**: usá `escapeHtml()` al interpolar texto del usuario en `innerHTML` (hay XSS latente si
  no se escapa — ver §11).
- **Backend**: funciones serverless en CommonJS (`module.exports = async function handler(req,res)`),
  patrón Vercel. Validá método, auth y entradas como en los handlers existentes.
- **Constantes de negocio** (rates, márgenes, complejidades, estados) viven en objetos/arrays al tope
  de sus secciones. **No hardcodees** valores que ya son configurables ahí.

---

## 9. Frontend y UX

- **Diseño**: minimalista, tipografía system/SF Pro, fondo `#fafafa`, acentos violeta (`#a855f7` /
  `#7c3aed`), botón primario negro (`.btn-primary`). Clases utilitarias propias: `.card`, `.chip`,
  `.btn-primary`, `.btn-ghost`, `.nav-item`, `.input`, `.kanban-col`, `.task-card`, `.modal-bg`,
  `.fade-in`. Reutilizalas; no inventes un sistema nuevo.
- **Layout**: sidebar fijo (`#sidebar`) + main scrollable (`#main`). Header de vista estándar:
  `viewHeader(title, subtitle, actions)`. Tarjetas de métrica: `statCard()`.
- **Modales**: host único `#modal` / `#modalContent`. Toasts: `showToast(msg, type, ms)`.
- **Responsive**: hay breakpoints a 768px (sidebar colapsable con `toggleSidebar()`, botón `.menu-btn`,
  overlay). Mantené el comportamiento mobile al tocar layout.
- **Estados de carga/vacío/error**: existen patrones (ej. spinner de factura `.inv-spinner`, pasos
  `.inv-step`, vacíos tipo "Nada urgente"). Seguí esos patrones para consistencia.
- **Colores de proyecto**: paleta fija `PROJECT_COLORS` (8 colores). Chips de estado traen su color en
  las constantes (`STATUS`, `PROJECT_STATUS`, `BUDGET_STATUS`, etc.).

---

## 10. Reglas críticas de negocio (preservar)

1. **Mensualidades recurrentes**: proyecto `ACTIVE_RECURRING` + `monthlyFee` ⇒ ingreso virtual mensual
   (`getAutoIncomes`). El cobro se registra en `recurringChargeLog` guardando **la cotización USD del
   momento** (`exchangeRate`). No conviertas montos recurrentes con la cotización "de hoy" para meses
   ya cobrados: usá la guardada.
2. **Cotización histórica por pago**: cada pago (`incomePayments`, `expensePayments`,
   `recurringChargeLog`, `recurringExpensePayments`) **congela** su `exchangeRate`. El flujo de caja y
   los totales dependen de eso. Cambiar la lógica de conversión puede **descuadrar el balance**
   (históricamente hubo bugs de doble conteo y balance que no cerraba — ver historial de commits).
3. **Pagos parciales**: `getPaymentSummary` deriva `PENDING/PARTIAL/PAID` por suma de pagos vs
   `amount`. Si no hay payment log pero el status es `CONFIRMED`/`PAID`, se asume pago completo
   **sintético** (back-compat). No rompas esa compatibilidad.
4. **Arrastres**: sólo ingresos **parciales** de meses anteriores, **sólo en vista Mes**, y hasta
   cobrarse al 100%. Nunca los sumes en Año/Rango (duplicaría).
5. **Gastos fijos**: `FIXED` + `recurring` ⇒ se proyectan a meses **posteriores** al original, hasta
   `recurringEndDate`. Darlos de baja (`cancelRecurringExpense`) sólo fija `recurringEndDate`; **lo
   histórico se mantiene**. No borres registros históricos.
6. **Presupuestos** (`estimateBudget`): el precio sale de horas × rates, ajustado por riesgo y
   contingencia, y el margen se clasifica contra el modelo de pricing. No alteres rates, porcentajes de
   disciplina ni fórmulas de margen sin pedido explícito: cambian cotizaciones comerciales reales.
7. **Facturación AFIP**: emite Factura C real (si `AFIP_PRODUCTION='true'`). Es **irreversible** (genera
   CAE ante AFIP). El número de comprobante se obtiene de AFIP (`getLastVoucher`), no se inventa.

---

## 11. Protección de datos (restricciones para operaciones sensibles)

- **NO ejecutar migraciones ni DDL** sobre Supabase. **NO** modificar políticas RLS. **NO** tocar env
  vars ni credenciales.
- **Borrados son destructivos y sin cascada**: borrar un proyecto/cliente/ingreso deja referencias
  colgando (`projectId`, `clientId`, `incomeId`) y puede alterar totales financieros. Antes de borrar,
  verificá referencias cruzadas.
- **Last-write-wins global (riesgo real)**: `save()` hace upsert del **documento completo**. Dos
  dispositivos editando a la vez ⇒ **el último pisa al otro** (no hay merge por campo ni CRDT). Cualquier
  cambio que alargue operaciones o agregue escrituras concurrentes aumenta el riesgo de pérdida de datos.
- **RLS abierta** (§6): no asumas aislamiento por usuario. No muevas datos sensibles al cliente ni
  expongas más de lo que ya hay.
- **XSS latente**: se interpola HTML con `innerHTML`. Usá `escapeHtml()` para todo texto de usuario.
- **Backups**: existe `exportData()` / `importData()` (JSON). Importar **reemplaza** el estado
  (`{ ...DEFAULT_STATE, ...imported }`). Tratar con cuidado.
- **Datos fiscales reales** (CUIT/DNI de clientes, CAE, montos): tratarlos como sensibles; no filtrarlos
  a servicios externos.

---

## 12. Validación de cambios

> Hay **build** (Vite) y **tests de caracterización** (Vitest) para funciones puras. Aún no hay lint,
> typecheck ni CI. La validación de la UI es **manual** (ver [`docs/architecture/migration.md`](docs/architecture/migration.md)).

Verificaciones aplicables y seguras:

- **Build del frontend**: `npm run build` (Vite). Debe compilar sin imports rotos ni errores.
- **Tests**: `npm test` (Vitest). Hoy cubre el motor de presupuestos; sumá caracterización al tallar
  módulos puros, **antes** de moverlos.
- **Backend serverless**: `node --check api/afip/emitir.js` (y `estado.js`, `ultimo.js`, `lib/afip-helpers.js`)
  para validar sintaxis. **No** los ejecutes contra AFIP real.
- **Prueba funcional manual**: `npm run dev`, loguear, y recorrer la vista afectada verificando consola
  limpia y que los totales/flujos cuadren (checklist completo en `docs/architecture/migration.md`).
- **AFIP**: usar el healthcheck `GET /api/afip/estado` (requiere token). **Nunca** emitir facturas de
  prueba en producción (`AFIP_PRODUCTION='true'`).

Registrá siempre: qué verificaste, qué pasó y qué quedó sin verificar (y por qué).

---

## 13. Flujo de trabajo con Git

- **Rama principal**: `main`. **No trabajar directo sobre `main`** ni ramas protegidas.
- Trabajá en una rama de feature (esta auditoría usó `agentes-ia`). Para este entorno de sesión, la
  rama de desarrollo designada puede ser otra (ej. `claude/...`): respetá la indicación vigente.
- **No usar** `git reset --hard`, `git push --force` ni operaciones destructivas sobre ramas ajenas.
- Si un push es rechazado por commits remotos que no tenés: `git fetch` + `git merge --no-edit`,
  **nunca** force-push.
- **Commits**: estilo claro, preferentemente **Conventional Commits** (`docs:`, `feat:`, `fix:`,
  `refactor:` …). Mensajes en español, descriptivos del cambio de negocio.
- **Pull Requests**: apuntar a la rama principal; crear como **draft** salvo indicación contraria;
  describir resumen, cambios, hallazgos, validaciones e impacto. No hacer merge del PR (lo revisa un
  humano). Respetar plantillas/checks del repo si existen.

---

## 14. Instrucciones para agentes de IA (protocolo obligatorio)

**Principio fundamental: comprender antes de modificar, preservar antes de reemplazar, validar antes de
entregar.**

### Antes de programar
1. Leé este `AGENTS.md` y la sección de código relevante (ubicala por los encabezados `// ====` de §3).
2. Identificá los módulos involucrados y sus entidades en `state`.
3. Inspeccioná el código existente **antes** de proponer cambios (no asumas estructura).
4. Entendé las reglas de negocio afectadas (§10) y los efectos secundarios (totales, arrastres,
   notificaciones, sync).
5. Revisá dependencias por `id` (relaciones sin FK) y back-compat legacy.
6. Identificá riesgos de seguridad y pérdida de datos (§11): RLS abierta, last-write-wins, borrados sin
   cascada, XSS.
7. Priorizá **reutilizar** patrones, helpers y constantes existentes.
8. Evitá duplicar funcionalidades o constantes ya definidas.

### Durante el desarrollo
1. Cambios **acotados** al objetivo pedido; cada línea cambiada debe trazar al requerimiento.
2. Respetá arquitectura y convenciones (§8): vanilla JS, sin build, español, patrón mutar→save→render.
3. No "mejores" código adyacente ni refactorices lo que no está roto.
4. No borres datos ni alteres migraciones/RLS destructivamente. Preservá lo histórico.
5. Mantené compatibilidad con datos viejos (campos legacy, pagos sintéticos).
6. No hardcodees reglas que ya son configurables (rates, márgenes, estados).
7. No agregues dependencias innecesarias (hoy hay **una** sola dep npm).
8. No cambies el contrato de `/api/afip/*` sin evaluar al consumidor (`callApi` en el frontend).
9. Mantené consistencia visual/UX y responsive (§9); escapá HTML de usuario.

### Después del desarrollo
1. Ejecutá las verificaciones aplicables (§12) y dejá constancia de resultados.
2. Revisá regresiones (sobre todo en Finanzas: que el balance cuadre).
3. Confirmá que no se alteraron datos existentes ni el esquema.
4. Documentá decisiones técnicas relevantes y archivos modificados.
5. Informá riesgos y verificaciones pendientes.
6. Actualizá este `AGENTS.md` **solo** si cambian arquitectura, reglas de negocio o convenciones.

---

## 15. Limitaciones conocidas y aspectos sin verificar

- **Esquema real de Supabase**: no verificable desde el repo. La referencia es el `create table` del
  overlay de setup en `index.html` y la forma de `DEFAULT_STATE`. Validar contra el proyecto real.
- **`pragma.html`** (*hipótesis*): es una **variante local-only** del app (mismo CSS y estructura de
  vistas, pero `save()` escribe **solo** a `localStorage`, sin Supabase, sin login). **No está
  referenciada** por `index.html` ni por routing, y no aparece en `package.json`. Parece un **prototipo
  o versión offline heredada**. Confirmar con el equipo antes de asumir que está en uso; en principio
  **el app vivo es `index.html`**.
- **Tooling de calidad parcial**: hay build (Vite) y tests de caracterización (Vitest, sólo funciones
  puras); aún faltan lint, typecheck y CI. La UI se valida a mano.
- **Deploy**: Vercel con build de Vite (`vercel.json`: `vite build` → `dist/`, `api/` serverless,
  fallback SPA). La configuración de env vars vive en el panel de Vercel, no en el repo.
- **Seguridad**: RLS abierta + anon key pública ⇒ el modelo de acceso real no está endurecido (§6/§11).
  Documentado como riesgo operativo; **no** fue modificado por esta auditoría.
- **Concurrencia**: sync last-write-wins sin merge; pérdida de datos posible con edición simultánea.

---

*Fin de AGENTS.md. Mantener este documento conciso y basado en evidencia. Ante dudas, leé el código
antes que la documentación.*
