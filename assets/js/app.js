import { calculate, createDefaultInput, createChild, DEFAULT_ASSUMPTIONS, PART_TIME_OPTIONS, VAB_SPLITS } from './calculator.js';
import { h, clear, formatNumber, formatMoney } from './dom.js';
import { fieldNumber, pills, slider } from './controls.js';
import { t, setLanguage, getLanguage } from './i18n.js';
import {
  renderResults, updateResults, numberField, assumptionField, ASSUMPTION_GROUPS,
} from './results.js';

const STORAGE_KEY = 'lika-delat:v1';
const CHILD_GAP_YEARS = 3;
const DEFAULT_MONTHS = { you: 15, partner: 4 };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function blankInput() {
  const input = createDefaultInput();
  input.you.age = null;
  input.you.salary = null;
  input.partner.salary = null;
  input.vabShareYou = null;
  input.children = [createChild(null, DEFAULT_MONTHS.you, DEFAULT_MONTHS.partner)];
  return input;
}

const state = {
  view: 'intro',
  step: 0,
  input: blankInput(),
  partnerAgeLinked: true,
  hasSaved: false,
};

/** Fill in sensible defaults for anything the wizard has not asked yet. */
export function completeInput(input) {
  const defaults = createDefaultInput(input.currentYear);
  const you = { ...defaults.you, ...input.you };
  if (!Number.isFinite(you.age)) you.age = defaults.you.age;
  if (!Number.isFinite(you.salary)) you.salary = defaults.you.salary;
  const partner = { ...defaults.partner, ...input.partner };
  if (!Number.isFinite(partner.age)) partner.age = you.age;
  if (!Number.isFinite(partner.salary)) partner.salary = defaults.partner.salary;
  const children = input.children.map((c, i) => ({
    ...c,
    yourAgeAtBirth: Number.isFinite(c.yourAgeAtBirth) ? c.yourAgeAtBirth : Math.max(18, you.age - 4) + i * CHILD_GAP_YEARS,
  }));
  return {
    ...input,
    you,
    partner,
    children,
    vabShareYou: Number.isFinite(input.vabShareYou) ? input.vabShareYou : VAB_SPLITS.equal,
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...input.assumptions },
  };
}

// ---------------------------------------------------------------------------
// Persistence: localStorage and shareable links
// ---------------------------------------------------------------------------

function compactInput(input) {
  const assumptions = {};
  for (const [key, value] of Object.entries(input.assumptions ?? {})) {
    if (DEFAULT_ASSUMPTIONS[key] !== value) assumptions[key] = value;
  }
  return { ...input, assumptions };
}

function encodeState() {
  const json = JSON.stringify({ l: getLanguage(), i: compactInput(state.input) });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeState(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function shareUrl() {
  const url = new URL(window.location.href);
  url.hash = `s=${encodeState()}`;
  return url.toString();
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        lang: getLanguage(),
        view: state.view === 'result' ? 'result' : 'intro',
        input: state.input,
        partnerAgeLinked: state.partnerAgeLinked,
      }));
    } catch {
      // Private mode or storage disabled – the app works without it.
    }
  }, 150);
}

