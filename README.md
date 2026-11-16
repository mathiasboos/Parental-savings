# Lika delat – parental compensation calculator

A calculator for Swedish parents that estimates how much the parent who has been
home most with the children loses in lifetime income – and how much the other
parent should compensate to make the couple's lifetime income equal.

The result is one amount, valued today, and a suggestion for how to pay it:
either as a **lump sum** or as a **monthly saving** over a period you choose.

It covers five parts, before tax:

| Part | What is counted |
|---|---|
| **Föräldraledighet** (parental leave) | Salary not covered by föräldrapenning and föräldralön |
| **Deltid** (part time) | Salary lost by working less than full time |
| **Vab** (care of sick child) | Salary deductions not covered by tillfällig föräldrapenning |
| **Löneutveckling** (salary development / career) | Lower salary for the parent at home more |
| **Pension** | Lost occupational pension premiums (ITP 1-like), and optionally the public pension |

The model is our own and deliberately simple enough to explain: the result page
has a *Uträkningen steg för steg* section that shows every part with the
family's own numbers – months, salary, benefit, loss per month, the pension
effect and how the monthly amount follows from the lump sum. The calculator does
**not** lead to buying an endowment insurance (kapitalförsäkring) or any other
product.

The app is in Swedish with an English toggle. Everything runs in the browser –
no data is sent anywhere. Answers are kept in `localStorage`, and *Kopiera länk*
creates a link with the answers encoded in the URL hash so the other parent can
open the same calculation.

## Using it

**Standalone file:** [`lika-delat.html`](lika-delat.html) is the whole calculator
in one file. Download it and open it in a browser – it needs no web server, no
installation and no network.

**As a website:** the repository is also a static site with plain ES modules, no
build step needed to run it and no dependencies.

```bash
npm start          # python3 -m http.server 8080 → http://localhost:8080
npm test           # unit tests for the calculation model (Node ≥ 18)
npm run build      # regenerate lika-delat.html after changing the sources
```

To publish it, enable **GitHub Pages** for the repository (Settings → Pages →
deploy from the default branch, root folder).

## Project layout

```
lika-delat.html             the standalone single-file version (generated)
index.html                  page shell, header, help dialog
assets/css/styles.css       design tokens (light + dark), layout and components
assets/js/calculator.js     the calculation model – pure functions, no DOM
assets/js/app.js            state, persistence, share links and the question flow
assets/js/results.js        result page, suggestion, step-by-step view and the live “adjust” form
assets/js/controls.js       form controls used by the question flow
assets/js/i18n.js           Swedish and English texts
assets/js/dom.js            DOM and number formatting helpers
scripts/build-standalone.mjs  inlines everything into lika-delat.html
test/                       unit tests (node:test)
```

## How the model works

### Questions

There are two ways to answer, with the same questions and the same result:
**the guide** asks one question at a time with explanations, and **the single
page** (*Fyll i allt på en sida*) shows all questions at once with a live result
at the bottom. You can switch between them without losing your answers. The
single page also has a *Fler inställningar* panel with the partner's exact age,
each child's exact age, an exact vab split and every assumption – the same
settings available in *Justera beräkningen* on the result page.

Age · both parents' monthly salary before the first parental leave · collective
agreement / parental pay (Ja / Nej / Vet ej, per parent) · who takes most vab ·
part time (percentage and years, per parent) · number of children and your age
at the first child · months at home per child and parent. The detailed form on
the result page lets you change everything, including the partner's age, each
child's birth, an exact vab split, when part time started and all assumptions.

### 1. Each parent's loss

For both parents, every part is calculated from the rules of the social
insurance and a typical collective agreement:

* **Parental leave** – with a collective agreement the income is topped up to
  90 % of the salary for the first 6 months of each leave. Other months:
  föräldrapenning on 60 % of the days at home (people are on leave longer than
  they claim benefit), 77.6 % (80 % × 0.97) of the salary up to 10 price base
  amounts per year for 390 days per child, then 180 SEK/day for 90 days. The days
  of both parents are shared per child. Loss = salary − benefit.
* **Part time** – `(1 − working %) × salary` for every month of part time. Starts
  when the first child's parental leave is over unless a start age is given.
* **Vab** – 8 days per child and year from age 1 to 12, split 70/30 (“mest”) or
  50/50 (“lika”). Benefit 77.6 % of the salary up to 7.5 price base amounts per
  year (per 260 working days). Loss = salary deduction − benefit.
