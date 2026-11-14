import { calculate, createChild, DEFAULT_ASSUMPTIONS } from './calculator.js';
import {
  h, clear, uid, formatMoney, formatMoneyPerMonth, formatNumber, formatPercent, parseNumber, formatInputNumber,
} from './dom.js';
import { t } from './i18n.js';

const ROW_KEYS = ['leave', 'partTime', 'vab', 'career', 'occupationalPension', 'publicPension'];

let lastResult = null;
let heroObserver = null;

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function renderResults(root, ctx) {
  const result = calculate(ctx.input);
  lastResult = result;

  const page = h('div', { class: 'results' },
    h('section', { class: 'card hero', id: 'result-hero', 'aria-live': 'polite' }),
    h('div', { class: 'results__grid' },
      h('section', { class: 'card', id: 'result-breakdown', 'aria-labelledby': 'breakdown-title' }),
      h('section', { class: 'card', id: 'result-compare', 'aria-labelledby': 'compare-title' })),
    h('section', { class: 'card facts', id: 'result-facts', 'aria-labelledby': 'facts-title' }),
    h('section', { class: 'card explain', id: 'result-explain', 'aria-labelledby': 'explain-title' }),
    renderAdjust(ctx),
    renderWays(),
    renderMethod(),
    h('div', { class: 'sticky-summary', id: 'sticky-summary', hidden: true }));

  root.append(page);
  fillDynamic(root, ctx, result);
  observeHero(root);
}

/** Re-render the parts that depend on the result, keeping focus. */
export function updateResults(root, ctx) {
  const activeId = document.activeElement?.id;
  const result = calculate(ctx.input);
  lastResult = result;
  fillDynamic(root, ctx, result);
  if (activeId && document.activeElement?.id !== activeId) document.getElementById(activeId)?.focus();
}

function fillDynamic(root, ctx, result) {
  replace(root.querySelector('#result-hero'), renderHero(ctx, result));
  replace(root.querySelector('#result-breakdown'), renderBreakdown(result));
  replace(root.querySelector('#result-compare'), renderCompare(result));
  replace(root.querySelector('#result-facts'), renderFacts(result));
  replace(root.querySelector('#result-explain'), renderExplain(root, result));
  replace(root.querySelector('#sticky-summary'), renderSticky(result));
  syncPartTimePlaceholders(root, result);
}

function replace(el, children) {
  if (!el) return;
  clear(el);
  for (const child of [children].flat()) if (child) el.append(child);
}

// ---------------------------------------------------------------------------
// Hero: the headline amount and how it can be evened out
// ---------------------------------------------------------------------------

function directionText(result) {
  if (result.direction === 'toYou') return t('result.toYou');
  if (result.direction === 'toPartner') return t('result.toPartner');
  return t('result.even');
}

const SAVINGS_YEARS = [1, 3, 5, 10, 15, 20];

function renderHero(ctx, result) {
  const { savings, pension } = result;
  const even = result.direction === 'even';
  const A = ctx.input.assumptions;

  const options = SAVINGS_YEARS.filter((n) => n < savings.maxYears);
  const selected = options.includes(ctx.input.savingsYears) ? ctx.input.savingsYears : null;
  const select = h('select', {
    id: 'savings-years',
    class: 'select select--inline',
    onchange: (e) => {
      ctx.input.savingsYears = e.target.value === 'retirement' ? null : Number(e.target.value);
      ctx.changed();
    },
  },
  options.map((n) => h('option', { value: String(n), selected: selected === n }, formatYears(n))),
  h('option', { value: 'retirement', selected: selected === null }, t('result.untilRetirement', { n: savings.maxYears })));

  // A link to a local file only works on this computer, so it is not offered.
  const canShare = window.location.protocol !== 'file:';

  return [
    h('div', { class: 'hero__main' },
      h('p', { class: 'eyebrow' }, t('result.eyebrow')),
      h('h1', { class: 'hero__direction', tabindex: '-1', 'data-autofocus': true }, directionText(result)),
      even ? null : h('p', { class: `hero__amount hero__amount--${result.direction}` }, formatMoney(savings.lumpSum)),
      h('p', { class: 'hero__lead' }, even ? t('result.evenText') : t('result.lead')),
      h('div', { class: 'hero__actions' },
        h('a', { class: 'button button--primary', href: '#adjust', onclick: (e) => scrollToAdjust(e) }, t('actions.adjust')),
        canShare
          ? h('button', { type: 'button', class: 'button button--ghost button--small', id: 'copy-link', onclick: (e) => copyLink(e.currentTarget, ctx) }, t('actions.copy'))
          : null,
        h('button', { type: 'button', class: 'button button--ghost button--small', id: 'print', onclick: () => window.print() }, t('actions.print')),
        h('button', { type: 'button', class: 'button button--ghost button--small', id: 'restart', onclick: () => ctx.restart() }, t('actions.restart')))),
    even ? null : h('div', { class: 'suggest' },
      h('h2', { class: 'suggest__title' }, t('suggest.title')),
      h('div', { class: 'suggest__option' },
        h('p', { class: 'suggest__label' }, t('suggest.lumpLabel')),
        h('p', { class: 'suggest__value', id: 'suggest-lump' }, formatMoney(savings.lumpSum)),
        h('p', { class: 'hero__note' }, t('suggest.lumpText'))),
      h('p', { class: 'suggest__or' }, t('suggest.or')),
      h('div', { class: 'suggest__option' },
        h('p', { class: 'suggest__label' }, t('suggest.monthlyLabel')),
        h('p', { class: 'suggest__value', id: 'suggest-monthly' }, t('result.monthly', { amount: formatMoney(savings.monthly) })),
        h('div', { class: 'field field--inline' },
          h('label', { for: 'savings-years', class: 'field__label' }, t('result.savingsPeriod')),
          select),
        h('p', { class: 'hero__note' }, t('suggest.monthlyText', {
          total: formatMoney(savings.totalPaid),
          years: formatYears(savings.years),
          rate: formatPercent(A.savingsReturn, 1),
        }))),
      savings.yearsToRetirement > 0
        ? h('p', { class: 'hero__note' }, t('suggest.growth', {
          years: formatNumber(savings.yearsToRetirement),
          amount: formatMoney(savings.valueAtRetirement),
        }))
        : null,
      pension.compensation.perMonth >= 1
        ? h('p', { class: 'hero__note' }, t('result.pensionMonthly', {
          capital: formatMoney(pension.compensation.valueToday),
          amount: formatMoney(pension.compensation.perMonth),
          years: formatNumber(A.payoutYears),
        }))
        : null),
  ];
}

