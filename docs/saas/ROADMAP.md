# Roadmap técnico — SaaS multiempresa

> Fases, dependencias, riesgos y **criterios de aceptación**. El orden puede ajustarse si las
> dependencias técnicas lo requieren. Complementa [`PLAN_REFACTORIZACION.md`](PLAN_REFACTORIZACION.md),
> [`MODELO_DATOS.md`](MODELO_DATOS.md) y [`FLUJOS_NEGOCIO.md`](FLUJOS_NEGOCIO.md).

## Fase 0 — Caracterizar y snapshot (prerrequisito, sin cambios de esquema)

- Exportar el `data jsonb` actual (ya existe `exportData()` + copia de la fila).
- **Golden-master tests** de Finanzas sobre el dataset real: `getPaymentSummary`,
  `getAllCashFlowPayments('income'|'expense')`, `getCarryOversForMonth`, totales de `renderFinance`
  (ARS + USD, base caja, tasas congeladas, sintéticos, pagos en moneda extranjera, arrastres).
- **Criterio de aceptación**: los números quedan congelados como contrato; nada se mergea si se
  mueven.

---

## Fase 1 — Fundaciones SaaS *(esta entrega)*

**Alcance**: tenencia (organizaciones, usuarios, membresías, roles), RLS restrictiva, persistencia
**por-organización** (puente), config Supabase por variables de entorno, siembra de org #1 (Pragma),
AFIP con contexto de organización (Factura C primero), tests de caracterización.

**Entregables**:
- `supabase/migrations/ps_0001_tenancy.sql` (+ `ps_0001_tenancy_down.sql`).
- `scripts/seed-org1.mjs` + guía de validación de integridad.
- `src/services/cloud.js` org-scoped + config por `import.meta.env`.
- `src/services/auth.js` por membresías (sin `MEMBER_MAP`).
- `src/modules/organizations.js` (selector/onboarding).
- `lib/afip-helpers.js` con verificación de membresía + `getAfipClient(orgId)` (fallback env vars).
- `tests/finance-characterization.test.js`.
- `.env.example`.

**Dependencias**: proyecto Supabase nuevo + credenciales (lo provee el usuario); prefijo de tablas
confirmado.

**Riesgos**:
- RLS mal configurada → fuga cross-org.
- Filas `org_id` null invisibles bajo la política.
- Realtime aún filtrando por `id=eq.main`.
- Anon key commiteada (se mueve a env; la defensa pasa a ser RLS).

**Criterios de aceptación**:
- Test de aislamiento: usuario de org A **no** puede `select/insert/update/delete` filas de org B;
  `platform_admin` sí; anónimo bloqueado.
- La app carga para org #1 **los mismos datos y totales** que hoy (mismo blob, sólo scoped).
- Realtime filtrado por `org_id`.
- `npm run lint` + `npm run build` + `npm test` verdes; `node --check` en `api/` y `lib/`.
- Sin aplicar a producción, sin merge a `main`, PR draft.

---

## Fase 2 — Finanzas normalizadas *(mayor riesgo)*

**Alcance**: `ps_obligations`, `ps_payments`, `ps_cash_accounts`, `ps_cash_movements`,
`ps_recurring_services`, `ps_invoices`; backfill desde el blob por-org; **capa repositorio**
(`src/services/repo/`) con backends Blob / Relacional / Dual; dual-write + reconciliación nocturna;
cutover de lectura con **sign-off humano**.

