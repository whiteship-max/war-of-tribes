// Рост логова — отчёт `raid-growth:report` (прежде — раздел `raid:report`).
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
//  2. **Ступени** — настоящий мир с племенем и пульсом (общий автопилот `scripts/autopilot.ts`, пульс
//     `bridge.tribePulse` — тот же, что у `world/store`) на посёлках мерки. Строка «игра» — мир как есть. Остальные ступени и «без защиты» — одна
//     подстановка в экземпляр мира: сила вышедшего набега пересчитывается в минуту выхода.
//  3. **Новичок** — партия с первой секунды, мир как есть.
//  4. **Логово как цель** — сжигает ли логово войско мерки и что оно отдаёт.
import { LocalWorld } from '@/world/local/LocalWorld';
import { playerProfile } from '@/world/bridge';
import { awayOf } from '@/world/muster';
import { generateWorld, isLair, lairAnchor } from '@/world/gen';
import { distance } from '@/world/geo';
import { garrisonOf } from '@/world/garrison';
import { resolveField } from '@/world/battle';
import { ownGearOf } from '@/world/agents';
import { lairArms, lairArmsBase, lairGold, lairLoot, lairPower, shieldVillagers } from '@/world/lairs';
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
import type { PlayerProfile } from '@/world/types';
import { createInitialState } from '@/game/state';
import { startRecruit } from '@/game/sim/army';
import { seeded, setRandom } from '@/game/sim/random';
import { armyPower, armySize, buildingOfType, defense, recruitRate, taxIncomePerDay } from '@/game/derived';
import { kindsOf, troopTotal } from '@/game/battle/kinds';
import type { BuildingTypeId, GameState } from '@/game/types';
import { TROOP_BY_ID } from '@/game/data/troops';
import { GAME, START, memory, pilot, player, townAt, unitsNote, type Inside, type Run, type Step } from './autopilot';
import { fan, serveFan } from './lib/fan';
import { NEW_SEEDS, SEEDS, hm, mean, pad, pct, q, sum, tally } from './raid-common';

const LADDER = [1, 2, 3, 5, 7, 10];
/** Пульс мира и такт решений автопилота в прогонах раздела, с. */
const PULSE = 30;
const NO_HALL: readonly BuildingTypeId[] = ['town_hall'];


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


/** Линия мерки, выведенная в разделе 1: наклон, сдвиг и худшее отклонение. */
type Line = ReturnType<typeof fit>;
/** Мерки развития, по которым сравнивается набег; в игре стоит одна — жители. */
type Base = 'level' | 'hall' | 'pop';
/** Линии раздела 1, которыми меряется набег в живой партии (раздел 1б). */
interface Lines {
  byLevel: Line;
  popToLevel: Line;
}

const devOf = (lines: Lines, b: Base, p: PlayerProfile): number =>
  b === 'hall' ? (p.levels?.town_hall ?? 1) : b === 'pop' ? Math.max(0, lines.popToLevel.a * p.pop + lines.popToLevel.b) : levelOf(p);
const raidAt = (lines: Lines, b: Base, p: PlayerProfile): number => LAIR_STEP * (lines.byLevel.a * devOf(lines, b, p) + lines.byLevel.b);
const shieldAt = (dev: number): number => Math.min(1, Math.max(0, (dev - LAIR_SHIELD_FROM) / (LAIR_SHIELD_FULL - LAIR_SHIELD_FROM)));

const NEW_HOURS = 6;
const HOURS_AT = [1, 2, 4, 6];
/** Срок прогона раздела 2 («Ступени»). */
const STEP_HOURS = 4;

/** Срез живой партии раздела 1б к часу из `HOURS_AT`. */
interface QuietRow {
  lv: number;
  th: number;
  pop: number;
  e: number;
  def: number;
  raid: number[];
}

/** Задача веера (`lib/fan.ts`): живая партия раздела 1б в тихом мире на одном мире. */
export async function quietRun({ style, seed, lines }: { style: 'обычный' | 'без ратуши'; seed: number; lines: Lines }): Promise<(QuietRow | undefined)[]> {
  const rows: (QuietRow | undefined)[] = [];
  setRandom(seeded(seed));
  const g = createInitialState(seed);
  g.tutorialDone = true;
  await pilot({
    g,
    seconds: NEW_HOURS * 3600,
    player: player(null, { build: { skip: style === 'без ратуши' ? NO_HALL : [] } }),
    world: { seed, pulse: PULSE, raids: false },
    economy: 'live',
    tick: 1,
    decide: PULSE,
    watch: {
      hourly: (h, x) => {
        const i = HOURS_AT.indexOf(h);
        if (i < 0) return;
        const p = playerProfile(x, awayOf([], []));
        const raid = (['level', 'hall', 'pop'] as Base[]).map((b) => {
          const dev = devOf(lines, b, p);
          const sh = b === 'pop' ? shieldAt(dev) : Math.min(1, Math.max(0, (dev - 3) / 3));
          return raidAt(lines, b, p) * sh;
        });
        rows[i] = { lv: levelOf(p), th: p.levels?.town_hall ?? 1, pop: p.pop, e: devOf(lines, 'pop', p), def: defense(x), raid };
      },
    },
  });
  setRandom(null);
  return rows;
}

