// ============ TEAM ============
function renderTeam() {
  return `
    ${viewHeader('Equipo', `${state.members.length} miembros`,
      `<button class="btn-primary" onclick="openMemberModal()">+ Miembro</button>`)}

    <div class="px-4 md:px-10 pb-10 max-w-2xl space-y-6">
      <div class="card divide-y divide-gray-100">
        ${state.members.map(m => {
          const tasks = state.tasks.filter(t => t.assigneeId === m.id && t.status !== 'COMPLETED').length;
          const isMe = m.id === currentMemberId;
          const hasLogin = !!m.email;
          const role = MEMBER_ROLES.find(r => r.key === m.role);
          const cap = Number(m.weeklyCapacityHrs) || 30;
          return `
            <div class="p-4 flex items-center gap-3 hover:bg-gray-50 flex-wrap">
              <span class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0" style="background:${m.color}">${escapeHtml(m.name[0])}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium">${escapeHtml(m.name)}</span>
                  ${isMe ? '<span class="chip bg-blue-100 text-blue-700">Vos</span>' : ''}
                  ${role ? `<span class="chip bg-gray-100 text-gray-700">${escapeHtml(role.label)}</span>` : ''}
                  ${hasLogin ? `<span class="chip bg-purple-100 text-purple-700" title="Email: ${escapeAttr(m.email)}">🔑 ${escapeHtml(m.email)}</span>` : ''}
                </div>
                <div class="text-xs text-gray-500">${tasks} tarea${tasks!==1?'s':''} activa${tasks!==1?'s':''} · ${cap}h/sem disponibles</div>
              </div>
              <div class="flex gap-1 flex-wrap items-center">
                <button class="btn-ghost text-sm" onclick="openMemberModal('${m.id}')" title="Editar nombre, email y color">✎ Editar</button>
                ${isMe
                  ? '<span class="text-xs text-gray-400 px-2">no podés eliminarte</span>'
                  : `<button class="btn-ghost text-sm text-red-600 hover:bg-red-50" onclick="deleteMember('${m.id}')" title="Eliminar miembro">✕ Eliminar</button>`
                }
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <p class="text-xs text-gray-500">En comentarios escribí <b>@Nombre</b> para notificar a un miembro. El 🔑 indica el email asociado a su login (Supabase Auth).</p>

      ${renderEmailSettings()}
      ${renderInvoiceEmailSettings()}
      ${renderFinanceSettings()}
      ${renderSecuritySettings()}
    </div>
  `;
}

function renderSecuritySettings() {
  return `
    <div class="card p-5">
      <h3 class="font-semibold mb-1">Seguridad de sesiones</h3>
      <p class="text-xs text-gray-500 mb-3">Login gestionado por <b>Supabase Auth</b>. Las contraseñas viven encriptadas en Supabase, no en este HTML.</p>
      <div class="space-y-2 text-xs text-gray-600">
        <div><b>Para cambiar tu contraseña:</b> Supabase Dashboard → Authentication → Users → click en el usuario → "Send password recovery"</div>
        <div><b>Para agregar un usuario:</b> Supabase Dashboard → Authentication → Users → "Add user" → email + contraseña. Después agregalo al MEMBER_MAP del HTML si querés mapearlo a un miembro existente.</div>
        <div><b>Para sacar a alguien del sistema:</b> Supabase Dashboard → Authentication → Users → click en el usuario → "Delete user". Pierde acceso inmediatamente.</div>
        <div><b>Para forzar logout de todos:</b> Supabase Dashboard → Authentication → Sessions → "Sign out all users". Tienen que volver a loguearse.</div>
      </div>
    </div>
  `;
}

function renderFinanceSettings() {
  const updatedLabel = state.exchangeRateUpdatedAt
    ? new Date(state.exchangeRateUpdatedAt).toLocaleString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
    : 'nunca';
  return `
    <div class="card p-5">
      <h3 class="font-semibold mb-1">Configuración de finanzas</h3>
      <p class="text-xs text-gray-500 mb-4">Moneda base, WhatsApp para cobros y mensaje plantilla</p>

      <form onsubmit="saveFinanceSettings(event)" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500">Moneda base</label>
            <select name="defaultCurrency" class="input">
              <option value="ARS" ${(state.defaultCurrency||'ARS')==='ARS'?'selected':''}>ARS (Pesos)</option>
              <option value="USD" ${state.defaultCurrency==='USD'?'selected':''}>USD (Dólares)</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Cotización USD ${state.exchangeRateSource==='bluelytics'?'<span class="text-green-700">· Blue auto</span>':''}</label>
            <button type="button" onclick="openExchangeRateModal()" class="input w-full text-left flex items-center justify-between hover:border-black transition">
              <span class="flex items-center gap-2">
                ${state.exchangeRateSource==='bluelytics'?'<span class="w-2 h-2 rounded-full bg-green-500"></span>':''}
                <span class="font-semibold">$${(state.exchangeRate || 1200).toLocaleString('es-AR')}</span>
              </span>
              <span class="text-xs text-gray-500">${updatedLabel}</span>
            </button>
          </div>
        </div>

        <div>
          <label class="text-xs text-gray-500">WhatsApp de Pragma <span class="text-gray-400">(remitente del recordatorio)</span></label>
          <input type="tel" name="pragmaPhone" class="input" value="${escapeAttr(state.pragmaPhone || '')}" placeholder="+54 9 11 5555-5555" />
        </div>

        <div>
          <label class="text-xs text-gray-500">Plantilla del mensaje de cobro</label>
          <textarea id="templateTextarea" name="paymentMessageTemplate" class="input font-mono text-xs" rows="7" oninput="updateTemplatePreview()">${escapeHtml(state.paymentMessageTemplate || '')}</textarea>
          <p class="text-[11px] text-gray-500 mt-1.5 mb-2">Click una variable para insertarla en el cursor:</p>
          <div class="flex flex-wrap gap-1.5">
            ${PAYMENT_VARS.map(v => `
              <button type="button" onclick="insertTemplateVar('${v.key}')" class="chip bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer border border-blue-200" title="${v.label}">
                <span class="font-mono">{${v.key}}</span>
                <span class="text-blue-500 text-[10px]">${v.label}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="bg-gray-50 rounded-lg p-3">
          <div class="text-xs text-gray-500 mb-1.5 uppercase tracking-wider font-semibold">Vista previa</div>
          <div id="templatePreview" class="text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed">${escapeHtml(getTemplatePreview(state.paymentMessageTemplate || ''))}</div>
          <div class="text-[11px] text-gray-400 mt-2">Con datos de ejemplo</div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
      </form>
    </div>
  `;
}

function insertTemplateVar(key) {
  const ta = document.getElementById('templateTextarea');
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = `{${key}}`;
  ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + text.length;
  updateTemplatePreview();
}

function getTemplatePreview(tpl) {
  // Sample: simulamos una mensualidad de US$20 a la cotización actual
  const sampleAmountUSD = 20;
  const base = state.defaultCurrency || 'ARS';
  const rate = Number(state.exchangeRate) || 1200;
  const sampleInBase = base === 'ARS' ? sampleAmountUSD * rate : sampleAmountUSD;
  const sample = {
    name: 'Juan Pérez',
    client: 'Juan Pérez',
    project: 'CRM Inmobiliario',
    company: 'Inmobiliaria Pérez SA',
    role: 'Director',
    month: `${MONTH_NAMES_FULL[new Date().getMonth()]} ${new Date().getFullYear()}`,
    amount:         fmtAmount(sampleInBase, base),
    amountOriginal: fmtAmount(sampleAmountUSD, 'USD'),
    amountARS:      fmtAmount(sampleAmountUSD * rate, 'ARS'),
    amountUSD:      fmtAmount(sampleAmountUSD, 'USD'),
    rate:           '$' + rate.toLocaleString('es-AR'),
    date: new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'long', year:'numeric' }),
  };
  let out = tpl || '';
  Object.entries(sample).forEach(([k, v]) => {
    // Función como reemplazo para evitar interpretación de $
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), () => String(v ?? ''));
  });
  return out || '(plantilla vacía)';
}

