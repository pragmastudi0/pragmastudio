// ============ FACTURACIÓN — Envío por email (Gmail vía serverless) ============

// Formatos locales (evitan colisiones con helpers de otros módulos).
function _invMoney(n) { return `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function _invDate(s) {
  if (!s) return '—';
  if (s.length === 8) return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`; // AFIP YYYYMMDD
  return s;
}

// Variables disponibles en la plantilla del email de factura.
const INVOICE_EMAIL_VARS = [
  { key: 'code',        label: 'N° comprobante', resolve: (inv) => inv.code || '' },
  { key: 'clientName',  label: 'Cliente',        resolve: (inv) => inv.clientName || '' },
  { key: 'amount',      label: 'Monto',          resolve: (inv) => `${_invMoney(inv.amount)} ARS` },
  { key: 'cae',         label: 'CAE',            resolve: (inv) => inv.cae || '' },
  { key: 'date',        label: 'Fecha',          resolve: (inv) => _invDate(inv.date) },
  { key: 'projectName', label: 'Proyecto',       resolve: (inv) => inv._projectName || '' },
  { key: 'docNumber',   label: 'Doc. cliente',   resolve: (inv) => inv.clientDocNumber ? String(inv.clientDocNumber) : '' },
];

function _applyInvoiceVars(tpl, invoice) {
  let s = tpl || '';
  INVOICE_EMAIL_VARS.forEach(v => {
    // Función como reemplazo: evita interpretar $ como backreference de regex.
    s = s.replace(new RegExp(`\\{${v.key}\\}`, 'g'), () => String(v.resolve(invoice) ?? ''));
  });
  return s;
}
function buildInvoiceEmailSubject(invoice) { return _applyInvoiceVars(state.invoiceEmailSubject || '', invoice); }
function buildInvoiceEmailBody(invoice) { return _applyInvoiceVars(state.invoiceEmailTemplate || '', invoice); }

// ---- Modal de envío (revisión manual) ----
let _sendInvoiceCurrent = null;

function openSendInvoiceEmailModal(invoice) {
  _sendInvoiceCurrent = invoice;
  const subject = buildInvoiceEmailSubject(invoice);
  const body = buildInvoiceEmailBody(invoice);
  openModal(`
    <div class="p-6">
      <div class="flex items-center gap-2 mb-1">
        <span class="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22,6 12,13 2,6"/><path d="M2 6h20v12H2z"/></svg>
        </span>
        <h2 class="text-xl font-semibold">Enviar factura por email</h2>
      </div>
      <p class="text-sm text-gray-500 mb-4">Factura <b>${escapeHtml(invoice.code || '')}</b>${invoice.clientName ? ` · ${escapeHtml(invoice.clientName)}` : ''}</p>

      <div class="space-y-3">
        <div>
          <label class="text-xs text-gray-500">Para</label>
          <input type="email" id="invEmailTo" class="input" value="${escapeAttr(invoice.clientEmail || '')}" placeholder="cliente@empresa.com" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Asunto</label>
          <input id="invEmailSubject" class="input" value="${escapeAttr(subject)}" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Mensaje</label>
          <textarea id="invEmailBody" class="input" rows="8" style="white-space:pre-wrap">${escapeHtml(body)}</textarea>
        </div>
        <div class="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 flex items-center gap-2">
          <span>📎</span> Se adjuntará el PDF de la factura <b>${escapeHtml(invoice.code || '')}</b>.
        </div>
        <div id="invEmailError" class="hidden bg-red-50 border border-red-200 text-red-800 text-xs rounded-lg p-3"></div>
      </div>

      <div class="flex items-center gap-2 mt-3 text-xs text-gray-500">
        <button type="button" onclick="closeModal(); go('team')" class="text-blue-600 hover:underline">✎ Editar plantilla para próximas</button>
      </div>

      <div class="flex justify-end gap-2 pt-4 border-t border-gray-100 mt-4">
        <button type="button" onclick="closeModal()" class="btn-ghost">Cancelar</button>
        <button type="button" id="invEmailSendBtn" class="btn-primary" onclick="sendInvoiceEmail()">Enviar</button>
      </div>
    </div>
  `);
}

