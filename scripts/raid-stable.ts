// Конюшня — раздел `raid:report` (docs/stable.md).
//
// Замер до кода: чем сегодня отличаются рода войск в бою и какое место займут два класса конницы — лёгкая и
// тяжёлая. Кода игры раздел не меняет. Подстановка в нём одна, и названа она в выводе везде, где стоит:
// **класс конницы** — числа конного рода (`UNIT_STATS.cavalry`, `COUNTER.cavalry`, `COUNTER.archer.cavalry`,
// `TEMPER.cavalry`, `RETREAT.pursuitKills.cavalry`) и снаряжение всадника (`TROOP_BY_ID.rider.gear`) на время
// замера заменяются классом и возвращаются на место. Профили классов собраны из чисел, которые в конфиге боя
// уже есть (`LIGHT`, `HEAVY`), — своего числа у них нет. Чего подстановка не умеет, вывод говорит сам:
// - удар с разбега (`CLASH_CAVALRY_IMPACT`) — константа ядра, её не подставить: он остаётся ×1.5 у обоих;
// - два класса в одной армии: конный род в ядре один;
// - конница логова в подстановке — того же класса, что наша: род один на обе стороны.
//
// Разделы:
//  1. **Виды сегодня** — что у каждого из восьми видов есть: род, бойцов строя, ступень, мораль, цена и
//     содержание на бойца строя (мера боя — `kinds.menOf`).
//  2. **Вид против вида при равной мощи** — ядро, обе стороны на быстрой атаке, как в игре без настройки.
//  3. **Кольцо в игре** — вид против логова по пяти укладам: оборона от набега и удар по гарнизону.
//  4. **Бой у стены** — `LocalWorld.wallField`, посёлок мерки 10-го уровня, армии одной мощи.
//  5. **Армия без линии в обходе** — дыра ядра, найденная этим замером.
//  6. **Классы конницы** — правило, кольцо, чувствительность к приказу, доля в войске, бой у стены.
//  7. **Числа** — цена силы сегодня и то, что из неё выводится для двух классов: цена, содержание, места,
//     время найма.
import {
  COUNTER,
  FOOT_FLANK,
  GEAR,
  RETREAT,
  TEMPER,
  UNIT_STATS,
  emptyStack,
  quickAttack,
  quickSetup,
  simulateBattle,
  type ArmySetup,
  type CavalryOrder,
  type Stack,
  type UnitKind,
  type UnitStats,
} from '@/battle';
import { mirrored } from '@/battle/bench';
import { resolveField } from '@/world/battle';
import { GARRISON_STYLES, garrisonOf, raidingParty, type GarrisonStyle } from '@/world/garrison';
import { militiaMen } from '@/world/bridge';
import { lairPower, lairRaid } from '@/world/lairs';
import { LAIR_ANCHOR_MID, LAIR_RIPE } from '@/world/data/tuning';
import { TROOPS, TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { BATTLE_MAN, KIND_OF, gearOfTroop, kindsOf, troopPower, troopTotal, weightOf, type TroopStack } from '@/game/battle/kinds';
import { createInitialState } from '@/game/state';
import { defense, mountGear, recruitRate, wageOf } from '@/game/derived';
import { SOLDIER_FOOD } from '@/game/constants';
import type { EquipmentId, ResourceId, TroopId } from '@/game/types';
import { MIX, armyAt, openSky, townAt, type Inside } from './autopilot';
import { SEEDS } from './raid-lair-growth';

const pad = (v: string | number, w: number): string => String(v).padStart(w);
const padR = (v: string | number, w: number): string => String(v).padEnd(w);
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '—');
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ---------- Класс конницы ----------

export interface CavProfile {
  name: string;
  stats: UnitStats;
  counter: { archer: number; flank: number; spearClosed: number; infantry: number };
  /** Лучники по этому роду. */
  archerVs: number;
  temper: { charging: number; stalled: number; waiting: number };
  pursuit: number;
  /** Снаряжение всадника этого класса. */
  gear: Partial<Record<EquipmentId, number>>;
}

export const TODAY: CavProfile = {
  name: 'сегодня',
  stats: { ...UNIT_STATS.cavalry },
  counter: { ...COUNTER.cavalry },
  archerVs: COUNTER.archer.cavalry,
  temper: { ...TEMPER.cavalry },
  pursuit: RETREAT.pursuitKills.cavalry,
  gear: { ...TROOP_BY_ID.rider.gear },
};

/**
 * Лёгкая — всадник без доспеха. Та половина нынешнего конного рода, что держится на скорости: бьёт лучников,
 * заходит во фланг, догоняет бегущих; лучникам она быстрая цель. Удара в лоб у неё нет: рукопашная как у копий,
 * стойкость как у бездоспешных лучников, пехоту она не ломает. Снаряжение — нынешнего всадника.
 */
export const LIGHT: CavProfile = {
  name: 'лёгкая',
  stats: { melee: UNIT_STATS.spear.melee, ranged: 0, toughness: UNIT_STATS.archer.toughness, speed: UNIT_STATS.cavalry.speed, morale: UNIT_STATS.cavalry.morale },
  counter: { archer: COUNTER.cavalry.archer, flank: COUNTER.cavalry.flank, spearClosed: COUNTER.cavalry.spearClosed, infantry: COUNTER.infantry.all },
  archerVs: COUNTER.archer.cavalry,
  temper: { ...TEMPER.cavalry },
  pursuit: RETREAT.pursuitKills.cavalry,
  gear: { ...TROOP_BY_ID.rider.gear },
};

/**
 * Тяжёлая — всадник в доспехе. Та половина, что держится на весе: ломает несомкнутый строй, в рукопашной и
 * стойкости как нынешний всадник, остановленная стоит как пехота. Манёвра у неё нет: лучников и фланг бьёт как
 * пеший обход, бегущих догоняет как пехота, лучникам она доспех (×0.8, как пехота), а не быстрая цель.
 * Снаряжение — нынешнего всадника и доспех; ступень от этого та, что считает `gearOfTroop`.
 */
