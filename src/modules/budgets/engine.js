// ============ PRESUPUESTOS — Motor de estimación ============
// Función pura: dada la spec del presupuesto, calcula horas/costo/precio/margen.
// Extraída verbatim de index.html. Sin side-effects ni dependencias de estado:
// sólo depende de las constantes del cotizador. Cubierta por tests/budgets.test.js.

import {
  COMPLEXITY_LEVELS,
  DISCIPLINE_PCT,
  ROLE_RATES,
  RISK_FACTORS_LIST,
  PRICING_MODELS,
} from './constants.js';

export function getBudgetCategories(b) {
  if (Array.isArray(b.categories) && b.categories.length) return b.categories;
  if (b.category) return [b.category];
  return ['WEB'];
}

// Motor de estimación: dada la spec del presupuesto, calcula horas/costo/precio/margen
export function estimateBudget(budget) {
  const cats = getBudgetCategories(budget);
  const items = (budget.items || []).map(item => {
    const complexity = COMPLEXITY_LEVELS.find(c => c.key === item.complexity) || COMPLEXITY_LEVELS[2];
    const hoursDev = Number(item.hoursDev) || complexity.default;

    const hoursFunctional = hoursDev * DISCIPLINE_PCT.functional;
    const hoursUX         = hoursDev * DISCIPLINE_PCT.ux;
    const hoursQA         = hoursDev * DISCIPLINE_PCT.qa;
    const hoursTraining   = hoursDev * DISCIPLINE_PCT.training;
    const hoursDocs       = hoursDev * DISCIPLINE_PCT.docs;
    const techSubtotal    = hoursFunctional + hoursUX + hoursDev + hoursQA + hoursTraining + hoursDocs;
    const hoursPM         = techSubtotal * DISCIPLINE_PCT.pm;
    const itemHours       = techSubtotal + hoursPM;

    const isAI    = cats.includes('AI');
    const devRate = isAI ? ROLE_RATES.AI : (complexity.devSenior ? ROLE_RATES.DEV_SR : ROLE_RATES.DEV_SSR);

    const cost =
      hoursFunctional * ROLE_RATES.FUNCTIONAL.cost +
      hoursUX         * ROLE_RATES.UX.cost +
      hoursDev        * devRate.cost +
      hoursQA         * ROLE_RATES.QA.cost +
      hoursTraining   * ROLE_RATES.FUNCTIONAL.cost +
      hoursDocs       * ROLE_RATES.FUNCTIONAL.cost +
      hoursPM         * ROLE_RATES.PM.cost;

    const revenue =
      hoursFunctional * ROLE_RATES.FUNCTIONAL.sale +
      hoursUX         * ROLE_RATES.UX.sale +
      hoursDev        * devRate.sale +
      hoursQA         * ROLE_RATES.QA.sale +
      hoursTraining   * ROLE_RATES.FUNCTIONAL.sale +
      hoursDocs       * ROLE_RATES.FUNCTIONAL.sale +
      hoursPM         * ROLE_RATES.PM.sale;

    return { ...item, hoursDev, hoursFunctional, hoursUX, hoursQA, hoursTraining, hoursDocs, hoursPM, itemHours, cost, revenue };
  });

  const totalByDiscipline = {
    functional: items.reduce((a,b) => a + b.hoursFunctional, 0),
    ux:         items.reduce((a,b) => a + b.hoursUX, 0),
    dev:        items.reduce((a,b) => a + b.hoursDev, 0),
    qa:         items.reduce((a,b) => a + b.hoursQA, 0),
    training:   items.reduce((a,b) => a + b.hoursTraining, 0),
    docs:       items.reduce((a,b) => a + b.hoursDocs, 0),
    pm:         items.reduce((a,b) => a + b.hoursPM, 0),
  };

  const baseHours   = items.reduce((a,b) => a + b.itemHours, 0);
  const baseCost    = items.reduce((a,b) => a + b.cost, 0);
  const baseRevenue = items.reduce((a,b) => a + b.revenue, 0);

  const activeRisks = budget.riskFactors || [];
  const riskSum = Math.min(1.0, activeRisks.reduce((sum, r) => {
    const factor = RISK_FACTORS_LIST.find(f => f.id === r.id);
    return sum + (Number(r.value) || factor?.def || 0);
  }, 0));

  const contingency = (Number(budget.contingencyPct) || 12) / 100;
  const multiplier  = (1 + riskSum) * (1 + contingency);
  const finalHours   = baseHours   * multiplier;
  const finalCost    = baseCost    * multiplier;
  const finalRevenue = baseRevenue * multiplier;
  const margin = finalRevenue > 0 ? ((finalRevenue - finalCost) / finalRevenue) * 100 : 0;

  const pricingModel = PRICING_MODELS.find(p => p.key === budget.pricingModel) || PRICING_MODELS[0];
  let marginStatus = 'red';
  if (margin >= pricingModel.targetMargin) marginStatus = 'green';
  else if (margin >= pricingModel.minMargin) marginStatus = 'yellow';

  return {
    items, totalByDiscipline,
    baseHours, finalHours, baseCost, finalCost, baseRevenue, finalRevenue,
    margin, marginStatus, riskSum, contingencyPct: contingency * 100,
    minMargin: pricingModel.minMargin, targetMargin: pricingModel.targetMargin, pricingModel,
  };
}
