/* MY MONEY — 개인 가계부 · 자산관리 PWA
 * 모든 데이터는 기기 내 IndexedDB에만 저장됩니다. 외부 서버로 전송하지 않습니다.
 */
(() => {
'use strict';

const APP_VERSION = '1.0.0';
const DB_NAME = 'mymoney';
const DB_VER = 1;
const STORES = ['settings', 'accounts', 'transactions', 'loans', 'goals'];
const OCR_CACHE = 'mymoney-ocr-v1';

/* =========================================================
 * Utils
 * ======================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (n) => Math.round(n || 0).toLocaleString('ko-KR');
const won = (n) => fmtN(n) + '원';
const wonS = (n) => (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') + fmtN(Math.abs(n)) + '원';
const man = (n) => {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e8) return s + (Math.round(a / 1e6) / 100).toString() + '억';
  if (a >= 1e4) return s + fmtN(a / 1e4) + '만';
  return s + fmtN(a);
};
const korWon = (n) => {
  const a = Math.round(Math.abs(n));
  const eok = Math.floor(a / 1e8);
  const m = Math.round((a % 1e8) / 1e4);
  let s = '';
  if (eok) s += eok.toLocaleString('ko-KR') + '억';
  if (m) s += (eok ? ' ' : '') + m.toLocaleString('ko-KR') + '만';
  if (!s) s = a.toLocaleString('ko-KR');
  return (n < 0 ? '-' : '') + s + ' 원';
};
const parseNum = (s) => {
  const str = String(s ?? '').replace(/[^\d.\-]/g, '');
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
};
const pad = (n) => String(n).padStart(2, '0');
const ds = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const today = () => ds(new Date());
const ymOf = (s) => String(s).slice(0, 7);
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
const addMonths = (s, n) => {
  const d = pd(s); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return ds(d);
};
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return ds(new Date(y, m, 0)); };
const shiftYm = (ym, n) => ymOf(addMonths(ym + '-01', n));
const daysBetween = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
const monthsBetween = (a, b) => daysBetween(a, b) / 30.4375;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const fmtDate = (s) => { const d = pd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`; };
const fmtDot = (s) => s ? s.replaceAll('-', '.') : '-';
const fmtYm = (ym) => { const [y, m] = ym.split('-'); return `${y}년 ${Number(m)}월`; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (f(x) || 0), 0);
const isTouch = () => matchMedia('(pointer: coarse)').matches;

/* =========================================================
 * IndexedDB
 * ======================================================= */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' }); });
      };
      r.onsuccess = () => { this.db = r.result; this.db.onversionchange = () => { this.db.close(); location.reload(); }; res(this.db); };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('다른 창에서 앱이 열려 있어 데이터베이스를 열 수 없습니다.'));
    });
  },
  run(stores, mode, fn) {
    return new Promise((res, rej) => {
      let t;
      try { t = this.db.transaction(stores, mode); } catch (e) { return rej(e); }
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('저장이 중단되었습니다.'));
      try { fn(t); } catch (e) { try { t.abort(); } catch (_) {} rej(e); }
    });
  },
  getAll(store) {
    return new Promise((res, rej) => {
      const r = this.db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  },
  put(store, obj) { return this.run([store], 'readwrite', (t) => t.objectStore(store).put(obj)); },
  putMany(store, arr) { return this.run([store], 'readwrite', (t) => { const os = t.objectStore(store); arr.forEach((o) => os.put(o)); }); },
  del(store, id) { return this.run([store], 'readwrite', (t) => t.objectStore(store).delete(id)); },
  replaceAll(data) {
    return this.run(STORES, 'readwrite', (t) => {
      STORES.forEach((s) => { const os = t.objectStore(s); os.clear(); (data[s] || []).forEach((o) => os.put(o)); });
    });
  }
};

/* =========================================================
 * State
 * ======================================================= */
const DEFAULT_EXP = ['식비', '카페', '쇼핑', '교통', '주거', '통신', '생활', '의료', '교육', '여행', '기타'];
const DEFAULT_INC = ['급여', '식대', '상여', '부수입', '이자·배당', '용돈', '기타수입'];
const DEFAULT_PAY = ['체크카드', '신용카드', '현금', '계좌이체', '간편결제', '기타'];
const ACC_TYPES = ['현금', '입출금통장', '적금', '예금', '주식', '기타 자산'];
const LOAN_METHODS = { annuity: '원리금균등', equalPrincipal: '원금균등', bullet: '만기일시', free: '자유상환' };
const INTEREST_CAT = '대출 이자';
const TYPE_LABEL = { expense: '지출', income: '수입', transfer: '이체', repay: '대출 상환', adjust: '잔액 조정' };

const defaultSettings = () => ({
  key: 'main', schema: 1, onboarded: false,
  salary: 45000000, mealAllowance: 2000000, takeHome: 0, savingGoal: 1600000,
  monthlyBudget: 0, weeklyBudget: 200000, weekStart: 1, theme: 'system',
  expenseCats: [...DEFAULT_EXP], incomeCats: [...DEFAULT_INC], payMethods: [...DEFAULT_PAY],
  lastBackup: null, createdAt: Date.now()
});

const S = { settings: defaultSettings(), accounts: [], txs: [], loans: [], goals: [] };
const ui = {
  tab: 'home', homeYm: ymOf(today()),
  hist: { ym: ymOf(today()), filter: 'all', q: '' },
  range: '1Y', goalSeg: 'goals', sim: null
};

async function loadAll() {
  const [settings, accounts, txs, loans, goals] = await Promise.all(STORES.map((s) => DB.getAll(s)));
  const main = settings.find((x) => x.key === 'main');
  S.settings = Object.assign(defaultSettings(), main || {});
  S.accounts = accounts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);
  S.txs = txs;
  S.loans = loans.sort((a, b) => a.createdAt - b.createdAt);
  S.goals = goals.sort((a, b) => a.createdAt - b.createdAt);
}

async function persist(store, obj) {
  try { await DB.put(store, obj); return true; } catch (e) { saveError(e); return false; }
}
async function persistMany(store, arr) {
  try { await DB.putMany(store, arr); return true; } catch (e) { saveError(e); return false; }
}
async function remove(store, id) {
  try { await DB.del(store, id); return true; } catch (e) { saveError(e); return false; }
}
function saveError(e) {
  console.error(e);
  const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
  toast(quota ? '저장 공간이 부족해 저장하지 못했습니다. 백업 후 공간을 확보해 주세요.' : '저장에 실패했습니다: ' + (e?.message || e), true);
}
async function saveSettings(patch) {
  const next = Object.assign({}, S.settings, patch);
  if (await persist('settings', next)) { S.settings = next; return true; }
  return false;
}
const upsert = (arr, obj) => { const i = arr.findIndex((x) => x.id === obj.id); if (i >= 0) arr[i] = obj; else arr.push(obj); };

/* =========================================================
 * Finance engine
 * 기준일 처리: 계정/대출의 잔액은 '기준일 잔액'에서 출발합니다.
 * 기준일 이후 거래(또는 기준일 당일, 잔액 입력 이후 기록한 거래)만 잔액에 반영되어 중복 합산을 막습니다.
 * ======================================================= */
const counts = (t, ent) => t.date > ent.baseDate || (t.date === ent.baseDate && (t.createdAt || 0) >= (ent.baseSetAt || 0));

function accDelta(t, accId) {
  let d = 0;
  switch (t.type) {
    case 'income': if (t.accountId === accId) d += t.amount; break;
    case 'expense': if (t.accountId === accId) d -= t.amount; break;
    case 'transfer': if (t.accountId === accId) d -= t.amount; if (t.toAccountId === accId) d += t.amount; break;
    case 'repay': if (t.accountId === accId) d -= (t.principal || 0) + (t.interest || 0); break;
    case 'adjust': if (t.accountId === accId) d += t.amount; break;
  }
  return d;
}
function accountBalance(acc, asOf = null) {
  if (asOf && asOf < acc.baseDate) return null;
  let b = acc.openingBalance || 0;
  for (const t of S.txs) {
    if (asOf && t.date > asOf) continue;
    const d = accDelta(t, acc.id);
    if (d && counts(t, acc)) b += d;
  }
  return b;
}
function loanBalance(loan, asOf = null) {
  if (asOf && asOf < loan.baseDate) return null;
  let b = loan.openingBalance || 0;
  for (const t of S.txs) {
    if (t.type !== 'repay' || t.loanId !== loan.id) continue;
    if (asOf && t.date > asOf) continue;
    if (counts(t, loan)) b -= t.principal || 0;
  }
  return Math.max(0, b);
}
function loanRepaidRecorded(loan) {
  return sum(S.txs.filter((t) => t.type === 'repay' && t.loanId === loan.id && counts(t, loan)), (t) => t.principal);
}
function totals(asOf = null) {
  let assets = 0, debts = 0;
  S.accounts.forEach((a) => { const b = accountBalance(a, asOf); if (b != null) assets += b; });
  S.loans.forEach((l) => { const b = loanBalance(l, asOf); if (b != null) debts += b; });
  return { assets, debts, net: assets - debts };
}
function earliestBase() {
  const ds_ = [...S.accounts.map((a) => a.baseDate), ...S.loans.map((l) => l.baseDate)].filter(Boolean).sort();
  return ds_[0] || null;
}
function netDelta() {
  const t = today();
  const lastEnd = monthEnd(shiftYm(ymOf(t), -1));
  const base = earliestBase();
  if (!base) return null;
  const now = totals().net;
  if (base <= lastEnd) return { diff: now - totals(lastEnd).net, label: '지난달 대비' };
  const startNet = sum(S.accounts, (a) => a.openingBalance) - sum(S.loans, (l) => l.openingBalance);
  const d = pd(base);
  return { diff: now - startNet, label: `기준일(${d.getMonth() + 1}.${d.getDate()}) 대비` };
}
function monthStats(ym) {
  let income = 0, expense = 0, interest = 0, principal = 0, transfer = 0;
  const byCat = {}, incByCat = {};
  for (const t of S.txs) {
    if (ymOf(t.date) !== ym) continue;
    if (t.type === 'income') { income += t.amount; incByCat[t.category] = (incByCat[t.category] || 0) + t.amount; }
    else if (t.type === 'expense') { expense += t.amount; byCat[t.category || '기타'] = (byCat[t.category || '기타'] || 0) + t.amount; }
    else if (t.type === 'repay') {
      principal += t.principal || 0; interest += t.interest || 0;
      if (t.interest) { expense += t.interest; byCat[INTEREST_CAT] = (byCat[INTEREST_CAT] || 0) + t.interest; }
    } else if (t.type === 'transfer') transfer += t.amount;
  }
  const savings = income - expense;
  const budget = S.settings.monthlyBudget || 0;
  return {
    income, expense, interest, principal, transfer, savings, byCat, incByCat,
    rate: income > 0 ? savings / income : null,
    budget, remaining: budget ? budget - expense : null
  };
}
function weekRange(dateStr = today()) {
  const d = pd(dateStr);
  const ws = S.settings.weekStart ?? 1;
  const diff = (d.getDay() - ws + 7) % 7;
  const start = addDays(dateStr, -diff);
  return { start, end: addDays(start, 6) };
}
function weekStats() {
  const { start, end } = weekRange();
  const spent = sum(S.txs.filter((t) => t.type === 'expense' && t.date >= start && t.date <= end), (t) => t.amount);
  const budget = S.settings.weeklyBudget || 0;
  const daysLeft = daysBetween(today(), end) + 1;
  return { start, end, spent, budget, left: budget - spent, daysLeft };
}

/* 시계열(자산·부채·순자산·누적상환) — 이벤트 누적 방식 */
function buildEvents() {
  const ev = [];
  const accMap = new Map(S.accounts.map((a) => [a.id, a]));
  const loanMap = new Map(S.loans.map((l) => [l.id, l]));
  S.accounts.forEach((a) => ev.push({ date: a.baseDate, a: a.openingBalance || 0, d: 0, r: 0 }));
  S.loans.forEach((l) => ev.push({ date: l.baseDate, a: 0, d: l.openingBalance || 0, r: 0 }));
  for (const t of S.txs) {
    for (const id of [t.accountId, t.toAccountId]) {
      if (!id) continue;
      const acc = accMap.get(id);
      if (!acc || (id === t.toAccountId && id === t.accountId)) continue;
      const delta = accDelta(t, id);
      if (delta && counts(t, acc)) ev.push({ date: t.date, a: delta, d: 0, r: 0 });
    }
    if (t.type === 'repay') {
      const ln = loanMap.get(t.loanId);
      if (ln && counts(t, ln)) ev.push({ date: t.date, a: 0, d: -(t.principal || 0), r: t.principal || 0 });
    }
  }
  return ev.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}
function seriesFor(dates) {
  const ev = buildEvents();
  let i = 0, a = 0, d = 0, r = 0;
  return dates.map((dt) => {
    while (i < ev.length && ev[i].date <= dt) { a += ev[i].a; d += ev[i].d; r += ev[i].r; i++; }
    return { date: dt, assets: a, debts: Math.max(0, d), net: a - Math.max(0, d), repaid: r };
  });
}
function rangeDates(key) {
  const end = today();
  const base = earliestBase();
  if (!base) return [];
  const back = { '1M': -1, '6M': -6, '1Y': -12, '3Y': -36, '5Y': -60 }[key];
  let start = key === 'ALL' ? base : addMonths(end, back);
  if (start < base) start = base;
  const span = daysBetween(start, end);
  const out = [];
  if (span <= 45) { for (let x = start; x <= end; x = addDays(x, 1)) out.push(x); }
  else if (span <= 400) { for (let x = start; x < end; x = addDays(x, 7)) out.push(x); out.push(end); }
  else {
    out.push(start);
    let m = ymOf(start);
    while (monthEnd(m) < end) { const e = monthEnd(m); if (e > start) out.push(e); m = shiftYm(m, 1); }
    out.push(end);
  }
  if (out.length === 1) out.unshift(addDays(out[0], -1) < base ? out[0] : addDays(out[0], -1));
  return [...new Set(out)];
}

/* 대출 */
function loanSplit(loan, balance = loanBalance(loan)) {
  const i = (loan.rate || 0) / 100 / 12;
  const interest = Math.round(balance * i);
  const P = loan.monthlyPayment || 0;
  if (loan.method === 'equalPrincipal') return { principal: Math.min(P, balance), interest };
  if (loan.method === 'bullet') return { principal: 0, interest };
  return { principal: clamp(P - interest, 0, balance), interest: Math.min(interest, P || interest) };
}
function payoffInfo(loan) {
  const B = loanBalance(loan);
  if (B <= 0) return { done: true, label: '완납' };
  if (loan.method === 'bullet') return { date: loan.maturityDate || null, label: loan.maturityDate ? fmtDot(loan.maturityDate) : '만기일 미입력' };
  const i = (loan.rate || 0) / 100 / 12;
  const P = loan.monthlyPayment || 0;
  let n = null;
  if (P > 0) {
    if (loan.method === 'equalPrincipal' || i === 0) n = Math.ceil(B / P);
    else if (P <= B * i) n = Infinity;
    else n = Math.ceil(-Math.log(1 - (i * B) / P) / Math.log(1 + i));
  }
  if (n == null) return { label: '월 상환액 입력 필요' };
  if (!Number.isFinite(n)) return { label: '이자보다 상환액이 적음' };
  const date = addMonths(today(), n);
  return { months: n, date, label: `${fmtDot(date).slice(0, 7)} (${n}개월)` };
}

/* 목표 */
const HORIZONS = [
  { key: 'xs', label: '최단기', range: '1~3개월', max: 3 },
  { key: 's', label: '단기', range: '3개월~1년', max: 12 },
  { key: 'm', label: '중장기', range: '1~5년', max: 60 },
  { key: 'l', label: '장기', range: '5~10년 이상', max: Infinity }
];
const horizonOf = (g) => { const m = monthsBetween(g.startDate, g.targetDate); return HORIZONS.find((h) => m <= h.max + 0.5) || HORIZONS[3]; };
function goalCurrent(g) {
  if (g.kind === 'netWorth') return totals().net;
  if (g.kind === 'saving' && g.accountIds && g.accountIds.length) {
    return sum(S.accounts.filter((a) => g.accountIds.includes(a.id)), (a) => accountBalance(a));
  }
  return g.manualCurrent || 0;
}
function goalProgress(g) {
  const cur = goalCurrent(g);
  const target = g.target || 0;
  const remaining = Math.max(0, target - cur);
  const monthsLeft = Math.max(0, monthsBetween(today(), g.targetDate));
  const pct = target > 0 ? clamp(cur / target, 0, 1) : 0;
  const required = remaining <= 0 ? 0 : monthsLeft >= 1 ? remaining / monthsLeft : remaining;
  // 월 저축 목표 기준 예상 달성 시점
  let pace = S.settings.savingGoal || 0;
  if (g.kind === 'netWorth') pace += sum(S.loans, (l) => (loanBalance(l) > 0 ? loanSplit(l).principal : 0));
  const eta = remaining <= 0 ? today() : pace > 0 ? addMonths(today(), Math.ceil(remaining / pace)) : null;
  return { cur, target, remaining, monthsLeft, pct, required, eta, done: remaining <= 0 };
}
const GOAL_KIND = {
  netWorth: { label: '순자산 목표', req: '필요 월평균 순자산 증가액', cur: '현재 순자산' },
  saving: { label: '저축 목표', req: '월평균 필요 저축액', cur: '현재 저축액' },
  manual: { label: '직접 입력', req: '월평균 필요 적립액', cur: '현재 달성 금액' }
};

