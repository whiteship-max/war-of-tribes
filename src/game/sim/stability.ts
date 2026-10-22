// Стабильность державы — единственная дверь (docs/stability.md). Пишет и читает `GameState.stab` только она: ступень и
// сдвиг, полосы недовольства податных и голодных, мятеж и счёт книги сервера.
//
// **Стабильность строится поверх, а не рядом.** Своих причин у неё нет: вес каждой — просадка морали, которую игра уже
// назвала (налог, теснота, голод, ересь), полосы невольников и войска — прежние сроки ропота и терпения, мятежники у
// ворот — тот же вызов, что разбойники (`sim/gate`), очки — одна дверь трат (`sim/points.spend`). Здесь только то, что
// стабильности нужно сверх этого: ступень, сдвиг и две новые полосы.
//
// **Зреет по времени, а не по присутствию** (docs/time.md, раздел 14): шаг один — при игроке и в догоне отлучки. Мятеж,
// созревший без игрока, ложится на стол и ждёт: срок ответа ставит почта при игроке (`sim/mail`), как у мятежа невольников.
import type { GameState, RevoltGroup, StabGroup, StabilityState } from '../types';
import type { MoraleBreakdown } from '../derived';
import {
  DAY_LENGTH,
  MUTINY_FUSE,
  MUTINY_PAY_FOOD,
  MUTINY_PAY_GOLD,
  MUTINY_SUPPRESS_MORALE,
  MUTINY_TOWN_LEAVE,
  STARVING_MORALE,
  VILLAGER_DEFENSE,
} from '../constants';
import { activeBoons, decreeOf, moraleBreakdown, mutinyOpen, orderState, payGraceDays, rationOf, riteMorale, taxOf } from '../derived';
import { TAXES, type TaxId } from '../data/policy';
import { SEASON_DAYS } from '../data/seasons';
import { REALM_BRANCHES } from '../data/realm';
import { GROUP_META, REVOLT_EVENT, STAB_EVENTS, STAB_LOG, TERMS_EVENT, stabName } from '../data/stability';
import {
  GROUP_FALL,
  GROUP_RISE,
  REVOLT_AT,
  REVOLT_NEAR,
  STAB_CALM,
  STAB_DRAG,
  STAB_DRIFT,
  STAB_MAX,
  STAB_MIN,
  STAB_SELF_MAX,
  STAB_STEP,
  battleShock,
  discontentOf,
  stabClamp,
  stabPrice,
} from '../stabrules';
import { pointsOf, spend } from './points';
import { callGate } from './gate';
import { log } from './log';

/** Сколько смен ступени помнит летопись раздела. */
export const STAB_PAST = 40;

/** Пустое состояние: так читаются новая и старая партия. */
const empty = (): StabilityState => ({ level: 0, drift: 0, folk: 0, hungry: 0, past: [], bought: 0, spent: 0, revolts: 0, held: 0 });

/** Стабильность партии — чтение. Поля нет — пустое состояние, партию не трогает. */
export const stabOf = (s: GameState): StabilityState => s.stab ?? empty();

/** Ступень, целое −3…+3. */
export const stabLevel = (s: GameState): number => stabClamp(s.stab?.level ?? 0);

/** Поле для записи: заводится на первой записи, до того партия живёт без него. */
function own(s: GameState): StabilityState {
  if (!s.stab) s.stab = empty();
  return s.stab;
}

// ---------- Числа: причины недовольства и давление ----------
//
// Здесь — только числа: имя причины и её вес. Слова, значки и двери «где изменить» к ним приставляет вид раздела
// (`sim/stabview`), который едет куском меню державы: шагу партии слова не нужны, а первая загрузка не платит за них.

/** Слагаемое: причина недовольства (%) или давления (% ступени в день) — по имени. */
export interface Part {
  id: string;
  value: number;
}

/** Строка морали по имени — та же, что в справке «Мораль»: второй мерки тесноты, голода и ереси нет. */
const moraleLine = (mb: MoraleBreakdown, id: string): number => mb.lines.find((l) => l.id === id)?.value ?? 0;

/**
 * Обида и милость вестей державы причиной (СБ-2): усилитель с полем группы — своим именем и сроком (`data/boons`), как налог
 * или теснота. Своего счёта у вести нет: она кладёт усилитель, полоса идёт к цели прежней скоростью.
 */
