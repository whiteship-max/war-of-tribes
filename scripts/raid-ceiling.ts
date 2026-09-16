// Потолок набегов — раздел `raid:report`.
//
// Раздел заведён до кода (docs/raid_ceiling.md) тем же порядком, что лазарет и башня: сначала
// числа, на которых стоит решение, потом решение владельца, потом код. Меряется:
//
//  1. **Что потолок держит сейчас** — какую силу набег может собрать, из какого слагаемого
//     формулы `LocalWorld.scheduleAi` она на деле берётся и как она соотносится с обороной
//     посёлка каждого уровня. Считается по настоящим логовам настоящего мира и настоящей
//     обороне (`derived.defense`), а какое слагаемое сработало — записью с каждого набега
//     прогона.
//  2. **Что будет без потолка** — настоящий мир (`LocalWorld` с настоящим племенем и пульсом,
//     как у `world/store`), где набег собирается не из логова, а из обороны: `оборона × k`.
//     Это единственная подстановка раздела, и сделана она в экземпляр мира: набег выходит
//     своим путём, а сразу после выхода его сила пересчитывается по ступени. Дорога от числа
//     людей не зависит (`geo.marchSeconds` берёт скорость, а не число), и всё остальное —
//     осада, бой у частокола, участь, вылазка — мир как есть.
//  3. **Новичок** — партия с первой секунды: автопилот `pop:report` строит, мир шлёт набеги,
//     и то же по ступеням, плюс две защиты, выведенные из устройства: потолок растёт с
//     возрастом города и пауза после прорыва.
//  4. **Долг «оборона средним бойцом»** (docs/PROMISES_DEBT.md) — насколько число обороны
//     расходится с тем, кто на деле стоит дома, и что это расхождение стоит, когда набег
//     собирается из этого числа.
import { LocalWorld } from '@/world/local/LocalWorld';
import { applyEffects, playerProfile, syncAway, syncSiege } from '@/world/bridge';
import { awayOf, homeOf } from '@/world/muster';
import { generateWorld, isLair, type GenSettlement } from '@/world/gen';
import { distance } from '@/world/geo';
import {
  AI_MIN_POP,
  AI_POWER_SHARE,
  AI_POWER_VS_DEFENSE,
  AI_RANGE,
  LAIR_ANCHOR_FAR,
  LAIR_ANCHOR_HOME,
  LAIR_CAP,
  LAIR_RIPE,
  LAIR_START,
  SIEGE_IF_BELOW,
  SIEGE_IMMUNE,
} from '@/world/data/tuning';
import type { WorldSave } from '@/world/local/state';
import type { FigureView, HomeEffect, MarchView, PlayerProfile } from '@/world/types';
import { createInitialState } from '@/game/state';
import { tick } from '@/game/sim/tick';
import { autoAssign } from '@/game/sim/workers';
import { startRecruit } from '@/game/sim/army';
import { seeded, setRandom } from '@/game/sim/random';
import { armyPower, armySize, defense, housingCapacity, storageCap } from '@/game/derived';
import { RESOURCE_IDS } from '@/game/constants';
import { TROOP_BY_ID } from '@/game/data/troops';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { GameState, TroopId } from '@/game/types';
import { build, staff } from './autopilot';

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = 1_700_000_000_000;
const SEEDS = [7, 11, 42, 51, 77];
const LEVELS = [1, 5, 10];
/** Шаг пульса мира, секунд. Набег идёт минутами, вылазка — не чаще раза в пять минут. */
const PULSE = 30;
/** Состав и мерка войска — те же, что у осады и лазарета: замеры сравнимы между отчётами. */
const MIX: TroopStack = { spearman: 4, archer: 3, legionary: 2, rider: 1 };
const armyAt = (level: number): number => 2 * (20 + 10 * (level - 1));

const pad = (v: string | number, w: number): string => String(v).padStart(w);
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const hm = (ms: number): string => {
  const m = Math.round(ms / MIN);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')}` : `${m} мин`;
};

