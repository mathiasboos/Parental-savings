# Lika delat – parental compensation calculator

A calculator for Swedish parents that estimates how much the parent who has been
home most with the children loses in lifetime income – and how much the other
parent should compensate to make the couple's lifetime income equal.

It covers five parts, before tax and in today's money:

| Part | What is counted |
|---|---|
| **Föräldraledighet** (parental leave) | Salary not covered by föräldrapenning and föräldralön |
| **Deltid** (part time) | Salary lost by working less than full time |
| **Vab** (care of sick child) | Salary deductions not covered by tillfällig föräldrapenning |
| **Löneutveckling** (salary development / career) | Lower salary for the parent at home more |
| **Pension** | Lost occupational pension premiums (ITP 1-like) grown to retirement, and optionally the public pension |

The calculator stops at the amount and an illustration of how it could be evened
out (monthly saving, lump sum, transferring premium pension, etc.). It does **not**
lead to buying an endowment insurance (kapitalförsäkring) or any other product.

The app is in Swedish with an English toggle. Everything runs in the browser –
no data is sent anywhere. Answers are kept in `localStorage`, and *Kopiera länk*
creates a link with the answers encoded in the URL hash so the other parent can
open the same calculation.

## Running it

It is a static site with plain ES modules – no build step and no dependencies.

```bash
npm start          # python3 -m http.server 8080 → http://localhost:8080
npm test           # unit tests for the calculation model (Node ≥ 18)
```

To publish it, enable **GitHub Pages** for the repository (Settings → Pages →
deploy from the default branch, root folder).

## Project layout

```
index.html               page shell, header, help dialog
assets/css/styles.css    design tokens (light + dark), layout and components
assets/js/calculator.js  the calculation model – pure functions, no DOM
assets/js/app.js         state, persistence, share links and the question flow
assets/js/results.js     result page, charts and the live “adjust” form
assets/js/controls.js    form controls used by the question flow
assets/js/i18n.js        Swedish and English texts
assets/js/dom.js         DOM and number formatting helpers
test/calculator.test.js  unit tests (node:test)
```

## How the model works

The process follows the method described by
[Charly's calculator](https://charly.se/berakning) (the *Parental savings*
deck), with ideas from [SEB's part-time pension calculator](https://seb.se/privat/pension/paverka-din-pension/jobbadeltid)
as options. All texts and code are written for this project.

### Questions

Age · both parents' monthly salary before the first parental leave · collective
agreement / parental pay (Ja / Nej / Vet ej, per parent) · who takes most vab ·
part time (percentage and years, per parent) · number of children and your age
at the first child · months at home per child and parent. The detailed form on
the result page lets you change everything, including the partner's age, each
child's birth, an exact vab split, when part time started and all assumptions.

### Compensation principle

* **Tid utöver hälften** (default, as Charly): the parent who has been home more
  than half of the time is compensated for the time beyond 50 %, valued at that
  parent's own loss. Technically, for every part
  `compensation = (loss(own time) − loss(other parent's time)) / 2`
  using the loss function of the parent who was home more. With 70 % / 30 % of
  the leave this is the 20 percentage points above half.
* **Dela förlusterna lika** (option): both parents' losses are calculated and the
  difference is split equally: `(loss_you − loss_partner) / 2`.

With equal salaries the two give the same result.

### Parts

* **Parental leave** – with a collective agreement the income is topped up to
  90 % of the salary for the first 6 months of each leave. Other months:
  föräldrapenning on 60 % of the days at home (people are on leave longer than
  they claim benefit), 77.6 % (80 % × 0.97) of the salary up to 10 price base
  amounts per year for 390 days per child, then 180 SEK/day for 90 days. The days
  of both parents are shared per child.
* **Part time** – `(1 − working %) × salary` for every month of part time. Starts
  when the first child's parental leave is over unless a start age is given.
* **Vab** – 8 days per child and year from age 1 to 12, split 70/30 (“mest”) or
  50/50 (“lika”) as in Charly's method. Benefit 77.6 % of the salary up to 7.5
  price base amounts per year (per 260 working days).
* **Salary development** – 2.5 % lower salary for 5 years from the first birth
  (optionally until retirement), shared by each parent's share of the home time
  (parental leave months + part-time full-time-equivalent months).
* **Occupational pension** – ITP 1-like: 4.5 % of the salary up to 7.5 income base
  amounts per year and 30 % above; without an agreement 4.5 % of the whole salary.
  With an agreement the premiums continue during the first 13 months of each
  parental leave (premiebefrielse in ITP 1). Lost premiums grow by 6.5 % per year
  (after fees and tax) until retirement at 67.
* **Public pension** (optional, from SEB's method) – 18.5 % of pensionable income
  (salary less the 7 % general pension fee, capped at 7.5 income base amounts).
  Parental and vab benefits are pensionable, and barnårsrätt protects the public
  pension during each child's first four years.

### Money values

The entered salary refers to the year before the first parental leave (or today
for planned children) and grows by 2 % per year. Price and income base amounts
use the actual values for 2010–2026 and are extrapolated outside that range.
Every amount – salaries lost in the past and pension capital in the future – is
converted to today's money with 2 % inflation so that the parts can be added up
(the convention SEB uses).

The result also shows a monthly saving that would even out the difference by
retirement, the equivalent lump sum today, and the pension part as a monthly
pension over 20 years.

### Differences from Charly's calculator

* Charly's exact formulas run on their server and are not public, so results will
  not match theirs exactly – only the method is the same.
* Amounts are in today's money (SEB's convention), so past salaries are adjusted
  for inflation.
* Pension premiums continue during the first 13 months of parental leave for
  parents with a collective agreement (premiebefrielse in ITP 1). Charly's
  description does not mention this; switch it off under *Antaganden* to ignore
  it.
* Both parents' collective agreement and part time are asked for, and the
  public pension can be included.

### Limitations

A simplified estimate, not financial advice. Before tax. Guarantee pension,
salary exchange, differences between collective agreements, illness,
unemployment and other reasons why salaries develop differently are not taken
into account.

## Sources

* Försäkringskassan – föräldrapenning, föräldralön, tillfällig föräldrapenning (vab)
* Pensionsmyndigheten – allmän pension, barnårsrätt, inkomstbasbelopp, premiepension
* Collectum, Alecta, Svenskt Näringsliv/PTK – ITP 1, premiebefrielse vid föräldraledighet
* SCB / Skatteverket – prisbasbelopp and inkomstbasbelopp 2010–2026 (2026: 59 200 and 83 400 SEK)
* Charly, *Hur beräknar Charly min förlorade livsinkomst?* – method and default assumptions
* SEB, *Jobba deltid? Så påverkas din pension* – public pension, barnårsrätt, today's money, ways to compensate