export const HEAVY: CavProfile = {
  name: 'тяжёлая',
  stats: { melee: UNIT_STATS.cavalry.melee, ranged: 0, toughness: UNIT_STATS.cavalry.toughness, speed: UNIT_STATS.infantry.speed, morale: UNIT_STATS.cavalry.morale },
  counter: { archer: COUNTER.infantry.all, flank: FOOT_FLANK, spearClosed: COUNTER.cavalry.spearClosed, infantry: COUNTER.cavalry.infantry },
  archerVs: COUNTER.archer.infantry,
  temper: { charging: TEMPER.cavalry.charging, stalled: TEMPER.infantry.all, waiting: TEMPER.cavalry.waiting },
  pursuit: RETREAT.pursuitKills.infantry,
  gear: { ...TROOP_BY_ID.rider.gear, armor: 1 },
};

const PROFILES = [TODAY, LIGHT, HEAVY];

// Конфиг типизирован `as const`, но это объекты: на время замера их поля переписываются и возвращаются.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mutable = (o: unknown): any => o;

function apply(p: CavProfile): void {
  Object.assign(UNIT_STATS.cavalry, p.stats);
  Object.assign(mutable(COUNTER.cavalry), p.counter);
  mutable(COUNTER.archer).cavalry = p.archerVs;
  Object.assign(TEMPER.cavalry, p.temper);
  RETREAT.pursuitKills.cavalry = p.pursuit;
  mutable(TROOP_BY_ID.rider).gear = { ...p.gear };
}

export function withCavalry<T>(p: CavProfile, fn: () => T): T {
  apply(p);
  try {
    return fn();
  } finally {
    apply(TODAY);
  }
}

async function withCavalryAsync<T>(p: CavProfile, fn: () => Promise<T>): Promise<T> {
  apply(p);
  try {
    return await fn();
  } finally {
    apply(TODAY);
  }
}

/** Приказ коннице поверх пресета: `null` — как выбрал пресет. */
interface Order {
  name: string;
  cavalry: CavalryOrder | null;
  /** Конница из резерва — во фронт, 30/40/30. */
  front?: boolean;
}
const PRESET: Order = { name: 'пресет', cavalry: null };
const AT_ARCHERS: Order = { name: 'по лучникам', cavalry: 'attack-archers' };
const FRONT_LINE: Order = { name: 'во фронт', cavalry: 'charge', front: true };

function ordered(setup: ArmySetup, o: Order): ArmySetup {
  if (!o.cavalry) return setup;
  const out: ArmySetup = { ...setup, sectors: { ...setup.sectors }, orders: { ...setup.orders, cavalry: o.cavalry } };
  if (o.front) {
    const c = out.sectors.R.cavalry;
    const a = Math.round(c * 0.3);
    const b = Math.round(c * 0.4);
    out.sectors.R = { ...out.sectors.R, cavalry: 0 };
    out.sectors.A = { ...out.sectors.A, cavalry: out.sectors.A.cavalry + a };
    out.sectors.B = { ...out.sectors.B, cavalry: out.sectors.B.cavalry + b };
    out.sectors.C = { ...out.sectors.C, cavalry: out.sectors.C.cavalry + c - a - b };
  }
  return out;
}

// ---------- Общее ----------

/** Бойцов строя на сторону в ядре: равная мощь — это равное число бойцов строя. */
const MEN = 600;
const salt = (seed: number, n: number): number => Math.imul(seed ^ n, 0x9e3779b1) >>> 0;
const STYLES = Object.keys(GARRISON_STYLES) as GarrisonStyle[];
const LAIR_SEEDS = 40;
const SHARES = Array.from({ length: 39 }, (_, i) => 0.2 + i * 0.1);

/** Сила противника в долях своей мощи, при которой проигрываем половину боёв (линейно между ступенями). */
function halfPoint(loss: (k: number) => number, shares = SHARES): number {
  let prevK = shares[0];
  let prev = loss(prevK);
  if (prev >= 0.5) return prevK;
  for (let i = 1; i < shares.length; i++) {
    const k = shares[i];
    const r = loss(k);
    if (r >= 0.5) return prevK + ((0.5 - prev) / Math.max(1e-9, r - prev)) * (k - prevK);
    prevK = k;
    prev = r;
  }
  return Infinity;
}

/** Имя отряда с этим укладом: уклад и построение выводит сама игра из сида и имени. */
const idCache = new Map<string, string>();
function idOf(style: GarrisonStyle, seed: number, i: number, kind: 'raid' | 'lair'): string {
  const key = `${style}:${seed}:${i}:${kind}`;
  const hit = idCache.get(key);
  if (hit) return hit;
  for (let j = 0; ; j++) {
    const id = `bench${i}-${j}`;
    const got = kind === 'raid' ? raidingParty(seed, id, 100).style : garrisonOf(seed, id, 100).style;
    if (got === style) {
      idCache.set(key, id);
      return id;
    }
  }
}

interface Side {
  stack: Stack;
  gear: Partial<Record<UnitKind, number>>;
}

/**
 * Доля боёв, проигранных стороной `own` против логова силой `k` × своей мощи: `defend` — набег прорвал,
 * `attack` — удар по гарнизону не удался. `style` null — уклад, какой выпал отряду по имени.
 */