function stackOf(n: number, mix: TroopStack): TroopStack {
  const out: TroopStack = {};
  const ids = Object.keys(mix) as TroopId[];
  const whole = ids.reduce((s, id) => s + (mix[id] ?? 0), 0);
  let left = n;
  ids.forEach((id, i) => {
    const k = i === ids.length - 1 ? left : Math.round((n * (mix[id] ?? 0)) / whole);
    out[id] = k;
    left -= k;
  });
  return out;
}

/** Посёлок уровня L: жильё на 90 %, склад полон, войско — `armyAt` по составу. */
function townAt(level: number, army: TroopStack = stackOf(armyAt(level), MIX)): GameState {
  const g = createInitialState(7);
  g.tutorialDone = true;
  for (const b of g.buildings) b.level = level;
  g.pop = Math.round(housingCapacity(g) * 0.9);
  for (const [id, n] of Object.entries(army)) g.army[id as TroopId] = n ?? 0;
  autoAssign(g);
  for (const r of RESOURCE_IDS) g.resources[r] = storageCap(g);
  return g;
}

function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

/** Настоящее состояние мира: отчёт — прибор, ему положено видеть больше панели. */
interface Inside {
  save: WorldSave;
  gen: { settlements: GenSettlement[] };
  powerNow(s: GenSettlement, now: number): number;
  scheduleAi(now: number): void;
}
const inside = (w: LocalWorld): Inside => w as unknown as Inside;

// ---------- Ступени ----------

/** Как считается сила вышедшего набега. `null` — как в игре, без подстановки. */
interface Step {
  name: string;
  /** Сила набега из обороны; `age` — возраст города, мс. */
  power: ((def: number, age: number) => number) | null;
  /** Пауза набегов после прорыва, мс. */
  pause?: number;
}
const NOW: Step = { name: 'сейчас', power: null };
const k = (x: number): Step => ({ name: `оборона ×${x.toFixed(2)}`, power: (d) => Math.max(2, d * x) });
const STEPS: Step[] = [NOW, k(0.85), k(1), k(1.2), k(1.5)];

/**
 * Потолок растёт с возрастом города: от доли `from` обороны в минуту основания до `x` к
 * возрасту `full`, линейно. `from` ноль — буквально «молодого не трогают»; выше
 * `SIEGE_IF_BELOW` — молодого бьют слабее, но не мельче порога, с которого отряд садится в
 * осаду вместо боя.
 */
const ramp = (x: number, from: number, full: number, pause?: number): Step => ({
  name: `×${x.toFixed(1)} от ${from.toFixed(1)} за ${hm(full)}${pause ? ' + пауза' : ''}`,
  power: (d, age) => Math.max(2, d * (from + (x - from) * Math.min(1, age / full))),
  ...(pause ? { pause } : {}),
});

// ---------- Прогон ----------

interface Raid {
  /** Слагаемые формулы в минуту выхода: логово × доля и оборона × доля. */
  lair: number;
  def: number;
  /** Оборона в минуту выхода и сила вышедшего. */
  defense: number;
  power: number;
}
interface Wall {
  held: boolean;
  /** Бойцов дома перед боем и потеряно. */
  home: number;
  lost: number;
}
interface Run {
  raids: Raid[];
  walls: Wall[];
  sieges: number;
  falls: number;
  /** Все потери войска — у частокола, на вылазке, при падении. */
  lost: number;
  /** Мс, когда войска не было вовсе / было меньше половины начального. */
  none: number;
  half: number;
  armyEnd: number;
  levelsLost: number;
  goodsLost: number;
  /** Время прорывов и падений от начала, мс. */
  losses: number[];
}

interface Play {
  g: GameState;
  seed: number;
  step: Step;
  hours: number;
  /** Живёт ли племя (новичок) или посёлок стоит как задан. */
  grow?: (g: GameState) => void;
  /** Полководец уводит эту часть войска в поле и стоит там. */
  field?: TroopStack;
  /** Подменить оборону в слепке — точным составом вместо среднего бойца. */
  exact?: boolean;
  /** Каждый час — снимок посёлка. */
  hourly?: (h: number, g: GameState, r: Run) => void;
}

const levelSum = (g: GameState): number => g.buildings.reduce((n, b) => n + b.level, 0);
const goods = (g: GameState): number => RESOURCE_IDS.reduce((n, r) => n + g.resources[r], 0);