function _invEmailError(msg) {
  const box = document.getElementById('invEmailError');
  if (box) { box.textContent = msg; box.classList.remove('hidden'); }
}

async function sendInvoiceEmail() {
  const invoice = _sendInvoiceCurrent;
  if (!invoice) return;
  const toEl = document.getElementById('invEmailTo');
  const to = (toEl?.value || '').trim();
  const subject = document.getElementById('invEmailSubject')?.value || '';
  const body = document.getElementById('invEmailBody')?.value || '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { _invEmailError('Ingresá un email válido.'); return; }

  const btn = document.getElementById('invEmailSendBtn');
  const setLoading = (on, txt) => { if (btn) { btn.disabled = on; btn.textContent = on ? (txt || 'Enviando…') : 'Enviar'; } };

  // 1) Generar el PDF en el navegador
  setLoading(true, 'Generando PDF…');
  let pdfBase64;
  try {
    pdfBase64 = await generateInvoicePdfBase64(invoice);
  } catch (e) {
    setLoading(false);
    if (e && e.message === 'LIBS_MISSING') {
      showToast('No se pudo generar el PDF (librerías no disponibles). Se abre la descarga manual.', 'info', 5000);
      openInvoicePdf(invoice);
    } else {
      console.error('PDF gen error:', e);
      _invEmailError('Error generando el PDF: ' + (e?.message || e));
    }
    return;
  }

  // 2) Enviar vía función serverless (Gmail)
  setLoading(true, 'Enviando…');
  try {
    const filename = `Factura_${invoice.code || 'C'}.pdf`.replace(/[^\w.\-]/g, '_');
    await callApi('/api/email/enviar-factura', { method: 'POST', body: { to, subject, body, pdfBase64, filename } });
    showToast('✓ Factura enviada a ' + to, 'success', 5000);
    closeModal();
  } catch (e) {
    setLoading(false);
    _invEmailError('No se pudo enviar: ' + (e?.message || e));
  }
}

// ---- Generación del PDF como base64 (reusa el HTML de la factura) ----
async function generateInvoicePdfBase64(invoice) {
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (typeof html2canvas === 'undefined' || !jsPDFCtor) {
    throw new Error('LIBS_MISSING');
  }
  const { html, qrImg } = buildInvoicePdfHtml(invoice);

  // Pre-cargar el QR como dataURL para evitar canvas "tainted" (qrserver soporta CORS).
  let qrDataUrl = '';
  try {
    const resp = await fetch(qrImg);
    const blob = await resp.blob();
    qrDataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  } catch (_) { /* si falla el QR seguimos igual (solo faltaría esa imagen) */ }

  // Parsear el HTML, reemplazar el QR y quitar la barra de acciones.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (qrDataUrl) { const img = doc.querySelector('.cae-row img'); if (img) img.setAttribute('src', qrDataUrl); }
  const actions = doc.querySelector('.actions'); if (actions) actions.remove();
  const styles = [...doc.querySelectorAll('style')].map(s => s.outerHTML).join('');
  const wrap = doc.querySelector('.wrap');

  // Render off-screen.
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-99999px;top:0;width:820px;background:#ffffff;';
  container.innerHTML = styles + (wrap ? wrap.outerHTML : doc.body.innerHTML);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDFCtor('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = canvas.height * imgW / canvas.width;
    if (imgH <= pageH) {
      pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);
    } else {
      let position = 0, remaining = imgH;
      while (remaining > 0) {
        pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
        remaining -= pageH;
        if (remaining > 0) { pdf.addPage(); position -= pageH; }
      }
    }
    const dataUri = pdf.output('datauristring'); // data:application/pdf;base64,....
    return dataUri.split(',')[1];
  } finally {
    document.body.removeChild(container);
  }
}

