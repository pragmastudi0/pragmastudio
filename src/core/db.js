// ============ DB / TENENCIA (Fase 1 SaaS) ============
// Nombres de tabla centralizados. Si cambiás el prefijo en las migraciones SQL
// (supabase/migrations/ps_0001_tenancy.sql) y en scripts/seed-org1.mjs, cambialo
// acá también — es el ÚNICO punto del frontend que lo referencia.
export const TABLE_PREFIX = 'ps_';

export const TABLES = {
  appUsers:      `${TABLE_PREFIX}app_users`,
  organizations: `${TABLE_PREFIX}organizations`,
  memberships:   `${TABLE_PREFIX}memberships`,
  orgState:      `${TABLE_PREFIX}org_state`,
  fiscalConfig:  `${TABLE_PREFIX}org_fiscal_config`,
};

// Nombre del RPC que crea una organización + primera membresía (SECURITY DEFINER).
export const RPC_CREATE_ORG = `${TABLE_PREFIX}create_organization`;