/**
 * Оборона той же функцией игры (`derived.defense`), но войско в посёлке — ровно те, кто дома:
 * копия состояния, где армия — гарнизон, а ушедших нет. Средний боец тогда совпадает с тем,
 * кто стоит у частокола, и число становится точным.
 */
function exactDefense(g: GameState, home: TroopStack): number {
  const army = { ...g.army };
  for (const id of Object.keys(army) as TroopId[]) army[id] = home[id] ?? 0;
  return defense({ ...g, army, warriorsAway: 0 });
}

async function play(o: Play): Promise<Run> {
  const { g } = o;
  let now = START;
  const world = new LocalWorld({ seed: o.seed, now: () => now, storage: memory() });
  const w = inside(world);
  const run: Run = { raids: [], walls: [], sieges: 0, falls: 0, lost: 0, none: 0, half: 0, armyEnd: 0, levelsLost: 0, goodsLost: 0, losses: [] };
  let pausedUntil = 0;
  const schedule = w.scheduleAi.bind(w);
  w.scheduleAi = (at: number) => {
    const before = new Set(w.save.marches.map((m) => m.id));
    if (at < pausedUntil) {
      // Пауза после прорыва: очередь набегов просто сдвигается, как у осады — `siegeAgainAt`.
      w.save.nextAiAt = Math.max(w.save.nextAiAt, pausedUntil);
    }
    schedule(at);
    const d = w.save.profile?.defense ?? 0;
    for (const m of w.save.marches) {
      if (before.has(m.id) || m.own || m.targetId !== 'home') continue;
      const src = w.gen.settlements.find((s) => s.id === m.fromId);
      const lair = src ? w.powerNow(src, at) * AI_POWER_SHARE : 0;
      const def = Math.max(3, d * AI_POWER_VS_DEFENSE);
      if (o.step.power) {
        m.power = o.step.power(d, at - START);
        m.units = { warrior: Math.max(1, Math.round(m.power / 3)) };
      }
      run.raids.push({ lair, def, defense: d, power: m.power });
    }
  };

  let marches: MarchView[] = [];
  let figures: FigureView[] = [];
  let homeBefore = 0;
  const pulse = async () => {
    const away = awayOf(marches, figures);
    const profile: PlayerProfile = playerProfile(g, away);
    if (o.exact) profile.defense = exactDefense(g, homeOf(g.army, away));
    homeBefore = troopTotal(homeOf(g.army, away));
    const p = await world.sync(profile);
    for (const e of p.effects as HomeEffect[]) {
      const lvl = levelSum(g);
      const stock = goods(g);
      applyEffects(g, [e]);
      const lost = troopTotal(e.lostTroops ?? {});
      run.lost += lost;
      if (e.id.endsWith('-defense') && e.battle) {
        run.walls.push({ held: e.battle === 'won', home: homeBefore, lost });
        if (e.battle === 'lost') {
          run.losses.push(p.now - START);
          run.levelsLost += lvl - levelSum(g);
          run.goodsLost += Math.max(0, stock - goods(g));
          if (o.step.pause) pausedUntil = p.now + o.step.pause;
        }
      }
      if (e.id.endsWith('-fell')) {
        run.falls++;
        run.losses.push(p.now - START);
        run.levelsLost += lvl - levelSum(g);
        run.goodsLost += Math.max(0, stock - goods(g));
      }
    }
    run.sieges += p.reports.filter((r) => r.kind === 'defense' && !r.battle && r.id.endsWith('-siege')).length;
    syncAway(g, p.marches, p.figures);
    syncSiege(g, p.siege, p.now);
    marches = p.marches;
    figures = p.figures;
    return p;
  };

  await pulse();
  if (o.field) {
    await world.setGarrison(o.field);
  }
  const start = armySize(g);
  let placed = !o.field;
  let lastSortie = 0;
  let hour = 1;
  const until = START + o.hours * HOUR;
  while (now < until) {
    now += PULSE * 1000;
    // Посёлок заданного уровня стоит как задан — как у осады и лазарета: жалованье и еда
    // иначе сняли бы войско раньше набегов, и «без войска» мерило бы казну, а не набег.
    // Живёт только партия новичка.
    if (o.grow) {
      o.grow(g);
      for (let i = 0; i < PULSE; i++) tick(g, 1);
    }
    const p = await pulse();
    const size = armySize(g);
    if (size === 0) run.none += PULSE * 1000;
    if (start > 0 && size < start / 2) run.half += PULSE * 1000;
    if (!placed) {
      const gen = figures.find((f) => f.id === 'general');
      if (gen && gen.phase === 'home' && gen.readyAt === 0) {
        const home = w.save.home;
        await world.moveFigure('general', { x: home.x + 3, y: home.y });
        placed = true;
      }
    }
    // На осаду — вылазкой, как «дома, на осаду — вылазкой» у лазарета.
    if (p.siege && now - lastSortie > 5 * MIN) {
      const home = homeOf(g.army, awayOf(marches, figures));
      if (troopTotal(home) > 0) {
        await world.sortie(home);
        lastSortie = now;
      }
    }
    if (o.hourly && now - START >= hour * HOUR) {
      o.hourly(hour, g, run);
      hour++;
    }
  }
  run.armyEnd = armySize(g);
  return run;
}

