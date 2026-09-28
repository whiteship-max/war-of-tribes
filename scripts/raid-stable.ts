// Конюшня — отчёт `raid-stable:report` (прежде — раздел `raid:report`; docs/stable.md).
//
// Чем отличаются рода войск в бою и какое место заняли два класса конницы — лёгкая (`rider`, род `cavalry`) и
// тяжёлая (`knight`, род `heavy`). Классы живут в конфиге боя сами (правило «две половины прежнего конного
// профиля» держит `src/battle/horse.test.ts`); подстановки, которой раздел мерил их до кода, больше нет, и числа
// прежнего единого всадника остались в выводе этого отчёта на коммите 729d510 и в docs/stable.md.
//
// Разделы:
//  1. **Виды** — что у каждого вида есть: род, бойцов строя, ступень, мораль, цена и содержание на бойца строя
//     (мера боя — `kinds.menOf`).
//  2. **Вид против вида при равной мощи** — ядро, обе стороны по правилу развёртывания, как в игре.
//  3. **Кольцо в игре** — вид против логова по пяти укладам: оборона от набега и удар по гарнизону.
//  4. **Бой у стены** — `LocalWorld.wallField`, посёлок мерки 10-го уровня, армии одной мощи.
//  5. Снят с поставкой 1 боя (docs/battle_eu4.md, 14.5): «армия без линии в обходе» мерила ждущую конницу с приказами,
//     а ждущей конницы и приказов больше нет. Номера разделов прежние, чтобы вывод сравнивался с прежним.
//  6. **Классы конницы** — профиль, кольцо, доля в войске, бой у стены. Чувствительности к приказу (6.2) больше нет:
//     приказов нет, конница встаёт по правилу развёртывания — с краёв первой линии.
//  7. **Числа** — цена силы, жалованье за снаряжение (`WAGE_GEAR`) выводом, стойла и время найма.
import {
  COUNTER,
  GEAR,
  RETREAT,
  TEMPER,
  UNIT_STATS,
  deploySetup,
  emptyStack,
  simulateBattle,
  type ArmySetup,
  type Stack,
  type UnitKind,
} from '@/battle';
import { mirrored } from '@/battle/bench';
import { resolveField } from '@/world/battle';
import { GARRISON_STYLES, garrisonOf, raidingParty, type GarrisonStyle } from '@/world/garrison';
import { militiaMen } from '@/world/bridge';
import { lairPower, lairRaid } from '@/world/lairs';
import { LAIR_ANCHOR_MID, LAIR_RIPE } from '@/world/data/tuning';
import { TROOPS, TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { EQUIPMENT_BY_ID } from '@/game/data/equipment';
import { BATTLE_MAN, KIND_OF, gearOfTroop, troopPower, troopTotal, weightOf, type TroopStack } from '@/game/battle/kinds';
import { createInitialState } from '@/game/state';
import { defense, recruitRate, selfCost, stalls, wageGear, wageOf } from '@/game/derived';
import { GOOD_BY_ID } from '@/game/data/market';
import { SOLDIER_FOOD } from '@/game/constants';
import { HORSE_MOUTHS, WAGE_GEAR, WAGE_HEAD, WAGE_MAN, WAGE_MAN_UNGEARED } from '@/game/data/upkeep';
import { TAX_PER_POP } from '@/game/data/policy';
import type { EquipmentId, ResourceId, TroopId } from '@/game/types';
import { MIX, armyAt, openSky, townAt, type Inside } from './autopilot';
import { SEEDS } from './raid-common';
import { bootstrapHalves, halfBand, percentile, spread } from './lib/halfband';
import { fan, serveFan } from './lib/fan';

const pad = (v: string | number, w: number): string => String(v).padStart(w);
const padR = (v: string | number, w: number): string => String(v).padEnd(w);
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '—');
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const median = (xs: number[]): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ---------- Классы конницы ----------

/** Два класса — два вида и два рода боя. Кто из видов какой, выводит мост (`kinds.KIND_OF`) из снаряжения. */
interface HorseClass {
  name: string;
  troop: TroopId;
  kind: UnitKind;
}
const CLASSES: HorseClass[] = (['rider', 'knight'] as TroopId[]).map((troop) => ({
  name: KIND_OF[troop] === 'heavy' ? 'тяжёлая' : 'лёгкая',
  troop,
  kind: KIND_OF[troop],
}));

/**
 * Как встаёт армия. Приказов коннице больше нет (docs/battle_eu4.md, 14.5): все встают по правилу развёртывания,
 * и строка у таблиц одна. Имя строки осталось в выводе, чтобы таблицы читались как прежде.
 */
interface Order {
  name: string;
}
const RULE: Order = { name: 'правило' };

// ---------- Общее ----------

/** Бойцов строя на сторону в ядре: равная мощь — это равное число бойцов строя. */
const MEN = 600;
const STYLES = Object.keys(GARRISON_STYLES) as GarrisonStyle[];
const LAIR_SEEDS = 40;
/**
 * Боёв на точку в разделе 6.3: из него выводятся места конницы, и при сорока боях прибавка лежала целиком
 * внутри своей границы (раздел 6.3а) — то есть места выводились из шума. Число правится переменной среды,
 * чтобы перемерять границу, не трогая остальные разделы: `SHARE_FIGHTS=320 npm run raid-stable:report`.
 */
const SHARE_FIGHTS = Number(process.env.SHARE_FIGHTS ?? 160);
/** Бросков перевыборки в границе: больше — та же граница, ровнее последняя цифра. */
const BOOT_DRAWS = 400;
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
 * Расстановка своей стороны: правило развёртывания. Отдаётся явно, а не пустым `setup` — так вход боя виден целиком,
 * и по нему `curveKey` узнаёт одинаковые кривые.
 */
const ownSetup = (own: Side): ArmySetup => deploySetup(own.stack);

/**
 * Бои стороны `own` против логова силой `k` × своей мощи, по бою на сид: проигран ли — `defend`: набег прорвал,
 * `attack`: удар по гарнизону не удался. `style` null — уклад, какой выпал отряду по имени.
 */
