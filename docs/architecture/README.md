# Arquitectura — PRAGMA Studio (refactor modular)

> Estado: **en progreso** (rama `refactor/modularizar-frontend`). Este documento describe la
> arquitectura objetivo y lo ya migrado. Las reglas de negocio no cambian: ver `AGENTS.md`.

## De dónde venimos

Monolito: todo el frontend en `index.html` (~6.851 líneas: HTML + CSS inline + 216 funciones JS en
scope global + estado global + auth/sync/integraciones). Medición completa en `inventory.md`.

## A dónde vamos

Frontend modular con **Vite + ES Modules** (vanilla JS, sin framework, sin TypeScript). El backend de
facturación (`api/afip/*`, Vercel Serverless, CommonJS) y las integraciones (Supabase, EmailJS, AFIP,
cotizaciones) **no cambian**. Tailwind, Supabase y EmailJS siguen por **CDN** (ver `decisions.md`).

```
index.html            # shell: <head> (CDN + metas) + contenedores + <script type=module src=/src/main.js>
src/
  main.js             # entrada: importa estilos + la app
  styles/base.css     # CSS extraído del <style> inline (verbatim)
  legacy/app.js       # resto del monolito reubicado; se va "tallando" hacia módulos. Incluye el window-bridge.
  modules/budgets/
    constants.js      # datos del cotizador (migrado)
    engine.js         # estimateBudget() + getBudgetCategories() — puro (migrado, testeado)
api/afip/*.js         # backend serverless (sin cambios)
lib/afip-helpers.js   # helpers AFIP (sin cambios)
tests/                # Vitest — caracterización de funciones puras
docs/architecture/    # esta documentación
```

## Capas y regla de dependencias

Orden acíclico `utils → core → services → modules → legacy → main`. Una capa sólo importa de capas
inferiores. `legacy/app.js` es el "resto por migrar": importa de `modules/`/`core/`/`utils/` a medida
que se tallan piezas; nada importa de `legacy`.

## El `window-bridge` (pieza clave)

Los 175 handlers inline del HTML (`onclick="fn()"`, etc.) y las 11 variables de vista que esos handlers
reasignan necesitan vivir en `window` (al pasar de `<script>` global a módulo ES, el scope deja de ser
global). `legacy/app.js` termina con un bloque **window-bridge** que:
1. expone en `window` las ~92 funciones referenciadas por handlers (valores directos);
2. expone las 11 variables de vista como **accessors get/set** que proxyean a la binding del módulo,
   de modo que `onclick="financeMode='mes'; render()"` escribe la misma variable que lee `render()`.

Esto preserva el comportamiento EXACTO sin tocar la lógica. Detalle y lista en `migration.md`.

## Estado de la migración — ✅ COMPLETA

`src/legacy/app.js` ya **no existe**: toda la lógica vive en módulos. `index.html` → `src/main.js`
→ `src/boot.js` (secuencia de arranque + window-bridge) → el grafo de módulos.

| Capa | Módulos |
|------|---------|
| Entrada | `main.js`, `boot.js` (arranque + bridge + listeners globales) |
| core | `state.js` (S + DEFAULT_STATE + load + CLIENT_ID), `constants.js`, `selectors.js` (getProject/currentMember/…), `ui.js` (render dispatch, nav, toast, header, modales), `persistence.js` (export/import) |
| services | `cloud.js` (supabase + sync + save + realtime), `auth.js` (login/miembros), `exchange.js`, `email.js` |
| modules | `dashboard, tasks, projects, clients, budgets_ui, budgets/{constants,engine}, finance, invoices, reports, documents, team, notifications` |
| utils | `helpers.js` (puros) |
| styles | `base.css` |

Verificación: `npm run build` (Vite, 29 módulos) · `npm test` (36 tests: budgets + helpers + **smoke
de render de las 10 vistas** en jsdom) · `npm run lint` (ESLint `no-undef`, 0 errores) · cobertura del
window-bridge (0 funciones inline faltantes). **Pendiente: QA manual en navegador** con Supabase/AFIP
reales (login, sync, finanzas, facturación) — ver `migration.md`.
