// ============ Servicio: Email (EmailJS) ============
// Envío de notificaciones/avisos por email vía EmailJS (client-side). Extraído verbatim.
// `emailjs` es un global cargado por CDN desde index.html. Las dependencias del estado y
// helpers se inyectan con initEmail() (patrón de la capa services/).

let _deps = {
  getState: () => ({}),
  getMember: () => null,
  getTask: () => null,
  currentMember: () => null,
  showToast: () => {},
};

export function initEmail(deps) { _deps = { ..._deps, ...deps }; }

export function sendNotificationEmail(forMemberId, taskId, text) {
  const { getState, getMember, getTask, currentMember } = _deps;
  const cfg = getState().emailConfig;
  if (!cfg || !cfg.enabled || !cfg.serviceId || !cfg.templateId || !cfg.publicKey) return;
  const member = getMember(forMemberId);
  if (!member || !member.email) return;
  const task = getTask(taskId);
  const sender = currentMember();
  if (typeof emailjs === 'undefined') return;
  emailjs.send(cfg.serviceId, cfg.templateId, {
    to_email: member.email,
    to_name: member.name,
    from_name: sender?.name || 'Pragma',
    message: text,
    task_title: task?.title || '',
    task_url: window.location.href,
  }, { publicKey: cfg.publicKey }).catch(err => console.warn('EmailJS error:', err));
}

export function testEmail() {
  const { getState, currentMember, showToast } = _deps;
  const me = currentMember();
  if (!me || !me.email) { alert('Cargá un email en tu perfil de miembro primero.'); return; }
  const cfg = getState().emailConfig;
  if (!cfg || !cfg.serviceId || !cfg.templateId || !cfg.publicKey) { alert('Configurá Service ID, Template ID y Public Key primero.'); return; }
  if (typeof emailjs === 'undefined') { alert('EmailJS no cargó. Recargá la página.'); return; }
  showToast('Enviando email de prueba...', 'info', 2000);
  emailjs.send(cfg.serviceId, cfg.templateId, {
    to_email: me.email,
    to_name: me.name,
    from_name: 'Pragma Studio',
    message: 'Esta es una notificación de prueba',
    task_title: 'Test de configuración',
    task_url: window.location.href,
  }, { publicKey: cfg.publicKey })
    .then(() => showToast('✓ Email enviado a ' + me.email, 'success', 5000))
    .catch(err => {
      console.error('EmailJS test error:', err);
      alert('Falló el envío: ' + (err.text || err.message || 'error desconocido'));
    });
}
