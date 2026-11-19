// @vitest-environment jsdom
// ============================================================================
// Caracterización (golden-master) de la lógica financiera sensible.
// Congela el comportamiento ACTUAL antes de normalizar el motor a tablas
// relacionales (Fase 2). Cubre: pagos parciales, pago sintético (confirmado sin
// log), cotización CONGELADA por pago, mensualidades recurrentes y arrastres.
//
// Los snapshots capturan los números actuales = CONTRATO. Si un cambio los
// mueve, el test falla: eso es exactamente lo que queremos detectar.
// ============================================================================
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_STATE, S } from '../src/core/state.js';
import {
  getAllCashFlowPayments,
  getAutoIncomes,
  getCarryOversForMonth,
  getPaymentSummary,
} from '../src/modules/finance.js';

// Fixture determinístico (fechas e ids fijos → salida reproducible).
function buildFixture() {
  return {
    members: [{ id: 'me', name: 'Gonzalo', color: '#3b82f6' }],
    projects: [
      { id: 'p1', name: 'Abono A', status: 'ACTIVE_RECURRING', monthlyFee: 100, monthlyFeeCurrency: 'USD', startDate: '2026-01-01' },
    ],
    incomes: [
      // (a) manual CONFIRMADO sin payment log → pago sintético completo
      { id: 'i1', concept: 'Venta', amount: 50000, currency: 'ARS', date: '2026-03-05', status: 'CONFIRMED', exchangeRateAtTime: 1000 },
      // (b) manual con pagos PARCIALES (ARS + USD, tasas congeladas distintas)
      { id: 'i2', concept: 'Servicio', amount: 200000, currency: 'ARS', date: '2026-02-10', status: 'PENDING' },
      // (c) manual parcial de un mes anterior → arrastre (carry-over)
      { id: 'i3', concept: 'Carry', amount: 120000, currency: 'ARS', date: '2026-01-15', status: 'PENDING' },
    ],
    incomePayments: [
      { id: 'ip1', incomeId: 'i2', amount: 80000, currency: 'ARS', date: '2026-02-12', paidAt: '2026-02-12T10:00:00Z', exchangeRate: 1100 },
      { id: 'ip2', incomeId: 'i2', amount: 50, currency: 'USD', date: '2026-02-20', paidAt: '2026-02-20T10:00:00Z', exchangeRate: 1150 },
      { id: 'ip3', incomeId: 'i3', amount: 40000, currency: 'ARS', date: '2026-01-20', paidAt: '2026-01-20T10:00:00Z', exchangeRate: 1050 },
    ],
    expenses: [
      { id: 'e1', concept: 'Hosting', amount: 30, currency: 'USD', date: '2026-03-01', category: 'FIXED', recurring: true, status: 'PENDING' },
    ],
    expensePayments: [],
    recurringChargeLog: [
      { id: 'rc1', projectId: 'p1', month: '2026-03', amount: 100, currency: 'USD', date: '2026-03-03', chargedAt: '2026-03-03', exchangeRate: 1200 },
    ],
    recurringExpensePayments: [
      { id: 're1', expenseId: 'e1', month: '2026-03', amount: 30, currency: 'USD', date: '2026-03-02', paidAt: '2026-03-02T00:00:00Z', exchangeRate: 1210 },
    ],
    exchangeRate: 1200,
    exchangeRateSource: 'manual',
    defaultCurrency: 'ARS',
  };
}

// Suma de un listado de cash-flow a ARS, cada pago a SU tasa congelada.
function toArs(list) {
  return list.reduce((acc, p) => acc + (p.currency === 'USD' ? p.amount * p.exchangeRate : p.amount), 0);
}

beforeEach(() => {
  S.state = { ...structuredClone(DEFAULT_STATE), ...buildFixture() };
  S.currentMemberId = 'me';
});

describe('getPaymentSummary — pagos parciales y sintéticos', () => {
  it('ingreso confirmado sin log → pago sintético completo (PAID)', () => {
    const i1 = { ...S.state.incomes[0], _kind: 'income' };
    const s = getPaymentSummary(i1);
    expect(s.status).toBe('PAID');
    expect(s.totalPaid).toBe(50000);
    expect(s.payments[0].id).toBe('__synth__i1');
    expect(s).toMatchSnapshot();
  });

  it('ingreso con pagos parciales ARS+USD → PARTIAL (suma cruda de importes)', () => {
    const i2 = { ...S.state.incomes[1], _kind: 'income' };
    const s = getPaymentSummary(i2);
    expect(s.status).toBe('PARTIAL');
    expect(s.totalPaid).toBe(80050); // 80000 + 50 (suma cruda, como hoy)
    expect(s).toMatchSnapshot();
  });

  it('mensualidad recurrente cobrada → PAID a la tasa congelada del cobro', () => {
    const auto = getAutoIncomes('2026-03').find(x => x.projectId === 'p1');
    const s = getPaymentSummary(auto);
    expect(s.status).toBe('PAID');
    expect(s.payments[0].exchangeRate).toBe(1200);
    expect({ auto, summary: s }).toMatchSnapshot();
  });
});

describe('getAllCashFlowPayments — base caja a tasa congelada', () => {
  it('ingresos: explícitos + recurrentes + sintético, cada uno a su tasa', () => {
    const list = getAllCashFlowPayments('income');
    expect(list).toMatchSnapshot();
    // Invariante: la conversión a ARS usa la tasa de CADA pago, no la actual.
    expect(toArs(list)).toMatchSnapshot('income-total-ars');
  });

  it('gastos: recurrentes, a su tasa congelada', () => {
    const list = getAllCashFlowPayments('expense');
    expect(list).toMatchSnapshot();
    expect(toArs(list)).toMatchSnapshot('expense-total-ars');
  });
});

describe('getCarryOversForMonth — arrastres sólo de parciales anteriores', () => {
  it('marzo arrastra i2 (feb) e i3 (ene), ambos parciales', () => {
    const { incomes, expenses } = getCarryOversForMonth('2026-03');
    expect(expenses).toEqual([]);
    expect(incomes.map(i => i.id).sort()).toEqual(['i2', 'i3']);
    expect(incomes.every(i => i._carryOver)).toBe(true);
    expect(incomes).toMatchSnapshot();
  });
});
