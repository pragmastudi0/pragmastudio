#!/usr/bin/env node
// ============================================================================
// seed-org1.mjs  ·  Fase 1 — Siembra de la organización #1 (Pragma Studio)
// ----------------------------------------------------------------------------
// Transforma el export JSON del estado actual (single-tenant) en:
//   - 1 fila en ps_organizations (Pragma)
//   - 1 fila en ps_org_state (el MISMO documento jsonb, por org_id)
//   - ps_app_users + ps_memberships para los usuarios conocidos (si existen en Auth)
//   - ps_org_fiscal_config con los datos fiscales de Pragma (Factura C)
//
// INSERT-ONLY: nunca muta el proyecto de ORIGEN. Idempotente (upsert por clave).
// Sin dependencias npm nuevas: usa fetch nativo (Node 20) contra la REST de Supabase.
//
// Uso:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_KEY=<service_role_key> \
//   node scripts/seed-org1.mjs [ruta-al-export.json]
//
// El export se obtiene con el botón "Exportar" de la app (exportData()) o con
// un pg_dump de la fila pragma_state id='main' (campo data).
//
// PREFIJO: si cambiaste el prefijo de tablas en las migraciones, ajustá PREFIX.
// ============================================================================

import { readFileSync } from 'node:fs';

const PREFIX = 'ps_';
const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const INPUT = process.argv[2] || './export.json';

const ORG = { name: 'Pragma Studio', slug: 'pragma-studio', legal_name: 'Pragma Studio' };

// Datos fiscales de Pragma tomados del comprobante actual (Factura C / Monotributo).
const FISCAL = {
  cuit: 20424402142,
  point_of_sale: 3,
  afip_production: true,
  default_cbte_tipo: 11,
  condicion_fiscal: 'Monotributo',
  issuer_name: 'Gaspar Quintana Ruiz',
};

// Mapeo email → (rol, legacy_member_id) — espejo de MEMBER_MAP en src/services/auth.js.
const KNOWN_USERS = {
  'gonbenedetto1@gmail.com':   { role: 'org_admin', legacyMemberId: 'me' },
  'gasparquintana00@gmail.com':{ role: 'operative', legacyMemberId: 'gaspar' },
  'faculamosimo@gmail.com':    { role: 'operative', legacyMemberId: 'facundo' },
};

function die(msg) { console.error('✗ ' + msg); process.exit(1); }
if (!URL || !SERVICE_KEY) die('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY en el entorno.');

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function findAuthUserByEmail(email) {
  // Auth Admin API. Filtra por email del lado cliente (lista paginada).
  const res = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers });
  if (!res.ok) throw new Error(`auth admin → ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const users = data.users || data || [];
  return users.find(u => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

function loadState() {
  let raw;
  try { raw = readFileSync(INPUT, 'utf8'); }
  catch { die(`No pude leer el export en "${INPUT}". Pasá la ruta como argumento.`); }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { die('El export no es JSON válido.'); }
  // Acepta { data: {...} } o el objeto state directo.
  const state = parsed && parsed.data && parsed.data.members ? parsed.data : parsed;
  if (!state || !Array.isArray(state.members)) die('El export no tiene la forma esperada (members[]).');
  return state;
}

function integrityReport(state) {
  const n = (a) => Array.isArray(a) ? a.length : 0;
  const sumFrozen = (logs, cur) => (logs || []).reduce((acc, p) => {
    const rate = Number(p.exchangeRate) || Number(state.exchangeRate) || 1200;
    const amt = Number(p.amount);
    if (!Number.isFinite(amt)) return acc;            // montos sin importe → fallback, no sumables aquí
    const c = p.currency || 'ARS';
    if (c === cur) return acc + amt;
    return acc + (cur === 'ARS' ? amt * rate : amt / rate);
  }, 0);
  console.log('\n── Reporte de integridad (conteos del export) ──');
  for (const k of ['members','projects','tasks','clients','budgets','incomes','expenses',
                   'invoices','incomePayments','expensePayments','recurringChargeLog',
                   'recurringExpensePayments']) {
    console.log(`  ${k.padEnd(26)} ${n(state[k])}`);
  }
  console.log(`  exchangeRate (actual)      ${state.exchangeRate}`);
  console.log('  nota: la verificación autoritativa de saldos a tasa congelada es');
  console.log('        tests/finance-characterization.test.js sobre este mismo export.');
  console.log('────────────────────────────────────────────────\n');
}

async function main() {
  const state = loadState();
  integrityReport(state);

  // 1. Organización (upsert por slug).
  const [org] = await rest(`${PREFIX}organizations?on_conflict=slug`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [ORG],
  });
  console.log(`✓ Organización: ${org.name} (${org.id})`);

  // 2. Documento por organización (upsert por org_id).
  await rest(`${PREFIX}org_state?on_conflict=org_id`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: [{ org_id: org.id, data: state, writer: 'seed' }],
  });
  console.log('✓ ps_org_state sembrado (documento completo preservado).');

  // 3. Config fiscal (upsert por org_id). Secretos cert/key quedan null:
  //    Pragma sigue usando las env vars AFIP actuales como fallback en Fase 1.
  await rest(`${PREFIX}org_fiscal_config?on_conflict=org_id`, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: [{ org_id: org.id, ...FISCAL }],
  });
  console.log('✓ ps_org_fiscal_config sembrado (Factura C, secretos por env fallback).');

  // 4. Usuarios + membresías (sólo los que ya existan en Auth del proyecto nuevo).
  for (const [email, def] of Object.entries(KNOWN_USERS)) {
    const authUser = await findAuthUserByEmail(email).catch(e => { console.warn(`  ! auth lookup ${email}: ${e.message}`); return null; });
    if (!authUser) {
      console.warn(`  ⚠ ${email}: sin usuario en Auth todavía — crealo/invitalo y re-corré la siembra.`);
      continue;
    }
    const member = (state.members || []).find(m => m.id === def.legacyMemberId) || {};
    await rest(`${PREFIX}app_users?on_conflict=id`, {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: [{ id: authUser.id, email, full_name: member.name || null, avatar_color: member.color || '#6b7280' }],
    });
    await rest(`${PREFIX}memberships?on_conflict=org_id,user_id`, {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: [{
        org_id: org.id, user_id: authUser.id, role: def.role,
        legacy_member_id: def.legacyMemberId, display_name: member.name || null,
        color: member.color || null, accepted_at: new Date().toISOString(),
      }],
    });
    console.log(`✓ Membresía: ${email} → ${def.role} (legacy=${def.legacyMemberId})`);
  }

  console.log('\n✔ Siembra completa. Verificá en la app que Pragma muestre los mismos totales.');
}

main().catch(e => die(e.message));