function scrollToAdjust(event) {
  event.preventDefault();
  const target = document.getElementById('adjust');
  target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  target?.querySelector('input, select')?.focus({ preventScroll: true });
}

async function copyLink(button, ctx) {
  const url = ctx.shareUrl();
  const original = t('actions.copy');
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = t('actions.copied');
  } catch {
    window.prompt(t('actions.copyFailed'), url);
  }
  setTimeout(() => { if (button.isConnected) button.textContent = original; }, 2500);
}

// ---------------------------------------------------------------------------
// Breakdown: compensation per part as a bar list
// ---------------------------------------------------------------------------

function renderBreakdown(result) {
  const rows = result.rows.filter((r) => ROW_KEYS.includes(r.key));
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.amount)));
  const hasToPartner = rows.some((r) => r.amount < -0.5);
  const hasToYou = rows.some((r) => r.amount > 0.5);
  const tooltip = h('div', { class: 'tooltip', role: 'presentation', hidden: true });

  const list = h('ul', { class: 'bar-list' },
    rows.map((row) => {
      const dir = row.amount < 0 ? 'toPartner' : 'toYou';
      const share = Math.abs(row.amount) / max;
      const item = h('li', { class: 'bar-list__row' },
        h('div', { class: 'bar-list__label' },
          h('span', { class: 'bar-list__name' }, t(`row.${row.key}`)),
          h('span', { class: 'bar-list__desc' }, t(`row.${row.key}.desc`))),
        h('div', { class: 'bar-list__track', 'aria-hidden': 'true' },
          share > 0.001 ? h('span', { class: `bar bar--${dir}`, style: { width: `${Math.max(share * 100, 1.5)}%` } }) : null),
        h('div', { class: 'bar-list__value' },
          h('span', { class: 'num' }, formatMoney(Math.abs(row.amount))),
          Math.abs(row.amount) > 0.5 && hasToPartner
            ? h('span', { class: 'bar-list__dir' }, t(row.amount < 0 ? 'breakdown.toPartner' : 'breakdown.toYou'))
            : null));
      attachTooltip(item, tooltip, () => [
        [t('tooltip.you'), formatMoney(row.you)],
        [t('tooltip.partner'), formatMoney(row.partner)],
        [t('tooltip.compensation'), `${formatMoney(Math.abs(row.amount))}${Math.abs(row.amount) > 0.5 ? ` ${t(row.amount < 0 ? 'breakdown.toPartner' : 'breakdown.toYou')}` : ''}`],
      ], t(`row.${row.key}`));
      return item;
    }),
    h('li', { class: 'bar-list__row bar-list__row--total' },
      h('div', { class: 'bar-list__label' }, h('span', { class: 'bar-list__name' }, t('breakdown.total'))),
      h('div', { class: 'bar-list__track', 'aria-hidden': 'true' }),
      h('div', { class: 'bar-list__value' },
        h('span', { class: 'num' }, formatMoney(Math.abs(result.total))),
        result.direction !== 'even'
          ? h('span', { class: 'bar-list__dir' }, t(result.direction === 'toPartner' ? 'breakdown.toPartner' : 'breakdown.toYou'))
          : null)));

  return [
    h('h2', { class: 'card__title', id: 'breakdown-title' }, t('breakdown.title')),
    h('p', { class: 'card__sub' }, t('breakdown.sub')),
    hasToPartner && hasToYou
      ? h('ul', { class: 'legend' },
        h('li', {}, h('span', { class: 'swatch swatch--toYou', 'aria-hidden': 'true' }), t('legend.toYou')),
        h('li', {}, h('span', { class: 'swatch swatch--toPartner', 'aria-hidden': 'true' }), t('legend.toPartner')))
      : null,
    h('div', { class: 'chart' }, list, tooltip),
  ];
}

