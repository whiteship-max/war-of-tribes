// Рост логова — раздел `raid:report`.
//
// Меряет игру как она есть после решения владельца (docs/lair_growth.md): набег — всё логово,
// логово растёт от возраста и жителей города, молодой город логово не замечает, осаду решает бой
// у стены, прогнанный всухую, после падения — одно окно. Разделы:
//
//  0. **Опора** — расстояние до замка (`gen.lairAnchor`) и её медиана в досягаемости: с ней
//     сверяется `LAIR_ANCHOR_MID`.
//  1. **Мерка развития** — откуда числа линии и перевода жителей в уровни (`LAIR_*` в
//     `world/data/tuning.ts`): лестница посёлков мерки `siege:report`, наименьшие квадраты, сверка
//     с тем, что стоит в игре. Рядом — почему мерка «жители», а не средний уровень и не ратуша:
//     что каждая прибавляет набегу за уровень постройки и как они идут в живой партии, в том числе
//     у игрока, который ратушу не поднимает (`autopilot.build` с `skip`: поведение автопилота,
//     влияющее на число, видно в отчёте).
//  2. **Ступени** — настоящий мир (`LocalWorld` с племенем и пульсом, как у `world/store`) на
//     посёлках мерки. Строка «игра» — мир как есть. Остальные ступени и «без защиты» — одна
//     подстановка в экземпляр мира: сила вышедшего набега пересчитывается в минуту выхода.
//  3. **Новичок** — партия с первой секунды, мир как есть.
//  4. **Логово как цель** — сжигает ли логово войско мерки и что оно отдаёт.
import { LocalWorld, HOME_ID } from '@/world/local/LocalWorld';
import { applyEffects, playerProfile, syncAway, syncSiege } from '@/world/bridge';
import { awayOf, homeOf } from '@/world/muster';
import { generateWorld, isLair, lairAnchor, type GenSettlement } from '@/world/gen';
import { distance } from '@/world/geo';
import { garrisonOf } from '@/world/garrison';
import { resolveField } from '@/world/battle';
import { ownGearOf } from '@/world/agents';
import { lairArms, lairArmsBase, lairGold, lairLoot, lairPower, lairShield, shieldVillagers } from '@/world/lairs';
import { starvesAt } from '@/world/siege';
import {
  AI_RANGE,
  LAIR_ANCHOR_FAR,
  LAIR_ANCHOR_HOME,
  LAIR_ANCHOR_MID,
  LAIR_ANCHOR_RANGE,
  LAIR_CAP,
  LAIR_LEVEL_BASE,
  LAIR_LEVEL_PER_VILLAGER,
  LAIR_POWER_BASE,
  LAIR_POWER_PER_LEVEL,
  LAIR_RIPE,
  LAIR_SHIELD_FROM,
  LAIR_SHIELD_FULL,
  LAIR_START,
  LAIR_STEP,
  SIEGE_CHANCE,
  SIEGE_IMMUNE,
} from '@/world/data/tuning';
import type { FigureView, HomeEffect, MarchView, PlayerProfile } from '@/world/types';
import { createInitialState } from '@/game/state';
import { tick } from '@/game/sim/tick';
import { autoAssign } from '@/game/sim/workers';
import { startRecruit } from '@/game/sim/army';
import { seeded, setRandom } from '@/game/sim/random';
import { armyPower, armySize, buildingOfType, defense, housingCapacity, idleCount, recruitRate, storageCap, taxIncomePerDay } from '@/game/derived';
import { RESOURCE_IDS } from '@/game/constants';
import { kindsOf, troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { BuildingTypeId, GameState, TroopId } from '@/game/types';
import { TROOP_BY_ID } from '@/game/data/troops';
import { build, staff } from './autopilot';

export const MIN = 60_000;
const HOUR = 60 * MIN;
export const START = 1_700_000_000_000;
export const SEEDS = [7, 11, 42, 51, 77];
export const NEW_SEEDS = SEEDS.slice(0, 3);
const LADDER = [1, 2, 3, 5, 7, 10];
const PULSE = 30;
/** Состав и мерка войска — те же, что у осады и лазарета. */
export const MIX: TroopStack = { spearman: 4, archer: 3, legionary: 2, rider: 1 };
const armyAt = (level: number): number => 2 * (20 + 10 * (level - 1));
const NO_HALL: readonly BuildingTypeId[] = ['town_hall'];

export const pad = (v: string | number, w: number): string => String(v).padStart(w);
export const pct = (x: number): string => `${Math.round(x * 100)}%`;
export const hm = (ms: number): string => {
  const m = Math.round(ms / MIN);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')}` : `${m} мин`;
};
export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);
export const q = (xs: number[], p: number): number => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const range = (xs: number[]): string => (xs.length ? `${pct(q(xs, 0.1))}…${pct(q(xs, 0.5))}…${pct(q(xs, 0.9))}` : '—');