const boonParts = (s: GameState, field: 'folk' | 'hungry'): Part[] =>
  activeBoons(s).flatMap(({ def }) => (def[field] ? [{ id: `boon:${def.id}`, value: def[field] as number }] : []));

/** Ступень стабильности причиной: высокая гасит недовольство, низкая разжигает. */
const stabPart = (s: GameState): Part[] => {
  const level = stabLevel(s);
  return level === 0 ? [] : [{ id: 'stab', value: discontentOf(-STAB_STEP * level) }];
};

/** Причины недовольства податных — весом их просадки морали (docs/stability.md, 2.3). Ноль в список не идёт. */
export function folkParts(s: GameState, mb: MoraleBreakdown = moraleBreakdown(s)): Part[] {
  const raw: Part[] = [
    { id: 'tax', value: discontentOf(taxOf(s).moralePenalty) },
    // Указ — что он сделал бы с моралью за сезон: своего веса у него нет.
    { id: 'decree', value: discontentOf(-decreeOf(s).moralePerDay * SEASON_DAYS) },
    { id: 'crowding', value: discontentOf(-moraleLine(mb, 'crowding')) },
    { id: 'freezing', value: discontentOf(-moraleLine(mb, 'freezing')) },
    { id: 'heresy', value: discontentOf(-moraleLine(mb, 'heresy')) },
    { id: 'rite', value: -discontentOf(riteMorale(s)) },
  ];
  return [...raw.filter((p) => p.value !== 0), ...boonParts(s, 'folk'), ...stabPart(s)];
}

/** Причины недовольства голодных — хлеб на душу тем же счётом, что у морали. */
export function hungryParts(s: GameState, mb: MoraleBreakdown = moraleBreakdown(s)): Part[] {
  const raw: Part[] = [
    { id: 'starving', value: discontentOf(-moraleLine(mb, 'starving')) },
    { id: 'hungry', value: discontentOf(-moraleLine(mb, 'hungry')) },
    { id: 'siege-ration', value: discontentOf(-moraleLine(mb, 'ration')) },
    // Паёк — доля урезанного от голода: тем же правилом, что осадный (`derived.rationMorale`).
    { id: 'ration', value: discontentOf((1 - rationOf(s).food) * STARVING_MORALE) },
  ];
  return [...raw.filter((p) => p.value !== 0), ...boonParts(s, 'hungry'), ...stabPart(s)];
}

/** Цель полосы: сумма причин, не меньше нуля. */
export const targetOf = (parts: readonly Part[]): number => Math.max(0, parts.reduce((n, l) => n + l.value, 0));

/** Полоса невольников — ропот (`s.unrest` к сроку `MUTINY_FUSE`); мятеж на столе — полная. */
export const bondedBar = (s: GameState): number => (mutinyOpen(s) ? 100 : Math.min(100, (100 * Math.max(0, s.unrest ?? 0)) / MUTINY_FUSE));

/** Полоса войска — терпение (`PayState.late` к сроку Статуи). */
export function armyBar(s: GameState): number {
  const late = Math.max(0, s.pay?.late ?? 0);
  if (late <= 0) return 0;
  const grace = payGraceDays(s) * DAY_LENGTH;
  return grace > 0 ? Math.min(100, (100 * late) / grace) : 100;
}

/** Полосы групп в эту минуту, %. */
export type Bars = Record<StabGroup, number>;

/** Полосы всех четырёх групп — одна мерка на шаг, раздел и тревогу. */
export const barsOf = (s: GameState): Bars => {
  const st = stabOf(s);
  return { folk: st.folk, hungry: st.hungry, bonded: bondedBar(s), army: armyBar(s) };
};

/** Слагаемые давления, % ступени за игровой день: тихие дни, тяга недовольных групп, осада. */
export function pressureParts(s: GameState, bars: Bars): Part[] {
  const out: Part[] = [{ id: 'calm', value: STAB_CALM }];
  for (const id of STAB_GROUPS) if (bars[id] > 0) out.push({ id: `g-${id}`, value: (-STAB_DRAG * bars[id]) / 100 });
  if (s.siege) out.push({ id: 'siege', value: -STAB_DRAG });
  return out;
}