function lairLoss(own: Side, style: GarrisonStyle | null, k: number, mode: 'defend' | 'attack', o: Order): number {
  let lost = 0;
  const power = stackMen(own.stack) * BATTLE_MAN;
  for (let i = 1; i <= LAIR_SEEDS; i++) {
    const seed = i * 7919;
    const setup = (n: number): ArmySetup | null => (o.cavalry ? ordered(quickAttack(own.stack, salt(seed, n)).setup, o) : null);
    if (mode === 'defend') {
      const p = raidingParty(seed, style ? idOf(style, seed, i, 'raid') : `bench${i}`, k * power);
      if (resolveField({ seed, attacker: { kinds: p.kinds, gear: p.gear, setup: p.setup }, defender: { kinds: own.stack, gear: own.gear, setup: setup(2) } }).won) lost++;
    } else {
      const g = garrisonOf(seed, style ? idOf(style, seed, i, 'lair') : `bench${i}`, k * power);
      if (!resolveField({ seed, attacker: { kinds: own.stack, gear: own.gear, setup: setup(1) }, defender: { kinds: g.kinds, gear: g.gear, setup: g.setup } }).won) lost++;
    }
  }
  return lost / LAIR_SEEDS;
}

const stackMen = (s: Stack): number => s.spear + s.infantry + s.archer + s.cavalry;

/** Армия из одного вида: `MEN` бойцов строя, ступень вида. */
const pureOf = (id: TroopId): Side => ({ stack: { ...emptyStack(), [KIND_OF[id]]: MEN }, gear: { [KIND_OF[id]]: gearOfTroop(id) } });

// ---------- 1. Виды сегодня ----------

const goodsOf = (id: TroopId): Partial<Record<ResourceId, number>> => {
  const t = TROOP_BY_ID[id];
  const out: Partial<Record<ResourceId, number>> = { ...t.cost };
  for (const [item, n] of Object.entries(t.gear) as [EquipmentId, number][]) {
    for (const [r, v] of Object.entries(EQUIPMENT_BY_ID[item].cost) as [ResourceId, number][]) out[r] = (out[r] ?? 0) + v * n;
  }
  return out;
};
const goodsTotal = (id: TroopId): number => (Object.values(goodsOf(id)) as number[]).reduce((a, b) => a + b, 0);
const forgeOf = (id: TroopId): number =>
  (Object.entries(TROOP_BY_ID[id].gear) as [EquipmentId, number][]).reduce((n, [item, k]) => n + EQUIPMENT_BY_ID[item].work * k, 0);

/** Цена на бойца строя: добро найма со снаряжением, кузница, казармы, жалованье и паёк за игровой день. */
interface Price {
  goods: number;
  forge: number;
  work: number;
  wage: number;
  food: number;
}
function priceOf(id: TroopId): Price {
  const w = weightOf(id);
  const s = createInitialState(7);
  return { goods: goodsTotal(id) / w, forge: forgeOf(id) / w, work: TROOP_BY_ID[id].work / w, wage: wageOf(s, id) / w, food: SOLDIER_FOOD / w };
}

function typesPart(): void {
  console.log('');
  console.log('--- 1. Виды сегодня: что у каждого есть ---');
  console.log('«строя» — бойцов строя на голову (kinds.weightOf = мощь / BATTLE_MAN): столькими людьми вид выходит в бой. «ступень» — kinds.gearOfTroop;');
  console.log('«мораль» — стартовая мораль рода + ступень × GEAR.moralePerLevel, без плана, обряда и конюшни. Дальше — на бойца строя: добро найма');
  console.log('со снаряжением (ресурсы вида и предметов кузницы), работа кузницы и казарм, жалованье (derived.wageOf, деревня без веры) и паёк');
  console.log('(SOLDIER_FOOD) за игровой день; голов на 100 бойцов строя.');
  console.log(' вид          род        строя  ступень  мораль  добро найма на бойца строя                          всего  кузница  казармы  жалованье  паёк  голов/100');
  for (const t of TROOPS) {
    const w = weightOf(t.id);
    const gear = gearOfTroop(t.id);
    const kind = KIND_OF[t.id];
    const list = (Object.entries(goodsOf(t.id)) as [ResourceId, number][]).map(([r, v]) => `${r} ${(v / w).toFixed(1)}`).join(', ');
    const p = priceOf(t.id);
    console.log(
      ` ${padR(t.name, 11)}  ${padR(kind, 9)}  ${pad(w, 5)}  ${pad(gear, 7)}  ${pad(UNIT_STATS[kind].morale + gear * GEAR.moralePerLevel, 6)}  ${padR(list, 50)}  ${pad(p.goods.toFixed(1), 5)}  ${pad(p.forge.toFixed(0), 7)}  ${pad(p.work.toFixed(1), 7)}  ${pad(p.wage.toFixed(2), 9)}  ${pad(p.food.toFixed(2), 4)}  ${pad((100 / w).toFixed(0), 9)}`,
    );
  }
  const profiles = new Map<string, string[]>();
  for (const t of TROOPS) {
    const key = `${KIND_OF[t.id]}, ступень ${gearOfTroop(t.id)}`;
    profiles.set(key, [...(profiles.get(key) ?? []), t.name]);
  }
  console.log(`Что ядро боя знает о бойце строя — род и ступень. Различимых сочетаний: ${profiles.size} на ${TROOPS.length} видов, родов ${new Set(TROOPS.map((t) => KIND_OF[t.id])).size}:`);
  for (const [key, names] of profiles) console.log(`  ${key}: ${names.join(', ')}`);
}

// ---------- 2. Вид против вида ----------

const DUEL_SEEDS = 20;

/** Размен a против b (потери b к потерям a), быстрая атака у обеих, обе стороны поля. */
function duel(a: Side, b: Side, oa: Order = PRESET): number {
  let la = 0;
  let lb = 0;
  const setup = (s: Side, seed: number, n: number, o: Order): ArmySetup => ({ ...ordered(quickAttack(s.stack, salt(seed, n)).setup, o), gear: s.gear });
  for (let seed = 1; seed <= DUEL_SEEDS; seed++) {
    const r1 = simulateBattle({ seed, attacker: setup(a, seed, 1, oa), defender: setup(b, seed, 2, PRESET) });
    const r2 = simulateBattle({ seed, attacker: setup(b, seed, 1, PRESET), defender: setup(a, seed, 2, oa) });
    la += r1.sides.attacker.total.losses + r2.sides.defender.total.losses;
    lb += r1.sides.defender.total.losses + r2.sides.attacker.total.losses;
  }
  return lb / Math.max(1, la);
}

