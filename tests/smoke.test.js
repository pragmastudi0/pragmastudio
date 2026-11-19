// @vitest-environment jsdom
// Smoke test de integración del frontend modularizado.
// Monta un DOM mínimo (los contenedores de index.html), importa el grafo de módulos
// y ejecuta render() de las 10 vistas con el estado por defecto. Objetivo: detectar
// referencias rotas / TDZ / imports faltantes en los paths de render que el build y
// eslint no pueden ver. NO reemplaza la QA manual en navegador (Supabase/AFIP reales).
import { describe, it, expect, beforeAll } from 'vitest';

const CONTAINERS = `
  <div id="setupOverlay" class="hidden"></div>
  <div id="app">
    <button class="menu-btn"></button>
    <div id="sidebarOverlay"></div>
    <aside id="sidebar">
      <button id="bellBtn"></button><span id="bellBadge" class="hidden"></span>
      <nav id="nav"></nav>
      <div id="userInfo"></div>
      <div id="syncStatus"></div>
    </aside>
    <main id="main"></main>
  </div>
  <div id="loginOverlay" class="hidden"></div>
  <div id="toastContainer"></div>
  <div id="notifPanel" class="hidden"><div id="notifList"></div></div>
  <div id="modal" class="hidden"><div id="modalContent"></div></div>
  <input type="file" id="fileInput" />
`;

let mod;
beforeAll(async () => {
  document.body.innerHTML = CONTAINERS;
  mod = await import('../src/core/ui.js');
});

const VIEWS = ['tasks', 'projects', 'clients', 'budgets', 'finance', 'reports', 'documents', 'resources', 'team', 'guide'];

describe('render de todas las vistas (estado por defecto)', () => {
  it('el grafo de módulos importa sin errores', () => {
    expect(typeof mod.render).toBe('function');
    expect(typeof mod.go).toBe('function');
  });

  for (const view of VIEWS) {
    it(`render('${view}') no lanza y produce HTML`, async () => {
      const { go } = mod;
      expect(() => go(view)).not.toThrow();
      const main = document.getElementById('main');
      expect(main.innerHTML.length).toBeGreaterThan(0);
    });
  }
});
