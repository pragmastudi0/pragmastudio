const { verifyAuth } = require('../../lib/afip-helpers');

// GET /api/email/estado
// Healthcheck: confirma que el server tiene configurado Gmail (sin exponer la contraseña).
module.exports = async function handler(req, res) {
  const auth = await verifyAuth(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  return res.status(200).json({
    configured: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    gmailUser: process.env.GMAIL_USER || null,
  });
};
