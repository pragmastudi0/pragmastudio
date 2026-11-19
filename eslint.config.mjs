import globals from 'globals';

// Config mínima: la usamos como RED DE SEGURIDAD del refactor modular.
// `no-undef` detecta identificadores no importados/declarados — exactamente el fallo
// que Vite/esbuild NO reporta (los trata como globals → romperían en runtime).
export default [
  {
    files: ['src/**/*.js'],
    ignores: ['dist/**', 'node_modules/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Globales cargados por CDN desde index.html
        supabase: 'readonly',
        emailjs: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
    },
  },
];
