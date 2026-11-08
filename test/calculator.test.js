import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculate,
  createDefaultInput,
  normalizeInput,
  savingsPlan,
  DEFAULT_ASSUMPTIONS,
} from '../assets/js/calculator.js';

const YEAR = 2026;

/** A family where both parents are identical unless overridden. */
function family(overrides = {}) {
  return {
    currentYear: YEAR,
    you: { age: 35, salary: 40000, agreement: 'yes', partTimePercent: 100, partTimeYears: 0 },
    partner: { age: 35, salary: 40000, agreement: 'yes', partTimePercent: 100, partTimeYears: 0 },
    children: [{ yourAgeAtBirth: 31, monthsYou: 10, monthsPartner: 10 }],
    vabShareYou: 0.5,
    ...overrides,
  };
}

const rowsByKey = (result) => Object.fromEntries(result.rows.map((r) => [r.key, r]));
const close = (actual, expected, tolerance = 1) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

test('equal sharing gives no compensation', () => {
  const r = calculate(family());
  close(r.total, 0);
  assert.equal(r.direction, 'even');
  for (const row of r.rows) close(row.amount, 0);
});

test('the parent at home more is compensated, and swapping roles flips the sign', () => {
  const a = calculate(family({ children: [{ yourAgeAtBirth: 31, monthsYou: 15, monthsPartner: 4 }] }));
  const b = calculate(family({ children: [{ yourAgeAtBirth: 31, monthsYou: 4, monthsPartner: 15 }] }));
  assert.ok(a.total > 0);
  assert.equal(a.direction, 'toYou');
  assert.equal(b.direction, 'toPartner');
  close(a.total, -b.total);
});

test('with equal salaries both compensation principles agree', () => {
  const base = family({
    you: { age: 40, salary: 45000, agreement: 'yes', partTimePercent: 80, partTimeYears: 3 },
    children: [
      { yourAgeAtBirth: 31, monthsYou: 14, monthsPartner: 5 },
      { yourAgeAtBirth: 34, monthsYou: 12, monthsPartner: 6 },
    ],
    partner: { age: 40, salary: 45000, agreement: 'yes' },
    vabShareYou: 0.7,
  });
  const excess = calculate({ ...base, principle: 'excess' });
  const equal = calculate({ ...base, principle: 'equal' });
  close(excess.total, equal.total, 5);
});

test('part time: half of the extra lost salary is compensated', () => {
  // First child born this year, so no inflation adjustment of the salary and
  // the part time (starting after the leave) lies in the future.
  const r = calculate(family({
    you: { age: 30, salary: 50000, agreement: 'yes', partTimePercent: 80, partTimeYears: 1 },
    partner: { age: 30, salary: 50000, agreement: 'yes' },
    children: [{ yourAgeAtBirth: 30, monthsYou: 6, monthsPartner: 6 }],
  }));
  const partTime = rowsByKey(r).partTime;
  // Salary grows with inflation and is deflated back, so the real salary is
  // constant: 20 % × 50 000 × 12 months.
  close(partTime.you, 120000, 1);
  close(partTime.amount, 60000, 1);
});

test('vab: lost salary is the part not covered by tillfällig föräldrapenning', () => {
  const S = 30000; // below the vab ceiling
  const r = calculate(family({
    you: { age: 30, salary: S, agreement: 'yes' },
    partner: { age: 30, salary: S, agreement: 'yes' },
    children: [{ yourAgeAtBirth: 30, monthsYou: 6, monthsPartner: 6 }],
    vabShareYou: 0.7,
  }));
  const A = DEFAULT_ASSUMPTIONS;
  const years = A.vabToAge - A.vabFromAge;
  const dailyLoss = ((12 * S) / A.workDaysPerYear) * (1 - A.benefitRate);
  const extraDays = years * A.vabDaysPerChildYear * (0.7 - 0.3);
  close(rowsByKey(r).vab.amount, (extraDays * dailyLoss) / 2, 1);
});

test('föräldralön lowers the loss compared to no collective agreement', () => {
  const withAgreement = calculate(family({ children: [{ yourAgeAtBirth: 31, monthsYou: 12, monthsPartner: 0 }] }));
  const without = calculate(family({
    you: { age: 35, salary: 40000, agreement: 'no' },
    partner: { age: 35, salary: 40000, agreement: 'no' },
    children: [{ yourAgeAtBirth: 31, monthsYou: 12, monthsPartner: 0 }],
  }));
  assert.ok(rowsByKey(without).leave.amount > rowsByKey(withAgreement).leave.amount);
});