* **Salary development** – 2.5 % lower salary for 5 years from the first birth
  (optionally until retirement), shared by each parent's share of the home time
  (parental leave months + part-time full-time-equivalent months).
* **Occupational pension** – ITP 1-like: 4.5 % of the salary up to 7.5 income base
  amounts per year and 30 % above; without an agreement 4.5 % of the whole salary.
  With an agreement the premiums continue during the first 13 months of each
  parental leave (premiebefrielse in ITP 1). Every premium that is lost because
  of the four parts above is counted.
* **Public pension** (optional) – 16 % inkomstpension and 2.5 % premiepension on
  pensionable income (salary less the 7 % general pension fee, capped at 7.5
  income base amounts). Parental and vab benefits are pensionable, and
  barnårsrätt protects the public pension during each child's first four years.

### 2. Everything is valued today

So that the parts can be added up into one amount that can be paid now:

* The entered salary refers to the year before the first parental leave (or
  today for planned children) and grows by 2 % per year. **Lost salary** is
  converted to today's money with 2 % inflation.
* **Lost pension premiums** are valued at what they would be worth in the
  pension account today: grown by 6.5 % per year (after fees and tax) if they
  were lost in the past, discounted the same way if they will be lost in the
  future. Inkomstpension rights follow salary growth instead.
* Price and income base amounts use the actual values for 2010–2026 and are
  extrapolated outside that range.

The result page also shows what the pension part corresponds to at retirement
(age 67) and as a monthly pension over 20 years.

### 3. Compensation

* **Tid utöver hälften** (default): the parent who has been home more than half
  of the time is compensated for the time beyond 50 %, valued at that parent's
  own loss. For every part
  `compensation = (loss(own time) − loss(other parent's time)) / 2`
  using the loss function of the parent who was home more. Example: 12 and 6
  months of leave – an even split would be 9 each, so the first parent is
  compensated for 3 months. Afterwards both have carried the same loss, as if
  the time had been shared equally.
* **Dela förlusterna lika** (option): both parents' losses are calculated and the
  difference is split equally: `(loss_you − loss_partner) / 2`.

With equal salaries the two give the same result.

### 4. The suggestion

The sum of the parts is a value today, so it is the **lump sum**.

The **monthly amount** is the same value spread over the chosen period (1–20
years or until retirement, default 10 years):

```
monthly = lump sum × r / (1 − (1 + r)^−n)
```

where `r` is the monthly return (6.5 % per year by default) and `n` the number
of months. Because the money arrives later than a lump sum would, the return is
included so that the receiver ends up with the same value. With a 0 % return
the monthly amount is simply the lump sum divided by the number of months.

All defaults can be changed under *Antaganden* on the result page.

### Relation to Charly's and SEB's calculators

The five parts and several default assumptions (8 vab days, 70/30, 2.5 % for
5 years, 6.5 % return) follow the method that
[Charly](https://charly.se/berakning) describes, and the public pension option
follows [SEB's part-time pension calculator](https://seb.se/privat/pension/paverka-din-pension/jobbadeltid).
The formulas behind those calculators are not public, and we could not
reproduce Charly's figures from the published description. This calculator
therefore uses its own model, where every step is shown and can be checked, and
its results will differ from theirs. All texts and code are written for this
project.

### Limitations

A simplified estimate, not financial advice. Before tax. Guarantee pension,
salary exchange, differences between collective agreements, illness,
unemployment and other reasons why salaries develop differently are not taken
into account. Past inflation and returns are approximated with the fixed yearly
assumptions.

## Sources

* Försäkringskassan – föräldrapenning, föräldralön, tillfällig föräldrapenning (vab)
* Pensionsmyndigheten – allmän pension, barnårsrätt, inkomstbasbelopp, premiepension
* Collectum, Alecta, Svenskt Näringsliv/PTK – ITP 1, premiebefrielse vid föräldraledighet
* SCB / Skatteverket – prisbasbelopp and inkomstbasbelopp 2010–2026 (2026: 59 200 and 83 400 SEK)
* Charly, *Hur beräknar Charly min förlorade livsinkomst?* – the five parts and default assumptions
* SEB, *Jobba deltid? Så påverkas din pension* – public pension, barnårsrätt, ways to compensate
