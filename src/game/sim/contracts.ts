// Договоры НПС отряда бродяги (ПН-7, docs/gdd/path_of_sword.md, 3.8.4–3.8.5 и «Решения ПН-7») — одна дверь записи
// `RoamState.deals`, `.debts`, `.took`.
//
//   доска ──► ПРЕДЛОЖЕН ──взять (аванс)──► ВЗЯТ ──условие──► ИСПОЛНЕН ──сдать (`settle`)──► ОПЛАЧЕН
//                                          │
//                                    срок / отказ / провал ──► СОРВАН (неустойка — долг заказчику; долг закрывает его доску)
//
// Условие исполнения — мир по событию: удар по цели выигран (`sim/roamfight.takeFight` → `noteDealFight`), набег на село отбит (мир бродяги
// в минуту набега), груз довезён, служба отстояна, замок осмотрен — стоя у цели (`dealStep`, шаг отряда). Исполненный договор **сдаётся
// сразу** (гонец заказчика: плата — в кошель, ГДД 2.3) — одной дверью `settle`. Числа — `game/contractrules` (условия заморожены при
// взятии), доска — `world/dealboard`. Каждое дело кладёт приказ книги отряда (`take`, `deal`, `drop`) — сервер ведёт свою книгу
// договоров (`netlify/lib/roambook.ts`) и сверяет плату с таблицей наград дел (`data/deedgain`).
import type { GameState, ResourceId, RoamDeal, RoamDebt, RoamState } from '../types';
import type { DealOffer } from '@/world/dealboard';
import type { FightOut } from './roamfight';
import { CONTRACTS_MAX, contractTerms, dealLine, settlePay } from '../contractrules';
import { DEAL_DEFS, DEAL_KINDS, type DealFrom, type DealKind } from '../data/contracts';
import { RESOURCE_IDS } from '../constants';
import { DAY_LENGTH, realMs } from '../pace';
import { cargoCap } from '../cargocap';
import { bandOf, bookKey, sendBook } from './bandranks';
import { standsAt } from './roamtown';
import { addStock } from './stock';
import { movePrestige } from './prestige';
import { log } from './log';

/** Сколько номеров взятых предложений партия помнит — доска сменится раньше, чем список кончится. */
export const TOOK_MAX = 32;
/** Долгов заказчикам — не больше стольких (старые не пропадают: новый долг тому же заказчику складывается). */
export const DEBTS_MAX = 16;
/** Стоянке (защита села, служба) — игровой день запаса: шаг отряда и пульс мира ловят минуту набега и конец службы. */
export const STAND_GRACE = DAY_LENGTH;

const FROMS: readonly DealFrom[] = ['town', 'castellan', 'village'];

/** Долг отряда заказчику `id`; нет — 0. */
export const debtTo = (r: Pick<RoamState, 'debts'>, id: string): number => r.debts?.find((d) => d.id === id)?.gold ?? 0;

const load = (r: RoamState): number => Object.values(r.cargo).reduce((t: number, k) => t + Math.max(0, k ?? 0), 0);

/** Почему нельзя взять предложение сейчас; можно — `null`. */
export function takeBlock(s: GameState, o: DealOffer, now: number): string | null {
  const r = bandOf(s);
  if (!r) return 'Отряда нет.';
  if (r.took?.includes(o.id) || r.deals?.some((d) => d.id === o.id)) return 'Этот договор уже взят.';
  const debt = debtTo(r, o.from.id);
  if (debt > 0) return `Долг заказчику ${o.from.name}: ${debt} золота — доска закрыта до уплаты.`;
  if (!standsAt(r, now, o.from)) return 'Договор берут у заказчика: отряд стоит в его клетке или рядом.';
  if ((r.deals?.length ?? 0) >= CONTRACTS_MAX) return `Договоров уже ${CONTRACTS_MAX}: больше не взять.`;
  if (o.goods) {
    const room = Math.floor(cargoCap(r) - load(r));
    if (o.goods.n > room) return `Груз не влезет в обоз: нужно ${o.goods.n} места, свободно ${Math.max(0, room)}.`;
  }
  return null;
}

