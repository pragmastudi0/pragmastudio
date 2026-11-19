// Pruebas de caracterización de los helpers puros (src/utils/helpers.js).
// Sólo funciones deterministas; no se asteria el string localizado de `fmt`.
import { describe, it, expect } from 'vitest';
import {
  uid, fmtMoney, daysBetween, lastDayOfMonth, monthsBetween, prevMonthKey,
  escapeHtml, escapeAttr, fmt,
} from '../src/utils/helpers.js';

describe('uid', () => {
  it('devuelve un string alfanumérico no vacío', () => {
    const id = uid();
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^[a-z0-9]+$/);
    expect(id.length).toBeGreaterThan(0);
  });
});

describe('daysBetween', () => {
  it('cuenta días entre dos fechas (b - a)', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7);
    expect(daysBetween('2026-01-08', '2026-01-01')).toBe(-7);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });
});

describe('lastDayOfMonth', () => {
  it('devuelve el último día del mes', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28'); // no bisiesto
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29'); // bisiesto
    expect(lastDayOfMonth('2026-01')).toBe('2026-01-31');
    expect(lastDayOfMonth('2026-04')).toBe('2026-04-30');
  });
});

describe('monthsBetween', () => {
  it('lista meses YYYY-MM inclusive', () => {
    expect(monthsBetween('2026-01-01', '2026-03-15')).toEqual(['2026-01', '2026-02', '2026-03']);
  });
  it('cruza el fin de año', () => {
    expect(monthsBetween('2025-11-01', '2026-01-01')).toEqual(['2025-11', '2025-12', '2026-01']);
  });
  it('un solo mes cuando from y to son el mismo', () => {
    expect(monthsBetween('2026-05-10', '2026-05-28')).toEqual(['2026-05']);
  });
});

describe('prevMonthKey', () => {
  it('mes anterior', () => {
    expect(prevMonthKey('2026-03')).toBe('2026-02');
  });
  it('enero → diciembre del año anterior', () => {
    expect(prevMonthKey('2026-01')).toBe('2025-12');
  });
});

describe('escapeHtml / escapeAttr', () => {
  it('escapa los 5 caracteres peligrosos', () => {
    expect(escapeHtml(`<script>"a" & 'b'`)).toBe('&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;');
  });
  it('maneja null/undefined como string vacío', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
  it('escapeAttr delega en escapeHtml', () => {
    expect(escapeAttr('<x>')).toBe(escapeHtml('<x>'));
  });
});

describe('fmt / fmtMoney', () => {
  it("fmt devuelve '—' cuando no hay fecha", () => {
    expect(fmt('')).toBe('—');
    expect(fmt(null)).toBe('—');
  });
  it('fmtMoney formatea pesos sin decimales con prefijo $', () => {
    const s = fmtMoney(1200);
    expect(s.startsWith('$')).toBe(true);
    expect(s).not.toMatch(/[.,]\d{2}$/); // sin decimales
    expect(fmtMoney(0)).toBe('$0');
    expect(fmtMoney('no-num')).toBe('$0');
  });
});