function duelPart(): void {
  console.log('');
  console.log(`--- 2. Вид против вида при равной мощи: ядро, ${MEN} бойцов строя на сторону, быстрая атака у обеих, ${DUEL_SEEDS} сидов × обе стороны поля ---`);
  console.log('Ячейка — размен строки против столбца: потери столбца к потерям строки; больше 1 — строка выгоднее. Конюшня не учтена.');
  console.log(` ${padR('', 11)}${TROOPS.map((t) => pad(t.name.slice(0, 9), 10)).join('')}`);
  for (const a of TROOPS) {
    console.log(` ${padR(a.name, 11)}${TROOPS.map((b) => pad(a === b ? '—' : f2(duel(pureOf(a.id), pureOf(b.id))), 10)).join('')}`);
  }
}

// ---------- 3. Кольцо в игре ----------

function styleTable(rows: { name: string; side: Side; order: Order }[]): void {
  console.log(` ${padR('', 34)}${STYLES.map((s) => pad(GARRISON_STYLES[s].name.slice(0, 13), 14)).join('')}${pad('среднее', 9)}${pad('разброс', 9)}`);
  for (const mode of ['defend', 'attack'] as const) {
    for (const r of rows) {
      const hs = STYLES.map((s) => halfPoint((k) => lairLoss(r.side, s, k, mode, r.order)));
      const avg = hs.reduce((a, x) => a + x, 0) / hs.length;
      console.log(` ${padR(`${mode === 'defend' ? 'оборона' : 'удар'}: ${r.name}`, 34)}${hs.map((h) => pad(f2(h), 14)).join('')}${pad(f2(avg), 9)}${pad(f2(Math.max(...hs) / Math.min(...hs)), 9)}`);
    }
  }
}

function ringPart(): void {
  console.log('');
  console.log(`--- 3. Кольцо в игре: вид против логова, ${MEN} бойцов строя, ${LAIR_SEEDS} боёв на силу логова, быстрая атака у обеих ---`);
  console.log('«оборона» — набег (garrison.raidingParty) на армию из одного вида без стены и ополчения; «удар» — армия по гарнизону логова (garrisonOf).');
  console.log('Ячейка — сила логова в долях своей мощи, при которой проигрываем половину боёв; больше — сильнее. Столбцы — уклад логова.');
  console.log('«разброс» — лучший уклад к худшему: во сколько раз вид сильнее против удобного логова, чем против неудобного.');
  styleTable(TROOPS.map((t) => ({ name: t.name, side: pureOf(t.id), order: PRESET })));
}

// ---------- 4. Бой у стены ----------

const WALL_SEEDS = 80;
const WALL_SHARES = Array.from({ length: 30 }, (_, i) => 0.2 + i * 0.1);

interface WallRow {
  heads: number;
  power: number;
  defense: number;
  militia: number;
  half: number;
  raid: number;
  broke: number;
}

/** Бой у стены посёлка мерки 10-го уровня с войском `troops`; `order` — приказ коннице в расстановке обороны. */
async function wallRow(troops: TroopStack, order: Order, over: Record<string, number> = {}): Promise<WallRow> {
  const g = townAt(10, over);
  for (const id of TROOP_IDS) g.army[id] = Math.max(0, troops[id] ?? 0);
  const sky = openSky(g, { seed: SEEDS[0], pulse: 30, raids: true });
  await sky.pulse();
  const w: Inside = sky.world;
  const at = sky.now();
  const d = defense(g);
  const broke = (power: number): number => {
    let n = 0;
    for (let i = 1; i <= WALL_SEEDS; i++) {
      const seed = i * 7919;
      if (order.cavalry) {
        // Расстановка обороны — тот же пресет, что выбрал бы бой (resolveField), с приказом коннице поверх.
        const militia = w.save.profile.militia as number;
        const archers = Math.min(militia, w.save.profile.militiaArchers as number);
        const kinds = kindsOf(w.defenders(at).all);
        kinds.infantry += militia - archers;
        kinds.archer += archers;
        w.save.profile.defenseSetup = ordered(quickAttack(kinds, salt(seed, 2)).setup, order);
      }
      if (w.wallField({ id: `bench${i}`, seed, power }, at).field.won) n++;
    }
    return n / WALL_SEEDS;
  };
  const half = halfPoint((k) => broke(k * d), WALL_SHARES) * d;
  const raid = lairRaid(lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, g.pop), g.pop);
  return { heads: troopTotal(troops), power: troopPower(troops), defense: d, militia: militiaMen(g), half, raid, broke: broke(raid) };
}

const wallLine = (name: string, r: WallRow): string =>
  ` ${padR(name, 36)}  ${pad(r.heads, 5)}  ${pad(r.power, 4)}  ${pad(Math.round(r.defense), 6)}  ${pad(r.militia, 9)}  ${pad(Number.isFinite(r.half) ? Math.round(r.half) : '—', 7)}  ${pad(f2(r.half / r.defense), 8)}  ${pad(Math.round(r.raid), 12)}  ${pad(pct(r.broke), 8)}`;
const WALL_HEAD = ' войско                                голов  мощь  защита  ополчение  полпути  к защите  набег логова  прорывов';

/** Войско мерки 10-го уровня: его мощь — мерка равной мощи для остальных армий. */
const MIX_POWER = (): number => troopPower(townAt(10).army as TroopStack);

/** Армия той же мощи из одного вида. */
const pureTroops = (id: TroopId, power: number): TroopStack => ({ [id]: Math.round(power / TROOP_BY_ID[id].power) });