/** Группы недовольных по порядку раздела. */
export const STAB_GROUPS: readonly StabGroup[] = ['folk', 'hungry', 'bonded', 'army'];

// ---------- Ступень ----------

/** Сменить ступень на `delta` по причине `why`: сдвиг с нуля, смена — в летопись и в график. */
function stepBy(s: GameState, delta: number, why: keyof typeof STAB_LOG.why): void {
  const st = own(s);
  const before = stabClamp(st.level);
  const after = stabClamp(before + delta);
  st.drift = 0;
  if (after === before) return;
  st.level = after;
  st.past = [...st.past, [s.time, after] as [number, number]].slice(-STAB_PAST);
  const text = after > before ? STAB_LOG.up(stabName(after), STAB_LOG.why[why]) : STAB_LOG.down(stabName(after), STAB_LOG.why[why]);
  log(s, text, after > before ? 'good' : 'bad', undefined, 'stab');
}

/** Толчок, который стоит ступени: поднятый мятеж невольников, город пал. */
export function stabShock(s: GameState, why: 'mutiny' | 'fallen'): void {
  if (why === 'mutiny') own(s).revolts++;
  stepBy(s, -1, why);
}

/** Итог боя: сдвиг мерой его морали; павший город — ступень вниз. Зовёт одна дверь последствий (`applyExpedition`). */
export function stabAfterBattle(s: GameState, o: { battle?: 'won' | 'lost' | null; morale?: number; fallen?: readonly unknown[] | null }): void {
  if (o.fallen && o.fallen.length > 0) stabShock(s, 'fallen');
  if (!o.battle || !o.morale) return;
  push(s, battleShock(o.morale));
}

/**
 * Сдвинуть на `d` процентов ступени: дошёл до края — ступень. `why` — откуда сдвиг: давление (тихие дни, недовольство, бои)
 * или весть державы.
 *
 * Края — одним правилом. **Сама стабильность выше «Лада» не поднимается**: на «Ладе» и выше давление вверх только гасит
 * сдвиг вниз, своего сдвига вверх не копит. **Весть — не «сама»** (СБ-2, docs/stability.md, «Решения СБ-2»): её сдвиг вверх
 * копится и на «Ладе» — иначе в ровной игре, которая стоит на «Ладе», добрая весть не значила бы ничего; давление его не
 * стирает, а недовольство съедает так же, как сдвиг вниз. На «Смуте» вниз не копится ничто, на «Благоденствии» — вверх.
 */
function push(s: GameState, d: number, why: 'drift' | 'event' = 'drift'): void {
  const st = own(s);
  const step = why === 'event' ? d : st.level >= STAB_SELF_MAX && d > 0 ? Math.min(d, Math.max(0, -st.drift)) : d;
  st.drift += step;
  if ((st.level <= STAB_MIN && st.drift < 0) || (st.level >= STAB_MAX && st.drift > 0)) st.drift = 0;
  if (st.drift >= STAB_DRIFT) stepBy(s, 1, why === 'event' ? 'event' : 'calm');
  else if (st.drift <= -STAB_DRIFT) stepBy(s, -1, why);
}

/**
 * Весть державы двигает стабильность (СБ-2): тот же сдвиг, что у давления, — но её сдвиг вверх копится и выше «Лада»
 * (`push`). Зовёт одна дверь вестей (`sim/crown`).
 */
export const stabNudge = (s: GameState, d: number): void => {
  if (d !== 0) push(s, d, 'event');
};

// ---------- Шаг ----------

/** Что шаг стабильности велит почте: положить на стол весть мятежа или условий. */
export type StabStep = string | null;

/**
 * Шаг стабильности — один при игроке и в догоне отлучки. `mb` — разбор морали этого шага (его уже посчитал `tick`):
 * второго прохода по морали ради стабильности нет.
 *
 * 1. Упадок кончился — мятежники расходятся.
 * 2. Полосы податных и голодных идут к цели со скоростью ропота; полоса встающей группы стоит, пока мятеж не кончился.
 * 3. Полоса дошла до ста — мятеж: ступень вниз, вставшие не работают, весть на стол.
 * 4. Терпение войска кончилось — ступень вниз, раз на случай.
 * 5. Давление двигает сдвиг.
 */
