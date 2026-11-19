# Plan de Refactorización — de Pragma Studio (interno) a SaaS comercial multiempresa

> Documento de producto y arquitectura. Describe **a dónde va** el sistema y **cómo** se transforma
> sin reconstruirlo desde cero ni perder datos históricos. Complementos:
> [`MODELO_DATOS.md`](MODELO_DATOS.md) · [`FLUJOS_NEGOCIO.md`](FLUJOS_NEGOCIO.md) ·
> [`ROADMAP.md`](ROADMAP.md).
>
> Base de evidencia: auditoría de código (`AGENTS.md`) + exploración directa del repo (nov. 2026).
> Donde se afirma una regla de negocio, proviene del código actual y se preserva.

---

## 1. Problema y objetivo

Pragma Studio hoy es una **herramienta interna de un solo inquilino**:

- Todo el estado vive en **un único documento JSON** (`pragma_state`, fila `id='main'`), con **RLS
  abierta** y `save()` que hace **upsert del documento completo** (last-writer-wins, sin merge).
- La identidad son **3 emails hardcodeados** (`MEMBER_MAP`).
- La facturación AFIP usa **una sola credencial global** y `CbteTipo=11` (Factura C) fijo.
- El branding ("Pragma Studio", CUIT, "Responsable Monotributo") está **hardcodeado** en el PDF de
  presupuesto y en la factura.

**Objetivo**: convertirlo en un **SaaS vendible a múltiples empresas** — con aislamiento real por
organización, configuración por empresa, CRM, presupuestos comerciales, finanzas simples y
facturación desacoplada del cobro — **reutilizando** la infraestructura y la lógica existentes.

**Filosofía de producto**: una empresa debe poder gestionar clientes, oportunidades, presupuestos,
facturación, cobranzas, pagos, proyectos y finanzas **sin cargar la misma información varias veces**
y **sin entender contabilidad**. Separar siempre lo **comercial**, lo **contable/fiscal** y el
**movimiento real de dinero**.

---

## 2. Principios de diseño (no negociables)

1. **No reconstruir desde cero.** Se reutiliza el motor de presupuestos, el congelado de cotización
   por pago, los flujos AFIP y los módulos de proyectos/tareas.
2. **No perder datos históricos.** Pagos, cotizaciones congeladas, mensualidades, facturas y CAE se
   preservan exactamente. Migración reversible, con validación de integridad.
3. **Stack estable.** Vanilla JS + Vite + ES Modules, Supabase, Vercel serverless, AFIP SDK. Sin
   framework, sin TypeScript. Se respeta el layering `utils → core → services → modules → boot` y el
   **window-bridge**.
4. **Seguridad desde la base de datos.** Aislamiento por organización vía **RLS restrictiva** (no
   sólo frontend). La seguridad deja de depender del secreto de la anon key.
5. **Implementación progresiva.** Una entidad a la vez, detrás de una capa de acceso a datos, sin
   reescrituras masivas simultáneas.
6. **Simplicidad y cambios quirúrgicos.** Cada línea cambiada traza a un requerimiento. No se
   "mejora" código adyacente ni se duplican implementaciones.

---

## 3. Decisiones tomadas

| # | Decisión | Detalle |
|---|----------|---------|
| 1 | **Entrega** | Documentos de planificación **+ Fase 1 completa** en rama `feat/saas-refactor-comercial`. Sin aplicar a producción, sin merge a `main`. |
| 2 | **Persistencia** | **Puente por-organización** (fila por `org_id`) en Fase 1; normalizar el núcleo comercial/financiero en fases siguientes. Nunca se mantiene el documento **global** como fuente de verdad multiempresa. |
| 3 | **Base de datos** | Proyecto Supabase **nuevo**, variables reconfiguradas, **tablas de cero**, en base **compartida** → **prefijo obligatorio** (`ps_` por defecto, configurable). Organización #1 (Pragma) **sembrada** desde export del estado actual. |
| 4 | **Fiscal** | **Diseñar multi-perfil** (RI / Monotributo / IVA discriminado) desde ya, **implementar Factura C primero** (Pragma), extender a RI en fase posterior. |

---

## 4. Mapa funcional objetivo y cómo interactúan los módulos

Flujo de datos central (sin duplicar información):

```
  Oportunidad (CRM)
      │  ganada
      ▼
  Presupuesto ──aceptado──► Obligación de cobro (Cuenta por cobrar)
      │                           │
      │ (opcional, explícito)     ├──► Factura (AFIP)   [estado de FACTURACIÓN]
      ▼                           └──► Cobro(s)         [estado de COBRO]
  Proyecto ──► Tareas                     │
                                          ▼
                                   Movimiento de caja (dinero real)
```