function attachTooltip(target, tooltip, linesFn, title) {
  const show = (event) => {
    clear(tooltip);
    tooltip.append(
      h('p', { class: 'tooltip__title' }, title),
      ...linesFn().map(([label, value]) => h('p', { class: 'tooltip__line' }, h('span', {}, label), h('span', { class: 'num' }, value))),
    );
    tooltip.hidden = false;
    move(event);
  };
  const move = (event) => {
    const box = tooltip.parentElement.getBoundingClientRect();
    const x = Math.min(event.clientX - box.left + 14, box.width - tooltip.offsetWidth - 4);
    const y = event.clientY - box.top + 14;
    tooltip.style.transform = `translate(${Math.max(0, x)}px, ${y}px)`;
  };
  target.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') show(e); });
  target.addEventListener('pointermove', (e) => { if (!tooltip.hidden) move(e); });
  target.addEventListener('pointerleave', () => { tooltip.hidden = true; });
}

// ---------------------------------------------------------------------------
// Compare: each parent's own losses, grouped bars + table view
// ---------------------------------------------------------------------------

function renderCompare(result) {
  const rows = result.rows;
  const max = Math.max(1, ...rows.flatMap((r) => [r.you, r.partner]));
  const tooltip = h('div', { class: 'tooltip', role: 'presentation', hidden: true });

  const bar = (who, value) => h('div', { class: 'pair__bar' },
    h('span', { class: 'visually-hidden' }, `${t(`compare.${who}`)}: `),
    value / max > 0.001 ? h('span', { class: `bar bar--${who}`, style: { '--v': value / max }, 'aria-hidden': 'true' }) : h('span', { class: 'bar bar--empty', 'aria-hidden': 'true' }),
    h('span', { class: 'pair__value num' }, formatMoney(value)));

  const pairs = h('ul', { class: 'pairs' },
    rows.map((row) => {
      const item = h('li', { class: 'pair' },
        h('p', { class: 'pair__label' }, t(`row.${row.key}`)),
        bar('you', row.you),
        bar('partner', row.partner));
      attachTooltip(item, tooltip, () => [
        [t('compare.you'), formatMoney(row.you)],
        [t('compare.partner'), formatMoney(row.partner)],
      ], t(`row.${row.key}`));
      return item;
    }));

  const table = h('table', { class: 'data-table' },
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, t('compare.colPart')),
      h('th', { scope: 'col', class: 'num' }, t('compare.you')),
      h('th', { scope: 'col', class: 'num' }, t('compare.partner')),
      h('th', { scope: 'col', class: 'num' }, t('compare.colCompensation')))),
    h('tbody', {},
      rows.map((row) => h('tr', {},
        h('th', { scope: 'row' }, t(`row.${row.key}`)),
        h('td', { class: 'num' }, formatMoney(row.you)),
        h('td', { class: 'num' }, formatMoney(row.partner)),
        h('td', { class: 'num' }, signedCompensation(row.amount))))),
    h('tfoot', {},
      h('tr', {},
        h('th', { scope: 'row' }, t('compare.total')),
        h('td', { class: 'num' }, formatMoney(result.losses.you)),
        h('td', { class: 'num' }, formatMoney(result.losses.partner)),
        h('td', { class: 'num' }, signedCompensation(result.total))),
      h('tr', {},
        h('th', { scope: 'row' }, t('compare.pensionPerMonth')),
        h('td', { class: 'num' }, formatMoneyPerMonth(result.pension.you.perMonth)),
        h('td', { class: 'num' }, formatMoneyPerMonth(result.pension.partner.perMonth)),
        h('td', {}))));

  return [
    h('h2', { class: 'card__title', id: 'compare-title' }, t('compare.title')),
    h('p', { class: 'card__sub' }, t('compare.sub')),
    h('ul', { class: 'legend' },
      h('li', {}, h('span', { class: 'swatch swatch--you', 'aria-hidden': 'true' }), t('compare.you')),
      h('li', {}, h('span', { class: 'swatch swatch--partner', 'aria-hidden': 'true' }), t('compare.partner'))),
    h('div', { class: 'chart' }, pairs, tooltip),
    h('div', { class: 'compare__totals' },
      h('p', {}, h('span', { class: 'swatch swatch--you', 'aria-hidden': 'true' }), `${t('compare.you')}: `, h('strong', { class: 'num' }, formatMoney(result.losses.you))),
      h('p', {}, h('span', { class: 'swatch swatch--partner', 'aria-hidden': 'true' }), `${t('compare.partner')}: `, h('strong', { class: 'num' }, formatMoney(result.losses.partner)))),
    h('details', { class: 'disclosure' },
      h('summary', {}, t('compare.table')),
      h('div', { class: 'table-scroll' }, table)),
  ];
}