test('premiebefrielse removes the pension loss for the first 13 months of leave', () => {
  // Switch off vab and salary development so only the leave affects pension.
  const isolate = { wagePenalty: 0, vabDaysPerChildYear: 0 };
  const input = family({ children: [{ yourAgeAtBirth: 31, monthsYou: 12, monthsPartner: 0 }] });
  const waived = calculate({ ...input, assumptions: isolate });
  const notWaived = calculate({ ...input, assumptions: { ...isolate, premiumWaiver: false } });
  close(rowsByKey(waived).occupationalPension.you, 0, 1);
  assert.ok(rowsByKey(notWaived).occupationalPension.you > 0);
});

test('salary development loss follows the share of home time', () => {
  const r = calculate(family({
    children: [{ yourAgeAtBirth: 31, monthsYou: 15, monthsPartner: 5 }],
    assumptions: { wagePenalty: 0.025, wagePenaltyYears: 5 },
  }));
  const career = rowsByKey(r).career;
  // share 0.75 → you carry 75 % of a full penalty, the partner 25 %;
  // compensation is (0.75 − 0.5) of your full penalty.
  close(career.amount, (career.you / 0.75) * 0.25, 1);
  close(r.facts.shareYou, 0.75, 1e-9);
});

test('public pension is only counted when enabled and outside barnårsrätt years', () => {
  const input = family({
    you: { age: 45, salary: 30000, agreement: 'yes', partTimePercent: 75, partTimeYears: 6 },
    partner: { age: 45, salary: 30000, agreement: 'yes' },
    children: [{ yourAgeAtBirth: 33, monthsYou: 12, monthsPartner: 6 }],
  });
  const off = calculate(input);
  assert.equal(rowsByKey(off).publicPension, undefined);
  const on = calculate({ ...input, assumptions: { publicPension: true } });
  assert.ok(rowsByKey(on).publicPension.amount > 0);
  const noCredit = calculate({ ...input, assumptions: { publicPension: true, childYearCredit: false } });
  assert.ok(rowsByKey(noCredit).publicPension.amount > rowsByKey(on).publicPension.amount);
});

test('savings plan reaches the target', () => {
  const target = 500000;
  const plan = savingsPlan(target, 20, 20, 0);
  close(plan.monthly, target / 240, 1e-6);
  close(plan.lumpSum, target, 1e-6);

  const rate = 0.04;
  const growing = savingsPlan(target, 20, 5, rate);
  const i = Math.pow(1 + rate, 1 / 12) - 1;
  const fv = growing.monthly * ((Math.pow(1 + i, 60) - 1) / i) * Math.pow(1 + rate, 15);
  close(fv, target, 1e-3);
  close(growing.lumpSum * Math.pow(1 + rate, 20), target, 1e-3);
});

test('normalizeInput clamps and fills in defaults', () => {
  const input = normalizeInput({
    you: { age: 120, salary: '45 000', agreement: 'maybe' },
    children: [{ yourAgeAtBirth: 10, monthsYou: 99, monthsPartner: -3 }],
    vabShareYou: 5,
    assumptions: { retirementAge: 90, unknownKey: 1, publicPension: 1 },
  });
  assert.equal(input.you.age, 66);
  assert.equal(input.you.salary, 45000);
  assert.equal(input.you.agreement, 'unknown');
  assert.equal(input.partner.age, 66);
  assert.equal(input.children[0].yourAgeAtBirth, 14);
  assert.equal(input.children[0].monthsYou, 36);
  assert.equal(input.children[0].monthsPartner, 0);
  assert.equal(input.vabShareYou, 1);
  assert.equal(input.assumptions.retirementAge, 75);
  assert.equal(input.assumptions.publicPension, true);
  assert.equal('unknownKey' in input.assumptions, false);
});

test('default input calculates without errors', () => {
  const r = calculate(createDefaultInput(YEAR));
  assert.ok(Number.isFinite(r.total));
  assert.ok(r.rows.every((row) => Number.isFinite(row.amount)));
});

test('a family without children only compares part time', () => {
  const r = calculate(family({
    you: { age: 35, salary: 40000, agreement: 'yes', partTimePercent: 80, partTimeYears: 2 },
    children: [],
  }));
  close(rowsByKey(r).leave.amount, 0);
  close(rowsByKey(r).vab.amount, 0);
  assert.ok(rowsByKey(r).partTime.amount > 0);
});
