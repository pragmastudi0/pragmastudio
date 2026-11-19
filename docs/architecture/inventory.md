# Inventario de auditoría — `index.html` (estado previo al refactor)

> Medición objetiva del monolito antes de modularizar. Fuente: `index.html` (~6.851 líneas).
> Fecha: 2026-11-19 · Rama: `refactor/modularizar-frontend`.
> Este documento es **descriptivo** (qué hay hoy), no normativo.

## Métricas globales

| Métrica | Valor | Implicancia para el refactor |
|---------|------:|------------------------------|
| Líneas de `index.html` | ~6.851 | Todo frontend + lógica en un archivo |
| Funciones top-level (`function X`) | 216 | Todas comparten un scope global implícito |
| Funciones `async` top-level | 12 | Sync Supabase, AFIP, cotizaciones, email |
| **Handlers inline (`on*="…"`)** | **175** | **Requieren funciones globales en `window`** |
| └ de ellos `onclick` | 145 | |
| └ `onsubmit` | 17 | |
| └ `onchange`/`oninput` | 12 | |
| └ drag & drop (`ondragstart/over/drop/end`) | 4 | Kanban de proyectos |
| **Funciones distintas invocadas inline** | **≥85** | Superficie mínima a exponer en `window` |
| Usos de `innerHTML` | 21 | Render por template strings; XSS latente |
| Listeners globales (`document.addEventListener`) | 2 | `click` (cierre de paneles) y `keydown` (atajos) |
| Asignaciones `window.*` existentes | 11 | Ya hay globals expuestos a propósito |
| Dependencias por CDN `<script>` | 3 | Tailwind, Supabase, EmailJS |
| Dependencias npm | 1 | `@afipsdk/afip.js` (solo backend) |

## Dependencias externas cargadas por `<script>` (en `<head>`)

1. `https://cdn.tailwindcss.com` — **Tailwind JIT en runtime** (no build). Genera clases en el
   navegador. En producción emite un warning por consola. **Decisión abierta** (ver `decisions.md`).
2. `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` — expone `window.supabase`.
3. `https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js` — expone `window.emailjs`.

## Estado global y efectos secundarios (funciones con side-effects)

- **Estado**: un único objeto global `let state = load()`, más globals de vista:
  `currentView, currentTaskId, currentMemberId, financeMode/Month/Year/From/To, promptStyle,
  _currentAuthUser, _currentInvoiceItem, _currentInvoiceForm, sb, sbChannel, cloudReady, saveTimer,
  CLIENT_ID`.
- **Persistencia / side-effects**: `save()` (escribe localStorage + upsert Supabase, debounce 500 ms),
  `load()`, `loadStateFromCloud()`, `subscribeRealtime()` (suscripción Realtime — **no debe duplicarse**),
  `initSupabase()`, `exportData()/importData()`.
- **Red / IO**: `callApi()`, `getAuthToken()`, `attemptLogin/handleLogin/logout`, `confirmEmitInvoice`,
  `fetchBluelyticsBlue`, `fetchDollarRate`, `autoFetchBlueIfStale`, `sendNotificationEmail`, `testEmail`.
- **Boot imperativo** (final del script, sección `// BOOT`): ejecuta `renderLoginOverlay(); renderNav();
  render();` + migración de plantilla + `setTimeout` de notificaciones/dólar + `initSupabase()`
  condicional. **El orden de inicialización es significativo.**

## Mapa de secciones del monolito (encabezados `// ==== ====`)

| Sección | Línea aprox. | Destino de módulo propuesto |
|---------|-------------:|------------------------------|
| STATE / DEFAULT_STATE | 211 | `core/state.js` |
| LOGIN (Supabase Auth) | 256 | `services/auth.js` |
| CLOUD SYNC (Supabase) | 387 | `services/supabase.js` + `services/realtime.js` + `core/persistence.js` |
| CONSTANTS | 575 | `core/constants.js` |
| PRESUPUESTOS (constantes + motor) | 606 | `modules/budgets/engine.js` + `.../constants.js` |
| HELPERS | 873 | `core/helpers.js` (+ `utils/*`) |
| Toast / Email / Drag&drop | 933 | `components/toast.js`, `services/email.js`, `modules/projects/dnd.js` |
| NAV | 1009 | `core/nav.js` + `components/sidebar.js` |
| RENDER DISPATCH | 1062 | `core/render.js` |
| HEADER / HOME | 1081 | `components/header.js` + `modules/dashboard/` |
| TASKS / GANTT | 1178 | `modules/tasks/` |
| PROJECTS | 1370 | `modules/projects/` |
| PROMPT GENERATOR | 1753 | `modules/prompt/` |
| DOCUMENTS & RESOURCES | 1880 | `modules/documents/` |
| PRESUPUESTOS (UI) | 2053 | `modules/budgets/` |
| TEAM | 2841 | `modules/team/` |
| FINANCE / PARTIAL PAYMENTS | 3209 | `modules/finance/` |
| FACTURACIÓN AFIP (cliente) | ~3751–4760 | `modules/invoices/` |
| USD exchange rate | 4760 | `services/exchange.js` |
| REPORTS | 5767 | `modules/reports/` |
| GUIDE | 5890 | `modules/guide/` |
| MODALS (task/project/client/income/expense) | 5971 | repartidos en cada `modules/*` |
| NOTIFICATIONS PANEL | 6704 | `modules/notifications/` |
| EXPORT / IMPORT | 6771 | `core/persistence.js` |
| UTILS / KEYBOARD | 6801 | `utils/` + `core/keyboard.js` |
| BOOT | 6813 | `main.js` |

## Riesgos de dependencias para la migración

1. **Globals implícitos (bloqueante)**: 216 funciones y `state` viven en un scope global. Al pasar a
   ES Modules (scope de módulo), los 175 handlers inline dejan de resolver salvo que las ~85 funciones
   referenciadas se re-expongan en `window`. → **Capa de compatibilidad obligatoria** (`core/window-bridge.js`).
2. **Dependencias circulares potenciales**: render ↔ módulos ↔ state ↔ helpers. `render()` llama a todos
   los `renderX()`; muchos `renderX()`/`saveX()` llaman a `save()`, `showToast()`, `render()`. Se resuelve
   con capas: `utils → core(state/persistence/constants) → services → modules → main`, y usando el
   bridge para los reenganches a `window`.
3. **Orden de inicialización**: `state` debe existir antes de cualquier `render`; Supabase/Realtime se
   inicializan después del login. Mover esto sin preservar el orden rompe el arranque.
4. **Suscripción Realtime única**: `subscribeRealtime()` tiene guarda `if (sbChannel) return`. No
   duplicar al reorganizar el boot.
5. **CDN globales**: el código asume `window.supabase` y `window.emailjs`. Con Vite conviene pasarlos a
   imports npm (`@supabase/supabase-js`, `@emailjs/browser`) o mantenerlos como externos; Tailwind es
   decisión aparte.
6. **Sin red externa de pruebas**: Supabase/AFIP/cotizaciones requieren credenciales/servicios reales;
   no son verificables de forma automática en CI sin mocks. Las pruebas de caracterización se limitan a
   **funciones puras** (motor de presupuestos, pagos parciales, fechas, conversión).