| Módulo | Rol | Se relaciona con |
|--------|-----|------------------|
| **Configuración de empresa** | Identidad, datos fiscales, comercial (moneda, validez, pie, datos de pago, plantilla de cobranza, numeración). Documentos guardan **copia histórica**. | Alimenta PDF de presupuesto, factura y mensajes. |
| **Clientes 360°** | Ficha comercial + financiera por `clientId`. | Oportunidades, presupuestos, proyectos, mensualidades, facturas, cobros. |
| **CRM / Oportunidades** | Pipeline Kanban con etapas configurables por empresa. | Genera presupuestos; al ganar, crea proyecto/obligación **explícitamente**. |
| **Presupuestos** | 2 modos: **comercial simple** (conceptos) y **técnico** (motor actual). | Cliente, oportunidad; aceptado → obligación/proyecto. |
| **Finanzas** | Cobrar / cobré / pagar / pagué; mensualidades; caja. | Obligaciones, pagos, facturas, cuentas de caja. |
| **Facturación AFIP** | Comprobantes por organización; estado independiente del cobro. | Obligaciones, clientes, config fiscal por org. |
| **Proyectos/Tareas** | Ejecución; estados/categorías configurables. | Oportunidad/presupuesto → proyecto → tareas. |
| **Marketing/Contenido** | Calendario y estados de contenido; origen de leads. | Oportunidades (origen de lead). |
| **Plataforma** | Admin de plataforma vs admin de empresa vs operativo. | Organizaciones, usuarios, membresías, roles. |

Principio transversal: **toda relación es por identificador persistente**; cambiar de etapa una
oportunidad, convertir un presupuesto o emitir una factura **no duplica** registros.

---

## 5. Propuesta UX

### 5.1 Navegación (reorganizada por proceso comercial)

`Inicio/Resumen · Clientes · Oportunidades · Presupuestos · Proyectos · Finanzas · Facturación ·
Marketing · Configuración`

Se conservan los componentes visuales existentes: `viewHeader()`, `statCard()`, clases `.card`,
`.chip`, `.btn-primary`, `.btn-ghost`, `.nav-item`, `.kanban-col`, modal único (`#modal`), toasts
(`showToast`), sidebar colapsable a 768px. No se inventa un sistema visual nuevo; se eleva el
existente a un look SaaS consistente (jerarquía, empty states con acción, feedback inmediato).

### 5.2 Finanzas (rediseño funcional)

Pestañas: **Resumen · Cuentas por cobrar · Cuentas por pagar · Movimientos · Mensualidades.**
Separación estricta de los 4 conceptos: **lo que tengo que cobrar / lo que cobré / lo que tengo que
pagar / lo que pagué**. Facturar y cobrar son procesos **independientes**.

- **Resumen**: saldo de caja, total pendiente de cobrar, total vencido, total pendiente de pagar,
  cobrado del mes, pagado del mes, resultado de caja. Saldo inicial / movimientos / saldo final
  explícitos. Filtros por fecha, moneda y cuenta. **Nunca** suma una mensualidad futura ni una
  factura pendiente como ingreso real.
- **Cuentas por cobrar** (pantalla principal): tabla
  `Cliente | Concepto | Vence | Importe | Cobrado | Pendiente | Estado | Acciones`.
  Estado de cobro derivado (Pendiente/Parcial/Cobrado/Vencido). Acciones inline: **registrar cobro,
  emitir factura, ver factura, WhatsApp, ver detalle**. Un cliente puede tener varias cuentas;
  una cuenta admite pagos parciales.
- **Mensualidades**: `Cliente | Servicio | <Mes> | Facturado | Cobrado | Pendiente | Acciones`.
  Gestión idempotente por período. Pausar/finalizar/modificar sin destruir meses anteriores.
- **Cuentas por pagar**: misma filosofía para gastos/proveedores; fecha de obligación vs fecha
  efectiva de salida; recurrentes; adjuntar comprobantes.
- **Movimientos**: `Fecha | Concepto | Cliente/Proveedor | Cuenta | Ingreso | Egreso | Saldo`.
  Múltiples cuentas; transferencias internas sin duplicar; saldo inicial; reversiones con
  trazabilidad; conciliación.
- **Registro rápido de cobro**: importe (precargado con saldo), fecha real, medio, cuenta,
  referencia, observación. Parciales/múltiples/anticipados; **congela cotización** y moneda original.