/** Условия предложения для этого отряда: Дипломатии у героя Среза 1 нет (соратники — ПН-9), аванс — при одном кружке. */
export const termsOf = (o: Pick<DealOffer, 'kind' | 'tier' | 'power' | 'roadMs' | 'stand'>): ReturnType<typeof contractTerms> =>
  contractTerms({ kind: o.kind, tier: o.tier, power: o.power, roadMs: o.roadMs, stand: o.stand, dip: 1 });

/** Взять договор с доски: аванс — в кошель, груз — в обоз, срок — с этой минуты; приказ книги `take`. Отказ — словами. */
export function takeDeal(s: GameState, o: DealOffer, now: number): string | null {
  const why = takeBlock(s, o, now);
  if (why) return why;
  const r = s.roam as RoamState;
  const t = termsOf(o);
  const stand = o.kind === 'defend' || o.kind === 'garrison';
  const deal: RoamDeal = {
    id: o.id,
    kind: o.kind,
    tier: o.tier,
    from: { id: o.from.id, x: o.from.x, y: o.from.y, name: o.from.name, who: o.from.who },
    target: { id: o.target.id, x: o.target.x, y: o.target.y, name: o.target.name },
    power: t.power,
    pay: t.pay,
    advance: t.advance,
    penalty: t.penalty,
    refuse: t.refuse,
    fame: t.fame,
    at: now,
    until: now + realMs(t.days * DAY_LENGTH + (stand ? STAND_GRACE : 0)),
    key: bookKey(s, 'take'),
  };
  if (o.kind === 'defend') deal.due = now + realMs(o.stand * DAY_LENGTH);
  if (o.kind === 'garrison') {
    deal.need = o.stand * DAY_LENGTH;
    deal.stood = 0;
  }
  if (o.goods) {
    deal.goods = { id: o.goods.id, n: o.goods.n };
    addStock(s, o.goods.id, o.goods.n, cargoCap(r), 'cargo');
  }
  r.purse += t.advance;
  r.deals = [...(r.deals ?? []), deal];
  r.took = [o.id, ...(r.took ?? [])].slice(0, TOOK_MAX);
  sendBook(s, { op: 'take', key: deal.key, at: { x: o.from.x, y: o.from.y }, tier: o.tier });
  log(s, `Договор взят у ${o.from.name}: ${dealLine(t)}. Аванс ${t.advance} — в кошель.`, 'info', `deal:${o.id}`);
  return null;
}

const without = (r: RoamState, id: string): void => {
  const left = (r.deals ?? []).filter((d) => d.id !== id);
  if (left.length) r.deals = left;
  else delete r.deals;
};

/** Долг заказчику растёт на `gold`: долг закрывает его доску до уплаты (3.8.5). */
function owe(r: RoamState, d: Pick<RoamDeal, 'from'>, gold: number): void {
  if (!(gold > 0)) return;
  const was = debtTo(r, d.from.id);
  const rest = (r.debts ?? []).filter((x) => x.id !== d.from.id);
  r.debts = [{ id: d.from.id, name: d.from.name, gold: was + gold }, ...rest].slice(0, DEBTS_MAX);
}

/**
 * Сдать исполненный договор — **единственная дверь оплаты договора**: остаток платы (плата − аванс) — в кошель, престиж тира — дверью
 * престижа, груз — заказчику с обоза; приказ книги `deal` с платой и престижем (сервер сверяет их с таблицей наград дел). Отказ — словами.
 */
export function settle(s: GameState, id: string, now: number): string | null {
  const r = bandOf(s);
  const d = r?.deals?.find((x) => x.id === id);
  if (!r || !d) return 'Такого договора нет.';
  if (!d.done) return 'Договор ещё не исполнен.';
  if (d.goods) {
    if (!standsAt(r, now, d.target)) return `Груз сдают в ${d.target.name}.`;
    if ((r.cargo[d.goods.id] ?? 0) < d.goods.n) return 'Груза в обозе меньше, чем взяли.';
    addStock(s, d.goods.id, -d.goods.n, cargoCap(r), 'cargo');
  }
  r.purse += settlePay(d);
  const fame = movePrestige(s, d.fame);
  without(r, id);
  sendBook(s, { op: 'deal', key: bookKey(s, 'deal'), take: d.key, gold: d.pay, fame: d.fame });
  log(s, `Договор исполнен: ${DEAL_DEFS[d.kind].name.toLowerCase()} для ${d.from.name}. Плата ${settlePay(d)} сверх аванса, престиж +${Math.round(fame)}.`, 'good', `deal:${d.id}`);
  return null;
}

