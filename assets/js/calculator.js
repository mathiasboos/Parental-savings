/**
 * Lika delat – beräkningsmodell för föräldrakompensation.
 *
 * Pure functions without any DOM access so the model can be unit tested in Node.
 *
 * The model estimates how much each parent loses in lifetime income because of
 * time spent at home with the children, split into five parts:
 *
 *   1. Föräldraledighet – salary not covered by föräldrapenning/föräldralön
 *   2. Deltid           – salary lost while working part time
 *   3. Vab              – salary deductions not covered by tillfällig föräldrapenning
 *   4. Löneutveckling   – lower salary growth for the parent who is home more
 *   5. Pension          – lost occupational pension premiums (ITP1-like) grown
 *                         to retirement, optionally also the public pension
 *
 * Compensation principle (default, "excess"): the parent who has been home more
 * than half of the time is compensated for the time beyond 50 %, valued at that
 * parent's own loss. Alternative ("equal"): both parents' losses are computed
 * and the difference is split equally.
 *
 * The model runs in nominal SEK: salaries follow `salaryGrowth` from the year
 * the entered salary refers to (just before the first parental leave, or today
 * for planned children) and lost pension premiums grow with `pensionReturn`
 * until the retirement age. Every amount is then expressed in today's money
 * (deflated with `inflation`) so that losses from different years – and
 * pension capital far in the future – can be added up and compared.
 */

export const DEFAULT_ASSUMPTIONS = Object.freeze({
  /** Year for which priceBaseAmount and incomeBaseAmount apply. */
  baseYear: 2026,
  /** Prisbasbelopp (PBB) for baseYear. */
  priceBaseAmount: 59200,
  /** Inkomstbasbelopp (IBB) for baseYear. */
  incomeBaseAmount: 83400,
  /** Yearly inflation – indexes the price base amount outside the known table. */
  inflation: 0.02,
  /** Yearly nominal salary growth (Charly: salaries follow inflation). */
  salaryGrowth: 0.02,

  retirementAge: 67,
  /** Nominal yearly return on pension capital after fees and tax. */
  pensionReturn: 0.065,
  /** Years the pension is paid out – used to express the loss per month. */
  payoutYears: 20,

  // Föräldrapenning (parental benefit)
  /** Föräldrapenning on sjukpenningnivå: 80 % of SGI × 0.97. */
  benefitRate: 0.776,
  /** SGI ceiling for föräldrapenning in price base amounts. */
  parentalBenefitCapPBB: 10,
  /** Share of the days at home on which föräldrapenning is drawn. */
  benefitDaysShare: 0.6,
  /** Days per child paid on sjukpenningnivå. */
  sicknessLevelDays: 390,
  /** Days per child paid on lägstanivå. */
  minimumLevelDays: 90,
  /** Benefit per day on lägstanivå (SEK). */
  minimumLevelPerDay: 180,
  /** Föräldralön (collective agreement): total income as share of salary. */
  topUpLevel: 0.9,
  /** Months per child with föräldralön. */
  topUpMonths: 6,

  // Vab (tillfällig föräldrapenning)
  vabDaysPerChildYear: 8,
  /** First and last (exclusive) child age with vab days. */
  vabFromAge: 1,
  vabToAge: 12,
  vabCapPBB: 7.5,
  workDaysPerYear: 260,

  // Löneutveckling
  /** Salary level lost by the parent who is at home with the children. */
  wagePenalty: 0.025,
  /** Years after the first birth the lower salary level lasts. */
  wagePenaltyYears: 5,
  /** If true the lower salary level lasts until retirement. */
  wagePenaltyPermanent: false,

  // Tjänstepension (ITP1-like)
  itpLowRate: 0.045,
  itpHighRate: 0.3,
  /** Yearly salary threshold in income base amounts (7.5 IBB). */
  itpThresholdIBB: 7.5,
  /** Premium rate without collective agreement. */
  noAgreementRate: 0.045,
  /** Premiebefrielse: premiums continue during parental leave (agreement). */
  premiumWaiver: true,
  premiumWaiverMonths: 13,

  // Allmän pension (optional add-on)
  publicPension: false,
  /** Inkomstpension 16 % + premiepension 2.5 %. */
  publicPensionRate: 0.185,
  /** Pensionsgrundande inkomst ceiling in income base amounts. */
  publicPensionCapIBB: 7.5,
  /** Allmän pensionsavgift deducted before pensionsgrundande inkomst. */
  generalPensionFee: 0.07,
  /** Barnårsrätt: public pension is compensated during the child's first years. */
  childYearCredit: true,
  childYearCreditYears: 4,

  // Illustration of how the difference can be evened out
  savingsReturn: 0.065,
});