export function stabilityTick(s: GameState, dt: number, mb: MoraleBreakdown): StabStep {
  const st = own(s);
  const r = st.revolt;
  if (r && r.until !== undefined && s.time >= r.until && !revoltOpen(s)) {
    delete st.revolt;
    log(s, STAB_LOG.calmed, 'info', undefined, 'stab');
  }
  const days = dt / DAY_LENGTH;
  const fT = targetOf(folkParts(s, mb));
  const hT = targetOf(hungryParts(s, mb));
  const move = (v: number, t: number): number => (t > v ? Math.min(t, v + GROUP_RISE * days) : Math.max(t, v - GROUP_FALL * days));
  if (st.revolt?.group !== 'folk') st.folk = move(st.folk, Math.min(100, fT));
  if (st.revolt?.group !== 'hungry') st.hungry = move(st.hungry, Math.min(100, hT));
  const bars = barsOf(s);

  // «Мятеж близок» названо — снимается, когда полоса спала ниже половины.
  const rising: Record<StabGroup, () => boolean> = {
    folk: () => fT > st.folk || st.folk >= REVOLT_AT,
    hungry: () => hT > st.hungry || st.hungry >= REVOLT_AT,
    bonded: () => orderState(s) === 'unrest',
    army: () => bars.army < 100,
  };
  const near = new Set(st.near ?? []);
  for (const id of STAB_GROUPS) {
    if (bars[id] >= REVOLT_NEAR && rising[id]()) near.add(id);
    else if (bars[id] < 50) near.delete(id);
  }

  let raise: StabStep = null;
  if (!st.revolt && !mutinyOpen(s)) {
    const g: RevoltGroup | null = st.folk >= REVOLT_AT ? 'folk' : st.hungry >= REVOLT_AT ? 'hungry' : null;
    if (g) {
      const rebels = Math.max(1, Math.round(Math.max(0, s.pop) * MUTINY_TOWN_LEAVE));
      st.revolt = { group: g, rebels };
      st[g] = 100;
      st.revolts++;
      near.delete(g);
      log(s, STAB_LOG.rose(GROUP_META[g].name, rebels), 'bad', undefined, 'stab');
      stepBy(s, -1, 'revolt');
      raise = REVOLT_EVENT[g];
    }
  }
  if (near.size > 0) st.near = [...near];
  else delete st.near;
  if (st.revolt?.terms) {
    delete st.revolt.terms;
    raise = TERMS_EVENT;
  }
  if (bars.army >= 100 && !st.armyOut) {
    st.armyOut = true;
    stepBy(s, -1, 'army');
  } else if (bars.army <= 0 && st.armyOut) delete st.armyOut;

  push(s, pressureParts(s, bars).reduce((n, l) => n + l.value, 0) * days);
  return raise;
}

// ---------- Укрепить ----------

/** Можно ли укрепить и во что обойдётся: цена каждого вида, сколько есть, причина отказа. */
export interface SteadyInfo {
  /** На какую ступень. */
  to: number;
  price: number;
  /** Сколько очков каждого вида есть. */
  have: Record<(typeof REALM_BRANCHES)[number], number>;
  /** Каких видов не хватает. */
  short: (typeof REALM_BRANCHES)[number][];
  /** Почему нельзя; null — можно. */
  blocked: 'top' | 'points' | null;
}

export function steadyInfo(s: GameState): SteadyInfo {
  const level = stabLevel(s);
  const to = level + 1;
  const price = stabPrice(to);
  const have = Object.fromEntries(REALM_BRANCHES.map((b) => [b, pointsOf(s, b)])) as SteadyInfo['have'];
  const short = REALM_BRANCHES.filter((b) => have[b] < price);
  const blocked = level >= STAB_MAX ? 'top' : short.length > 0 ? 'points' : null;
  return { to, price, have, short, blocked };
}

/**
 * Укрепить стабильность — подняться на ступень за все три вида очков сразу. Тратит одна дверь трат (`points.spend`), по
 * разу на вид, **после** проверки всех трёх: половинной покупки нет. Возвращает причину отказа или null.
 */
export function steady(s: GameState): SteadyInfo['blocked'] {
  const info = steadyInfo(s);
  if (info.blocked) return info.blocked;
  for (const b of REALM_BRANCHES) spend(s, b, info.price);
  const st = own(s);
  st.bought++;
  st.spent += info.price;
  stepBy(s, 1, 'bought');
  return null;
}

