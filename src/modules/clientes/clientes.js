// ============================================================
// CLIENTES — datos fiscales, fuente única para facturación
// ============================================================
function renderClients() {
  const clients = state.clients || [];
  return `
    ${viewHeader('Clientes', `${clients.length} cliente${clients.length!==1?'s':''}`,
      `<button class="btn-primary" onclick="openClientModal()">+ Cliente</button>`)}

    <div class="px-4 md:px-10 pb-10 max-w-2xl space-y-6">
      <div class="card divide-y divide-gray-100">
        ${clients.length === 0 ? `
          <div class="p-8 text-center text-gray-400 text-sm">
            Todavía no cargaste clientes.<br/>
            Creá uno con sus datos fiscales para vincularlo a un proyecto y facturar más rápido.
          </div>
        ` : clients.map(c => {
          const linked = state.projects.filter(p => p.clientId === c.id).length;
          const dtLabel = DOC_TYPE_LABELS[c.docType] || 'Consumidor Final';
          return `
            <div class="p-4 flex items-center gap-3 hover:bg-gray-50 flex-wrap">
              <span class="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0 bg-gray-700">${escapeHtml((c.name||'?')[0].toUpperCase())}</span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium">${escapeHtml(c.name)}</span>
                  <span class="chip bg-gray-100 text-gray-700">${escapeHtml(dtLabel)}${c.docType !== '99' && c.docNumber ? ` ${escapeHtml(c.docNumber)}` : ''}</span>
                  ${c.condicionIVA ? `<span class="chip bg-blue-50 text-blue-700">${escapeHtml(c.condicionIVA)}</span>` : ''}
                  ${c.email ? `<span class="chip bg-gray-100 text-gray-600" title="Email">✉ ${escapeHtml(c.email)}</span>` : ''}
                </div>
                <div class="text-xs text-gray-500">${linked} proyecto${linked!==1?'s':''} vinculado${linked!==1?'s':''}${c.notes ? ` · ${escapeHtml(c.notes)}` : ''}</div>
              </div>
              <div class="flex gap-1 flex-wrap items-center">
                <button class="btn-ghost text-sm" onclick="openClientModal('${c.id}')" title="Editar cliente">✎ Editar</button>
                <button class="btn-ghost text-sm text-red-600 hover:bg-red-50" onclick="deleteClient('${c.id}')" title="Eliminar cliente">✕ Eliminar</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <p class="text-xs text-gray-500">Los datos fiscales que cargues acá precargan automáticamente el modal <b>Emitir Factura C</b> cuando el proyecto está vinculado a este cliente.</p>
    </div>
  `;
}

function openClientModal(id) {
  const c = id ? getClient(id) : { id: null, name: '', docType: '99', docNumber: '', condicionIVA: '', email: '', notes: '' };
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar cliente' : 'Nuevo cliente'}</h2>
      <form onsubmit="saveClient(event)" class="space-y-3">
        <input type="hidden" name="id" value="${c.id || ''}" />
        <div>
          <label class="text-xs text-gray-500">Razón social / Nombre</label>
          <input name="name" class="input" required autofocus value="${escapeAttr(c.name)}" placeholder="Ej: Galo Wines S.A." />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="text-xs text-gray-500">Tipo de documento</label>
            <select name="docType" class="input">
              ${CLIENT_DOC_TYPES.map(d => `<option value="${d.v}" ${(c.docType||'99')===d.v?'selected':''}>${d.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500">Número (sin guiones)</label>
            <input name="docNumber" class="input" value="${escapeAttr(c.docNumber || '')}" placeholder="Ej: 20424402142" />
          </div>
        </div>
        <div>
          <label class="text-xs text-gray-500">Condición frente al IVA</label>
          <select name="condicionIVA" class="input">
            <option value="">Sin definir</option>
            ${CONDICION_IVA.map(x => `<option value="${x}" ${c.condicionIVA===x?'selected':''}>${x}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500">Email <span class="text-gray-400">(para envío de facturas)</span></label>
          <input type="email" name="email" class="input" value="${escapeAttr(c.email || '')}" placeholder="cliente@empresa.com" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Notas</label>
          <textarea name="notes" class="input" rows="2" placeholder="Datos fiscales extra, referencia, etc.">${escapeHtml(c.notes || '')}</textarea>
        </div>
        <div class="flex justify-between pt-3">
          <div>${id ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="deleteClient('${id}')">Eliminar</button>` : ''}</div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);
}

function saveClient(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.docNumber) data.docNumber = String(data.docNumber).replace(/[^\d]/g, '');
  state.clients = state.clients || [];
  if (data.id) {
    Object.assign(getClient(data.id), data);
  } else {
    state.clients.push({ ...data, id: uid() });
  }
  save(); closeModal(); render();
}

function deleteClient(id) {
  const c = getClient(id);
  if (!c) return;
  const linked = state.projects.filter(p => p.clientId === id);
  let warning = `¿Eliminar al cliente ${c.name}?`;
  if (linked.length > 0) warning += `\n\n${linked.length} proyecto${linked.length>1?'s':''} quedará${linked.length>1?'n':''} sin cliente asignado.`;
  if (!confirm(warning)) return;
  state.clients = (state.clients || []).filter(x => x.id !== id);
  linked.forEach(p => { p.clientId = ''; });
  save(); closeModal(); render();
}

