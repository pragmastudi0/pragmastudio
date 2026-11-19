const { verifyAuth, requireOrgMembership, getAfipClient } = require('../../lib/afip-helpers');

// POST /api/afip/emitir
// Body: {
//   amount: number,                  // monto total (Factura C = todo Neto)
//   concept?: 1|2|3,                 // 1=productos, 2=servicios (default), 3=ambos
//   clientDocType?: 80|86|96|99,     // 80=CUIT, 86=CUIL, 96=DNI, 99=Consumidor Final
//   clientDocNumber?: number|string, // sin guiones
//   serviceFromDate?: 'YYYY-MM-DD',  // requerido si concept != 1
//   serviceToDate?:   'YYYY-MM-DD',
//   dueDate?:         'YYYY-MM-DD',
// }
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const auth = await verifyAuth(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  // Contexto de organización (Fase 1): si el cliente envía X-Org-Id, exigir membresía.
  const orgId = req.headers['x-org-id'] || (req.body && req.body.orgId) || null;
  if (orgId) {
    const member = await requireOrgMembership(auth.user.id, orgId);
    if (!member.ok) return res.status(403).json({ error: member.error });
  }

  const {
    amount,
    concept = 2,
    clientDocType = 99,
    clientDocNumber = 0,
    serviceFromDate,
    serviceToDate,
    dueDate,
  } = req.body || {};

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Monto inválido' });
  }

  // Validación: si docType != 99 (Consumidor Final), exigir docNumber
  if (Number(clientDocType) !== 99 && (!clientDocNumber || Number(clientDocNumber) <= 0)) {
    return res.status(400).json({ error: 'Falta CUIT/DNI del cliente' });
  }

  let afip, ptoVta, cbteTipo;
  try {
    const client = await getAfipClient(orgId);
    afip = client.afip;
    ptoVta = client.ptoVta;
    // Fase 1: Factura C por defecto; el tipo por organización se diseña en ps_org_fiscal_config.
    cbteTipo = (client.fiscal && client.fiscal.default_cbte_tipo) || 11;
  } catch (e) { return res.status(500).json({ error: e.message }); }

  try {

    const lastNumber = await afip.ElectronicBilling.getLastVoucher(ptoVta, cbteTipo);
    const newNumber = (lastNumber || 0) + 1;

    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fmt = (d) => d ? String(d).replace(/-/g, '').slice(0, 8) : todayStr;
    const amt = Number(Number(amount).toFixed(2));

    const data = {
      CantReg: 1,
      PtoVta: ptoVta,
      CbteTipo: cbteTipo,
      Concepto: Number(concept) || 2,
      DocTipo: Number(clientDocType) || 99,
      DocNro: Number(clientDocNumber) || 0,
      CbteDesde: newNumber,
      CbteHasta: newNumber,
      CbteFch: todayStr,
      ImpTotal: amt,
      ImpTotConc: 0,
      ImpNeto: amt,    // Factura C: el total va en ImpNeto
      ImpOpEx: 0,
      ImpIVA: 0,
      ImpTrib: 0,
      MonId: 'PES',
      MonCotiz: 1,
    };

    // Si es servicio o ambos, AFIP exige fechas de servicio + vto de pago
    if (data.Concepto !== 1) {
      data.FchServDesde = fmt(serviceFromDate);
      data.FchServHasta = fmt(serviceToDate);
      data.FchVtoPago = fmt(dueDate);
    }

    const result = await afip.ElectronicBilling.createVoucher(data);

    return res.status(200).json({
      ok: true,
      cae: result.CAE,
      caeExpiry: result.CAEFchVto,
      number: newNumber,
      ptoVta,
      cbteTipo,
      typeName: 'Factura C',
      date: todayStr,
      amount: amt,
      currency: 'PES',
      issuedAt: new Date().toISOString(),
      issuedBy: auth.user.email || null,
      docType: data.DocTipo,
      docNumber: data.DocNro,
    });
  } catch (err) {
    console.error('AFIP error:', err);
    // Saca todo el detalle posible para diagnosticar
    const detail = {
      message: err?.message,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      data: err?.response?.data,
      url: err?.config?.url,
      method: err?.config?.method,
      code: err?.code,
    };
    console.error('AFIP error detail:', JSON.stringify(detail, null, 2));
    return res.status(500).json({
      error: err?.message || 'Error al emitir factura',
      detail,
    });
  }
};
