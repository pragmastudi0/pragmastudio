const Afip = require('@afipsdk/afip.js');

// Prefijo de tablas (debe coincidir con supabase/migrations y src/core/db.js).
const PREFIX = process.env.PS_TABLE_PREFIX || 'ps_';

// Verifica el JWT de Supabase Auth usando fetch directo a la API REST
// (evita @supabase/supabase-js que requiere WebSocket nativo en Node 22+)
async function verifyAuth(req) {
  const auth = req.headers?.authorization;
  if (!auth) return { ok: false, error: 'Sin token de autenticación' };
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { ok: false, error: 'Supabase no está configurado en el servidor' };
  }
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: process.env.SUPABASE_SERVICE_KEY,
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `Token inválido o expirado (${res.status}) ${txt}` };
    }
    const user = await res.json();
    if (!user || !user.id) return { ok: false, error: 'Token inválido' };
    return { ok: true, user };
  } catch (e) {
    return { ok: false, error: 'Error verificando auth: ' + e.message };
  }
}

// Helper REST con service key (bypass RLS deliberado — el server ya validó auth).
async function restGet(path) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`REST ${path} → ${res.status}`);
  return res.json();
}

// Verifica que el usuario sea miembro de la organización (o platform_admin).
// Devuelve { ok, role } o { ok:false, error }.
async function requireOrgMembership(userId, orgId) {
  if (!orgId) return { ok: false, error: 'Falta la organización (X-Org-Id)' };
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return { ok: false, error: 'Supabase no está configurado en el servidor' };
  }
  try {
    const rows = await restGet(`${PREFIX}memberships?user_id=eq.${userId}&org_id=eq.${orgId}&select=role`);
    if (Array.isArray(rows) && rows.length > 0) return { ok: true, role: rows[0].role };
    const admins = await restGet(`${PREFIX}app_users?id=eq.${userId}&is_platform_admin=eq.true&select=id`);
    if (Array.isArray(admins) && admins.length > 0) return { ok: true, role: 'platform_admin' };
    return { ok: false, error: 'El usuario no pertenece a esta organización' };
  } catch (e) {
    return { ok: false, error: 'Error verificando organización: ' + e.message };
  }
}

async function getOrgFiscalConfig(orgId) {
  if (!orgId) return null;
  try {
    const rows = await restGet(`${PREFIX}org_fiscal_config?org_id=eq.${orgId}&select=*`);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch { return null; }
}

// Inicializa el cliente AFIP.
//  - Sin orgId: usa las env vars globales (comportamiento actual — Pragma).
//  - Con orgId: toma CUIT/PtoVta/producción de ps_org_fiscal_config si existen.
//    Fase 1: los secretos (cert/key) siguen viniendo de env vars como fallback;
//    el almacenamiento de cert/key cifrados por organización se implementa luego.
async function getAfipClient(orgId) {
  const fiscal = orgId ? await getOrgFiscalConfig(orgId) : null;

  const cuit = fiscal?.cuit != null ? Number(fiscal.cuit) : Number(process.env.AFIP_CUIT);
  const ptoVta = fiscal?.point_of_sale != null ? Number(fiscal.point_of_sale) : Number(process.env.AFIP_POINT_OF_SALE);
  const production = fiscal ? !!fiscal.afip_production : (process.env.AFIP_PRODUCTION === 'true');

  // Secretos: en Fase 1 sólo desde env (cert/key cifrados por org = fase posterior).
  const required = ['AFIP_CERT', 'AFIP_KEY'];
  for (const k of required) {
    if (!process.env[k]) throw new Error(`Falta variable de entorno: ${k}`);
  }
  if (!Number.isFinite(cuit)) throw new Error('Falta CUIT (ps_org_fiscal_config o AFIP_CUIT)');
  if (!Number.isFinite(ptoVta)) throw new Error('Falta punto de venta (ps_org_fiscal_config o AFIP_POINT_OF_SALE)');

  const cert = Buffer.from(process.env.AFIP_CERT, 'base64').toString('utf8');
  const key  = Buffer.from(process.env.AFIP_KEY,  'base64').toString('utf8');
  const tag = orgId ? String(orgId).slice(0, 8) : 'default';
  const config = {
    CUIT: cuit,
    cert,
    key,
    production,
    // /tmp por organización: el ticket de acceso de 12h nunca cruza inquilinos.
    res_folder: `/tmp/afip-${tag}-res/`,
    ta_folder:  `/tmp/afip-${tag}-ta/`,
  };
  if (process.env.AFIP_SDK_TOKEN) config.access_token = process.env.AFIP_SDK_TOKEN;
  return { afip: new Afip(config), ptoVta, cuit, production, fiscal };
}

module.exports = { verifyAuth, requireOrgMembership, getAfipClient, getOrgFiscalConfig };
