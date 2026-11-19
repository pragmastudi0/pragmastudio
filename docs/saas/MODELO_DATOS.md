# Modelo de datos — SaaS multiempresa

> Esquema relacional objetivo, políticas RLS y **mapeo exacto** desde el documento JSON actual.
> Toda tabla lleva prefijo **`ps_`** (configurable; base compartida). Complementa
> [`PLAN_REFACTORIZACION.md`](PLAN_REFACTORIZACION.md) y [`FLUJOS_NEGOCIO.md`](FLUJOS_NEGOCIO.md).

## 0. Punto de partida (verificado en código)

Hoy existe **una** tabla, una fila, sin aislamiento:

```sql
-- ESTADO ACTUAL (single-tenant) — se reemplaza, no se migra in-place
create table pragma_state (
  id text primary key,          -- siempre 'main'
  data jsonb not null,          -- TODO el estado de la app
  writer text,                  -- CLIENT_ID (dedup realtime)
  updated_at timestamptz default now()
);
alter table pragma_state enable row level security;
create policy "open access" on pragma_state for all using (true) with check (true);
```

Problemas que resuelve el modelo nuevo: sin `tenant_id`, RLS abierta, upsert de documento completo
(last-writer-wins), identidad hardcodeada, credencial AFIP global.

Convenciones del esquema nuevo:
- Prefijo `ps_` en todas las tablas y funciones.
- PK `id uuid default gen_random_uuid()`; toda tabla de negocio con `org_id uuid not null references
  ps_organizations(id)`, `created_at timestamptz default now()`, `updated_at`, `created_by uuid`.
- Dinero: `numeric(16,4)`. Moneda: `text check (currency in ('ARS','USD'))`.
- **Tasa congelada**: `numeric(16,6)`, **escritura única** (inmutable tras insert).
- Campos `legacy_*` conservan los ids del blob para remapear relaciones y permitir rollback.

---

## 1. Tenencia e identidad (Fase 1)

```sql
-- Perfil de usuario de la app, 1:1 con auth.users (Supabase Auth sigue siendo la autoridad)
create table ps_app_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  avatar_color text default '#6b7280',
  is_platform_admin boolean not null default false,  -- superusuario cross-org (Pragma)
  created_at  timestamptz not null default now()
);

create table ps_organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,          -- 'pragma-studio'
  name        text not null,                 -- nombre comercial
  legal_name  text,                          -- razón social
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create type ps_org_role as enum ('org_admin','operative');

create table ps_memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references ps_organizations(id) on delete cascade,
  user_id    uuid not null references ps_app_users(id) on delete cascade,
  role       ps_org_role not null default 'operative',
  legacy_member_id text,         -- member.id del blob (comentarios/notificaciones/historial)
  display_name text,
  color      text,
  invited_at timestamptz default now(),
  accepted_at timestamptz,
  unique (org_id, user_id)
);
create index on ps_memberships(user_id);
create index on ps_memberships(org_id);

-- Documento PUENTE por organización (reemplaza la fila global 'main')
create table ps_org_state (
  org_id     uuid primary key references ps_organizations(id) on delete cascade,
  data       jsonb not null,     -- misma forma que DEFAULT_STATE (sin cambios de lógica)
  writer     text,               -- CLIENT_ID (dedup realtime)
  updated_at timestamptz default now()
);

-- Config fiscal por organización (secretos cifrados; sólo org_admin)
create table ps_org_fiscal_config (
  org_id        uuid primary key references ps_organizations(id) on delete cascade,
  cuit          bigint,
  point_of_sale integer,
  afip_production boolean not null default false,
  default_cbte_tipo integer not null default 11,    -- 11 = Factura C (Monotributo)
  condicion_fiscal text,                             -- 'Monotributo' | 'Responsable Inscripto' | ...
  issuer_name   text,                                -- nombre a imprimir en el comprobante
  cert_ciphertext bytea,                             -- cert AFIP cifrado (pgsodium/Vault)
  key_ciphertext  bytea,
  afip_sdk_token_ciphertext bytea,
  updated_at timestamptz default now()
);
```

### 1.1 Funciones de autorización (RLS corta e indexable)