/* 미래 시뮬레이션 */
function simulate(p) {
  const horizon = Math.max(10, p.years || 0);
  const maxM = Math.max(horizon, 40) * 12;
  const rm = Math.pow(1 + (p.ret || 0) / 100, 1 / 12) - 1;
  let A = p.assets, D = p.debts, hit = p.assets - p.debts >= p.target ? 0 : null, payoffM = D <= 0 ? 0 : null;
  const yearly = [{ y: 0, assets: A, debts: D, net: A - D }];
  for (let m = 1; m <= maxM; m++) {
    const y = Math.floor((m - 1) / 12);
    let save = p.saving;
    if (p.raise) {
      const extra = (p.salary * (Math.pow(1 + p.growth / 100, y) - 1) * (1 - p.tax / 100)) / 12;
      const living = p.living * (Math.pow(1 + p.inflation / 100, y) - 1);
      save += extra - living;
    }
    const pay = Math.min(p.principal, D);
    if (p.redirect && D <= 0) save += p.principal; // 완납 후 상환액을 저축으로 전환
    A = A * (1 + rm) + save;
    D -= pay;
    if (payoffM == null && D <= 0) payoffM = m;
    if (hit == null && A - D >= p.target) hit = m;
    if (m % 12 === 0 && m / 12 <= horizon) yearly.push({ y: m / 12, assets: A, debts: D, net: A - D });
  }
  return { yearly, hit, payoffM };
}

/* =========================================================
 * Categories & colors
 * ======================================================= */
const PALETTE = ['#E8735A', '#F2A65A', '#E2B93B', '#8AB17D', '#2A9D8F', '#2F6FDE', '#5E60CE', '#9D6BD8', '#D46A92', '#7A8B99', '#A68A64', '#B5838D', '#4F9DA6', '#C47A3C'];
function catColor(cat, type = 'expense') {
  if (cat === INTEREST_CAT) return 'var(--debt)';
  const list = type === 'income' ? S.settings.incomeCats : S.settings.expenseCats;
  let i = list.indexOf(cat);
  if (i < 0) { i = 0; for (const ch of String(cat)) i = (i * 31 + ch.charCodeAt(0)) >>> 0; }
  return type === 'income' ? ['#2F6FDE', '#4F9DA6', '#5E60CE', '#2A9D8F', '#8AB17D', '#9D6BD8', '#7A8B99'][i % 7] : PALETTE[i % PALETTE.length];
}
function txVisual(t) {
  if (t.type === 'transfer') return { c: 'var(--accent)', g: '⇄' };
  if (t.type === 'repay') return { c: 'var(--debt)', g: '상' };
  if (t.type === 'adjust') return { c: '#7A8B99', g: '±' };
  return { c: catColor(t.category, t.type), g: (t.category || '기')[0] };
}

/* =========================================================
 * OCR (기기 내 처리 — 이미지는 외부로 전송되지 않음)
 * ======================================================= */
const OCR = {
  worker: null,
  simd: (() => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; } })(),
  files() {
    const abs = (p) => new URL(p, location.href).href;
    return {
      lib: abs('vendor/ocr/tesseract.min.js'),
      worker: abs('vendor/ocr/worker.min.js'),
      core: abs(this.simd ? 'vendor/ocr/core/tesseract-core-simd-lstm.wasm.js' : 'vendor/ocr/core/tesseract-core-lstm.wasm.js'),
      langs: [abs('vendor/ocr/lang/kor.traineddata.gz'), abs('vendor/ocr/lang/eng.traineddata.gz')],
      langPath: abs('vendor/ocr/lang')
    };
  },
  async status() {
    const f = this.files();
    let cached = false;
    try {
      if ('caches' in window) {
        const c = await caches.open(OCR_CACHE);
        const hits = await Promise.all([f.lib, f.worker, f.core, ...f.langs].map((u) => c.match(u)));
        cached = hits.every(Boolean);
      }
    } catch (e) { cached = false; }
    return { cached, online: navigator.onLine, ready: !!this.worker };
  },
  async getCached(url) {
    let res = null;
    let cache = null;
    try { if ('caches' in window) { cache = await caches.open(OCR_CACHE); res = await cache.match(url); } } catch (e) { cache = null; }
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error('OCR 엔진 파일을 받지 못했습니다 (' + res.status + ')');
      if (cache) { try { await cache.put(url, res.clone()); } catch (e) { /* 저장 공간 부족 시 무시 */ } }
    }
    return res;
  },
  async blobUrl(url, suffix = '') {
    const res = await this.getCached(url);
    const b = await res.blob();
    return URL.createObjectURL(new Blob([b], { type: 'application/javascript' })) + suffix;
  },
  async init(onProgress = () => {}) {
    if (this.worker) return this.worker;
    const f = this.files();
    onProgress('OCR 엔진 준비 중…', 0.05);
    if (!window.Tesseract) {
      const libUrl = await this.blobUrl(f.lib);
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = libUrl; s.onload = res; s.onerror = () => rej(new Error('OCR 라이브러리를 불러오지 못했습니다.'));
        document.head.appendChild(s);
      });
    }
    onProgress('인식 엔진 불러오는 중…', 0.15);
    const workerPath = await this.blobUrl(f.worker);
    const corePath = await this.blobUrl(f.core, '#core.wasm.js');
    onProgress('한국어 인식 데이터 준비 중…', 0.3);
    await Promise.all(f.langs.map((u) => this.getCached(u)));
    this.worker = await window.Tesseract.createWorker(['kor', 'eng'], 1, {
      workerPath, corePath, workerBlobURL: false, langPath: f.langPath, gzip: true,
      logger: (m) => { if (m.status === 'recognizing text') onProgress('글자 인식 중… ' + Math.round(m.progress * 100) + '%', 0.4 + m.progress * 0.6); }
    });
    await this.worker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1', user_defined_dpi: '300' });
    return this.worker;
  },
  async prepare(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('이미지를 열 수 없습니다. JPG/PNG 캡처를 사용해 주세요.')); i.src = url; });
      let w = img.naturalWidth, h = img.naturalHeight;
      let scale = 1;
      if (w < 1000) scale = Math.min(2.5, 1000 / w);
      if (w * scale > 2000) scale = 2000 / w;
      if (h * scale > 6000) scale = Math.min(scale, 6000 / h);
      const cw = Math.round(w * scale), ch = Math.round(h * scale);
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, cw, ch);
      const data = ctx.getImageData(0, 0, cw, ch);
      const px = data.data;
      let total = 0;
      for (let i = 0; i < px.length; i += 4) { const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; px[i] = px[i + 1] = px[i + 2] = g; total += g; }
      const dark = total / (px.length / 4) < 115; // 다크모드 캡처는 반전
      for (let i = 0; i < px.length; i += 4) {
        let g = px[i]; if (dark) g = 255 - g;
        g = clamp((g - 128) * 1.35 + 128, 0, 255);
        px[i] = px[i + 1] = px[i + 2] = g;
      }
      ctx.putImageData(data, 0, 0);
      return cv;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  },
  async recognize(file, onProgress) {
    const worker = await this.init(onProgress);
    onProgress('이미지 정리 중…', 0.38);
    const canvas = await this.prepare(file);
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  }
};

/* --- OCR 텍스트 → 거래 후보 --- */
const CAT_RULES = [
  ['카페', /(스타벅스|STARBUCKS|커피|카페|CAFE|COFFEE|투썸|이디야|메가\s?MGC|메가커피|빽다방|컴포즈|폴바셋|블루보틀|할리스|탐앤탐스|공차|배스킨|베스킨|던킨|설빙|파스쿠찌|엔제리너스)/i],
  ['식비', /(배달의민족|배민|요기요|쿠팡이츠|맥도날드|버거킹|롯데리아|KFC|맘스터치|서브웨이|김밥|국밥|식당|분식|치킨|피자|도미노|BBQ|교촌|푸드|반점|고기|횟집|떡볶이|도시락|베이커리|파리바게뜨|뚜레쥬르|마라|라멘|스시|초밥|돈까스|돈카츠|샐러드|한식|중식|일식|양식|레스토랑|주점|포차)/i],
  ['교통', /(택시|카카오\s?T|카카오모빌리티|티머니|버스|지하철|철도|코레일|KTX|SRT|주유|칼텍스|SK에너지|S-?OIL|현대오일|주차|하이패스|쏘카|그린카|따릉이|교통)/i],
  ['통신', /(SKT|SK텔레콤|(^|[^A-Z])KT([^A-Z]|$)|LG\s?U\+|유플러스|알뜰폰|통신요금|휴대폰|인터넷요금)/i],
  ['주거', /(관리비|월세|임대료|전기요금|한국전력|도시가스|가스요금|수도요금)/],
  ['의료', /(병원|의원|약국|치과|한의원|안과|피부과|정형외과|내과|이비인후과|소아과|의료)/],
  ['교육', /(학원|교보문고|영풍문고|알라딘|YES24|예스24|인프런|클래스101|유데미|등록금|대학교|강의|도서)/i],
  ['여행', /(항공|대한항공|아시아나|제주항공|진에어|티웨이|에어부산|호텔|숙박|에어비앤비|AIRBNB|야놀자|여기어때|아고다|AGODA|부킹닷컴|트립닷컴|면세|리조트|펜션)/i],
  ['생활', /(이마트24|이마트|홈플러스|롯데마트|코스트코|GS25|CU|세븐일레븐|7-?ELEVEN|편의점|마트|세탁|미용실|헤어|다이소|생활용품)/i],
  ['쇼핑', /(쿠팡|COUPANG|무신사|올리브영|지그재그|29CM|에이블리|11번가|G마켓|지마켓|옥션|SSG|위메프|티몬|스마트스토어|네이버페이|백화점|아울렛|유니클로|UNIQLO|자라|ZARA|H&M|이케아|IKEA|오늘의집|알리익스프레스|테무|TEMU|쇼핑)/i]
];
const INC_RULES = [
  ['급여', /(급여|월급|SALARY|임금)/i], ['식대', /(식대)/], ['상여', /(상여|보너스|성과급)/],
  ['이자·배당', /(이자|배당|결산)/], ['용돈', /(용돈)/]
];
const normM = (s) => String(s || '').replace(/[\s\-_.,()\[\]]/g, '').toLowerCase();
function guessCategory(merchant, type) {
  const m = normM(merchant);
  if (m) {
    const prev = [...S.txs].reverse().find((t) => t.type === type && t.merchant && normM(t.merchant) === m && t.category);
    if (prev) return prev.category;
  }
  if (type === 'income') {
    for (const [c, re] of INC_RULES) if (re.test(merchant) && S.settings.incomeCats.includes(c)) return c;
    return S.settings.incomeCats.includes('기타수입') ? '기타수입' : S.settings.incomeCats[0];
  }
  for (const [c, re] of CAT_RULES) if (re.test(merchant) && S.settings.expenseCats.includes(c)) return c;
  return S.settings.expenseCats.includes('기타') ? '기타' : S.settings.expenseCats[0];
}

function mergeHangulSingles(l) {
  // "스 타 벅 스" → "스타벅스"
  return l.replace(/(^|\s)((?:[가-힣]\s){1,}[가-힣])(?=\s|$)/g, (m, a, b) => a + b.replace(/\s/g, ''));
}
function cleanLine(l) {
  return mergeHangulSingles(String(l)
    .replace(/[₩￦]/g, ' ')
    .replace(/[，]/g, ',').replace(/[：]/g, ':').replace(/[|｜]/g, ' ')
    .replace(/[―—–]/g, '-').replace(/−/g, '-')
    .replace(/\s+/g, ' ').trim())
    // 자주 틀리는 영문 상호 보정 (G↔6, S↔5 등)
    .replace(/(^|\s)[G6][S5]\s?25(?=\s|$)/g, '$1GS25')
    .replace(/(^|\s)[C(]U(?=\s|$)/g, '$1CU')
    .replace(/카카오\s?[T7](?=\s|$)/g, '카카오T');
}
function mkDate(y, m, d, ref) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let yy = y;
  const refD = pd(ref);
  if (yy == null) {
    yy = refD.getFullYear();
    const cand = ds(new Date(yy, m - 1, d));
    if (cand > addDays(ref, 1)) yy -= 1;
  } else if (yy < 100) yy += 2000;
  const dt = new Date(yy, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return ds(dt);
}
function extractDate(l, ref) {
  let m;
  if ((m = l.match(/(20\d{2})\s?[.\-/년]\s?(\d{1,2})\s?[.\-/월]\s?(\d{1,2})\s?일?/))) { const d = mkDate(+m[1], +m[2], +m[3], ref); if (d) return { date: d, match: m[0] }; }
  if ((m = l.match(/(?<![\d,])(\d{2})\.(\d{2})\.(\d{2})(?![\d,])/))) { const d = mkDate(+m[1], +m[2], +m[3], ref); if (d) return { date: d, match: m[0] }; }
  if ((m = l.match(/(\d{1,2})\s?월\s?(\d{1,2})\s?일/))) { const d = mkDate(null, +m[1], +m[2], ref); if (d) return { date: d, match: m[0] }; }
  if ((m = l.match(/(?<![\d,.])(\d{1,2})[./](\d{1,2})(?![\d,]|\.\d)/))) { const d = mkDate(null, +m[1], +m[2], ref); if (d) return { date: d, match: m[0] }; }
  if ((m = l.match(/(^|\s)(오늘)(\s|$)/))) return { date: ref, match: m[2] };
  if ((m = l.match(/(^|\s)(어제)(\s|$)/))) return { date: addDays(ref, -1), match: m[2] };
  return null;
}
function extractTime(l) {
  const m = l.match(/(오전|오후|AM|PM)?\s?(\d{1,2}):(\d{2})(?::\d{2})?/i);
  if (!m) return null;
  let h = +m[2]; const mi = +m[3];
  if (h > 23 || mi > 59) return null;
  if (m[1] && /오후|PM/i.test(m[1]) && h < 12) h += 12;
  if (m[1] && /오전|AM/i.test(m[1]) && h === 12) h = 0;
  return { time: `${pad(h)}:${pad(mi)}`, match: m[0] };
}
function extractAmounts(l) {
  const out = [];
  const re = /([+\-])?\s?(\d{1,3}(?:[,.]\d{3})+|\d{3,9})(?![\d,])\s?(원)?/g;
  let m;
  while ((m = re.exec(l))) {
    const digits = m[2];
    const sep = /[,.]/.test(digits);
    const v = Number(digits.replace(/[,.]/g, ''));
    const signOk = m[1] && (m.index === 0 || /\s/.test(l[m.index - 1] || ' '));
    const sign = signOk ? m[1] : '';
    if (!(m[3] || sep || sign)) continue;
    if (v < 10 || v > 999999999) continue;
    out.push({ value: v, sign, won: !!m[3], raw: m[0] });
  }
  return out;
}
const NOISE = /(일시불|할부\s?\d*\s?개월?|체크\s?카드|신용\s?카드|체크|승인\s?완료|승인|결제\s?완료|사용\s?완료|이용\s?내역|결제\s?내역|거래\s?내역|입출금\s?내역|상세|매출전표|국내|해외|가맹점|사용처|[(（][월화수목금토일][)）]|[월화수목금토일]요일|원$)/g;
function stripNoise(s) {
  return String(s).replace(NOISE, ' ').replace(/[<>›»·•:*#~=]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const meaningful = (s) => (s.match(/[가-힣]/g) || []).length >= 2 || (s.match(/[A-Za-z]/g) || []).length >= 3;

function parseReceiptText(text, ref = today()) {
  const SKIP = /(잔액|잔고|합계|총\s?액|총\s?금액|총\s?결제|결제\s?예정|청구\s?금액|한도|이용\s?가능|누적|승인\s?번호|카드\s?번호|계좌\s?번호|사업자|대표자|TEL|전화|부가세|부가가치세|공급가|과세|면세\s?물품|포인트|적립|받을\s?금액|거스름)/i;
  const INCOME = /(입금|급여|월급|환불|캐시백|이자|용돈|상여|받은\s?돈|받기|정산)/;
  const lines = String(text).split(/\r?\n/).map(cleanLine).filter(Boolean);
  const out = [];
  let cur = null, pend = [], pendTime = null;
  for (let i = 0; i < lines.length; i++) {
    const rawL = lines[i];
    let l = rawL;
    if (/(잔액|잔고)/.test(l)) {
      const head = l.replace(/(잔액|잔고).*$/, '').trim();
      if (!extractAmounts(head).length) { const dt0 = extractDate(l, ref); if (dt0) cur = dt0.date; continue; }
      l = head;
    }
    const dt = extractDate(l, ref); if (dt) l = l.replace(dt.match, ' ');
    const tm = extractTime(l); if (tm) l = l.replace(tm.match, ' ');
    l = l.replace(/\d+(?:[-*]+[\d*]+){2,}/g, ' ').replace(/\*{2,}\d*/g, ' ');
    if (SKIP.test(l)) { if (dt) cur = dt.date; continue; }
    const amts = extractAmounts(l);
    if (!amts.length) {
      if (dt) cur = dt.date;
      if (tm) pendTime = tm.time;
      const txt = stripNoise(l);
      if (meaningful(txt)) pend.push(txt);
      continue;
    }
    const a = amts.find((x) => x.sign || x.won) || amts[0];
    let merchant = l;
    amts.forEach((x) => { merchant = merchant.replace(x.raw, ' '); });
    merchant = stripNoise(merchant);
    if (!meaningful(merchant)) merchant = pend.length ? pend[pend.length - 1] : '';
    let time = tm ? tm.time : pendTime;
    let date = dt ? dt.date : null;
    if (!time && i + 1 < lines.length) { // 카드앱: 금액 아래 줄에 날짜·시간
      const n = lines[i + 1];
      const nt = extractTime(n);
      if (nt) {
        const rest = n.replace(nt.match, ' ').replace(/(잔액|잔고).*$/, ' ');
        const nd = extractDate(rest, ref);
        const rest2 = nd ? rest.replace(nd.match, ' ') : rest;
        if (!extractAmounts(rest2).length) { time = nt.time; if (nd) date = nd.date; i++; }
      }
    }
    if (date) cur = date;
    const ctx = rawL + ' ' + pend.join(' ');
    let type = 'expense';
    if (a.sign === '+') type = 'income';
    else if (a.sign !== '-' && INCOME.test(ctx) && !/(출금|결제|이체\s?출금)/.test(ctx)) type = 'income';
    out.push({ date: cur || ref, time: time || '', amount: a.value, merchant: merchant.slice(0, 40), type, category: guessCategory(merchant, type), raw: rawL });
    pend = []; pendTime = null;
  }
  return out;
}

function findDuplicate(c, excludeId = null) {
  const m = normM(c.merchant);
  return S.txs.find((t) => {
    if (t.id === excludeId || t.date !== c.date || t.amount !== c.amount || t.type !== c.type) return false;
    if (!m || !t.merchant) return true;
    const tm = normM(t.merchant);
    return tm.includes(m.slice(0, 4)) || m.includes(tm.slice(0, 4));
  }) || null;
}

/* =========================================================
 * UI primitives
 * ======================================================= */
const view = $('#view');
const sheetRoot = $('#sheetRoot');
let toastTimer = null;
function toast(msg, err = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', !!err);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), err ? 4200 : 2400);
}
function confirmDialog(title, msg, { ok = '확인', cancel = '취소', danger = false } = {}) {
  return new Promise((res) => {
    const d = document.createElement('div');
    d.className = 'dialog';
    d.innerHTML = `<div class="box" role="alertdialog" aria-modal="true"><h4>${esc(title)}</h4><p>${esc(msg)}</p>
      <div class="btn-row"><button class="btn ghost" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : ''}" data-r="1">${esc(ok)}</button></div></div>`;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b || e.target === d) { d.remove(); res(b ? b.dataset.r === '1' : false); }
    });
    document.body.appendChild(d);
  });
}
const ICON = {
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 8 13"><path d="M1 1l5.5 5.5L1 12"/></svg>'
};

let sheetStack = [];
function openSheet({ title, body, foot = '', actions = {}, onClose = null, onMount = null }) {
  const bd = document.createElement('div'); bd.className = 'backdrop';
  const el = document.createElement('section'); el.className = 'sheet'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="sheet-head"><h3>${esc(title)}</h3><button class="x" data-act="close" aria-label="닫기">${ICON.x}</button></div>
    <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
  const z = 41 + sheetStack.length * 2;
  bd.style.zIndex = z; el.style.zIndex = z + 1;
  sheetRoot.append(bd, el);
  const sh = {
    el, closed: false,
    close() {
      if (sh.closed) return; sh.closed = true;
      el.classList.add('closing'); bd.style.opacity = '0'; bd.style.transition = 'opacity .2s';
      setTimeout(() => { el.remove(); bd.remove(); }, 220);
      sheetStack = sheetStack.filter((x) => x !== sh);
      onClose && onClose();
    },
    setTitle(t) { $('.sheet-head h3', el).textContent = t; }
  };
  bd.addEventListener('click', () => sh.close());
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !el.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'close') return sh.close();
    if (actions[act]) { e.preventDefault(); await actions[act](b, e); }
  });
  sheetStack.push(sh);
  bindMoney(el);
  onMount && onMount(el, sh);
  return sh;
}
function closeAllSheets() { [...sheetStack].forEach((s) => s.close()); }