function lairLosses(own: Side, style: GarrisonStyle | null, k: number, mode: 'defend' | 'attack', fights = LAIR_SEEDS): boolean[] {
  const out: boolean[] = [];
  const power = stackMen(own.stack) * BATTLE_MAN;
  for (let i = 1; i <= fights; i++) {
    const seed = i * 7919;
    if (mode === 'defend') {
      const p = raidingParty(seed, style ? idOf(style, seed, i, 'raid') : `bench${i}`, k * power);
      out.push(resolveField({ seed, attacker: { kinds: p.kinds, gear: p.gear }, defender: { kinds: own.stack, gear: own.gear } }).won);
    } else {
      const g = garrisonOf(seed, style ? idOf(style, seed, i, 'lair') : `bench${i}`, k * power);
      out.push(!resolveField({ seed, attacker: { kinds: own.stack, gear: own.gear }, defender: { kinds: g.kinds, gear: g.gear } }).won);
    }
  }
  return out;
}

/** Доля проигранных из `lairLosses`. */
function lairLoss(own: Side, style: GarrisonStyle | null, k: number, mode: 'defend' | 'attack'): number {
  return lairLosses(own, style, k, mode).filter(Boolean).length / LAIR_SEEDS;
}

const stackMen = (s: Stack): number => Object.values(s).reduce((n, x) => n + x, 0);

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
  const mouths = TROOP_BY_ID[id].mounted ? HORSE_MOUTHS : 1;
  return { goods: goodsTotal(id) / w, forge: forgeOf(id) / w, work: TROOP_BY_ID[id].work / w, wage: wageOf(s, id) / w, food: (SOLDIER_FOOD * mouths) / w };
}

function typesPart(): void {
  console.log('');
  console.log('--- 1. Виды: что у каждого есть ---');
  console.log('«строя» — бойцов строя на голову (kinds.weightOf = мощь / BATTLE_MAN): столькими людьми вид выходит в бой. «ступень» — kinds.gearOfTroop;');
  console.log('«мораль» — стартовая мораль рода + ступень × GEAR.moralePerLevel, без плана и обряда. Дальше — на бойца строя: добро найма');
  console.log('со снаряжением (ресурсы вида и предметов кузницы), работа кузницы и казарм, жалованье (derived.wageOf, деревня без веры) и паёк');
  console.log('(SOLDIER_FOOD на рот, у конного рта два — HORSE_MOUTHS) за игровой день; голов на 100 бойцов строя.');
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
  workPart();
}

/** Добро в золоте своим трудом (`derived.selfCost` ресурса): у ресурса без товара на рынке меры нет — `NaN`. */
const goodsGold = (id: TroopId): number =>
  (Object.entries(goodsOf(id)) as [ResourceId, number][]).reduce((n, [r, v]) => n + (GOOD_BY_ID[r] ? selfCost(GOOD_BY_ID[r]) * v : NaN), 0);

/**
 * Всё, что уходит на бойца, на голову — вход формулы веса вида (docs/battle_eu4.md, 14.35, слово владельца, п. 3): мощь вида
 * (`TroopDef.power`) задана рукой, и «2 + работа кузницы / 25» совпадает с ней у трёх видов из девяти не законом, а тем,
 * как числа ставили в первом коммите. Правильная формула выбирается на этих числах — до кода П1. Одной меры у столбцов
 * нет, и это сказано строкой: работу кузницы рынок в золото не переводит (`derived.selfCost` меряет у вещи только
 * материалы), учения идут временем здания (`recruitRate`: работа на уровень, работников у казарм и конюшни нет).
 */
function workPart(): void {
  console.log('');
  console.log('Всё, что уходит на бойца, на голову (вход формулы веса вида; docs/battle_eu4.md, 14.35, слово владельца, п. 3):');
  console.log('«мощь» — TroopDef.power, задана рукой; «2 + кузница / 25» — след ручной расстановки (кузница 50 → 4 у копейщика), а не закон;');
  console.log('«кузница» — работа горна на все вещи вида (EquipmentDef.work); «учения» — работа казарм или конюшни (TroopDef.work);');
  console.log('«добро» — ресурсы вида и вещей, штук; «добро своим трудом» — они же в золоте по цене своего труда (derived.selfCost).');
  console.log('Работу кузницы игра в золото не переводит, учения идут временем здания, а не людьми: одной меры у столбцов нет — её выбирает владелец.');
  console.log(' вид          мощь  2 + кузница/25  кузница  учения  добро  добро своим трудом  конь');
  for (const tr of TROOPS) {
    const forge = forgeOf(tr.id);
    const gold = goodsGold(tr.id);
    console.log(
      ` ${padR(tr.name, 11)}  ${pad(tr.power, 4)}  ${pad((2 + forge / 25).toFixed(2), 14)}  ${pad(forge, 7)}  ${pad(tr.work, 6)}  ${pad(goodsTotal(tr.id), 5)}  ${pad(Number.isFinite(gold) ? gold.toFixed(1) : '—', 18)}  ${pad(tr.mounted ? 'да' : '', 4)}`,
    );
  }
  const exact = TROOPS.filter((tr) => Math.abs(2 + forgeOf(tr.id) / 25 - tr.power) < 1e-9).map((tr) => tr.name);
  console.log(`«2 + кузница / 25» равна мощи у ${exact.length} видов из ${TROOPS.length}: ${exact.join(', ') || '—'}.`);
}

// ---------- 2. Вид против вида ----------

const DUEL_SEEDS = 20;

/** Размен a против b (потери b к потерям a), обе стороны по правилу развёртывания, обе стороны поля. */
function duel(a: Side, b: Side): number {
  let la = 0;
  let lb = 0;
  const setup = (s: Side): ArmySetup => ({ ...deploySetup(s.stack), gear: s.gear });
  for (let seed = 1; seed <= DUEL_SEEDS; seed++) {
    const r1 = simulateBattle({ seed, attacker: setup(a), defender: setup(b) });
    const r2 = simulateBattle({ seed, attacker: setup(b), defender: setup(a) });
    la += r1.sides.attacker.total.losses + r2.sides.defender.total.losses;
    lb += r1.sides.defender.total.losses + r2.sides.attacker.total.losses;
  }
  return lb / Math.max(1, la);
}

/** Задача веера (`lib/fan.ts`): строка раздела 2 — вид `TROOPS[i]` против каждого. */
export function duelLine(i: number): string {
  const a = TROOPS[i];
  return ` ${padR(a.name, 11)}${TROOPS.map((b) => pad(a === b ? '—' : f2(duel(pureOf(a.id), pureOf(b.id))), 10)).join('')}`;
}