/** Задача веера (`lib/fan.ts`): посёлок мерки уровня `level` стоит дома под ступенью `s` на одном мире (раздел 2). */
export async function stepRun({ s, level, seed, refill }: { s: Step; level: number; seed: number; refill: boolean }): Promise<Run> {
  const flown = await pilot({
    g: townAt(level),
    seconds: STEP_HOURS * 3600,
    // Посёлок мерки стоит: уровни, склад и войско такие, какими их поставил отчёт. Игрок
    // только выходит на осаду вылазкой.
    player: player(null, { staff: false, build: false }),
    world: { seed, pulse: PULSE, raids: true, ripe: true, step: s, ref: defense(townAt(level)) },
    economy: 'frozen',
    tick: 1,
    decide: PULSE,
    refill,
  });
  return flown.run;
}

type Newbie = 'none' | 'hire' | 'militia' | 'nohall';

const militia = (g: GameState): void => {
  const want = Math.round(g.pop * 0.1);
  const have = armySize(g) + g.recruits.reduce((n, r) => n + r.count - r.done, 0);
  if (want > have) startRecruit(g, 'clubman', want - have);
};

/** Задача веера (`lib/fan.ts`): новичок раздела 3 — партия с первой секунды на одном мире. */
export async function newbieRun({ style, seed }: { style: Newbie; seed: number }): Promise<{ run: Run; pop: (number | undefined)[]; lvl: (number | undefined)[]; th: number | undefined }> {
  const pop: (number | undefined)[] = [];
  const lvl: (number | undefined)[] = [];
  let th: number | undefined;
  setRandom(seeded(seed));
  const g = createInitialState(seed);
  g.tutorialDone = true;
  const flown = await pilot({
    g,
    seconds: NEW_HOURS * 3600,
    player: player(null, {
      build: { skip: style === 'nohall' ? NO_HALL : [] },
      siegeLevy: style === 'hire',
      also: style === 'militia' || style === 'nohall' ? militia : undefined,
    }),
    world: { seed, pulse: PULSE, raids: true, step: GAME },
    economy: 'live',
    tick: 1,
    decide: PULSE,
    watch: {
      hourly: (h, x) => {
        const i = HOURS_AT.indexOf(h);
        if (i < 0) return;
        pop[i] = x.pop;
        lvl[i] = sum(x.buildings.map((b) => b.level)) / x.buildings.length;
        if (h === NEW_HOURS) th = buildingOfType(x, 'town_hall')?.level ?? 1;
      },
    },
  });
  setRandom(null);
  return { run: flown.run, pop, lvl, th };
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
  const lines: Lines = { byLevel, popToLevel };

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
    const raids = (['level', 'hall', 'pop'] as Base[]).map((x) => raidAt(lines, x, upP) - raidAt(lines, x, baseP));
    if (gain <= 0.5 && raids.every((x) => x <= 0.5)) continue;
    console.log(` ${b.type.padEnd(15)}  ${pad(gain.toFixed(1), 7)}  ${pad(raids[0].toFixed(1), 19)}  ${pad(raids[1].toFixed(1), 6)}  ${pad(raids[2].toFixed(1), 6)}`);
  }
  const g0 = createInitialState(7);
  console.log(
    `Посёлок без войска на той же лестнице — новая партия (ср. уровень 1): оборона ${Math.round(defense(g0))}, линия ${Math.round(byLevel.a + byLevel.b)} — ${pct(defense(g0) / (byLevel.a + byLevel.b))}.`,
  );

  // 1б. Живая партия.
  console.log('');
  console.log(`--- 1б. Мерки в живой партии: общий автопилот, ${NEW_HOURS} ч, миры ${NEW_SEEDS.join(', ')}, мир тихий (набегов нет) ---`);
  console.log('«обычный» — автопилот как есть; «без ратуши» — тот же автопилот, который ратушу не поднимает никогда (build с skip).');
  console.log(`«набег» — набег дозревшего логова медианной опоры по мерке: ступень ${LAIR_STEP.toFixed(2)} × линия × защита (у жителей ${LAIR_SHIELD_FROM}→${LAIR_SHIELD_FULL}, у уровня и ратуши — 3→6, как мерились до выбора); «оборона» — посёлка без войска.`);
  console.log(' партия       ч  ср. уровень  ратуша  жителей  жители в L  оборона  набег: ср. уровень  ратуша  жители');
  unitsNote();
  const QUIET = ['обычный', 'без ратуши'] as const;
  const quiet = await fan(quietRun, import.meta.url, QUIET.flatMap((style) => NEW_SEEDS.map((seed) => ({ style, seed, lines }))));
  for (const [k, style] of QUIET.entries()) {
    const rows: QuietRow[][] = HOURS_AT.map(() => []);
    for (const run of quiet.slice(k * NEW_SEEDS.length, (k + 1) * NEW_SEEDS.length)) {
      for (let i = 0; i < HOURS_AT.length; i++) if (run[i]) rows[i].push(run[i] as QuietRow);
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
  const HOURS = STEP_HOURS;
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
  // Три таблицы — одним веером: прогоны всех строк идут разом, печать — по таблице, в прежнем порядке.
  const tables: { steps: Step[]; levels: number[]; refill: boolean }[] = [
    { steps: [GAME, step(0.8), step(0.9), step(1), step(1.1)], levels: LEVELS, refill: true },
    { steps: [GAME, step(0.9)], levels: LEVELS, refill: false },
    { steps: [GAME], levels: [7, 8], refill: true },
  ];
  const cells = tables.flatMap(({ steps, levels, refill }) => steps.flatMap((s) => levels.map((level) => ({ s, level, refill }))));
  const stepRuns = await fan(stepRun, import.meta.url, cells.flatMap((c) => SEEDS.map((seed) => ({ ...c, seed }))));
  let cell = 0;
  const ladder = (steps: Step[], levels: number[]): void => {
    console.log(header);
    for (const s of steps) {
      for (const level of levels) {
        const runs: Run[] = stepRuns.slice(cell * SEEDS.length, (cell + 1) * SEEDS.length);
        cell++;
        console.log(row(s.name, level, tally(runs, HOURS)));
      }
    }
  };
  console.log('');
  console.log('Войско держат полным — пополняется между пульсами даром. Это граница «сколько стоит бой», а не найм: найм — следующий замер.');
  ladder(tables[0].steps, tables[0].levels);
  console.log('');
  console.log('Без найма — войско не пополняется:');
  ladder(tables[1].steps, tables[1].levels);
  console.log('');
  console.log('Игра на посёлках мерки 7 и 8 уровней (жителей у них больше порога защиты), войско держат полным:');
  ladder(tables[2].steps, tables[2].levels);

  // 3. Новичок.
  console.log('');
  console.log(`--- 3. Новичок: партия с первой секунды, ${NEW_HOURS} ч непрерывной игры, миры ${NEW_SEEDS.join(', ')}, мир как есть ---`);
  console.log('Племя ведёт общий автопилот (отвечает на события, берёт веру мира). «без войска» — не нанимает никого; «нанимает на осаду» — на лагерь нанимает дубинщиков втрое больше');
  console.log('людей лагеря, но не больше рук, которые может отдать (autopilot.hands: свободных сверх запаса на стройку), и выходит; «ополчение 10 %» — держит дубинщиков');
  console.log('на десятую часть населения; «ополчение, без ратуши» — то же, но ратушу');
  console.log('автопилот не поднимает никогда (build с skip). Логова молоды: мир начинается с партией. «набег / оборона» — к обороне слепка в минуту выхода.');
  const fresh = createInitialState(7);
  console.log(`Дубинщик на казармах новой партии нанимается за ${Math.round(TROOP_BY_ID.clubman.work / recruitRate(fresh, 'clubman'))} с (work / recruitRate). «окно голода» — от минуты, когда лагерь встал, до голода (siege.starvesAt), мин…макс.`);
  const STYLE_NAME = { none: 'без войска', hire: 'нанимает на осаду', militia: 'с ополчением 10 %', nohall: 'с ополчением 10 %, без ратуши' };
  console.log(' новичок                        набегов  набег / оборона  первое падение, мин…макс  прорвали  лагерей  окно голода        падений осадой  падений/ч  нанято  бойцов потеряно  люди к 1/2/4/6 ч      ср. уровень к 1/2/4/6 ч  ратуша к 6 ч');
  const NEWBIES = ['none', 'hire', 'militia', 'nohall'] as const;
  const newbies = await fan(newbieRun, import.meta.url, NEWBIES.flatMap((style) => NEW_SEEDS.map((seed) => ({ style, seed }))));
  for (const [k, style] of NEWBIES.entries()) {
    const got = newbies.slice(k * NEW_SEEDS.length, (k + 1) * NEW_SEEDS.length);
    const runs: Run[] = got.map((x) => x.run);
    const pop: number[][] = [[], [], [], []];
    const lvl: number[][] = [[], [], [], []];
    const th: number[] = [];
    for (const x of got) {
      for (let i = 0; i < HOURS_AT.length; i++) {
        if (x.pop[i] !== undefined) pop[i].push(x.pop[i] as number);
        if (x.lvl[i] !== undefined) lvl[i].push(x.lvl[i] as number);
      }
      if (x.th !== undefined) th.push(x.th);
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
          attacker: { kinds: kindsOf(troops), gear: ownGearOf(troops), resolve: 0, setup: null },
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

serveFan(import.meta.url, { quietRun, stepRun, newbieRun });