function updateTemplatePreview() {
  const ta = document.getElementById('templateTextarea');
  const preview = document.getElementById('templatePreview');
  if (!ta || !preview) return;
  preview.textContent = getTemplatePreview(ta.value);
}

function saveFinanceSettings(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  state.defaultCurrency = data.defaultCurrency || 'ARS';
  state.pragmaPhone = data.pragmaPhone || '';
  state.paymentMessageTemplate = data.paymentMessageTemplate || '';
  save();
  showToast('Configuración guardada', 'success');
  render();
}

function renderEmailSettings() {
  const cfg = state.emailConfig || {};
  return `
    <div class="card p-5">
      <div class="flex items-center justify-between mb-3">
        <div>
          <h3 class="font-semibold">Notificaciones por email</h3>
          <p class="text-xs text-gray-500 mt-0.5">Via EmailJS · Gratis hasta 200 emails/mes</p>
        </div>
        <span class="chip ${cfg.enabled?'bg-green-100 text-green-700':'bg-gray-100 text-gray-600'}">${cfg.enabled?'Activo':'Desactivado'}</span>
      </div>

      <details class="text-sm text-gray-600 mb-4">
        <summary class="cursor-pointer text-blue-600 hover:underline">¿Cómo configurar? (5 min, una vez)</summary>
        <ol class="list-decimal pl-5 mt-2 space-y-1 text-xs">
          <li>Andá a <a href="https://www.emailjs.com" target="_blank" class="text-blue-600 underline">emailjs.com</a> y creá cuenta gratis</li>
          <li><b>Email Services</b> → conectá tu Gmail/Outlook → copiá el <b>Service ID</b></li>
          <li><b>Email Templates</b> → crea uno con variables <code>{{to_email}}</code>, <code>{{to_name}}</code>, <code>{{from_name}}</code>, <code>{{message}}</code>, <code>{{task_title}}</code>, <code>{{task_url}}</code> → copiá el <b>Template ID</b></li>
          <li><b>Account → General</b> → copiá la <b>Public Key</b></li>
          <li>Pegá los 3 valores acá abajo, activá y dale Guardar</li>
        </ol>
      </details>

      <form onsubmit="saveEmailConfig(event)" class="space-y-3">
        <div class="flex items-center gap-2">
          <input type="checkbox" id="emailEnabled" name="enabled" ${cfg.enabled?'checked':''} class="w-4 h-4" />
          <label for="emailEnabled" class="text-sm font-medium">Enviar emails al asignar tareas o etiquetar</label>
        </div>
        <div><label class="text-xs text-gray-500">Service ID</label><input name="serviceId" class="input font-mono text-xs" value="${escapeAttr(cfg.serviceId||'')}" placeholder="service_xxxxxxx" /></div>
        <div><label class="text-xs text-gray-500">Template ID</label><input name="templateId" class="input font-mono text-xs" value="${escapeAttr(cfg.templateId||'')}" placeholder="template_xxxxxxx" /></div>
        <div><label class="text-xs text-gray-500">Public Key</label><input name="publicKey" class="input font-mono text-xs" value="${escapeAttr(cfg.publicKey||'')}" placeholder="usuario_xxxxxxx" /></div>
        <div class="flex justify-between gap-2 pt-2">
          <button type="button" class="btn-ghost text-sm" onclick="testEmail()" ${!cfg.enabled||!currentMember()?.email?'disabled':''}>Enviar test</button>
          <button type="submit" class="btn-primary">Guardar</button>
        </div>
        ${!currentMember()?.email ? '<p class="text-xs text-amber-700">⚠ Cargá un email en tu perfil de miembro para probar.</p>' : ''}
      </form>
    </div>
  `;
}