async function duelPart(): Promise<void> {
  console.log('');
  console.log(`--- 2. Вид против вида при равной мощи: ядро, ${MEN} бойцов строя на сторону, правило развёртывания у обеих, ${DUEL_SEEDS} сидов × обе стороны поля ---`);
  console.log('Ячейка — размен строки против столбца: потери столбца к потерям строки; больше 1 — строка выгоднее.');
  console.log(` ${padR('', 11)}${TROOPS.map((t) => pad(t.name.slice(0, 9), 10)).join('')}`);
  for (const line of await fan(duelLine, import.meta.url, TROOPS.map((_, i) => i))) console.log(line);
}

// ---------- 3. Кольцо в игре ----------

/**
 * Строки таблицы по укладам: `ring` — раздел 3 (вид против логова). Строки выводятся из имени таблицы, чтобы
 * дочерний процесс веера собрал их сам.
 */
function styleRows(table: string): { name: string; side: Side }[] {
  if (table !== 'ring') throw new Error(`таблицы ${table} нет`);
  return TROOPS.map((t) => ({ name: t.name, side: pureOf(t.id) }));
}

/** Задача веера (`lib/fan.ts`): строка таблицы по укладам. */
export function styleLine({ table, mode, row }: { table: string; mode: 'defend' | 'attack'; row: number }): string {
  const r = styleRows(table)[row];
  const hs = STYLES.map((s) => halfPoint((k) => lairLoss(r.side, s, k, mode)));
  const avg = hs.reduce((a, x) => a + x, 0) / hs.length;
  return ` ${padR(`${mode === 'defend' ? 'оборона' : 'удар'}: ${r.name}`, 34)}${hs.map((h) => pad(f2(h), 14)).join('')}${pad(f2(avg), 9)}${pad(f2(Math.max(...hs) / Math.min(...hs)), 9)}`;
}

async function styleTable(table: string): Promise<void> {
  console.log(` ${padR('', 34)}${STYLES.map((s) => pad(GARRISON_STYLES[s].name.slice(0, 13), 14)).join('')}${pad('среднее', 9)}${pad('разброс', 9)}`);
  const rows = styleRows(table);
  const cells = (['defend', 'attack'] as const).flatMap((mode) => rows.map((_, row) => ({ table, mode, row })));
  for (const line of await fan(styleLine, import.meta.url, cells)) console.log(line);
}

async function ringPart(): Promise<void> {
  console.log('');
  console.log(`--- 3. Кольцо в игре: вид против логова, ${MEN} бойцов строя, ${LAIR_SEEDS} боёв на силу логова, правило развёртывания у обеих ---`);
  console.log('«оборона» — набег (garrison.raidingParty) на армию из одного вида без стены и ополчения; «удар» — армия по гарнизону логова (garrisonOf).');
  console.log('Ячейка — сила логова в долях своей мощи, при которой проигрываем половину боёв; больше — сильнее. Столбцы — уклад логова.');
  console.log('«разброс» — лучший уклад к худшему: во сколько раз вид сильнее против удобного логова, чем против неудобного.');
  await styleTable('ring');
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

/** Бой у стены посёлка мерки 10-го уровня с войском `troops`; оборона встаёт по правилу развёртывания. */
async function wallRow(troops: TroopStack, over: Record<string, number> = {}): Promise<WallRow> {
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
      if (w.wallField({ id: `bench${i}`, seed, power }, at).field.won) n++;
    }
    return n / WALL_SEEDS;
  };
  const half = halfPoint((k) => broke(k * d), WALL_SHARES) * d;
  const raid = lairRaid(lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, g.pop), g.pop);
  return { heads: troopTotal(troops), power: troopPower(troops), defense: d, militia: militiaMen(g), half, raid, broke: broke(raid) };
}

/** Задача веера (`lib/fan.ts`): бой у стены с войском `troops` — строка разделов 4 и 6.4. */
export function wallTask({ troops }: { troops: TroopStack }): Promise<WallRow> {
  return wallRow(troops);
}

const wallLine = (name: string, r: WallRow): string =>
  ` ${padR(name, 36)}  ${pad(r.heads, 5)}  ${pad(r.power, 4)}  ${pad(Math.round(r.defense), 6)}  ${pad(r.militia, 9)}  ${pad(Number.isFinite(r.half) ? Math.round(r.half) : '—', 7)}  ${pad(f2(r.half / r.defense), 8)}  ${pad(Math.round(r.raid), 12)}  ${pad(pct(r.broke), 8)}`;
const WALL_HEAD = ' войско                                голов  мощь  защита  ополчение  полпути  к защите  набег логова  прорывов';

/** Войско мерки 10-го уровня: его мощь — мерка равной мощи для остальных армий. */
const MIX_POWER = (): number => troopPower(townAt(10).army as TroopStack);

/** Армия той же мощи из одного вида. */
const pureTroops = (id: TroopId, power: number): TroopStack => ({ [id]: Math.round(power / TROOP_BY_ID[id].power) });

/**
 * Пеший остаток мерки, у которого конница вида `horse` — доля `share` мощи. `share` 0 — мерка без конницы, мощь та
 * же. Конных видов в пешем остатке нет ни одного: остаток — всё, что не верхом.
 */
function mixCav(share: number, power: number, horse: TroopId = 'rider'): TroopStack {
  const mix = townAt(10).army as TroopStack;
  const foot = (Object.keys(mix) as TroopId[]).filter((id) => !TROOP_BY_ID[id].mounted);
  const footPower = foot.reduce((n, id) => n + (mix[id] ?? 0) * TROOP_BY_ID[id].power, 0);
  const out: TroopStack = {};
  for (const id of foot) out[id] = Math.round(((mix[id] ?? 0) * power * (1 - share)) / footPower);
  if (share > 0) out[horse] = Math.round((power * share) / TROOP_BY_ID[horse].power);
  return out;
}

/** Полпути стены у армий из одного вида: мера силы на единицу мощи в игре. */
type Worth = Record<string, number>;

