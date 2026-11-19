import { defineConfig } from 'vite';

// Frontend vanilla JS: Vite toma index.html como entrada y bundlea src/main.js.
// El backend serverless (api/*.js, CommonJS) NO lo procesa Vite: lo despliega
// Vercel por separado con el runtime de Node. Tailwind/Supabase/EmailJS siguen
// cargándose por CDN desde index.html (decisión: riesgo visual cero, sin deps extra).
export default defineConfig({
  root: '.',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