/** Пеший остаток мерки, у которого конница — доля `share` мощи. `share` 0 — мерка без конницы, мощь та же. */
function mixCav(share: number, power: number): TroopStack {
  const mix = townAt(10).army as TroopStack;
  const foot = (Object.keys(mix) as TroopId[]).filter((id) => KIND_OF[id] !== 'cavalry');
  const footPower = foot.reduce((n, id) => n + (mix[id] ?? 0) * TROOP_BY_ID[id].power, 0);
  const out: TroopStack = {};
  for (const id of foot) out[id] = Math.round(((mix[id] ?? 0) * power * (1 - share)) / footPower);
  if (share > 0) out.rider = Math.round((power * share) / TROOP_BY_ID.rider.power);
  return out;
}

/** Полпути стены у армий из одного вида: мера силы на единицу мощи в игре. */
type Worth = Record<string, number>;

async function wallPart(): Promise<Worth> {
  console.log('');
  console.log(`--- 4. Бой у стены: LocalWorld.wallField, посёлок мерки 10-го уровня, мир ${SEEDS[0]}, ${WALL_SEEDS} боёв на силу набега ---`);
  console.log('Войско мерки (autopilot.townAt) заменено армией той же мощи; стена, башня, ополчение и конюшня 10-го уровня — как в игре, оборона — быстрая атака.');
  console.log('«защита» — derived.defense (то, что игрок видит в «Защите посёлка»); «полпути» — сила набега, при которой прорывается половина боёв,');
  console.log('и она же в долях защиты; «набег логова» — дозревшее логово медианной опоры при жителях посёлка (lairs.lairRaid) и прорывов при нём.');
  console.log(WALL_HEAD);
  const power = MIX_POWER();
  const worth: Worth = {};
  console.log(wallLine('мерка MIX', await wallRow(townAt(10).army as TroopStack, PRESET)));
  console.log(wallLine('мерка без всадников (мощь та же)', await wallRow(mixCav(0, power), PRESET)));
  for (const t of TROOPS) {
    const r = await wallRow(pureTroops(t.id, power), PRESET);
    worth[t.id] = r.half / r.defense;
    console.log(wallLine(t.name, r));
  }
  return worth;
}

// ---------- 5. Армия без линии в обходе ----------

/** Армия раздела 5: конница на полосах фронта с приказом `order`, при `line` — и пехота долей `line` в тех же секторах. */
function holeSetup(line: number, order: CavalryOrder, seed: number, n: number): { stack: Stack; setup: ArmySetup } {
  const cav = Math.round(MEN * (1 - line));
  const inf = MEN - cav;
  const pure = quickAttack({ ...emptyStack(), cavalry: cav }, salt(seed, n)).setup;
  const sectors = { ...pure.sectors };
  const per = [Math.round(inf / 3), Math.round(inf / 3), inf - 2 * Math.round(inf / 3)];
  (['A', 'B', 'C'] as const).forEach((id, i) => (sectors[id] = { ...sectors[id], infantry: sectors[id].infantry + per[i] }));
  return { stack: { ...emptyStack(), cavalry: cav, infantry: inf }, setup: { ...pure, sectors, orders: { ...pure.orders, cavalry: order } } };
}

export function holePart(): void {
  console.log('');
  console.log(`--- 5. Армия без линии в обходе: ядро, ${MEN} бойцов строя (конница сегодня, ступень 2), ${LAIR_SEEDS} боёв, уклад логова — по имени отряда ---`);
  console.log('Конница стоит на полосах фронта (пресет армии из одной конницы); «линия 10 %» — в тех же секторах ещё пехота долей строя. Меняется только');
  console.log('приказ коннице. «удар» — по гарнизону логова силой k × своей мощи: побед, ничьих, потери свои и логова; «оборона» — набег силой k: прорывов.');
  console.log(' армия        приказ               k  удар: побед  ничьих  свои  логова   оборона: прорывов');
  const orders: [string, CavalryOrder][] = [
    ['атаковать сразу', 'charge'],
    ['обход', 'flank'],
    ['по лучникам', 'attack-archers'],
    ['преследовать', 'pursue'],
    ['в резерв', 'reserve'],
  ];
  for (const line of [0, 0.1]) {
    for (const [name, order] of orders) {
      for (const k of [1, 2, 4, 8]) {
        let won = 0;
        let draws = 0;
        let lossOwn = 0;
        let lossLair = 0;
        let broke = 0;
        for (let i = 1; i <= LAIR_SEEDS; i++) {
          const seed = i * 7919;
          const atk = holeSetup(line, order, seed, 1);
          const g = garrisonOf(seed, `bench${i}`, k * MEN * BATTLE_MAN);
          const f = resolveField({ seed, attacker: { kinds: atk.stack, gear: { cavalry: gearOfTroop('rider') }, setup: atk.setup }, defender: { kinds: g.kinds, gear: g.gear, setup: g.setup } });
          if (f.won) won++;
          if (f.result?.winner === 'draw') draws++;
          lossOwn += f.attackerLoss;
          lossLair += f.defenderLoss;
          const def = holeSetup(line, order, seed, 2);
          const p = raidingParty(seed, `bench${i}`, k * MEN * BATTLE_MAN);
          if (resolveField({ seed, attacker: { kinds: p.kinds, gear: p.gear, setup: p.setup }, defender: { kinds: def.stack, gear: { cavalry: gearOfTroop('rider') }, setup: def.setup } }).won) broke++;
        }
        console.log(
          ` ${padR(line > 0 ? `линия ${pct(line)}` : 'без линии', 11)}  ${padR(name, 17)}  ${pad(k, 2)}  ${pad(`${won}/${LAIR_SEEDS}`, 11)}  ${pad(draws, 6)}  ${pad(pct(lossOwn / LAIR_SEEDS), 4)}  ${pad(pct(lossLair / LAIR_SEEDS), 6)}   ${pad(pct(broke / LAIR_SEEDS), 17)}`,
        );
      }
    }
  }
}