function stackOf(n: number, mix: TroopStack = MIX): TroopStack {
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

/**
 * Посёлок уровня L: жильё на 90 %, склад полон, войско — `armyAt` по составу. Мерка `siege:report`.
 * `over` — уровни отдельных построек поверх L (жители дорастают до новых крыш).
 */
export function townAt(level: number, over: Record<string, number> = {}): GameState {
  const g = createInitialState(7);
  g.tutorialDone = true;
  for (const b of g.buildings) b.level = over[b.type] ?? level;
  g.pop = Math.round(housingCapacity(g) * 0.9);
  for (const [id, n] of Object.entries(stackOf(armyAt(level)))) g.army[id as TroopId] = n ?? 0;
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

/** Средний уровень построек из слепка (`PlayerProfile.levels`, всё, кроме тайника). */
const levelOf = (p: PlayerProfile | null | undefined): number => {
  const v = Object.values(p?.levels ?? {});
  return v.length ? sum(v) / v.length : 1;
};

/** Наименьшие квадраты y = a·x + b и худшее отклонение в долях. */
function fit(xs: number[], ys: number[]): { a: number; b: number; worst: number } {
  const mx = mean(xs);
  const my = mean(ys);
  const a = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / sum(xs.map((x) => (x - mx) ** 2));
  const b = my - a * mx;
  const worst = Math.max(...xs.map((x, i) => Math.abs(a * x + b - ys[i]) / ys[i]));
  return { a, b, worst };
}

// ---------- Прогон ----------

/**
 * Как считается сила вышедшего набега. `rho` null и `shield` — игра как есть. Иначе ступень
 * `rho` вместо `LAIR_STEP`, а `shield: false` снимает защиту новичка (набег выходит полной силой).
 */
export interface Step {
  name: string;
  rho: number | null;
  shield: boolean;
}
export const GAME: Step = { name: 'игра', rho: null, shield: true };

export interface Wall {
  held: boolean;
  home: number;
  lost: number;
  /** Когда бой случился, мс от начала прогона. */
  at: number;
}
export interface Run {
  raids: number;
  ratio: number[];
  walls: Wall[];
  sieges: number;
  sorties: number;
  sortieWins: number;
  siegeFalls: number;
  lost: number;
  half: number;
  armyEnd: number;
  hired: number;
  losses: number[];
  /** Окно голода каждой осады в минуту, когда лагерь встал, мс. */
  hunger: number[];
}

export interface Play {
  g: GameState;
  seed: number;
  step: Step;
  hours: number;
  /** Оборона, от которой считать долю набега: мерка посёлка. Нет — оборона слепка. */
  ref?: number;
  /** Войско держат полным: пополнение между пульсами (без цены — это граница, а не найм). */
  refill?: boolean;
  /** Логова дозрели до начала прогона: мир живёт с тех пор `LAIR_RIPE`. */
  ripe?: boolean;
  grow?: (g: GameState) => void;
  /**
   * На осаду — нанять дубинщиков числом с мощь лагеря (втрое больше его людей: воин лагеря — три
   * мощи), но не больше свободных рук: заказ
   * сверх них игра отклоняет целиком, и стратегия, просившая всё разом, не нанимала никого.
   */
  hire?: boolean;
  hourly?: (h: number, g: GameState) => void;
  /**
   * Последствие мира до того, как оно легло в племя: раздел найма (`raid-hiring.ts`) смотрит на
   * него и подменяет в нём уведённых людей. Без крючка прогон тот же.
   */
  effect?: (e: HomeEffect, now: number) => void;
  /** После каждого пульса, до ответа на осаду: раздел найма ведёт здесь полководца и считает войско. */
  after?: (x: { g: GameState; world: LocalWorld; now: number; marches: MarchView[]; figures: FigureView[] }) => Promise<void> | void;
}

/** Настоящее состояние мира: отчёт — прибор, ему положено видеть больше панели. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Inside = any;

export async function play(o: Play): Promise<Run> {
  const { g, step } = o;
  let now = START;
  const world = new LocalWorld({ seed: o.seed, now: () => now, storage: memory() });
  const w: Inside = world;
  const run: Run = { raids: 0, ratio: [], walls: [], sieges: 0, sorties: 0, sortieWins: 0, siegeFalls: 0, lost: 0, half: 0, armyEnd: 0, hired: 0, losses: [], hunger: [] };

  const schedule = w.scheduleAi.bind(w);
  w.scheduleAi = (at: number) => {
    const before = new Set(w.save.marches.map((m: Inside) => m.id));
    const profile: PlayerProfile | undefined = w.save.profile;
    // Без защиты: логово замечает город любой величины. Жители подменяются только на время
    // решения «выходить ли» — сила набега ниже пересчитывается по настоящим.
    const pop = profile?.pop ?? 0;
    if (!step.shield && profile) profile.pop = Math.max(pop, shieldVillagers(1));
    schedule(at);
    if (profile) profile.pop = pop;
    for (const m of w.save.marches) {
      if (before.has(m.id) || m.own || m.targetId !== HOME_ID) continue;
      if (step.rho !== null || !step.shield) {
        const src = w.gen.settlements.find((s: GenSettlement) => s.id === m.fromId);
        const shield = step.shield ? lairShield(pop) : 1;
        m.power = Math.max(2, (w.powerNow(src, at) * (step.rho ?? LAIR_STEP) * shield) / LAIR_STEP);
        m.units = { warrior: Math.max(1, Math.round(m.power / 3)) };
      }
      run.raids++;
      const d = o.ref ?? profile?.defense ?? 0;
      if (d > 0) run.ratio.push(m.power / d);
    }
  };
  if (o.ripe) w.save.createdAt = START - LAIR_RIPE;

  let marches: MarchView[] = [];
  let figures: FigureView[] = [];
  let homeBefore = 0;
  const full = { ...g.army };
  const seen = new Set<number>();
  const pulse = async () => {
    if (o.refill) Object.assign(g.army, full);
    const away = awayOf(marches, figures);
    homeBefore = troopTotal(homeOf(g.army, away));
    const p = await world.sync(playerProfile(g, away));
    for (const e of p.effects as HomeEffect[]) {
      o.effect?.(e, p.now - START);
      applyEffects(g, [e]);
      const lost = troopTotal(e.lostTroops ?? {});
      run.lost += lost;
      if (e.id.endsWith('-defense') && e.battle) {
        run.walls.push({ held: e.battle === 'won', home: homeBefore, lost, at: p.now - START });
        if (e.battle === 'lost') run.losses.push(p.now - START);
      }
      if (e.id.endsWith('-fell')) {
        run.siegeFalls++;
        run.losses.push(p.now - START);
      }
      if (e.id.startsWith('sortie') && e.id.endsWith('-eff')) {
        run.sorties++;
        if (e.battle === 'won') run.sortieWins++;
      }
    }
    run.sieges += p.reports.filter((r) => r.kind === 'defense' && !r.battle && r.id.endsWith('-siege')).length;
    const open = w.save.sieges[HOME_ID];
    if (open && (open.sinceAt ?? open.startedAt) === open.startedAt && !seen.has(open.startedAt)) {
      seen.add(open.startedAt);
      run.hunger.push(starvesAt(open) - open.startedAt);
    }
    syncAway(g, p.marches, p.figures);
    syncSiege(g, p.siege, p.now);
    marches = p.marches;
    figures = p.figures;
    return p;
  };

  await pulse();
  if (o.ripe) w.save.createdAt = START - LAIR_RIPE;
  const start = armySize(g);
  let lastSortie = 0;
  let hour = 1;
  while (now < START + o.hours * HOUR) {
    now += PULSE * 1000;
    if (o.grow) {
      o.grow(g);
      for (let i = 0; i < PULSE; i++) tick(g, 1);
    }
    const p = await pulse();
    await o.after?.({ g, world, now: now - START, marches, figures });
    if (start > 0 && armySize(g) < start / 2) run.half += PULSE * 1000;
    if (p.siege) {
      const home = homeOf(g.army, awayOf(marches, figures));
      if (o.hire) {
        const camp = w.save.marches.find((m: Inside) => m.id === w.save.sieges[HOME_ID]?.campId);
        const want = camp ? Math.ceil(camp.power) : 0;
        const have = troopTotal(home) + g.recruits.reduce((n, r) => n + r.count - r.done, 0);
        const n = Math.min(want - have, idleCount(g));
        if (n > 0 && startRecruit(g, 'clubman', n) === null) run.hired += n;
      }
      if (now - lastSortie > 5 * MIN && troopTotal(home) > 0) {
        await world.sortie(home);
        lastSortie = now;
      }
    }
    if (o.hourly && now - START >= hour * HOUR) {
      o.hourly(hour, g);
      hour++;
    }
  }
  run.armyEnd = armySize(g);
  return run;
}

/** С какого числа бойцов дома доля павших в бою что-то значит. */
const SHARE_FLOOR = 10;

export function tally(runs: Run[], hours: number) {
  const walls = runs.flatMap((r) => r.walls);
  const broke = walls.filter((x) => !x.held).length;
  const falls = sum(runs.map((r) => r.siegeFalls));
  const sieges = sum(runs.map((r) => r.sieges));
  return {
    raids: sum(runs.map((r) => r.raids)),
    ratio: range(runs.flatMap((r) => r.ratio)),
    walls: walls.length,
    broke: walls.length ? pct(broke / walls.length) : '—',
    sieges,
    siegeShare: walls.length + sieges ? pct(sieges / (walls.length + sieges)) : '—',
    sorties: `${sum(runs.map((r) => r.sortieWins))} из ${sum(runs.map((r) => r.sorties))}`,
    falls,
    perHour: ((broke + falls) / (hours * runs.length)).toFixed(2),
    held: range(walls.filter((x) => x.held && x.home >= SHARE_FLOOR).map((x) => x.lost / x.home)),
    half: pct(sum(runs.map((r) => r.half)) / (hours * HOUR * runs.length)),
    armyEnd: Math.round(mean(runs.map((r) => r.armyEnd))),
    lost: sum(runs.map((r) => r.lost)),
    hired: sum(runs.map((r) => r.hired)),
    first: runs.filter((r) => r.losses.length).map((r) => r.losses[0]),
    hunger: runs.flatMap((r) => r.hunger),
  };
}

// ---------- Печать ----------

export async function lairGrowthSection(): Promise<void> {
  console.log('');
  console.log('=== Рост логова: откуда набег берёт силу ===');

  // 0. Опора.
  console.log('');
  console.log('--- 0. Опора ---');
  console.log(
    `gen.lairAnchor(home, at) = LAIR_ANCHOR_HOME ${LAIR_ANCHOR_HOME} + (LAIR_ANCHOR_FAR ${LAIR_ANCHOR_FAR} − HOME) × min(1, расстояние / LAIR_ANCHOR_RANGE ${LAIR_ANCHOR_RANGE}).`,
  );
  console.log('Аргументов у неё два — клетка дома и клетка логова; о городе она не знает ничего.');
  const anchors: number[] = [];
  for (const seed of SEEDS) {
    const world = new LocalWorld({ seed, now: () => START, storage: memory() });
    await world.sync(playerProfile(townAt(1), awayOf([], [])));
    const w: Inside = world;
    const near = generateWorld(w.save.seed).settlements.filter((s) => isLair(s) && distance(s, w.save.home) <= AI_RANGE);
    const own = near.map((s) => lairAnchor(w.save.home, s));
    anchors.push(...own);
    console.log(`  мир ${pad(seed, 2)}: логов в досягаемости ${near.length}, опора ${own.map((x) => Math.round(x)).join(', ')}`);
  }
  const anchor = q(anchors, 0.5);
  console.log(`Медианная опора логов в досягаемости: ${Math.round(anchor)}; в игре LAIR_ANCHOR_MID ${LAIR_ANCHOR_MID}.`);

  // 1. Мерка развития.
  console.log('');
  console.log('--- 1. Мерка развития: что из слепка повторяет оборону посёлка мерки ---');
  console.log('Посёлок уровня L — мерка siege:report: все постройки уровня L, жильё на 90 %, войско 2 × (20 + 10 × (L − 1)) по составу MIX.');
  console.log('На этой лестнице ратуша — тоже L: средний уровень и ратуша на ней неразличимы, расходятся они в живой партии (раздел 1б).');
  console.log(' уровень  ср. уровень в слепке  ратуша  жителей  людей с войском  оборона');
  const lv: number[] = [];
  const hall: number[] = [];
  const pops: number[] = [];
  const people: number[] = [];
  const defs: number[] = [];
  for (const l of LADDER) {
    const g = townAt(l);
    const p = playerProfile(g, awayOf([], []));
    lv.push(levelOf(p));
    hall.push(p.levels?.town_hall ?? 1);
    pops.push(p.pop);
    people.push(p.pop + troopTotal(p.army ?? {}));
    defs.push(defense(g));
    console.log(` ${pad(l, 7)}  ${pad(levelOf(p).toFixed(1), 20)}  ${pad(hall[hall.length - 1], 6)}  ${pad(p.pop, 7)}  ${pad(people[people.length - 1], 15)}  ${pad(Math.round(defense(g)), 7)}`);
  }
  const byLevel = fit(lv, defs);
  const byHall = fit(hall, defs);
  const byPop = fit(pops, defs);
  const byPeople = fit(people, defs);
  const popToLevel = fit(pops, LADDER);
  console.log(`Оборона ≈ ${byLevel.a.toFixed(1)} × ср. уровень + ${byLevel.b.toFixed(1)}; худшее отклонение ${pct(byLevel.worst)}.`);
  console.log(`Оборона ≈ ${byHall.a.toFixed(1)} × ратуша + ${byHall.b.toFixed(1)}; худшее отклонение ${pct(byHall.worst)}.`);
  console.log(`Оборона ≈ ${byPop.a.toFixed(2)} × жителей + ${byPop.b.toFixed(1)}; худшее отклонение ${pct(byPop.worst)}.`);
  console.log(`Оборона ≈ ${byPeople.a.toFixed(2)} × людей с войском + ${byPeople.b.toFixed(1)}; худшее отклонение ${pct(byPeople.worst)}.`);
  console.log(`Жители в уровнях лестницы: L ≈ ${popToLevel.a.toFixed(4)} × жителей + ${popToLevel.b.toFixed(2)}; худшее отклонение ${pct(popToLevel.worst)}.`);
  console.log(
    `В игре (world/data/tuning.ts): LAIR_POWER_PER_LEVEL ${LAIR_POWER_PER_LEVEL}, LAIR_POWER_BASE ${LAIR_POWER_BASE}, ` +
      `LAIR_LEVEL_PER_VILLAGER ${LAIR_LEVEL_PER_VILLAGER}, LAIR_LEVEL_BASE ${LAIR_LEVEL_BASE}; ступень LAIR_STEP ${LAIR_STEP} (временная).`,
  );
  console.log(
    `Защита новичка LAIR_SHIELD_FROM ${LAIR_SHIELD_FROM} → LAIR_SHIELD_FULL ${LAIR_SHIELD_FULL} уровней лестницы — это ${shieldVillagers(0)}→${shieldVillagers(1)} жителей.`,
  );

  // Линии мерок — выведенные выше; по ним сравниваются мерки, в игре стоит одна — жители.
  type Base = 'level' | 'hall' | 'pop';
  const devOf = (b: Base, p: PlayerProfile): number =>
    b === 'hall' ? (p.levels?.town_hall ?? 1) : b === 'pop' ? Math.max(0, popToLevel.a * p.pop + popToLevel.b) : levelOf(p);
  const raidAt = (b: Base, p: PlayerProfile): number => LAIR_STEP * (byLevel.a * devOf(b, p) + byLevel.b);
  const shieldAt = (dev: number): number =>
    Math.min(1, Math.max(0, (dev - LAIR_SHIELD_FROM) / (LAIR_SHIELD_FULL - LAIR_SHIELD_FROM)));

  console.log(`Набег ступени ${LAIR_STEP.toFixed(2)} на лестнице по мерке (ср. уровень и ратуша на ней совпадают):`);
  console.log(' уровень  оборона  по ср. уровню / ратуше  по жителям  жители к ср. уровню');
  LADDER.forEach((l, i) => {
    const byL = LAIR_STEP * (byLevel.a * l + byLevel.b);
    const byP = LAIR_STEP * (byLevel.a * (popToLevel.a * pops[i] + popToLevel.b) + byLevel.b);
    console.log(` ${pad(l, 7)}  ${pad(Math.round(defs[i]), 7)}  ${pad(Math.round(byL), 22)}  ${pad(Math.round(byP), 10)}  ${pad(pct(byP / byL), 19)}`);
  });

  // Рост от развития не должен окольно наказывать за укрепления: уровень постройки, дающей
  // оборону, обязан прибавлять обороны больше, чем он же прибавляет набегу. Жители дорастают до
  // новых крыш — поэтому посёлок собирается заново, а не правится одна постройка.
  const base = townAt(5);
  const baseP = playerProfile(base, awayOf([], []));
  const keys = Object.keys(baseP.levels ?? {}).length;
  console.log('');
  console.log(`Что прибавляет уровень одной постройки: посёлок уровня 5 → эта постройка на 6, жители дорастают до крыш; набег ступени ${LAIR_STEP.toFixed(2)} по каждой мерке (построек в слепке ${keys}).`);
  console.log(' постройка        обороны  набега: ср. уровень  ратуша  жители');
  for (const b of base.buildings) {
    const up = townAt(5, { [b.type]: 6 });
    const upP = playerProfile(up, awayOf([], []));
    const gain = defense(up) - defense(base);
    const raids = (['level', 'hall', 'pop'] as Base[]).map((x) => raidAt(x, upP) - raidAt(x, baseP));
    if (gain <= 0.5 && raids.every((x) => x <= 0.5)) continue;
    console.log(` ${b.type.padEnd(15)}  ${pad(gain.toFixed(1), 7)}  ${pad(raids[0].toFixed(1), 19)}  ${pad(raids[1].toFixed(1), 6)}  ${pad(raids[2].toFixed(1), 6)}`);
  }
  const g0 = createInitialState(7);
  console.log(
    `Посёлок без войска на той же лестнице — новая партия (ср. уровень 1): оборона ${Math.round(defense(g0))}, линия ${Math.round(byLevel.a + byLevel.b)} — ${pct(defense(g0) / (byLevel.a + byLevel.b))}.`,
  );

  // 1б. Живая партия.
  const NEW_HOURS = 6;
  const HOURS_AT = [1, 2, 4, 6];
  console.log('');
  console.log(`--- 1б. Мерки в живой партии: автопилот pop:report, ${NEW_HOURS} ч, миры ${NEW_SEEDS.join(', ')}, без мира ---`);
  console.log('«обычный» — автопилот как есть; «без ратуши» — тот же автопилот, который ратушу не поднимает никогда (build с skip).');
  console.log(`«набег» — набег дозревшего логова медианной опоры по мерке: ступень ${LAIR_STEP.toFixed(2)} × линия × защита (у жителей ${LAIR_SHIELD_FROM}→${LAIR_SHIELD_FULL}, у уровня и ратуши — 3→6, как мерились до выбора); «оборона» — посёлка без войска.`);
  console.log(' партия       ч  ср. уровень  ратуша  жителей  жители в L  оборона  набег: ср. уровень  ратуша  жители');
  for (const style of ['обычный', 'без ратуши'] as const) {
    const rows: { lv: number; th: number; pop: number; e: number; def: number; raid: number[] }[][] = HOURS_AT.map(() => []);
    for (const seed of NEW_SEEDS) {
      setRandom(seeded(seed));
      const g = createInitialState(seed);
      g.tutorialDone = true;
      for (let t = 1; t <= NEW_HOURS * 3600; t++) {
        if (t % PULSE === 0) {
          staff(g);
          build(g, style === 'без ратуши' ? NO_HALL : []);
        }
        tick(g, 1);
        const i = HOURS_AT.indexOf(t / 3600);
        if (i >= 0) {
          const p = playerProfile(g, awayOf([], []));
          const raid = (['level', 'hall', 'pop'] as Base[]).map((b) => {
            const dev = devOf(b, p);
            const sh = b === 'pop' ? shieldAt(dev) : Math.min(1, Math.max(0, (dev - 3) / 3));
            return raidAt(b, p) * sh;
          });
          rows[i].push({ lv: levelOf(p), th: p.levels?.town_hall ?? 1, pop: p.pop, e: devOf('pop', p), def: defense(g), raid });
        }
      }
      setRandom(null);
    }
    HOURS_AT.forEach((h, i) => {
      const r = rows[i];
      const m = (f: (x: (typeof r)[number]) => number): number => mean(r.map(f));
      console.log(
        ` ${style.padEnd(11)}  ${pad(h, 1)}  ${pad(m((x) => x.lv).toFixed(1), 11)}  ${pad(m((x) => x.th).toFixed(1), 6)}  ${pad(Math.round(m((x) => x.pop)), 7)}  ${pad(m((x) => x.e).toFixed(1), 10)}  ${pad(Math.round(m((x) => x.def)), 7)}  ${pad(Math.round(m((x) => x.raid[0])), 18)}  ${pad(Math.round(m((x) => x.raid[1])), 6)}  ${pad(Math.round(m((x) => x.raid[2])), 6)}`,
      );
    });
  }

  // 2. Ступени.
  const HOURS = 4;
  const LEVELS = [1, 5, 10];
  const step = (rho: number, shield = false): Step => ({ name: `${rho.toFixed(2)}${shield ? '' : ', без защиты'}`, rho, shield });
  console.log('');
  console.log(`--- 2. Ступени: ${HOURS} ч на каждом из ${SEEDS.length} миров, посёлок уровня L стоит дома, на осаду — вылазкой, логова дозрели ---`);
  console.log('«игра» — мир как есть. Остальные строки — сила вышедшего набега пересчитана в минуту выхода: другая ступень вместо LAIR_STEP');
  console.log('и «без защиты» — набег выходит полной силой логова при любых жителях (у посёлков мерки 1–5 уровней жителей меньше порога защиты).');
  console.log(`Осада — если бой у стены отбит (сухой прогон, кость SIEGE_CHANCE ${SIEGE_CHANCE}, остывание); после прорыва и падения осадой — одно окно SIEGE_IMMUNE (${hm(SIEGE_IMMUNE)}).`);
  console.log('«набег / оборона» — доля обороны мерки (10-я…медиана…90-я); «потери, удержали» — доля бойцов дома, павших в удержанном бою, у боёв, где дома не меньше 10;');
  console.log('«доля осад» — лагерей от всех пришедших; «падений/ч» — прорывы и падения осадой на мир.');
  const header = ' ступень              ур  жителей  набегов  набег / оборона  у стены  прорвали  лагерей  доля осад  вылазки   падений осадой  падений/ч  потери, удержали  < половины  войско в конце';
  const row = (name: string, level: number, t: ReturnType<typeof tally>): string =>
    ` ${name.padEnd(20)} ${pad(level, 2)}  ${pad(townAt(level).pop, 7)}  ${pad(t.raids, 7)}  ${pad(t.ratio, 15)}  ${pad(t.walls, 7)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.siegeShare, 9)}  ${pad(t.sorties, 8)}  ${pad(t.falls, 14)}  ${pad(t.perHour, 9)}  ${pad(t.held, 16)}  ${pad(t.half, 10)}  ${pad(t.armyEnd, 14)}`;
  const ladder = async (steps: Step[], levels: number[], refill: boolean): Promise<void> => {
    console.log(header);
    for (const s of steps) {
      for (const level of levels) {
        const runs: Run[] = [];
        const ref = defense(townAt(level));
        for (const seed of SEEDS) runs.push(await play({ g: townAt(level), seed, step: s, hours: HOURS, ref, refill, ripe: true }));
        console.log(row(s.name, level, tally(runs, HOURS)));
      }
    }
  };
  console.log('');
  console.log('Войско держат полным — пополняется между пульсами даром. Это граница «сколько стоит бой», а не найм: найм — следующий замер.');
  await ladder([GAME, step(0.8), step(0.9), step(1), step(1.1)], LEVELS, true);
  console.log('');
  console.log('Без найма — войско не пополняется:');
  await ladder([GAME, step(0.9)], LEVELS, false);
  console.log('');
  console.log('Игра на посёлках мерки 7 и 8 уровней (жителей у них больше порога защиты), войско держат полным:');
  await ladder([GAME], [7, 8], true);

  // 3. Новичок.
  console.log('');
  console.log(`--- 3. Новичок: партия с первой секунды, ${NEW_HOURS} ч непрерывной игры, миры ${NEW_SEEDS.join(', ')}, мир как есть ---`);
  console.log('Племя ведёт автопилот pop:report. «без войска» — не нанимает никого; «нанимает на осаду» — на лагерь нанимает дубинщиков втрое больше');
  console.log('людей лагеря, но не больше свободных рук (заказ сверх них игра отклоняет целиком), и выходит; «ополчение 10 %» — держит дубинщиков');
  console.log('на десятую часть населения; «ополчение, без ратуши» — то же, но ратушу');
  console.log('автопилот не поднимает никогда (build с skip). Логова молоды: мир начинается с партией. «набег / оборона» — к обороне слепка в минуту выхода.');
  const fresh = createInitialState(7);
  console.log(`Дубинщик на казармах новой партии нанимается за ${Math.round(TROOP_BY_ID.clubman.work / recruitRate(fresh, 'clubman'))} с (work / recruitRate). «окно голода» — от минуты, когда лагерь встал, до голода (siege.starvesAt), мин…макс.`);
  const militia = (g: GameState): void => {
    const want = Math.round(g.pop * 0.1);
    const have = armySize(g) + g.recruits.reduce((n, r) => n + r.count - r.done, 0);
    if (want > have) startRecruit(g, 'clubman', want - have);
  };
  const STYLE_NAME = { none: 'без войска', hire: 'нанимает на осаду', militia: 'с ополчением 10 %', nohall: 'с ополчением 10 %, без ратуши' };
  console.log(' новичок                        набегов  набег / оборона  первое падение, мин…макс  прорвали  лагерей  окно голода        падений осадой  падений/ч  нанято  бойцов потеряно  люди к 1/2/4/6 ч      ср. уровень к 1/2/4/6 ч  ратуша к 6 ч');
  for (const style of ['none', 'hire', 'militia', 'nohall'] as const) {
    const runs: Run[] = [];
    const pop: number[][] = [[], [], [], []];
    const lvl: number[][] = [[], [], [], []];
    const th: number[] = [];
    for (const seed of NEW_SEEDS) {
      setRandom(seeded(seed));
      const g = createInitialState(seed);
      g.tutorialDone = true;
      runs.push(
        await play({
          g,
          seed,
          step: GAME,
          hours: NEW_HOURS,
          hire: style === 'hire',
          grow: (x) => {
            staff(x);
            build(x, style === 'nohall' ? NO_HALL : []);
            if (style === 'militia' || style === 'nohall') militia(x);
          },
          hourly: (h, x) => {
            const i = HOURS_AT.indexOf(h);
            if (i < 0) return;
            pop[i].push(x.pop);
            lvl[i].push(sum(x.buildings.map((b) => b.level)) / x.buildings.length);
            if (h === NEW_HOURS) th.push(buildingOfType(x, 'town_hall')?.level ?? 1);
          },
        }),
      );
      setRandom(null);
    }
    const t = tally(runs, NEW_HOURS);
    const first = t.first.length
      ? `${hm(Math.min(...t.first))}…${hm(Math.max(...t.first))}${t.first.length < runs.length ? ` (${t.first.length} из ${runs.length})` : ''}`
      : 'нет';
    console.log(
      ` ${STYLE_NAME[style].padEnd(30)} ${pad(t.raids, 7)}  ${pad(t.ratio, 15)}  ${pad(first, 24)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.hunger.length ? `${hm(Math.min(...t.hunger))}…${hm(Math.max(...t.hunger))}` : '—', 17)}  ${pad(t.falls, 14)}  ${pad(t.perHour, 9)}  ${pad(t.hired, 6)}  ${pad(t.lost, 15)}  ${pop.map((xs) => pad(Math.round(mean(xs)), 4)).join(' ').padEnd(20)}  ${lvl.map((xs) => pad(mean(xs).toFixed(1), 4)).join(' ').padEnd(23)}  ${pad(mean(th).toFixed(1), 12)}`,
    );
  }

  // 4. Логово как цель.
  console.log('');
  console.log('--- 4. Логово как цель: сжигает ли его войско мерки и что оно отдаёт ---');
  console.log('Полководец ведёт всё войско мерки уровня L против гарнизона логова (garrisonOf, как в attackAt), 40 боёв на строку;');
  console.log('логово медианной опоры при жителях посёлка мерки этого уровня (lairs.lairPower). «дозрело» — доля пути LAIR_START → LAIR_CAP.');
  console.log('Добыча — lairLoot / lairGold от силы логова, оружие — lairArms от прежней силы без жителей (lairArmsBase); налог — taxIncomePerDay посёлка мерки.');
  console.log(' ур  жителей  войско  мощь войска  налог/день  дозрело  сила логова  победа  добро  золото  золото в днях налога  оружие');
  const N = 40;
  for (const level of LEVELS) {
    const g = townAt(level);
    const troops = { ...g.army };
    for (const r of [0, 0.5, 1]) {
      const rec = { bornAt: 0, burnedAt: 0 };
      const at = LAIR_RIPE * r;
      const power = lairPower(LAIR_ANCHOR_MID, rec, at, g.pop);
      let won = 0;
      for (let seed = 1; seed <= N; seed++) {
        const gar = garrisonOf(seed, `lair${seed}`, power, false);
        const f = resolveField({
          seed: seed * 7919,
          attacker: { kinds: kindsOf(troops), gear: ownGearOf(troops, 0), resolve: 0, setup: null },
          defender: { kinds: gar.kinds, gear: gar.gear, setup: gar.setup },
        });
        if (f.won) won++;
      }
      console.log(
        ` ${pad(level, 2)}  ${pad(g.pop, 7)}  ${pad(armySize(g), 6)}  ${pad(armyPower(g), 11)}  ${pad(Math.round(taxIncomePerDay(g)), 10)}  ${pad(pct(r), 7)}  ${pad(Math.round(power), 11)}  ${pad(pct(won / N), 6)}  ${pad(lairLoot(power), 5)}  ${pad(lairGold(power), 6)}  ${pad((lairGold(power) / taxIncomePerDay(g)).toFixed(1), 20)}  ${pad(lairArms(lairArmsBase(LAIR_ANCHOR_MID, rec, at)), 6)}`,
      );
    }
  }
  console.log(`Оружие дозревшего логова медианной опоры при любых жителях — ${lairArms(lairArmsBase(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE))} (LAIR_CAP ${LAIR_CAP}, LAIR_START ${LAIR_START}).`);
}
