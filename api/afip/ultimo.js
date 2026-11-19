const { verifyAuth, requireOrgMembership, getAfipClient } = require('../../lib/afip-helpers');

// GET /api/afip/ultimo?tipo=11
// Devuelve el último número emitido en el PV para el tipo de comprobante dado.
module.exports = async function handler(req, res) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const orgId = req.headers['x-org-id'] || null;
  if (orgId) {
    const member = await requireOrgMembership(auth.user.id, orgId);
    if (!member.ok) return res.status(403).json({ error: member.error });
  }

  const cbteTipo = Number(req.query?.tipo) || 11;

  let afip, ptoVta;
  try {
    const client = await getAfipClient(orgId);
    afip = client.afip;
    ptoVta = client.ptoVta;
  } catch (e) { return res.status(500).json({ error: e.message }); }

  try {
    const last = await afip.ElectronicBilling.getLastVoucher(ptoVta, cbteTipo);
    return res.status(200).json({ ptoVta, cbteTipo, lastNumber: last || 0 });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
};