```sql
create or replace function ps_auth_is_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ps_memberships m
                 where m.org_id = target_org and m.user_id = auth.uid())
      or exists (select 1 from ps_app_users u
                 where u.id = auth.uid() and u.is_platform_admin);
$$;

create or replace function ps_auth_is_org_admin(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ps_memberships m
                 where m.org_id = target_org and m.user_id = auth.uid() and m.role = 'org_admin')
      or exists (select 1 from ps_app_users u
                 where u.id = auth.uid() and u.is_platform_admin);
$$;
```

### 1.2 Patrón de políticas RLS (uniforme por tabla con `org_id`)

```sql
alter table <t> enable row level security;
create policy <t>_read   on <t> for select using (ps_auth_is_member(org_id));
create policy <t>_insert on <t> for insert with check (ps_auth_is_member(org_id));
create policy <t>_update on <t> for update using (ps_auth_is_member(org_id)) with check (ps_auth_is_member(org_id));
create policy <t>_delete on <t> for delete using (ps_auth_is_member(org_id));
```

- `ps_org_state`: política `for all` con `ps_auth_is_member(org_id)`.
- `ps_org_fiscal_config`: lectura/escritura **sólo** `ps_auth_is_org_admin(org_id)` (secretos).
- `ps_organizations`: legible sólo a sus miembros; `ps_memberships`: legible a co-miembros, escritura
  sólo `org_admin`.
- `ps_app_users`: cada quien ve su propia fila (y `platform_admin` todas).

Esto **reemplaza** `using(true)` — es el núcleo del aislamiento multiempresa y va gated por tests de
aislamiento (ver [`ROADMAP.md`](ROADMAP.md)).

### 1.3 Serverless AFIP con contexto de organización

- El cliente envía header `X-Org-Id` junto al Bearer token. `callApi` lo agrega.
- `verifyAuth` sigue validando el JWT y suma `requireOrgMembership(userId, orgId)` (consulta
  `ps_memberships` con **service key**, bypass RLS deliberado server-side); 403 si no es miembro.
- `getAfipClient(orgId)` lee `ps_org_fiscal_config` (service role) y descifra cert/key en memoria.
  `res_folder`/`ta_folder` por org (`/tmp/afip-<orgId>/...`) para no cruzar el ticket de acceso.
- **Fase 1**: org #1 (Pragma) puede mantener las env vars actuales como *fallback* mientras
  `ps_org_fiscal_config` esté vacío (flag), para que la emisión no se rompa.

---

## 2. Núcleo comercial (Fase 2–3)

```sql
create table ps_clients (            -- "fuente de verdad" fiscal (era blob clients[])
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  name text not null,
  doc_type text default '99',        -- 80 CUIT / 86 CUIL / 96 DNI / 99 Consumidor Final
  doc_number text,
  condicion_iva text,
  category text,                     -- tipo de cliente
  responsible_user_id uuid references ps_app_users(id),
  phone text, email text, website text, address text,
  payment_terms text, usual_currency text,
  active boolean default true,
  notes text,
  legacy_id text,                    -- id original en el blob
  created_at timestamptz default now(), updated_at timestamptz, created_by uuid
);

create table ps_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  client_id uuid references ps_clients(id) on delete cascade,
  name text, role text, email text, phone text,   -- phone = WhatsApp
  is_primary boolean default false
);

create table ps_opportunity_stages (   -- pipeline configurable por empresa
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  name text not null, sort_order int not null,
  is_won boolean default false, is_lost boolean default false
);

create table ps_opportunities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  client_id uuid references ps_clients(id),
  contact_id uuid references ps_contacts(id),
  stage_id uuid references ps_opportunity_stages(id),
  title text not null,
  amount numeric(16,4), currency text default 'ARS',
  probability int, expected_close date,
  source text,                       -- origen del lead (enlazable a marketing)
  next_followup date, notes text,
  status text default 'OPEN',        -- OPEN / WON / LOST
  budget_id uuid, project_id uuid, lost_reason text,
  created_at timestamptz default now(), updated_at timestamptz, created_by uuid
);
```

### 2.1 Presupuestos (ambos modos en una sola estructura)

