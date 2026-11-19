// Pruebas de caracterización del motor de presupuestos (src/modules/budgets/engine.js).
// Objetivo: congelar el comportamiento ACTUAL del cálculo antes y después de modularizar.
// Fixtures 100% sintéticos — ningún dato real de clientes.
import { describe, it, expect } from 'vitest';
import { estimateBudget, getBudgetCategories } from '../src/modules/budgets/engine.js';

describe('getBudgetCategories', () => {
  it('prioriza categories[] cuando existe', () => {
    expect(getBudgetCategories({ categories: ['AI', 'WEB'] })).toEqual(['AI', 'WEB']);
  });
  it('cae a category (legacy) cuando no hay categories[]', () => {
    expect(getBudgetCategories({ category: 'ERP' })).toEqual(['ERP']);
  });
  it("default 'WEB' cuando no hay ninguna", () => {
    expect(getBudgetCategories({})).toEqual(['WEB']);
  });
});

describe('estimateBudget — ítem MEDIUM estándar (WEB, FIXED, sin riesgos, contingencia default)', () => {
  const budget = {
    categories: ['WEB'],
    pricingModel: 'FIXED',
    items: [{ complexity: 'MEDIUM' }], // hoursDev default = 5
  };
  const r = estimateBudget(budget);

  it('deriva horas por disciplina sobre hoursDev=5', () => {
    const it0 = r.items[0];
    expect(it0.hoursDev).toBe(5);
    expect(it0.hoursFunctional).toBeCloseTo(1.25, 6);
    expect(it0.hoursUX).toBeCloseTo(0.75, 6);
    expect(it0.hoursQA).toBeCloseTo(1.0, 6);
    expect(it0.hoursTraining).toBeCloseTo(0.35, 6);
    expect(it0.hoursDocs).toBeCloseTo(0.35, 6);
    expect(it0.hoursPM).toBeCloseTo(1.305, 6);
    expect(it0.itemHours).toBeCloseTo(10.005, 6);
  });

  it('calcula costo y venta base (DEV_SSR porque MEDIUM no es senior)', () => {
    expect(r.baseCost).toBeCloseTo(37.93, 6);
    expect(r.baseRevenue).toBeCloseTo(353.725, 6);
  });

  it('aplica contingencia default 12% (multiplier 1.12) sin riesgos', () => {
    expect(r.contingencyPct).toBeCloseTo(12, 6);
    expect(r.riskSum).toBe(0);
    expect(r.finalCost).toBeCloseTo(37.93 * 1.12, 6);
    expect(r.finalRevenue).toBeCloseTo(353.725 * 1.12, 6);
  });

  it('margen ~89.28% y estado green (supera targetMargin 52 de FIXED)', () => {
    expect(r.margin).toBeCloseTo(89.2774, 3);
    expect(r.marginStatus).toBe('green');
    expect(r.minMargin).toBe(40);
    expect(r.targetMargin).toBe(52);
  });
});

describe('estimateBudget — propiedades invariantes (caracterización)', () => {
  it('el margen es independiente de riesgo y contingencia (el multiplier se cancela)', () => {
    const base = { categories: ['WEB'], pricingModel: 'FIXED', items: [{ complexity: 'COMPLEX' }] };
    const withRisk = {
      ...base,
      contingencyPct: 30,
      riskFactors: [{ id: 'INTEGRATION' }, { id: 'URGENT', value: 0.4 }],
    };
    expect(estimateBudget(withRisk).margin).toBeCloseTo(estimateBudget(base).margin, 6);
  });

  it('riskSum se topea en 1.0 aunque la suma supere 1', () => {
    const budget = {
      categories: ['WEB'], pricingModel: 'FIXED',
      items: [{ complexity: 'SIMPLE' }],
      contingencyPct: 0,
      // suma de defs > 1 (0.35 + 0.30 + 0.45 = 1.10) → cap 1.0
      riskFactors: [{ id: 'LEGACY' }, { id: 'URGENT' }, { id: 'AI' }],
    };
    const r = estimateBudget(budget);
    expect(r.riskSum).toBe(1.0);
    // Quirk real del código: `Number(contingencyPct) || 12` trata 0 como "sin valor"
    // y cae a 12%. Por eso aunque pasemos contingencyPct:0, la contingencia efectiva es 12%.
    expect(r.contingencyPct).toBeCloseTo(12, 6);
    // multiplier = (1 + riskSum) * (1 + 0.12) = 2.0 * 1.12 = 2.24
    expect(r.finalHours).toBeCloseTo(r.baseHours * 2.24, 6);
  });

  it('categoría AI usa el rate AI (costo/venta distintos al mix estándar)', () => {
    const noAI = estimateBudget({ categories: ['WEB'], pricingModel: 'FIXED', items: [{ complexity: 'MEDIUM' }] });
    const ai   = estimateBudget({ categories: ['AI'],  pricingModel: 'FIXED', items: [{ complexity: 'MEDIUM' }] });
    expect(ai.baseCost).not.toBeCloseTo(noAI.baseCost, 6);
    expect(ai.baseRevenue).not.toBeCloseTo(noAI.baseRevenue, 6);
  });

  it('presupuesto vacío → totales en 0, margen 0 y estado red', () => {
    const r = estimateBudget({ items: [] });
    expect(r.baseHours).toBe(0);
    expect(r.finalRevenue).toBe(0);
    expect(r.margin).toBe(0);
    expect(r.marginStatus).toBe('red');
  });

  it('hoursDev explícito pisa el default de la complejidad', () => {
    const r = estimateBudget({ categories: ['WEB'], pricingModel: 'FIXED', items: [{ complexity: 'MEDIUM', hoursDev: 10 }] });
    expect(r.items[0].hoursDev).toBe(10);
    expect(r.items[0].hoursFunctional).toBeCloseTo(2.5, 6);
  });
});
