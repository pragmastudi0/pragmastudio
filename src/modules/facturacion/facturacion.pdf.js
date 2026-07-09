// Arma el HTML completo de la factura (mismo layout para impresión y PDF adjunto).
// Devuelve { html, qrImg } — qrImg se usa para pre-cargar el QR al generar el PDF.
function buildInvoicePdfHtml(invoice) {
  // Fallback: si la factura es vieja y no tiene snapshots, reconstruir desde el income
  if (!invoice._itemConcept || !invoice._projectName) {
    const inc = invoice.incomeId && !invoice.incomeId.startsWith('auto:')
      ? state.incomes.find(i => i.id === invoice.incomeId)
      : null;
    if (inc) {
      invoice._itemConcept = invoice._itemConcept || inc.concept;
      invoice._projectName = invoice._projectName || (inc.projectId ? (getProject(inc.projectId)?.name || '') : '');
    } else if (invoice.projectId) {
      const proj = getProject(invoice.projectId);
      if (proj) invoice._projectName = invoice._projectName || proj.name;
    }
  }
  const fmtMoney = (n) => `$${Number(n).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  const fmtDateAfip = (s) => s && s.length === 8 ? `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}` : (s || '—');
  const fmtDateISO = (s) => {
    if (!s) return '—';
    const [y,m,d] = s.split('-');
    return `${d}/${m}/${y}`;
  };
  const docTypeMap = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI', 99: 'Consumidor Final' };
  const docTypeLabel = docTypeMap[invoice.clientDocType] || 'Consumidor Final';
  const docNumber = invoice.clientDocType === 99 ? '—' : (invoice.clientDocNumber || '—');
  const clientName = invoice.clientName || (invoice.clientDocType === 99 ? 'Consumidor Final' : 'Sin especificar');
  // Condición IVA del receptor: usa el código guardado; facturas viejas caen a una heurística por doc.
  const condLabel = CONDICION_IVA_LABELS[invoice.condicionIVAReceptorId] || (invoice.clientDocType === 99 ? 'Consumidor Final' : 'Responsable Inscripto');
  const concept = invoice._concept || 2;
  const conceptLabel = concept === 1 ? 'Productos' : concept === 3 ? 'Productos y Servicios' : 'Servicios';
  let detalle = invoice._itemConcept || 'Servicios profesionales';
  if (invoice._projectName) detalle += ` — ${invoice._projectName}`;

  // AFIP QR data (formato oficial): JSON base64
  const qrData = {
    ver: 1,
    fecha: invoice.date ? `${invoice.date.slice(0,4)}-${invoice.date.slice(4,6)}-${invoice.date.slice(6,8)}` : '',
    cuit: 20424402142,
    ptoVta: invoice.ptoVta,
    tipoCmp: invoice.cbteTipo,
    nroCmp: invoice.number,
    importe: Number(invoice.amount),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: invoice.clientDocType || 99,
    nroDocRec: Number(invoice.clientDocNumber || 0),
    tipoCodAut: 'E',
    codAut: Number(invoice.cae) || 0,
  };
  const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${btoa(JSON.stringify(qrData))}`;
  // QR como imagen (usa el servicio público de Google para generar el QR)
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}`;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(invoice.code)} · Factura C</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; padding: 0; font-size: 12px; line-height: 1.45; }
  .wrap { max-width: 800px; margin: 0 auto; }
  .head { display: grid; grid-template-columns: 1fr auto 1fr; border: 2px solid #111; border-bottom: 1px solid #111; }
  .emisor { padding: 16px; }
  .emisor h1 { margin: 0 0 4px 0; font-size: 18px; font-weight: 700; }
  .letter { border-left: 2px solid #111; border-right: 2px solid #111; padding: 12px 24px; text-align: center; background: #fafafa; }
  .letter .L { font-size: 56px; font-weight: 800; line-height: 1; color: #111; }
  .letter .cod { font-size: 10px; color: #555; margin-top: 4px; }
  .nro { padding: 16px; text-align: right; }
  .nro h2 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: 1px; }
  .nro .meta { font-size: 11px; color: #333; margin-top: 6px; }
  .nro .meta b { color: #111; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 2px solid #111; border-top: none; }
  .col { padding: 10px 16px; }
  .col + .col { border-left: 1px solid #ddd; }
  .label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #666; }
  .val { font-size: 12px; margin-top: 2px; }
  table.items { width: 100%; border-collapse: collapse; border: 2px solid #111; border-top: none; }
  table.items th { background: #f0f0f0; text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #ccc; }
  table.items td { padding: 12px 10px; vertical-align: top; font-size: 12px; }
  table.items td.r { text-align: right; }
  .totales { border: 2px solid #111; border-top: none; padding: 12px 16px; text-align: right; background: #fafafa; }
  .totales .ln { margin: 3px 0; font-size: 12px; }
  .totales .grand { font-size: 16px; font-weight: 700; border-top: 1px solid #111; padding-top: 6px; margin-top: 6px; }
  .cae-row { display: grid; grid-template-columns: 180px 1fr auto; gap: 16px; border: 2px solid #111; border-top: none; padding: 14px 16px; align-items: center; background: #fff; }
  .cae-row img { display: block; }
  .cae-info b { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }
  .footer { font-size: 10px; color: #666; text-align: center; padding: 12px 0; }
  .actions { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; z-index: 100; }
  .actions button { background: #111; color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-size: 13px; font-weight: 500; }
  .actions button.ghost { background: #fff; color: #111; border: 1px solid #ddd; }
  @media print { .actions { display: none; } body { font-size: 11px; } }
</style>
</head>
<body>
<div class="actions">
  <button class="ghost" onclick="window.close()">Cerrar</button>
  <button onclick="window.print()">Imprimir / Guardar PDF</button>
</div>
<div class="wrap">
  <div class="head">
    <div class="emisor">
      <h1>Pragma Studio</h1>
      <div>Gaspar Quintana Ruiz</div>
      <div style="margin-top:6px;font-size:11px;color:#555;">Responsable Monotributo</div>
      <div style="margin-top:6px;font-size:11px;"><b>CUIT:</b> 20-42440214-2</div>
    </div>
    <div class="letter">
      <div class="L">C</div>
      <div class="cod">COD. ${invoice.cbteTipo}</div>
    </div>
    <div class="nro">
      <h2>FACTURA</h2>
      <div class="meta">Pto Vta: <b>${String(invoice.ptoVta).padStart(5,'0')}</b></div>
      <div class="meta">Comprobante Nº: <b>${String(invoice.number).padStart(8,'0')}</b></div>
      <div class="meta">Fecha emisión: <b>${fmtDateAfip(invoice.date)}</b></div>
    </div>
  </div>

  <div class="row">
    <div class="col">
      <div class="label">Cliente</div>
      <div class="val"><b>${escapeHtml(clientName)}</b></div>
      <div class="val">${escapeHtml(docTypeLabel)}: <b>${escapeHtml(String(docNumber))}</b></div>
    </div>
    <div class="col">
      <div class="label">Condición frente al IVA</div>
      <div class="val">${escapeHtml(condLabel)}</div>
      <div class="val" style="margin-top:6px;"><span class="label" style="display:inline">Cond. de venta:</span> Contado / Transferencia</div>
    </div>
  </div>

  ${concept !== 1 ? `
  <div class="row">
    <div class="col">
      <div class="label">Servicio desde</div>
      <div class="val">${fmtDateISO(invoice._serviceFromDate)}</div>
    </div>
    <div class="col" style="grid-template-columns: 1fr 1fr; display:grid;">
      <div style="padding-right:8px;">
        <div class="label">Servicio hasta</div>
        <div class="val">${fmtDateISO(invoice._serviceToDate)}</div>
      </div>
      <div style="border-left:1px solid #ddd; padding-left:16px;">
        <div class="label">Vto. de pago</div>
        <div class="val">${fmtDateISO(invoice._dueDate)}</div>
      </div>
    </div>
  </div>
  ` : ''}

  <table class="items">
    <thead>
      <tr>
        <th style="width:60%">Descripción</th>
        <th class="r" style="width:20%">Cantidad</th>
        <th class="r" style="width:20%">Importe</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><b>${escapeHtml(detalle)}</b><div style="color:#666;font-size:11px;margin-top:2px;">Concepto: ${conceptLabel}</div></td>
        <td class="r">1</td>
        <td class="r">${fmtMoney(invoice.amount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totales">
    <div class="ln">Subtotal: <b>${fmtMoney(invoice.amount)}</b></div>
    <div class="ln" style="color:#666;">IVA: $0,00 <span style="font-size:10px">(Responsable Monotributo)</span></div>
    <div class="ln grand">TOTAL: ${fmtMoney(invoice.amount)}</div>
  </div>

  <div class="cae-row">
    <img src="${qrImg}" alt="QR AFIP" width="180" height="180" />
    <div class="cae-info">
      <div><span class="label" style="display:inline">CAE Nº:</span> <b>${escapeHtml(invoice.cae)}</b></div>
      <div style="margin-top:4px;"><span class="label" style="display:inline">Vto. CAE:</span> <b>${fmtDateAfip(invoice.caeExpiry)}</b></div>
      <div style="margin-top:8px;font-size:10px;color:#666;">Comprobante autorizado por AFIP. Esta factura tiene validez fiscal.</div>
    </div>
    <div style="font-size:10px;color:#777;text-align:center;line-height:1.3;">
      Verificá el<br/>comprobante<br/>escaneando el QR<br/>en afip.gob.ar
    </div>
  </div>

  <div class="footer">Pragma Studio · ${escapeHtml(invoice.code)} · Generado el ${new Date().toLocaleDateString('es-AR')}</div>
</div>
</body>
</html>`;

  return { html, qrImg };
}

function openInvoicePdf(invoice) {
  const { html } = buildInvoicePdfHtml(invoice);
  const w = window.open('', '_blank');
  if (!w) {
    alert('El navegador bloqueó la ventana. Permití pop-ups para descargar el PDF.');
    return;
  }
  w.document.write(html);
  w.document.close();
}