function formatMonths(months) {
  const rounded = Math.round(months * 10) / 10;
  return formatNumber(rounded, Number.isInteger(rounded) ? 0 : 1);
}

function formatYears(years) {
  return `${formatMonths(years)} ${t(years === 1 ? 'unit.year' : 'unit.years')}`;
}

function signedCompensation(amount) {
  if (Math.abs(amount) < 0.5) return formatMoney(0);
  return `${formatMoney(Math.abs(amount))} ${t(amount < 0 ? 'breakdown.toPartner' : 'breakdown.toYou')}`;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

function renderFacts(result) {
  const { facts, input } = result;
  const totalMonths = facts.homeMonths.you.total + facts.homeMonths.partner.total;
  const item = (label, value) => h('div', { class: 'facts__item' }, h('dt', {}, label), h('dd', {}, value));
  return [
    h('h2', { class: 'card__title', id: 'facts-title' }, t('facts.title')),
    h('dl', { class: 'facts__list' },
      item(t('facts.share'), t('facts.shareValue', {
        share: formatPercent(facts.shareYou),
        you: formatMonths(facts.homeMonths.you.total),
        total: formatMonths(totalMonths),
      })),
      item(t('facts.salary'), t('facts.salaryValue', {
        you: formatMoney(facts.salaryToday.you),
        partner: formatMoney(facts.salaryToday.partner),
      })),
      item(t('facts.retirement'), t('facts.retirementValue', {
        you: `${facts.yearsToRetirement.you} ${t('unit.years')}`,
        partner: `${facts.yearsToRetirement.partner} ${t('unit.years')}`,
      })),
      item(t('facts.principle'), t(`principle.${input.principle}`))),
  ];
}

// ---------------------------------------------------------------------------
// Step by step: the figures behind every part, with the family's own numbers
// ---------------------------------------------------------------------------

const EXPLAIN_FORMATS = {
  money: (v) => formatMoney(v),
  perMonth: (v) => formatMoneyPerMonth(v),
  months: (v) => `${formatMonths(v)} ${t('unit.months')}`,
  years: (v) => formatYears(v),
  days: (v) => `${formatMonths(v)} ${t('unit.days')}`,
  percent: (v) => formatPercent(v),
};

/** [key in result.explain[who][part], format, is the sum of the part] */
const EXPLAIN_PARTS = [
  ['leave', [['months', 'months'], ['salary', 'perMonth'], ['benefit', 'perMonth'], ['lossPerMonth', 'perMonth'], ['total', 'money', true]]],
  ['partTime', [['percent', 'percent'], ['years', 'years'], ['salary', 'perMonth'], ['lossPerMonth', 'perMonth'], ['total', 'money', true]]],
  ['vab', [['share', 'percent'], ['days', 'days'], ['wagePerDay', 'money'], ['benefitPerDay', 'money'], ['lossPerDay', 'money'], ['total', 'money', true]]],
  ['career', [['share', 'percent'], ['full', 'money'], ['total', 'money', true]]],
  ['pension', [['leave', 'money'], ['partTime', 'money'], ['vab', 'money'], ['career', 'money'], ['valueToday', 'money', true], ['atRetirement', 'money'], ['perMonth', 'perMonth']]],
];

function explainNote(part, result, row) {
  const { explain, input } = result;
  const { amount } = row;
  if (Math.abs(amount) < 0.5) return t('explain.none');
  const who = amount > 0 ? 'you' : 'partner';
  const values = {
    amount: formatMoney(Math.abs(amount)),
    to: t(amount > 0 ? 'breakdown.toYou' : 'breakdown.toPartner'),
  };
  if (input.principle === 'equal') {
    return t('explain.equal', { ...values, a: formatMoney(row.you), b: formatMoney(row.partner) });
  }
  if (part === 'pension') return t('explain.pension.note', values);
  const beyond = explain.beyondHalf[part] * (amount > 0 ? 1 : -1);
  if (!(beyond > 0)) return t('explain.generic', values);
  const beyondText = {
    leave: () => EXPLAIN_FORMATS.months(beyond),
    partTime: () => '',
    vab: () => EXPLAIN_FORMATS.days(beyond),
    career: () => formatNumber(beyond * 100, 0),
  }[part]();
  return t(`explain.${part}.note.${who}`, { ...values, beyond: beyondText });
}

function renderExplain(root, result) {
  const { explain, input, savings } = result;
  const A = input.assumptions;
  const byKey = Object.fromEntries(result.rows.map((r) => [r.key, r]));
  const pensionRows = ['occupationalPension', 'publicPension'].map((key) => byKey[key]).filter(Boolean);
  const rowFor = (part) => (part === 'pension'
    ? {
      amount: pensionRows.reduce((acc, r) => acc + r.amount, 0),
      you: pensionRows.reduce((acc, r) => acc + r.you, 0),
      partner: pensionRows.reduce((acc, r) => acc + r.partner, 0),
    }
    : byKey[part]);

  const labelValues = {
    days: formatNumber(A.vabDaysPerChildYear),
    from: formatNumber(A.vabFromAge),
    to: formatNumber(A.vabToAge),
    penalty: formatPercent(A.wagePenalty, 1),
    period: A.wagePenaltyPermanent
      ? t('explain.career.permanent')
      : t('explain.career.years', { n: formatNumber(A.wagePenaltyYears) }),
    years: formatNumber(A.payoutYears),
  };
  const cell = (value, format) => h('td', { class: 'num' },
    value === null || value === undefined ? '–' : EXPLAIN_FORMATS[format](value));

  // Keep the parts the reader has opened when the result is re-rendered.
  const open = new Set([...root.querySelectorAll('#result-explain details[open]')].map((d) => d.dataset.part));

  const part = (key, title, amountText, content) => h('details', { class: 'explain__part', dataset: { part: key }, open: open.has(key) },
    h('summary', {},
      h('span', { class: 'explain__name' }, title),
      h('span', { class: 'explain__amount num' }, amountText)),
    content);

  const parts = EXPLAIN_PARTS.map(([key, lines]) => {
    const row = rowFor(key);
    return part(key, t(key === 'pension' ? 'explain.pension.title' : `row.${key}`), signedCompensation(row.amount), [
      h('div', { class: 'table-scroll' },
        h('table', { class: 'data-table explain__table' },
          h('thead', {}, h('tr', {},
            h('td', {}),
            h('th', { scope: 'col', class: 'num' }, t('compare.you')),
            h('th', { scope: 'col', class: 'num' }, t('compare.partner')))),
          h('tbody', {}, lines.map(([field, format, isTotal]) => h('tr', { class: isTotal ? 'is-total' : null },
            h('th', { scope: 'row' }, t(`explain.${key}.${field}`, labelValues)),
            cell(explain.you[key][field], format),
            cell(explain.partner[key][field], format)))))),
      h('p', { class: 'explain__note' }, h('strong', {}, `${t('explain.compensation')}: `), explainNote(key, result, row)),
    ]);
  });

  const suggestionLines = [
    ['lumpSum', formatMoney(savings.lumpSum), true],
    ['period', `${formatYears(savings.years)} (${formatNumber(savings.months)} ${t('unit.months')})`],
    ['rate', formatPercent(savings.rate, 1)],
    ['monthly', formatMoneyPerMonth(savings.monthly), true],
    ['totalPaid', formatMoney(savings.totalPaid)],
    ['atRetirement', formatMoney(savings.valueAtRetirement)],
  ];
  const suggestion = result.direction === 'even' ? null : part('suggestion', t('explain.suggest.title'),
    `${formatMoney(savings.lumpSum)} · ${formatMoneyPerMonth(savings.monthly)}`, [
      h('div', { class: 'table-scroll' },
        h('table', { class: 'data-table explain__table' },
          h('tbody', {}, suggestionLines.map(([field, value, isTotal]) => h('tr', { class: isTotal ? 'is-total' : null },
            h('th', { scope: 'row' }, t(`explain.suggest.${field}`, { years: formatNumber(savings.yearsToRetirement) })),
            h('td', { class: 'num' }, value)))))),
      h('p', { class: 'explain__note' }, t('explain.suggest.note')),
    ]);

  return [
    h('h2', { class: 'card__title', id: 'explain-title' }, t('explain.title')),
    h('p', { class: 'card__sub' }, t('explain.sub')),
    h('div', { class: 'explain__parts' }, parts, suggestion),
  ];
}

// Print everything, including the parts that are folded.
if (typeof window !== 'undefined') {
  let folded = [];
  window.addEventListener('beforeprint', () => {
    folded = [...document.querySelectorAll('details:not([open])')];
    folded.forEach((d) => { d.open = true; });
  });
  window.addEventListener('afterprint', () => {
    folded.forEach((d) => { d.open = false; });
    folded = [];
  });
}

// ---------------------------------------------------------------------------
// Sticky summary bar
// ---------------------------------------------------------------------------

function renderSticky(result) {
  const label = result.direction === 'even' ? t('sticky.even') : t(`sticky.${result.direction}`);
  return h('div', { class: 'sticky-summary__inner' },
    h('p', { class: 'sticky-summary__text' },
      h('span', {}, `${label}: `),
      h('strong', { class: 'num' }, formatMoney(Math.abs(result.total)))),
    h('button', {
      type: 'button',
      class: 'button button--small',
      onclick: () => {
        document.getElementById('result-hero')?.scrollIntoView({ behavior: 'smooth' });
      },
    }, t('actions.toTop')));
}

function observeHero(root) {
  heroObserver?.disconnect();
  const hero = root.querySelector('#result-hero');
  const sticky = root.querySelector('#sticky-summary');
  if (!hero || !sticky || !('IntersectionObserver' in window)) return;
  heroObserver = new IntersectionObserver(([entry]) => {
    sticky.hidden = entry.isIntersecting;
  }, { threshold: 0 });
  heroObserver.observe(hero);
}

// ---------------------------------------------------------------------------
// Adjust form – rendered once, edits update the result live
// ---------------------------------------------------------------------------

function numberField({ id = uid('n'), label, value, min, max, step = 1, onValue, placeholder, format = false, unit }) {
  const input = h('input', {
    id,
    class: 'input',
    type: format ? 'text' : 'number',
    inputmode: step < 1 ? 'decimal' : 'numeric',
    min,
    max,
    step,
    placeholder,
    value: value === null || value === undefined ? '' : (format ? formatInputNumber(value) : String(value)),
    oninput: (e) => {
      const n = parseNumber(e.target.value);
      if (e.target.value.trim() === '' && placeholder !== undefined) {
        onValue(null);
        return;
      }
      if (!Number.isFinite(n)) return;
      if (min !== undefined && n < min) return;
      if (max !== undefined && n > max) return;
      onValue(n);
    },
    onblur: (e) => {
      const n = parseNumber(e.target.value);
      if (format && Number.isFinite(n)) e.target.value = formatInputNumber(n);
    },
  });
  return h('div', { class: 'field' },
    h('label', { class: 'field__label', for: id }, label),
    unit ? h('div', { class: 'input-wrap' }, input, h('span', { class: 'input-wrap__unit', 'aria-hidden': 'true' }, unit)) : input);
}

function selectField({ id = uid('s'), label, value, options, onValue }) {
  return h('div', { class: 'field' },
    h('label', { class: 'field__label', for: id }, label),
    h('select', { id, class: 'select', onchange: (e) => onValue(e.target.value) },
      options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label))));
}

