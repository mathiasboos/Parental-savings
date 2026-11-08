import { h, uid, parseNumber, formatInputNumber } from './dom.js';

/** Labelled text input for numbers (formats thousands when `format` is set). */
export function fieldNumber({ label, value, onInput, unit, hint, autofocus, id = uid('f'), min, max, error, inputmode = 'numeric', format = false }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || null;
  const input = h('input', {
    id,
    type: 'text',
    inputmode,
    autocomplete: 'off',
    class: 'input',
    value: format ? formatInputNumber(value) : (value ?? ''),
    'aria-describedby': describedBy,
    'aria-invalid': error ? 'true' : null,
    'data-autofocus': autofocus || null,
    'data-min': min,
    'data-max': max,
    oninput: (e) => onInput(parseNumber(e.target.value)),
    onblur: (e) => {
      const n = parseNumber(e.target.value);
      if (format && Number.isFinite(n)) e.target.value = formatInputNumber(n);
    },
  });
  return h('div', { class: 'field' },
    h('label', { class: 'field__label', for: id }, label),
    h('div', { class: 'input-wrap' }, input, unit ? h('span', { class: 'input-wrap__unit', 'aria-hidden': 'true' }, unit) : null),
    hint ? h('p', { class: 'field__hint', id: `${id}-hint` }, hint) : null,
    error ? h('p', { class: 'field__error', id: `${id}-error`, role: 'alert' }, error) : null);
}

/** A group of pill-shaped radio buttons. */
export function pills({ legend, name, options, value, onChange, hideLegend = false, error }) {
  const groupName = name ?? uid('pills');
  return h('fieldset', { class: 'pills' },
    h('legend', { class: hideLegend ? 'visually-hidden' : 'pills__legend' }, legend),
    h('div', { class: 'pills__options' },
      options.map((opt) => {
        const id = uid('opt');
        return h('span', { class: 'pill' },
          h('input', {
            type: 'radio',
            id,
            name: groupName,
            value: String(opt.value),
            checked: value === opt.value,
            onchange: () => onChange(opt.value),
          }),
          h('label', { for: id }, opt.label));
      })),
    error ? h('p', { class: 'field__error', role: 'alert' }, error) : null);
}

export function slider({ label, value, min, max, step = 1, format, onInput, id = uid('range') }) {
  const output = h('output', { class: 'slider__value', for: id }, format(value));
  return h('div', { class: 'slider' },
    h('div', { class: 'slider__head' },
      h('label', { for: id, class: 'slider__label' }, label),
      output),
    h('input', {
      type: 'range',
      id,
      min,
      max,
      step,
      value,
      class: 'slider__input',
      style: { '--fill': `${((value - min) / (max - min)) * 100}%` },
      'aria-valuetext': format(value),
      oninput: (e) => {
        const v = Number(e.target.value);
        output.textContent = format(v);
        e.target.setAttribute('aria-valuetext', format(v));
        e.target.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
        onInput(v);
      },
    }));
}
