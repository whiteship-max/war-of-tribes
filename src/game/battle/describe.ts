// Карточка вида бойцов: всё, что игрок про него читает, выводится отсюда — из
// таблиц боя (`battle/config.ts`), слов ядра (`battle/names.ts`) и данных племени
// (`data/troops.ts`). Рукописных описаний и чисел в интерфейсе быть не должно:
// после первой же правки баланса они разойдутся с настоящими множителями, и
// игрок будет учиться неправде.
//
// Отсюда следует главное правило модуля: **ни одно число не пишется здесь руками**.
// Показатели и множители читаются из конфига при каждом вызове (а не запекаются в
// константы при загрузке модуля), поэтому правка рода (`KIND_PROFILE`) или цены вида
// немедленно меняет строку на карточке — это и проверяет `describe.test.ts`.
//
// Кольца контрров нет (слово владельца по 14.35, docs/battle_eu4.md): кто кого бьёт,
// следует из показателей рода — нападения и защиты в огне, натиске и морали, как у EU4, —
// и карточка показывает их, а не пары «род против рода». Вещи своих показателей не дают:
// они идут в бой через цену вида — весом в строю (путь П2, `game/battle/price`).
//
// Руками пишутся только названия показателей и ситуаций характера: «сомкнутый строй»,
// «в обходе» — их из числа не вывести. Само число всегда рядом и всегда из таблицы.
// Условие — всегда положение, а не приказ: приказов у боя нет (docs/battle_eu4.md, 14.5).
import type { EquipmentId, ResourceId, TroopId } from '../types';
import { TROOPS, TROOP_BY_ID, type TroopDef } from '../data/troops';
import {
  ANCHOR,
  FIRE_AFTER_CONTACT,
  KIND_META,
  KIND_PROFILE,
  MORALE,
  PIP,
  STAT_IDS,
  TEMPER,
  UNIT_KINDS,
  UNIT_STATS,
  type KindMeta,
  type StatId,
  type UnitKind,
  type UnitStats,
} from '@/battle';
import { KIND_OF, profileOfTroop } from './kinds';
import { BASE_TROOP, battleWeight, powerOf } from './price';
import { dec, num } from '../num';

// ---------- Слова, которые из чисел не выведешь ----------

/** Родительный падеж рода: «против конницы». Само число всегда из конфига. */
const KIND_GEN: Record<UnitKind, string> = {
  spear: 'копий',
  infantry: 'пехоты',
  archer: 'лучников',
  cavalry: 'лёгкой конницы',
  heavy: 'тяжёлой конницы',
};

/** Названия ситуаций характера рода (`TEMPER`): ключ таблицы → что происходит. */
const TEMPER_WHEN: Record<string, string> = {
  'spear.holding': 'сомкнутый строй под ударом в лоб',
  'spear.advancing': 'строй разомкнут: смят',
  'spear.flanked': 'удар во фланг или тыл строя',
  'infantry.all': 'в любом положении',
  'archer.shooting': 'стреляют с дистанции',
  'archer.melee': 'до них дошли, и они не ушли',
  'cavalry.charging': 'в обходе: конница в движении',
  'cavalry.waiting': 'в строю и в резерве',
  'heavy.charging': 'в обходе: конница в движении',
  'heavy.waiting': 'в строю и в резерве',
};

/** Имя показателя: фаза и сторона удара. */
const STAT_NAME: Record<StatId, string> = {
  fireAtk: 'огонь, нападение',
  fireDef: 'огонь, защита',
  shockAtk: 'натиск, нападение',
  shockDef: 'натиск, защита',
  moraleAtk: 'мораль, нападение',
  moraleDef: 'мораль, защита',
};

/** Что делает отметка показателя — словами; доля — цена отметки из конфига (`PIP`). */
const STAT_WHAT: Record<StatId, (pct: string) => string> = {
  fireAtk: (p) => `его стрелы бьют сильнее: +${p} урона за отметку сверх защиты цели в огне`,
  fireDef: (p) => `стрелы по нему бьют слабее: −${p} урона за отметку`,
  shockAtk: (p) => `в сшибке и сече бьёт сильнее: +${p} урона за отметку сверх защиты цели в натиске`,
  shockDef: (p) => `в сшибке и сече его бьют слабее: −${p} урона за отметку`,
  moraleAtk: (p) => `его удары ломают мораль сильнее: +${p} урона морали за отметку сверх защиты цели`,
  moraleDef: (p) => `удары по нему ломают мораль слабее: −${p} урона морали за отметку`,
};

/**
 * Русское число со словом: «1 предмет», «3 предмета», «5 предметов». Числа в
 * строках приходят из конфига и меняются вместе с балансом, поэтому склонять
 * их приходится по правилу, а не подбирать окончание под нынешнее значение.
 */