function checkboxField({ id = uid('c'), label, checked, onValue }) {
  return h('div', { class: 'checkbox' },
    h('input', { type: 'checkbox', id, checked, onchange: (e) => onValue(e.target.checked) }),
    h('label', { for: id }, label));
}

function personFields(ctx, who) {
  const person = ctx.input[who];
  const change = () => ctx.changed();
  return h('fieldset', { class: 'adjust__person' },
    h('legend', { class: `adjust__legend adjust__legend--${who}` },
      h('span', { class: `swatch swatch--${who}`, 'aria-hidden': 'true' }), t(`adjust.${who}`)),
    numberField({
      id: `${who}-age`,
      label: t('field.age'),
      value: person.age,
      min: 18,
      max: 66,
      onValue: (v) => {
        person.age = Math.round(v);
        if (who === 'partner') ctx.partnerAgeLinked = false;
        if (who === 'you' && ctx.partnerAgeLinked) {
          ctx.input.partner.age = person.age;
          const partnerAge = document.getElementById('partner-age');
          if (partnerAge) partnerAge.value = String(person.age);
        }
        change();
      },
    }),
    numberField({
      id: `${who}-salary`,
      label: t('field.salary'),
      value: person.salary,
      min: 0,
      max: 1000000,
      format: true,
      unit: t('unit.krMonth'),
      onValue: (v) => { person.salary = v; change(); },
    }),
    selectField({
      id: `${who}-agreement`,
      label: t('field.agreement'),
      value: person.agreement,
      options: ['yes', 'no', 'unknown'].map((v) => ({ value: v, label: t(`option.${v}`) })),
      onValue: (v) => { person.agreement = v; change(); },
    }),
    h('div', { class: 'field-row field-row--tight' },
      numberField({
        id: `${who}-pt-percent`,
        label: t('field.partTimePercent'),
        value: person.partTimePercent,
        min: 0,
        max: 100,
        step: 5,
        onValue: (v) => { person.partTimePercent = v; change(); },
      }),
      numberField({
        id: `${who}-pt-years`,
        label: t('field.partTimeYears'),
        value: person.partTimeYears,
        min: 0,
        max: 40,
        step: 0.5,
        onValue: (v) => { person.partTimeYears = v; change(); },
      })),
    numberField({
      id: `${who}-pt-start`,
      label: t('field.partTimeStartAge'),
      value: person.partTimeStartAge,
      min: 14,
      max: 70,
      placeholder: '',
      onValue: (v) => { person.partTimeStartAge = v === null ? null : Math.round(v); change(); },
    }));
}

