-- ============================================================================
-- ps_0001_tenancy_down.sql  ·  Reversión de ps_0001_tenancy.sql
-- ----------------------------------------------------------------------------
-- Elimina la estructura de tenencia. NO destruye datos de origen: el estado
-- single-tenant original vive en OTRO proyecto Supabase (pragma_state 'main').
-- Correr sólo para revertir la Fase 1 en el proyecto NUEVO.
-- ============================================================================

do $$ begin
  alter publication supabase_realtime drop table ps_org_state;
exception when undefined_object then null; end $$;

drop trigger if exists ps_on_auth_user_created on auth.users;

drop function if exists ps_handle_new_user();
drop function if exists ps_create_organization(text, text);
drop function if exists ps_auth_is_member(uuid);
drop function if exists ps_auth_is_org_admin(uuid);

drop table if exists ps_org_fiscal_config;
drop table if exists ps_org_state;
drop table if exists ps_memberships;
drop table if exists ps_organizations;
drop table if exists ps_app_users;

do $$ begin
  drop type ps_org_role;
exception when undefined_object then null; end $$;