function bindMoney(root) {
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.classList || !t.classList.contains('money')) return;
    const neg = t.dataset.neg === '1' && /^\s*-/.test(t.value);
    const digits = t.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
    t.value = (neg ? '-' : '') + (digits ? Number(digits).toLocaleString('ko-KR') : '');
  });
}
const moneyVal = (v) => (v ? Number(v).toLocaleString('ko-KR') : '');
const field = (label, inner, hint = '') => `<div class="field"><label>${esc(label)}</label>${inner}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
const moneyInput = (name, val, ph = '0', extra = '') => `<input class="input money num" name="${name}" inputmode="numeric" autocomplete="off" placeholder="${ph}" value="${val === '' || val == null ? '' : moneyVal(val)}" ${extra}>`;
function readForm(root) {
  const o = {};
  $$('[name]', root).forEach((el) => {
    if (el.type === 'checkbox') { if (!o[el.name]) o[el.name] = []; if (el.checked) o[el.name].push(el.value); return; }
    if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; return; }
    o[el.name] = el.classList.contains('money') ? parseNum(el.value) : el.value;
  });
  return o;
}

/* =========================================================
 * Charts (SVG, 오프라인 동작)
 * ======================================================= */
function donutSVG(items, center1, center2) {
  const total = sum(items, (x) => x.value);
  const r = 52, c = 2 * Math.PI * r;
  let off = 0;
  const segs = items.map((it) => {
    const len = total ? (it.value / total) * c : 0;
    const gap = items.length > 1 ? Math.min(2, len / 3) : 0;
    const s = `<circle cx="66" cy="66" r="${r}" fill="none" style="stroke:${it.color}" stroke-width="16" stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 66 66)"/>`;
    off += len; return s;
  }).join('');
  return `<svg viewBox="0 0 132 132" role="img" aria-label="카테고리별 지출">
    <circle cx="66" cy="66" r="${r}" fill="none" style="stroke:var(--bg-2)" stroke-width="16"/>${segs}
    <text x="66" y="61" text-anchor="middle" font-size="10" style="fill:var(--sub)">${esc(center1)}</text>
    <text x="66" y="79" text-anchor="middle" font-size="15" font-weight="800" style="fill:var(--text)">${esc(center2)}</text></svg>`;
}
function ringSVG(pct, color) {
  const r = 27, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 64 64"><circle cx="32" cy="32" r="${r}" fill="none" style="stroke:var(--bg-2)" stroke-width="7"/>
    <circle cx="32" cy="32" r="${r}" fill="none" style="stroke:${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c * clamp(pct, 0, 1)} ${c}" transform="rotate(-90 32 32)"/>
    <text x="32" y="36" text-anchor="middle" font-size="12" font-weight="800" style="fill:var(--text)">${Math.round(pct * 100)}%</text></svg>`;
}
/**
 * labels: string[], series: [{name,color,values:(number|null)[],dash,area}]
 */
function lineChart(el, { labels, series, height = 190, fmtLabel = (x) => x, fmtVal = man, tipVal = won }) {
  const W = 340, H = height, pl = 2, pr = 2, pt = 12, pb = 22;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  if (!labels.length || !all.length) { el.innerHTML = '<div class="empty">표시할 데이터가 없습니다.</div>'; return; }
  let min = Math.min(0, ...all), max = Math.max(...all);
  if (max === min) max = min + 1;
  const padV = (max - min) * 0.08; max += padV; if (min < 0) min -= padV;
  const n = labels.length;
  const X = (i) => pl + (W - pl - pr) * (n <= 1 ? 0.5 : i / (n - 1));
  const Y = (v) => pt + (H - pt - pb) * (1 - (v - min) / (max - min));
  const grid = [0, 0.5, 1].map((f) => {
    const v = min + (max - min) * (1 - f);
    const y = pt + (H - pt - pb) * f;
    return `<line class="grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/><text class="axis" x="${W - 2}" y="${y - 4}" text-anchor="end">${esc(fmtVal(v))}</text>`;
  }).join('') + (min < 0 ? `<line class="grid" x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke-dasharray="3 3"/>` : '');
  const path = (vals) => {
    let d = '', pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  const gid = 'g' + Math.random().toString(36).slice(2, 8);
  const paths = series.map((s, si) => {
    const d = path(s.values);
    let area = '';
    if (s.area) {
      const idx = s.values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
      if (idx.length > 1) area = `<path d="${d}L${X(idx[idx.length - 1])},${Y(Math.max(min, 0))}L${X(idx[0])},${Y(Math.max(min, 0))}Z" fill="url(#${gid}${si})" stroke="none"/>`;
    }
    const single = s.values.filter((v) => v != null).length === 1 ? s.values.map((v, i) => (v == null ? '' : `<circle cx="${X(i)}" cy="${Y(v)}" r="3" style="fill:${s.color}"/>`)).join('') : '';
    return `<defs><linearGradient id="${gid}${si}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:.18"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient></defs>
      ${area}<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="${s.width || 2.2}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>${single}`;
  }).join('');
  const xl = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text class="axis" x="${X(i)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(fmtLabel(labels[i]))}</text>`).join('');
  el.classList.add('chart');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}">${grid}${paths}${xl}
      <line class="cursor" x1="0" x2="0" y1="${pt}" y2="${H - pb}" style="stroke:var(--sub)" stroke-width="1" opacity="0"/>
      <g class="dots"></g><rect x="0" y="0" width="${W}" height="${H}" fill="transparent" class="hit"/></svg>
    <div class="chart-tip" hidden></div>
    <div class="chart-legend">${series.filter((s) => s.name).map((s) => `<span><i style="background:${s.color}${s.dash ? ';opacity:.7' : ''}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  const svg = $('svg', el), tip = $('.chart-tip', el), cursor = $('.cursor', el), dots = $('.dots', el);
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    const i = clamp(Math.round(((x - pl) / (W - pl - pr)) * (n - 1)), 0, n - 1);
    cursor.setAttribute('x1', X(i)); cursor.setAttribute('x2', X(i)); cursor.setAttribute('opacity', '.4');
    dots.innerHTML = series.map((s) => (s.values[i] == null ? '' : `<circle cx="${X(i)}" cy="${Y(s.values[i])}" r="3.5" style="fill:${s.color};stroke:var(--card)" stroke-width="1.5"/>`)).join('');
    tip.hidden = false;
    tip.innerHTML = `<div class="d">${esc(fmtLabel(labels[i], true))}</div>` + series.filter((s) => s.name && s.values[i] != null).map((s) => `<div><span class="dot" style="background:${s.color}"></span> ${esc(s.name)} <b class="num">${esc(tipVal(s.values[i]))}</b></div>`).join('');
    const px = (X(i) / W) * r.width;
    const tw = tip.offsetWidth;
    tip.style.left = clamp(px - tw / 2, 0, r.width - tw) + 'px';
  };
  const hide = () => { tip.hidden = true; cursor.setAttribute('opacity', '0'); dots.innerHTML = ''; };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', hide);
}

/* =========================================================
 * Views
 * ======================================================= */
function header(title, sub = '', actions = '') {
  return `<header class="head"><div><h1>${esc(title)}</h1>${sub ? `<div class="date">${sub}</div>` : ''}</div>
    <div class="head-actions">${actions}<button class="icon-btn" data-act="settings" aria-label="설정">${ICON.gear}</button></div></header>`;
}
function txItem(t) {
  const v = txVisual(t);
  const acc = S.accounts.find((a) => a.id === t.accountId);
  const to = S.accounts.find((a) => a.id === t.toAccountId);
  const loan = S.loans.find((l) => l.id === t.loanId);
  let title = t.merchant || t.memo || t.category || TYPE_LABEL[t.type];
  let sub = [];
  let amtCls = '', sign = '', amt = t.amount;
  if (t.type === 'expense') { amtCls = 'exp'; sign = '−'; sub.push(t.category); }
  if (t.type === 'income') { amtCls = 'inc'; sign = '+'; sub.push(t.category); }
  if (t.type === 'transfer') { sub.push(`${acc ? acc.name : '삭제된 계정'} → ${to ? to.name : '삭제된 계정'}`); title = t.merchant || t.memo || '계좌 이체'; }
  if (t.type === 'repay') { amtCls = 'dbt'; sign = '−'; title = t.merchant || (loan ? loan.name : '대출') + ' 상환'; sub.push(`원금 ${fmtN(t.principal)} · 이자 ${fmtN(t.interest)}`); }
  if (t.type === 'adjust') { title = '잔액 조정'; sub.push(acc ? acc.name : ''); sign = t.amount >= 0 ? '+' : '−'; amt = Math.abs(t.amount); }
  if (t.type !== 'transfer' && t.type !== 'adjust' && acc) sub.push(acc.name);
  if (t.time) sub.unshift(t.time);
  return `<button class="item" data-act="tx-edit" data-id="${t.id}">
    <span class="ic" style="background:${v.c}">${esc(v.g)}</span>
    <span class="main"><div class="t">${esc(title)}</div><div class="s">${esc(sub.filter(Boolean).join(' · '))}</div></span>
    <span class="amt num ${amtCls}">${sign}${fmtN(amt)}원</span></button>`;
}
const sortTx = (a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || (b.createdAt || 0) - (a.createdAt || 0);

function renderHome() {
  const t = totals();
  const nd = netDelta();
  const ym = ui.homeYm;
  const ms = monthStats(ym);
  const wk = weekStats();
  const isCur = ym === ymOf(today());
  const backupBanner = (() => {
    const last = S.settings.lastBackup;
    if (!S.txs.length && last) return '';
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    if (days != null && days < 14) return '';
    return `<div class="banner"><div class="main"><b>${last ? `마지막 백업 ${days}일 전` : '아직 백업하지 않았어요'}</b>브라우저 저장소는 영구 보관이 보장되지 않아요. 정기적으로 백업하세요.</div><button class="btn-sm" data-act="backup">백업</button></div>`;
  })();
  const cats = Object.entries(ms.byCat).sort((a, b) => b[1] - a[1]);
  const top = cats.slice(0, 6);
  if (cats.length > 6) top.push(['그 외', sum(cats.slice(6), (x) => x[1])]);
  const items = top.map(([k, v]) => ({ label: k, value: v, color: k === '그 외' ? '#A1A1A6' : catColor(k) }));
  const recent = [...S.txs].sort(sortTx).slice(0, 5);
  const wkPct = wk.budget ? wk.spent / wk.budget : 0;
  const daily = wk.budget && wk.left > 0 ? Math.floor(wk.left / wk.daysLeft) : 0;
  const ws = pd(wk.start), we = pd(wk.end);

  view.innerHTML = `
    ${header('MY MONEY', fmtDate(today()))}
    ${backupBanner}
    <section class="hero">
      <div class="label">MY NET WORTH</div>
      <div class="big num" id="netWorth">${won(t.net)}</div>
      <div class="delta">${nd ? `${esc(nd.label)} <span class="pill ${nd.diff >= 0 ? 'up' : 'down'} num">${wonS(nd.diff)}</span>` : '계정을 추가하면 순자산이 계산됩니다.'}</div>
      <div class="split">
        <button style="text-align:left" data-act="go" data-tab="assets"><div class="k">나의 총자산</div><div class="v num">${won(t.assets)}</div></button>
        <button style="text-align:left" data-act="go" data-tab="assets"><div class="k">나의 총부채</div><div class="v num">${won(t.debts)}</div></button>
      </div>
    </section>

    <section class="card">
      <div class="card-title"><h2>월간 재무 현황</h2>
        <div class="month-nav"><button data-act="home-month" data-d="-1" aria-label="이전 달">${ICON.left}</button><span class="m">${fmtYm(ym)}</span><button data-act="home-month" data-d="1" ${isCur ? 'disabled' : ''} aria-label="다음 달">${ICON.right}</button></div>
      </div>
      <div class="stats">
        <div class="stat"><div class="k"><span class="dot" style="background:var(--income)"></span>총수입</div><div class="v num inc">${won(ms.income)}</div></div>
        <div class="stat"><div class="k"><span class="dot" style="background:var(--expense)"></span>총지출</div><div class="v num exp">${won(ms.expense)}</div></div>
        <div class="stat"><div class="k"><span class="dot" style="background:var(--saving)"></span>저축액</div><div class="v num sav">${won(ms.savings)}</div></div>
        <div class="stat"><div class="k">저축률</div><div class="v num">${ms.rate == null ? '-' : Math.round(ms.rate * 100) + '%'}</div></div>
        <div class="stat wide"><div><div class="k">남은 예산</div>${ms.budget ? `<div class="v num ${ms.remaining < 0 ? 'exp' : ''}">${won(ms.remaining)}</div>` : `<div class="v" style="font-size:14px">예산 미설정</div>`}</div>
          ${ms.budget ? `<div class="muted num" style="font-size:12px;text-align:right">예산 ${won(ms.budget)}<br>${Math.round((ms.expense / ms.budget) * 100)}% 사용</div>` : '<button class="btn-sm" data-act="settings-budget">예산 설정</button>'}</div>
        ${ms.principal ? `<div class="stat wide"><div class="k"><span class="dot" style="background:var(--debt)"></span>대출 원금 상환 <span class="faint">(지출 아님)</span></div><div class="v num dbt" style="font-size:15px">${won(ms.principal)}</div></div>` : ''}
      </div>
      ${ms.budget ? `<div class="bar ${ms.expense > ms.budget ? 'over' : ''}" style="margin-top:12px"><i style="width:${clamp(ms.expense / ms.budget, 0, 1) * 100}%"></i></div>` : ''}
      ${items.length ? `<div class="donut-wrap">${donutSVG(items, '지출', man(ms.expense))}
        <div class="legend">${items.map((it) => `<div class="row"><span class="dot" style="background:${it.color}"></span><span class="name">${esc(it.label)}</span><span class="num">${fmtN(it.value)}</span><span class="pct num">${Math.round((it.value / ms.expense) * 100)}%</span></div>`).join('')}</div></div>`
        : `<div class="empty" style="padding-bottom:4px">${fmtYm(ym)} 지출 기록이 없습니다.</div>`}
    </section>

    <section class="card">
      <div class="card-title"><h2>주간 예산</h2><span class="link num">${ws.getMonth() + 1}.${ws.getDate()} – ${we.getMonth() + 1}.${we.getDate()}</span></div>
      ${wk.budget ? `
      <div class="kv"><span class="muted">이번 주 예산</span><span class="v num">${won(wk.budget)}</span></div>
      <div class="kv"><span class="muted">사용 금액</span><span class="v num exp">${won(wk.spent)}</span></div>
      <div class="kv"><span class="muted">남은 금액</span><span class="v num ${wk.left < 0 ? 'exp' : 'sav'}">${won(wk.left)}</span></div>
      <div class="bar ${wkPct > 1 ? 'over' : ''}" style="margin-top:10px"><i style="width:${clamp(wkPct, 0, 1) * 100}%"></i></div>
      <div class="bar-meta"><span>${Math.round(wkPct * 100)}% 사용</span><span>${wk.left > 0 ? `남은 ${wk.daysLeft}일 · 하루 ${won(daily)}` : wk.left < 0 ? '예산 초과' : '예산 소진'}</span></div>`
      : `<div class="empty">주간 예산이 설정되지 않았습니다.<br><button class="btn inline" data-act="settings-budget">예산 설정</button></div>`}
    </section>

    <section>
      <div class="card-title" style="margin:20px 4px 10px"><h2>최근 거래</h2>${S.txs.length ? '<button class="link" data-act="go" data-tab="history">전체 보기</button>' : ''}</div>
      ${recent.length ? `<div class="list">${recent.map(txItem).join('')}</div>`
        : `<div class="card empty">아직 기록이 없습니다.<br><span class="faint">아래 + 버튼으로 첫 거래를 기록하거나 캡처 이미지를 올려 보세요.</span>
          <div class="btn-row" style="margin-top:14px"><button class="btn ghost" data-act="add-ocr">${ICON.camera.replace('<svg', '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"')} 캡처 인식</button><button class="btn" data-act="add">직접 입력</button></div></div>`}
    </section>`;
}

function renderHistory() {
  const h = ui.hist;
  const isCur = h.ym === ymOf(today());
  const q = h.q.trim().toLowerCase();
  let list = S.txs.filter((t) => (q ? true : ymOf(t.date) === h.ym));
  if (h.filter !== 'all') list = list.filter((t) => t.type === h.filter);
  if (q) list = list.filter((t) => [t.merchant, t.memo, t.category, t.payMethod, String(t.amount)].join(' ').toLowerCase().includes(q));
  list.sort(sortTx);
  const ms = monthStats(h.ym);
  const groups = {};
  list.forEach((t) => { (groups[t.date] = groups[t.date] || []).push(t); });
  const chips = [['all', '전체'], ['expense', '지출'], ['income', '수입'], ['transfer', '이체'], ['repay', '상환'], ['adjust', '조정']];
  view.innerHTML = `
    ${header('HISTORY', '거래 내역', `<button class="icon-btn" data-act="csv" aria-label="CSV 내보내기">${ICON.share}</button>`)}
    <div class="card" style="padding:14px 16px">
      <div class="card-title" style="margin-bottom:10px"><div class="month-nav"><button data-act="hist-month" data-d="-1" aria-label="이전 달">${ICON.left}</button><span class="m">${fmtYm(h.ym)}</span><button data-act="hist-month" data-d="1" ${isCur ? 'disabled' : ''} aria-label="다음 달">${ICON.right}</button></div>
        <span class="link num">${list.length}건</span></div>
      <div class="stats" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat"><div class="k">수입</div><div class="v num inc" style="font-size:14px">${fmtN(ms.income)}</div></div>
        <div class="stat"><div class="k">지출</div><div class="v num exp" style="font-size:14px">${fmtN(ms.expense)}</div></div>
        <div class="stat"><div class="k">저축</div><div class="v num sav" style="font-size:14px">${fmtN(ms.savings)}</div></div>
      </div>
    </div>
    <input class="input" id="histSearch" type="search" placeholder="거래처·메모·금액 검색 (전체 기간)" value="${esc(h.q)}" style="margin-bottom:10px">
    <div class="chips">${chips.map(([k, l]) => `<button class="chip ${h.filter === k ? 'on' : ''}" data-act="hist-filter" data-f="${k}">${l}</button>`).join('')}</div>
    ${list.length ? Object.entries(groups).map(([d, arr]) => {
      const out = sum(arr.filter((t) => t.type === 'expense'), (t) => t.amount) + sum(arr.filter((t) => t.type === 'repay'), (t) => t.interest);
      const inc = sum(arr.filter((t) => t.type === 'income'), (t) => t.amount);
      return `<div class="day-head"><span>${fmtDate(d)}${q ? ` · ${pd(d).getFullYear()}` : ''}</span><span class="num">${inc ? `<span class="inc">+${fmtN(inc)}</span> ` : ''}${out ? `<span class="exp">−${fmtN(out)}</span>` : ''}</span></div><div class="list">${arr.map(txItem).join('')}</div>`;
    }).join('') : `<div class="card empty">${q ? '검색 결과가 없습니다.' : '이 달의 거래가 없습니다.'}</div>`}`;
  const inp = $('#histSearch');
  inp.addEventListener('input', debounce(() => {
    ui.hist.q = inp.value;
    const pos = inp.selectionStart;
    renderHistory();
    const n = $('#histSearch'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {}
  }, 250));
}

function renderAssets() {
  const t = totals();
  const ranges = [['1M', '1개월'], ['6M', '6개월'], ['1Y', '1년'], ['3Y', '3년'], ['5Y', '5년'], ['ALL', '전체']];
  const byType = {};
  S.accounts.forEach((a) => { (byType[a.type] = byType[a.type] || []).push(a); });
  const repaidAll = sum(S.loans, loanRepaidRecorded);
  view.innerHTML = `
    ${header('ASSETS', '자산 · 부채')}
    <section class="card">
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div class="stat"><div class="k"><span class="dot" style="background:var(--saving)"></span>총자산</div><div class="v num">${won(t.assets)}</div></div>
        <div class="stat"><div class="k"><span class="dot" style="background:var(--debt)"></span>총부채</div><div class="v num">${won(t.debts)}</div></div>
        <div class="stat wide"><div class="k">순자산</div><div class="v num">${won(t.net)}</div></div>
      </div>
    </section>
    <section class="card">
      <div class="card-title"><h2>자산 흐름</h2>${repaidAll ? `<span class="link num">누적 상환 ${man(repaidAll)}원</span>` : ''}</div>
      <div class="seg" style="margin-bottom:14px">${ranges.map(([k, l]) => `<button class="${ui.range === k ? 'on' : ''}" data-act="range" data-r="${k}">${l}</button>`).join('')}</div>
      <div id="trend"></div>
    </section>

    <div class="card-title" style="margin:22px 4px 10px"><h2>자산 계정</h2><button class="text-btn" data-act="acc-new">+ 계정 추가</button></div>
    ${S.accounts.length ? ACC_TYPES.filter((ty) => byType[ty]).concat(Object.keys(byType).filter((ty) => !ACC_TYPES.includes(ty))).map((ty) => `
      <div class="section-label" style="margin-top:8px">${esc(ty)} <span class="faint num">${won(sum(byType[ty], (a) => accountBalance(a)))}</span></div>
      <div class="list">${byType[ty].map((a) => `<button class="item" data-act="acc-open" data-id="${a.id}">
        <span class="ic" style="background:var(--accent);color:var(--on-accent)">${esc(a.name[0] || '자')}</span>
        <span class="main"><div class="t">${esc(a.name)}</div><div class="s">기준일 ${fmtDot(a.baseDate)} · 기준잔액 ${fmtN(a.openingBalance)}원</div></span>
        <span class="amt num">${won(accountBalance(a))}</span></button>`).join('')}</div>`).join('')
      : `<div class="card empty">등록된 자산 계정이 없습니다.<br><button class="btn inline" data-act="acc-new" style="margin-top:10px">계정 추가</button></div>`}

    <div class="card-title" style="margin:22px 4px 10px"><h2>부채</h2><button class="text-btn" data-act="loan-new">+ 대출 추가</button></div>
    ${S.loans.length ? S.loans.map((l) => {
      const bal = loanBalance(l);
      const base = l.principal || l.openingBalance || 0;
      const paidPct = base ? clamp(1 - bal / base, 0, 1) : 0;
      const po = payoffInfo(l);
      return `<section class="card">
        <div class="card-title" style="margin-bottom:6px"><h2>${esc(l.name)}</h2><span class="link">${esc(LOAN_METHODS[l.method] || '')}${l.rate ? ` · ${l.rate}%` : ''}</span></div>
        <div class="kv-big num dbt">${won(bal)}</div>
        <div class="bar navy" style="margin-top:10px"><i style="width:${paidPct * 100}%;background:var(--saving)"></i></div>
        <div class="bar-meta"><span>최초 ${man(base)}원 중 ${Math.round(paidPct * 100)}% 상환</span><span>기록 상환 ${man(loanRepaidRecorded(l))}원</span></div>
        <div class="loan-meta"><div><div class="k">월 상환액</div><div class="v num">${l.monthlyPayment ? man(l.monthlyPayment) + '원' : '-'}</div></div>
          <div><div class="k">이번 달 이자(예상)</div><div class="v num">${fmtN(loanSplit(l, bal).interest)}원</div></div>
          <div><div class="k">예상 완납</div><div class="v num" style="font-size:12px">${esc(po.label)}</div></div></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn ghost inline" data-act="loan-edit" data-id="${l.id}">정보 수정</button><button class="btn inline" data-act="loan-pay" data-id="${l.id}">상환 기록</button></div>
      </section>`;
    }).join('') : `<div class="card empty">등록된 대출이 없습니다.<br><button class="btn inline" data-act="loan-new" style="margin-top:10px">대출 추가</button></div>`}`;

  const dates = rangeDates(ui.range);
  const pts = seriesFor(dates);
  const showYear = dates.length && ymOf(dates[0]).slice(0, 4) !== ymOf(dates[dates.length - 1]).slice(0, 4);
  lineChart($('#trend'), {
    labels: dates,
    fmtLabel: (d, long) => { const x = pd(d); return long ? fmtDot(d) : showYear ? `${String(x.getFullYear()).slice(2)}.${x.getMonth() + 1}` : `${x.getMonth() + 1}.${x.getDate()}`; },
    series: [
      { name: '순자산', color: 'var(--accent)', values: pts.map((p) => p.net), area: true, width: 2.6 },
      { name: '총자산', color: 'var(--saving)', values: pts.map((p) => p.assets) },
      { name: '총부채', color: 'var(--debt)', values: pts.map((p) => p.debts) },
      { name: '누적 상환', color: 'var(--income)', values: pts.map((p) => p.repaid), dash: true }
    ]
  });
  if (new Set(dates).size < 2) $('#trend').insertAdjacentHTML('beforeend', '<div class="hint" style="text-align:center">기준일 이후 기록이 쌓이면 날짜별 추이가 선으로 표시됩니다.</div>');
}

function renderGoals() {
  const seg = `<div class="seg" style="margin-bottom:16px"><button class="${ui.goalSeg === 'goals' ? 'on' : ''}" data-act="goal-seg" data-s="goals">재무 목표</button><button class="${ui.goalSeg === 'sim' ? 'on' : ''}" data-act="goal-seg" data-s="sim">미래 시뮬레이션</button></div>`;
  if (ui.goalSeg === 'sim') { view.innerHTML = header('GOALS', '미래 자산 시뮬레이션') + seg + '<div id="simRoot"></div>'; renderSim($('#simRoot')); return; }
  const groups = HORIZONS.map((h) => ({ h, goals: S.goals.filter((g) => horizonOf(g).key === h.key) }));
  view.innerHTML = `${header('GOALS', '재무 목표', `<button class="icon-btn" data-act="goal-new" aria-label="목표 추가">${ICON.plus.replace('<svg', '<svg style="stroke-width:2.2"')}</button>`)}${seg}
    ${S.goals.length ? groups.filter((g) => g.goals.length).map(({ h, goals }) => `
      <div class="section-label">${h.label} <span class="faint">${h.range}</span></div>
      ${goals.map((g) => {
        const p = goalProgress(g);
        const kind = GOAL_KIND[g.kind] || GOAL_KIND.manual;
        const color = p.done ? 'var(--saving)' : g.kind === 'netWorth' ? 'var(--accent)' : 'var(--saving)';
        return `<button class="card goal" style="width:100%;text-align:left;display:block" data-act="goal-open" data-id="${g.id}">
          <div class="top"><div><div class="name">${esc(g.name)}</div><div class="muted" style="font-size:12px;margin-top:2px">${kind.label} · ~${fmtDot(g.targetDate)}</div></div>${ringSVG(p.pct, color)}</div>
          <div class="bar" style="margin-top:12px"><i style="width:${p.pct * 100}%;background:${color}"></i></div>
          <div class="bar-meta"><span class="num">${korWon(p.cur)}</span><span class="num">목표 ${korWon(p.target)}</span></div>
          <div class="meta"><div>남은 금액<b class="num">${korWon(p.remaining)}</b></div><div>${p.done ? '달성 완료' : esc(kind.req)}<b class="num">${p.done ? '🎉' : '약 ' + korWon(p.required)}</b></div></div>
        </button>`;
      }).join('')}`).join('')
      : `<div class="card empty">아직 목표가 없습니다.<br><span class="faint">기간별(최단기·단기·중장기·장기)로 목표를 세워 보세요.</span>
          <div style="display:grid;gap:8px;margin-top:14px"><button class="btn" data-act="goal-new">새 목표 만들기</button>
          <button class="btn ghost" data-act="goal-template">예시로 시작: 3년 안에 순자산 1억</button></div></div>`}`;
}

function simDefaults() {
  const t = totals();
  const principal = sum(S.loans, (l) => (loanBalance(l) > 0 ? loanSplit(l).principal : 0));
  return {
    assets: Math.round(t.assets), debts: Math.round(t.debts), saving: S.settings.savingGoal || 0, principal: Math.round(principal / 1000) * 1000,
    growth: 3, ret: 3, target: 100000000, years: 10, raise: false, salary: S.settings.salary || 0, tax: 25, living: 1500000, inflation: 2.5, redirect: true
  };
}
function renderSim(root) {
  if (!ui.sim) ui.sim = simDefaults();
  const p = ui.sim;
  const pctIn = (name, v) => `<input class="input num" name="${name}" inputmode="decimal" value="${v}" style="text-align:right">`;
  root.innerHTML = `
    <section class="card" id="simForm">
      <div class="card-title"><h2>가정 설정</h2><button class="text-btn" data-act="sim-reset">현재 값으로</button></div>
      <div class="row2">${field('현재 총자산', moneyInput('assets', p.assets))}${field('현재 총부채', moneyInput('debts', p.debts))}</div>
      <div class="hint" style="margin:-6px 2px 12px">현재 순자산 <b class="num" id="simNet">${won(p.assets - p.debts)}</b></div>
      <div class="row2">${field('월 저축액', moneyInput('saving', p.saving), '대출 상환 후 순수 저축')}${field('월 부채 상환 원금', moneyInput('principal', p.principal))}</div>
      <div class="row2">${field('투자 수익률 (연 %)', pctIn('ret', p.ret))}${field('연봉 상승률 (연 %)', pctIn('growth', p.growth))}</div>
      <div class="row2">${field('목표 순자산', moneyInput('target', p.target))}${field('목표 기간 (년)', `<input class="input num" name="years" inputmode="numeric" value="${p.years}" style="text-align:right">`)}</div>
      <div class="toggle-row"><div><b style="font-size:14px">대출 완납 후 상환액을 저축으로</b><div class="hint" style="margin:2px 0 0">완납 이후 월 상환 원금만큼 저축 증가</div></div>
        <label class="switch"><input type="checkbox" name="redirect" value="1" ${p.redirect ? 'checked' : ''}><span></span></label></div>
      <div class="toggle-row"><div><b style="font-size:14px">연봉 상승분을 저축에 반영</b><div class="hint" style="margin:2px 0 0">세금·생활비 증가 가정을 함께 적용</div></div>
        <label class="switch"><input type="checkbox" name="raise" value="1" ${p.raise ? 'checked' : ''}><span></span></label></div>
      <div id="raiseBox" class="${p.raise ? '' : 'hidden'}">
        <div class="row2">${field('현재 세전 연봉', moneyInput('salary', p.salary))}${field('인상분 세금·공제율 (%)', pctIn('tax', p.tax))}</div>
        <div class="row2">${field('현재 월 생활비', moneyInput('living', p.living))}${field('생활비 증가율 (연 %)', pctIn('inflation', p.inflation))}</div>
      </div>
    </section>
    <section class="card" id="simOut"></section>
    <div class="disclaimer">⚠️ 이 결과는 입력한 가정에 따른 <b>시뮬레이션</b>이며 확정된 금액이 아닙니다. 수익률·연봉·지출은 실제와 다를 수 있으며, 대출 이자는 생활비(지출)에 포함된 것으로 가정합니다.</div>`;
  const form = $('#simForm', root);
  bindMoney(form);
  const update = () => {
    const v = readForm(form);
    const num = (x) => { const n = parseFloat(String(x).replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
    Object.assign(p, {
      assets: v.assets, debts: v.debts, saving: v.saving, principal: v.principal, target: v.target,
      ret: num(v.ret), growth: num(v.growth), years: clamp(Math.round(num(v.years)) || 10, 1, 40),
      raise: (v.raise || []).length > 0, redirect: (v.redirect || []).length > 0,
      salary: v.salary, tax: num(v.tax), living: v.living, inflation: num(v.inflation)
    });
    $('#raiseBox', root).classList.toggle('hidden', !p.raise);
    $('#simNet', root).textContent = won(p.assets - p.debts);
    drawSimOut($('#simOut', root), p);
  };
  form.addEventListener('input', debounce(update, 200));
  form.addEventListener('change', update);
  drawSimOut($('#simOut', root), p);
}
function drawSimOut(el, p) {
  const r = simulate(p);
  const marks = [...new Set([1, 3, 5, 10, p.years])].filter((y) => y <= Math.max(10, p.years)).sort((a, b) => a - b);
  const row = (y) => r.yearly.find((x) => x.y === y);
  const hitTxt = r.hit == null ? '40년 내 달성 어려움' : r.hit === 0 ? '이미 달성' : `${fmtDot(addMonths(today(), r.hit)).slice(0, 7)} (${Math.floor(r.hit / 12)}년 ${r.hit % 12}개월 후)`;
  const within = r.hit != null && r.hit <= p.years * 12;
  el.innerHTML = `
    <div class="card-title"><h2>예측 결과</h2></div>
    <div class="stat" style="margin-bottom:14px"><div class="k">목표 ${korWon(p.target)} 달성 예상 시점</div>
      <div class="v ${within ? 'sav' : r.hit == null ? 'exp' : ''}" style="font-size:16px">${hitTxt}</div>
      ${r.hit != null && r.hit > 0 ? `<div class="hint" style="margin:4px 0 0">${within ? `목표 기간 ${p.years}년 안에 달성 가능` : `목표 기간 ${p.years}년보다 ${Math.ceil((r.hit - p.years * 12) / 12)}년가량 더 필요`}</div>` : ''}
      ${r.payoffM ? `<div class="hint" style="margin:2px 0 0">대출 완납 예상: ${fmtDot(addMonths(today(), r.payoffM)).slice(0, 7)}</div>` : ''}</div>
    <div style="overflow-x:auto"><table class="sim-table"><thead><tr><th>기간</th><th>예상 총자산</th><th>예상 총부채</th><th>예상 순자산</th></tr></thead>
      <tbody>${marks.map((y) => { const x = row(y); return x ? `<tr><td>${y}년 후</td><td class="num">${man(x.assets)}</td><td class="num dbt">${man(x.debts)}</td><td class="num"><b>${man(x.net)}</b></td></tr>` : ''; }).join('')}</tbody></table></div>
    <div id="simChart" style="margin-top:16px"></div>`;
  const ys = r.yearly.filter((x) => x.y <= Math.max(10, p.years));
  lineChart($('#simChart', el), {
    labels: ys.map((x) => String(x.y)), fmtLabel: (y, long) => (long ? `${y}년 후` : `${y}년`),
    series: [
      { name: '예상 순자산', color: 'var(--accent)', values: ys.map((x) => x.net), area: true, width: 2.6 },
      { name: '예상 총자산', color: 'var(--saving)', values: ys.map((x) => x.assets) },
      { name: '예상 총부채', color: 'var(--debt)', values: ys.map((x) => x.debts) },
      { name: '목표', color: 'var(--warn)', values: ys.map(() => p.target), dash: true, width: 1.5 }
    ]
  });
}

/* =========================================================
 * Sheets: 거래 입력/수정
 * ======================================================= */
function defaultAccountId() {
  const last = [...S.txs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).find((t) => t.accountId && S.accounts.some((a) => a.id === t.accountId));
  return last ? last.accountId : S.accounts[0]?.id || '';
}
async function needAccount() {
  const ok = await confirmDialog('계정이 필요해요', '거래를 기록하려면 먼저 현금·통장 등 자산 계정을 하나 이상 추가해 주세요.', { ok: '계정 추가' });
  if (ok) openAccountForm();
}
function openTxForm(tx = null, preset = {}) {
  if (!S.accounts.length) return needAccount();
  const isEdit = !!tx;
  const f = tx ? { ...tx } : {
    type: 'expense', amount: 0, date: today(), time: '', category: '', accountId: defaultAccountId(), toAccountId: '',
    loanId: S.loans[0]?.id || '', principal: 0, interest: 0, payMethod: S.settings.payMethods[0] || '', merchant: '', memo: '', ...preset
  };
  let splitTouched = isEdit;
  const sh = openSheet({
    title: isEdit ? '거래 수정' : '거래 추가',
    body: '<div id="txf"></div>',
    foot: `${isEdit ? '<div class="btn-row"><button class="btn danger" data-act="tx-del">삭제</button><button class="btn" data-act="tx-save">저장</button></div>' : '<button class="btn" data-act="tx-save">저장</button>'}`,
    actions: {
      'tx-save': () => save(),
      'tx-del': async () => {
        if (!(await confirmDialog('거래 삭제', '이 거래를 삭제할까요? 되돌릴 수 없습니다.', { ok: '삭제', danger: true }))) return;
        if (await remove('transactions', tx.id)) { S.txs = S.txs.filter((x) => x.id !== tx.id); sh.close(); toast('삭제했습니다'); refresh(); }
      },
      'tx-type': (b) => { f.type = b.dataset.v; f.category = ''; draw(); },
      'tx-cat': (b) => { f.category = b.dataset.v; $$('[data-act="tx-cat"]', sh.el).forEach((x) => x.classList.toggle('on', x === b)); },
      'tx-quick': (b) => { f.amount = (f.amount || 0) + Number(b.dataset.v); const i = $('[name="amount"]', sh.el); i.value = moneyVal(f.amount); syncRepay(); },
      'tx-date': (b) => { f.date = addDays(today(), Number(b.dataset.v)); $('[name="date"]', sh.el).value = f.date; baselineHint(); },
      'tx-split': () => { splitTouched = false; autoSplit(true); },
      'tx-ocr': () => { sh.close(); openOcrSheet(); }
    }
  });
  const root = $('#txf', sh.el);
  function cats() { return f.type === 'income' ? S.settings.incomeCats : S.settings.expenseCats; }
  function accOptions(sel, exclude) {
    return S.accounts.filter((a) => a.id !== exclude).map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)} (${fmtN(accountBalance(a))}원)</option>`).join('');
  }
  function draw() {
    if ((f.type === 'expense' || f.type === 'income') && !cats().includes(f.category)) f.category = cats()[0] || '기타';
    const types = [['expense', '지출'], ['income', '수입'], ['transfer', '이체'], ['repay', '대출 상환']];
    const isRepay = f.type === 'repay';
    root.innerHTML = `
      ${!isEdit ? `<button class="btn ghost" data-act="tx-ocr" style="margin-bottom:14px">${ICON.camera.replace('<svg', '<svg width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8"')} 캡처 이미지로 자동 기록</button>` : ''}
      ${f.type === 'adjust' ? '<div class="banner info"><div class="main"><b>잔액 조정 거래</b>수입·지출 통계에는 포함되지 않습니다.</div></div>' : `<div class="seg type" style="margin-bottom:14px">${types.map(([k, l]) => `<button class="${f.type === k ? 'on' : ''}" data-act="tx-type" data-v="${k}">${l}</button>`).join('')}</div>`}
      ${isRepay ? (S.loans.length ? `
        ${field('대출', `<select class="input" name="loanId">${S.loans.map((l) => `<option value="${l.id}" ${l.id === f.loanId ? 'selected' : ''}>${esc(l.name)} (잔액 ${fmtN(loanBalance(l))}원)</option>`).join('')}</select>`)}
        <div class="row2">${field('원금 상환', moneyInput('principal', f.principal))}${field('이자', moneyInput('interest', f.interest))}</div>
        <div class="hint" style="margin:-6px 2px 12px">합계 <b class="num" id="repTotal">${won((f.principal || 0) + (f.interest || 0))}</b> · 원금은 부채를 줄이고, 이자만 지출로 집계됩니다. <button class="text-btn" data-act="tx-split" style="font-size:12px">자동 계산</button></div>`
        : '<div class="banner"><div class="main"><b>등록된 대출이 없습니다</b>ASSETS 탭에서 대출을 먼저 추가해 주세요.</div></div>')
      : `${field('금액', `<input class="input money num amount-input ${f.type === 'adjust' ? '' : ''}" name="amount" inputmode="numeric" autocomplete="off" placeholder="0" ${f.type === 'adjust' ? 'data-neg="1"' : ''} value="${f.amount ? (f.amount < 0 ? '-' : '') + moneyVal(Math.abs(f.amount)) : ''}">`)}
        ${f.type !== 'adjust' ? `<div class="quick" style="margin:-6px 0 14px">${[1000, 5000, 10000, 50000, 100000].map((v) => `<button data-act="tx-quick" data-v="${v}">+${man(v)}</button>`).join('')}</div>` : ''}`}
      <div class="row2">${field('날짜', `<input class="input" type="date" name="date" value="${f.date}" required>`)}${field('시간 (선택)', `<input class="input" type="time" name="time" value="${f.time || ''}">`)}</div>
      <div class="quick" style="margin:-8px 0 12px"><button data-act="tx-date" data-v="0">오늘</button><button data-act="tx-date" data-v="-1">어제</button></div>
      <div class="hint warn hidden" id="baseHint" style="margin:-6px 2px 12px"></div>
      ${f.type === 'expense' || f.type === 'income' ? `<div class="field"><span class="lbl">카테고리</span><div class="cat-grid">${cats().map((c) => `<button class="${c === f.category ? 'on' : ''}" data-act="tx-cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>` : ''}
      ${f.type === 'transfer' ? `<div class="row2">${field('보내는 계정', `<select class="input" name="accountId">${accOptions(f.accountId)}</select>`)}${field('받는 계정', `<select class="input" name="toAccountId"><option value="">선택</option>${accOptions(f.toAccountId, null)}</select>`)}</div><div class="hint" style="margin:-6px 2px 12px">계정 간 이체는 수입·지출로 계산되지 않습니다.</div>`
        : field(f.type === 'income' ? '입금 계정' : f.type === 'adjust' ? '계정' : '출금 계정', `<select class="input" name="accountId">${accOptions(f.accountId)}</select>`)}
      ${f.type === 'expense' ? field('결제 수단', `<select class="input" name="payMethod">${S.settings.payMethods.map((m) => `<option ${m === f.payMethod ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`) : ''}
      ${f.type !== 'adjust' ? field(f.type === 'income' ? '거래처 (선택)' : f.type === 'expense' ? '가맹점 · 거래처 (선택)' : '내용 (선택)', `<input class="input" name="merchant" value="${esc(f.merchant)}" maxlength="60" autocomplete="off">`) : ''}
      ${field('메모 (선택)', `<input class="input" name="memo" value="${esc(f.memo)}" maxlength="200" autocomplete="off">`)}`;
    root.oninput = root.onchange = (e) => {
      const n = e.target.name; if (!n) return;
      f[n] = e.target.classList.contains('money') ? parseNum(e.target.value) : e.target.value;
      if (n === 'principal' || n === 'interest') { splitTouched = true; syncRepay(); }
      if (n === 'loanId' || n === 'date') { if (!splitTouched) autoSplit(); }
      if (n === 'date' || n === 'accountId') baselineHint();
    };
    if (isRepay && !splitTouched) autoSplit();
    baselineHint();
  }
  function syncRepay() { const el = $('#repTotal', sh.el); if (el) el.textContent = won((f.principal || 0) + (f.interest || 0)); }
  function autoSplit(force) {
    const loan = S.loans.find((l) => l.id === f.loanId) || S.loans[0];
    if (!loan) return;
    f.loanId = loan.id;
    const s = loanSplit(loan);
    f.principal = s.principal; f.interest = s.interest;
    const pi = $('[name="principal"]', sh.el), ii = $('[name="interest"]', sh.el);
    if (pi) pi.value = moneyVal(f.principal);
    if (ii) ii.value = moneyVal(f.interest);
    syncRepay();
    if (force) toast('월 상환액·금리 기준으로 계산했습니다');
  }
  function baselineHint() {
    const el = $('#baseHint', sh.el);
    const acc = S.accounts.find((a) => a.id === f.accountId);
    const before = acc && f.date < acc.baseDate;
    el.classList.toggle('hidden', !before);
    if (before) el.textContent = `'${acc.name}' 기준일(${fmtDot(acc.baseDate)}) 이전 거래 — 통계에는 포함되지만 계정 잔액에는 반영되지 않습니다(중복 방지).`;
  }
  async function save() {
    const o = { ...f };
    o.amount = Math.round(o.amount || 0);
    if (o.type === 'repay') {
      if (!S.loans.length) return toast('대출을 먼저 추가해 주세요', true);
      o.principal = Math.round(o.principal || 0); o.interest = Math.round(o.interest || 0);
      o.amount = o.principal + o.interest;
      o.category = '대출 상환';
      if (!o.loanId) o.loanId = S.loans[0].id;
      const ln = S.loans.find((l) => l.id === o.loanId);
      if (ln && o.principal > loanBalance(ln) + (isEdit && tx.loanId === o.loanId ? tx.principal || 0 : 0)) return toast('원금 상환액이 대출 잔액보다 큽니다', true);
    }
    if (o.type === 'adjust' ? !o.amount : o.amount <= 0) return toast('금액을 입력해 주세요', true);
    if (!o.date) return toast('날짜를 입력해 주세요', true);
    if (!S.accounts.some((a) => a.id === o.accountId)) return toast('계정을 선택해 주세요', true);
    if (o.type === 'transfer') {
      if (!o.toAccountId) return toast('받는 계정을 선택해 주세요', true);
      if (o.toAccountId === o.accountId) return toast('보내는 계정과 받는 계정이 같습니다', true);
      o.category = '이체';
    } else o.toAccountId = '';
    if (o.type !== 'repay') { o.loanId = ''; o.principal = 0; o.interest = 0; }
    if (o.type !== 'expense') o.payMethod = o.type === 'transfer' ? '계좌이체' : '';
    o.merchant = (o.merchant || '').trim(); o.memo = (o.memo || '').trim();
    if (!isEdit && o.type !== 'adjust') {
      const dup = findDuplicate(o);
      if (dup && !(await confirmDialog('중복 가능성', `같은 날짜·금액의 거래가 이미 있습니다.\n${dup.merchant || dup.category} ${won(dup.amount)}\n그래도 저장할까요?`, { ok: '저장' }))) return;
    }
    const now = Date.now();
    const rec = { ...o, id: o.id || uid(), source: o.source || 'manual', createdAt: o.createdAt || now, updatedAt: now };
    if (await persist('transactions', rec)) {
      upsert(S.txs, rec);
      sh.close();
      toast(isEdit ? '수정했습니다' : '저장했습니다');
      refresh();
    }
  }
  draw();
  if (!isEdit) setTimeout(() => { const i = $('[name="amount"]', sh.el); if (i && !isTouch()) i.focus(); }, 300);
}

/* =========================================================
 * Sheets: OCR 캡처 자동 기록
 * ======================================================= */
function openOcrSheet() {
  if (!S.accounts.length) return needAccount();
  let cands = [];
  let rawText = '';
  let imgUrls = [];
  const sh = openSheet({
    title: '캡처 이미지 자동 기록',
    body: '<div id="ocrRoot"></div>',
    actions: {
      'ocr-pick': () => $('#ocrFile', sh.el).click(),
      'ocr-manual': () => { sh.close(); openTxForm(null, cands[0] ? { type: cands[0].type, amount: cands[0].amount, date: cands[0].date, time: cands[0].time, merchant: cands[0].merchant, category: cands[0].category } : {}); },
      'ocr-save': () => saveCands(),
      'ocr-all': (b) => { const on = b.dataset.on !== '1'; cands.forEach((c) => (c.on = on)); drawCands(); },
      'ocr-del': (b) => { cands.splice(Number(b.dataset.i), 1); drawCands(); },
      'ocr-prefetch': async () => { await runInit(); },
      'ocr-retry': () => drawStart()
    },
    onClose: () => imgUrls.forEach((u) => URL.revokeObjectURL(u))
  });
  const root = $('#ocrRoot', sh.el);
  const onNet = () => { if (!sh.closed) updateStatus(); else { removeEventListener('online', onNet); removeEventListener('offline', onNet); } };
  addEventListener('online', onNet); addEventListener('offline', onNet);

  async function updateStatus() {
    const el = $('#ocrStatus', sh.el);
    if (!el) return;
    const st = await OCR.status();
    let cls = 'ok', txt = '';
    if (st.ready || st.cached) { txt = st.online ? '기기 내 OCR 사용 가능 · 오프라인에서도 동작' : '오프라인 · 기기 내 OCR 사용 가능'; }
    else if (st.online) { cls = 'mid'; txt = '온라인 · 첫 사용 시 OCR 엔진(약 9MB)을 내려받습니다'; }
    else { cls = 'no'; txt = '오프라인 · OCR 엔진이 아직 없어 사용할 수 없습니다. 수동 입력을 이용하세요.'; }
    el.innerHTML = `<span class="dot ${cls}"></span><span>${txt}</span>`;
    const pick = $('[data-act="ocr-pick"]', sh.el);
    if (pick) pick.disabled = cls === 'no';
    const pre = $('[data-act="ocr-prefetch"]', sh.el);
    if (pre) pre.classList.toggle('hidden', !(cls === 'mid'));
  }
  function drawStart() {
    root.innerHTML = `
      <div class="status-line" id="ocrStatus"><span class="dot mid"></span><span>상태 확인 중…</span></div>
      <div class="drop">${ICON.camera}<b>카드·은행 거래내역, 영수증 캡처</b>
        <div class="hint" style="margin:6px 0 14px">여러 거래가 담긴 캡처도 각각 나눠 인식합니다.<br>이미지는 이 기기 안에서만 처리되며 외부로 전송되지 않습니다.</div>
        <button class="btn" data-act="ocr-pick">이미지 선택</button>
        <button class="text-btn hidden" data-act="ocr-prefetch" style="margin-top:8px">OCR 엔진 미리 받기</button>
        <input type="file" id="ocrFile" accept="image/*" multiple hidden></div>
      <button class="btn ghost" data-act="ocr-manual" style="margin-top:12px">수동 입력으로 전환</button>`;
    $('#ocrFile', sh.el).addEventListener('change', (e) => { const files = [...e.target.files]; if (files.length) run(files); });
    updateStatus();
  }
  function progress(msg) { const el = $('#ocrProg', sh.el); if (el) el.textContent = msg; }
  async function runInit() {
    root.insertAdjacentHTML('beforeend', '<div class="progress-txt" id="ocrProg">준비 중…</div>');
    try { await OCR.init((m) => progress(m)); progress('OCR 엔진 준비 완료'); toast('OCR 엔진을 기기에 저장했습니다'); }
    catch (e) { console.error(e); progress('엔진을 받지 못했습니다: ' + (e.message || e)); }
    updateStatus();
  }
  async function run(files) {
    imgUrls.forEach((u) => URL.revokeObjectURL(u));
    imgUrls = files.map((f) => URL.createObjectURL(f));
    root.innerHTML = `${imgUrls.map((u) => `<img class="preview-img" src="${u}" alt="선택한 캡처">`).join('')}<div class="progress-txt" id="ocrProg">준비 중…</div>`;
    cands = []; rawText = '';
    try {
      for (let k = 0; k < files.length; k++) {
        const text = await OCR.recognize(files[k], (m) => progress((files.length > 1 ? `(${k + 1}/${files.length}) ` : '') + m));
        rawText += (rawText ? '\n\n' : '') + text;
        cands.push(...parseReceiptText(text));
      }
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="banner"><div class="main"><b>인식에 실패했습니다</b>${esc(e.message || String(e))}</div></div>
        <div class="btn-row"><button class="btn ghost" data-act="ocr-retry">다시 시도</button><button class="btn" data-act="ocr-manual">수동 입력</button></div>`;
      return;
    }
    const accId = defaultAccountId();
    const seen = new Set();
    cands.forEach((c) => {
      c.accountId = accId;
      const key = `${c.date}|${c.amount}|${normM(c.merchant)}`;
      c.dup = findDuplicate(c) ? 'saved' : seen.has(key) ? 'batch' : '';
      seen.add(key);
      c.on = !c.dup;
    });
    drawCands();
  }
  function drawCands() {
    if (!cands.length) {
      root.innerHTML = `<div class="banner"><div class="main"><b>거래를 찾지 못했습니다</b>금액이 잘 보이도록 캡처하거나 수동으로 입력해 주세요.</div></div>
        <details class="raw" open><summary>인식된 글자</summary><pre>${esc(rawText || '(없음)')}</pre></details>
        <div class="btn-row" style="margin-top:12px"><button class="btn ghost" data-act="ocr-retry">다른 이미지</button><button class="btn" data-act="ocr-manual">수동 입력</button></div>`;
      return;
    }
    const n = cands.filter((c) => c.on).length;
    const all = cands.every((c) => c.on);
    root.innerHTML = `
      <div class="banner info"><div class="main"><b>${cands.length}건 인식 — 확인 후 저장하세요</b>저장 전에 금액·날짜·거래처를 확인하고 틀린 부분은 고쳐 주세요.</div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:0 2px 8px"><button class="text-btn" data-act="ocr-all" data-on="${all ? '1' : '0'}">${all ? '전체 해제' : '전체 선택'}</button><button class="text-btn" data-act="ocr-retry">다른 이미지</button></div>
      ${cands.map((c, i) => `
      <div class="cand ${c.on ? '' : 'off'} ${c.dup ? 'dup' : ''}" data-i="${i}">
        <div class="chead"><input type="checkbox" data-k="on" ${c.on ? 'checked' : ''} aria-label="저장 선택">
          <b style="flex:1">${i + 1}번 거래</b>${c.dup ? `<span class="badge">${c.dup === 'saved' ? '이미 등록된 거래와 중복 가능' : '이미지 내 중복 가능'}</span>` : ''}
          <button class="text-btn" data-act="ocr-del" data-i="${i}" style="color:var(--debt)">삭제</button></div>
        <div class="grid3">
          <select class="input" data-k="type"><option value="expense" ${c.type === 'expense' ? 'selected' : ''}>지출</option><option value="income" ${c.type === 'income' ? 'selected' : ''}>수입</option></select>
          <input class="input money num" data-k="amount" inputmode="numeric" value="${moneyVal(c.amount)}" style="text-align:right;font-weight:700">
          <input class="input" type="date" data-k="date" value="${c.date}">
          <input class="input" type="time" data-k="time" value="${c.time}">
          <input class="input full" data-k="merchant" value="${esc(c.merchant)}" placeholder="가맹점·거래처">
          <select class="input" data-k="category">${(c.type === 'income' ? S.settings.incomeCats : S.settings.expenseCats).map((x) => `<option ${x === c.category ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <select class="input" data-k="accountId">${S.accounts.map((a) => `<option value="${a.id}" ${a.id === c.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
        </div>
        <div class="hint faint" style="font-size:11px">원문: ${esc(c.raw)}</div>
      </div>`).join('')}
      <details class="raw"><summary>인식된 전체 글자 보기</summary><pre>${esc(rawText)}</pre></details>
      <div style="display:grid;gap:8px;margin-top:14px">
        <button class="btn" data-act="ocr-save" ${n ? '' : 'disabled'}>선택한 ${n}건 저장</button>
        <button class="btn ghost" data-act="ocr-manual">수동 입력으로 전환</button></div>`;
    root.oninput = root.onchange = (e) => {
      const box = e.target.closest('.cand'); if (!box) return;
      const c = cands[Number(box.dataset.i)]; const k = e.target.dataset.k; if (!k) return;
      if (k === 'on') { c.on = e.target.checked; box.classList.toggle('off', !c.on); const nn = cands.filter((x) => x.on).length; const b = $('[data-act="ocr-save"]', sh.el); b.textContent = `선택한 ${nn}건 저장`; b.disabled = !nn; return; }
      c[k] = e.target.classList.contains('money') ? parseNum(e.target.value) : e.target.value;
      if (k === 'type' && e.type === 'change') { c.category = guessCategory(c.merchant, c.type); drawCands(); }
    };
  }
  async function saveCands() {
    const sel = cands.filter((c) => c.on);
    if (sel.some((c) => !(c.amount > 0) || !c.date)) return toast('금액과 날짜를 확인해 주세요', true);
    const now = Date.now();
    const recs = sel.map((c, i) => ({
      id: uid(), type: c.type, amount: Math.round(c.amount), date: c.date, time: c.time || '', category: c.category,
      accountId: c.accountId, toAccountId: '', loanId: '', principal: 0, interest: 0,
      payMethod: c.type === 'expense' ? (S.settings.payMethods[0] || '') : '', merchant: (c.merchant || '').trim(), memo: '',
      source: 'ocr', createdAt: now + i, updatedAt: now + i
    }));
    if (await persistMany('transactions', recs)) {
      S.txs.push(...recs);
      sh.close();
      toast(`${recs.length}건 저장했습니다`);
      refresh();
    }
  }
  drawStart();
}

/* =========================================================
 * Sheets: 계정 / 대출
 * ======================================================= */
function openAccountForm(acc = null) {
  const isEdit = !!acc;
  const sh = openSheet({
    title: isEdit ? '계정 수정' : '자산 계정 추가',
    body: `<form id="accF" onsubmit="return false">
      ${field('계정 이름', `<input class="input" name="name" value="${esc(acc?.name || '')}" placeholder="예: 토스뱅크 통장" maxlength="30" required>`)}
      ${field('종류', `<select class="input" name="type">${ACC_TYPES.map((t) => `<option ${t === (acc?.type || '입출금통장') ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
      <div class="row2">${field('기준일 잔액', moneyInput('openingBalance', acc?.openingBalance ?? ''))}${field('기준일', `<input class="input" type="date" name="baseDate" value="${acc?.baseDate || today()}">`)}</div>
      <div class="hint">기준일 잔액에서 출발해 이후 기록한 거래만 잔액에 반영됩니다(중복 합산 방지).${isEdit ? ' 기준값을 바꾸면 이후 거래로 잔액이 다시 계산됩니다.' : ''}</div>
    </form>`,
    foot: isEdit ? '<div class="btn-row"><button class="btn danger" data-act="del">삭제</button><button class="btn" data-act="save">저장</button></div>' : '<button class="btn" data-act="save">추가</button>',
    actions: {
      save: async () => {
        const v = readForm($('#accF', sh.el));
        if (!v.name.trim()) return toast('계정 이름을 입력해 주세요', true);
        if (!v.baseDate) return toast('기준일을 입력해 주세요', true);
        const now = Date.now();
        const changedBase = !isEdit || v.openingBalance !== acc.openingBalance || v.baseDate !== acc.baseDate;
        const rec = { ...(acc || { id: uid(), createdAt: now, order: S.accounts.length }), name: v.name.trim(), type: v.type, openingBalance: Math.round(v.openingBalance), baseDate: v.baseDate, updatedAt: now };
        if (changedBase) rec.baseSetAt = now;
        if (await persist('accounts', rec)) { upsert(S.accounts, rec); sh.close(); toast(isEdit ? '수정했습니다' : '계정을 추가했습니다'); refresh(); }
      },
      del: async () => {
        const n = S.txs.filter((t) => t.accountId === acc.id || t.toAccountId === acc.id).length;
        if (!(await confirmDialog('계정 삭제', `'${acc.name}' 계정을 삭제할까요?${n ? `\n연결된 거래 ${n}건은 내역에 남지만 잔액 계산에서는 빠집니다.` : ''}`, { ok: '삭제', danger: true }))) return;
        if (await remove('accounts', acc.id)) { S.accounts = S.accounts.filter((a) => a.id !== acc.id); closeAllSheets(); toast('삭제했습니다'); refresh(); }
      }
    }
  });
}
function openAccountDetail(acc) {
  const bal = accountBalance(acc);
  const txs = S.txs.filter((t) => t.accountId === acc.id || t.toAccountId === acc.id).sort(sortTx).slice(0, 30);
  const sh = openSheet({
    title: acc.name,
    body: `<section class="card"><div class="muted" style="font-size:13px">${esc(acc.type)} · 현재 잔액</div><div class="kv-big num" style="margin:4px 0 6px">${won(bal)}</div>
      <div class="hint" style="margin:0">기준일 ${fmtDot(acc.baseDate)} 잔액 ${won(acc.openingBalance)} + 이후 거래 ${wonS(bal - acc.openingBalance)}</div></section>
      <div class="btn-row" style="margin-bottom:14px"><button class="btn ghost" data-act="adjust">잔액 맞추기</button><button class="btn ghost" data-act="edit">계정 수정</button></div>
      <div class="section-label">최근 거래</div>
      ${txs.length ? `<div class="list">${txs.map(txItem).join('')}</div>` : '<div class="card empty">이 계정의 거래가 없습니다.</div>'}`,
    actions: {
      edit: () => { sh.close(); openAccountForm(acc); },
      adjust: async () => {
        sh.close();
        const s2 = openSheet({
          title: '잔액 맞추기',
          body: `<div class="hint" style="margin-bottom:14px">실제 잔액(주식 평가액 등)을 입력하면 차액만큼 '잔액 조정' 거래가 기록됩니다. 수입·지출 통계에는 포함되지 않습니다.</div>
            ${field('현재 앱 잔액', `<div class="input num" style="display:flex;align-items:center">${won(bal)}</div>`)}
            ${field('실제 잔액', moneyInput('real', bal))}`,
          foot: '<button class="btn" data-act="ok">조정 기록</button>',
          actions: {
            ok: async () => {
              const real = parseNum($('[name="real"]', s2.el).value);
              const delta = Math.round(real - bal);
              if (!delta) return toast('차액이 없습니다');
              const now = Date.now();
              const rec = { id: uid(), type: 'adjust', amount: delta, date: today(), time: '', category: '잔액 조정', accountId: acc.id, toAccountId: '', loanId: '', principal: 0, interest: 0, payMethod: '', merchant: '', memo: '', source: 'manual', createdAt: now, updatedAt: now };
              if (await persist('transactions', rec)) { S.txs.push(rec); s2.close(); toast(`${wonS(delta)} 조정했습니다`); refresh(); }
            }
          }
        });
      }
    }
  });
  sh.el.addEventListener('click', (e) => { const b = e.target.closest('[data-act="tx-edit"]'); if (b) { const t = S.txs.find((x) => x.id === b.dataset.id); sh.close(); openTxForm(t); } });
}
function openLoanForm(loan = null) {
  const isEdit = !!loan;
  const sh = openSheet({
    title: isEdit ? '대출 정보 수정' : '대출 추가',
    body: `<form id="loanF" onsubmit="return false">
      ${field('대출명', `<input class="input" name="name" value="${esc(loan?.name || '')}" placeholder="예: 학자금대출" maxlength="30">`)}
      <div class="row2">${field('최초 대출금', moneyInput('principal', loan?.principal ?? ''))}${field('현재 대출 잔액', moneyInput('openingBalance', loan?.openingBalance ?? ''))}</div>
      <div class="row2">${field('잔액 기준일', `<input class="input" type="date" name="baseDate" value="${loan?.baseDate || today()}">`)}${field('금리 (연 %)', `<input class="input num" name="rate" inputmode="decimal" value="${loan?.rate ?? ''}" placeholder="예: 1.7">`)}</div>
      <div class="row2">${field('월 상환액', moneyInput('monthlyPayment', loan?.monthlyPayment ?? ''))}${field('상환 방식', `<select class="input" name="method">${Object.entries(LOAN_METHODS).map(([k, l]) => `<option value="${k}" ${k === (loan?.method || 'annuity') ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}</div>
      ${field('만기일 (선택)', `<input class="input" type="date" name="maturityDate" value="${loan?.maturityDate || ''}">`, '예상 완납일은 잔액·금리·월 상환액으로 자동 계산됩니다. 원금균등은 월 상환액에 원금만 입력하세요.')}
    </form>`,
    foot: isEdit ? '<div class="btn-row"><button class="btn danger" data-act="del">삭제</button><button class="btn" data-act="save">저장</button></div>' : '<button class="btn" data-act="save">추가</button>',
    actions: {
      save: async () => {
        const v = readForm($('#loanF', sh.el));
        if (!v.name.trim()) return toast('대출명을 입력해 주세요', true);
        if (!(v.openingBalance >= 0)) return toast('현재 잔액을 입력해 주세요', true);
        const now = Date.now();
        const rate = parseFloat(String(v.rate).replace(/[^\d.]/g, ''));
        const changedBase = !isEdit || v.openingBalance !== loan.openingBalance || v.baseDate !== loan.baseDate;
        const rec = { ...(loan || { id: uid(), createdAt: now }), name: v.name.trim(), principal: Math.round(v.principal || v.openingBalance), openingBalance: Math.round(v.openingBalance), baseDate: v.baseDate || today(), rate: Number.isFinite(rate) ? rate : 0, monthlyPayment: Math.round(v.monthlyPayment), method: v.method, maturityDate: v.maturityDate || '', updatedAt: now };
        if (changedBase) rec.baseSetAt = now;
        if (await persist('loans', rec)) { upsert(S.loans, rec); sh.close(); toast(isEdit ? '수정했습니다' : '대출을 추가했습니다'); refresh(); }
      },
      del: async () => {
        const n = S.txs.filter((t) => t.loanId === loan.id).length;
        if (!(await confirmDialog('대출 삭제', `'${loan.name}'을(를) 삭제할까요?${n ? `\n상환 기록 ${n}건은 내역에 남습니다.` : ''}`, { ok: '삭제', danger: true }))) return;
        if (await remove('loans', loan.id)) { S.loans = S.loans.filter((l) => l.id !== loan.id); sh.close(); toast('삭제했습니다'); refresh(); }
      }
    }
  });
}

/* =========================================================
 * Sheets: 목표
 * ======================================================= */
function openGoalForm(goal = null, preset = {}) {
  const isEdit = !!goal;
  const g = goal ? { ...goal } : { kind: 'netWorth', name: '', target: 0, startDate: today(), targetDate: addMonths(today(), 36), manualCurrent: 0, accountIds: [], ...preset };
  const sh = openSheet({
    title: isEdit ? '목표 수정' : '새 목표',
    body: '<div id="gf"></div>',
    foot: isEdit ? '<div class="btn-row"><button class="btn danger" data-act="del">삭제</button><button class="btn" data-act="save">저장</button></div>' : '<button class="btn" data-act="save">목표 만들기</button>',
    actions: {
      kind: (b) => { sync(); g.kind = b.dataset.v; draw(); },
      span: (b) => { sync(); g.targetDate = addMonths(g.startDate || today(), Number(b.dataset.m)); draw(); },
      save: async () => {
        sync();
        if (!g.name.trim()) return toast('목표명을 입력해 주세요', true);
        if (!(g.target > 0)) return toast('목표 금액을 입력해 주세요', true);
        if (!g.targetDate || g.targetDate <= g.startDate) return toast('달성 날짜는 시작 날짜 이후여야 합니다', true);
        const now = Date.now();
        const rec = { ...g, id: g.id || uid(), name: g.name.trim(), target: Math.round(g.target), createdAt: g.createdAt || now, updatedAt: now };
        if (await persist('goals', rec)) { upsert(S.goals, rec); sh.close(); toast(isEdit ? '수정했습니다' : '목표를 만들었습니다'); refresh(); }
      },
      del: async () => {
        if (!(await confirmDialog('목표 삭제', `'${goal.name}' 목표를 삭제할까요?`, { ok: '삭제', danger: true }))) return;
        if (await remove('goals', goal.id)) { S.goals = S.goals.filter((x) => x.id !== goal.id); closeAllSheets(); toast('삭제했습니다'); refresh(); }
      }
    }
  });
  const root = $('#gf', sh.el);
  function sync() {
    const v = readForm(root);
    Object.assign(g, { name: v.name ?? g.name, target: v.target ?? g.target, startDate: v.startDate || g.startDate, targetDate: v.targetDate || g.targetDate });
    if ('manualCurrent' in v) g.manualCurrent = v.manualCurrent;
    if (g.kind === 'saving') g.accountIds = v.accountIds || [];
  }
  function draw() {
    const h = g.targetDate > g.startDate ? horizonOf(g) : null;
    const kinds = [['netWorth', '순자산'], ['saving', '저축'], ['manual', '직접 입력']];
    const desc = {
      netWorth: '현재 순자산(총자산 − 총부채)과 자동 연동됩니다. 부채 상환도 진척에 반영됩니다.',
      saving: '선택한 저축 계정의 잔액 합계로 측정합니다. 부채는 고려하지 않습니다.',
      manual: '현재 달성 금액을 직접 입력해 관리합니다.'
    }[g.kind];
    root.innerHTML = `
      <div class="seg" style="margin-bottom:8px">${kinds.map(([k, l]) => `<button class="${g.kind === k ? 'on' : ''}" data-act="kind" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="hint" style="margin:0 2px 14px">${desc}</div>
      ${field('목표명', `<input class="input" name="name" value="${esc(g.name)}" placeholder="${g.kind === 'netWorth' ? '예: 순자산 1억 달성' : '예: 비상금 1,000만 원'}" maxlength="40">`)}
      ${field('목표 금액', moneyInput('target', g.target || ''))}
      <div class="row2">${field('시작 날짜', `<input class="input" type="date" name="startDate" value="${g.startDate}">`)}${field('목표 달성 날짜', `<input class="input" type="date" name="targetDate" value="${g.targetDate}">`)}</div>
      <div class="quick" style="margin:-6px 0 8px">${[[3, '3개월'], [12, '1년'], [36, '3년'], [60, '5년'], [120, '10년']].map(([m, l]) => `<button data-act="span" data-m="${m}">${l}</button>`).join('')}</div>
      <div class="hint" style="margin:0 2px 14px">기간 구분: <b>${h ? `${h.label} (${h.range})` : '-'}</b></div>
      ${g.kind === 'saving' ? `<div class="field"><span class="lbl">연동할 저축 계정</span><div class="list" style="margin:0">${S.accounts.map((a) => `<label class="item" style="cursor:pointer"><input type="checkbox" name="accountIds" value="${a.id}" ${g.accountIds?.includes(a.id) ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--saving)"><span class="main"><div class="t">${esc(a.name)}</div><div class="s">${esc(a.type)}</div></span><span class="amt num">${won(accountBalance(a))}</span></label>`).join('') || '<div class="empty">계정이 없습니다</div>'}</div><div class="hint">선택하지 않으면 아래 금액을 직접 사용합니다.</div></div>` : ''}
      ${g.kind !== 'netWorth' ? field(g.kind === 'saving' ? '현재 저축액 (계정 미선택 시)' : '현재 달성 금액', moneyInput('manualCurrent', g.manualCurrent || '')) : `<div class="stat" style="margin-bottom:14px"><div class="k">현재 순자산 (자동)</div><div class="v num">${won(totals().net)}</div></div>`}`;
  }
  draw();
}
function openGoalDetail(goal) {
  const p = goalProgress(goal);
  const kind = GOAL_KIND[goal.kind] || GOAL_KIND.manual;
  const h = horizonOf(goal);
  const sh = openSheet({
    title: goal.name,
    body: `<section class="card">
        <div class="top" style="display:flex;justify-content:space-between;align-items:flex-start"><div><span class="tag" style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:99px;background:var(--field);color:var(--sub)">${h.label} · ${kind.label}</span>
          <div class="kv-big num" style="margin-top:10px">${Math.round(p.pct * 100)}%</div></div>${ringSVG(p.pct, goal.kind === 'netWorth' ? 'var(--accent)' : 'var(--saving)')}</div>
        <div class="bar" style="margin:12px 0 4px"><i style="width:${p.pct * 100}%;background:${goal.kind === 'netWorth' ? 'var(--accent)' : 'var(--saving)'}"></i></div>
        <div class="kv"><span class="muted">${kind.cur}</span><span class="v num">${won(p.cur)}</span></div>
        <div class="kv"><span class="muted">목표 금액</span><span class="v num">${won(p.target)}</span></div>
        <div class="kv"><span class="muted">남은 금액</span><span class="v num">${won(p.remaining)}</span></div>
        <div class="kv"><span class="muted">기간</span><span class="v num">${fmtDot(goal.startDate)} ~ ${fmtDot(goal.targetDate)}</span></div>
        <div class="kv"><span class="muted">남은 기간</span><span class="v num">${p.monthsLeft >= 1 ? Math.round(p.monthsLeft) + '개월' : p.monthsLeft > 0 ? Math.ceil(p.monthsLeft * 30) + '일' : '기한 지남'}</span></div>
        <div class="kv"><span class="muted">${kind.req}</span><span class="v num ${p.done ? 'sav' : ''}">${p.done ? '달성 완료' : '약 ' + won(Math.ceil(p.required / 1000) * 1000)}</span></div>
        ${!p.done && p.eta ? `<div class="kv"><span class="muted">월 저축 목표 기준 예상 달성</span><span class="v num ${p.eta <= goal.targetDate ? 'sav' : 'exp'}">${fmtDot(p.eta).slice(0, 7)}</span></div>` : ''}
      </section>
      <section class="card"><div class="card-title"><h2>진행 그래프</h2></div><div id="goalChart"></div></section>
      <button class="btn ghost" data-act="edit">목표 수정</button>`,
    actions: { edit: () => { sh.close(); openGoalForm(goal); } }
  });
  // 그래프: 목표 경로(시작→목표) vs 실제
  const labels = [];
  for (let d = goal.startDate.slice(0, 7); d <= goal.targetDate.slice(0, 7) && labels.length < 241; d = shiftYm(d, 1)) labels.push(d);
  if (labels.length < 2) labels.push(goal.targetDate.slice(0, 7));
  const dates = labels.map((m, i) => (i === 0 ? goal.startDate : i === labels.length - 1 ? goal.targetDate : monthEnd(m)));
  const startVal = goal.startValue ?? (goal.kind === 'netWorth' ? (seriesFor([goal.startDate])[0]?.net || 0) : 0);
  const actual = (() => {
    const t = today();
    const known = dates.map((d) => (d <= t ? d : null));
    if (goal.kind === 'netWorth') {
      const base = earliestBase();
      const pts = seriesFor(known.map((d) => d || t));
      return known.map((d, i) => (d && base && d >= base ? pts[i].net : null));
    }
    if (goal.kind === 'saving' && goal.accountIds?.length) {
      const accs = S.accounts.filter((a) => goal.accountIds.includes(a.id));
      return known.map((d) => { if (!d) return null; const vals = accs.map((a) => accountBalance(a, d)).filter((v) => v != null); return vals.length ? sum(vals) : null; });
    }
    return dates.map((d, i) => (i === 0 && goal.startValue != null ? goal.startValue : null));
  })();
  // 오늘 지점: 마지막 실측값을 현재 값으로
  const ti = dates.findIndex((d) => d > today());
  const curIdx = ti === -1 ? dates.length - 1 : Math.max(0, ti - 1);
  actual[curIdx] = p.cur;
  const n = labels.length;
  lineChart($('#goalChart', sh.el), {
    labels, fmtLabel: (m, long) => (long ? m.replace('-', '.') : m.slice(2).replace('-', '.')),
    series: [
      { name: '목표 경로', color: 'var(--faint)', values: labels.map((_, i) => startVal + ((p.target - startVal) * i) / (n - 1)), dash: true, width: 1.6 },
      { name: '실제', color: goal.kind === 'netWorth' ? 'var(--accent)' : 'var(--saving)', values: actual, area: true, width: 2.6 }
    ]
  });
}

/* =========================================================
 * Settings
 * ======================================================= */
function openSettings(focus) {
  const st = S.settings;
  const sh = openSheet({
    title: '설정',
    body: '<div id="setRoot"></div>',
    actions: {
      fin: () => openFinanceForm(() => draw()),
      budget: () => openBudgetForm(() => draw()),
      cats: (b) => openCatEditor(b.dataset.k, () => draw()),
      theme: async (b) => { await saveSettings({ theme: b.dataset.v }); applyTheme(); draw(); },
      backup: () => exportJSON(),
      restore: () => $('#restoreFile', sh.el).click(),
      csv: () => exportCSV(),
      persist: async () => { await requestPersist(true); draw(); },
      ocr: async () => {
        const b = $('[data-act="ocr"] .r', sh.el); if (b) b.textContent = '받는 중…';
        try { await OCR.init((m) => { if (b) b.textContent = m; }); toast('OCR 엔진을 기기에 저장했습니다'); } catch (e) { toast('OCR 엔진을 받지 못했습니다: ' + (e.message || e), true); }
        draw();
      },
      wipe: async () => {
        if (!(await confirmDialog('모든 데이터 삭제', '거래·계정·대출·목표·설정이 모두 삭제됩니다. 먼저 백업을 권장합니다.\n정말 삭제할까요?', { ok: '계속', danger: true }))) return;
        if (!(await confirmDialog('마지막 확인', '삭제한 데이터는 복구할 수 없습니다.', { ok: '전부 삭제', danger: true }))) return;
        try { await DB.replaceAll({}); } catch (e) { return saveError(e); }
        S.settings = defaultSettings(); S.accounts = []; S.txs = []; S.loans = []; S.goals = [];
        closeAllSheets(); toast('모든 데이터를 삭제했습니다'); boot();
      }
    }
  });
  const root = $('#setRoot', sh.el);
  async function draw() {
    const s = S.settings;
    const ocr = await OCR.status();
    let persisted = null, estimate = null;
    try { if (navigator.storage?.persisted) persisted = await navigator.storage.persisted(); if (navigator.storage?.estimate) estimate = await navigator.storage.estimate(); } catch (e) {}
    const row = (act, label, right, extra = '') => `<button class="set-row" data-act="${act}" ${extra}><span>${label}</span><span class="r">${right}${ICON.chev}</span></button>`;
    root.innerHTML = `
      <div class="section-label" style="margin-top:4px">재무 정보</div>
      <div class="set-group">
        ${row('fin', '세전 연봉 · 식대 · 실수령액', `${man(s.salary)}원`)}
        ${row('fin', '월 저축 목표', `${won(s.savingGoal)}`)}
        ${row('budget', '월 지출 예산', s.monthlyBudget ? won(s.monthlyBudget) : '미설정')}
        ${row('budget', '주간 예산', `${won(s.weeklyBudget)} · ${WD[s.weekStart]}요일 시작`)}
      </div>
      <div class="section-label">카테고리 · 결제 수단</div>
      <div class="set-group">
        ${row('cats', '지출 카테고리', `${s.expenseCats.length}개`, 'data-k="expenseCats"')}
        ${row('cats', '수입 카테고리', `${s.incomeCats.length}개`, 'data-k="incomeCats"')}
        ${row('cats', '결제 수단', `${s.payMethods.length}개`, 'data-k="payMethods"')}
      </div>
      <div class="section-label">화면</div>
      <div class="seg" style="margin-bottom:18px">${[['system', '시스템'], ['light', '라이트'], ['dark', '다크']].map(([k, l]) => `<button class="${s.theme === k ? 'on' : ''}" data-act="theme" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="section-label">데이터 백업 · 복원</div>
      <div class="set-group">
        ${row('backup', '<b>전체 백업 (JSON)</b>', s.lastBackup ? fmtDot(ds(new Date(s.lastBackup))) : '백업 없음')}
        ${row('restore', '백업 파일에서 복원', '')}
        ${row('csv', '거래내역 CSV 내보내기', `${S.txs.length}건`)}
        ${row('persist', '저장소 영구 보관 요청', persisted == null ? '지원 안 됨' : persisted ? '<span class="sav">허용됨</span>' : '요청하기')}
      </div>
      <div class="hint" style="margin:-10px 4px 18px">${estimate ? `사용 중 ${(estimate.usage / 1048576).toFixed(1)}MB · ` : ''}데이터는 이 기기의 브라우저 저장소에만 있습니다. 기기 변경·앱 삭제 전 반드시 백업하세요. iPhone에서는 '파일' 앱에 저장할 수 있습니다.</div>
      <input type="file" id="restoreFile" accept="application/json,.json" hidden>
      <div class="section-label">캡처 인식 (OCR)</div>
      <div class="set-group">
        ${row('ocr', '기기 내 OCR 엔진', ocr.cached || ocr.ready ? '<span class="sav">설치됨 · 오프라인 가능</span>' : navigator.onLine ? '받기 (약 9MB)' : '오프라인')}
      </div>
      <div class="hint" style="margin:-10px 4px 18px">이미지는 기기 안에서만 인식되며 외부 서버로 전송되지 않습니다. 외부 OCR API·API 키를 사용하지 않습니다.</div>
      <div class="set-group"><button class="set-row danger" data-act="wipe">모든 데이터 삭제</button></div>
      <div class="hint" style="text-align:center;margin-bottom:10px">MY MONEY v${APP_VERSION} · ${esc(isStandalone() ? '홈 화면 앱' : '브라우저')}</div>`;
    $('#restoreFile', sh.el).addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importJSON(f); e.target.value = ''; });
  }
  draw();
  if (focus === 'budget') setTimeout(() => openBudgetForm(() => draw()), 50);
}
function openFinanceForm(after) {
  const s = S.settings;
  const sh = openSheet({
    title: '기본 재무 정보',
    body: `<form id="finF" onsubmit="return false">
      ${field('세전 연봉', moneyInput('salary', s.salary))}
      ${field('식대 (연 최대)', moneyInput('mealAllowance', s.mealAllowance), '변동 가능 — 실제 받은 식대는 수입(식대)으로 기록하세요.')}
      ${field('월 실수령액', moneyInput('takeHome', s.takeHome || '', '직접 입력'))}
      ${field('월 저축 목표', moneyInput('savingGoal', s.savingGoal))}
    </form>`,
    foot: '<button class="btn" data-act="save">저장</button>',
    actions: { save: async () => { const v = readForm($('#finF', sh.el)); if (await saveSettings({ salary: v.salary, mealAllowance: v.mealAllowance, takeHome: v.takeHome, savingGoal: v.savingGoal })) { sh.close(); toast('저장했습니다'); after && after(); refresh(); } } }
  });
}
function openBudgetForm(after) {
  const s = S.settings;
  const loanPay = sum(S.loans, (l) => (loanBalance(l) > 0 ? l.monthlyPayment || 0 : 0));
  const auto = s.takeHome ? Math.max(0, s.takeHome - s.savingGoal - loanPay) : 0;
  const sh = openSheet({
    title: '예산 설정',
    body: `<form id="budF" onsubmit="return false">
      ${field('월 지출 예산', moneyInput('monthlyBudget', s.monthlyBudget || ''), s.takeHome ? `제안: 실수령 ${man(s.takeHome)} − 저축 ${man(s.savingGoal)} − 대출상환 ${man(loanPay)} = <b>${won(auto)}</b> <button type="button" class="text-btn" data-act="auto" style="font-size:12px">적용</button>` : '월 실수령액을 입력하면 자동 제안이 표시됩니다.')}
      ${field('주간 예산', moneyInput('weeklyBudget', s.weeklyBudget || ''))}
      ${field('주 시작 요일', `<select class="input" name="weekStart">${[1, 0, 6].map((d) => `<option value="${d}" ${s.weekStart === d ? 'selected' : ''}>${WD[d]}요일</option>`).join('')}</select>`, '기본: 월요일~일요일')}
    </form>`,
    foot: '<button class="btn" data-act="save">저장</button>',
    actions: {
      auto: () => { $('[name="monthlyBudget"]', sh.el).value = moneyVal(auto); },
      save: async () => { const v = readForm($('#budF', sh.el)); if (await saveSettings({ monthlyBudget: v.monthlyBudget, weeklyBudget: v.weeklyBudget, weekStart: Number(v.weekStart) })) { sh.close(); toast('저장했습니다'); after && after(); refresh(); } }
    }
  });
}
function openCatEditor(key, after) {
  const title = { expenseCats: '지출 카테고리', incomeCats: '수입 카테고리', payMethods: '결제 수단' }[key];
  let list = [...S.settings[key]];
  const sh = openSheet({
    title,
    body: '<div id="catRoot"></div>',
    foot: '<button class="btn" data-act="save">저장</button>',
    actions: {
      add: () => { sync(); list.push(''); draw(); const ins = $$('#catRoot input', sh.el); ins[ins.length - 1].focus(); },
      rm: (b) => { sync(); list.splice(Number(b.dataset.i), 1); draw(); },
      save: async () => {
        sync();
        const old = S.settings[key];
        const next = [];
        list.forEach((x) => { const v = x.trim(); if (v && !next.includes(v)) next.push(v); });
        if (!next.length) return toast('최소 1개는 필요합니다', true);
        // 이름 변경(같은 위치) → 기존 거래 카테고리도 변경
        const renames = {};
        if (key !== 'payMethods') old.forEach((o, i) => { if (list[i] !== undefined && list[i].trim() && list[i].trim() !== o && !next.includes(o)) renames[o] = list[i].trim(); });
        if (!(await saveSettings({ [key]: next }))) return;
        const type = key === 'incomeCats' ? 'income' : 'expense';
        const changed = S.txs.filter((t) => t.type === type && renames[t.category]).map((t) => ({ ...t, category: renames[t.category], updatedAt: Date.now() }));
        if (changed.length && (await persistMany('transactions', changed))) changed.forEach((t) => upsert(S.txs, t));
        sh.close(); toast('저장했습니다' + (changed.length ? ` (거래 ${changed.length}건 반영)` : '')); after && after(); refresh();
      }
    }
  });
  const root = $('#catRoot', sh.el);
  const sync = () => { list = $$('input', root).map((i) => i.value); };
  const draw = () => {
    root.innerHTML = `<div class="set-group">${list.map((c, i) => `<div class="cat-edit"><input class="input" value="${esc(c)}" maxlength="12" aria-label="이름"><button data-act="rm" data-i="${i}" aria-label="삭제">−</button></div>`).join('')}</div>
      <button class="btn ghost" data-act="add">+ 추가</button>
      <div class="hint" style="margin-top:10px">이름을 바꾸면 기존 거래에도 반영됩니다. 삭제해도 기존 거래의 카테고리 기록은 유지됩니다.</div>`;
  };
  draw();
}

/* =========================================================
 * Backup / Export
 * ======================================================= */
async function deliverFile(name, blob) {
  const file = new File([blob], name, { type: blob.type });
  if (isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}
function backupPayload() {
  return {
    app: 'MY MONEY', schema: 1, version: APP_VERSION, exportedAt: new Date().toISOString(),
    data: { settings: [S.settings], accounts: S.accounts, transactions: S.txs, loans: S.loans, goals: S.goals }
  };
}
async function exportJSON() {
  const stamp = today().replaceAll('-', '');
  const blob = new Blob([JSON.stringify(backupPayload(), null, 1)], { type: 'application/json' });
  const ok = await deliverFile(`MYMONEY-backup-${stamp}.json`, blob);
  if (ok) { await saveSettings({ lastBackup: Date.now() }); toast('백업 파일을 만들었습니다'); refresh(); }
}
function validateBackup(obj) {
  if (!obj || obj.app !== 'MY MONEY' || !obj.data) throw new Error('MY MONEY 백업 파일이 아닙니다.');
  if ((obj.schema || 0) > 1) throw new Error('더 새로운 버전의 백업입니다. 앱을 업데이트해 주세요.');
  const d = obj.data;
  for (const k of ['accounts', 'transactions', 'loans', 'goals']) if (!Array.isArray(d[k] || [])) throw new Error('백업 형식이 올바르지 않습니다: ' + k);
  for (const t of d.transactions || []) if (!t.id || !t.date || typeof t.amount !== 'number') throw new Error('손상된 거래 기록이 있습니다.');
  return d;
}
async function importJSON(file) {
  let d;
  try { d = validateBackup(JSON.parse(await file.text())); }
  catch (e) { return toast('복원 실패: ' + (e.message || e), true); }
  const n = (d.transactions || []).length;
  const ok = await confirmDialog('백업에서 복원', `거래 ${n}건, 계정 ${(d.accounts || []).length}개, 대출 ${(d.loans || []).length}개, 목표 ${(d.goals || []).length}개를 복원합니다.\n현재 데이터는 모두 백업 내용으로 바뀝니다.`, { ok: '복원' });
  if (!ok) return;
  const settings = Object.assign(defaultSettings(), (d.settings || [])[0] || {}, { key: 'main', onboarded: true });
  try { await DB.replaceAll({ settings: [settings], accounts: d.accounts || [], transactions: d.transactions || [], loans: d.loans || [], goals: d.goals || [] }); }
  catch (e) { return saveError(e); }
  await loadAll();
  closeAllSheets();
  toast(`복원했습니다 (거래 ${n}건)`);
  boot();
}
function csvCell(v) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function buildCSV() {
  const head = ['날짜', '시간', '유형', '카테고리', '금액', '순증감', '원금', '이자', '계정', '받는계정', '대출', '결제수단', '거래처', '메모', '입력방식'];
  const acc = (id) => S.accounts.find((a) => a.id === id)?.name || '';
  const rows = [...S.txs].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).map((t) => {
    const net = t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : t.type === 'repay' ? -t.interest : t.type === 'adjust' ? t.amount : 0;
    return [t.date, t.time || '', TYPE_LABEL[t.type] || t.type, t.category || '', t.amount, net, t.principal || '', t.interest || '', acc(t.accountId), acc(t.toAccountId),
      S.loans.find((l) => l.id === t.loanId)?.name || '', t.payMethod || '', t.merchant || '', t.memo || '', t.source === 'ocr' ? 'OCR' : '직접'];
  });
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
async function exportCSV() {
  if (!S.txs.length) return toast('내보낼 거래가 없습니다', true);
  const blob = new Blob([buildCSV()], { type: 'text/csv;charset=utf-8' });
  if (await deliverFile(`MYMONEY-transactions-${today().replaceAll('-', '')}.csv`, blob)) toast('CSV 파일을 만들었습니다');
}
async function requestPersist(verbose) {
  try {
    if (!navigator.storage?.persist) { if (verbose) toast('이 브라우저는 영구 보관 요청을 지원하지 않습니다'); return false; }
    const ok = await navigator.storage.persist();
    if (verbose) toast(ok ? '영구 보관이 허용되었습니다' : '브라우저가 요청을 보류했습니다. 홈 화면 앱으로 사용하면 보관이 더 안정적입니다');
    return ok;
  } catch (e) { return false; }
}

/* =========================================================
 * Onboarding (초기 설정)
 * ======================================================= */
function renderOnboarding() {
  $('#tabbar').classList.add('hidden');
  const s = S.settings;
  view.className = '';
  view.innerHTML = `<div class="onb">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1>MY MONEY</h1>
    <p class="lead">현재 재무 상태를 입력하면 바로 시작합니다.<br>모든 값은 나중에 언제든 바꿀 수 있어요.</p>
    <form id="onbF" onsubmit="return false">
      <div class="section-label" style="margin-top:0">기준 잔액</div>
      <section class="card">
        ${field('기준일', `<input class="input" type="date" name="baseDate" value="${today()}">`, '이 날짜의 잔액으로 시작하며, 이후 기록한 거래만 잔액에 더해집니다.')}
        ${field('현재 보유 현금', moneyInput('cash', 105000000))}
        <div class="row2">${field('학자금대출 잔액', moneyInput('loan', 60000000))}${field('대출 금리 (연 %)', `<input class="input num" name="rate" inputmode="decimal" placeholder="예: 1.7">`)}</div>
        ${field('월 대출 상환액', moneyInput('loanPay', 400000), '현재 30만~50만 원 범위 — 실제 금액으로 조정하세요.')}
      </section>
      <div class="onb-summary"><span>시작 순자산</span><span class="num" id="onbNet">45,000,000원</span></div>
      <div class="section-label">소득 · 저축</div>
      <section class="card">
        <div class="row2">${field('세전 연봉', moneyInput('salary', s.salary))}${field('식대 (연 최대)', moneyInput('meal', s.mealAllowance))}</div>
        <div class="row2">${field('월 실수령액', moneyInput('takeHome', '', '직접 입력'))}${field('월 저축 목표', moneyInput('savingGoal', s.savingGoal))}</div>
        ${field('주간 예산', moneyInput('weekly', s.weeklyBudget), '월요일~일요일 기준 · 설정에서 변경')}
      </section>
      <button class="btn" data-act="onb-start" style="margin-top:6px">시작하기</button>
      <button class="btn ghost" data-act="onb-restore" style="margin-top:10px">백업 파일로 복원</button>
      <input type="file" id="onbRestore" accept="application/json,.json" hidden>
      <p class="hint" style="text-align:center;margin-top:16px">데이터는 이 기기에만 저장되며 외부로 전송되지 않습니다.</p>
    </form></div>`;
  const form = $('#onbF');
  bindMoney(form);
  form.addEventListener('input', () => { const v = readForm(form); $('#onbNet').textContent = won(v.cash - v.loan); });
  $('#onbRestore').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importJSON(f); });
  view.onclick = async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'onb-restore') return $('#onbRestore').click();
    if (b.dataset.act !== 'onb-start') return;
    const v = readForm(form);
    const baseDate = v.baseDate || today();
    const now = Date.now();
    const rate = parseFloat(String(v.rate).replace(/[^\d.]/g, ''));
    const accounts = [{ id: uid(), name: '보유 현금', type: '현금', openingBalance: Math.round(v.cash), baseDate, baseSetAt: now, createdAt: now, order: 0 }];
    const loans = v.loan > 0 ? [{ id: uid(), name: '학자금대출', principal: Math.round(v.loan), openingBalance: Math.round(v.loan), baseDate, baseSetAt: now, rate: Number.isFinite(rate) ? rate : 0, monthlyPayment: Math.round(v.loanPay), method: 'annuity', maturityDate: '', createdAt: now }] : [];
    const settings = Object.assign({}, S.settings, { onboarded: true, salary: v.salary, mealAllowance: v.meal, takeHome: v.takeHome, savingGoal: v.savingGoal, weeklyBudget: v.weekly });
    if (v.takeHome) settings.monthlyBudget = Math.max(0, v.takeHome - v.savingGoal - v.loanPay);
    try { await DB.replaceAll({ settings: [settings], accounts, loans, transactions: S.txs, goals: S.goals }); }
    catch (err) { return saveError(err); }
    S.settings = settings; S.accounts = accounts; S.loans = loans;
    requestPersist(false);
    view.onclick = null;
    toast('시작했습니다');
    boot();
  };
}

/* =========================================================
 * Router & boot
 * ======================================================= */
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function isStandalone() { return window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; }
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
function render() {
  $$('.tab[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  view.className = 'view';
  if (ui.tab === 'home') renderHome();
  else if (ui.tab === 'history') renderHistory();
  else if (ui.tab === 'assets') renderAssets();
  else if (ui.tab === 'goals') renderGoals();
}
function refresh() {
  if (!S.settings.onboarded) return;
  const y = window.scrollY;
  const active = document.activeElement && document.activeElement.id;
  if (ui.tab === 'goals' && ui.goalSeg === 'sim') { ui.sim = null; }
  render();
  window.scrollTo(0, y);
  if (active === 'histSearch') $('#histSearch')?.focus();
}
function go(tab) {
  if (ui.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  ui.tab = tab;
  render();
  window.scrollTo(0, 0);
}
const viewActions = {
  go: (b) => go(b.dataset.tab),
  settings: () => openSettings(),
  'settings-budget': () => openSettings('budget'),
  backup: () => exportJSON(),
  csv: () => exportCSV(),
  add: () => openTxForm(),
  'add-ocr': () => openOcrSheet(),
  'home-month': (b) => { const n = shiftYm(ui.homeYm, Number(b.dataset.d)); if (n <= ymOf(today())) { ui.homeYm = n; render(); } },
  'hist-month': (b) => { const n = shiftYm(ui.hist.ym, Number(b.dataset.d)); if (n <= ymOf(today())) { ui.hist.ym = n; render(); } },
  'hist-filter': (b) => { ui.hist.filter = b.dataset.f; render(); },
  'tx-edit': (b) => { const t = S.txs.find((x) => x.id === b.dataset.id); if (t) openTxForm(t); },
  range: (b) => { ui.range = b.dataset.r; render(); },
  'acc-new': () => openAccountForm(),
  'acc-open': (b) => { const a = S.accounts.find((x) => x.id === b.dataset.id); if (a) openAccountDetail(a); },
  'loan-new': () => openLoanForm(),
  'loan-edit': (b) => openLoanForm(S.loans.find((x) => x.id === b.dataset.id)),
  'loan-pay': (b) => openTxForm(null, { type: 'repay', loanId: b.dataset.id }),
  'goal-seg': (b) => { ui.goalSeg = b.dataset.s; render(); },
  'goal-new': () => openGoalForm(),
  'goal-template': () => openGoalForm(null, { kind: 'netWorth', name: '3년 안에 순자산 1억 원 달성', target: 100000000, targetDate: addMonths(today(), 36), startValue: totals().net }),
  'goal-open': (b) => { const g = S.goals.find((x) => x.id === b.dataset.id); if (g) openGoalDetail(g); },
  'sim-reset': () => { ui.sim = simDefaults(); render(); }
};
view.addEventListener('click', (e) => {
  if (!S.settings.onboarded) return;
  const b = e.target.closest('[data-act]');
  if (b && viewActions[b.dataset.act]) viewActions[b.dataset.act](b, e);
});
$$('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
$('#addBtn').addEventListener('click', () => openTxForm());

async function boot() {
  applyTheme();
  if (!S.settings.onboarded) { closeAllSheets(); renderOnboarding(); return; }
  $('#tabbar').classList.remove('hidden');
  view.onclick = null;
  render();
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!secure) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('service-worker.js').then((reg) => {
    const bar = $('#updateBar');
    const show = () => { bar.hidden = false; };
    if (reg.waiting && hadController) show();
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) show(); });
    });
    $('#updateBtn').onclick = () => { if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING'); else location.reload(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('SW 등록 실패', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadController || reloading) return; reloading = true; location.reload(); });
}

(async function start() {
  try {
    await DB.open();
    await loadAll();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="onb"><h1>MY MONEY</h1><div class="banner"><div class="main"><b>데이터를 열 수 없습니다</b>${esc(e.message || e)}<br>개인정보 보호(비공개) 모드에서는 저장이 제한될 수 있습니다.</div></div></div>`;
    $('#tabbar').classList.add('hidden');
    return;
  }
  boot();
  registerSW();
  addEventListener('online', () => toast('온라인 상태입니다'));
  addEventListener('offline', () => toast('오프라인 — 기록은 계속 저장됩니다'));
  // 자정이 지나면 날짜 갱신
  let lastDay = today();
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); refresh(); } }, 60000);
})();

// 테스트·디버깅용 (UI에는 영향 없음)
window.__MYMONEY__ = { S, totals, monthStats, weekStats, parseReceiptText, simulate, goalProgress, payoffInfo, loanBalance, accountBalance, buildCSV, backupPayload, OCR };
})();