async function wallPart(): Promise<Worth> {
  console.log('');
  console.log(`--- 4. Бой у стены: LocalWorld.wallField, посёлок мерки 10-го уровня, мир ${SEEDS[0]}, ${WALL_SEEDS} боёв на силу набега ---`);
  console.log('Войско мерки (autopilot.townAt) заменено армией той же мощи; стена, башня и ополчение 10-го уровня — как в игре, оборона — по правилу развёртывания.');
  console.log('«защита» — derived.defense (то, что игрок видит в «Защите посёлка»); «полпути» — сила набега, при которой прорывается половина боёв,');
  console.log('и она же в долях защиты; «набег логова» — дозревшее логово медианной опоры при жителях посёлка (lairs.lairRaid) и прорывов при нём.');
  console.log(WALL_HEAD);
  const power = MIX_POWER();
  const worth: Worth = {};
  const specs = [townAt(10).army as TroopStack, mixCav(0, power), ...TROOPS.map((t) => pureTroops(t.id, power))].map((troops) => ({ troops }));
  const [mix, bare, ...pure] = await fan(wallTask, import.meta.url, specs);
  console.log(wallLine('мерка MIX', mix));
  console.log(wallLine('мерка без конницы (мощь та же)', bare));
  TROOPS.forEach((t, i) => {
    const r = pure[i];
    worth[t.id] = r.half / r.defense;
    console.log(wallLine(t.name, r));
  });
  return worth;
}

// ---------- 6. Классы конницы ----------

/** Пеший остаток мерки MIX в родах боя и конница класса `horse` долей `share` бойцов строя; ступени — видов мерки. */
function mixSide(share: number, horse: HorseClass): Side {
  const foot: [UnitKind, number][] = [];
  let whole = 0;
  const gear: Partial<Record<UnitKind, number>> = {};
  for (const id of Object.keys(MIX) as TroopId[]) {
    if (TROOP_BY_ID[id].mounted) continue;
    gear[KIND_OF[id]] = gearOfTroop(id);
    const n = (MIX[id] ?? 0) * weightOf(id);
    foot.push([KIND_OF[id], n]);
    whole += n;
  }
  gear[horse.kind] = gearOfTroop(horse.troop);
  const stack = emptyStack();
  const cav = Math.round(MEN * share);
  stack[horse.kind] = cav;
  for (const [k, n] of foot) stack[k] += Math.round(((MEN - cav) * n) / whole);
  return { stack, gear };
}

const CAV_SHARE = 0.3;
const CAV_SHARES = [0, 0.1, 0.2, 0.3, 0.45, 0.6];
/**
 * Сколько добавляет одно решение: разрыв настроенной армии и быстрой атаки (docs/BATTLE_SYSTEM_FOR_CLAUDE.md, раздел 1).
 * Обещание ТЗ, из которого число взято, поставка 1 боя снимает вместе с быстрой атакой (docs/battle_eu4.md, 14.1); стойла,
 * выведенные этой меркой, ждут перемера пачкой 5 (14.10), и мерка до неё остаётся прежней.
 */
const ONE_DECISION = 0.15;

function rulePart(): void {
  console.log('');
  console.log('--- 6. Классы конницы: профиль из конфига боя ---');
  console.log('Правило: класс — это доспех на всаднике (kinds.kindOfTroop). Без доспеха — та половина прежнего конного рода, что держится на');
  console.log('скорости; в доспехе — та, что держится на весе. Своих чисел у классов нет (src/battle/horse.test.ts):');
  for (const c of CLASSES) {
    const k = c.kind as 'cavalry' | 'heavy';
    const s = UNIT_STATS[k];
    const x = COUNTER[k];
    console.log(
      `  ${padR(c.name, 8)} ${padR(TROOP_BY_ID[c.troop].name, 16)} рукопашная ${s.melee}, стойкость ${s.toughness}, скорость ${s.speed}; по лучникам ×${x.archer}, во фланг ×${x.flank}, по сомкнутым копьям ×${x.spearClosed}, по пехоте ×${x.infantry}; лучники по ней ×${COUNTER.archer[k]}; остановленная ×${TEMPER[k].stalled}; преследование ${RETREAT.pursuitKills[k]}; снаряжение ${Object.keys(TROOP_BY_ID[c.troop].gear).join('+')}, ступень ${gearOfTroop(c.troop)}`,
    );
  }
  console.log('Удар с разбега (CLASH_CAVALRY_IMPACT ×1.5) — только у тяжёлой (sim.ts). Прежний единый всадник — в выводе коммита 729d510 и в docs/stable.md.');
}

/** Пары раздела 6.1: армия и противник по роду конницы; все встают по правилу развёртывания. */
const RING_PAIRS: { name: string; a: (k: UnitKind) => ArmySetup; b: (k: UnitKind) => ArmySetup }[] = [
    { name: 'копья против конницы', a: () => deploySetup({ spear: MEN }), b: (k) => deploySetup({ [k]: MEN }) },
    { name: 'конница против лучников', a: (k) => deploySetup({ [k]: MEN }), b: () => deploySetup({ archer: MEN }) },
    { name: 'конница против пехоты', a: (k) => deploySetup({ [k]: MEN }), b: () => deploySetup({ infantry: MEN }) },
    { name: 'пехота + треть конницы против пехоты', a: (k) => deploySetup({ [k]: MEN / 3, infantry: (2 * MEN) / 3 }), b: () => deploySetup({ infantry: MEN }) },
];
const RING_FOES: TroopId[] = ['clubman', 'spearman', 'archer', 'legionary'];

/** Задача веера (`lib/fan.ts`): строка раздела 6.1 — пара `RING_PAIRS[i]` или, при `duel`, класс `CLASSES[i]` против видов. */
export function classRingLine({ i, duel: d }: { i: number; duel: boolean }): string {
  if (d) {
    const c = CLASSES[i];
    return ` ${padR(c.name, 10)}${RING_FOES.map((id) => pad(f2(duel(pureOf(c.troop), pureOf(id))), 11)).join('')}`;
  }
  const pair = RING_PAIRS[i];
  const row = CLASSES.map((c) => {
    let ratio = 0;
    for (let seed = 1; seed <= DUEL_SEEDS; seed++) ratio += mirrored(pair.a(c.kind), pair.b(c.kind), seed).lossRatio;
    return f2(ratio / DUEL_SEEDS);
  });
  return ` ${padR(pair.name, 46)}${row.map((x) => pad(x, 10)).join('')}`;
}

async function classRingPart(): Promise<void> {
  console.log('');
  console.log(`--- 6.1. Кольцо: ядро, размен первой армии, правило развёртывания у обеих, ${DUEL_SEEDS} сидов × обе стороны поля ---`);
  const lines = await fan(classRingLine, import.meta.url, [...RING_PAIRS.map((_, i) => ({ i, duel: false })), ...CLASSES.map((_, i) => ({ i, duel: true }))]);
  console.log(` ${padR('', 46)}${CLASSES.map((c) => pad(c.name, 10)).join('')}`);
  for (const line of lines.slice(0, RING_PAIRS.length)) console.log(line);
  console.log('');
  console.log('Всадник против вида при равной мощи (раздел 2), правило развёртывания у обеих:');
  console.log(` ${padR('класс', 10)}${RING_FOES.map((id) => pad(TROOP_BY_ID[id].name, 11)).join('')}`);
  for (const line of lines.slice(RING_PAIRS.length)) console.log(line);
}

