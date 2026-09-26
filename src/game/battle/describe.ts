// Карточка вида бойцов: всё, что игрок про него читает, выводится отсюда — из
// таблиц боя (`battle/config.ts`), слов ядра (`battle/names.ts`) и данных племени
// (`data/troops.ts`). Рукописных описаний и чисел в интерфейсе быть не должно:
// после первой же правки баланса они разойдутся с настоящими множителями, и
// игрок будет учиться неправде.
//
// Отсюда следует главное правило модуля: **ни одно число не пишется здесь руками**.
// Множители читаются из конфига при каждом вызове (а не запекаются в константы при
// загрузке модуля), поэтому правка `COUNTER` немедленно меняет строку на карточке —
// это и проверяет `describe.test.ts`.
//
// Руками пишутся только условия и названия ситуаций: «пока держат линию»,
// «во фланг» — их из числа не вывести. Само число всегда рядом и всегда из таблицы.
import type { EquipmentId, ResourceId, TroopId } from '../types';
import { TROOPS, TROOP_BY_ID, type TroopDef } from '../data/troops';
import {
  ANCHOR,
  COUNTER,
  CLASH_CAVALRY_IMPACT,
  CLASH_SPEAR_BRACE,
  FOOT_FLANK,
  GEAR,
  KIND_META,
  KITING,
  MORALE,
  ORDER_NAMES,
  SLOW_CONTACT,
  TEMPER,
  UNIT_KINDS,
  UNIT_STATS,
  type KindMeta,
  type UnitKind,
  type UnitStats,
} from '@/battle';
import { KIND_OF, TROOPS_OF_KIND, gearOfTroop } from './kinds';

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
  'spear.advancing': 'наступают или строй разомкнут',
  'spear.flanked': 'удар во фланг или тыл строя',
  'infantry.all': 'в любом положении',
  'archer.shooting': 'стреляют с дистанции',
  'archer.melee': 'до них дошли, и они не ушли',
  'cavalry.charging': 'в движении: удар или обход',
  'cavalry.stalled': 'её остановили во фронте',
  'cavalry.waiting': 'ждёт манёвра или стоит в резерве',
  'heavy.charging': 'в движении: удар с разбега или обход',
  'heavy.stalled': 'её остановили: вязнет в сече',
  'heavy.waiting': 'ждёт манёвра или стоит в резерве',
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

/** Множитель словами: «×2.0», «×1.15», «×0.5». */
export function fmt(m: number): string {
  const s = Math.abs(m * 10 - Math.round(m * 10)) < 1e-9 ? m.toFixed(1) : String(Math.round(m * 100) / 100);
  return `×${s}`;
}

// ---------- Кольцо контрров ----------

export type CounterDir = 'out' | 'in';

export interface CounterLine {
  id: string;
  dir: CounterDir;
  by: UnitKind | 'any';
  at: UnitKind | 'any';
  mult: number;
  /** Готовая строка с числом: «×2.0 против конницы». */
  text: string;
  /** Условие, при котором множитель вообще действует. */
  when: string;
  /** Выгодно ли это нашему виду. */
  good: boolean;
}

interface Spec {
  id: string;
  by: UnitKind | 'any';
  at: UnitKind | 'any';
  mult: number;
  when: string;
  /** Показывать ли строку на карточках других родов как «так бьют по нам». */
  broad?: boolean;
  /** Роды, к которым правило не относится: пехоту нечего предупреждать об отсутствии пехоты. */
  except?: UnitKind[];
}

const O = ORDER_NAMES;

/**
 * Все условные множители боя одним списком. Функция, а не константа: карточка
 * обязана читать конфиг в момент показа, иначе правка баланса до неё не дойдёт.
 */