// ---------- 6. Классы конницы ----------

/** Пеший остаток мерки MIX в родах боя и конница долей `share` бойцов строя; ступени — видов мерки. */
function mixSide(share: number): Side {
  const foot: [UnitKind, number][] = [];
  let whole = 0;
  const gear: Partial<Record<UnitKind, number>> = {};
  for (const id of Object.keys(MIX) as TroopId[]) {
    gear[KIND_OF[id]] = gearOfTroop(id);
    if (KIND_OF[id] === 'cavalry') continue;
    const n = (MIX[id] ?? 0) * weightOf(id);
    foot.push([KIND_OF[id], n]);
    whole += n;
  }
  const stack = emptyStack();
  const cav = Math.round(MEN * share);
  stack.cavalry = cav;
  for (const [k, n] of foot) stack[k] += Math.round(((MEN - cav) * n) / whole);
  return { stack, gear };
}

const CAV_SHARE = 0.3;
const CAV_SHARES = [0, 0.1, 0.2, 0.3, 0.45, 0.6];
/** Сколько добавляет одно решение: разрыв настроенной армии и быстрой атаки (docs/BATTLE_SYSTEM_FOR_CLAUDE.md, раздел 1). */
const ONE_DECISION = 0.15;

function rulePart(): void {
  console.log('');
  console.log('--- 6. Классы конницы: подстановка класса ---');
  console.log('Правило: класс — это доспех на всаднике. Без доспеха — та половина нынешнего конного рода, что держится на скорости; в доспехе —');
  console.log('та, что держится на весе. Числа каждой половины взяты из конфига боя как есть:');
  for (const p of PROFILES) {
    console.log(
      `  ${padR(p.name, 8)} рукопашная ${p.stats.melee}, стойкость ${p.stats.toughness}, скорость ${p.stats.speed}; по лучникам ×${p.counter.archer}, во фланг ×${p.counter.flank}, по сомкнутым копьям ×${p.counter.spearClosed}, по пехоте ×${p.counter.infantry}; лучники по ней ×${p.archerVs}; остановленная ×${p.temper.stalled}; преследование ${p.pursuit}; снаряжение ${Object.keys(p.gear).join('+')}, ступень ${withCavalry(p, () => gearOfTroop('rider'))}`,
    );
  }
  console.log('Удар с разбега (CLASH_CAVALRY_IMPACT ×1.5) не подставляется и остаётся у всех трёх. Конница логова в подстановке — того же класса.');
}

function classRingPart(): void {
  console.log('');
  console.log(`--- 6.1. Кольцо при правильных приказах: ядро, размен первой армии, ${DUEL_SEEDS} сидов × обе стороны поля ---`);
  const pairs: { name: string; a: () => ArmySetup; b: () => ArmySetup }[] = [
    { name: 'копья (держать линию) против конницы', a: () => quickSetup({ spear: MEN }, { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'charge' } }), b: () => quickSetup({ cavalry: MEN }) },
    { name: 'конница (по лучникам) против лучников', a: () => quickSetup({ cavalry: MEN }, { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'attack-archers' } }), b: () => quickSetup({ archer: MEN }) },
    { name: 'конница (сразу) против пехоты', a: () => quickSetup({ cavalry: MEN }), b: () => quickSetup({ infantry: MEN }) },
    { name: 'пехота + треть конницы (сразу) против пехоты', a: () => quickSetup({ cavalry: MEN / 3, infantry: (2 * MEN) / 3 }), b: () => quickSetup({ infantry: MEN }) },
    { name: 'пехота + треть конницы (обход) против пехоты', a: () => quickSetup({ cavalry: MEN / 3, infantry: (2 * MEN) / 3 }, { plan: 'cavalry-strike', orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'flank' } }), b: () => quickSetup({ infantry: MEN }) },
  ];
  console.log(` ${padR('', 46)}${PROFILES.map((p) => pad(p.name, 10)).join('')}`);
  for (const pair of pairs) {
    const row = PROFILES.map((p) =>
      withCavalry(p, () => {
        let ratio = 0;
        for (let seed = 1; seed <= DUEL_SEEDS; seed++) ratio += mirrored(pair.a(), pair.b(), seed).lossRatio;
        return f2(ratio / DUEL_SEEDS);
      }),
    );
    console.log(` ${padR(pair.name, 46)}${row.map((x) => pad(x, 10)).join('')}`);
  }
  console.log('');
  console.log('Всадник против вида при равной мощи (раздел 2), быстрая атака у обеих:');
  const foes: TroopId[] = ['clubman', 'spearman', 'archer', 'legionary'];
  console.log(` ${padR('класс', 10)}${foes.map((id) => pad(TROOP_BY_ID[id].name, 11)).join('')}`);
  for (const p of PROFILES) {
    const row = withCavalry(p, () => foes.map((id) => f2(duel(pureOf('rider'), pureOf(id)))));
    console.log(` ${padR(p.name, 10)}${row.map((x) => pad(x, 11)).join('')}`);
  }
}

function orderPart(): void {
  console.log('');
  console.log(`--- 6.2. Чувствительность к приказу: ядро, войско мерки с конницей ${pct(CAV_SHARE)} бойцов строя, ${LAIR_SEEDS} боёв на силу логова ---`);
  console.log('Пеший остаток — по составу мерки MIX. Приказ коннице поверх пресета быстрой атаки: «пресет» — как выбрал пресет, «по лучникам» — атаковать');
  console.log('лучников из резерва, «во фронт» — из резерва в сектора фронта и атаковать сразу. Ячейка — как в разделе 3.');
  for (const p of PROFILES) {
    console.log(`${p.name}:`);
    withCavalry(p, () => styleTable([PRESET, AT_ARCHERS, FRONT_LINE].map((o) => ({ name: o.name, side: mixSide(CAV_SHARE), order: o }))));
  }
}