interface ShareRow {
  name: string;
  horse: HorseClass;
  order: Order;
  defend: number[];
  attack: number[];
  /** Исходы боёв по ступеням силы — по бою на сид; из них граница раздела 6.3а. */
  lost: Record<'defend' | 'attack', ((k: number) => boolean[])[]>;
}

/**
 * Задача веера (`lib/fan.ts`): кривая раздела 6.3 — исходы боёв по ступеням силы для доли конницы `s`, класса
 * `CLASSES[horse]`, приказа `order` и стороны `mode`. Ступени — те, что спросит полпути (`halfPoint`); прочие
 * (их спрашивает граница 6.3а) досчитываются там, где их спросили, — той же функцией.
 */
export function shareCurve({ s, horse, mode }: { s: number; horse: number; order: Order; mode: 'defend' | 'attack' }): Map<number, boolean[]> {
  const memo = new Map<number, boolean[]>();
  const side = mixSide(s, CLASSES[horse]);
  halfPoint((k) => {
    if (!memo.has(k)) memo.set(k, lairLosses(side, null, k, mode, SHARE_FIGHTS));
    return memo.get(k)!.filter(Boolean).length / SHARE_FIGHTS;
  });
  return memo;
}

/**
 * Отпечаток входа кривой 6.3: состав, ступени и расстановка. Бой — чистая функция входа, и у двух кривых с одним
 * отпечатком исходы одни и те же на любой ступени силы (сила входит в бой только множителем `k`): так кривые долей,
 * у которых войско вышло одно и то же, считаются один раз.
 */
function curveKey(s: number, horse: number, mode: 'defend' | 'attack'): string {
  const own = mixSide(s, CLASSES[horse]);
  return JSON.stringify([own, mode, ownSetup(own)]);
}

async function sharePart(): Promise<ShareRow[]> {
  console.log('');
  console.log(`--- 6.3. Доля конницы в войске: ядро, пеший остаток — по составу мерки MIX, ${SHARE_FIGHTS} боёв на силу логова, уклад — по имени отряда ---`);
  console.log('Ячейка — как в разделе 3; «прибавка» — к той же армии без конницы (столбец 0 %). Конница логова — какая выпала укладу.');
  console.log(`Боёв здесь больше, чем в прочих разделах (${LAIR_SEEDS}): из этой таблицы выводятся места конницы, а при ${LAIR_SEEDS} боях прибавка лежала внутри своей границы (раздел 6.3а).`);
  console.log(` ${padR('класс и приказ', 30)}${CAV_SHARES.map((s) => pad(pct(s), 7)).join('')}   прибавка при ${CAV_SHARES.slice(1).map(pct).join(' / ')}`);
  const rows: ShareRow[] = [];
  // Кривые всех строк — одним веером; кривая с тем же отпечатком входа, что у уже заказанной, не заказывается.
  const curves = CLASSES.flatMap((_, horse) => [RULE].flatMap((order) => (['defend', 'attack'] as const).flatMap((mode) => CAV_SHARES.map((s) => ({ s, horse, order, mode })))));
  const keys = curves.map((c) => curveKey(c.s, c.horse, c.mode));
  const first = keys.map((k) => keys.indexOf(k));
  const unique = curves.filter((_, i) => first[i] === i);
  const memos = await fan(shareCurve, import.meta.url, unique);
  const memoOf = (i: number): Map<number, boolean[]> => memos[unique.indexOf(curves[first[i]])];
  let curve = 0;
  for (const horse of CLASSES) {
    for (const order of [RULE]) {
      const row: ShareRow = { name: `${horse.name}, ${order.name}`, horse, order, defend: [], attack: [], lost: { defend: [], attack: [] } };
      for (const mode of ['defend', 'attack'] as const) {
        // Исходы боёв запоминаются: из тех же боёв считается граница (раздел 6.3а), второй раз их не гоняют.
        const lost = CAV_SHARES.map((s) => {
          const memo = memoOf(curve++);
          return (k: number): boolean[] => {
            if (!memo.has(k)) memo.set(k, lairLosses(mixSide(s, horse), null, k, mode, SHARE_FIGHTS));
            return memo.get(k)!;
          };
        });
        const hs = lost.map((l) => halfPoint((k) => l(k).filter(Boolean).length / SHARE_FIGHTS));
        row[mode] = hs;
        row.lost[mode] = lost;
        console.log(` ${padR(`${row.name}: ${mode === 'defend' ? 'оборона' : 'удар'}`, 30)}${hs.map((h) => pad(f2(h), 7)).join('')}   ${hs.slice(1).map((h) => `${h >= hs[0] ? '+' : '−'}${Math.abs(Math.round((h / hs[0] - 1) * 100))}%`).join(' / ')}`);
      }
      rows.push(row);
    }
  }
  bandPart(rows);
  return rows;
}

const LEVELS_1_10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Доля конницы, на которой её прибавка к войску без конницы достигает одного решения: линейно между
 * долями, `NaN` — не достигает до последней. Одна на раздел 7 (места) и на границу раздела 6.3а.
 */
function capOf(hs: number[]): number {
  for (let i = 1; i < hs.length; i++) {
    const g = hs[i] / hs[0] - 1;
    if (g >= ONE_DECISION) {
      const gp = hs[i - 1] / hs[0] - 1;
      return CAV_SHARES[i - 1] + ((ONE_DECISION - gp) / Math.max(1e-9, g - gp)) * (CAV_SHARES[i] - CAV_SHARES[i - 1]);
    }
  }
  return NaN;
}

/** Места конницы класса по уровням 1…10 при доле `cap`: столько всадников этого класса держит конюшня. */
const placesAt = (horse: HorseClass, cap: number): number[] =>
  LEVELS_1_10.map((L) => Math.round((armyAt(L) * (troopPower(MIX) / troopTotal(MIX)) * cap) / BATTLE_MAN / weightOf(horse.troop)));