/** Show the automatic part-time start age as placeholder text. */
function syncPartTimePlaceholders(root, result) {
  const { facts, input } = result;
  for (const who of ['you', 'partner']) {
    const field = root.querySelector(`#${who}-pt-start`);
    if (!field) continue;
    const age = input[who].age - (input.currentYear - facts.partTimeStart.defaultStart);
    field.placeholder = t('field.partTimeStartAuto', { age: formatNumber(Math.floor(age)) });
  }
}

function childFields(ctx, child, index) {
  const change = () => ctx.changed();
  return h('li', { class: 'child-row' },
    h('p', { class: 'child-row__title' }, t('adjust.child', { n: index + 1 })),
    numberField({
      id: `child-${index}-age`,
      label: t('field.childAge'),
      value: child.yourAgeAtBirth,
      min: 14,
      max: ctx.input.you.age + 5,
      onValue: (v) => { child.yourAgeAtBirth = Math.round(v); change(); },
    }),
    numberField({
      id: `child-${index}-you`,
      label: t('field.monthsYou'),
      value: child.monthsYou,
      min: 0,
      max: 36,
      step: 0.5,
      onValue: (v) => { child.monthsYou = v; change(); },
    }),
    numberField({
      id: `child-${index}-partner`,
      label: t('field.monthsPartner'),
      value: child.monthsPartner,
      min: 0,
      max: 36,
      step: 0.5,
      onValue: (v) => { child.monthsPartner = v; change(); },
    }),
    h('button', {
      type: 'button',
      class: 'button button--ghost button--small child-row__remove',
      'aria-label': t('adjust.removeChildLabel', { n: index + 1 }),
      onclick: () => {
        ctx.input.children.splice(index, 1);
        ctx.changed({ structural: true });
        document.getElementById('add-child')?.focus();
      },
    }, t('adjust.removeChild')));
}