function count(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${word}`;
}

/** Множитель словами: «×2,0», «×1,15», «×0,5». */
export function fmt(m: number): string {
  const s = Math.abs(m * 10 - Math.round(m * 10)) < 1e-9 ? dec(m, 1) : num(m, 2);
  return `×${s}`;
}

// ---------- Показатели ----------

/** Цена отметки в процентах урона: «13 %». */
const pipPct = (): string => `${Math.round(PIP * 100)} %`;

export interface StatLine {
  stat: StatId;
  /** «огонь, нападение». */
  name: string;
  /** Отметок у вида — показатель его рода (`KIND_PROFILE`): вещи своих не дают. */
  value: number;
  /** Что делает отметка — словами, с ценой из конфига. */
  what: string;
}

/**
 * Шесть показателей вида — показатели его рода (путь П2, 14.35: вещи идут в бой через цену, а не отметками). Все шесть,
 * и нули тоже: карточка не рекламный листок — что у вида пусто, видно наравне с тем, что сильно.
 */
export function statsOf(troop: TroopId): StatLine[] {
  const all = KIND_PROFILE[KIND_OF[troop]];
  return STAT_IDS.map((stat) => ({ stat, name: STAT_NAME[stat], value: all[stat], what: STAT_WHAT[stat](pipPct()) }));
}

export interface PositionLine {
  /** Множитель: «×0.3». */
  text: string;
  mult: number;
  /** Положение, при котором он действует. */
  when: string;
  good: boolean;
}

/**
 * Что род делает по положению, а не по показателям, — кроме характера (`temperOf`): лучники после контакта бьют через
 * головы своих долей силы (`FIRE_AFTER_CONTACT`). Условие — положение, а не приказ.
 */
export function positionsOf(kind: UnitKind): PositionLine[] {
  const out: PositionLine[] = [];
  if (UNIT_STATS[kind].ranged > 0) {
    out.push({
      text: fmt(FIRE_AFTER_CONTACT),
      mult: FIRE_AFTER_CONTACT,
      when: 'стрельба после того, как цель вошла в рукопашную: бьют через головы своих',
      good: false,
    });
  }
  return out;
}

// ---------- Мораль ----------

export interface MoraleParts {
  /** Мораль рода — вся мораль вида: за снаряжение морали нет (путь П2, 14.35). */
  total: number;
  max: number;
}

export const moraleOf = (troop: TroopId): MoraleParts => ({ total: UNIT_STATS[KIND_OF[troop]].morale, max: MORALE.max });

// ---------- Вес в бою ----------

export interface WeightParts {
  /** Бойцов строя на голову (`price.battleWeight`): во сколько раз его содержание дороже дубинщика. */
  value: number;
  /** Наибольший вес среди видов — чтобы полоска показывала место в ряду. */
  max: number;
  /** Мощь вида и наибольшая мощь — то же число в мере мира (`price.powerOf`): им его зовёт найм и строка дружины. */
  power: number;
  powerMax: number;
  /** Что это значит — словами, числа из цены. */
  what: string;
}

/** Вес вида в бою: по цене, а не по мощи. Вещи идут в бой только так (путь П2, 14.35). */
export function weightOfTroop(troop: TroopId): WeightParts {
  const value = battleWeight(troop);
  const max = best(TROOPS, (t) => battleWeight(t.id));
  return {
    value,
    max: battleWeight(max.id),
    power: powerOf(troop),
    powerMax: powerOf(max.id),
    what:
      troop === BASE_TROOP
        ? 'Мерка мощи: один боец, один боец строя. Снаряжение и конь входят в мощь через цену: чем дороже содержание, тем сильнее вид.'
        : `Один боец стоит в бою ${dec(value, 1)} бойца строя: во столько раз его содержание дороже, чем у вида ${TROOP_BY_ID[BASE_TROOP].name}. Снаряжение и конь входят в мощь через цену.`,
  };
}

// ---------- Сильные и слабые стороны ----------

/** Крайние значения по родам и видам — на них и стоят правила «самый-самый». */
interface Extremes {
  moraleTop: UnitKind;
  moraleLow: UnitKind;
  speedTop: UnitKind;
  speedLow: UnitKind;
  weightTop: TroopId;
  weightLow: TroopId;
  workTop: TroopId;
  workLow: TroopId;
}

const best = <T>(items: readonly T[], v: (x: T) => number): T =>
  items.reduce((a, b) => (v(b) > v(a) ? b : a));
const worst = <T>(items: readonly T[], v: (x: T) => number): T =>
  items.reduce((a, b) => (v(b) < v(a) ? b : a));

function extremes(): Extremes {
  const stat = (k: UnitKind): UnitStats => UNIT_STATS[k];
  return {
    moraleTop: best(UNIT_KINDS, (k) => stat(k).morale),
    moraleLow: worst(UNIT_KINDS, (k) => stat(k).morale),
    speedTop: best(UNIT_KINDS, (k) => stat(k).speed),
    speedLow: worst(UNIT_KINDS, (k) => stat(k).speed),
    weightTop: best(TROOPS, (t) => battleWeight(t.id)).id,
    weightLow: worst(TROOPS, (t) => battleWeight(t.id)).id,
    workTop: best(TROOPS, (t) => t.work).id,
    workLow: worst(TROOPS, (t) => t.work).id,
  };
}

/** Ситуация характера рода: множитель всех потерь морали. */
function temperLines(kind: UnitKind): { when: string; mult: number }[] {
  const table = TEMPER[kind] as unknown as Record<string, number>;
  return Object.entries(table).map(([key, mult]) => ({
    when: TEMPER_WHEN[`${kind}.${key}`] ?? key,
    mult,
  }));
}

/** Правило: возвращает строку, если оно к этому виду относится, иначе null. */
type Rule = () => string | null;

/**
 * Первые `max` правил, которым есть что сказать про этот вид. Порядок правил и
 * есть их важность: сначала самое своеобразное, потом общее. Что каждому виду
 * достанется хотя бы две строки — не надежда, а проверенный тестом договор.
 */
function run(rules: Rule[], max: number): string[] {
  const out: string[] = [];
  for (const r of rules) {
    if (out.length >= max) break;
    const line = r();
    if (line) out.push(line);
  }
  return out;
}

/**
 * Сильнейший показатель вида: где он среди лучших видов племени (`top`), а нет такого — просто его наибольший, если он
 * больше нуля. Первый по порядку показателей. Правило, а не список: правка рода или вещи переносит строку сама.
 */
function topStat(troop: TroopId): { line: StatLine; top: boolean } | null {
  const mine = statsOf(troop);
  for (const line of mine) {
    const top = Math.max(...TROOPS.map((t) => profileOfTroop(t.id)[line.stat]));
    if (line.value > 0 && line.value >= top) return { line, top: true };
  }
  const own = mine.reduce((a, b) => (b.value > a.value ? b : a));
  return own.value > 0 ? { line: own, top: false } : null;
}

/** Слабейшая защита вида — в огне, в натиске или в морали: первая по порядку из наименьших. */
function weakestDef(troop: TroopId): StatLine {
  const defs = statsOf(troop).filter((l) => l.stat.endsWith('Def'));
  return defs.reduce((a, b) => (b.value < a.value ? b : a));
}

/** Слово «отметка» по числу: «1 отметка», «2 отметки». */
const pips = (n: number): string => count(n, 'отметка', 'отметки', 'отметок');

function strengthsOf(troop: TroopId): string[] {
  const kind = KIND_OF[troop];
  const def = TROOP_BY_ID[troop];
  const ex = extremes();
  const top = topStat(troop);
  const temper = temperLines(kind);
  const softest = temper.length > 0 ? worst(temper, (t) => t.mult) : null;

  return run(
    [
      () =>
        top
          ? `${top.top ? 'Среди лучших видов' : 'Сильнее всего'} — ${top.line.name}: ${pips(top.line.value)}; ${top.line.what}.`
          : null,
      () =>
        ex.moraleTop === kind
          ? `Самая высокая стойкость среди родов: мораль рода ${UNIT_STATS[kind].morale} из ${MORALE.max}.`
          : null,
      () =>
        ex.weightTop === troop
          ? `Сильнее всех на бойца: ${dec(battleWeight(troop), 1)} бойца строя против ${dec(battleWeight(ex.weightLow), 1)} у самого слабого.`
          : null,
      () =>
        UNIT_STATS[kind].ranged > 0
          ? `Единственный род, что бьёт до сближения: стрельба ${dec(UNIT_STATS[kind].ranged, 1)} на бойца, рукопашная всего ${dec(UNIT_STATS[kind].melee, 1)}.`
          : null,
      () =>
        kind === 'infantry'
          ? `Якорь сектора: каждый пехотинец держит ${Math.round(1 / ANCHOR.infantryShare)} человек своего сектора, у них потери морали ${fmt(MORALE.anchor)}. С долей пехоты от ${Math.round(ANCHOR.infantryShare * 100)}% так держится весь сектор.`
          : null,
      () =>
        softest && softest.mult < 1
          ? `Держит удар, когда ${softest.when}: потери морали ${fmt(softest.mult)}.`
          : null,
      () => (ex.speedTop === kind ? `Быстрее всех на поле: скорость ${UNIT_STATS[kind].speed}, догоняет отходящих первым.` : null),
      () =>
        battleWeight(troop) > 1
          ? `Меньше людей на ту же мощь: ${Math.round(100 / battleWeight(troop))} вместо ста. Меньше жителей уходит в дружину.`
          : null,
      () =>
        ex.workLow === troop
          ? `Быстрее всех учится: ${def.work} работы казарм против ${best(TROOPS, (t) => t.work).work} у самого долгого.`
          : null,
      () => (Object.keys(def.gear).length === 0 ? 'Кузницы не просит, нанять можно с первого дня.' : null),
    ],
    3,
  );
}

function weaknessesOf(troop: TroopId): string[] {
  const kind = KIND_OF[troop];
  const def = TROOP_BY_ID[troop];
  const ex = extremes();
  const p = profileOfTroop(troop);
  const temper = temperLines(kind);
  const brittle = temper.length > 0 ? best(temper, (t) => t.mult) : null;
  const cheapest = worst(TROOPS, (t) => t.work);

  return run(
    [
      () =>
        p.fireDef + p.shockDef === 0
          ? `Без защиты в огне и натиске. Каждая отметка нападения врага даёт +${pipPct()} урона.`
          : null,
      () =>
        UNIT_STATS[kind].melee < 1
          ? `В сшибке и сече слаб: натиск ${fmt(UNIT_STATS[kind].melee)} против ${fmt(1)} у остальных.`
          : null,
      () =>
        brittle && brittle.mult > 1
          ? `Ломается, когда ${brittle.when}: потери морали ${fmt(brittle.mult)}.`
          : null,
      () =>
        ex.moraleLow === kind
          ? `Самый нестойкий род: мораль ${UNIT_STATS[kind].morale} против ${UNIT_STATS[ex.moraleTop].morale} у ${KIND_GEN[ex.moraleTop]}.`
          : null,
      () =>
        ex.weightLow === troop
          ? `Слабее всех на бойца: ${dec(battleWeight(troop), 1)} бойца строя. Ту же мощь набирают числом.`
          : null,
      () =>
        ex.workTop === troop
          ? `Дольше всех учится: ${def.work} работы казарм против ${cheapest.work} у самого быстрого, ${fmt(def.work / cheapest.work)}.`
          : null,
      () =>
        ex.speedLow === kind
          ? `Медленнее всех: скорость ${UNIT_STATS[kind].speed}, при отходе его догоняют первым.`
          : null,
      () =>
        Object.keys(def.gear).length > 0
          ? `Без кузницы не нанять: снаряжения на бойца ${Object.values(def.gear).reduce((a, b) => a + (b ?? 0), 0)}.`
          : null,
      () => {
        const w = weakestDef(troop);
        return `Слабее всего ${w.name}: ${pips(w.value)}. Каждая отметка нападения врага сверх неё даёт +${pipPct()} урона.`;
      },
    ],
    3,
  );
}

// ---------- Карточка ----------

export interface TroopCost {
  resources: { id: ResourceId; n: number }[];
  gear: { id: EquipmentId; n: number }[];
  /** Живых людей на одного бойца. Всегда один: боец — это житель, ушедший на учения. */
  people: number;
  /** Работа казарм на одного бойца. */
  work: number;
}

export interface TroopCard {
  def: TroopDef;
  kind: UnitKind;
  meta: KindMeta;
  stats: UnitStats;
  morale: MoraleParts;
  /** Вес в бою — по цене (`weightOfTroop`). */
  weight: WeightParts;
  cost: TroopCost;
  /** Шесть показателей рода (`statsOf`). */
  pips: StatLine[];
  /** Что род делает по положению, кроме характера (`positionsOf`). */
  positions: PositionLine[];
  strengths: string[];
  weaknesses: string[];
}

/**
 * Полное описание вида бойцов. Чистая функция от конфига и данных: состояние
 * партии сюда не входит — живые числа (сколько их в деревне, за сколько секунд
 * учатся) подставляет панель.
 */
export function troopCard(troop: TroopId): TroopCard {
  const def = TROOP_BY_ID[troop];
  const kind = KIND_OF[troop];
  return {
    def,
    kind,
    meta: KIND_META[kind],
    stats: UNIT_STATS[kind],
    morale: moraleOf(troop),
    weight: weightOfTroop(troop),
    cost: {
      resources: (Object.keys(def.cost) as ResourceId[]).filter((r) => def.cost[r]).map((r) => ({ id: r, n: def.cost[r] as number })),
      gear: (Object.keys(def.gear) as EquipmentId[]).filter((g) => def.gear[g]).map((g) => ({ id: g, n: def.gear[g] as number })),
      people: 1,
      work: def.work,
    },
    pips: statsOf(troop),
    positions: positionsOf(kind),
    strengths: strengthsOf(troop),
    weaknesses: weaknessesOf(troop),
  };
}

/** Подпись характера рода для карточки: ситуация → множитель потерь морали. */
export const temperOf = (kind: UnitKind): { when: string; mult: number; text: string }[] =>
  temperLines(kind).map((t) => ({ ...t, text: fmt(t.mult) }));
