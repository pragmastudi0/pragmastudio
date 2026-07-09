const nodemailer = require('nodemailer');
const { verifyAuth } = require('../../lib/afip-helpers');

// POST /api/email/enviar-factura
// Body: { to, subject, body, pdfBase64, filename }
// Envía la factura por email vía Gmail (SMTP con App Password). Requiere sesión Supabase.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const auth = await verifyAuth(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return res.status(500).json({ error: 'Gmail no está configurado en el servidor (faltan GMAIL_USER / GMAIL_APP_PASSWORD).' });
  }

  const { to, subject, body, pdfBase64, filename } = req.body || {};
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to))) {
    return res.status(400).json({ error: 'Email de destino inválido' });
  }
  if (!pdfBase64) {
    return res.status(400).json({ error: 'Falta el PDF adjunto' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });

    const info = await transporter.sendMail({
      from: `Pragma Studio <${user}>`,
      to: String(to),
      subject: subject || 'Factura · Pragma Studio',
      text: body || 'Adjuntamos tu factura.',
      attachments: [{
        filename: filename || 'Factura.pdf',
        content: Buffer.from(String(pdfBase64), 'base64'),
        contentType: 'application/pdf',
      }],
    });

    return res.status(200).json({ ok: true, messageId: info.messageId, accepted: info.accepted });
  } catch (err) {
    console.error('Gmail send error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
};
