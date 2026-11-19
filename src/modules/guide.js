import { STATUS } from '../core/constants.js';
import { viewHeader } from '../core/ui.js';

// ============ GUIDE ============
export function renderGuide() {
  return `
    ${viewHeader('Manual de uso', 'Las reglas del sistema')}

    <div class="px-4 md:px-10 pb-10 max-w-3xl space-y-6">
      <div class="card p-6">
        <h3 class="font-semibold mb-3">Estados de tarea</h3>
        <div class="space-y-3 text-sm">
          <div class="flex gap-3"><span class="chip ${STATUS.PENDING.color} w-28 text-center">Pendiente</span><span>Creada, aún no empezada. Es el default.</span></div>
          <div class="flex gap-3"><span class="chip ${STATUS.IN_PROGRESS.color} w-28 text-center">En progreso</span><span>Estás trabajando hoy. Tenela abierta mientras la hacés.</span></div>
          <div class="flex gap-3"><span class="chip ${STATUS.IN_REVIEW.color} w-28 text-center">En revisión</span><span>Terminaste, esperás feedback o aprobación.</span></div>
          <div class="flex gap-3"><span class="chip ${STATUS.COMPLETED.color} w-28 text-center">Completada</span><span>Aprobada. No vuelve a estado anterior.</span></div>
          <div class="flex gap-3"><span class="chip ${STATUS.BLOCKED.color} w-28 text-center">Bloqueada</span><span>No podés avanzar por un factor externo. <b>Requiere motivo escrito.</b></span></div>
        </div>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Cuándo usar "Bloqueada"</h3>
        <p class="text-sm text-gray-700 mb-3">Solo cuando hay un factor externo que te impide seguir. No cuando simplemente no tenés ganas o priorizaste otra cosa (eso es "Pendiente").</p>
        <p class="text-sm text-gray-700 mb-3"><b>Cómo destrabar:</b> en el detalle de la tarea, editá el motivo para dejar claro qué cambió, movela a "En progreso" o "En revisión" según corresponda, y sumá un comentario explicando.</p>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Cómo estimar tiempo</h3>
        <ul class="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>Cargá siempre <b>tiempo estimado</b> al crear la tarea.</li>
          <li>Al terminarla, actualizá <b>tiempo real</b>.</li>
          <li>El sistema te muestra tu desvío promedio en Reportes — ajustá tus estimaciones con ese dato.</li>
          <li>Regla práctica: si una tarea se estira 2x el estimado, partila en dos.</li>
        </ul>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Ritmo recomendado</h3>
        <ul class="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li><b>Todas las mañanas:</b> entrá a "Hoy", revisá tareas del día.</li>
          <li><b>Lunes:</b> revisá "Esta semana" y reordená prioridades.</li>
          <li><b>Fin de mes:</b> revisá "Finanzas" y cargá lo que falte.</li>
          <li><b>Al terminar una tarea:</b> comentá algo útil que hayas aprendido.</li>
        </ul>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Menciones y notificaciones</h3>
        <ul class="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>En cualquier comentario escribí <b>@Nombre</b> para notificar a ese miembro.</li>
          <li>Cuando asignás una tarea a alguien, le llega una notificación.</li>
          <li>La campana arriba a la izquierda muestra las notificaciones sin leer.</li>
          <li>Podés cambiar entre miembros haciendo click en tu nombre abajo del sidebar.</li>
        </ul>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Estados de proyecto</h3>
        <div class="text-sm text-gray-700 space-y-1">
          <div><b>Lead:</b> primer contacto, sin compromiso aún.</div>
          <div><b>Posible:</b> hay chance concreta de cerrarlo.</div>
          <div><b>En desarrollo:</b> estamos trabajando activamente.</div>
          <div><b>Activo mensualidad:</b> cliente recurrente cobrando fee fijo.</div>
          <div><b>Pausado:</b> detenido temporalmente.</div>
          <div><b>Terminado:</b> finalizado, sin actividad.</div>
          <div><b>Archivado:</b> fuera del radar.</div>
        </div>
      </div>

      <div class="card p-6">
        <h3 class="font-semibold mb-3">Gantt</h3>
        <p class="text-sm text-gray-700">En Tareas → Gantt, las tareas que tengan fecha de inicio <b>y</b> fin se muestran como barras en el tiempo. La línea roja es hoy. Las barras con marco rojo están vencidas.</p>
      </div>

      <div class="card p-6 bg-green-50 border-green-200">
        <h3 class="font-semibold mb-2">✓ Tus datos están guardados</h3>
        <p class="text-sm text-gray-700 mb-3">Si configuraste Supabase, todo se sincroniza en tiempo real entre dispositivos y pestañas. Si no, los datos viven solo en este navegador.</p>
        <p class="text-sm text-gray-700">Estado actual: mirá el indicador en el sidebar (verde = sincronizado, gris = solo local).</p>
        <button onclick="reconfigureCloud()" class="btn-ghost text-sm mt-3">Reconfigurar sincronización</button>
      </div>
    </div>
  `;
}