/** На скольких боях показывать границу: степени двойки до нынешнего числа боёв, и само число. */
const bandSteps = (n: number): number[] => [...new Set([40, 80, 160, 320, n])].filter((x) => x <= n).sort((a, b) => a - b);

/**
 * Доверительная граница раздела 6.3 (`scripts/lib/halfband.ts`) — и главное, граница **мест конницы**:
 * места выводятся из доли, на которой прибавка достигает одного решения, и если эта доля гуляет от
 * перевыборки сидов, то места выведены из шума. Граница прибавки — парный бутстрап: на каждом броске
 * один набор сидов идёт всем долям сразу, потому что бои у них на одних и тех же сидах, и конверт из
 * краёв двух границ был бы шире правды.
 */
function bandPart(rows: ShareRow[]): void {
  console.log('');
  console.log(`--- 6.3а. Граница прибавки и мест: 95 %, парный бутстрап по сидам, ${BOOT_DRAWS} бросков ---`);
  // Подписи (docs/weights.md, место 5): «±» и прибавка считаются только по обороне, «доля решения» — по обеим сторонам.
  console.log('«±» — полуширина границы полпути (Уилсон по ступеням) в долях самого полпути, медиана по шести долям конницы, только в обороне.');
  console.log(`«прибавка при ${pct(CAV_SHARE)}» — в обороне, как строка «оборона» в 6.3, с границей; удара в этом столбце нет. «доля решения» — по обеим сторонам (меньшая из обороны и удара): доля конницы, на которой прибавка достигает ${pct(ONE_DECISION)}`);
  console.log('(из неё считаются места, раздел 7), с границей; «нет» — не достигает до 60 %, в скобках — на скольких бросках из ста «нет».');
  console.log(` ${padR('класс и приказ', 24)} ${pad('боёв', 5)}  ${pad('±', 7)}  ${pad(`прибавка при ${pct(CAV_SHARE)}`, 22)}  ${pad('доля решения', 24)}  места 10-го уровня`);
  const at = CAV_SHARES.indexOf(CAV_SHARE);
  for (const r of rows) {
    const curves = [...r.lost.defend, ...r.lost.attack];
    for (const n of bandSteps(SHARE_FIGHTS)) {
      const boot = bootstrapHalves(curves, SHARES, n, BOOT_DRAWS);
      const sides = (xs: number[]): { d: number[]; a: number[] } => ({ d: xs.slice(0, CAV_SHARES.length), a: xs.slice(CAV_SHARES.length) });
      const capBoth = (xs: number[]): number => {
        const { d, a } = sides(xs);
        const cd = capOf(d);
        const ca = capOf(a);
        return Math.min(Number.isFinite(cd) ? cd : Infinity, Number.isFinite(ca) ? ca : Infinity);
      };
      const caps = boot.draws.map(capBoth);
      const none = caps.filter((c) => !Number.isFinite(c)).length / caps.length;
      const capPoint = capBoth(boot.point);
      const capLo = percentile(caps, 0.025);
      const capHi = percentile(caps, 0.975);
      // Бросок, на котором хоть одно полпути ушло за последнюю ступень, прибавки не даёт: делить на
      // бесконечность значит печатать «−100 %» там, где сказать нечего. Такие броски выбрасываются.
      const gains = boot.draws
        .filter((xs) => Number.isFinite(sides(xs).d[at]) && Number.isFinite(sides(xs).d[0]))
        .map((xs) => sides(xs).d[at] / sides(xs).d[0] - 1);
      const gain = sides(boot.point).d[at] / sides(boot.point).d[0] - 1;
      const spreads = r.lost.defend.map((l) => spread(halfBand(l, SHARES, n)));
      const share = (x: number): string => (Number.isFinite(x) ? pct(x) : 'нет');
      const seats = (x: number): string => (Number.isFinite(x) ? String(placesAt(r.horse, x)[9]) : '—');
      console.log(
        ` ${padR(r.name, 24)} ${pad(n, 5)}  ${pad(pctOr(median(spreads)), 7)}  ${pad(`${signedPct(gain)} [${signedPct(percentile(gains, 0.025))}…${signedPct(percentile(gains, 0.975))}]`, 22)}  ${pad(
          `${share(capPoint)} [${share(capLo)}…${share(capHi)}] (${Math.round(none * 100)})`,
          24,
        )}  ${seats(capPoint)} [${seats(capLo)}…${seats(capHi)}]`,
      );
    }
  }
}