const ASSUMPTION_GROUPS = [
  ['assumptions.groupGeneral', [
    { key: 'inflation', percent: true, step: 0.1, max: 20 },
    { key: 'salaryGrowth', percent: true, step: 0.1, max: 20 },
    { key: 'retirementAge', min: 55, max: 75 },
    { key: 'priceBaseAmount', step: 100, max: 1000000, label: { year: DEFAULT_ASSUMPTIONS.baseYear } },
    { key: 'incomeBaseAmount', step: 100, max: 1000000, label: { year: DEFAULT_ASSUMPTIONS.baseYear } },
  ]],
  ['assumptions.groupLeave', [
    { key: 'benefitDaysShare', percent: true, step: 5, max: 100 },
    { key: 'topUpLevel', percent: true, step: 5, max: 100 },
    { key: 'topUpMonths', step: 1, max: 24 },
  ]],
  ['assumptions.groupVab', [
    { key: 'vabDaysPerChildYear', step: 1, max: 60 },
  ]],
  ['assumptions.groupCareer', [
    { key: 'wagePenalty', percent: true, step: 0.5, max: 50 },
    { key: 'wagePenaltyYears', step: 1, max: 40 },
    { key: 'wagePenaltyPermanent', bool: true },
  ]],
  ['assumptions.groupPension', [
    { key: 'pensionReturn', percent: true, step: 0.1, max: 20 },
    { key: 'premiumWaiver', bool: true },
    { key: 'premiumWaiverMonths', step: 1, max: 24 },
    { key: 'publicPension', bool: true },
    { key: 'childYearCredit', bool: true },
    { key: 'payoutYears', step: 1, min: 1, max: 40 },
  ]],
  ['assumptions.groupSavings', [
    { key: 'savingsReturn', percent: true, step: 0.1, max: 20 },
  ]],
];

function assumptionField(ctx, def) {
  const A = ctx.input.assumptions;
  const id = `a-${def.key}`;
  const label = t(`a.${def.key}`, def.label ?? {});
  if (def.bool) {
    return checkboxField({ id, label, checked: Boolean(A[def.key]), onValue: (v) => { A[def.key] = v; ctx.changed(); } });
  }
  const factor = def.percent ? 100 : 1;
  const value = Math.round(A[def.key] * factor * 1000) / 1000;
  return numberField({
    id,
    label,
    value,
    min: def.min ?? 0,
    max: def.max,
    step: def.step ?? 1,
    onValue: (v) => { A[def.key] = v / factor; ctx.changed(); },
  });
}