/** Known prisbasbelopp per year (SCB/Försäkringskassan). */
export const PRICE_BASE_AMOUNTS = Object.freeze({
  2010: 42400, 2011: 42800, 2012: 44000, 2013: 44500, 2014: 44400,
  2015: 44500, 2016: 44300, 2017: 44800, 2018: 45500, 2019: 46500,
  2020: 47300, 2021: 47600, 2022: 48300, 2023: 52500, 2024: 57300,
  2025: 58800, 2026: 59200,
});

/** Known inkomstbasbelopp per year (Pensionsmyndigheten). */
export const INCOME_BASE_AMOUNTS = Object.freeze({
  2010: 51100, 2011: 52100, 2012: 54600, 2013: 56600, 2014: 56900,
  2015: 58100, 2016: 59300, 2017: 61500, 2018: 62500, 2019: 64400,
  2020: 66800, 2021: 68200, 2022: 71000, 2023: 74300, 2024: 76200,
  2025: 80600, 2026: 83400,
});

/** Your share of the vab days for the three quick answers. */
export const VAB_SPLITS = Object.freeze({ you: 0.7, equal: 0.5, partner: 0.3 });

export const PART_TIME_OPTIONS = Object.freeze([100, 90, 80, 75, 50]);

export const COMPONENT_KEYS = Object.freeze([
  'leave',
  'partTime',
  'vab',
  'career',
  'occupationalPension',
  'publicPension',
]);

export const LIMITS = Object.freeze({
  age: [18, 66],
  salary: [0, 1000000],
  months: [0, 36],
  partTimePercent: [0, 100],
  partTimeYears: [0, 40],
  children: [0, 8],
});

const DAYS_PER_MONTH = 365 / 12;
const EPSILON = 0.5;

export function createDefaultInput(currentYear = new Date().getFullYear()) {
  return {
    currentYear,
    principle: 'excess',
    you: createPerson(),
    partner: createPerson(),
    children: [createChild(31)],
    vabShareYou: VAB_SPLITS.equal,
    savingsYears: null,
    assumptions: { ...DEFAULT_ASSUMPTIONS },
  };
}

export function createPerson(overrides = {}) {
  return {
    age: 35,
    salary: 40000,
    agreement: 'unknown',
    partTimePercent: 100,
    partTimeYears: 0,
    partTimeStartAge: null,
    ...overrides,
  };
}

export function createChild(yourAgeAtBirth, monthsYou = 15, monthsPartner = 4) {
  return { yourAgeAtBirth, monthsYou, monthsPartner };
}

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

