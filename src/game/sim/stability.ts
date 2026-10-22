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
import { asGame, type GameSec } from '../pace';
import {
  bondedTotal,
  decreeOf,
  moraleBreakdown,
  mutinyOpen,
  orderBreakdown,
  orderState,
  payGraceDays,
  rationOf,
  riteMorale,
  taxOf,
  unrestLeft,
} from '../derived';
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
import type { IconName } from '@/ui/icons/alias';

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

// ---------- Строки: что влияет и почему недовольны ----------

/** Куда ведёт «Где изменить»: имя двери интерфейса, а не сама дверь — симуляция интерфейса не знает. */
export type StabGo = 'decrees' | 'storage' | 'build' | 'faith' | 'army' | 'order' | 'market' | 'tech';

/** Строка разбора: слагаемое давления (% ступени в день) или причина недовольства (%). */
export interface StabLine {
  id: string;
  icon: IconName;
  name: string;
  value: number;
  /** Откуда число — живыми величинами партии. */
  hint: string;
  go?: StabGo;
}

/** Полоса группы: где она, куда идёт и когда мятеж. */
export interface GroupView {
  id: StabGroup;
  /** Полоса, %. */
  value: number;
  /** Куда идёт (у податных и голодных), %. У невольников и войска цели нет — у них срок. */
  target: number | null;
  /** Растёт ли полоса сейчас. */
  rising: boolean;
  /** Сколько игровых секунд до мятежа (у войска — до ухода), если растёт к нему; null — не грозит. */
  eta: GameSec | null;
  /** Причины. */
  lines: StabLine[];
}

const line = (id: string, icon: IconName, name: string, value: number, hint: string, go?: StabGo): StabLine => ({
  id,
  icon,
  name,
  value,
  hint,
  ...(go ? { go } : {}),
});

/** Строка морали по имени — та же, что в справке «Мораль»: второй мерки тесноты, голода и ереси нет. */
const moraleLine = (mb: MoraleBreakdown, id: string): number => mb.lines.find((l) => l.id === id)?.value ?? 0;

/** Ступень стабильности причиной: высокая гасит недовольство, низкая разжигает. */
function stabCause(s: GameState): StabLine[] {
  const level = stabLevel(s);
  if (level === 0) return [];
  return [line('stab', 'ui-scales', 'Стабильность', discontentOf(-STAB_STEP * level), stabName(level))];
}

/** Причины недовольства податных — весом их просадки морали (docs/stability.md, 2.3). */
export function folkCauses(s: GameState, mb: MoraleBreakdown = moraleBreakdown(s)): StabLine[] {
  const out: StabLine[] = [];
  const tax = taxOf(s);
  if (tax.moralePenalty > 0) out.push(line('tax', 'res-gold', `Налог: ${tax.name.toLowerCase()}`, discontentOf(tax.moralePenalty), tax.effect, 'decrees'));
  const decree = decreeOf(s);
  const press = -decree.moralePerDay * SEASON_DAYS;
  if (press !== 0) out.push(line('decree', 'ui-scroll', `Указ: ${decree.name}`, discontentOf(press), decree.effect, 'decrees'));
  const crowd = -moraleLine(mb, 'crowding');
  if (crowd > 0) out.push(line('crowding', 'ui-ruin', 'Теснота', discontentOf(crowd), 'жителей больше, чем крыш', 'build'));
  const cold = -moraleLine(mb, 'freezing');
  if (cold > 0) out.push(line('freezing', 'season-winter', 'Город мёрзнет', discontentOf(cold), 'дрова кончились', 'storage'));
  const heresy = -moraleLine(mb, 'heresy');
  if (heresy > 0) out.push(line('heresy', 'ui-flame', 'Вера трещит', discontentOf(heresy), 'набожность ниже раскола', 'faith'));
  const rite = riteMorale(s);
  if (rite > 0) out.push(line('rite', 'ui-candle', 'Обряд', -discontentOf(rite), 'идёт обряд в храме', 'faith'));
  return [...out, ...stabCause(s)];
}