// ============ Configuración: plantilla del email de factura (vista Equipo) ============
function renderInvoiceEmailSettings() {
  const sampleInvoice = {
    code: '00003-00000012',
    clientName: 'Galo Wines S.A.',
    amount: 150000,
    cae: '75123456789012',
    date: (function () { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; })(),
    _projectName: 'Sitio institucional',
    clientDocNumber: '30712345678',
  };
  const previewSubject = buildInvoiceEmailSubject(sampleInvoice);
  const previewBody = buildInvoiceEmailBody(sampleInvoice);
  return `
    <div class="card p-5">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="font-semibold">Email de factura</h3>
          <p class="text-xs text-gray-500 mt-0.5">Plantilla y envío del PDF al cliente vía Gmail</p>
        </div>
      </div>

      <details class="text-sm text-gray-600 mb-4">
        <summary class="cursor-pointer text-blue-600 hover:underline">¿Cómo habilitar el envío por Gmail? (una vez)</summary>
        <ol class="list-decimal pl-5 mt-2 space-y-1 text-xs">
          <li>Activá la <b>verificación en 2 pasos</b> en tu cuenta de Google.</li>
          <li>Generá una <b>Contraseña de aplicación</b> (Google → Seguridad → Contraseñas de aplicaciones).</li>
          <li>En Vercel (Project → Settings → Environment Variables) cargá <code>GMAIL_USER</code> (tu email) y <code>GMAIL_APP_PASSWORD</code> (la contraseña de aplicación, sin espacios).</li>
          <li>Redeploy. Listo: el botón "Enviar por email" de la pantalla de factura queda operativo.</li>
        </ol>
      </details>

      <form onsubmit="saveInvoiceEmailSettings(event)" class="space-y-3">
        <div>
          <label class="text-xs text-gray-500">Asunto</label>
          <input name="invoiceEmailSubject" class="input font-mono text-xs" value="${escapeAttr(state.invoiceEmailSubject || '')}" oninput="updateInvoiceEmailPreview()" id="invTplSubject" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Cuerpo del email</label>
          <textarea id="invTplTextarea" name="invoiceEmailTemplate" class="input font-mono text-xs" rows="7" oninput="updateInvoiceEmailPreview()">${escapeHtml(state.invoiceEmailTemplate || '')}</textarea>
          <p class="text-[11px] text-gray-500 mt-1.5 mb-2">Click una variable para insertarla en el cursor:</p>
          <div class="flex flex-wrap gap-1.5">
            ${INVOICE_EMAIL_VARS.map(v => `
              <button type="button" onclick="insertInvoiceVar('${v.key}')" class="chip bg-purple-50 text-purple-700 hover:bg-purple-100 cursor-pointer border border-purple-200" title="${v.label}">
                <span class="font-mono">{${v.key}}</span>
                <span class="text-purple-500 text-[10px]">${v.label}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="bg-gray-50 rounded-lg p-3">
          <div class="text-xs text-gray-500 mb-1.5 uppercase tracking-wider font-semibold">Vista previa</div>
          <div class="text-xs text-gray-500">Asunto: <span id="invTplPreviewSubject" class="text-gray-800 font-medium">${escapeHtml(previewSubject)}</span></div>
          <div id="invTplPreviewBody" class="text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed mt-1.5">${escapeHtml(previewBody)}</div>
          <div class="text-[11px] text-gray-400 mt-2">Con datos de ejemplo</div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
      </form>
    </div>
  `;
}

function insertInvoiceVar(key) {
  const ta = document.getElementById('invTplTextarea');
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const text = `{${key}}`;
  ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + text.length;
  updateInvoiceEmailPreview();
}

function updateInvoiceEmailPreview() {
  const sub = document.getElementById('invTplSubject');
  const ta = document.getElementById('invTplTextarea');
  const pSub = document.getElementById('invTplPreviewSubject');
  const pBody = document.getElementById('invTplPreviewBody');
  const sampleInvoice = {
    code: '00003-00000012', clientName: 'Galo Wines S.A.', amount: 150000, cae: '75123456789012',
    date: (function () { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; })(),
    _projectName: 'Sitio institucional', clientDocNumber: '30712345678',
  };
  if (pSub && sub) pSub.textContent = _applyInvoiceVars(sub.value, sampleInvoice);
  if (pBody && ta) pBody.textContent = _applyInvoiceVars(ta.value, sampleInvoice);
}

function saveInvoiceEmailSettings(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  state.invoiceEmailSubject = data.invoiceEmailSubject || '';
  state.invoiceEmailTemplate = data.invoiceEmailTemplate || '';
  save();
  showToast('Plantilla de email guardada', 'success');
  render();
}