```sql
create table ps_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  code text,                         -- 'PRES-YYYY-NNNN'
  client_id uuid references ps_clients(id),
  client_name_text text,             -- back-compat: budgets hoy usan texto libre, no FK
  opportunity_id uuid references ps_opportunities(id),
  mode text not null default 'commercial',   -- 'commercial' (conceptos) | 'technical' (estimador)
  title text, currency text default 'ARS', status text default 'DRAFT',
  -- conocimiento del estimador técnico (se preserva como jsonb/nullable)
  category text, pricing_model text, contingency_pct numeric(6,3), risk_factors jsonb,
  valid_until date, commercial_terms text, notes text,
  snapshot_company jsonb,            -- copia histórica de datos de empresa al emitir
  legacy_id text,
  created_at timestamptz default now(), updated_at timestamptz, created_by uuid
);

create table ps_budget_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  budget_id uuid not null references ps_budgets(id) on delete cascade,
  sort_order int,
  -- modo comercial: concepto + cantidad + precio
  concept text, qty numeric(12,2) default 1, unit text, unit_price numeric(16,4),
  discount_pct numeric(6,3) default 0, tax_rate numeric(6,3),   -- alícuota aplicable
  -- modo técnico: módulo/horas/complejidad (nullable en comercial)
  module text, complexity text, hours_dev numeric(10,2),
  line_total numeric(16,4)
);
```

Un `mode` discrimina ambos modos; los campos técnicos quedan nullable para que el motor
`estimateBudget` (`src/modules/budgets/engine.js`) siga funcionando sin cambios. Los cálculos
comerciales (subtotal, descuento, base imponible, IVA discriminado, total; neto vs incluido) usan
redondeo explícito y tests de paridad pantalla/PDF.

---

## 3. Núcleo financiero (Fase 2) — el corazón de la migración

### 3.1 Cuentas y movimientos de caja (dinero real)

```sql
create table ps_cash_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  name text not null, currency text not null,
  kind text default 'bank',          -- bank / cash / mp / crypto
  opening_balance numeric(16,4) default 0, archived boolean default false
);

create table ps_cash_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  account_id uuid not null references ps_cash_accounts(id),
  direction text not null check (direction in ('in','out')),
  amount numeric(16,4) not null,     -- en moneda de la cuenta, siempre positivo
  currency text not null,
  occurred_on date not null,         -- fecha valor real
  exchange_rate numeric(16,6), exchange_rate_source text,  -- congelada
  transfer_group_id uuid,            -- mismo uuid en ambas patas de una transferencia interna
  is_internal_transfer boolean default false,
  payment_id uuid,                   -- → ps_payments.id (lo que este movimiento salda)
  note text, created_by uuid, created_at timestamptz default now()
);
create index on ps_cash_movements(org_id, occurred_on);
```

**Transferencias internas sin doble conteo**: una transferencia = dos `ps_cash_movements` con el
mismo `transfer_group_id` y `is_internal_transfer=true` (un `out` en origen, un `in` en destino).
Todo agregado de P&L / flujo de caja **excluye** las filas `is_internal_transfer=true` (mueven
dinero entre cuentas propias, no son ingreso/egreso). Los **saldos de cuenta** sí las incluyen.

### 3.2 Obligaciones (cuentas por cobrar / pagar)

```sql
create type ps_obligation_kind as enum ('receivable','payable');
create type ps_obligation_status as enum ('OPEN','PARTIAL','SETTLED','VOID');

create table ps_obligations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  kind ps_obligation_kind not null,
  client_id uuid references ps_clients(id),   -- receivables
  project_id uuid,
  counterparty_text text,                     -- payables sin cliente
  concept text not null,
  period text,                                -- 'YYYY-MM' en recurrentes; null en one-off
  due_on date, issued_on date,
  amount numeric(16,4) not null,              -- esperado, en moneda de la obligación
  currency text not null,
  status ps_obligation_status not null default 'OPEN',   -- DERIVADO de pagos (ver 3.3)
  recurring_service_id uuid references ps_recurring_services(id),
  source_kind text,        -- 'manual_income'|'auto_income'|'manual_expense'|'auto_expense'
  legacy_ref text,         -- id sintético original: 'auto:<proj>:<month>' o income/expense legacy id
  unique (org_id, recurring_service_id, period),   -- IDEMPOTENCIA por período
  created_at timestamptz default now(), updated_at timestamptz, created_by uuid
);
create index on ps_obligations(org_id, kind, status);
```

