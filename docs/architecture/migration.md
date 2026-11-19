# Migración — proceso, riesgos y validación

## Proceso (estrangulamiento incremental)

Cada módulo se migra con el mismo patrón, verificando build + tests entre pasos:

1. **Localizar** el bloque en `src/legacy/app.js` (contiguo si es posible) y comprobar que es
   autocontenido (sus dependencias son hojas o ya migradas).
2. **Crear** el/los archivo(s) de módulo con `export` de lo movido (verbatim).
3. **Reemplazar** el bloque en `legacy/app.js` por `import { ... } from '...'`.
4. **Verificar**: `npm run build` (sin duplicados ni imports rotos) y `npm test`.

El `window-bridge` al final de `legacy/app.js` se mantiene mientras existan handlers inline que
dependan de funciones/variables globales. A medida que un módulo pasa a usar listeners propios, se van
quitando entradas del bridge (reduciendo deuda) — pero sólo si no cambia el comportamiento.

## El window-bridge en detalle

Generado a partir del análisis de todos los `on*="..."` en `index.html` + `legacy/app.js`:
- **92 funciones** referenciadas por handlers → expuestas con `Object.assign(window, { ... })`.
- **11 variables de vista** reasignadas por handlers → expuestas con `Object.defineProperty(window, k,
  { get, set })` que leen/escriben la binding del módulo:
  `financeMode, financeMonth, financeFrom, financeTo, promptStyle, tasksViewMode, tasksFilter,
  projectsViewMode, projectsListStatus, projectsTypeFilter, budgetsFilterStatus`.

Verificación de cobertura: un script intersecta los identificadores invocados en handlers con las
funciones declaradas y comprueba que todas estén en el bridge (resultado: 0 faltantes).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| Handlers inline rotos al perder scope global | window-bridge (funciones + accessors de variables) |
| Variables de vista reasignadas por handlers desincronizadas | accessors get/set que proxyean a la binding del módulo |
| `state` reasignado no extraíble como import | se pospone; usará patrón `store.state` en etapa dedicada |
| Dependencias circulares | capas acíclicas; `render`/`nav` en core; bridge como puente temporal |
| Doble suscripción Realtime | preservar guarda `if (sbChannel) return` y el orden de boot |
| Cambios visuales por Tailwind | se mantiene el CDN (sin migrar a build-time) |
| Regresión en Finanzas (balance) | tests de caracterización antes de tallar finance; QA manual |
| Romper backend AFIP | no se toca `api/`; sin `"type":"module"` en la raíz |

## Validación

### Automática (en este entorno)
- `npm run build` → bundle Vite OK (actualmente 7 módulos, sin imports rotos).
- `npm test` → Vitest verde (presupuestos; se sumarán helpers/finance).
- `node --check api/afip/emitir.js|estado.js|ultimo.js lib/afip-helpers.js` → backend OK.

### Manual — checklist de QA en navegador (REQUERIDO antes de mergear)
> No verificable automáticamente aquí: la app usa Supabase (login) y AFIP reales.

1. `npm run dev` y abrir la app. Consola **sin errores** al cargar.
2. **Login** (Supabase Auth) y que cargue el estado desde la nube; ver indicador "Sincronizado".
3. Recorrer las 10 vistas (Tareas, Proyectos, Clientes, Presupuestos, Finanzas, Reportes, Documentos,
   Recursos, Equipo, Manual). Verificar que **todos los botones inline funcionan** (crear/editar/borrar,
   cambiar de vista, filtros, drag&drop de proyectos, panel de notificaciones, sidebar mobile).
4. **Finanzas**: cambiar Mes/Año/Rango; comprobar que totales, arrastres y pagos parciales cuadran
   igual que antes.
5. **Presupuestos**: crear/editar uno y comparar horas/costo/precio/margen con la versión previa.
6. **Sincronización**: abrir en dos pestañas y confirmar realtime (sin doble suscripción).
7. **AFIP**: `GET /api/afip/estado` (healthcheck, requiere token). **No emitir** facturas de prueba.
8. **Deploy preview en Vercel**: build OK, `api/afip/*` responde, assets y favicon sirven bien.

Registrar qué se verificó, qué pasó y qué quedó pendiente.

## Etapas siguientes (fuera de esta sesión)
`utils/helpers` → `core/constants` → `core/state`+`persistence` (patrón store) → `services/*` →
módulos de UI (dashboard, tasks, projects, clients, finance, invoices, reports, documents, team,
notifications, prompt) → `components/*`. Reducir el window-bridge a medida que cada módulo adopte
listeners propios, siempre sin cambiar comportamiento.