// ---------- Печать ----------

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);

interface Tally {
  raids: number;
  walls: number;
  broke: number;
  sieges: number;
  falls: number;
  heldShare: number[];
  brokeShare: number[];
  lost: number;
  none: number;
  half: number;
  armyEnd: number;
  levelsLost: number;
  goodsLost: number;
  first: number[];
  ratio: number[];
}

/** С какого числа бойцов дома доля павших в бою что-то значит. */
const SHARE_FLOOR = 10;

function tally(runs: Run[]): Tally {
  const t: Tally = { raids: 0, walls: 0, broke: 0, sieges: 0, falls: 0, heldShare: [], brokeShare: [], lost: 0, none: 0, half: 0, armyEnd: 0, levelsLost: 0, goodsLost: 0, first: [], ratio: [] };
  for (const r of runs) {
    t.raids += r.raids.length;
    t.walls += r.walls.length;
    t.sieges += r.sieges;
    t.falls += r.falls;
    t.lost += r.lost;
    t.none += r.none;
    t.half += r.half;
    t.armyEnd += r.armyEnd;
    t.levelsLost += r.levelsLost;
    t.goodsLost += r.goodsLost;
    if (r.losses.length) t.first.push(r.losses[0]);
    for (const x of r.raids) if (x.defense > 0) t.ratio.push(x.power / x.defense);
    for (const x of r.walls) {
      if (!x.held) t.broke++;
      // Доля на двух-трёх людях — округление, а не потеря: «удержали без потерь» бывает там,
      // где войска дома уже не осталось. Поэтому доли — только у боёв, где дома есть кому стоять.
      if (x.home >= SHARE_FLOOR) (x.held ? t.heldShare : t.brokeShare).push(x.lost / x.home);
    }
  }
  return t;
}

const q = (xs: number[], p: number): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const range = (xs: number[]): string => (xs.length ? `${pct(q(xs, 0.1))}…${pct(q(xs, 0.5))}…${pct(q(xs, 0.9))}` : '—');