- **WhatsApp de cobranza**: previsualizar → editar → abrir `wa.me` con plantilla de la empresa.
  Variables: nombre, concepto, período, importe pendiente, moneda, vencimiento, alias/datos
  bancarios, empresa. **Nunca** envía automáticamente ni marca como enviado.

### 5.3 Clientes (ficha 360°)

Pestañas/secciones (sin pantallas interminables): Datos · Oportunidades · Presupuestos · Proyectos ·
Mensualidades · Facturas · Pagos · Saldo y próximos vencimientos · Actividad.

### 5.4 Presupuestos

Alta rápida por **conceptos** (default comercial): descripción, cantidad, unidad, precio unitario,
descuento, impuesto/alícuota, subtotal. Cálculo con decimales seguros y redondeo explícito
(subtotal, descuentos, base imponible, impuestos discriminados, total; neto vs con impuestos
incluidos), **con tests que garantizan que pantalla y PDF coincidan**. Modo **técnico** opcional
(motor `estimateBudget` actual, intacto). **Vista previa** antes de descargar; PDF A4 con branding
de la empresa. Estados DRAFT/SENT/ACCEPTED/REJECTED/EXPIRED; duplicar; convertir aceptado →
proyecto/obligación; versiones históricas. **Aceptar no crea dinero cobrado.**

### 5.5 Procesos priorizados (mínimas interacciones)

Crear cliente · crear oportunidad · generar presupuesto · convertir a servicio/proyecto · crear
mensualidad · emitir factura · enviar recordatorio de cobro · registrar pago · consultar cuánto
dinero hay realmente disponible.

---

## 6. Arquitectura de persistencia (resumen)

- **Fase 1 — puente por-org**: la fila global `id='main'` se reemplaza por **una fila por
  organización** (`ps_org_state`, `org_id` PK). Misma forma del documento → la lógica de negocio no
  cambia. RLS restrictiva por membresía. Cambio acotado en `cloud.js` (scope por `org_id`).
- **Fase 2+ — normalización del núcleo financiero**: `ps_obligations`, `ps_payments`,
  `ps_cash_accounts`, `ps_cash_movements`, `ps_recurring_services`, `ps_invoices`, detrás de una
  **capa repositorio** (`src/services/repo/`) con backends Blob / Relacional / Dual seleccionables
  por entidad vía flag. Dual-write + reconciliación nocturna + cutover con **sign-off humano**.
- **Invariante financiero**: cada pago **congela** su cotización; los totales suman cada pago a su
  propia tasa; el **pago sintético** (ítem confirmado sin log) se preserva byte a byte. Detalle en
  [`MODELO_DATOS.md`](MODELO_DATOS.md).

---

## 7. Preparación comercial del SaaS

- **Roles**: `platform_admin` (gestiona el producto y sus organizaciones) · `org_admin` (gestiona su
  organización) · `operative` (trabaja según permisos). Un admin de empresa **nunca** accede a datos
  de otra.
- **Onboarding**: alta de empresa → configuración de identidad y fiscalidad → invitación de usuarios
  → activación de módulos.
- **Planes**: la arquitectura queda preparada para límites por plan y administración interna; **no**
  se implementa cobro de la suscripción SaaS hasta definir alcance.

---

## 8. Resumen de fases (detalle en [`ROADMAP.md`](ROADMAP.md))

1. **Fundaciones SaaS** — organizaciones, usuarios/roles, RLS, persistencia por-org, migración
   segura. *(esta entrega)*
2. **Configuración y clientes** — datos de empresa, personalización, clientes 360°, preferencias
   fiscales.
3. **CRM y presupuestos** — pipeline, presupuesto por conceptos, PDF por empresa, relación
   oportunidad↔proyecto.
4. **Finanzas simplificadas** — obligaciones de cobro/pago, mensualidades, registro de cobros, caja,
   conciliación.
5. **Facturación integrada** — facturo→cobro y cobro→facturo, gestión de comprobantes, AFIP por
   organización, WhatsApp.
6. **Marketing y producto comercial** — contenidos, seguimiento, onboarding, preparación de planes,
   UX final.

---

## 9. Decisiones de producto a confirmar

- **Nombre comercial del producto** (afecta branding por defecto y, opcionalmente, el prefijo de
  tablas).
- **Prefijo de tablas** definitivo (default `ps_`).
- **Etapas de pipeline por defecto** (sugeridas: Nuevo lead → Contactado → Relevamiento → Propuesta
  enviada → Negociación → Ganada / Perdida).
- **Política de actualización de importe** de mensualidades (fija / manual / índice).
- Alcance de **planes SaaS** y de integraciones de marketing (Meta, email) — no desarrollar
  conectores complejos sin definir alcance.
