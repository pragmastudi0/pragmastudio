# Decisiones técnicas — refactor modular

Registro de decisiones (ADR ligero). Cada una incluye contexto y por qué.

## 1. Vite + ES Modules (vanilla JS)
- **Decisión**: usar Vite como dev server/bundler y organizar el código en ES Modules vanilla.
- **Por qué**: Vite da dev server con HMR y un build de producción con hashing/purga sin imponer
  framework ni reescribir la lógica. Se mantiene JS vanilla (sin React/Vue) y **sin TypeScript**, según
  lo pedido. Alternativas descartadas: webpack (más config), seguir sin build (no modulariza).

## 2. Mantener Tailwind por CDN (no migrar a build-time)
- **Decisión**: dejar `<script src="https://cdn.tailwindcss.com">` en `index.html`.
- **Por qué**: el objetivo primario es **no provocar cambios visuales**. El CDN JIT genera exactamente
  las clases que ya se ven; migrar a Tailwind build-time (PostCSS/purga) puede diferir sutilmente en
  preflight/defaults y exige QA visual en navegador que no se puede automatizar aquí. Contras asumidos:
  dependencia de runtime y warning de consola en producción. Revisable en el futuro con QA visual.

## 3. Supabase y EmailJS siguen por CDN (no se agregan como deps npm en esta etapa)
- **Decisión**: mantener los `<script>` de `@supabase/supabase-js@2` y `@emailjs/browser@4` en el head;
  el código los usa como globals (`window.supabase`, `window.emailjs`).
- **Por qué**: hace que la reubicación del script sea **verbatim** (cero cambios de runtime) y evita
  sumar dependencias. Migrar a imports npm (`createClient`, `emailjs`) queda como refinamiento posterior,
  cuando se tallen los servicios `services/supabase.js` y `services/email.js`.
- **Nota**: Vite/esbuild tratan los identificadores libres `supabase`/`emailjs` como globals; el build
  no falla por no resolverlos como imports.

## 4. Estrategia "strangler" (no "big bang")
- **Decisión**: primero reubicar TODO el script del monolito a `src/legacy/app.js` (verbatim) y luego
  tallar módulos uno a uno, reimportándolos.
- **Por qué**: en cada commit hay **un solo** sistema de estado/persistencia, la app compila y arranca
  igual, y el riesgo se acota por módulo. Evita el requisito prohibido de "dos sistemas simultáneos".

## 5. Capa de compatibilidad `window-bridge` (en vez de reescribir handlers)
- **Decisión**: re-exponer en `window` las funciones y variables usadas por handlers inline, mediante un
  bloque explícito al final de `legacy/app.js` (funciones como valores; variables de vista como
  accessors get/set).
- **Por qué**: hay **175 handlers inline** y **11 variables reasignadas** por handlers. Reescribir todo a
  event-delegation cambiaría el comportamiento y multiplicaría el riesgo; el bridge preserva el
  comportamiento EXACTO con cero ediciones a la lógica. Se documenta como deuda a reducir por módulo.

## 6. `state` NO se extrae todavía
- **Decisión**: dejar `let state`, `load()` y la persistencia en `legacy/app.js` por ahora; extraer
  primero piezas **puras** (presupuestos; luego constantes/helpers).
- **Por qué**: `state` se **reasigna** (`state = {...}`) en varios puntos (cloud load, realtime, import).
  Los bindings importados de un módulo ES son de solo-lectura, así que mover `state` exige un patrón de
  "store" (`store.state`) que toca cientos de referencias. Es alto alcance/riesgo y se hará en una etapa
  dedicada, con cuidado y tras tener tests de serialización del estado.

## 7. Backend AFIP intacto y como CommonJS
- **Decisión**: no tocar `api/afip/*.js` ni `lib/afip-helpers.js`; no agregar `"type":"module"` en la
  raíz.
- **Por qué**: son funciones serverless de Vercel en CommonJS (`require`/`module.exports`). Añadir
  `"type":"module"` las rompería. Vite sólo procesa el frontend; Vercel despliega `api/` aparte.

## 8. Tests de caracterización con Vitest, sólo funciones puras
- **Decisión**: Vitest; empezar por `estimateBudget` y helpers puros. Fixtures sintéticos.
- **Por qué**: congela el comportamiento actual antes/después de mover código. Supabase/AFIP/cotizaciones
  requieren red/credenciales reales y **no** se testean automáticamente (se mockearán o se validan a mano).
