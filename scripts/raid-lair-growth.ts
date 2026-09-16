// Рост логова — раздел `raid:report`.
//
// Раздел заведён до кода (docs/lair_growth.md) тем же порядком, что потолок набегов: владелец
// решил, что сила набега берётся из логова, а логово растёт (docs/raid_ceiling.md, раздел 7), —
// здесь меряется, от чего оно растёт и что из этого выходит. Меряется:
//
//  0. **Что такое опора сегодня** — из чего `gen.lairAnchor` её считает.
//  1. **Мерка развития города** — какая величина из тех, что слепок деревни уже везёт в мир,
//     лучше всего повторяет оборону посёлка мерки `siege:report`: на неё и опирается рост.
//  2. **Ступени роста** — настоящий мир (`LocalWorld` с настоящим племенем и пульсом, как у
//     `world/store`), где сила логова в досягаемости подставлена в экземпляр мира: сегодняшняя
//     кривая логова (опора по расстоянию × дозревание) × ступень × линия развития из п. 1, а
//     отряд — всё логово. Осада — по сухому прогону того же боя у частокола (`wallHolds` ниже —
//     копия сборки сторон из `LocalWorld.resolveIncoming`), окно после любого падения — одно.
//  3. **Новичок** — партия с первой секунды и защита по развитию: логово не замечает город, пока
//     средний уровень построек ниже порога, и доходит до полной силы к второму порогу.
//  4. **Логово как цель** — можно ли сжечь выросшее логово войском мерки и сколько оно отдаёт.
//
// Подстановки делаются в экземпляр мира и нигде больше: код игры не тронут.
import { LocalWorld, HOME_ID } from '@/world/local/LocalWorld';
import { applyEffects, playerProfile, syncAway, syncSiege } from '@/world/bridge';
import { awayOf, homeOf } from '@/world/muster';
import { generateWorld, isLair, lairAnchor, type GenSettlement } from '@/world/gen';
import { distance } from '@/world/geo';
import { raidingParty, garrisonOf } from '@/world/garrison';
import { fitSetup, resolveField } from '@/world/battle';
import { ownGearOf } from '@/world/agents';
import { lairArms, lairGold, lairLoot } from '@/world/lairs';
import { starvesAt } from '@/world/siege';
import {
  AI_MIN_POP,
  AI_POWER_SHARE,
  AI_RANGE,
  LAIR_ANCHOR_FAR,
  LAIR_ANCHOR_HOME,
  LAIR_ANCHOR_RANGE,
  LAIR_CAP,
  LAIR_RIPE,
  LAIR_START,
  SIEGE_CHANCE,
  SIEGE_IF_BELOW,
  SIEGE_IMMUNE,
} from '@/world/data/tuning';
import type { FigureView, HomeEffect, MarchView, PlayerProfile } from '@/world/types';
import { createInitialState } from '@/game/state';
import { tick } from '@/game/sim/tick';
import { autoAssign } from '@/game/sim/workers';
import { startRecruit } from '@/game/sim/army';
import { seeded, setRandom } from '@/game/sim/random';
import { armyPower, armySize, defense, housingCapacity, recruitRate, storageCap, taxIncomePerDay } from '@/game/derived';
import { RESOURCE_IDS } from '@/game/constants';
import { kindsOf, troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { GameState, TroopId } from '@/game/types';
import { TROOP_BY_ID } from '@/game/data/troops';
import { build, staff } from './autopilot';

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = 1_700_000_000_000;
const SEEDS = [7, 11, 42, 51, 77];
const NEW_SEEDS = SEEDS.slice(0, 3);
const LADDER = [1, 2, 3, 5, 7, 10];
const PULSE = 30;
/** Состав и мерка войска — те же, что у осады, лазарета и потолка набегов. */
const MIX: TroopStack = { spearman: 4, archer: 3, legionary: 2, rider: 1 };
const armyAt = (level: number): number => 2 * (20 + 10 * (level - 1));

const pad = (v: string | number, w: number): string => String(v).padStart(w);
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const hm = (ms: number): string => {
  const m = Math.round(ms / MIN);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')}` : `${m} мин`;
};
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);
const q = (xs: number[], p: number): number => {
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

/** Посёлок уровня L: жильё на 90 %, склад полон, войско — `armyAt` по составу. Мерка `siege:report`. */
function townAt(level: number): GameState {
  const g = createInitialState(7);
  g.tutorialDone = true;
  for (const b of g.buildings) b.level = level;
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

/**
 * Развитие города — средний уровень построек из слепка (`PlayerProfile.levels`, всё, кроме
 * тайника). Слепок везёт это поле уже сегодня: по нему падение выбирает постройки.
 */
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

// ---------- Модель ----------

interface Growth {
  name: string;
  /** Набег при опоре медианного логова и полном дозревании — доля линии развития. null — игра как есть. */
  rho: number | null;
  /** Защита новичка по развитию: 0 ниже `from`, линейно до 1 к `full`. null — без защиты. */
  shield?: { from: number; full: number } | null;
  /** Осада: 'dry' — сухой прогон боя у частокола; 'old' — сегодняшний порог `SIEGE_IF_BELOW`. */
  siege: 'dry' | 'old';
}

interface Line {
  a: number;
  b: number;
  /** Медианная опора логов в досягаемости: у неё набег равен ступени линии. */
  anchor: number;
}

const shieldOf = (g: Growth, level: number): number =>
  g.shield ? Math.min(1, Math.max(0, (level - g.shield.from) / (g.shield.full - g.shield.from))) : 1;

/**
 * Сила логова по модели роста. `today` — сила логова в игре сегодня (опора по расстоянию ×
 * дозревание × разгром): она делится на медианную опору, и остаётся «насколько это логово дальше
 * и старше медианного». Отряд набега — всё логово: `AI_POWER_SHARE` в модели не участвует
 * (раздел 4 — почему).
 */
const grown = (g: Growth, line: Line, p: PlayerProfile, today: number): number => {
  const level = levelOf(p);
  return (today / line.anchor) * (g.rho ?? 1) * (line.a * level + line.b) * shieldOf(g, level);
};

// ---------- Прогон ----------

interface Wall {
  held: boolean;
  home: number;
  lost: number;
}
interface Run {
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

interface Play {
  g: GameState;
  seed: number;
  growth: Growth;
  line: Line;
  hours: number;
  /** Оборона, от которой считать долю набега: мерка посёлка. Нет — оборона слепка. */
  ref?: number;
  /** Войско держат полным: пополнение между пульсами (без цены — это граница, а не найм). */
  refill?: boolean;
  /** Логова дозрели до начала прогона: мир живёт с тех пор `LAIR_RIPE`. */
  ripe?: boolean;
  grow?: (g: GameState) => void;
  /** На осаду — нанять дубинщиков вдвое больше людей лагеря, если их нет. */
  hire?: boolean;
  hourly?: (h: number, g: GameState) => void;
}

/** Настоящее состояние мира: отчёт — прибор, ему положено видеть больше панели. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Inside = any;

/**
 * Сборка сторон боя у частокола — копия `LocalWorld.resolveIncoming` до вызова `resolveField`.
 * Сухой прогон этого боя и есть «набег не может пробить оборону».
 */
function wallHolds(w: Inside, m: Inside, at: number): boolean {
  const p: PlayerProfile = w.save.profile;
  const party = raidingParty(w.save.seed, m.id, m.power);
  const held = w.defenders(at);
  const militia = Math.max(0, Math.round(p.militia ?? 0));
  const archers = Math.min(militia, Math.max(0, Math.round(p.militiaArchers ?? 0)));
  const kinds = kindsOf(held.all);
  kinds.infantry += militia - archers;
  kinds.archer += archers;
  const frozen = w.save.frozenDefense;
  const planned = frozen && frozen.marchId === m.id ? frozen.setup : (p.defenseSetup ?? null);
  const setup = planned ? fitSetup(planned, kinds) : null;
  const field = resolveField({
    seed: m.seed,
    attacker: { kinds: party.kinds, gear: party.gear, setup: party.setup },
    defender: { kinds, gear: w.ownGear(held.all), resolve: w.ownResolve(), setup },
  });
  return !field.won;
}

async function play(o: Play): Promise<Run> {
  const { g, growth, line } = o;
  let now = START;
  const world = new LocalWorld({ seed: o.seed, now: () => now, storage: memory() });
  const w: Inside = world;
  const run: Run = { raids: 0, ratio: [], walls: [], sieges: 0, sorties: 0, sortieWins: 0, siegeFalls: 0, lost: 0, half: 0, armyEnd: 0, hired: 0, losses: [], hunger: [] };

  if (growth.rho !== null) {
    const power = w.powerNow.bind(w);
    w.powerNow = (s: GenSettlement, at: number) => {
      const v = power(s, at);
      return isLair(s) && w.save.profile ? grown(growth, line, w.save.profile, v) : v;
    };
  }
  const schedule = w.scheduleAi.bind(w);
  w.scheduleAi = (at: number) => {
    const before = new Set(w.save.marches.map((m: Inside) => m.id));
    // Одно окно после любого падения — прорыва или голода: ни набега, ни осады.
    if (growth.rho !== null && (w.save.siegeImmune[HOME_ID] ?? 0) > at) {
      w.save.nextAiAt = Math.max(w.save.nextAiAt, w.save.siegeImmune[HOME_ID]);
    }
    // Порог набегов по населению (`AI_MIN_POP`) у модели снят: его место заняла защита по развитию.
    const profile = w.save.profile;
    const pop = profile?.pop ?? 0;
    if (growth.rho !== null && profile) profile.pop = Math.max(pop, AI_MIN_POP);
    schedule(at);
    if (profile) profile.pop = pop;
    for (const m of [...w.save.marches]) {
      if (before.has(m.id) || m.own || m.targetId !== HOME_ID) continue;
      if (growth.rho !== null) {
        const src = w.gen.settlements.find((s: GenSettlement) => s.id === m.fromId);
        const power = w.powerNow(src, at);
        if (shieldOf(growth, levelOf(profile)) <= 0) {
          w.save.marches.splice(w.save.marches.indexOf(m), 1);
          continue;
        }
        m.power = Math.max(2, power);
        m.units = { warrior: Math.max(1, Math.round(m.power / 3)) };
      }
      run.raids++;
      const d = o.ref ?? profile?.defense ?? 0;
      if (d > 0) run.ratio.push(m.power / d);
    }
  };
  if (growth.siege === 'dry') {
    const begin = w.beginSiege.bind(w);
    w.beginSiege = (m: Inside, at: number) => {
      const p = w.save.profile;
      if (!p) return false;
      // Порог в игре — `m.power < оборона × SIEGE_IF_BELOW`; подставленная оборона делает его
      // ровно ответом сухого прогона, а всё остальное в `beginSiege` остаётся как есть.
      const was = p.defense;
      p.defense = wallHolds(w, m, at) ? m.power / SIEGE_IF_BELOW + 1 : 0;
      const r = begin(m, at);
      p.defense = was;
      return r;
    };
  }
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
      applyEffects(g, [e]);
      const lost = troopTotal(e.lostTroops ?? {});
      run.lost += lost;
      if (e.id.endsWith('-defense') && e.battle) {
        run.walls.push({ held: e.battle === 'won', home: homeBefore, lost });
        if (e.battle === 'lost') {
          run.losses.push(p.now - START);
          if (growth.rho !== null) w.save.siegeImmune[HOME_ID] = p.now + SIEGE_IMMUNE;
        }
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
    if (start > 0 && armySize(g) < start / 2) run.half += PULSE * 1000;
    if (p.siege) {
      const home = homeOf(g.army, awayOf(marches, figures));
      if (o.hire) {
        const camp = w.save.marches.find((m: Inside) => m.id === w.save.sieges[HOME_ID]?.campId);
        const want = camp ? Math.ceil(camp.power) : 0;
        const have = troopTotal(home) + g.recruits.reduce((n, r) => n + r.count - r.done, 0);
        const n = Math.min(want - have, g.pop - 5);
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

function tally(runs: Run[], hours: number) {
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
  console.log('=== Рост логова: от чего растёт сила набега ===');

  // 0. Опора.
  console.log('');
  console.log('--- 0. Опора сегодня ---');
  console.log(
    `gen.lairAnchor(home, at) = LAIR_ANCHOR_HOME ${LAIR_ANCHOR_HOME} + (LAIR_ANCHOR_FAR ${LAIR_ANCHOR_FAR} − HOME) × min(1, расстояние / LAIR_ANCHOR_RANGE ${LAIR_ANCHOR_RANGE}).`,
  );
  console.log('Аргументов у неё два — клетка дома и клетка логова; о городе она не знает ничего.');
  console.log(`Сила логова = опора × (LAIR_START ${LAIR_START} … LAIR_CAP ${LAIR_CAP} за LAIR_RIPE ${hm(LAIR_RIPE)}); набег = логово × AI_POWER_SHARE ${AI_POWER_SHARE}.`);
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
  console.log(`Медианная опора логов в досягаемости: ${Math.round(anchor)}.`);

  // 1. Мерка развития.
  console.log('');
  console.log('--- 1. Мерка развития: что из слепка повторяет оборону посёлка мерки ---');
  console.log('Посёлок уровня L — мерка siege:report: все постройки уровня L, жильё на 90 %, войско 2 × (20 + 10 × (L − 1)) по составу MIX.');
  console.log(' уровень  ср. уровень в слепке  жителей  людей с войском  оборона');
  const lv: number[] = [];
  const people: number[] = [];
  const defs: number[] = [];
  for (const l of LADDER) {
    const g = townAt(l);
    const p = playerProfile(g, awayOf([], []));
    lv.push(levelOf(p));
    people.push(p.pop + troopTotal(p.army ?? {}));
    defs.push(defense(g));
    console.log(` ${pad(l, 7)}  ${pad(levelOf(p).toFixed(1), 20)}  ${pad(p.pop, 7)}  ${pad(people[people.length - 1], 15)}  ${pad(Math.round(defense(g)), 7)}`);
  }
  const byLevel = fit(lv, defs);
  const byPeople = fit(people, defs);
  console.log(`Оборона ≈ ${byLevel.a.toFixed(1)} × ср. уровень + ${byLevel.b.toFixed(1)}; худшее отклонение ${pct(byLevel.worst)}.`);
  console.log(`Оборона ≈ ${byPeople.a.toFixed(2)} × людей + ${byPeople.b.toFixed(1)}; худшее отклонение ${pct(byPeople.worst)}.`);
  const line: Line = { a: byLevel.a, b: byLevel.b, anchor };
  // Рост от развития не должен окольно наказывать за укрепления: уровень постройки, дающей
  // оборону, обязан прибавлять обороны больше, чем он же прибавляет набегу.
  const base = townAt(5);
  const keys = Object.keys(playerProfile(base, awayOf([], [])).levels ?? {}).length;
  const perLevel = (0.9 * line.a) / keys;
  console.log(`Уровень любой постройки из ${keys} в слепке двигает средний уровень на 1/${keys}, набег ступени 0.90 — на ${perLevel.toFixed(1)}.`);
  console.log('Постройки, чей уровень прибавляет обороны (посёлок уровня 5 → одна постройка на 6):');
  for (const b of base.buildings) {
    const up = townAt(5);
    const one = up.buildings.find((x) => x.type === b.type);
    if (!one) continue;
    one.level = 6;
    const gain = defense(up) - defense(base);
    if (gain > 0.5) console.log(`  ${b.type}: обороны +${gain.toFixed(1)}, набега +${perLevel.toFixed(1)}`);
  }
  const g0 = createInitialState(7);
  console.log(
    `Посёлок без войска на той же лестнице — новая партия (ср. уровень 1): оборона ${Math.round(defense(g0))}, линия ${Math.round(line.a + line.b)} — ${pct(defense(g0) / (line.a + line.b))}.`,
  );

  // 2. Ступени.
  const HOURS = 4;
  const LEVELS = [1, 5, 10];
  const NOW: Growth = { name: 'сейчас', rho: null, siege: 'old' };
  const step = (rho: number, siege: Growth['siege'] = 'dry', shield: Growth['shield'] = null): Growth => ({
    name: `${rho.toFixed(2)}${siege === 'old' ? ', порог 0.3' : ''}${shield ? `, защита ${shield.from}→${shield.full}` : ''}`,
    rho,
    siege,
    shield,
  });
  console.log('');
  console.log(`--- 2. Ступени роста: ${HOURS} ч на каждом из ${SEEDS.length} миров, посёлок уровня L стоит дома, на осаду — вылазкой ---`);
  console.log('Логово = сегодняшняя сила логова / медианная опора × ступень × линия развития; отряд — всё логово. Логова дозрели до начала.');
  console.log('Осада — если сухой прогон боя у частокола отбит (и кость SIEGE_CHANCE, остывание, окно — как в игре);');
  console.log(`«порог 0.3» — осада по сегодняшнему порогу SIEGE_IF_BELOW. После прорыва и после падения осадой — одно окно SIEGE_IMMUNE (${hm(SIEGE_IMMUNE)}): ни набега, ни осады.`);
  console.log('«набег / оборона» — доля обороны мерки (10-я…медиана…90-я); «потери, удержали» — доля бойцов дома, павших в удержанном бою, у боёв, где дома не меньше 10;');
  console.log('«доля осад» — лагерей от всех пришедших; «падений/ч» — прорывы и падения осадой на мир.');
  const header = ' ступень                ур  набегов  набег / оборона  у стены  прорвали  лагерей  доля осад  вылазки   падений осадой  падений/ч  потери, удержали  < половины  войско в конце';
  const row = (name: string, level: number, t: ReturnType<typeof tally>): string =>
    ` ${name.padEnd(22)} ${pad(level, 2)}  ${pad(t.raids, 7)}  ${pad(t.ratio, 15)}  ${pad(t.walls, 7)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.siegeShare, 9)}  ${pad(t.sorties, 8)}  ${pad(t.falls, 14)}  ${pad(t.perHour, 9)}  ${pad(t.held, 16)}  ${pad(t.half, 10)}  ${pad(t.armyEnd, 14)}`;
  const ladder = async (steps: Growth[], levels: number[], refill: boolean): Promise<void> => {
    console.log(header);
    for (const s of steps) {
      for (const level of levels) {
        const runs: Run[] = [];
        const ref = defense(townAt(level));
        for (const seed of SEEDS) runs.push(await play({ g: townAt(level), seed, growth: s, line, hours: HOURS, ref, refill, ripe: true }));
        console.log(row(s.name, level, tally(runs, HOURS)));
      }
    }
  };
  console.log('');
  console.log('Войско держат полным — пополняется между пульсами даром. Это граница «сколько стоит бой», а не найм: найм — следующий замер.');
  await ladder([NOW, step(0.8), step(0.9), step(1), step(1.1), step(0.9, 'old')], LEVELS, true);
  console.log('');
  console.log('Без найма — войско не пополняется:');
  await ladder([step(0.9)], LEVELS, false);
  const SHIELD = { from: 3, full: 6 };
  console.log('');
  console.log(`Ступень 0.90 с защитой новичка ${SHIELD.from}→${SHIELD.full} (раздел 3) на посёлках мерки, войско держат полным:`);
  await ladder([step(0.9, 'dry', SHIELD)], [3, 5], true);

  // 3. Новичок.
  const NEW_HOURS = 6;
  console.log('');
  console.log(`--- 3. Новичок: партия с первой секунды, ${NEW_HOURS} ч непрерывной игры, миры ${NEW_SEEDS.join(', ')} ---`);
  console.log('Племя ведёт автопилот pop:report. «без войска» — не нанимает никого; «нанимает на осаду» — на лагерь нанимает дубинщиков вдвое больше');
  console.log('людей лагеря и выходит; «ополчение 10 %» — держит дубинщиков на десятую часть населения. Логова молоды: мир начинается с партией.');
  console.log(`Защита «a→b»: логово не замечает город, пока средний уровень построек ниже a (набег не выходит), и доходит до полной силы к b.`);
  console.log(`«сейчас» — игра как есть (набеги с населения AI_MIN_POP ${AI_MIN_POP}, осада по порогу 0.3).`);
  const fresh = createInitialState(7);
  console.log(`Дубинщик на казармах новой партии нанимается за ${Math.round(TROOP_BY_ID.clubman.work / recruitRate(fresh, 'clubman'))} с (work / recruitRate). «окно голода» — от минуты, когда лагерь встал, до голода (siege.starvesAt), мин…макс.`);
  const newbie: Growth[] = [NOW, step(0.9), step(0.9, 'dry', { from: 3, full: 6 }), step(0.9, 'dry', { from: 3, full: 8 })];
  const militia = (g: GameState): void => {
    const want = Math.round(g.pop * 0.1);
    const have = armySize(g) + g.recruits.reduce((n, r) => n + r.count - r.done, 0);
    if (want > have) startRecruit(g, 'clubman', want - have);
  };
  for (const style of ['none', 'hire', 'militia'] as const) {
    console.log('');
    console.log(`Новичок ${style === 'none' ? 'без войска' : style === 'hire' ? 'нанимает на осаду' : 'с ополчением 10 %'}:`);
    console.log(' ступень                      первое падение, мин…макс  прорвали  лагерей  окно голода        падений осадой  падений/ч  нанято  бойцов потеряно  люди к 1/2/4/6 ч      ср. уровень к 1/2/4/6 ч');
    for (const s of newbie) {
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
            growth: s,
            line,
            hours: NEW_HOURS,
            hire: style === 'hire',
            grow: (x) => {
              staff(x);
              build(x);
              if (style === 'militia') militia(x);
            },
            hourly: (h, x) => {
              const i = [1, 2, 4, 6].indexOf(h);
              if (i < 0) return;
              pop[i].push(x.pop);
              lvl[i].push(sum(x.buildings.map((b) => b.level)) / x.buildings.length);
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
        ` ${s.name.padEnd(28)} ${pad(first, 24)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.hunger.length ? `${hm(Math.min(...t.hunger))}…${hm(Math.max(...t.hunger))}` : '—', 17)}  ${pad(t.falls, 14)}  ${pad(t.perHour, 9)}  ${pad(t.hired, 6)}  ${pad(t.lost, 15)}  ${pop.map((xs) => pad(Math.round(mean(xs)), 4)).join(' ').padEnd(20)}  ${lvl.map((xs) => pad(mean(xs).toFixed(1), 4)).join(' ')}`,
      );
    }
  }

  // 4. Логово как цель.
  console.log('');
  console.log('--- 4. Логово как цель: сжечь ли выросшее логово войском мерки ---');
  console.log('Полководец ведёт всё войско мерки уровня L против гарнизона логова (garrisonOf, как в attackAt), 40 боёв на строку; логово медианной опоры,');
  console.log(`ступень 0.90. «доля набега» — какая часть логова уходит в набег: ${AI_POWER_SHARE} сегодня (логово — набег, делённый на эту долю) или 1 (набег — всё логово).`);
  console.log(`«дозрело» — доля пути LAIR_START ${LAIR_START} → LAIR_CAP ${LAIR_CAP}. Добыча — lairLoot / lairGold / lairArms от силы логова; налог — taxIncomePerDay посёлка мерки.`);
  console.log(' ур  войско  мощь войска  налог/день  доля набега  дозрело  сила логова  победа  добро  золото  золото в днях налога  оружие');
  const N = 40;
  for (const level of LEVELS) {
    const g = townAt(level);
    const troops = { ...g.army };
    const raid = 0.9 * (line.a * level + line.b);
    for (const share of [AI_POWER_SHARE, 1]) {
      for (const r of [0, 0.5, 1]) {
        const ripe = (LAIR_START + (LAIR_CAP - LAIR_START) * r) / LAIR_CAP;
        const power = (raid * ripe) / share;
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
          ` ${pad(level, 2)}  ${pad(armySize(g), 6)}  ${pad(armyPower(g), 11)}  ${pad(Math.round(taxIncomePerDay(g)), 10)}  ${pad(share, 11)}  ${pad(pct(r), 7)}  ${pad(Math.round(power), 11)}  ${pad(pct(won / N), 6)}  ${pad(lairLoot(power), 5)}  ${pad(lairGold(power), 6)}  ${pad((lairGold(power) / taxIncomePerDay(g)).toFixed(1), 20)}  ${pad(lairArms(power), 6)}`,
        );
      }
    }
  }
  const today = anchor * LAIR_CAP;
  console.log(`Сегодня дозревшее логово медианной опоры — ${Math.round(today)}: добро ${lairLoot(today)}, золото ${lairGold(today)}, оружие ${lairArms(today)}.`);
  console.log(`(Осада по сухому прогону и доля SIEGE_CHANCE ${SIEGE_CHANCE} — те же, что в разделе 2.)`);
}