/** Договор сорван (срок вышел, село не отстояли): неустойка — долгом заказчику; приказ книги `drop`. */
export function failDeal(s: GameState, id: string, why: string): void {
  const r = bandOf(s);
  const d = r?.deals?.find((x) => x.id === id);
  if (!r || !d) return;
  owe(r, d, d.penalty);
  without(r, id);
  sendBook(s, { op: 'drop', key: bookKey(s, 'drop'), take: d.key });
  log(s, `Договор сорван: ${DEAL_DEFS[d.kind].name.toLowerCase()} для ${d.from.name} — ${why}. Неустойка ${d.penalty} — долг, доска заказчика закрыта до уплаты.`, 'bad', `deal:${d.id}`);
}

/** Отказаться от договора: половина неустойки — долгом заказчику (3.8.5). */
export function refuseDeal(s: GameState, id: string): string | null {
  const r = bandOf(s);
  const d = r?.deals?.find((x) => x.id === id);
  if (!r || !d) return 'Такого договора нет.';
  owe(r, d, d.refuse);
  without(r, id);
  sendBook(s, { op: 'drop', key: bookKey(s, 'drop'), take: d.key });
  log(s, `Отказ от договора: ${DEAL_DEFS[d.kind].name.toLowerCase()} для ${d.from.name}. Неустойка ${d.refuse} — долг заказчику.`, 'bad', `deal:${d.id}`);
  return null;
}

/** Почему нельзя уплатить долг заказчику сейчас; можно — `null`. */
export function debtBlock(s: GameState, from: { id: string; x: number; y: number }, now: number): string | null {
  const r = bandOf(s);
  if (!r) return 'Отряда нет.';
  const gold = debtTo(r, from.id);
  if (!(gold > 0)) return 'Долга нет.';
  if (!standsAt(r, now, from)) return 'Долг платят у заказчика.';
  if (r.purse < gold) return `Не хватает золота: долг ${gold}, в кошеле ${Math.floor(r.purse)}.`;
  return null;
}

/** Уплатить долг заказчику — доска снова открыта. */
export function payDebt(s: GameState, from: { id: string; x: number; y: number }, now: number): string | null {
  const why = debtBlock(s, from, now);
  if (why) return why;
  const r = s.roam as RoamState;
  const debt = r.debts?.find((x) => x.id === from.id) as RoamDebt;
  r.purse -= debt.gold;
  const left = (r.debts ?? []).filter((x) => x !== debt);
  if (left.length) r.debts = left;
  else delete r.debts;
  log(s, `Долг уплачен: ${debt.name}, ${debt.gold} золота. Доска снова открыта.`, 'info');
  return null;
}

/**
 * Бой лёг в партию (`sim/roamfight.takeFight`): удар по цели договора выигран — договор исполнен и сдан; набег на село отбит —
 * исполнен, не отбит — сорван.
 */
export function noteDealFight(s: GameState, f: Pick<FightOut, 'how' | 'id' | 'won' | 'at'>): void {
  const r = bandOf(s);
  if (!r?.deals) return;
  for (const d of [...r.deals]) {
    const fight = DEAL_DEFS[d.kind].fight;
    if (fight === 'strike' && f.how === 'strike' && f.won && f.id === d.target.id) d.done = true;
    else if (fight === 'defend' && f.how === 'defend' && f.id === d.id) {
      if (f.won) d.done = true;
      else {
        failDeal(s, d.id, 'село не отстояли');
        continue;
      }
    }
    if (d.done) settle(s, d.id, f.at);
  }
}

/**
 * Шаг договоров (`sim/roam.roamStep`, настоящая минута куска `now`): служба — стоять у замка кастеляна, разведка — встать у чужого
 * замка, груз — довезти до города назначения; исполненный — сдаётся сразу; срок вышел — сорван.
 */