const pctOr = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—');
const signedPct = (x: number): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))}%` : '—');

interface ClassWall {
  horse: HorseClass;
  pure: WallRow;
}

async function classWallPart(): Promise<ClassWall[]> {
  console.log('');
  console.log(`--- 6.4. Классы у стены: LocalWorld.wallField, посёлок мерки 10-го уровня, ${WALL_SEEDS} боёв ---`);
  console.log(`«конница ${pct(CAV_SHARE)}» — пеший остаток мерки и всадники класса долей мощи; оборона — по правилу развёртывания.`);
  console.log('Мощь армий — мерки MIX. Столбцы — как в разделе 4.');
  console.log(WALL_HEAD);
  const power = MIX_POWER();
  const specs = [
    { troops: pureTroops('clubman', power) },
    { troops: mixCav(0, power) },
    ...CLASSES.flatMap((c) => [{ troops: pureTroops(c.troop, power) }, { troops: mixCav(CAV_SHARE, power, c.troop) }]),
  ];
  const [club, bare, ...rows] = await fan(wallTask, import.meta.url, specs);
  console.log(wallLine('дубинщики (мера)', club));
  console.log(wallLine('без конницы', bare));
  const out: ClassWall[] = [];
  CLASSES.forEach((c, i) => {
    const [pure, mixed] = rows.slice(i * 2, i * 2 + 2);
    console.log(wallLine(`${c.name}: одни всадники`, pure));
    console.log(wallLine(`${c.name}: конница ${pct(CAV_SHARE)}`, mixed));
    out.push({ horse: c, pure });
  });
  return out;
}

// ---------- 7. Числа ----------

/**
 * Жалованье вида на бойца строя за игровой день при части «с бойца строя» `m` и «за снаряжение» `g` — формулой
 * `derived.wageOf` (деревня без веры: `wageShare` единица), но с `m` и `g` на месте `WAGE_MAN` и `WAGE_GEAR`: вывод
 * этих чисел и ищет, какими им быть.
 */
const wageAt = (id: TroopId, g: number, m: number = WAGE_MAN): number =>
  (TAX_PER_POP * (WAGE_HEAD + m * weightOf(id) + g * wageGear(id))) / weightOf(id);

/**
 * `WAGE_MAN` до части за снаряжение. Жалованье мерки при нём — то, что часть за снаряжение обязана оставить прежним:
 * она назначает цену снаряжению, а не поднимает цену армии (решение владельца, docs/stable.md, раздел 10).
 */
const WAGE_MAN_BEFORE = WAGE_MAN_UNGEARED;

/** Жалованье мерки MIX за игровой день при `m` и `g` — сумма `wageAt` по составу. */
const mixWage = (m: number, g: number): number =>
  (Object.entries(MIX) as [TroopId, number][]).reduce((sum, [id, n]) => sum + n * wageAt(id, g, m) * weightOf(id), 0);

function numbersPart(worth: Worth, shares: ShareRow[]): void {
  console.log('');
  console.log('--- 7. Числа: цена силы и что из неё выводится ---');
  console.log('«сила» — полпути стены на единицу мощи у армии из одного вида (раздел 4), дубинщики — единица. «на силу» — цена бойца строя (раздел 1),');
  console.log(`делённая на силу. Медиана — по ${TROOPS.length} видам: столько игра берёт за единицу силы.`);
  console.log(' вид               сила  добро/силу  кузница/силу  казармы/силу  жалованье/силу  паёк/силу');
  const club = worth.clubman;
  const strength = (id: TroopId): number => worth[id] / club;
  const per: Record<keyof Price, number[]> = { goods: [], forge: [], work: [], wage: [], food: [] };
  for (const t of TROOPS) {
    const w = strength(t.id);
    const p = priceOf(t.id);
    for (const k of Object.keys(per) as (keyof Price)[]) per[k].push(p[k] / w);
    console.log(` ${padR(t.name, 16)}  ${pad(f2(w), 4)}  ${pad((p.goods / w).toFixed(1), 10)}  ${pad((p.forge / w).toFixed(0), 12)}  ${pad((p.work / w).toFixed(1), 12)}  ${pad((p.wage / w).toFixed(2), 14)}  ${pad((p.food / w).toFixed(2), 9)}`);
  }
  const med = Object.fromEntries((Object.keys(per) as (keyof Price)[]).map((k) => [k, median(per[k])])) as unknown as Price;
  console.log(` ${padR('медиана', 16)}  ${pad('', 4)}  ${pad(med.goods.toFixed(1), 10)}  ${pad(med.forge.toFixed(0), 12)}  ${pad(med.work.toFixed(1), 12)}  ${pad(med.wage.toFixed(2), 14)}  ${pad(med.food.toFixed(2), 9)}`);

  // WAGE_GEAR: правило владельца (docs/stable.md, решение 4) — самый снаряжённый вид платит за единицу силы медиану
  // игры. Прочтений два, и печатаются оба. **Решение 4** — медиана той игры, где части за снаряжение ещё нет (так
  // считалось одобренное «5.39»): число ставит цель, и она от самого числа не зависит. **Неподвижная точка** —
  // медиана той игры, где часть уже есть: дорожают все, кто что-то носит, и медиана растёт вслед за числом.
  //
  // WAGE_MAN: жалованье нейтральное по сумме (решение владельца после конюшни) — мерка MIX платит столько же, сколько
  // платила при `WAGE_MAN_BEFORE` без части за снаряжение. Два правила связаны: ниже `WAGE_MAN` — ниже и медиана «игры
  // без части за снаряжение», то есть цель решения 4. Поэтому оба числа выводятся вместе — поочерёдно, пока не
  // перестанут меняться.
  const heaviest = TROOPS.reduce((a, b) => (wageGear(b.id) > wageGear(a.id) ? b : a)).id;
  const perStrength = (g: number, m: number = WAGE_MAN): number[] => TROOPS.map((t) => wageAt(t.id, g, m) / strength(t.id));
  const head = (x: number, m: number = WAGE_MAN): number => wageAt(heaviest, x, m) * weightOf(heaviest);
  const solveFor = (target: (g: number) => number, m: number = WAGE_MAN): number => {
    let lo = 0;
    let hi = 2;
    if (wageAt(heaviest, lo, m) / strength(heaviest) >= target(lo)) return 0;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (wageAt(heaviest, mid, m) / strength(heaviest) < target(mid)) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const decided = solveFor(() => median(perStrength(0)));
  const fixed = solveFor((g) => median(perStrength(g)));
  // Нейтральность: MIX (m, g) = MIX (WAGE_MAN_BEFORE, 0); mixWage линейна по m.
  const before = mixWage(WAGE_MAN_BEFORE, 0);
  const neutralMan = (g: number): number => WAGE_MAN_BEFORE - (mixWage(WAGE_MAN_BEFORE, g) - before) / (mixWage(1, 0) - mixWage(0, 0));
  let nm = WAGE_MAN_BEFORE;
  let ng = 0;
  let rounds = 0;
  for (; rounds < 100; rounds++) {
    const g = solveFor(() => median(perStrength(0, nm)), nm);
    const m = neutralMan(g);
    const still = Math.abs(g - ng) < 1e-9 && Math.abs(m - nm) < 1e-9;
    ng = g;
    nm = m;
    if (still) break;
  }
  const dayOf = (id: TroopId, m: number, g: number): string => (wageAt(id, g, m) * weightOf(id)).toFixed(2);
  console.log('');
  console.log(`Жалованье за снаряжение (WAGE_GEAR, data/upkeep.ts): самый снаряжённый вид — ${TROOP_BY_ID[heaviest].name} (${wageGear(heaviest)} по derived.wageGear) —`);
  console.log('платит за единицу силы медиану по всем видам (решение 4). Делением отрезка [0, 2] в долях полного сбора с человека; ноль — вид и без');
  console.log(`этой части платит не меньше медианы. Ниже — при WAGE_MAN игры (${WAGE_MAN}).`);
  console.log(`  решение 4 (медиана без части за снаряжение): ${decided.toFixed(4)} — ${TROOP_BY_ID[heaviest].name} ${head(decided).toFixed(2)} в день, медиана ${median(perStrength(0)).toFixed(3)}`);
  console.log(`  неподвижная точка (медиана вместе с этой частью): ${fixed.toFixed(4)} — ${head(fixed).toFixed(2)} в день, медиана ${median(perStrength(fixed)).toFixed(3)}`);
  console.log('');
  console.log(`Жалованье нейтральное по сумме: мерка MIX (${troopTotal(MIX)} голов) платит столько же, сколько при WAGE_MAN ${WAGE_MAN_BEFORE} без части за снаряжение —`);
  console.log(`${before.toFixed(2)} в день; WAGE_MAN и WAGE_GEAR (решение 4) — вместе, поочерёдно до неподвижности (${rounds + 1} кругов).`);
  console.log(`  нейтрально, решение 4: WAGE_MAN ${nm.toFixed(4)}, WAGE_GEAR ${ng.toFixed(4)} — мерка ${mixWage(nm, ng).toFixed(2)} в день, ${TROOP_BY_ID[heaviest].name} ${head(ng, nm).toFixed(2)}, медиана без части ${median(perStrength(0, nm)).toFixed(3)}`);
  const keptMan = neutralMan(0.3547);
  console.log(`  для сравнения — WAGE_GEAR 0.3547 (вывод при WAGE_MAN ${WAGE_MAN_BEFORE}) и нейтральный к нему WAGE_MAN ${keptMan.toFixed(4)}: ${TROOP_BY_ID[heaviest].name} ${head(0.3547, keptMan).toFixed(2)} в день,`);
  console.log(`    на единицу силы ${(wageAt(heaviest, 0.3547, keptMan) / strength(heaviest)).toFixed(3)} при медиане без части ${median(perStrength(0, keptMan)).toFixed(3)}`);
  console.log(`  в data/upkeep.ts: WAGE_MAN ${WAGE_MAN}, WAGE_GEAR ${WAGE_GEAR} — мерка ${mixWage(WAGE_MAN, WAGE_GEAR).toFixed(2)} в день, ${TROOP_BY_ID[heaviest].name} ${head(WAGE_GEAR).toFixed(2)}`);
  console.log(`  в день по видам, до части (${WAGE_MAN_BEFORE}, 0) → в игре: ${TROOPS.map((t) => `${t.name} ${dayOf(t.id, WAGE_MAN_BEFORE, 0)} → ${dayOf(t.id, WAGE_MAN, WAGE_GEAR)}`).join(', ')}`);

  console.log('');
  console.log('Цена класса: слева — что стоит вид в игре (data/troops.ts, derived.wageOf), справа — медиана «на силу», умноженная на силу класса');
  console.log('(раздел 4, одни всадники) и на строя: столько класс стоил бы, если бы брал за силу как все. Паёк — конь тоже рот: HORSE_MOUTHS на голову.');
  console.log(' класс     вид               сила  строя   добро  кузница  казармы  жалованье  паёк   | по медиане: добро  казармы  жалованье');
  const s0 = createInitialState(7);
  for (const c of CLASSES) {
    const w = strength(c.troop);
    const m = weightOf(c.troop);
    console.log(
      ` ${padR(c.name, 8)}  ${padR(TROOP_BY_ID[c.troop].name, 16)}  ${pad(f2(w), 4)}  ${pad(m, 5)}  ${pad(goodsTotal(c.troop), 6)}  ${pad(forgeOf(c.troop), 7)}  ${pad(TROOP_BY_ID[c.troop].work, 7)}  ${pad(wageOf(s0, c.troop).toFixed(2), 9)}  ${pad((SOLDIER_FOOD * HORSE_MOUTHS).toFixed(1), 4)}   | ${pad(Math.round(med.goods * w * m), 17)}  ${pad(Math.round(med.work * w * m), 7)}  ${pad((med.wage * w * m).toFixed(2), 9)}`,
    );
  }

  console.log('');
  console.log(`Места: доля конницы, на которой её прибавка к войску без конницы достигает одного решения (${pct(ONE_DECISION)}, разрыв настроенной армии и`);
  console.log('быстрой атаки), — по разделу 6.3, линейно между долями, меньшая из обороны и удара; не достигает до 60 % — «нет». Места уровня L — эта доля');
  console.log('бойцов строя войска мерки (autopilot.armyAt(L) голов по составу MIX), делённая на строя всадника класса. Справа — стойла в игре (derived.stalls).');
  console.log(`Граница этих долей — раздел 6.3а: места, выведенные из доли, у которой граница накрывает ${pct(ONE_DECISION)}, выведены из шума.`);
  for (const r of shares) {
    const d = capOf(r.defend);
    const a = capOf(r.attack);
    const cap = Math.min(Number.isFinite(d) ? d : Infinity, Number.isFinite(a) ? a : Infinity);
    const places = Number.isFinite(cap) ? placesAt(r.horse, cap).join(' ') : '—';
    console.log(`  ${padR(r.name, 24)} оборона ${Number.isFinite(d) ? pct(d) : 'нет'}, удар ${Number.isFinite(a) ? pct(a) : 'нет'}; места по уровням 1…10: ${places}`);
  }
  console.log(`  стойла в игре по уровням 1…10: ${LEVELS_1_10.map((L) => stalls(townAt(L))).join(' ')}`);

  console.log('');
  console.log('Время найма: работа вида (data/troops.ts) при скорости учений конюшни уровня L (derived.recruitRate, у мерки все постройки уровня L).');
  console.log('Игровых секунд на голову; «все стойла тяжёлыми» — стойла уровня, нанятые подряд.');
  console.log(` уровень  ${CLASSES.map((c) => pad(c.name, 9)).join('')}  ${pad('стойл', 6)}  все стойла тяжёлыми`);
  const heavy = CLASSES.find((c) => c.kind === 'heavy')!;
  for (const L of LEVELS_1_10) {
    const s = townAt(L);
    const cells = CLASSES.map((c) => pad((TROOP_BY_ID[c.troop].work / recruitRate(s, c.troop)).toFixed(1), 9));
    console.log(` ${pad(L, 7)}  ${cells.join('')}  ${pad(stalls(s), 6)}  ${pad(((stalls(s) * TROOP_BY_ID[heavy.troop].work) / recruitRate(s, heavy.troop)).toFixed(0), 19)}`);
  }
}

export async function stableSection(): Promise<void> {
  console.log('');
  console.log('=== Конюшня: рода войск и два класса конницы (docs/stable.md) ===');
  typesPart();
  await duelPart();
  await ringPart();
  const worth = await wallPart();
  rulePart();
  await classRingPart();
  const shares = await sharePart();
  await classWallPart();
  numbersPart(worth, shares);
}

serveFan(import.meta.url, { duelLine, styleLine, wallTask, classRingLine, shareCurve });
