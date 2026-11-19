const { verifyAuth, requireOrgMembership, getAfipClient } = require('../../lib/afip-helpers');

// GET /api/afip/estado
// Healthcheck: confirma que el server tiene cert/key/PV y que AFIP responde.
module.exports = async function handler(req, res) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const orgId = req.headers['x-org-id'] || null;
  if (orgId) {
    const member = await requireOrgMembership(auth.user.id, orgId);
    if (!member.ok) return res.status(403).json({ error: member.error });
  }

  const status = {
    envVars: {
      AFIP_CUIT: !!process.env.AFIP_CUIT,
      AFIP_CERT: !!process.env.AFIP_CERT,
      AFIP_KEY: !!process.env.AFIP_KEY,
      AFIP_POINT_OF_SALE: !!process.env.AFIP_POINT_OF_SALE,
      AFIP_PRODUCTION: process.env.AFIP_PRODUCTION || 'false',
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    },
    cuit: process.env.AFIP_CUIT || null,
    ptoVta: process.env.AFIP_POINT_OF_SALE ? Number(process.env.AFIP_POINT_OF_SALE) : null,
    production: process.env.AFIP_PRODUCTION === 'true',
  };

  // Si todas las env vars están, probar conexión AFIP pidiendo el último nro
  try {
    const { afip, ptoVta } = await getAfipClient(orgId);
    const lastC = await afip.ElectronicBilling.getLastVoucher(ptoVta, 11);
    status.afipConnection = 'ok';
    status.lastFacturaC = lastC || 0;
    status.ptoVta = ptoVta;
  } catch (err) {
    status.afipConnection = 'error';
    status.afipError = err?.message || String(err);
  }

  return res.status(200).json(status);
};