function num(value, fallback) {
  const n = typeof value === 'string' ? Number(value.replace(/[\s ]/g, '').replace(',', '.')) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePerson(raw = {}, fallback) {
  const p = { ...fallback, ...raw };
  const startAge = p.partTimeStartAge === null || p.partTimeStartAge === '' || p.partTimeStartAge === undefined
    ? null
    : clamp(num(p.partTimeStartAge, null) ?? 0, 14, 70);
  return {
    age: clamp(Math.round(num(p.age, fallback.age)), ...LIMITS.age),
    salary: clamp(num(p.salary, fallback.salary), ...LIMITS.salary),
    agreement: ['yes', 'no', 'unknown'].includes(p.agreement) ? p.agreement : 'unknown',
    partTimePercent: clamp(num(p.partTimePercent, 100), ...LIMITS.partTimePercent),
    partTimeYears: clamp(num(p.partTimeYears, 0), ...LIMITS.partTimeYears),
    partTimeStartAge: Number.isFinite(startAge) ? startAge : null,
  };
}

export function normalizeInput(raw = {}) {
  const defaults = createDefaultInput(raw.currentYear ?? new Date().getFullYear());
  const assumptions = { ...DEFAULT_ASSUMPTIONS };
  for (const [key, value] of Object.entries(raw.assumptions ?? {})) {
    if (!(key in DEFAULT_ASSUMPTIONS)) continue;
    if (typeof DEFAULT_ASSUMPTIONS[key] === 'boolean') assumptions[key] = Boolean(value);
    else assumptions[key] = Math.max(0, num(value, DEFAULT_ASSUMPTIONS[key]));
  }
  assumptions.retirementAge = clamp(Math.round(assumptions.retirementAge), 55, 75);
  assumptions.benefitDaysShare = clamp(assumptions.benefitDaysShare, 0, 1);
  assumptions.topUpLevel = clamp(assumptions.topUpLevel, 0, 1);
  assumptions.benefitRate = clamp(assumptions.benefitRate, 0, 1);
  assumptions.wagePenalty = clamp(assumptions.wagePenalty, 0, 1);
  assumptions.vabToAge = Math.max(assumptions.vabFromAge, assumptions.vabToAge);

  const you = normalizePerson(raw.you, defaults.you);
  const partner = normalizePerson(raw.partner, { ...defaults.partner, age: you.age });

  const rawChildren = Array.isArray(raw.children) ? raw.children : defaults.children;
  const children = rawChildren.slice(0, LIMITS.children[1]).map((c) => ({
    yourAgeAtBirth: clamp(Math.round(num(c?.yourAgeAtBirth, you.age)), 14, you.age + 5),
    monthsYou: clamp(num(c?.monthsYou, 0), ...LIMITS.months),
    monthsPartner: clamp(num(c?.monthsPartner, 0), ...LIMITS.months),
  }));

  const savingsYears = raw.savingsYears === null || raw.savingsYears === undefined || raw.savingsYears === ''
    ? null
    : clamp(Math.round(num(raw.savingsYears, 1)), 1, 50);

  return {
    currentYear: Math.round(num(raw.currentYear, defaults.currentYear)),
    principle: raw.principle === 'equal' ? 'equal' : 'excess',
    you,
    partner,
    children,
    vabShareYou: clamp(num(raw.vabShareYou, defaults.vabShareYou), 0, 1),
    savingsYears,
    assumptions,
  };
}

// ---------------------------------------------------------------------------
// Small vector helpers – a loss is { income, occupational, public }
// ---------------------------------------------------------------------------

const zero = () => ({ income: 0, occupational: 0, public: 0 });
const add = (a, b) => ({ income: a.income + b.income, occupational: a.occupational + b.occupational, public: a.public + b.public });
const sub = (a, b) => ({ income: a.income - b.income, occupational: a.occupational - b.occupational, public: a.public - b.public });
const scale = (a, k) => ({ income: a.income * k, occupational: a.occupational * k, public: a.public * k });
const sum = (a) => a.income + a.occupational + a.public;

// ---------------------------------------------------------------------------
// Context: timeline, base amounts and people
// ---------------------------------------------------------------------------

function baseAmountAt(table, t, growth) {
  const year = Math.floor(t);
  if (table[year] !== undefined) return table[year];
  const years = Object.keys(table).map(Number);
  const first = Math.min(...years);
  const last = Math.max(...years);
  if (year < first) return table[first] * Math.pow(1 + growth, year - first);
  return table[last] * Math.pow(1 + growth, year - last);
}

function buildContext(input) {
  const A = input.assumptions;
  const Y = input.currentYear;
  const births = input.children.map((c) => Y - (input.you.age - c.yourAgeAtBirth));
  const order = births.map((b, i) => i).sort((a, b) => births[a] - births[b]);
  const firstBirth = births.length ? Math.min(...births) : Y;

  // Base amounts: use the known table, but let the base year values in the
  // assumptions override (so a user can update them) and extrapolate beyond.
  const pbbTable = { ...PRICE_BASE_AMOUNTS, [A.baseYear]: A.priceBaseAmount };
  const ibbTable = { ...INCOME_BASE_AMOUNTS, [A.baseYear]: A.incomeBaseAmount };
  const pbbAt = (t) => baseAmountAt(pbbTable, t, A.inflation);
  const ibbAt = (t) => baseAmountAt(ibbTable, t, A.salaryGrowth);

  const ctx = { A, Y, births, order, firstBirth, pbbAt, ibbAt };
  ctx.inChildYears = (t) => A.childYearCredit
    && births.some((b) => t >= b && t < b + A.childYearCreditYears);
  return ctx;
}

function itpPremium(S, threshold, A) {
  return A.itpLowRate * Math.min(S, threshold) + A.itpHighRate * Math.max(0, S - threshold);
}

function buildPerson(p, ctx) {
  const { A, Y } = ctx;
  const yRef = Math.min(ctx.firstBirth, Y);
  const retirementYear = Y + (A.retirementAge - p.age);
  const hasAgreement = p.agreement !== 'no';

  const person = {
    age: p.age,
    hasAgreement,
    retirementYear,
    yearsToRetirement: Math.max(0, A.retirementAge - p.age),
    salaryAt: (t) => p.salary * Math.pow(1 + A.salaryGrowth, t - yRef),
    active: (t) => t < retirementYear,
    /** Nominal SEK at time t → today's money. */
    toToday: (t) => Math.pow(1 + A.inflation, Y - t),
    /** Premium paid at t → pension capital at retirement, in today's money. */
    growToRetirement: (t) => Math.pow(1 + A.pensionReturn, Math.max(0, retirementYear - t))
      * Math.pow(1 + A.inflation, Y - Math.max(t, retirementYear)),
    /** Occupational pension premium per month for monthly salary S. */
    occupational: (S, t) => (hasAgreement
      ? itpPremium(S, (A.itpThresholdIBB * ctx.ibbAt(t)) / 12, A)
      : A.noAgreementRate * S),
    /** Public pension rights per month for monthly pensionable income S. */
    publicRights: (S, t) => {
      const cap = (A.publicPensionCapIBB * ctx.ibbAt(t)) / 12;
      return A.publicPensionRate * Math.min(Math.max(0, S) * (1 - A.generalPensionFee), cap);
    },
  };
  person.salaryToday = person.salaryAt(Y) * person.toToday(Y);
  return person;
}

/**
 * Pension loss for one month in which the pensionable salary drops from
 * `full` to `reduced` (occupational) and `publicReduced` (public pension,
 * where social insurance benefits count as income).
 */
function pensionLoss(person, ctx, t, full, reduced, publicReduced = reduced, frac = 1) {
  const grow = person.growToRetirement(t);
  const occupational = (person.occupational(full, t) - person.occupational(reduced, t)) * grow * frac;
  let pub = 0;
  if (ctx.A.publicPension && !ctx.inChildYears(t)) {
    pub = (person.publicRights(full, t) - person.publicRights(publicReduced, t)) * grow * frac;
  }
  return { occupational, public: pub };
}

// ---------------------------------------------------------------------------
// Loss functions. Each returns { income, occupational, public }.
// ---------------------------------------------------------------------------

function benefitDays(person, months, A) {
  const top = person.hasAgreement ? Math.min(months, A.topUpMonths) : 0;
  return top * DAYS_PER_MONTH + (months - top) * DAYS_PER_MONTH * A.benefitDaysShare;
}

/** Loss for `self` being home `mSelf` months with a child born at `birth`. */
export function leaveLoss(self, other, mSelf, mOther, birth, ctx) {
  const { A } = ctx;
  const loss = zero();
  if (mSelf <= 0) return loss;

  // Föräldrapenning days are shared per child: the first 390 are paid on
  // sjukpenningnivå, the next 90 on lägstanivå. Days are allocated pro rata.
  const totalDays = benefitDays(self, mSelf, A) + benefitDays(other, mOther, A);
  const sickShare = totalDays > 0 ? Math.min(totalDays, A.sicknessLevelDays) / totalDays : 1;
  const lowShare = totalDays > 0
    ? Math.min(Math.max(totalDays - A.sicknessLevelDays, 0), A.minimumLevelDays) / totalDays
    : 0;

  const topMonths = self.hasAgreement ? Math.min(mSelf, A.topUpMonths) : 0;
  const waiverMonths = self.hasAgreement && A.premiumWaiver ? A.premiumWaiverMonths : 0;

  for (let j = 0; j < Math.ceil(mSelf); j += 1) {
    const frac = Math.min(1, mSelf - j);
    const t = birth + (j + 0.5) / 12;
    if (!self.active(t)) continue;
    const S = self.salaryAt(t);
    const topFrac = clamp(topMonths - j, 0, frac);
    const restFrac = frac - topFrac;

    const cap = A.parentalBenefitCapPBB * ctx.pbbAt(t);
    const dailyBenefit = (A.benefitRate * Math.min(12 * S, cap)) / 365;
    const restIncome = DAYS_PER_MONTH * A.benefitDaysShare
      * (sickShare * dailyBenefit + lowShare * A.minimumLevelPerDay);
    const topIncome = A.topUpLevel * S;

    loss.income += (topFrac * Math.max(0, S - topIncome) + restFrac * Math.max(0, S - restIncome)) * self.toToday(t);

    // Pension: occupational premiums are based on the salary paid by the
    // employer (none during leave unless premiebefrielse applies). Benefits
    // are pensionable in the public system.
    const waivedFrac = clamp(waiverMonths - j, 0, frac);
    const unwaived = frac - waivedFrac;
    if (unwaived > 0) {
      loss.occupational += self.occupational(S, t) * self.growToRetirement(t) * unwaived;
    }
    if (A.publicPension && !ctx.inChildYears(t)) {
      const grow = self.growToRetirement(t);
      loss.public += (
        topFrac * (self.publicRights(S, t) - self.publicRights(topIncome, t))
        + restFrac * (self.publicRights(S, t) - self.publicRights(restIncome, t))
      ) * grow;
    }
  }
  return loss;
}

/** Loss for working `percent` % of full time during `years` from `start`. */
export function partTimeLoss(self, percent, years, start, ctx) {
  const loss = zero();
  const reduction = 1 - percent / 100;
  if (reduction <= 0 || years <= 0) return loss;
  const months = years * 12;
  for (let j = 0; j < Math.ceil(months); j += 1) {
    const frac = Math.min(1, months - j);
    const t = start + (j + 0.5) / 12;
    if (!self.active(t)) continue;
    const S = self.salaryAt(t);
    const reduced = S * (1 - reduction);
    loss.income += frac * reduction * S * self.toToday(t);
    const p = pensionLoss(self, ctx, t, S, reduced, reduced, frac);
    loss.occupational += p.occupational;
    loss.public += p.public;
  }
  return loss;
}

/** Loss for taking `share` of the family's vab days. */
export function vabLoss(self, share, ctx) {
  const { A } = ctx;
  const loss = zero();
  if (share <= 0) return loss;
  for (const birth of ctx.births) {
    for (let age = A.vabFromAge; age < A.vabToAge; age += 1) {
      const t = birth + age + 0.5;
      if (!self.active(t)) continue;
      const S = self.salaryAt(t);
      const days = share * A.vabDaysPerChildYear;
      const dailyWage = (12 * S) / A.workDaysPerYear;
      const cap = A.vabCapPBB * ctx.pbbAt(t);
      const dailyBenefit = (A.benefitRate * Math.min(12 * S, cap)) / A.workDaysPerYear;
      const yearlyLoss = days * Math.max(0, dailyWage - dailyBenefit);
      loss.income += yearlyLoss * self.toToday(t);
      // Monthly averages over the year: the full deduction lowers the
      // occupational pension base; benefits are pensionable publicly.
      const deduction = (days * dailyWage) / 12;
      const p = pensionLoss(self, ctx, t, S, S - deduction, S - yearlyLoss / 12, 12);
      loss.occupational += p.occupational;
      loss.public += p.public;
    }
  }
  return loss;
}

/** Full salary development loss for the parent who is home (share = 1). */
export function careerLossFull(self, ctx) {
  const { A } = ctx;
  const loss = zero();
  if (A.wagePenalty <= 0 || !ctx.births.length) return loss;
  const start = ctx.firstBirth;
  const end = A.wagePenaltyPermanent ? self.retirementYear : start + A.wagePenaltyYears;
  const months = Math.max(0, (end - start) * 12);
  for (let j = 0; j < Math.ceil(months); j += 1) {
    const frac = Math.min(1, months - j);
    const t = start + (j + 0.5) / 12;
    if (!self.active(t)) continue;
    const S = self.salaryAt(t);
    const reduced = S * (1 - A.wagePenalty);
    loss.income += frac * A.wagePenalty * S * self.toToday(t);
    const p = pensionLoss(self, ctx, t, S, reduced, reduced, frac);
    loss.occupational += p.occupational;
    loss.public += p.public;
  }
  return loss;
}

// ---------------------------------------------------------------------------
// Compensation principles
// ---------------------------------------------------------------------------

/**
 * Compare the two parents for one component.
 *
 * `fYou(xSelf, xOther)` / `fPartner(xSelf, xOther)` return the loss of that
 * parent for a given "amount of home time" x. Positive compensation means the
 * partner should compensate you.
 */
function compare(fYou, fPartner, xYou, xPartner, principle) {
  const you = fYou(xYou, xPartner);
  const partner = fPartner(xPartner, xYou);
  let compensation = zero();

  if (principle === 'equal') {
    compensation = scale(sub(you, partner), 0.5);
  } else {
    // Time beyond 50 %: value the difference in time with the loss function
    // of the parent who has been home more.
    const youSwapped = fYou(xPartner, xYou);
    if (sum(you) - sum(youSwapped) > EPSILON) {
      compensation = scale(sub(you, youSwapped), 0.5);
    } else {
      const partnerSwapped = fPartner(xYou, xPartner);
      if (sum(partner) - sum(partnerSwapped) > EPSILON) {
        compensation = scale(sub(partner, partnerSwapped), -0.5);
      }
    }
  }
  return { you, partner, compensation };
}

function homeMonths(person, monthsKey, children) {
  const leave = children.reduce((acc, c) => acc + c[monthsKey], 0);
  const partTime = (1 - person.partTimePercent / 100) * 12 * person.partTimeYears;
  return { leave, partTime, total: leave + partTime };
}

function annuityPayment(capital, yearlyRate, months) {
  if (months <= 0) return 0;
  const i = Math.pow(1 + yearlyRate, 1 / 12) - 1;
  if (Math.abs(i) < 1e-12) return capital / months;
  return (capital * i) / (1 - Math.pow(1 + i, -months));
}

/**
 * Monthly saving during `years` that – including growth until retirement –
 * reaches `target` at retirement, plus the equivalent lump sum today.
 * Use a real return to get the answer in today's money.
 */
export function savingsPlan(target, yearsToRetirement, years, yearlyReturn) {
  const horizon = Math.max(1, yearsToRetirement);
  const saveYears = clamp(years ?? horizon, 1, horizon);
  const n = saveYears * 12;
  const i = Math.pow(1 + yearlyReturn, 1 / 12) - 1;
  const fvFactor = Math.abs(i) < 1e-12 ? n : (Math.pow(1 + i, n) - 1) / i;
  const growthAfter = Math.pow(1 + yearlyReturn, horizon - saveYears);
  return {
    years: saveYears,
    monthly: target / (fvFactor * growthAfter),
    lumpSum: target / Math.pow(1 + yearlyReturn, horizon),
    yearsToRetirement: horizon,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function calculate(rawInput) {
  const input = normalizeInput(rawInput);
  const A = input.assumptions;
  const Y = input.currentYear;
  const ctx = buildContext(input);
  const you = buildPerson(input.you, ctx);
  const partnerAgeOffset = input.partner.age - input.you.age;
  const partner = buildPerson(input.partner, ctx);
  const { principle } = input;

  // 1. Föräldraledighet – per child
  let leave = { you: zero(), partner: zero(), compensation: zero() };
  input.children.forEach((child, idx) => {
    const birth = ctx.births[idx];
    const r = compare(
      (mSelf, mOther) => leaveLoss(you, partner, mSelf, mOther, birth, ctx),
      (mSelf, mOther) => leaveLoss(partner, you, mSelf, mOther, birth, ctx),
      child.monthsYou,
      child.monthsPartner,
      principle,
    );
    leave = {
      you: add(leave.you, r.you),
      partner: add(leave.partner, r.partner),
      compensation: add(leave.compensation, r.compensation),
    };
  });

  // 2. Deltid – starts after the first child's parental leave by default
  const firstChild = input.children[ctx.order[0]];
  const defaultPartTimeStart = ctx.firstBirth
    + Math.max(12, firstChild ? firstChild.monthsYou + firstChild.monthsPartner : 12) / 12;
  const partTimeStart = (p, ageOffset) => (p.partTimeStartAge === null
    ? defaultPartTimeStart
    : Y - (input.you.age + ageOffset - p.partTimeStartAge));
  const ptYou = { percent: input.you.partTimePercent, years: input.you.partTimeYears, start: partTimeStart(input.you, 0) };
  const ptPartner = {
    percent: input.partner.partTimePercent,
    years: input.partner.partTimeYears,
    start: partTimeStart(input.partner, partnerAgeOffset),
  };
  const partTime = compare(
    (x) => partTimeLoss(you, x.percent, x.years, x.start, ctx),
    (x) => partTimeLoss(partner, x.percent, x.years, x.start, ctx),
    ptYou,
    ptPartner,
    principle,
  );

  // 3. Vab
  const vab = compare(
    (share) => vabLoss(you, share, ctx),
    (share) => vabLoss(partner, share, ctx),
    input.vabShareYou,
    1 - input.vabShareYou,
    principle,
  );

  // 4. Löneutveckling – scaled by each parent's share of the home time
  const homeYou = homeMonths(input.you, 'monthsYou', input.children);
  const homePartner = homeMonths(input.partner, 'monthsPartner', input.children);
  const homeTotal = homeYou.total + homePartner.total;
  const shareYou = homeTotal > 0 ? homeYou.total / homeTotal : 0.5;
  const careerYouFull = careerLossFull(you, ctx);
  const careerPartnerFull = careerLossFull(partner, ctx);
  const career = compare(
    (share) => scale(careerYouFull, share),
    (share) => scale(careerPartnerFull, share),
    shareYou,
    1 - shareYou,
    principle,
  );

  // Assemble the rows: salary parts first, then the pension parts.
  const parts = { leave, partTime, vab, career };
  const pensionOf = (who, kind) => Object.values(parts).reduce((acc, part) => acc + part[who][kind], 0);
  const rows = [
    ...['leave', 'partTime', 'vab', 'career'].map((key) => ({
      key,
      amount: parts[key].compensation.income,
      you: parts[key].you.income,
      partner: parts[key].partner.income,
    })),
    {
      key: 'occupationalPension',
      amount: pensionOf('compensation', 'occupational'),
      you: pensionOf('you', 'occupational'),
      partner: pensionOf('partner', 'occupational'),
    },
  ];
  if (A.publicPension) {
    rows.push({
      key: 'publicPension',
      amount: pensionOf('compensation', 'public'),
      you: pensionOf('you', 'public'),
      partner: pensionOf('partner', 'public'),
    });
  }

  const total = rows.reduce((acc, r) => acc + r.amount, 0);
  const totalYou = rows.reduce((acc, r) => acc + r.you, 0);
  const totalPartner = rows.reduce((acc, r) => acc + r.partner, 0);
  const direction = total > EPSILON * 1000 ? 'toYou' : total < -EPSILON * 1000 ? 'toPartner' : 'even';

  // Pension capital (today's money) paid out as a monthly pension.
  const realPensionReturn = (1 + A.pensionReturn) / (1 + A.inflation) - 1;
  const pensionPerMonth = (capital) => annuityPayment(capital, realPensionReturn, A.payoutYears * 12);
  const pensionCapital = (who) => pensionOf(who, 'occupational') + (A.publicPension ? pensionOf(who, 'public') : 0);
  const beneficiary = direction === 'toPartner' ? partner : you;
  const compensationPension = Math.abs(pensionCapital('compensation'));

  return {
    input,
    rows,
    total,
    direction,
    losses: { you: totalYou, partner: totalPartner },
    pension: {
      you: { capital: pensionCapital('you'), perMonth: pensionPerMonth(pensionCapital('you')) },
      partner: { capital: pensionCapital('partner'), perMonth: pensionPerMonth(pensionCapital('partner')) },
      compensation: { capital: compensationPension, perMonth: pensionPerMonth(compensationPension) },
    },
    savings: savingsPlan(
      Math.abs(total),
      beneficiary.yearsToRetirement,
      input.savingsYears,
      (1 + A.savingsReturn) / (1 + A.inflation) - 1,
    ),
    facts: {
      firstBirthYear: input.children.length ? ctx.firstBirth : null,
      birthYears: ctx.births,
      homeMonths: { you: homeYou, partner: homePartner },
      shareYou,
      salaryToday: { you: you.salaryToday, partner: partner.salaryToday },
      yearsToRetirement: { you: you.yearsToRetirement, partner: partner.yearsToRetirement },
      partTimeStart: { you: ptYou.start, partner: ptPartner.start, defaultStart: defaultPartTimeStart },
    },
  };
}