interface ShareRow {
  name: string;
  profile: CavProfile;
  order: Order;
  defend: number[];
  attack: number[];
}

function sharePart(): ShareRow[] {
  console.log('');
  console.log(`--- 6.3. Доля конницы в войске: ядро, пеший остаток — по составу мерки MIX, ${LAIR_SEEDS} боёв на силу логова, уклад — по имени отряда ---`);
  console.log('Ячейка — как в разделе 3; «прибавка» — к той же армии без конницы (столбец 0 %), в котором конница логова того же класса.');
  console.log(` ${padR('класс и приказ', 30)}${CAV_SHARES.map((s) => pad(pct(s), 7)).join('')}   прибавка при ${CAV_SHARES.slice(1).map(pct).join(' / ')}`);
  const rows: ShareRow[] = [];
  for (const [profile, order] of [
    [TODAY, PRESET],
    [TODAY, AT_ARCHERS],
    [LIGHT, PRESET],
    [LIGHT, AT_ARCHERS],
    [HEAVY, PRESET],
    [HEAVY, AT_ARCHERS],
  ] as [CavProfile, Order][]) {
    const row: ShareRow = { name: `${profile.name}, ${order.name}`, profile, order, defend: [], attack: [] };
    for (const mode of ['defend', 'attack'] as const) {
      const hs = withCavalry(profile, () => CAV_SHARES.map((s) => halfPoint((k) => lairLoss(mixSide(s), null, k, mode, order))));
      row[mode] = hs;
      console.log(` ${padR(`${row.name}: ${mode === 'defend' ? 'оборона' : 'удар'}`, 30)}${hs.map((h) => pad(f2(h), 7)).join('')}   ${hs.slice(1).map((h) => `${h >= hs[0] ? '+' : '−'}${Math.abs(Math.round((h / hs[0] - 1) * 100))}%`).join(' / ')}`);
    }
    rows.push(row);
  }
  return rows;
}

interface ClassWall {
  profile: CavProfile;
  pure: WallRow;
  worth: number;
}

async function classWallPart(): Promise<ClassWall[]> {
  console.log('');
  console.log(`--- 6.4. Классы у стены: LocalWorld.wallField, посёлок мерки 10-го уровня, конюшня 3-го уровня (ступени от конюшни нет), ${WALL_SEEDS} боёв ---`);
  console.log(`«конница ${pct(CAV_SHARE)}» — пеший остаток мерки и всадники долей мощи; «по лучникам» — в расстановке обороны пресет боя и приказ коннице поверх.`);
  console.log('Мощь армий — мерки MIX; мощь всадника у обоих классов нынешняя. Столбцы — как в разделе 4.');
  console.log(WALL_HEAD);
  const power = MIX_POWER();
  const over = { stable: 3 };
  const base = await wallRow(pureTroops('clubman', power), PRESET, over);
  console.log(wallLine('Дубинщики (мера)', base));
  console.log(wallLine(`без конницы`, await wallRow(mixCav(0, power), PRESET, over)));
  const out: ClassWall[] = [];
  for (const p of PROFILES) {
    const pure = await withCavalryAsync(p, () => wallRow(pureTroops('rider', power), PRESET, over));
    console.log(wallLine(`${p.name}: одни всадники`, pure));
    console.log(wallLine(`${p.name}: конница ${pct(CAV_SHARE)}, пресет`, await withCavalryAsync(p, () => wallRow(mixCav(CAV_SHARE, power), PRESET, over))));
    console.log(wallLine(`${p.name}: конница ${pct(CAV_SHARE)}, по лучникам`, await withCavalryAsync(p, () => wallRow(mixCav(CAV_SHARE, power), AT_ARCHERS, over))));
    out.push({ profile: p, pure, worth: pure.half / pure.defense / (base.half / base.defense) });
  }
  return out;
}

// ---------- 7. Числа ----------