function saveEmailConfig(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  state.emailConfig = {
    enabled: data.enabled === 'on',
    serviceId: data.serviceId || '',
    templateId: data.templateId || '',
    publicKey: data.publicKey || '',
  };
  save();
  render();
  showToast('Configuración guardada', 'success');
}

function testEmail() {
  const me = currentMember();
  if (!me || !me.email) { alert('Cargá un email en tu perfil de miembro primero.'); return; }
  const cfg = state.emailConfig;
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

const MEMBER_ROLES = [
  { key: 'FOUNDER',     label: 'Owner / Fundador' },
  { key: 'TECH_LEAD',   label: 'Lead técnico' },
  { key: 'BACKEND',     label: 'Dev Backend' },
  { key: 'FRONTEND',    label: 'Dev Frontend' },
  { key: 'FULLSTACK',   label: 'Dev Full-stack' },
  { key: 'AI',          label: 'Especialista IA' },
  { key: 'DESIGN',      label: 'Diseño UX/UI' },
  { key: 'PM',          label: 'Project Manager' },
  { key: 'SALES',       label: 'Marketing & Ventas' },
  { key: 'CS',          label: 'Customer Success' },
  { key: 'OTHER',       label: 'Otro' },
];

function openMemberModal(id) {
  const m = id ? getMember(id) : { id: null, name: '', email: '', role: '', weeklyCapacityHrs: 30, color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0') };
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar miembro' : 'Nuevo miembro'}</h2>
      <form onsubmit="saveMember(event)" class="space-y-3">
        <input type="hidden" name="id" value="${m.id || ''}" />
        <div><label class="text-xs text-gray-500">Nombre</label><input name="name" class="input" required autofocus value="${escapeAttr(m.name)}" /></div>
        <div><label class="text-xs text-gray-500">Email <span class="text-gray-400">(para login y notificaciones)</span></label><input type="email" name="email" class="input" value="${escapeAttr(m.email || '')}" placeholder="tu@email.com" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500">Rol</label>
            <select name="role" class="input">
              <option value="">Sin definir</option>
              ${MEMBER_ROLES.map(r => `<option value="${r.key}" ${m.role===r.key?'selected':''}>${r.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Capacidad semanal (hs)</label>
            <input type="number" name="weeklyCapacityHrs" class="input" min="0" max="60" value="${m.weeklyCapacityHrs || 30}" />
            <p class="text-[10px] text-gray-400 mt-0.5">Horas productivas reales por semana (no las del horario)</p>
          </div>
        </div>
        <div><label class="text-xs text-gray-500">Color</label><input type="color" name="color" class="input h-10" value="${m.color}" /></div>
        <div class="flex justify-between pt-3">
          <div>${id && id !== currentMemberId && state.members.length > 1 ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="deleteMember('${id}')">Eliminar</button>` : ''}</div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);
}

function saveMember(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.id) {
    Object.assign(getMember(data.id), data);
    if (data.id === currentMemberId) state.user.name = data.name;
  } else {
    state.members.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}

function deleteMember(id) {
  if (id === currentMemberId) {
    alert('No podés eliminarte a vos mismo. Hacé logout primero o pedile a otro miembro que te elimine.');
    return;
  }
  const m = getMember(id);
  if (!m) return;
  const activeTasks = state.tasks.filter(t => t.assigneeId === id && t.status !== 'COMPLETED').length;
  let warning = `¿Eliminar a ${m.name}?`;
  if (activeTasks > 0) warning += `\n\n${activeTasks} tarea${activeTasks>1?'s':''} activa${activeTasks>1?'s':''} queda${activeTasks>1?'n':''} sin asignar.`;
  if (m.email) warning += `\n\n⚠ ${m.name} tiene email asociado (${m.email}). Si vuelve a loguearse con ese email, se va a re-crear el miembro. Para evitarlo, borrá también el usuario desde Supabase → Authentication → Users.`;
  if (!confirm(warning)) return;

  state.members = state.members.filter(m => m.id !== id);
  state.tasks.forEach(t => { if (t.assigneeId === id) t.assigneeId = null; });
  // Limpiar comentarios huérfanos? No — los dejamos para mantener historial, sólo no resuelven al miembro.
  // Limpiar notificaciones dirigidas al eliminado
  state.notifications = (state.notifications || []).filter(n => n.forMemberId !== id);
  save();
  closeModal();
  render();
  showToast(`${m.name} eliminado`, 'success');
}

function openMemberPicker() {
  const me = currentMember();
  const auth = getAuthUser();
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-2">Tu sesión</h2>
      ${me ? `
        <div class="flex items-center gap-3 p-3 rounded-lg bg-gray-50 mb-4">
          <span class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold" style="background:${me.color}">${escapeHtml(me.name[0])}</span>
          <div class="flex-1">
            <div class="font-medium">${escapeHtml(me.name)}</div>
            <div class="text-xs text-gray-500">${escapeHtml(auth?.email || me.email || '')}</div>
          </div>
        </div>
      ` : ''}
      <div class="flex flex-col gap-2">
        <button class="btn-ghost w-full text-sm" onclick="closeModal(); go('team')">Administrar equipo</button>
        <button class="btn-ghost w-full text-sm text-red-600" onclick="closeModal(); logout()">⏏ Cerrar sesión</button>
      </div>
    </div>
  `);
}