### 3.3 Pagos (preservan la tasa congelada — lo más sensible)

```sql
create table ps_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  obligation_id uuid not null references ps_obligations(id) on delete restrict,
  amount numeric(16,4) not null,            -- en original_currency
  original_currency text not null,          -- moneda realmente transada
  paid_on date not null,                    -- FECHA REAL del pago (era p.date)
  recorded_at timestamptz,                  -- era p.paidAt (timestamp de auditoría)
  exchange_rate numeric(16,6) not null,     -- CONGELADA — nunca se recalcula
  exchange_rate_source text,
  paid_by uuid references ps_app_users(id),
  cash_movement_id uuid references ps_cash_movements(id),
  is_synthetic boolean default false,       -- back-compat: confirmado sin log
  note text, legacy_id text,
  created_at timestamptz default now()
);
create index on ps_payments(org_id, obligation_id);
```

Regla (trigger + repositorio): **`exchange_rate` y `original_currency` son inmutables tras el
insert.** Toda corrección es un pago reversor, nunca un `update` → los saldos históricos no derivan.

**Estado de la obligación DERIVADO** (no se guarda como verdad): `SETTLED` cuando
`Σ pagos (convertidos a la moneda de la obligación a la tasa congelada de cada pago) ≥ amount`;
`PARTIAL` si hay pagos pero no alcanza; `OPEN` si no hay. Esto es exactamente `getPaymentSummary`.

### 3.4 Servicios recurrentes (abonos) → obligaciones idempotentes

```sql
create table ps_recurring_services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  kind ps_obligation_kind not null,         -- receivable (abono) | payable (gasto fijo)
  client_id uuid references ps_clients(id), project_id uuid,
  concept text not null,
  amount numeric(16,4) not null, currency text not null,
  period_unit text default 'month',
  start_period text not null,               -- 'YYYY-MM'
  end_period text,                          -- null = abierto (= recurringEndDate)
  update_policy text,                       -- política de actualización del importe
  billing_preference text,                  -- preferencia operativa de facturación
  active boolean default true,
  legacy_project_id text, legacy_expense_id text
);
```

Generación = función pura `generatePeriod(service,'YYYY-MM')` que hace **upsert** de una
`ps_obligations` sobre `(recurring_service_id, period)`; el `unique` lo hace idempotente (re-correr
no duplica). Reemplaza el modelo de *proyección virtual* (`getAutoIncomes`/`getAutoExpenses`): la
obligación se materializa la primera vez que el período se ve/cobra.

### 3.5 Facturas (CAE) — facturación desacoplada del cobro

```sql
create table ps_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  obligation_id uuid references ps_obligations(id),   -- reemplaza incomeId / 'auto:<proj>:<month>'
  client_id uuid references ps_clients(id),
  cae text, cae_expiry date,
  cbte_tipo int, pto_vta int, number int,
  type_name text,                                      -- 'Factura C'
  issued_on date, issued_at timestamptz, issued_by uuid,
  amount numeric(16,4) not null, currency text default 'ARS',
  doc_type int, doc_number text,
  billing_status text default 'ISSUED',                -- DRAFT/ISSUED/VOID (indep. del cobro)
  voided boolean default false,
  snapshot_company jsonb,                              -- copia histórica (emisor) al emitir
  legacy_income_id text
);
```

El **estado de cobro** vive en `ps_payments`/`ps_obligations`; el **estado de facturación** vive
aquí. `canEmitInvoice` = `cobrado(obligación) − facturado(obligación) > 0.5` — igual que hoy
(`invoices.js`). Soporta **facturo→cobro** (factura sobre obligación OPEN) y **cobro→facturo**
(factura tras pagos). `voided` se conserva (soft-delete; no lo re-cuenta `getAllInvoicesFor`).

---

## 4. Marketing (Fase 6)

