-- ============================================================================
-- ps_0001_tenancy.sql  ·  Fase 1 — Fundaciones SaaS multiempresa
-- ----------------------------------------------------------------------------
-- Crea la estructura de TENENCIA en un proyecto Supabase NUEVO (base compartida).
-- Reemplaza el modelo single-tenant (pragma_state id='main', RLS abierta) por:
--   organizaciones + usuarios + membresías/roles + documento por organización,
--   con RLS restrictiva por membresía.
--
-- PREFIJO DE TABLAS: todas las tablas/funciones usan el prefijo `ps_`.
--   Para cambiarlo: find/replace  `ps_`  ->  `<nuevo_prefijo>`  en este archivo
--   Y en src/core/db.js (constante TABLES) y scripts/seed-org1.mjs.
--
-- NO aplica a producción automáticamente. Revisar, confirmar prefijo, luego correr.
-- Reversión: ps_0001_tenancy_down.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Perfil de usuario de la app (1:1 con auth.users)
-- ---------------------------------------------------------------------------
create table if not exists ps_app_users (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null unique,
  full_name         text,
  avatar_color      text default '#6b7280',
  is_platform_admin boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Organizaciones
-- ---------------------------------------------------------------------------
create table if not exists ps_organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  legal_name  text,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 3. Roles de organización y membresías
-- ---------------------------------------------------------------------------
do $$ begin
  create type ps_org_role as enum ('org_admin','operative');
exception when duplicate_object then null; end $$;

create table if not exists ps_memberships (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references ps_organizations(id) on delete cascade,
  user_id          uuid not null references ps_app_users(id) on delete cascade,
  role             ps_org_role not null default 'operative',
  legacy_member_id text,
  display_name     text,
  color            text,
  invited_at       timestamptz default now(),
  accepted_at      timestamptz,
  unique (org_id, user_id)
);
create index if not exists ps_memberships_user_idx on ps_memberships(user_id);
create index if not exists ps_memberships_org_idx  on ps_memberships(org_id);

-- ---------------------------------------------------------------------------
-- 4. Documento puente por organización (reemplaza la fila global 'main')
-- ---------------------------------------------------------------------------
create table if not exists ps_org_state (
  org_id     uuid primary key references ps_organizations(id) on delete cascade,
  data       jsonb not null,
  writer     text,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 5. Configuración fiscal por organización (secretos cifrados; sólo org_admin)
-- ---------------------------------------------------------------------------
create table if not exists ps_org_fiscal_config (
  org_id                     uuid primary key references ps_organizations(id) on delete cascade,
  cuit                       bigint,
  point_of_sale              integer,
  afip_production            boolean not null default false,
  default_cbte_tipo          integer not null default 11,   -- 11 = Factura C (Monotributo)
  condicion_fiscal           text,
  issuer_name                text,
  cert_ciphertext            bytea,
  key_ciphertext             bytea,
  afip_sdk_token_ciphertext  bytea,
  updated_at                 timestamptz default now()
);

-- ===========================================================================
-- 6. Funciones de autorización (SECURITY DEFINER) — RLS corta e indexable
-- ===========================================================================
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
                 where m.org_id = target_org and m.user_id = auth.uid()
                   and m.role = 'org_admin')
      or exists (select 1 from ps_app_users u
                 where u.id = auth.uid() and u.is_platform_admin);
$$;

-- ---------------------------------------------------------------------------
-- 7. Alta de usuario (trigger sobre auth.users) + alta de organización atómica
-- ---------------------------------------------------------------------------
create or replace function ps_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into ps_app_users (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ps_on_auth_user_created on auth.users;
create trigger ps_on_auth_user_created
  after insert on auth.users
  for each row execute function ps_handle_new_user();

-- Crea una organización y la primera membresía (caller = org_admin) sin
-- chocar con RLS (chicken-and-egg). Devuelve el org_id.
create or replace function ps_create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'no auth user'; end if;
  insert into ps_app_users (id, email, full_name)
  values (v_uid, coalesce((select email from auth.users where id = v_uid), ''), null)
  on conflict (id) do nothing;
  insert into ps_organizations (name, slug) values (p_name, p_slug) returning id into v_org;
  insert into ps_memberships (org_id, user_id, role, accepted_at)
  values (v_org, v_uid, 'org_admin', now());
  return v_org;
end $$;

-- ===========================================================================
-- 8. Row Level Security
-- ===========================================================================

-- ps_app_users: cada quien su fila; platform_admin todas.
alter table ps_app_users enable row level security;
create policy ps_app_users_self on ps_app_users for select
  using (id = auth.uid()
         or exists (select 1 from ps_app_users u where u.id = auth.uid() and u.is_platform_admin));
create policy ps_app_users_update_self on ps_app_users for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ps_organizations: miembros leen sus orgs; cualquier autenticado puede crear;
-- sólo org_admin modifica/archiva.
alter table ps_organizations enable row level security;
create policy ps_org_read   on ps_organizations for select using (ps_auth_is_member(id));
create policy ps_org_insert on ps_organizations for insert with check (auth.uid() is not null);
create policy ps_org_update on ps_organizations for update
  using (ps_auth_is_org_admin(id)) with check (ps_auth_is_org_admin(id));

-- ps_memberships: co-miembros leen; sólo org_admin escribe (el primer miembro
-- se crea vía ps_create_organization, que es SECURITY DEFINER).
alter table ps_memberships enable row level security;
create policy ps_memb_read   on ps_memberships for select using (ps_auth_is_member(org_id));
create policy ps_memb_insert on ps_memberships for insert with check (ps_auth_is_org_admin(org_id));
create policy ps_memb_update on ps_memberships for update
  using (ps_auth_is_org_admin(org_id)) with check (ps_auth_is_org_admin(org_id));
create policy ps_memb_delete on ps_memberships for delete using (ps_auth_is_org_admin(org_id));

-- ps_org_state: documento de la org, accesible a sus miembros.
alter table ps_org_state enable row level security;
create policy ps_org_state_rw on ps_org_state for all
  using (ps_auth_is_member(org_id)) with check (ps_auth_is_member(org_id));

-- ps_org_fiscal_config: secretos; sólo org_admin.
alter table ps_org_fiscal_config enable row level security;
create policy ps_ofc_read  on ps_org_fiscal_config for select using (ps_auth_is_org_admin(org_id));
create policy ps_ofc_write on ps_org_fiscal_config for all
  using (ps_auth_is_org_admin(org_id)) with check (ps_auth_is_org_admin(org_id));

-- ===========================================================================
-- 9. Realtime: publicar el documento por organización
-- ===========================================================================
do $$ begin
  alter publication supabase_realtime add table ps_org_state;
exception when duplicate_object then null; end $$;
