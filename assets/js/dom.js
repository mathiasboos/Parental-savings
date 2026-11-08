import { locale, t } from './i18n.js';

/**
 * Tiny hyperscript helper. Children may be strings, numbers, nodes, arrays,
 * null or false. Text is always inserted as text nodes (never as HTML).
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, String(v));
        else el.style[prop] = v;
      }
    }
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let idCounter = 0;
export function uid(prefix = 'id') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

export function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat(locale(), {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

/** Money rounded to a sensible precision: 836 395 → 836 000. */
export function roundMoney(value) {
  const abs = Math.abs(value);
  const step = abs >= 100000 ? 1000 : abs >= 10000 ? 100 : abs >= 1000 ? 10 : 1;
  return Math.round(value / step) * step;
}

export function formatMoney(value, { round = true } = {}) {
  const amount = round ? roundMoney(value) : Math.round(value);
  const formatted = formatNumber(Math.abs(amount));
  const sign = amount < 0 ? '−' : '';
  return locale() === 'sv-SE' ? `${sign}${formatted} ${t('unit.kr')}` : `${sign}${t('unit.kr')} ${formatted}`;
}

export function formatMoneyPerMonth(value) {
  const formatted = formatNumber(Math.abs(roundMoney(value)));
  return `${formatted} ${t('unit.krMonth')}`;
}

export function formatPercent(fraction, digits = 0) {
  return new Intl.NumberFormat(locale(), {
    style: 'percent',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(fraction);
}

/** Parse "45 000", "45,5" or "45.5" into a number; returns NaN when empty. */
export function parseNumber(text) {
  if (typeof text === 'number') return text;
  const cleaned = String(text ?? '')
    .trim()
    .replace(/[\s  ]/g, '')
    .replace(/kr$/i, '')
    .replace(',', '.');
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

/** Format a salary for an input field without currency: 45000 → "45 000". */
export function formatInputNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return formatNumber(value);
}
