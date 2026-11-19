# Módulos — responsabilidades y dependencias

Mapa de las capas y el destino de cada parte del monolito. Las piezas ✅ ya están migradas; las ⏳
siguen en `src/legacy/app.js` esperando su etapa.

## Capas (dependencias sólo hacia abajo)

```
utils/        (puro, sin estado)          ← hojas
core/         (state, constants, nav, render, persistence, window-bridge)
services/     (supabase, auth, realtime, exchange, email, api)
modules/      (UI + lógica por dominio)
legacy/app.js (lo no migrado; importa de las capas de arriba; nadie importa de él)
main.js       (orquesta el boot)
```

## Inventario de módulos objetivo

| Módulo | Responsabilidad | Reglas clave (AGENTS.md) | Estado |
|--------|-----------------|--------------------------|--------|
| `modules/budgets` | Cotizador: constantes + `estimateBudget`/`getBudgetCategories` | §4.4, §10.6 | ✅ |
| `core/state` | `DEFAULT_STATE`, `state`, `load` | §5, §11 (reasignación) | ⏳ |
| `core/persistence` | `save` (localStorage + upsert Supabase), export/import | §8, §11 | ⏳ |
| `core/constants` | STATUS, PRIORITY, PROJECT_STATUS, NAV, categorías… | — | ✅ |
| `core/nav` + `core/render` | `NAV`, `renderNav`, `go`, `render` (dispatch) | §9 | ⏳ |
| `utils/helpers` | `uid, todayISO, fmt, fmtMoney, daysBetween, monthsBetween, prevMonthKey, lastDayOfMonth, escapeHtml, escapeAttr` | §8 | ✅ |
| `services/supabase` | `createClient`, `initSupabase` | §6, §7 | ⏳ |
| `services/auth` | login/logout, `MEMBER_MAP`, `setMemberFromAuthUser` | §6 | ⏳ |
| `services/realtime` | `subscribeRealtime` (suscripción única) | §11 | ⏳ |
| `services/exchange` | `fetchBluelyticsBlue`, `fetchDollarRate`, `autoFetchBlueIfStale`, `DOLAR_SOURCES` (DI) | §7 | ✅ |
| `services/email` | `sendNotificationEmail`, `testEmail` (EmailJS, DI) | §7 | ✅ |
| `services/api` | `callApi`, `getAuthToken` (cliente de `/api/afip/*`) | §6, §7 | ⏳ |
| `modules/dashboard` | Home (vence hoy, bloqueadas, semana) | §4 | ⏳ |
| `modules/tasks` | Tareas, Kanban, Gantt, comentarios/menciones | §4.1 | ⏳ |
| `modules/projects` | Proyectos, estados, drag&drop, mensualidades | §4.2, §10.1 | ⏳ |
| `modules/clients` | Datos fiscales | §4.3 | ⏳ |
| `modules/finance` | Ingresos/gastos, recurrentes, pagos parciales, arrastres, cash-flow | §4.5, §10.1–10.5, §11 | ⏳ |
| `modules/invoices` | Facturación AFIP (cliente), QR, `state.invoices` | §4.6, §10.7 | ⏳ |
| `modules/reports` | Métricas agregadas | §4.7 | ⏳ |
| `modules/documents` | Documentos y recursos | §4.7 | ⏳ |
| `modules/team` | Miembros | §4.7 | ⏳ |
| `modules/notifications` | Panel + toasts | §4.7 | ⏳ |
| `modules/prompt` | Generador de prompts para IA | §4.7 | ⏳ |
| `components/*` | sidebar, modal, toast, header, cards (UI compartida) | §9 | ⏳ |

## Dependencias críticas a respetar al tallar

- **`render()` es el hub**: llama a cada `renderX()`; muchos `saveX()`/`renderX()` llaman a `save()`,
  `showToast()`, `render()`. Para evitar ciclos, `render`/`nav` van en `core` y los módulos importan de
  `core`, no al revés. Donde un módulo necesite disparar `render`, se inyecta o se usa el bridge de
  `window` como puente temporal (documentado).
- **`save()`** depende de `sb`/`cloudReady` (services/supabase) y de `setSyncStatus` (UI). No llama a
  `render()`. Al extraer, mantener esa independencia.
- **Realtime** (`subscribeRealtime`) tiene guarda `if (sbChannel) return`: no duplicar al reordenar boot.
- **Orden de boot** (en `main.js` / final de `legacy`): `render` inicial → `initSupabase` → (login) →
  `loadStateFromCloud` → `subscribeRealtime`. Preservarlo.