function load() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    saved = null;
  }
  if (saved?.lang) setLanguage(saved.lang);

  const match = window.location.hash.match(/^#s=([A-Za-z0-9_-]+)$/);
  if (match) {
    try {
      const shared = decodeState(match[1]);
      if (shared.l) setLanguage(shared.l);
      state.input = completeInput({ ...createDefaultInput(), ...shared.i });
      state.partnerAgeLinked = state.input.partner.age === state.input.you.age;
      state.view = 'result';
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return;
    } catch {
      // Ignore broken links and fall back to the saved state.
    }
  }

  if (saved?.input && saved.view === 'result') {
    state.input = completeInput({ ...createDefaultInput(), ...saved.input });
    state.partnerAgeLinked = saved.partnerAgeLinked ?? true;
    state.hasSaved = true;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const app = document.getElementById('app');
const helpDialog = document.getElementById('help-dialog');

function render() {
  onAnswer = () => {};
  document.documentElement.lang = getLanguage();
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
  renderChrome();
  clear(app);
  app.dataset.view = state.view;
  if (state.view === 'intro') app.append(renderIntro());
  else if (state.view === 'wizard') app.append(renderWizard());
  else if (state.view === 'form') app.append(renderForm());
  else renderResults(app, resultContext);
}

function renderChrome() {
  const langButton = document.getElementById('lang-toggle');
  langButton.textContent = t('lang.switch');
  langButton.setAttribute('aria-label', t('lang.switchLabel'));
  langButton.setAttribute('lang', getLanguage() === 'sv' ? 'en' : 'sv');
  document.getElementById('brand-tagline').textContent = t('header.tagline');
  document.getElementById('footer-text').textContent = t('footer.text');
}

function go(view, step = 0) {
  state.view = view;
  state.step = step;
  save();
  render();
  window.scrollTo({ top: 0 });
  const focusTarget = app.querySelector('[data-autofocus]') ?? app.querySelector('h1');
  focusTarget?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------
// Intro
// ---------------------------------------------------------------------------

function renderIntro() {
  return h('section', { class: 'intro' },
    h('div', { class: 'intro__text' },
      h('p', { class: 'eyebrow' }, t('intro.eyebrow')),
      h('h1', { tabindex: '-1' }, t('intro.title')),
      h('p', { class: 'lead' }, t('intro.lead')),
      h('ul', { class: 'intro__points' },
        ['intro.point1', 'intro.point2', 'intro.point3'].map((key) => h('li', {}, t(key)))),
      h('div', { class: 'intro__actions' },
        h('button', { class: 'button button--primary', type: 'button', 'data-autofocus': true, onclick: () => go('wizard', 0) }, t('intro.start')),
        h('button', { class: 'button button--ghost', type: 'button', id: 'start-form', onclick: () => go('form') }, t('intro.form'))),
      h('p', { class: 'intro__privacy' }, t('intro.choose')),
      state.hasSaved
        ? h('p', {}, h('button', { class: 'link-button', type: 'button', onclick: () => go('result') }, t('intro.resume'), ' →'))
        : null,
      h('p', { class: 'intro__privacy' }, t('intro.privacy'))),
    h('div', { class: 'intro__art', 'aria-hidden': 'true' }, introArt()));
}

function introArt() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 320 260');
  svg.innerHTML = `
    <circle cx="125" cy="130" r="92" class="art-you"></circle>
    <circle cx="195" cy="130" r="92" class="art-partner"></circle>
    <path d="M160 52 a92 92 0 0 1 0 156 a92 92 0 0 1 0 -156z" class="art-overlap"></path>
    <text x="160" y="140" text-anchor="middle" class="art-text">50/50</text>`;
  return svg;
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

const monthsLabel = (v) => `${formatNumber(v)} ${t('unit.months')}`;
const yearsLabel = (v) => `${formatNumber(v, Number.isInteger(v) ? 0 : 1)} ${t('unit.years')}`;

function syncChildren(count, firstAge) {
  const children = state.input.children.slice(0, count);
  while (children.length < count) children.push(createChild(null, DEFAULT_MONTHS.you, DEFAULT_MONTHS.partner));
  state.input.children = children.map((c, i) => ({
    ...c,
    yourAgeAtBirth: Number.isFinite(firstAge) ? firstAge + i * CHILD_GAP_YEARS : c.yourAgeAtBirth,
  }));
}

const isValidAge = (v) => Number.isFinite(v) && v >= 18 && v <= 66;
const isValidSalary = (v) => Number.isFinite(v) && v >= 5000 && v <= 1000000;

/**
 * Called by the questions after every answer. The single-page form uses it to
 * refresh its live result; the guide does not need it.
 */
let onAnswer = () => {};
const answered = (id, options) => onAnswer(id, options);

/**
 * The questions. `render` returns the controls only, so the same questions can
 * be shown one at a time (the guide) or all on one page (the form).
 */
const steps = [
  {
    id: 'age',
    title: 'q.age.title',
    help: { title: 'q.age.helpTitle', paragraphs: ['q.age.help1', 'q.age.help2'] },
    validate: () => (isValidAge(state.input.you.age) ? null : { age: t('q.age.error') }),
    render: (errors) => [
      fieldNumber({
        label: t('q.age.label'),
        value: state.input.you.age,
        unit: t('unit.years'),
        autofocus: true,
        error: errors.age,
        onInput: (v) => {
          state.input.you.age = Number.isFinite(v) ? Math.round(v) : null;
          if (state.partnerAgeLinked) state.input.partner.age = state.input.you.age;
          answered('age');
        },
      }),
    ],
  },
  {
    id: 'salary',
    title: 'q.salary.title',
    help: { title: 'q.salary.helpTitle', paragraphs: ['q.salary.help1', 'q.salary.help2'], fact: 'q.salary.fact' },
    validate: () => {
      const errors = {};
      if (!isValidSalary(state.input.you.salary)) errors.you = t('q.salary.error');
      if (!isValidSalary(state.input.partner.salary)) errors.partner = t('q.salary.error');
      return Object.keys(errors).length ? errors : null;
    },
    render: (errors) => [
      h('div', { class: 'field-row' },
        fieldNumber({
          label: t('q.salary.you'),
          value: state.input.you.salary,
          unit: t('unit.krMonth'),
          hint: t('q.salary.hint'),
          autofocus: true,
          format: true,
          error: errors.you,
          onInput: (v) => {
            state.input.you.salary = Number.isFinite(v) ? v : null;
            answered('salary');
          },
        }),
        fieldNumber({
          label: t('q.salary.partner'),
          value: state.input.partner.salary,
          unit: t('unit.krMonth'),
          hint: t('q.salary.hint'),
          format: true,
          error: errors.partner,
          onInput: (v) => {
            state.input.partner.salary = Number.isFinite(v) ? v : null;
            answered('salary');
          },
        })),
    ],
  },
  {
    id: 'agreement',
    title: 'q.agreement.title',
    sub: 'q.agreement.sub',
    help: { title: 'q.agreement.helpTitle', paragraphs: ['q.agreement.help1', 'q.agreement.help2', 'q.agreement.help3'] },
    render: () => {
      const options = ['yes', 'no', 'unknown'].map((v) => ({ value: v, label: t(`option.${v}`) }));
      const group = (who) => pills({
        legend: t(`q.agreement.${who}`),
        options,
        value: state.input[who].agreement,
        onChange: (v) => {
          state.input[who].agreement = v;
          answered('agreement');
        },
      });
      return [h('div', { class: 'stack' }, group('you'), group('partner'))];
    },
  },
  {
    id: 'vab',
    title: 'q.vab.title',
    help: { title: 'q.vab.helpTitle', paragraphs: ['q.vab.help1', 'q.vab.help2'] },
    validate: () => (Number.isFinite(state.input.vabShareYou) ? null : { vab: t('wizard.chooseOption') }),
    render: (errors) => {
      const choice = Object.entries(VAB_SPLITS).find(([, share]) => share === state.input.vabShareYou)?.[0] ?? null;
      return [
        pills({
          legend: t('q.vab.title'),
          hideLegend: true,
          options: ['you', 'partner', 'equal'].map((v) => ({ value: v, label: t(`option.vab.${v}`) })),
          value: choice,
          error: errors.vab,
          onChange: (v) => {
            state.input.vabShareYou = VAB_SPLITS[v];
            answered('vab');
          },
        }),
      ];
    },
  },
  {
    id: 'partTime',
    title: 'q.partTime.title',
    sub: 'q.partTime.sub',
    help: { title: 'q.partTime.helpTitle', paragraphs: ['q.partTime.help1', 'q.partTime.help2'], fact: 'q.partTime.fact' },
    render: () => {
      const options = PART_TIME_OPTIONS.map((p) => ({ value: p, label: p === 100 ? t('q.partTime.full') : `${p} %` }));
      const block = (who) => {
        const person = state.input[who];
        const yearsSlot = h('div', { class: 'part-time__years' });
        const renderYears = () => {
          clear(yearsSlot);
          if (person.partTimePercent < 100) {
            if (!(person.partTimeYears > 0)) person.partTimeYears = 1;
            yearsSlot.append(slider({
              label: t('q.partTime.howLong'),
              value: person.partTimeYears,
              min: 0.5,
              max: 20,
              step: 0.5,
              format: yearsLabel,
              onInput: (v) => {
                person.partTimeYears = v;
                answered('partTime');
              },
            }));
          } else {
            person.partTimeYears = 0;
          }
        };
        renderYears();
        return h('div', { class: 'part-time' },
          pills({
            legend: t(`q.partTime.${who}`),
            options,
            value: person.partTimePercent,
            onChange: (v) => {
              person.partTimePercent = v;
              renderYears();
              answered('partTime');
            },
          }),
          yearsSlot);
      };
      return [h('div', { class: 'stack' }, block('you'), block('partner'))];
    },
  },
  {
    id: 'children',
    title: 'q.children.title',
    sub: 'q.children.sub',
    help: { title: 'q.children.helpTitle', paragraphs: ['q.children.help1', 'q.children.help2'] },
    validate: () => {
      const first = state.input.children[0]?.yourAgeAtBirth;
      const age = state.input.you.age;
      return Number.isFinite(first) && first >= 14 && first <= age + 5 ? null : { firstAge: t('q.children.firstAgeError') };
    },
    render: (errors) => {
      const count = state.input.children.length;
      const countOutput = h('output', { class: 'stepper__value', 'aria-live': 'polite' }, String(count));
      const setCount = (n) => {
        syncChildren(Math.min(8, Math.max(1, n)), state.input.children[0]?.yourAgeAtBirth);
        countOutput.textContent = String(state.input.children.length);
        decrease.disabled = state.input.children.length <= 1;
        increase.disabled = state.input.children.length >= 8;
        // The number of children decides which leave questions there are.
        answered('children', { structural: true });
      };
      const decrease = h('button', { type: 'button', class: 'stepper__button', 'aria-label': t('q.children.decrease'), disabled: count <= 1, onclick: () => setCount(state.input.children.length - 1) }, '−');
      const increase = h('button', { type: 'button', class: 'stepper__button', 'aria-label': t('q.children.increase'), disabled: count >= 8, onclick: () => setCount(state.input.children.length + 1) }, '+');
      const firstAge = state.input.children[0]?.yourAgeAtBirth;
      return [
        h('div', { class: 'stepper', role: 'group', 'aria-label': t('q.children.count') }, decrease, countOutput, increase),
        fieldNumber({
          label: t('q.children.firstAge'),
          value: Number.isFinite(firstAge) ? firstAge : null,
          unit: t('unit.years'),
          hint: t('q.children.gapHint'),
          error: errors.firstAge,
          onInput: (v) => {
            syncChildren(state.input.children.length, Number.isFinite(v) ? Math.round(v) : null);
            answered('children');
          },
        }),
      ];
    },
  },
  {
    id: 'leave',
    title: 'q.leave.title',
    sub: 'q.leave.sub',
    help: { title: 'q.leave.helpTitle', paragraphs: ['q.leave.help1', 'q.leave.help2', 'q.leave.help3'] },
    render: () => {
      // Look the child up by position on every change: answering the children
      // question replaces the child objects.
      const months = (index, key, label) => slider({
        label,
        value: state.input.children[index][key],
        min: 0,
        max: 24,
        format: monthsLabel,
        onInput: (v) => {
          state.input.children[index][key] = v;
          answered('leave');
        },
      });
      return [
        h('div', { class: 'stack' },
          state.input.children.map((child, i) => h('fieldset', { class: 'child-leave' },
            h('legend', { class: state.input.children.length > 1 ? 'child-leave__legend' : 'visually-hidden' }, t('q.leave.child', { n: i + 1 })),
            months(i, 'monthsYou', t('q.leave.you')),
            months(i, 'monthsPartner', t('q.leave.partner'))))),
        h('p', { class: 'field__hint' }, t('q.leave.prefilled')),
      ];
    },
  },
];

const stepById = (id) => steps.find((step) => step.id === id);

/** Focus the first field with an error inside `root`. */
function focusFirstError(root) {
  root.querySelector('[aria-invalid="true"], .field__error')?.closest('.field, .pills')?.querySelector('input')?.focus();
}

function renderWizard() {
  const step = steps[state.step];
  let errors = {};
  const body = h('div', { class: 'question__body' });
  const total = steps.length;
  const isLast = state.step === total - 1;

  const drawBody = () => {
    clear(body);
    append(body, [
      h('h1', { class: 'question__title', tabindex: '-1' }, t(step.title)),
      step.sub ? h('p', { class: 'question__sub' }, t(step.sub)) : null,
      step.render(errors),
    ]);
  };

  const next = () => {
    const result = step.validate?.() ?? null;
    if (result) {
      errors = result;
      drawBody();
      focusFirstError(body);
      return;
    }
    if (isLast) {
      state.input = completeInput(state.input);
      go('result');
    } else {
      go('wizard', state.step + 1);
    }
  };

  const form = h('form', {
    class: 'question',
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      next();
    },
  },
  h('div', { class: 'question__top' },
    h('p', { class: 'question__progress' }, t('wizard.progress', { current: state.step + 1, total })),
    h('button', {
      type: 'button',
      class: 'icon-button',
      'aria-label': `${t('wizard.help')}: ${t(step.help.title)}`,
      'aria-haspopup': 'dialog',
      onclick: () => openHelp(step.help),
    }, '?')),
  h('div', { class: 'progress', role: 'presentation' },
    steps.map((s, i) => h('span', { class: `progress__dot${i < state.step ? ' is-done' : ''}${i === state.step ? ' is-current' : ''}` }))),
  body,
  h('div', { class: 'question__nav' },
    state.step > 0
      ? h('button', { type: 'button', class: 'button button--ghost', onclick: () => go('wizard', state.step - 1) }, '← ', t('wizard.back'))
      : h('button', { type: 'button', class: 'button button--ghost', onclick: () => go('intro') }, '← ', t('wizard.back')),
    h('button', { type: 'submit', class: 'button button--primary' }, isLast ? t('wizard.finish') : t('wizard.next'))),
  h('p', { class: 'question__switch' },
    h('button', { type: 'button', class: 'link-button', id: 'to-form', onclick: () => go('form') }, t('wizard.toForm'))));

  drawBody();
  return h('section', { class: 'wizard' }, form);
}

// ---------------------------------------------------------------------------
// Single-page form: the same questions on one page, with a live result
// ---------------------------------------------------------------------------

function renderForm() {
  let errors = {};
  const bodies = new Map();

  const drawSection = (step) => {
    const body = bodies.get(step.id);
    clear(body);
    append(body, step.render(errors[step.id] ?? {}));
  };

  const summary = h('div', { class: 'form-summary__text', id: 'form-summary', role: 'status' });
  const updateSummary = (message) => {
    clear(summary);
    if (message || steps.some((step) => step.validate?.())) {
      summary.append(h('p', { class: 'form-summary__label' }, message ?? t('form.incomplete')));
      return;
    }
    const result = calculate(completeInput(state.input));
    if (result.direction === 'even') {
      summary.append(h('p', { class: 'form-summary__amount' }, h('strong', {}, t('result.even'))));
      return;
    }
    const { savings } = result;
    summary.append(
      h('p', { class: 'form-summary__label' }, t(result.direction === 'toYou' ? 'result.toYou' : 'result.toPartner')),
      h('p', { class: 'form-summary__amount' },
        h('strong', { class: 'num' }, formatMoney(savings.lumpSum)),
        ' ',
        t('form.orMonthly', {
          amount: formatMoney(savings.monthly),
          years: `${formatNumber(savings.years, Number.isInteger(savings.years) ? 0 : 1)} ${t(savings.years === 1 ? 'unit.year' : 'unit.years')}`,
        })));
  };

  onAnswer = (id, { structural = false } = {}) => {
    if (structural) drawSection(stepById('leave'));
    // The children question (count or age at first child) changes the ages
    // the advanced panel shows per child.
    if (structural || id === 'children') drawAdvanced();
    // Keep the advanced partner-age field in step while it mirrors your age.
    if (id === 'age' && state.partnerAgeLinked) {
      const partnerAge = document.getElementById('form-partner-age');
      if (partnerAge) partnerAge.value = String(state.input.partner.age ?? '');
    }
    // Take away an error as soon as the question is answered correctly.
    if (errors[id] && !stepById(id).validate?.()) {
      delete errors[id];
      const body = bodies.get(id);
      body.querySelectorAll('.field__error').forEach((el) => el.remove());
      body.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    }
    updateSummary();
  };

  // A minimal stand-in for the result page's context, so the same field
  // builders (assumptionField) can be reused here.
  const advancedCtx = {
    get input() { return state.input; },
    changed() { updateSummary(); },
  };

  const advancedBody = h('div', { class: 'advanced__body' });
  const drawAdvanced = () => {
    clear(advancedBody);
    append(advancedBody, [
      numberField({
        id: 'form-partner-age',
        label: t('field.partnerAge'),
        value: state.input.partner.age,
        min: 18,
        max: 66,
        unit: t('unit.years'),
        onValue: (v) => {
          state.input.partner.age = Math.round(v);
          state.partnerAgeLinked = false;
          updateSummary();
        },
      }),
      h('p', { class: 'field__hint' }, t('field.partnerAgeHint')),
      numberField({
        id: 'form-vab-share',
        label: t('field.vabShare'),
        value: Number.isFinite(state.input.vabShareYou) ? Math.round(state.input.vabShareYou * 100) : null,
        min: 0,
        max: 100,
        step: 5,
        onValue: (v) => {
          state.input.vabShareYou = v / 100;
          drawSection(stepById('vab'));
          updateSummary();
        },
      }),
      state.input.children.length
        ? h('div', { class: 'field-row' }, state.input.children.map((child, i) => numberField({
          id: `form-child-${i}-age`,
          label: t('field.childAgeAt', { n: i + 1 }),
          value: child.yourAgeAtBirth,
          min: 14,
          max: (state.input.you.age ?? 66) + 5,
          unit: t('unit.years'),
          onValue: (v) => {
            child.yourAgeAtBirth = Math.round(v);
            updateSummary();
          },
        })))
        : null,
      h('div', { class: 'assumptions__groups' },
        ASSUMPTION_GROUPS.map(([title, defs]) => h('fieldset', { class: 'assumptions__group' },
          h('legend', { class: 'adjust__heading adjust__heading--small' }, t(title)),
          defs.map((def) => assumptionField(advancedCtx, def))))),
      h('button', {
        type: 'button',
        class: 'button button--ghost button--small',
        onclick: () => {
          state.input.assumptions = { ...DEFAULT_ASSUMPTIONS };
          drawAdvanced();
          updateSummary();
        },
      }, t('assumptions.reset')),
    ]);
  };

  const submit = () => {
    errors = {};
    for (const step of steps) {
      const result = step.validate?.() ?? null;
      if (result) errors[step.id] = result;
    }
    if (Object.keys(errors).length) {
      steps.forEach(drawSection);
      updateSummary(t('form.errors'));
      focusFirstError(form);
      return;
    }
    state.input = completeInput(state.input);
    go('result');
  };

  const sections = steps.map((step) => {
    const body = h('div', { class: 'form-row__controls' });
    bodies.set(step.id, body);
    const titleId = `form-${step.id}-title`;
    return h('section', { class: 'form-row', 'aria-labelledby': titleId },
      h('div', { class: 'form-row__question' },
        h('div', { class: 'form-row__head' },
          h('h2', { class: 'form-row__title', id: titleId }, t(step.title)),
          h('button', {
            type: 'button',
            class: 'icon-button icon-button--small',
            'aria-label': `${t('wizard.help')}: ${t(step.help.title)}`,
            'aria-haspopup': 'dialog',
            onclick: () => openHelp(step.help),
          }, '?')),
        step.sub ? h('p', { class: 'form-row__sub' }, t(step.sub)) : null),
      body);
  });

  const form = h('form', {
    class: 'form-page',
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      submit();
    },
  },
  h('header', { class: 'form-page__head' },
    h('button', { type: 'button', class: 'link-button', onclick: () => go('intro') }, '← ', t('wizard.back')),
    h('h1', { tabindex: '-1' }, t('form.title')),
    h('p', { class: 'lead' }, t('form.lead')),
    h('button', { type: 'button', class: 'link-button', id: 'to-wizard', onclick: () => go('wizard', 0) }, t('form.toWizard'))),
  h('div', { class: 'card form-card' }, sections),
  h('section', { class: 'card' },
    h('details', { class: 'disclosure assumptions', id: 'form-advanced' },
      h('summary', {}, t('form.advanced.title')),
      h('p', { class: 'card__sub' }, t('form.advanced.sub')),
      advancedBody)),
  h('p', { class: 'form-page__more' }, t('form.more')),
  h('div', { class: 'form-summary' },
    summary,
    h('button', { type: 'submit', class: 'button form-summary__button' }, t('wizard.finish'))));

  steps.forEach(drawSection);
  drawAdvanced();
  // Start at the heading rather than inside the first field.
  form.querySelectorAll('[data-autofocus]').forEach((el) => el.removeAttribute('data-autofocus'));
  updateSummary();
  return form;
}

function append(el, children) {
  for (const child of [children].flat(Infinity)) {
    if (child) el.append(child);
  }
}

// ---------------------------------------------------------------------------
// Help dialog
// ---------------------------------------------------------------------------

function openHelp({ title, paragraphs, fact }) {
  const content = helpDialog.querySelector('.dialog__content');
  clear(content);
  content.append(
    h('h2', { class: 'dialog__title', id: 'help-title' }, t(title)),
    ...paragraphs.map((key) => h('p', {}, t(key))),
  );
  if (fact) {
    content.append(h('div', { class: 'fact' }, h('p', { class: 'fact__title' }, t('wizard.factTitle')), h('p', {}, t(fact))));
  }
  showDialog();
}

function showDialog() {
  helpDialog.querySelector('.dialog__close').setAttribute('aria-label', t('wizard.close'));
  if (typeof helpDialog.showModal === 'function') helpDialog.showModal();
  else helpDialog.setAttribute('open', '');
}

function closeDialog() {
  if (typeof helpDialog.close === 'function') helpDialog.close();
  else helpDialog.removeAttribute('open');
}

/** A confirmation built into the page – browser prompts are not always available. */
function openConfirm({ title, text, confirmLabel, onConfirm }) {
  const content = helpDialog.querySelector('.dialog__content');
  clear(content);
  content.append(
    h('h2', { class: 'dialog__title', id: 'help-title' }, title),
    h('p', {}, text),
    h('div', { class: 'dialog__actions' },
      h('button', { type: 'button', class: 'button button--ghost', onclick: closeDialog }, t('actions.cancel')),
      h('button', {
        type: 'button',
        class: 'button button--primary',
        onclick: () => {
          closeDialog();
          onConfirm();
        },
      }, confirmLabel)));
  showDialog();
}

/** Show a link to copy by hand when the clipboard is not available. */
function openLink(url) {
  const content = helpDialog.querySelector('.dialog__content');
  clear(content);
  const field = h('input', { class: 'input', type: 'text', readonly: true, value: url, 'aria-label': t('actions.copy'), onfocus: (e) => e.target.select() });
  content.append(
    h('h2', { class: 'dialog__title', id: 'help-title' }, t('actions.copy')),
    h('p', {}, t('actions.copyFailed')),
    field);
  showDialog();
  field.focus();
}

helpDialog.addEventListener('click', (e) => {
  if (e.target === helpDialog || e.target.closest('.dialog__close')) closeDialog();
});

// ---------------------------------------------------------------------------
// Results context – shared with results.js
// ---------------------------------------------------------------------------

const resultContext = {
  get input() { return state.input; },
  get partnerAgeLinked() { return state.partnerAgeLinked; },
  set partnerAgeLinked(value) { state.partnerAgeLinked = value; },
  /** Called by the detailed form after every change. */
  changed({ structural = false } = {}) {
    save();
    if (structural) render();
    else updateResults(app, resultContext);
  },
  restart() {
    openConfirm({
      title: t('actions.restartTitle'),
      text: t('actions.restartText'),
      confirmLabel: t('actions.restart'),
      onConfirm: () => {
        state.input = blankInput();
        state.partnerAgeLinked = true;
        state.hasSaved = false;
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        go('intro');
      },
    });
  },
  shareUrl,
  showLink: openLink,
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// The brand is the way back to the start page; a plain link would leave a
// standalone file opened from disk.
document.querySelector('.brand').addEventListener('click', (e) => {
  e.preventDefault();
  if (state.view !== 'intro') {
    state.hasSaved = state.view === 'result';
    go('intro');
  }
});

document.getElementById('lang-toggle').addEventListener('click', () => {
  setLanguage(getLanguage() === 'sv' ? 'en' : 'sv');
  save();
  const scroll = window.scrollY;
  render();
  window.scrollTo({ top: scroll });
});

load();
render();