```sql
create table ps_content_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references ps_organizations(id),
  title text, idea text, draft text,
  platform text,                      -- destino
  status text default 'IDEA',         -- IDEA/DRAFT/REVIEW/APPROVED/PUBLISHED
  publish_date date, responsible_user_id uuid references ps_app_users(id),
  resources jsonb,                    -- archivos/links asociados
  campaign text,                      -- enlazable con opportunities.source
  created_at timestamptz default now()
);
```

---

## 5. Mapeo exacto: logs actuales → `ps_obligations` / `ps_payments`

Transformación determinística, fila por fila (preserva números byte a byte):

| Origen (blob) | → Obligación | → Pago(s) |
|---|---|---|
| `incomes[]` (manual) | 1 receivable (`amount`/`currency`/`date`, `legacy_ref=income.id`) | cada `incomePayments[]` de ese id → 1 pago (`amount`, `original_currency = p.currency ?? income.currency`, `paid_on = p.date`, `exchange_rate = p.exchangeRate`) |
| `incomes[]` **CONFIRMED sin** `incomePayments` | mismo receivable | **1 pago sintético** `amount=income.amount`, `exchange_rate = income.exchangeRateAtTime ?? state.exchangeRate`, `paid_on = confirmedAt ?? date`, `is_synthetic=true` |
| `expenses[]` / `expensePayments[]` | 1 payable | igual patrón; PAID-sin-log → pago sintético |
| Proyecto `ACTIVE_RECURRING` + `monthlyFee` | `ps_recurring_services` (receivable) | — |
| `recurringChargeLog[]` `{projectId,month,amount?,exchangeRate}` | obligación `(service,period=month)` por upsert; `amount = r.amount ?? project.monthlyFee` | pago `amount`, `original_currency = r.currency ?? project.monthlyFeeCurrency`, `paid_on = r.date ?? chargedAt`, `exchange_rate = r.exchangeRate` |
| Gasto `FIXED recurring` | `ps_recurring_services` (payable) | — |
| `recurringExpensePayments[]` | obligación `(service,period)` | pago, `paid_on = r.date ?? paidAt`, `exchange_rate = r.exchangeRate` |
| `invoices[]` | resuelve `obligation_id` (manual por `legacy_ref`; auto por `(service,period)` desde `auto:<proj>:<month>`) | — (`incomeId` → `legacy_income_id`) |

Reglas de fidelidad (tomadas del código, no inventadas):
- **Fallback de monto**: `r.amount != null ? r.amount : esperado`.
- **Cadena de tasa**: `p.exchangeRate || item.exchangeRateAtTime || state.exchangeRate || 1200`.
- **Preferencia de fecha**: `date` sobre `paidAt`/`chargedAt`.
- **Sintético = pago completo** a la tasa congelada/actual.

Un **validador de migración** reimplementa `getAllCashFlowPayments` + `getPaymentSummary` sobre las
tablas nuevas y exige igualdad con el cómputo del blob (ver [`ROADMAP.md`](ROADMAP.md) §Integridad).

---

## 6. Correspondencia blob ↔ relacional (referencia rápida)

| Colección del blob | Destino relacional | Fase |
|---|---|---|
| `clients[]` | `ps_clients` (+ `ps_contacts`) | 3 |
| `budgets[]` | `ps_budgets` + `ps_budget_items` | 3 |
| `incomes[]`, `incomePayments[]` | `ps_obligations(receivable)` + `ps_payments` | 2 |
| `expenses[]`, `expensePayments[]` | `ps_obligations(payable)` + `ps_payments` | 2 |
| `recurringChargeLog[]`, `recurringExpensePayments[]` | `ps_recurring_services` + obligaciones/pagos | 2 |
| `invoices[]` | `ps_invoices` | 2–3 |
| `projects[]`, `tasks[]`, `comments[]`, `history[]`, `notifications[]`, `documents[]`, `resources[]` | permanecen en `ps_org_state` (blob por-org) hasta fase que los normalice (o indefinidamente, tras repositorio) | — |
| escalares (`exchangeRate`, plantillas, `emailConfig`) | `ps_org_fiscal_config` / `ps_org_state` / config de empresa | 1–2 |