function specs(): Spec[] {
  return [
    {
      id: 'spear-cav-hold',
      by: 'spear',
      at: 'cavalry',
      mult: COUNTER.spear.cavalryHolding,
      when: `только пока держат линию: приказы «${O.spear['hold-line']}», «${O.spear['guard-archers']}», «${O.spear['priority-cavalry']}»`,
    },
    {
      id: 'spear-cav-advance',
      by: 'spear',
      at: 'cavalry',
      mult: COUNTER.spear.cavalryAdvancing,
      when: `с приказом «${O.spear.advance}» строй разомкнут, и превосходство почти пропадает`,
    },
    {
      id: 'spear-foot-flank',
      by: 'spear',
      at: 'any',
      mult: FOOT_FLANK,
      when: 'если сами зашли во фланг или тыл — пеший обход скромнее конного',
    },
    {
      id: 'infantry-all',
      by: 'infantry',
      at: 'any',
      mult: COUNTER.infantry.all,
      when: 'в любом положении: кольцо контрров пехоту не трогает ни в одну сторону',
    },
    {
      id: 'infantry-foot-flank',
      by: 'infantry',
      at: 'any',
      mult: FOOT_FLANK,
      when: 'если сами зашли во фланг или тыл — пеший обход скромнее конного',
    },
    {
      id: 'cav-archer',
      by: 'cavalry',
      at: 'archer',
      mult: COUNTER.cavalry.archer,
      when: `когда добралась до лучников: приказ «${O.cavalry['attack-archers']}» или удавшийся обход`,
    },
    {
      id: 'cav-flank',
      by: 'cavalry',
      at: 'any',
      mult: COUNTER.cavalry.flank,
      broad: true,
      when: `удар во фланг или тыл — приказ «${O.cavalry.flank}»; сомкнутых копий не касается`,
    },
    {
      id: 'cav-spear-closed',
      by: 'cavalry',
      at: 'spear',
      mult: COUNTER.cavalry.spearClosed,
      when: 'в лоб или в закрытый со всех сторон тыл, пока копья сомкнуты',
    },
    {
      id: 'cav-infantry',
      by: 'cavalry',
      at: 'infantry',
      mult: COUNTER.cavalry.infantry,
      when: 'в лоб: пехота строя не смыкает, и конница его ломает',
    },
    {
      id: 'cav-clash',
      by: 'heavy',
      at: 'any',
      mult: CLASH_CAVALRY_IMPACT,
      when: 'сшибка: удар с разбега во фронт — в каждом круге боя',
    },
    {
      id: 'archer-spear',
      by: 'archer',
      at: 'spear',
      mult: COUNTER.archer.spear,
      when: 'стрельбой, пока цель не вошла в рукопашную',
    },
    {
      id: 'archer-infantry',
      by: 'archer',
      at: 'infantry',
      mult: COUNTER.archer.infantry,
      when: 'стрельбой, пока цель не вошла в рукопашную',
    },
    {
      id: 'archer-cavalry',
      by: 'archer',
      at: 'cavalry',
      mult: COUNTER.archer.cavalry,
      when: 'стрельбой, пока цель не вошла в рукопашную',
    },
    {
      id: 'archer-after',
      by: 'archer',
      at: 'any',
      mult: COUNTER.archer.afterContact,
      broad: true,
      when: 'после того, как цель вошла в рукопашную: бьют через головы своих',
    },
    {
      id: 'archer-kite-shot',
      by: 'archer',
      at: 'any',
      mult: KITING.ranged,
      when: `стрельба на отходе: приказ «${O.archer['keep-distance']}» против тех, кто медленнее`,
    },
    {
      id: 'spear-brace',
      by: 'any',
      at: 'spear',
      mult: CLASH_SPEAR_BRACE,
      when: 'сшибка: сомкнутые копья принимают удар упёршись — в каждом круге боя',
    },
    {
      id: 'archer-kite-taken',
      by: 'any',
      at: 'archer',
      mult: KITING.damageTaken,
      when: `пока держат дистанцию: приказ «${O.archer['keep-distance']}» против тех, кто медленнее`,
    },
    {
      id: 'no-anchor',
      by: 'any',
      at: 'any',
      mult: ANCHOR.noInfantryDamageTaken,
      except: ['infantry'],
      when: `фронт без пехоты (её должно быть ${Math.round(ANCHOR.infantryShare * 100)}% сектора) получает больше`,
    },
  ];
}