// ---------- Мятеж ----------

/** Мятеж податных или голодных на столе. */
export const revoltOpen = (s: GameState): boolean => s.inbox.some((e) => STAB_EVENTS.includes(e.defId));

/** Мощь мятежников у ворот: каждый — мерой жителя на стене (`VILLAGER_DEFENSE`), как у мятежа невольников. */
export const rebelsPower = (rebels: number): number => Math.max(0, rebels) * VILLAGER_DEFENSE;

/** Сколько встало и какая группа — для вести (её текст читает это до ответа). */
export const revoltNow = (s: GameState): { group: RevoltGroup; rebels: number } => stabOf(s).revolt ?? { group: 'folk', rebels: 0 };

/** Срок упадка — тот же срок ропота: мятеж выдыхается за то время, за которое зрел. */
export const DECLINE = MUTINY_FUSE;

/** «Подавить силой»: мятежники выходят к воротам — бой тем же вызовом, что разбойники. Исход — `rebelsSettled`. */
export function revoltSuppress(s: GameState): void {
  const r = own(s).revolt;
  if (!r) return;
  r.gate = callGate(s, 'rebels', rebelsPower(r.rebels), {}).id;
}

/** Ступень налога ниже: высокий → умеренный → без налога. */
const lowerTax = (id: TaxId): TaxId => {
  const i = TAXES.findIndex((t) => t.id === id);
  return TAXES[Math.max(0, i - 1)].id;
};

/** Что уступка податным поменяет: налог ступенью ниже, нет налога — «Вольный уклад», нечего — только обещания. */
export function concession(s: GameState): { tax?: [TaxId, TaxId]; decree?: true } {
  if (s.tax !== 'none') return { tax: [s.tax, lowerTax(s.tax)] };
  if (s.decree !== 'freedom') return { decree: true };
  return {};
}

/** «Уступить» (податным — налог или указ; голодным — раздача, её плату сняло событие): полоса в ноль, мятеж кончился. */
export function revoltConcede(s: GameState): void {
  const st = own(s);
  const g = st.revolt?.group ?? 'folk';
  if (g === 'folk') {
    const c = concession(s);
    if (c.tax) s.tax = c.tax[1];
    if (c.decree) s.decree = 'freedom';
  }
  st[g] = 0;
  delete st.revolt;
}

/** Цена раздачи голодным — та же, что раздача при мятеже невольников: хлеб и золото на голову. */
export const handout = (s: GameState): { food: number; gold: number } => {
  const heads = Math.max(0, s.pop);
  return { food: Math.ceil(heads * MUTINY_PAY_FOOD), gold: Math.ceil(heads * MUTINY_PAY_GOLD) };
};

/** «Переждать»: упадок на срок, потом мятежники расходятся; полоса — вдвое. */
export function revoltWait(s: GameState): void {
  const st = own(s);
  const r = st.revolt;
  if (!r) return;
  r.until = s.time + DECLINE;
  st[r.group] = 50;
}

/**
 * Исход боя у ворот с мятежниками (зовёт `sim/gate.settleGate`). Отбились — мятеж подавлен: полоса вдвое, мораль платит
 * тем же, что подавление мятежа невольников. Не отбились — склад унесли (это сделал мир), а на стол ложатся условия.
 */
export function rebelsSettled(s: GameState, won: boolean): void {
  const st = own(s);
  const r = st.revolt;
  if (!r) return;
  delete r.gate;
  if (won) {
    st[r.group] = 50;
    st.held++;
    s.morale = Math.max(0, s.morale - MUTINY_SUPPRESS_MORALE);
    delete st.revolt;
    log(s, STAB_LOG.calmed, 'info', undefined, 'stab');
    return;
  }
  r.until = s.time + DECLINE;
  r.terms = true;
}

/** «Принять условия» мятежников: та же уступка. */
export const termsConcede = revoltConcede;

/** «Не уступать»: упадок вдвое дольше и ступень вниз. */
export function termsRefuse(s: GameState): void {
  const st = own(s);
  const r = st.revolt;
  if (!r) return;
  r.until = s.time + 2 * DECLINE;
  st[r.group] = 50;
  stepBy(s, -1, 'terms');
}
