import { getProject } from '../core/selectors.js';
import { closeModal, openModal } from '../core/ui.js';
import { openProjectDetail } from './projects.js';
import { save } from '../services/cloud.js';
import { escapeAttr, escapeHtml } from '../utils/helpers.js';

// ---- Client profile modal ----
export function openProjectProfileModal(projectId) {
  const p = getProject(projectId);
  const v = {
    contactName:'', contactRole:'', contactPhone:'', contactPhone2:'',
    contactEmail:'', contactEmail2:'',
    companyName:'', taxId:'', industry:'', website:'',
    address:'', city:'', country:'',
    domain:'', domainProvider:'', domainExpiry:'',
    hostingProvider:'', serverInfo:'', adminUrl:'',
    credentialsLink:'', repoUrl:'', techStack:'', techNotes:'',
    instagram:'', facebook:'', linkedin:'', tiktok:'',
    source:'', firstContactDate:'', commercialNotes:'',
    ...p,
  };

  const fld = (name, label, type='text', value='', placeholder='', wide=false) => `
    <div class="${wide?'col-span-2':''}">
      <label class="text-xs text-gray-500">${label}</label>
      <input type="${type}" name="${name}" class="input" value="${escapeAttr(value||'')}" placeholder="${escapeAttr(placeholder)}" />
    </div>`;
  const txt = (name, label, value='', rows=2) => `
    <div class="col-span-2">
      <label class="text-xs text-gray-500">${label}</label>
      <textarea name="${name}" class="input" rows="${rows}">${escapeHtml(value||'')}</textarea>
    </div>`;
  const sec = (title) => `<h3 class="text-xs uppercase tracking-wider text-gray-500 font-semibold mt-5 mb-2 pb-1 border-b border-gray-100">${title}</h3>`;

  openModal(`
    <div class="p-6">
      <div class="flex items-center gap-2 mb-1">
        <span class="w-3 h-3 rounded-full" style="background:${p?.color || '#9ca3af'}"></span>
        <h2 class="text-xl font-semibold">Perfil del cliente</h2>
      </div>
      <p class="text-sm text-gray-500 mb-4">${escapeHtml(p.name)}</p>

      <form onsubmit="saveProjectProfile(event, '${p.id}')">
        ${sec('Contacto principal')}
        <div class="grid grid-cols-2 gap-3">
          ${fld('contactName',  'Nombre',           'text',  v.contactName)}
          ${fld('contactRole',  'Cargo',            'text',  v.contactRole,  'Ej: CEO, Marketing')}
          ${fld('contactPhone', 'WhatsApp',         'tel',   v.contactPhone, '+54 9 11...')}
          ${fld('contactPhone2','Teléfono fijo',    'tel',   v.contactPhone2)}
          ${fld('contactEmail', 'Email principal',  'email', v.contactEmail)}
          ${fld('contactEmail2','Email secundario', 'email', v.contactEmail2)}
        </div>

        ${sec('Empresa')}
        <div class="grid grid-cols-2 gap-3">
          ${fld('companyName', 'Razón social', 'text', v.companyName)}
          ${fld('taxId',       'CUIT / Tax ID','text', v.taxId)}
          ${fld('industry',    'Industria',    'text', v.industry, 'Ej: Inmobiliario')}
          ${fld('website',     'Sitio web',    'url',  v.website,  'https://...')}
          ${fld('address',     'Dirección',    'text', v.address,  '', true)}
          ${fld('city',        'Ciudad',       'text', v.city)}
          ${fld('country',     'País',         'text', v.country)}
        </div>

        ${sec('Datos técnicos')}
        <div class="grid grid-cols-2 gap-3">
          ${fld('domain',          'Dominio',              'text', v.domain,          'empresa.com')}
          ${fld('domainProvider',  'Proveedor dominio',    'text', v.domainProvider,  'Ej: NIC.ar, GoDaddy')}
          ${fld('domainExpiry',    'Vencimiento dominio',  'date', v.domainExpiry)}
          ${fld('hostingProvider', 'Hosting',              'text', v.hostingProvider, 'Ej: Vercel, AWS')}
          ${fld('serverInfo',      'Server / IP',          'text', v.serverInfo)}
          ${fld('adminUrl',        'Panel admin',          'url',  v.adminUrl,        'https://...')}
          ${fld('credentialsLink', 'Credenciales (link)',  'url',  v.credentialsLink, '1Password, Bitwarden...')}
          ${fld('repoUrl',         'Repositorio',          'url',  v.repoUrl,         'github.com/...')}
          ${fld('techStack',       'Stack tecnológico',    'text', v.techStack,       'Next.js + Supabase', true)}
          ${txt('techNotes',       'Notas técnicas',       v.techNotes, 3)}
        </div>

        ${sec('Redes sociales')}
        <div class="grid grid-cols-2 gap-3">
          ${fld('instagram', 'Instagram', 'text', v.instagram, '@usuario')}
          ${fld('facebook',  'Facebook',  'text', v.facebook,  'facebook.com/...')}
          ${fld('linkedin',  'LinkedIn',  'url',  v.linkedin)}
          ${fld('tiktok',    'TikTok',    'text', v.tiktok,    '@usuario')}
        </div>

        ${sec('Comercial')}
        <div class="grid grid-cols-2 gap-3">
          ${fld('source',           'Cómo llegó',       'text', v.source, 'Referido, web, evento...')}
          ${fld('firstContactDate', 'Primer contacto',  'date', v.firstContactDate)}
          ${txt('commercialNotes',  'Notas comerciales', v.commercialNotes, 3)}
        </div>

        <div class="flex justify-end gap-2 pt-5 mt-4 border-t border-gray-100">
          <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
          <button type="submit" class="btn-primary">Guardar perfil</button>
        </div>
      </form>
    </div>
  `);
}

export function saveProjectProfile(e, projectId) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  Object.assign(getProject(projectId), data);
  save();
  closeModal();
  openProjectDetail(projectId);
}
