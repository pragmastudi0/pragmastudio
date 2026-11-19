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

## Estado de la migración

| Pieza | Estado |
|-------|--------|
| Infra Vite + build + Vercel | ✅ hecho |
| CSS extraído | ✅ hecho |
| Script reubicado a `src/legacy/app.js` + window-bridge | ✅ hecho |
| Módulo **Presupuestos** (constants + engine) + tests | ✅ hecho |
| core/state, persistence, services (supabase/auth/realtime/exchange/email) | ⏳ etapas siguientes |
| Resto de módulos (tasks, projects, clients, finance, invoices, reports, etc.) | ⏳ etapas siguientes |

Ver `migration.md` para el plan de las etapas restantes y el checklist de validación.