function renderAdjust(ctx) {
  const input = ctx.input;
  const change = () => ctx.changed();

  const children = input.children.length
    ? h('ol', { class: 'child-list' }, input.children.map((c, i) => childFields(ctx, c, i)))
    : h('p', { class: 'card__sub' }, t('adjust.noChildren'));

  const principleOptions = ['excess', 'equal'].map((value) => {
    const id = `principle-${value}`;
    return h('div', { class: 'choice-card' },
      h('input', {
        type: 'radio',
        name: 'principle',
        id,
        value,
        checked: input.principle === value,
        onchange: () => { input.principle = value; change(); },
      }),
      h('label', { for: id },
        h('span', { class: 'choice-card__title' }, t(`principle.${value}`)),
        h('span', { class: 'choice-card__desc' }, t(`principle.${value}Desc`))));
  });

  return h('section', { class: 'card adjust', id: 'adjust', 'aria-labelledby': 'adjust-title' },
    h('h2', { class: 'card__title', id: 'adjust-title' }, t('adjust.title')),
    h('p', { class: 'card__sub' }, t('adjust.sub')),
    h('form', { class: 'adjust__form', novalidate: true, onsubmit: (e) => e.preventDefault() },
      h('div', { class: 'adjust__people' }, personFields(ctx, 'you'), personFields(ctx, 'partner')),

      h('fieldset', { class: 'adjust__section' },
        h('legend', { class: 'adjust__heading' }, t('adjust.children')),
        children,
        h('button', {
          type: 'button',
          id: 'add-child',
          class: 'button button--ghost button--small',
          disabled: input.children.length >= 8,
          onclick: () => {
            const last = input.children[input.children.length - 1];
            const age = last ? Math.min(last.yourAgeAtBirth + 3, input.you.age + 5) : Math.max(18, input.you.age - 4);
            input.children.push(createChild(age));
            ctx.changed({ structural: true });
            document.getElementById(`child-${input.children.length - 1}-age`)?.focus();
          },
        }, '+ ', t('adjust.addChild'))),

      h('fieldset', { class: 'adjust__section' },
        h('legend', { class: 'adjust__heading' }, t('adjust.vab')),
        numberField({
          id: 'vab-share',
          label: t('field.vabShare'),
          value: Math.round(input.vabShareYou * 100),
          min: 0,
          max: 100,
          step: 5,
          onValue: (v) => { input.vabShareYou = v / 100; change(); },
        })),

      h('fieldset', { class: 'adjust__section' },
        h('legend', { class: 'adjust__heading' }, t('adjust.principle')),
        h('div', { class: 'choice-cards' }, principleOptions)),

      h('details', { class: 'disclosure assumptions', id: 'assumptions' },
        h('summary', {}, t('assumptions.title')),
        h('p', { class: 'card__sub' }, t('assumptions.sub')),
        h('div', { class: 'assumptions__groups' },
          ASSUMPTION_GROUPS.map(([title, defs]) => h('fieldset', { class: 'assumptions__group' },
            h('legend', { class: 'adjust__heading adjust__heading--small' }, t(title)),
            defs.map((def) => assumptionField(ctx, def))))),
        h('button', {
          type: 'button',
          id: 'reset-assumptions',
          class: 'button button--ghost button--small',
          onclick: () => {
            input.assumptions = { ...DEFAULT_ASSUMPTIONS };
            ctx.changed({ structural: true });
            const details = document.getElementById('assumptions');
            if (details) details.open = true;
            document.getElementById('reset-assumptions')?.focus();
          },
        }, t('assumptions.reset')))));
}

// ---------------------------------------------------------------------------
// Static content
// ---------------------------------------------------------------------------

function renderWays() {
  const keys = ['monthly', 'lump', 'ppm', 'costs', 'agreement'];
  return h('section', { class: 'ways', 'aria-labelledby': 'ways-title' },
    h('h2', { class: 'section-title', id: 'ways-title' }, t('ways.title')),
    h('p', { class: 'section-sub' }, t('ways.sub')),
    h('ol', { class: 'ways__list' },
      keys.map((key, i) => h('li', { class: 'ways__item' },
        h('span', { class: 'ways__number', 'aria-hidden': 'true' }, String(i + 1)),
        h('div', {},
          h('h3', { class: 'ways__title' }, t(`ways.${key}.title`)),
          h('p', {}, t(`ways.${key}.text`)))))));
}

function renderMethod() {
  const sections = [
    ['principle', ['text1', 'text2']],
    ['leave', ['text']],
    ['partTime', ['text']],
    ['vab', ['text']],
    ['career', ['text']],
    ['pension', ['text1', 'text2']],
    ['money', ['text']],
    ['suggestion', ['text']],
    ['limits', ['text']],
    ['sources', ['text']],
  ];
  return h('section', { class: 'method', id: 'method', 'aria-labelledby': 'method-title' },
    h('h2', { class: 'section-title', id: 'method-title' }, t('method.title')),
    h('p', { class: 'section-sub' }, t('method.sub')),
    h('div', { class: 'method__grid' },
      sections.map(([key, parts]) => h('article', { class: 'method__item' },
        h('h3', {}, t(`method.${key}.title`)),
        parts.map((p) => h('p', {}, t(`method.${key}.${p}`)))))));
}

export function getLastResult() {
  return lastResult;
}