export function dealStep(s: GameState, dt: number, now: number): void {
  const r = bandOf(s);
  if (!r?.deals) return;
  for (const d of [...r.deals]) {
    if (!d.done) {
      if (d.kind === 'garrison' && standsAt(r, now, d.from)) {
        d.stood = (d.stood ?? 0) + Math.max(0, dt);
        if (d.stood >= (d.need ?? 0)) d.done = true;
      } else if (d.kind === 'scout' && standsAt(r, now, d.target)) d.done = true;
      else if (d.kind === 'cargo' && d.goods && standsAt(r, now, d.target) && (r.cargo[d.goods.id] ?? 0) >= d.goods.n) d.done = true;
    }
    if (d.done && settle(s, d.id, now) === null) continue;
    if (now >= d.until) failDeal(s, d.id, d.kind === 'garrison' ? 'службу бросили' : 'срок вышел');
  }
}

// ---------- чтение сохранения ----------

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, n = 64): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, n) : null);
const placeOf = (v: unknown): RoamDeal['target'] | null => {
  const p = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const id = text(p.id);
  return id && finite(p.x) && finite(p.y) ? { id, x: Math.round(p.x), y: Math.round(p.y), name: text(p.name, 40) ?? '' } : null;
};

/** Договоры, долги и взятые номера из сохранения (`sim/roam.mergeRoam`): только целые записи; мусор — нет поля. */
export function readDeals(r: Record<string, unknown>): Pick<RoamState, 'deals' | 'debts' | 'took'> {
  const out: Pick<RoamState, 'deals' | 'debts' | 'took'> = {};
  if (Array.isArray(r.deals)) {
    const deals: RoamDeal[] = [];
    for (const v of (r.deals as Record<string, unknown>[]).slice(0, CONTRACTS_MAX)) {
      if (!v || !DEAL_KINDS.includes(v.kind as DealKind) || ![1, 2, 3].includes(v.tier as number)) continue;
      const from = placeOf(v.from);
      const target = placeOf(v.target);
      const who = (v.from as Record<string, unknown> | undefined)?.who as DealFrom;
      const id = text(v.id);
      const key = text(v.key);
      const nums = [v.power, v.pay, v.advance, v.penalty, v.refuse, v.fame, v.at, v.until];
      if (!from || !target || !FROMS.includes(who) || !id || !key || !nums.every(finite)) continue;
      const d: RoamDeal = {
        id,
        kind: v.kind as DealKind,
        tier: v.tier as RoamDeal['tier'],
        from: { ...from, who },
        target,
        power: Math.max(0, v.power as number),
        pay: Math.max(0, v.pay as number),
        advance: Math.max(0, v.advance as number),
        penalty: Math.max(0, v.penalty as number),
        refuse: Math.max(0, v.refuse as number),
        fame: Math.max(0, v.fame as number),
        at: v.at as number,
        until: v.until as number,
        key,
      };
      if (finite(v.due)) d.due = v.due;
      if (finite(v.need)) d.need = Math.max(0, v.need);
      if (finite(v.stood)) d.stood = Math.max(0, v.stood);
      const g = v.goods as Record<string, unknown> | undefined;
      if (g && RESOURCE_IDS.includes(g.id as ResourceId) && finite(g.n) && g.n > 0) d.goods = { id: g.id as ResourceId, n: Math.floor(g.n) };
      if (v.done === true) d.done = true;
      deals.push(d);
    }
    if (deals.length) out.deals = deals;
  }
  if (Array.isArray(r.debts)) {
    const debts = (r.debts as Record<string, unknown>[])
      .filter((d) => d && text(d.id) && finite(d.gold) && d.gold > 0)
      .slice(0, DEBTS_MAX)
      .map((d) => ({ id: text(d.id) as string, name: text(d.name, 40) ?? '', gold: Math.ceil(d.gold as number) }));
    if (debts.length) out.debts = debts;
  }
  if (Array.isArray(r.took)) {
    const took = (r.took as unknown[]).map((x) => text(x)).filter((x): x is string => x !== null).slice(0, TOOK_MAX);
    if (took.length) out.took = took;
  }
  return out;
}