export async function ceilingSection(): Promise<void> {
  console.log('');
  console.log('=== Потолок набегов: что он держит и что будет без него ===');
  console.log(`Сила набега в игре (LocalWorld.scheduleAi): max(2, min(логово × AI_POWER_SHARE ${AI_POWER_SHARE}, max(3, оборона × AI_POWER_VS_DEFENSE ${AI_POWER_VS_DEFENSE}))).`);
  console.log(`Набегов нет, пока население меньше AI_MIN_POP (${AI_MIN_POP}). Лагерь вместо боя — если сила меньше оборона × SIEGE_IF_BELOW (${SIEGE_IF_BELOW}).`);
  console.log('');

  // 1. Что держит потолок сейчас.
  console.log('--- 1. Какое слагаемое держит набег ---');
  console.log(`Логово: опора LAIR_ANCHOR_HOME ${LAIR_ANCHOR_HOME} … LAIR_ANCHOR_FAR ${LAIR_ANCHOR_FAR}, сила — от LAIR_START ${LAIR_START} до LAIR_CAP ${LAIR_CAP} опоры за LAIR_RIPE ${hm(LAIR_RIPE)}.`);
  console.log('Логова в досягаемости (AI_RANGE) каждого мира — сила при появлении и дозревшая, и она же × AI_POWER_SHARE:');
  let lairMax = 0;
  for (const seed of SEEDS) {
    const world = new LocalWorld({ seed, now: () => START, storage: memory() });
    await world.sync(playerProfile(townAt(1), awayOf([], [])));
    const w = inside(world);
    const near = generateWorld(w.save.seed).settlements.filter((s) => isLair(s) && distance(s, w.save.home) <= AI_RANGE);
    const born = near.map((s) => w.powerNow(s, START));
    const ripe = near.map((s) => w.powerNow(s, START + LAIR_RIPE));
    lairMax = Math.max(lairMax, ...ripe);
    console.log(
      `  мир ${pad(seed, 2)}: логов ${near.length}, при появлении ${Math.round(Math.min(...born))}…${Math.round(Math.max(...born))}, дозревшие ${Math.round(Math.min(...ripe))}…${Math.round(Math.max(...ripe))}; набег не сильнее ${Math.round(Math.max(...ripe) * AI_POWER_SHARE)}`,
    );
  }
  console.log('');
  console.log('Оборона посёлка уровня L (derived.defense; войско — мерка siege:report, всё дома) и новой партии:');
  console.log(' посёлок               оборона  оборона × 0.85  сильнейший набег  доля обороны  лагерь, а не бой');
  const rows: [string, GameState][] = [['новая партия, 30 чел.', (() => { const g = createInitialState(7); g.tutorialDone = true; return g; })()]];
  for (const l of [1, 2, 3, 5, 7, 10]) rows.push([`уровень ${l}, войско ${armyAt(l)}`, townAt(l)]);
  for (const [name, g] of rows) {
    const d = defense(g);
    const top = lairMax * AI_POWER_SHARE;
    console.log(` ${name.padEnd(22)} ${pad(Math.round(d), 7)}  ${pad(Math.round(d * AI_POWER_VS_DEFENSE), 14)}  ${pad(Math.round(Math.min(top, d * AI_POWER_VS_DEFENSE)), 16)}  ${pad(pct(Math.min(top, d * AI_POWER_VS_DEFENSE) / d), 12)}  ${pad(Math.min(top, d * AI_POWER_VS_DEFENSE) < d * SIEGE_IF_BELOW ? 'да' : 'нет', 16)}`);
  }
  console.log('');

  // 2. Живой мир по ступеням.
  const HOURS = 4;
  console.log(`--- 2. Живой мир по ступеням: ${HOURS} ч на каждом из ${SEEDS.length} миров, посёлок уровня L стоит дома, на осаду — вылазкой, войско не нанимает ---`);
  console.log('«сейчас» — игра как есть; «оборона × k» — набег собирается из обороны в минуту выхода, логово силу не ограничивает.');
  console.log('«слагаемое» — у скольких набегов «сейчас» силу задало логово, а не оборона.');
  console.log(`«потери, удержали» и «потери, прорвали» — доля бойцов дома, павших в одном бою у частокола (10-я…медиана…90-я доля),`);
  console.log(`только у боёв, где дома не меньше ${SHARE_FLOOR} бойцов: на двух-трёх людях доля — округление.`);
  console.log('«без войска» / «меньше половины» — доля времени прогона; «падений в час» — прорывы и падения осадой на мир.');
  console.log(' ступень           ур  набегов  доля обороны  у стены  прорвали  лагерей  падений  падений/ч  потери, удержали  потери, прорвали  потеряно  без войска  < половины  войско в конце  уровней снято');
  for (const step of STEPS) {
    for (const level of LEVELS) {
      const runs: Run[] = [];
      for (const seed of SEEDS) runs.push(await play({ g: townAt(level), seed, step, hours: HOURS }));
      const t = tally(runs);
      const total = HOURS * HOUR * SEEDS.length;
      if (step === NOW) {
        const lairBound = sum(runs.map((r) => r.raids.filter((x) => x.lair <= x.def).length));
        console.log(`   (слагаемое: логово — у ${lairBound} из ${t.raids})`);
      }
      console.log(
        ` ${step.name.padEnd(16)}  ${pad(level, 2)}  ${pad(t.raids, 7)}  ${pad(range(t.ratio), 12)}  ${pad(t.walls, 7)}  ${pad(t.walls ? pct(t.broke / t.walls) : '—', 8)}  ${pad(t.sieges, 7)}  ${pad(t.falls, 7)}  ${pad(((t.broke + t.falls) / (HOURS * SEEDS.length)).toFixed(2), 9)}  ${pad(range(t.heldShare), 16)}  ${pad(range(t.brokeShare), 16)}  ${pad(t.lost, 8)}  ${pad(pct(t.none / total), 10)}  ${pad(pct(t.half / total), 10)}  ${pad(Math.round(t.armyEnd / SEEDS.length), 14)}  ${pad(t.levelsLost, 13)}`,
      );
    }
  }
  console.log('');

  // 3. Новичок.
  const NEW_HOURS = 6;
  const NEW_SEEDS = SEEDS.slice(0, 3);
  console.log(`--- 3. Новичок: партия с первой секунды, ${NEW_HOURS} ч непрерывной игры, миры ${NEW_SEEDS.join(', ')} ---`);
  console.log('Племя ведёт автопилот pop:report (строит и ставит людей). «без войска» — не нанимает никого;');
  console.log('«ополчение 10 %» — держит дубинщиков на десятую часть населения (казармы, без снаряжения).');
  console.log(`Защиты: «×k от f за T» — набег = оборона × (f + (k − f) × min(1, возраст города / T)); «пауза» — после прорыва набегов нет SIEGE_IMMUNE (${hm(SIEGE_IMMUNE)}), как нет осады после падения.`);
  const newSteps: Step[] = [
    NOW,
    k(1),
    k(1.2),
    k(1.5),
    ramp(1.2, 0, 4 * HOUR),
    ramp(1.2, 0.5, 4 * HOUR),
    { ...k(1.2), name: '×1.2 + пауза', pause: SIEGE_IMMUNE },
    ramp(1.2, 0.5, 4 * HOUR, SIEGE_IMMUNE),
  ];
  const militia = (g: GameState): void => {
    const want = Math.round(g.pop * 0.1);
    const have = armySize(g) + g.recruits.reduce((n, r) => n + r.count - r.done, 0);
    if (want > have) startRecruit(g, 'clubman', want - have);
  };
  for (const style of ['none', 'militia'] as const) {
    console.log('');
    console.log(`Новичок ${style === 'none' ? 'без войска' : 'с ополчением 10 %'}:`);
    console.log(' ступень                      первое падение, мин…макс  падений  лагерей  уровней снято  добра унесено  люди к 1/2/4/6 ч             ср. уровень к 1/2/4/6 ч      бойцов потеряно');
    for (const step of newSteps) {
      const runs: Run[] = [];
      const pop: number[][] = [[], [], [], []];
      const lvl: number[][] = [[], [], [], []];
      for (const seed of NEW_SEEDS) {
        setRandom(seeded(seed));
        const g = createInitialState(seed);
        g.tutorialDone = true;
        runs.push(
          await play({
            g,
            seed,
            step,
            hours: NEW_HOURS,
            grow: (x) => {
              staff(x);
              build(x);
              if (style === 'militia') militia(x);
            },
            hourly: (h, x) => {
              const i = [1, 2, 4, 6].indexOf(h);
              if (i < 0) return;
              pop[i].push(x.pop);
              lvl[i].push(levelSum(x) / x.buildings.length);
            },
          }),
        );
        setRandom(null);
      }
      const t = tally(runs);
      const first = t.first.length
        ? `${hm(Math.min(...t.first))}…${hm(Math.max(...t.first))}${t.first.length < runs.length ? ` (${t.first.length} из ${runs.length})` : ''}`
        : 'нет';
      console.log(
        ` ${step.name.padEnd(28)} ${pad(first, 24)}  ${pad(t.broke + t.falls, 7)}  ${pad(t.sieges, 7)}  ${pad(t.levelsLost, 13)}  ${pad(Math.round(t.goodsLost), 13)}  ${pop.map((xs) => pad(Math.round(mean(xs)), 5)).join(' ').padEnd(27)}  ${lvl.map((xs) => pad(mean(xs).toFixed(1), 4)).join(' ').padEnd(27)}  ${pad(t.lost, 15)}`,
      );
    }
  }
  console.log('');

  // 4. Долг «оборона средним бойцом».
  console.log('--- 4. Оборона средним бойцом: насколько число расходится с тем, кто дома ---');
  console.log('Посёлок уровня 5, войско 120 по составу MIX; полководец уводит в поле часть войска и стоит в трёх клетках от дома.');
  console.log('«по среднему» — derived.defense (как в игре); «по составу» — то же сложение, но дома те, кто дома.');
  const LEVEL = 5;
  const army = stackOf(armyAt(LEVEL), MIX);
  const cases: { name: string; field: TroopStack }[] = [
    { name: 'увёл тяжёлых (латники, всадники)', field: { legionary: army.legionary, rider: army.rider } },
    { name: 'увёл лёгких (копья, лучники)', field: { spearman: army.spearman, archer: army.archer } },
  ];
  for (const c of cases) {
    const g = townAt(LEVEL, army);
    g.warriorsAway = troopTotal(c.field);
    const home = homeOf(g.army, { ...awayOf([], []), troops: c.field });
    console.log(`  ${c.name}: дома ${troopTotal(home)} бойцов, оборона по среднему ${Math.round(defense(g))}, по составу ${Math.round(exactDefense(g, home))} (${pct(defense(g) / exactDefense(g, home) - 1)})`);
  }
  console.log('');
  console.log(`Прорывы у частокола на тех же ${HOURS} ч × ${SEEDS.length} мирах, набег — ступень «оборона ×1.00»:`);
  console.log(' кого увёл                           оборона в слепке  у стены  прорвали  потери, удержали');
  for (const c of cases) {
    for (const exact of [false, true]) {
      const runs: Run[] = [];
      for (const seed of SEEDS) runs.push(await play({ g: townAt(LEVEL, army), seed, step: k(1), hours: HOURS, field: c.field, exact }));
      const t = tally(runs);
      console.log(` ${c.name.padEnd(34)}  ${pad(exact ? 'по составу' : 'по среднему', 16)}  ${pad(t.walls, 7)}  ${pad(t.walls ? pct(t.broke / t.walls) : '—', 8)}  ${pad(range(t.heldShare), 16)}`);
    }
  }
  console.log('');
  console.log('Состав при равной мощи войска: посёлок уровня 5, всё войско дома, ступень «оборона ×1.00».');
  console.log(' состав                          бойцов  мощь  у стены  прорвали  потери, удержали  потери, прорвали');
  const power = armyPower(townAt(LEVEL, army));
  const mixes: { name: string; mix: TroopStack }[] = [
    { name: 'MIX (копья, лучники, латники, всадники)', mix: MIX },
    { name: 'одни копейщики', mix: { spearman: 1 } },
    { name: 'одни лучники', mix: { archer: 1 } },
    { name: 'одни латники', mix: { legionary: 1 } },
  ];
  for (const m of mixes) {
    const id = Object.keys(m.mix)[0] as TroopId;
    const stack = Object.keys(m.mix).length === 1 ? { [id]: Math.round(power / TROOP_BY_ID[id].power) } : army;
    const runs: Run[] = [];
    for (const seed of SEEDS) runs.push(await play({ g: townAt(LEVEL, stack), seed, step: k(1), hours: HOURS }));
    const t = tally(runs);
    const g = townAt(LEVEL, stack);
    console.log(` ${m.name.padEnd(30)}  ${pad(armySize(g), 6)}  ${pad(armyPower(g), 4)}  ${pad(t.walls, 7)}  ${pad(t.walls ? pct(t.broke / t.walls) : '—', 8)}  ${pad(range(t.heldShare), 16)}  ${pad(range(t.brokeShare), 16)}`);
  }
}
