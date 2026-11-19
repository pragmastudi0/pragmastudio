import { DOC_CATEGORIES, RES_CATEGORIES } from '../core/constants.js';
import { S } from '../core/state.js';
import { closeModal, openModal, render, viewHeader } from '../core/ui.js';
import { save } from '../services/cloud.js';
import { escapeAttr, escapeHtml, uid } from '../utils/helpers.js';

export function faviconFor(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return null; }
}

export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function renderLinkPanel(title, subtitle, items, filter, categories, setFilter, onAdd, onEdit) {
  const filtered = filter ? items.filter(i => i.category === filter) : items;
  const sorted = [...filtered].sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));

  return `
    ${viewHeader(title, subtitle, `<button class="btn-primary" onclick="${onAdd}()">+ Nuevo</button>`)}

    <div class="px-4 md:px-10 pb-4 flex gap-2 flex-wrap">
      <button onclick="${setFilter}(''); render()" class="chip ${filter===''?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">Todos (${items.length})</button>
      ${categories.map(c => {
        const n = items.filter(i => i.category === c).length;
        if (n === 0) return '';
        return `<button onclick="${setFilter}('${c}'); render()" class="chip ${filter===c?'bg-black text-white':'bg-gray-100 text-gray-700'} py-1.5 px-3 cursor-pointer">${c} (${n})</button>`;
      }).join('')}
    </div>

    <div class="px-4 md:px-10 pb-10">
      ${sorted.length === 0 ? `
        <div class="card p-10 text-center text-gray-400">
          ${items.length === 0 ? 'Sin items todavía. Agregá el primero.' : 'Nada en esta categoría.'}
        </div>
      ` : `
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          ${sorted.map(i => {
            const favicon = faviconFor(i.url);
            const domain = domainOf(i.url);
            return `
              <div class="card p-5 hover:shadow-md transition-shadow group">
                <div class="flex items-start gap-3 mb-3">
                  ${favicon ? `<img src="${favicon}" class="w-8 h-8 rounded" onerror="this.style.display='none'" />` : '<div class="w-8 h-8 rounded bg-gray-100"></div>'}
                  <div class="flex-1 min-w-0">
                    <div class="font-semibold text-sm truncate">${escapeHtml(i.title)}</div>
                    <div class="text-xs text-gray-500 truncate">${escapeHtml(domain || i.url)}</div>
                  </div>
                  <button class="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-gray-900" onclick="${onEdit}('${i.id}')">⋯</button>
                </div>
                ${i.description ? `<p class="text-xs text-gray-600 mb-3 line-clamp-2">${escapeHtml(i.description)}</p>` : ''}
                <div class="flex items-center justify-between">
                  <span class="chip bg-gray-100 text-gray-700">${escapeHtml(i.category || 'Otro')}</span>
                  <a href="${escapeAttr(i.url)}" target="_blank" class="text-xs text-blue-600 hover:underline flex items-center gap-1">
                    Abrir
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg>
                  </a>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

export function renderDocuments() {
  return renderLinkPanel(
    'Documentos',
    'Contratos, propuestas, plantillas y guías internas',
    S.state.documents,
    S.docsFilter,
    DOC_CATEGORIES,
    'setDocsFilter',
    'openDocumentModal',
    'openDocumentModal'
  );
}

export function setDocsFilter(f) { S.docsFilter = f; }

export function renderResources() {
  return renderLinkPanel(
    'Recursos',
    'Apps, herramientas y links útiles',
    S.state.resources,
    S.resourcesFilter,
    RES_CATEGORIES,
    'setResourcesFilter',
    'openResourceModal',
    'openResourceModal'
  );
}

export function setResourcesFilter(f) { S.resourcesFilter = f; }

// ---- Generic link modal ----
export function openLinkModal(title, item, categories, onSave, onDelete, id) {
  openModal(`
    <div class="p-6">
      <h2 class="text-xl font-semibold mb-4">${id ? 'Editar' : 'Nuevo'} ${title.toLowerCase()}</h2>
      <form onsubmit="${onSave}(event)" class="space-y-3">
        <input type="hidden" name="id" value="${item.id || ''}" />
        <div>
          <label class="text-xs text-gray-500">Título</label>
          <input name="title" class="input" required autofocus value="${escapeAttr(item.title)}" placeholder="Ej: Contrato base clientes" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Link</label>
          <input type="url" name="url" class="input" required value="${escapeAttr(item.url)}" placeholder="https://..." />
        </div>
        <div>
          <label class="text-xs text-gray-500">Categoría</label>
          <select name="category">
            ${categories.map(c => `<option value="${c}" ${item.category===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500">Descripción (opcional)</label>
          <textarea name="description" class="input" rows="2">${escapeHtml(item.description || '')}</textarea>
        </div>
        <div class="flex justify-between pt-3">
          <div>${id ? `<button type="button" class="btn-ghost text-red-600 text-sm" onclick="${onDelete}('${id}')">Eliminar</button>` : ''}</div>
          <div class="flex gap-2">
            <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </div>
      </form>
    </div>
  `);
}

export function openDocumentModal(id) {
  const doc = id ? S.state.documents.find(d => d.id === id) : { id: null, title: '', url: '', category: DOC_CATEGORIES[0], description: '' };
  openLinkModal('Documento', doc, DOC_CATEGORIES, 'saveDocument', 'deleteDocument', id);
}

export function saveDocument(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.id) {
    Object.assign(S.state.documents.find(d => d.id === data.id), data);
  } else {
    S.state.documents.push({ ...data, id: uid(), createdAt: new Date().toISOString() });
  }
  save(); closeModal(); render();
}

export function deleteDocument(id) {
  if (!confirm('¿Eliminar documento?')) return;
  S.state.documents = S.state.documents.filter(d => d.id !== id);
  save(); closeModal(); render();
}

export function openResourceModal(id) {
  const res = id ? S.state.resources.find(r => r.id === id) : { id: null, title: '', url: '', category: RES_CATEGORIES[0], description: '' };
  openLinkModal('Recurso', res, RES_CATEGORIES, 'saveResource', 'deleteResource', id);
}

export function saveResource(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.id) {
    Object.assign(S.state.resources.find(r => r.id === data.id), data);
  } else {
    S.state.resources.push({ ...data, id: uid(), createdAt: new Date().toISOString() });
  }
  save(); closeModal(); render();
}

export function deleteResource(id) {
  if (!confirm('¿Eliminar recurso?')) return;
  S.state.resources = S.state.resources.filter(r => r.id !== id);
  save(); closeModal(); render();
}