/** Причины недовольства голодных — хлеб на душу тем же счётом, что у морали. */
export function hungryCauses(s: GameState, mb: MoraleBreakdown = moraleBreakdown(s)): StabLine[] {
  const out: StabLine[] = [];
  const starving = -moraleLine(mb, 'starving');
  if (starving > 0) out.push(line('starving', 'ui-skull', 'Закрома пусты', discontentOf(starving), 'еды нет', 'storage'));
  const hungry = -moraleLine(mb, 'hungry');
  if (hungry > 0) out.push(line('hungry', 'res-food', 'Голодно', discontentOf(hungry), 'еды меньше чем на сутки', 'storage'));
  const siege = -moraleLine(mb, 'ration');
  if (siege > 0) out.push(line('siege-ration', 'ui-bowl', 'Осадный паёк', discontentOf(siege), 'еды урезано', 'storage'));
  // Паёк — доля урезанного от голода: тем же правилом, что осадный (`derived.rationMorale`).
  const ration = rationOf(s);
  const cut = (1 - ration.food) * STARVING_MORALE;
  if (cut !== 0) out.push(line('ration', 'ui-bowl', `Паёк: ${ration.name.toLowerCase()}`, discontentOf(cut), ration.effect, 'decrees'));
  return [...out, ...stabCause(s)];
}

/** Цель полосы: сумма причин, не меньше нуля. */
const targetOf = (lines: readonly StabLine[]): number => Math.max(0, lines.reduce((n, l) => n + l.value, 0));

/** Полоса невольников — ропот (`s.unrest` к сроку `MUTINY_FUSE`); мятеж на столе — полная. */
const bondedBar = (s: GameState): number => (mutinyOpen(s) ? 100 : Math.min(100, (100 * Math.max(0, s.unrest ?? 0)) / MUTINY_FUSE));

/** Полоса войска — терпение (`PayState.late` к сроку Статуи). */
function armyBar(s: GameState): number {
  const late = Math.max(0, s.pay?.late ?? 0);
  if (late <= 0) return 0;
  const grace = payGraceDays(s) * DAY_LENGTH;
  return grace > 0 ? Math.min(100, (100 * late) / grace) : 100;
}

/** Срок до ста при полосе `v`, идущей к цели `t` (только если цель — мятеж). */
const etaTo = (v: number, t: number): GameSec | null =>
  t >= REVOLT_AT && v < 100 ? asGame(((100 - v) / GROUP_RISE) * DAY_LENGTH) : null;

/** Полосы всех четырёх групп — для раздела, тревоги и давления. */
export function groupsOf(s: GameState, mb: MoraleBreakdown = moraleBreakdown(s)): GroupView[] {
  const st = stabOf(s);
  const revolt = st.revolt?.group;
  const folkLines = folkCauses(s, mb);
  const hungryLines = hungryCauses(s, mb);
  const fT = targetOf(folkLines);
  const hT = targetOf(hungryLines);
  const order = orderBreakdown(s);
  const ropot = orderState(s) === 'unrest';
  const late = s.pay?.late ?? 0;
  const grace = payGraceDays(s) * DAY_LENGTH;
  const bonded = bondedBar(s);
  const army = armyBar(s);
  return [
    { id: 'folk', value: st.folk, target: fT, rising: revolt !== 'folk' && fT > st.folk, eta: revolt ? null : etaTo(st.folk, fT), lines: folkLines },
    { id: 'hungry', value: st.hungry, target: hT, rising: revolt !== 'hungry' && hT > st.hungry, eta: revolt ? null : etaTo(st.hungry, hT), lines: hungryLines },
    {
      id: 'bonded',
      value: bonded,
      target: null,
      rising: ropot && !mutinyOpen(s),
      eta: ropot ? unrestLeft(s) : null,
      lines:
        bondedTotal(s) > 0
          ? [line('order', 'hud-order', `Порядок ${Math.round(order.value)}`, ropot ? 100 : 0, `надзор держит ${Math.round(order.hold)} из ${order.bonded}`, 'order')]
          : [],
    },
    {
      id: 'army',
      value: army,
      target: null,
      rising: late > 0 && army < 100,
      eta: late > 0 && army < 100 ? asGame(Math.max(0, grace - late)) : null,
      lines: late > 0 ? [line('pay', 'hud-army', (s.pay?.debt ?? 0) > 0 ? 'Жалованье не плачено' : 'Войску нечего есть', 100, 'терпит до срока Статуи', 'army')] : [],
    },
  ];
}