const nameOut = (at: UnitKind | 'any'): string => (at === 'any' ? 'против всех' : `против ${KIND_GEN[at]}`);
const nameIn = (by: UnitKind | 'any'): string => (by === 'any' ? 'по нам' : `${KIND_META[by].name.toLowerCase()} по нам`);

/**
 * Множители, которые видит один род: и свои (чем он бьёт), и чужие (чем бьют его).
 * Невыгодные показываются наравне с выгодными — карточка не рекламный листок.
 */
export function countersOf(kind: UnitKind): CounterLine[] {
  const out: CounterLine[] = [];
  for (const s of specs()) {
    if (s.except?.includes(kind)) continue;
    const mine = s.by === kind;
    const atMe = s.at === kind || (s.at === 'any' && (s.broad || s.by === 'any'));
    if (mine) {
      out.push({
        id: s.id,
        dir: 'out',
        by: s.by,
        at: s.at,
        mult: s.mult,
        text: `${fmt(s.mult)} ${nameOut(s.at)}`,
        when: s.when,
        good: s.mult > 1,
      });
    } else if (atMe) {
      out.push({
        id: s.id,
        dir: 'in',
        by: s.by,
        at: s.at,
        mult: s.mult,
        text: `${fmt(s.mult)} ${nameIn(s.by)}`,
        when: s.when,
        good: s.mult < 1,
      });
    }
  }
  const order = (l: CounterLine): number => (l.dir === 'out' ? 0 : 1);
  return out.sort((a, b) => order(a) - order(b) || b.mult - a.mult);
}

export interface RingEdge {
  from: UnitKind;
  to: UnitKind;
  mult: number;
  text: string;
}

/** Кольцо «копья → конница → лучники → копья» числами из конфига. Пехота — вне кольца. */
export function counterRing(): { edges: RingEdge[]; aside: { kind: UnitKind; mult: number; text: string } } {
  const edge = (from: UnitKind, to: UnitKind, mult: number): RingEdge => ({ from, to, mult, text: fmt(mult) });
  return {
    edges: [
      edge('spear', 'cavalry', COUNTER.spear.cavalryHolding),
      edge('cavalry', 'archer', COUNTER.cavalry.archer),
      edge('archer', 'spear', COUNTER.archer.spear),
    ],
    aside: { kind: 'infantry', mult: COUNTER.infantry.all, text: fmt(COUNTER.infantry.all) },
  };
}

// ---------- Мораль ----------

export interface MoraleParts {
  /** Мораль рода без снаряжения. */
  base: number;
  /** Ступень снаряжения бойца, 0..`GEAR.max`. */
  gearLevel: number;
  /** Что даёт снаряжение. */
  gear: number;
  total: number;
  max: number;
}

export const moraleOf = (troop: TroopId): MoraleParts => {
  const kind = KIND_OF[troop];
  const gearLevel = gearOfTroop(troop);
  const base = UNIT_STATS[kind].morale;
  const gear = gearLevel * GEAR.moralePerLevel;
  return { base, gearLevel, gear, total: Math.min(MORALE.max, base + gear), max: MORALE.max };
};

export interface NextGear {
  level: number;
  gain: number;
  morale: number;
  /** Вид того же рода с этой ступенью, если он в игре есть. */
  example: TroopDef | null;
}