function numbersPart(worth: Worth, walls: ClassWall[], shares: ShareRow[]): void {
  console.log('');
  console.log('--- 7. Числа: цена силы сегодня и что из неё выводится ---');
  console.log('«сила» — полпути стены на единицу мощи у армии из одного вида (раздел 4), дубинщики — единица. «на силу» — цена бойца строя (раздел 1),');
  console.log('делённая на силу. Медиана — по восьми видам: столько игра сегодня берёт за единицу силы.');
  console.log(' вид          сила  добро/силу  кузница/силу  казармы/силу  жалованье/силу  паёк/силу');
  const club = worth.clubman;
  const per: Record<keyof Price, number[]> = { goods: [], forge: [], work: [], wage: [], food: [] };
  for (const t of TROOPS) {
    const w = worth[t.id] / club;
    const p = priceOf(t.id);
    for (const k of Object.keys(per) as (keyof Price)[]) per[k].push(p[k] / w);
    console.log(` ${padR(t.name, 11)}  ${pad(f2(w), 4)}  ${pad((p.goods / w).toFixed(1), 10)}  ${pad((p.forge / w).toFixed(0), 12)}  ${pad((p.work / w).toFixed(1), 12)}  ${pad((p.wage / w).toFixed(2), 14)}  ${pad((p.food / w).toFixed(2), 9)}`);
  }
  const med = Object.fromEntries((Object.keys(per) as (keyof Price)[]).map((k) => [k, median(per[k])])) as unknown as Price;
  console.log(` ${padR('медиана', 11)}  ${pad('', 4)}  ${pad(med.goods.toFixed(1), 10)}  ${pad(med.forge.toFixed(0), 12)}  ${pad(med.work.toFixed(1), 12)}  ${pad(med.wage.toFixed(2), 14)}  ${pad(med.food.toFixed(2), 9)}`);

  console.log('');
  console.log('Цена класса — медиана «на силу», умноженная на силу класса (раздел 6.4, одни всадники, конюшня без ступени): добро найма, работа казарм и');
  console.log('жалованье — на голову (× строя всадника). «из них предметы» — добро снаряжения класса по data/equipment (его не назначают), «сам вид» — остаток;');
  console.log('кузница — работа тех же предметов. Паёк — конь тоже рот: 2 × SOLDIER_FOOD на голову. Справа — нынешний всадник.');
  console.log(' класс      сила  строя  добро найма  из них предметы  сам вид  кузница  казармы  жалованье/день  паёк/день');
  const w7 = weightOf('rider');
  const today = priceOf('rider');
  const gearGoods = (): number => goodsTotal('rider') - (Object.values(TROOP_BY_ID.rider.cost) as number[]).reduce((a, b) => a + b, 0);
  for (const c of walls) {
    const w = c.worth;
    const [forge, items] = withCavalry(c.profile, () => [forgeOf('rider'), gearGoods()]);
    const goods = Math.round(med.goods * w * w7);
    console.log(
      ` ${padR(c.profile.name, 9)}  ${pad(f2(w), 4)}  ${pad(w7, 5)}  ${pad(goods, 11)}  ${pad(items, 15)}  ${pad(goods - items, 7)}  ${pad(forge, 7)}  ${pad(Math.round(med.work * w * w7), 7)}  ${pad((med.wage * w * w7).toFixed(2), 14)}  ${pad((2 * SOLDIER_FOOD).toFixed(1), 9)}`,
    );
  }
  console.log(
    ` ${padR('всадник', 9)}  ${pad('', 4)}  ${pad(w7, 5)}  ${pad(goodsTotal('rider'), 11)}  ${pad(gearGoods(), 15)}  ${pad(goodsTotal('rider') - gearGoods(), 7)}  ${pad(forgeOf('rider'), 7)}  ${pad(TROOP_BY_ID.rider.work, 7)}  ${pad((today.wage * w7).toFixed(2), 14)}  ${pad(SOLDIER_FOOD.toFixed(1), 9)}   (data/troops.ts сегодня)`,
  );

  console.log('');
  console.log(`Места: доля конницы, на которой её прибавка к войску без конницы достигает одного решения (${pct(ONE_DECISION)}, разрыв настроенной армии и`);
  console.log('быстрой атаки), — по разделу 6.3, линейно между долями, меньшая из обороны и удара; не достигает до 60 % — «нет». Места уровня L — эта доля');
  console.log('бойцов строя войска мерки (autopilot.armyAt(L) голов по составу MIX), делённая на строя всадника.');
  const capOf = (hs: number[]): number => {
    for (let i = 1; i < hs.length; i++) {
      const g = hs[i] / hs[0] - 1;
      if (g >= ONE_DECISION) {
        const gp = hs[i - 1] / hs[0] - 1;
        return CAV_SHARES[i - 1] + ((ONE_DECISION - gp) / Math.max(1e-9, g - gp)) * (CAV_SHARES[i] - CAV_SHARES[i - 1]);
      }
    }
    return NaN;
  };
  const mixPower = troopPower(MIX) / troopTotal(MIX);
  const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const placesAt = (cap: number, L: number): number => Math.round((armyAt(L) * mixPower * cap) / BATTLE_MAN / w7);
  const caps = new Map<string, number>();
  for (const r of shares) {
    const d = capOf(r.defend);
    const a = capOf(r.attack);
    const cap = Math.min(Number.isFinite(d) ? d : Infinity, Number.isFinite(a) ? a : Infinity);
    caps.set(r.name, cap);
    const places = Number.isFinite(cap) ? LEVELS.map((L) => placesAt(cap, L)).join(' ') : '—';
    console.log(`  ${padR(r.name, 22)} оборона ${Number.isFinite(d) ? pct(d) : 'нет'}, удар ${Number.isFinite(a) ? pct(a) : 'нет'}; места по уровням 1…10: ${places}`);
  }

  console.log('');
  console.log('Время найма: работа казарм класса (выше) при нынешней формуле скорости (derived.recruitRate: RECRUIT_WORK × L × levelOutputMult(L) ×');
  console.log('derived.cavalryTrain) — у мерки казармы и конюшня одного уровня L, поэтому «в конюшне той же формулой» даёт те же секунды. Игровых секунд на голову;');
  console.log('«все места» — места тяжёлой при пресете (выше), нанятые подряд.');
  const heavyCap = caps.get(`${HEAVY.name}, ${PRESET.name}`) ?? NaN;
  console.log(` уровень  ${walls.map((c) => pad(c.profile.name, 9)).join('')}  ${pad('места', 6)}  ${pad('все места, тяжёлая', 19)}  ступень конюшни`);
  for (const L of LEVELS) {
    const s = townAt(L);
    const rate = recruitRate(s, 'rider');
    const cells = walls.map((c) => pad((med.work * c.worth * w7 / rate).toFixed(1), 9));
    const heavy = walls.find((c) => c.profile === HEAVY)!;
    const places = Number.isFinite(heavyCap) ? placesAt(heavyCap, L) : 0;
    console.log(` ${pad(L, 7)}  ${cells.join('')}  ${pad(places, 6)}  ${pad(((places * med.work * heavy.worth * w7) / rate).toFixed(0), 19)}  ${pad(mountGear(s), 15)}`);
  }
}

export async function stableSection(): Promise<void> {
  console.log('');
  console.log('=== Конюшня: рода войск и два класса конницы (docs/stable.md) ===');
  typesPart();
  duelPart();
  ringPart();
  const worth = await wallPart();
  holePart();
  rulePart();
  classRingPart();
  orderPart();
  const shares = sharePart();
  const walls = await classWallPart();
  numbersPart(worth, walls, shares);
}