/** Полосы групп в эту минуту. */
type Bars = Record<StabGroup, number>;

/** Слагаемые давления по полосам — одна функция на раздел и на шаг. */
function pressureLines(s: GameState, bars: Bars): StabLine[] {
  const lines: StabLine[] = [line('calm', 'ui-home', 'Тихие дни', STAB_CALM, 'ровная жизнь держит лад')];
  for (const id of ['folk', 'hungry', 'bonded', 'army'] as const) {
    const v = bars[id];
    if (v <= 0) continue;
    const meta = GROUP_META[id];
    lines.push(line(`g-${id}`, meta.icon, `${meta.name} недовольны`, (-STAB_DRAG * v) / 100, `полоса ${Math.round(v)} %`));
  }
  if (s.siege) lines.push(line('siege', 'ui-warning', 'Осада у стен', -STAB_DRAG, `под стенами ${s.siege.byName}`));
  return lines;
}

/** Что влияет на стабильность: слагаемые давления, % ступени за игровой день. */
export function pressureOf(s: GameState, groups: readonly GroupView[] = groupsOf(s)): { lines: StabLine[]; total: number } {
  const bars = Object.fromEntries(groups.map((g) => [g.id, g.value])) as Bars;
  const lines = pressureLines(s, bars);
  return { lines, total: lines.reduce((n, l) => n + l.value, 0) };
}

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

/** Сдвинуть на `d` процентов ступени: дошёл до края — ступень. Сама выше «Лада» не поднимается, ниже «Смуты» не копится. */
function push(s: GameState, d: number): void {
  const st = own(s);
  st.drift += d;
  if (st.drift >= STAB_DRIFT) {
    if (st.level < STAB_SELF_MAX) stepBy(s, 1, 'calm');
    else st.drift = 0;
  } else if (st.drift <= -STAB_DRIFT) {
    if (st.level > STAB_MIN) stepBy(s, -1, 'drift');
    else st.drift = 0;
  }
  if (st.level >= STAB_SELF_MAX && st.drift > 0) st.drift = 0;
  if (st.level <= STAB_MIN && st.drift < 0) st.drift = 0;
}

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
  const fT = targetOf(folkCauses(s, mb));
  const hT = targetOf(hungryCauses(s, mb));
  const move = (v: number, t: number): number => (t > v ? Math.min(t, v + GROUP_RISE * days) : Math.max(t, v - GROUP_FALL * days));
  if (st.revolt?.group !== 'folk') st.folk = move(st.folk, Math.min(100, fT));
  if (st.revolt?.group !== 'hungry') st.hungry = move(st.hungry, Math.min(100, hT));
  const bars: Bars = { folk: st.folk, hungry: st.hungry, bonded: bondedBar(s), army: armyBar(s) };

  // «Мятеж близок» названо — снимается, когда полоса спала ниже половины.
  const rising: Record<StabGroup, () => boolean> = {
    folk: () => fT > st.folk || st.folk >= REVOLT_AT,
    hungry: () => hT > st.hungry || st.hungry >= REVOLT_AT,
    bonded: () => orderState(s) === 'unrest',
    army: () => bars.army < 100,
  };
  const near = new Set(st.near ?? []);
  for (const id of ['folk', 'hungry', 'bonded', 'army'] as const) {
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

  push(s, pressureLines(s, bars).reduce((n, l) => n + l.value, 0) * days);
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