/** Что даст следующая ступень снаряжения. null — ступень уже предельная. */
export function nextGearOf(troop: TroopId): NextGear | null {
  const kind = KIND_OF[troop];
  const m = moraleOf(troop);
  if (m.gearLevel >= GEAR.max) return null;
  const level = m.gearLevel + 1;
  const example =
    TROOPS_OF_KIND[kind]
      .map((id) => TROOP_BY_ID[id])
      .filter((d) => gearOfTroop(d.id) >= level)
      .sort((a, b) => gearOfTroop(a.id) - gearOfTroop(b.id))[0] ?? null;
  const target = example ? gearOfTroop(example.id) : level;
  return {
    level: target,
    gain: (target - m.gearLevel) * GEAR.moralePerLevel,
    morale: Math.min(MORALE.max, m.base + target * GEAR.moralePerLevel),
    example,
  };
}

// ---------- Сильные и слабые стороны ----------

/** Крайние значения по родам и видам — на них и стоят правила «самый-самый». */
interface Extremes {
  moraleTop: UnitKind;
  moraleLow: UnitKind;
  speedTop: UnitKind;
  toughTop: UnitKind;
  powerTop: TroopId;
  workTop: TroopId;
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
    toughTop: best(UNIT_KINDS, (k) => stat(k).toughness),
    powerTop: best(TROOPS, (t) => t.power).id,
    workTop: best(TROOPS, (t) => t.work).id,
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

function strengthsOf(troop: TroopId): string[] {
  const kind = KIND_OF[troop];
  const def = TROOP_BY_ID[troop];
  const ex = extremes();
  const lines = countersOf(kind);
  const outs = lines.filter((l) => l.dir === 'out');
  const ins = lines.filter((l) => l.dir === 'in');
  const topOut = outs.length > 0 ? best(outs, (l) => l.mult) : null;
  const bestIn = ins.length > 0 ? worst(ins, (l) => l.mult) : null;
  const temper = temperLines(kind);
  const softest = temper.length > 0 ? worst(temper, (t) => t.mult) : null;
  const m = moraleOf(troop);

  return run(
    [
      () => (topOut && topOut.mult > 1 ? `Лучший размен рода: ${topOut.text} — ${topOut.when}.` : null),
      () => (bestIn && bestIn.mult < 1 ? `По нему бьют вполсилы: ${bestIn.text} — ${bestIn.when}.` : null),
      () =>
        ex.moraleTop === kind
          ? `Самая высокая стойкость среди родов: мораль рода ${UNIT_STATS[kind].morale} из ${MORALE.max}.`
          : null,
      () =>
        ex.powerTop === troop
          ? `Самый сильный боец на человека во всём племени: мощь ${def.power} против ${worst(TROOPS, (t) => t.power).power} у самого дешёвого.`
          : null,
      () =>
        m.gearLevel >= GEAR.max
          ? `Полное снаряжение: ступень ${m.gearLevel} из ${GEAR.max} даёт ${m.gear > 0 ? '+' : ''}${m.gear} морали.`
          : null,
      () =>
        UNIT_STATS[kind].ranged > 0
          ? `Единственный род, который работает до сближения: стрельба ${UNIT_STATS[kind].ranged.toFixed(1)} на бойца, а рукопашная — всего ${UNIT_STATS[kind].melee.toFixed(1)}.`
          : null,
      () =>
        kind === 'infantry'
          ? `Якорь сектора: с долей пехоты от ${Math.round(ANCHOR.infantryShare * 100)}% фронт держится до ${Math.round(ANCHOR.collapseAt * 100)}% остатка вместо ${Math.round(ANCHOR.noInfantryCollapseAt * 100)}%, а потери морали идут ${fmt(MORALE.anchor)} и паника ${fmt(MORALE.anchorPanic)}.`
          : null,
      () =>
        softest && softest.mult < 1
          ? `Держит удар, когда ${softest.when}: потери морали ${fmt(softest.mult)}.`
          : null,
      () => (ex.speedTop === kind ? `Быстрее всех на поле: скорость ${UNIT_STATS[kind].speed}.` : null),
      () =>
        ex.toughTop === kind
          ? `Крепче прочих: чтобы выбить одного, нужно ${UNIT_STATS[kind].toughness.toFixed(1)} урона.`
          : null,
    ],
    3,
  );
}

function weaknessesOf(troop: TroopId): string[] {
  const kind = KIND_OF[troop];
  const def = TROOP_BY_ID[troop];
  const ex = extremes();
  const lines = countersOf(kind);
  const outs = lines.filter((l) => l.dir === 'out');
  const ins = lines.filter((l) => l.dir === 'in');
  const worstIn = ins.length > 0 ? best(ins, (l) => l.mult) : null;
  const worstOut = outs.length > 0 ? worst(outs, (l) => l.mult) : null;
  const temper = temperLines(kind);
  const brittle = temper.length > 0 ? best(temper, (t) => t.mult) : null;
  const m = moraleOf(troop);
  const cheapest = worst(TROOPS, (t) => t.work);

  return run(
    [
      () => (worstIn && worstIn.mult > 1 ? `Больнее всего получает: ${worstIn.text} — ${worstIn.when}.` : null),
      () => (worstOut && worstOut.mult < 1 ? `Хуже всего бьёт: ${worstOut.text} — ${worstOut.when}.` : null),
      () =>
        brittle && brittle.mult > 1
          ? `Ломается, когда ${brittle.when}: потери морали ${fmt(brittle.mult)}.`
          : null,
      () =>
        ex.moraleLow === kind
          ? `Самый нестойкий род: мораль ${UNIT_STATS[kind].morale} против ${UNIT_STATS[ex.moraleTop].morale} у ${KIND_GEN[ex.moraleTop]}.`
          : null,
      () =>
        UNIT_STATS[kind].speed <= SLOW_CONTACT.speedAtMost
          ? `Медленные: дистанцию не сокращают, в рукопашную вступают на ${count(SLOW_CONTACT.delay, 'тик', 'тика', 'тиков')} позже остальных.`
          : null,
      () =>
        m.gearLevel === 0
          ? `Без снаряжения: ступень 0 из ${GEAR.max}, к морали рода не прибавляется ничего — каждая ступень стоит ${GEAR.moralePerLevel}.`
          : null,
      () =>
        ex.workTop === troop
          ? `Дольше всех учится: ${def.work} работы казарм против ${cheapest.work} у самого дешёвого — ${fmt(def.work / cheapest.work)}.`
          : null,
      () =>
        Object.keys(def.gear).length > 0
          ? `Без кузницы не нанять: на бойца нужно ${count(Object.values(def.gear).reduce((a, b) => a + (b ?? 0), 0), 'предмет', 'предмета', 'предметов')} снаряжения.`
          : null,
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
  /** Наибольшая мощь среди видов — чтобы полоска показывала место в ряду. */
  powerMax: number;
  cost: TroopCost;
  counters: CounterLine[];
  strengths: string[];
  weaknesses: string[];
  orders: { id: string; name: string }[];
  nextGear: NextGear | null;
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
    powerMax: best(TROOPS, (t) => t.power).power,
    cost: {
      resources: (Object.keys(def.cost) as ResourceId[]).filter((r) => def.cost[r]).map((r) => ({ id: r, n: def.cost[r] as number })),
      gear: (Object.keys(def.gear) as EquipmentId[]).filter((g) => def.gear[g]).map((g) => ({ id: g, n: def.gear[g] as number })),
      people: 1,
      work: def.work,
    },
    counters: countersOf(kind),
    strengths: strengthsOf(troop),
    weaknesses: weaknessesOf(troop),
    orders: Object.entries(ORDER_NAMES[kind]).map(([id, name]) => ({ id, name })),
    nextGear: nextGearOf(troop),
  };
}

/** Подпись характера рода для карточки: ситуация → множитель потерь морали. */
export const temperOf = (kind: UnitKind): { when: string; mult: number; text: string }[] =>
  temperLines(kind).map((t) => ({ ...t, text: fmt(t.mult) }));