**Dependencias**: Fase 0 (golden-master) + Fase 1 (org #1 sembrada).

**Riesgos**: tasa congelada recalculada/perdida; sintéticos omitidos o doble-contados; divergencia
de fallback de monto/fecha; transferencias internas contadas como ingreso/egreso; drift de
parciales/arrastres; carreras de dual-write.

**Criterios de aceptación**:
- **Validador de integridad** verde para cada período y ambas monedas (< $0,01):
  `Σ getAllCashFlowPayments(blob)` == `Σ ps_payments(relacional)` a tasa congelada; `totalPaid` por
  obligación coincide; detección de arrastres idéntica.
- Conteos: obligaciones+pagos reconcilian con las longitudes del blob (manuales + logs + un
  sintético por confirmado-sin-log).
- Trigger de inmutabilidad de `exchange_rate` verificado.
- Transferencias excluidas de P&L, incluidas en saldos.
- Período-puente con reconciliador en cero antes de flipear lecturas; arrays del blob **congelados y
  retenidos** (no borrados) como rollback.

---

## Fase 3 — CRM, presupuestos y fiscal por organización

**Alcance**: `ps_clients`, `ps_contacts`, `ps_opportunity_stages`, `ps_opportunities`, `ps_budgets`
+ `ps_budget_items` (modo comercial + técnico); PDF con branding por empresa; AFIP por organización
(credenciales aisladas, comprobante según perfil fiscal); retiro de `MEMBER_MAP`.

**Dependencias**: Fase 1 (tenencia); Fase 2 para vincular presupuesto→obligación.

**Riesgos**: AFIP emitiendo con CUIT/cert de otra org (riesgo fiscal/legal); remoción de `MEMBER_MAP`
dejando a alguien sin acceso; `budgets.clientName` texto→FK sin match; secuencia CAE
(`getLastVoucher`) por `(cuit, ptoVta)` cruzando organizaciones.

**Criterios de aceptación**: emit rechaza no-miembros (403) y usa la `ps_org_fiscal_config` del
llamante; una org de prueba con credenciales AFIP homologación emite sin tocar el punto de venta de
Pragma; cada factura del blob mapea a una obligación; ambos modos de presupuesto renderizan bien;
los 3 emails legacy resuelven a membresías con rol correcto.

---

## Fase 4 — Finanzas UX

**Alcance**: pantallas de cuentas por cobrar/pagar, mensualidades, registro de cobros, movimientos
de caja, conciliación (sobre el núcleo relacional de Fase 2).

**Criterios de aceptación**: crear cliente, mensualidad, registrar cobro y "cuánto hay realmente" en
mínimas interacciones; totales idénticos a los golden-master; responsive a 768px; empty states con
acción; feedback inmediato ante guardado/error.

---

## Fase 5 — Facturación integrada

**Alcance**: flujos **facturo→cobro** y **cobro→facturo**, gestión de comprobantes, WhatsApp de
cobranza, RI / IVA discriminado operativo (Factura A/B, múltiples alícuotas, selección de
comprobante).

**Riesgos**: emisión duplicada; anulación fiscal (usar nota de crédito u otros mecanismos válidos,
nunca simular anulación de un comprobante autorizado).

**Criterios de aceptación**: estado de cobro y de facturación mostrados por separado; sin ingresos
duplicados al facturar+cobrar; protección anti-duplicado; investigación y validación de reglas
vigentes de ARCA (ex-AFIP) por perfil fiscal documentada; **nunca** comprobantes reales en pruebas.

---

## Fase 6 — Marketing y producto comercial

**Alcance**: `ps_content_items` (calendario/estados), origen de leads enlazado a oportunidades;
onboarding de empresas; preparación para planes SaaS (límites, administración interna); pulido de UX.

**Criterios de aceptación**: separación clara entre planificación de contenido y captación comercial;
sin conectores complejos (Meta/email) hasta definir alcance; módulos nuevos usan sólo el repositorio
relacional (no re-acoplan al blob).

---

## Concurrencia (transversal, todas las fases)

- **Riesgo**: durante el puente, los módulos aún en blob mantienen last-writer-wins; carreras de
  dual-write.
- **Criterio**: por entidad migrada, escritura a nivel de fila + realtime a nivel de fila; un test de
  dos clientes (dos miembros, cobros concurrentes) muestra ambos persistidos (sin pérdida) una vez
  Finanzas es relacional; los módulos no migrados quedan documentados como LWW hasta su turno.

---

## Reversibilidad (transversal)

- Cada migración tiene su `_down`. Backfills **insert-only**, idempotentes (keyed por `legacy_*`).
- El blob por-org se conserva **congelado** como copia de rollback; el export JSON de Fase 0 es el
  restore de último recurso.
- **No** `DROP`/`DELETE` de datos de origen en ninguna migración productiva sin aprobación explícita.

---

## Restricciones permanentes (de `AGENTS.md` §11 y del pedido)

- No ejecutar migraciones productivas destructivas; no modificar RLS de producción ni credenciales
  sin aprobación.
- No borrar funcionalidades actuales sin decisión explícita.
- No modificar fórmulas financieras críticas sin pruebas comparativas.
- No emitir facturas reales durante pruebas.
- No introducir cambios de stack innecesarios ni implementaciones paralelas de lo mismo.
- Mantener separación entre operaciones comerciales, contables y movimientos reales de dinero.
- Diseñar para empresas sin conocimientos contables ni técnicos.
