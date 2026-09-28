// Оборона по составу — отчёт `raid-mix:report` (прежде — раздел `raid:report`).
//
// Долг закрыт (docs/defense_mix.md): мощь тех, кто дома, — сумма мощи тех, кто дома (`kinds.troopPower`
// над `derived.homeTroops`), а не бойцов дома × средняя мощь всего войска. Числа «по среднему» в игре
// больше не воспроизводятся: это снимок на коммите ce81e88, где раздел выводил их той же командой.
//
// Раздел меряет **игру как она есть** и сверяет её с подстановкой, из которой правило выросло: племя, у
// которого войско — ровно те, кто дома (`muster.homeOf`), и никто не в отлучке. Его `defense`, `militiaMen`,
// `militiaArchers` и `mutinyForecast` — число по составу, собранное функциями самой игры. Сверка обязана
// давать ноль: разошлась — в игре снова завелась вторая правда о том, кто дома.
//
// Разделы:
//  1. **Что показывает число** — посёлок мерки, полководец увёл тяжёлых или лёгких: мощь дома, оборона,
//     ополчение и стража против мятежа, сверка с подстановкой; кого разрешает распустить казарма.
//  2. **Что число говорит о бое у стены** — настоящий бой (`LocalWorld.wallField`) на мире, где полководец
//     увёл часть войска в поле: при какой силе набега прорывается половина набегов, в долях обороны.
//  3. **Живые прогоны** — «по средствам, высокий налог» (docs/hiring.md) на посёлке мерки 10-го уровня, 4 ч ×
//     5 миров, случаи «всё дома», «увёл тяжёлых», «увёл лёгких»; вера мира и православная деревня (вера
//     подставлена).
//  4. **Волки и разбойники у ворот** — бой события ядром той же дверью, что набег (docs/battle_eu4.md, 14.28): доля
//     поражений на решётке нашей силы — уровень посёлка мерки, вера, кто дома.
//  4б. **Сила у ворот по уровню посёлка** — таблица слова владельца по 14.35, п. 4: ровный бой для гарнизона мерки уровня,
//     делённый на перевес «Ограничителя», кривая «сила пришедших → поражений» и её окрестность мелким шагом.
//  5. **Потолок морали и обряд** — срезает ли потолок морали прибавку храма у какого-нибудь вида, уровня храма и устава
//     (docs/battle_eu4.md, 14.24).
import { GEAR, MORALE, deploySetup, stackOf, startMorale } from '@/battle';
import { FAITHS, OBSERVANCES, tiltAt } from '@/game/data/faiths';
import { MAX_BUILDING_LEVEL } from '@/game/constants';
import { KIND_OF, gearOfTroop } from '@/game/battle/kinds';
import { LocalWorld } from '@/world/local/LocalWorld';
import { awayTroops, militiaArchers, militiaMen, playerProfile } from '@/world/bridge';
import { awayOf, homeOf, NOBODY_AWAY, type Away } from '@/world/muster';
import { faithAt } from '@/world/faith';
import { lairPower, lairRaid } from '@/world/lairs';
import { LAIR_ANCHOR_MID, LAIR_RIPE } from '@/world/data/tuning';
import type { GateCall, GateFoe, PlayerProfile } from '@/world/types';
import { menOfPower } from '@/world/garrison';
import { RAIDER_SHARE, WOLF_SHARE, foePower } from '@/game/data/events';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { armySize, defense, faithTilt, homeArmyPower, mutinyForecast } from '@/game/derived';
import { dismissCheck } from '@/game/sim/upkeep';
import type { FaithId, GameState, TroopId } from '@/game/types';
import { SEEDS, mean, pad, pct, q, sum, tally } from './raid-common';
import { START, openSky, townAt, unitsNote, type Inside } from './autopilot';
import { NAME, live, portable, type Out } from './raid-live';
import { fan, serveFan } from './lib/fan';

interface Case {
  name: string;
  /** Кого полководец уводит в поле — все бойцы этих видов, что есть дома. */
  take: readonly TroopId[];
}
const CASES: Case[] = [
  { name: 'всё дома', take: [] },
  { name: 'увёл тяжёлых (латники, всадники)', take: ['legionary', 'rider'] },
  { name: 'увёл лёгких (копья, лучники)', take: ['spearman', 'archer'] },
];

const pick = (army: TroopStack, take: readonly TroopId[]): TroopStack => {
  const out: TroopStack = {};
  for (const id of take) if ((army[id] ?? 0) > 0) out[id] = army[id];
  return out;
};

/** Кто не дома, когда дружина полководца в поле, — тем же правилом, что у мира (`muster.awayOf`). */
const fieldAway = (troops: TroopStack): Away =>
  troopTotal(troops) > 0 ? awayOf([], [{ phase: 'field', troops }]) : NOBODY_AWAY;

/** Племя, у которого войско — ровно те, кто дома: его числа и есть «по составу». */
function byComposition(g: GameState, home: TroopStack): GameState {
  const army = { ...g.army };
  for (const id of TROOP_IDS) army[id] = Math.max(0, home[id] ?? 0);
  return { ...g, army, away: {} };
}

const withFaith = (g: GameState, id: FaithId | null): GameState => {
  g.faith.id = id;
  return g;
};

const signed = (x: number): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))}%`;

// ---------- 1. Что показывает число ----------

function displayPart(): void {
  console.log('');
  console.log('--- 1. Что показывает число: посёлок мерки, полководец увёл часть войска в поле ---');
  console.log('Посёлок уровня L — мерка siege:report (войско 2 × (20 + 10 × (L − 1)) по составу MIX). «увёл» — все бойцы этих видов в дружине в поле:');
  console.log('s.away — кто не дома по видам (muster.awayOf → bridge.awayTroops, как у syncAway). Числа — функции игры; «сверка» — совпали ли мощь дома,');
  console.log('оборона, ополчение и стража с теми же функциями на племени, у которого войско — те, кто дома. «стража подавит» — mutinyForecast.crush.');
  console.log(' ур  вера           случай                              дома  мощь дома  оборона  ополчение  стража подавит  сверка');
  for (const level of [5, 10]) {
    for (const faith of [null, 'orthodox'] as const) {
      for (const c of CASES) {
        const g = withFaith(townAt(level), faith);
        const away = fieldAway(pick(g.army, c.take));
        g.away = awayTroops(g.army, away);
        const home = homeOf(g.army, away);
        const comp = byComposition(g, home);
        const same =
          homeArmyPower(g) === homeArmyPower(comp) &&
          defense(g) === defense(comp) &&
          militiaMen(g) === militiaMen(comp) &&
          mutinyForecast(g).crush === mutinyForecast(comp).crush;
        console.log(
          ` ${pad(level, 2)}  ${(faith ?? 'без веры').padEnd(13)}  ${c.name.padEnd(34)}  ${pad(troopTotal(home), 4)}  ${pad(Math.round(homeArmyPower(g)), 9)}  ${pad(Math.round(defense(g)), 7)}  ${pad(militiaMen(g), 9)}  ${pad(mutinyForecast(g).crush, 14)}  ${same ? 'совпала' : 'РАЗОШЛАСЬ'}`,
        );
      }
    }
  }
  const g = townAt(10);
  const taken = pick(g.army, ['legionary', 'rider']);
  const away = fieldAway(taken);
  g.away = awayTroops(g.army, away);
  const home = homeOf(g.army, away);
  console.log('');
  console.log('Роспуск в казармах: «распускают только тех, кто дома» (sim/upkeep.dismissCheck) — посёлок 10-го уровня, латники и всадники в поле:');
  for (const id of ['legionary', 'rider', 'spearman'] as TroopId[]) {
    console.log(`  ${TROOP_BY_ID[id].name}: всего ${g.army[id]}, дома ${home[id] ?? 0}, dismissCheck.max ${dismissCheck(g, id, g.army[id]).max}`);
  }
}

// ---------- 2. Бой у стены ----------

const BENCH_SEEDS = 40;
const SHARES = Array.from({ length: 27 }, (_, i) => 0.2 + i * 0.1);

/**
 * Мир, где полководец увёл `take` в поле и стоит там. Возвращает мир и минуту боя. Время ведёт стенд, а
 * мир и пульс — общие (`autopilot.openSky`), мир как есть, посёлок стоит.
 */
async function fieldWorld(g: GameState, seed: number, take: readonly TroopId[]): Promise<{ world: LocalWorld; at: number }> {
  const sky = openSky(g, { seed, pulse: 30, raids: true });
  const w: Inside = sky.world;
  await sky.pulse();
  const troops = pick(g.army, take);
  if (troopTotal(troops) > 0) {
    const err = await sky.world.setGarrison(troops);
    if (err) throw new Error(`setGarrison: ${err}`);
    sky.at(w.save.figures.general.handover.until);
    await sky.pulse();
    const home = w.save.home;
    const err2 = await sky.world.moveFigure('general', { x: home.x + 4, y: home.y });
    if (err2) throw new Error(`moveFigure: ${err2}`);
    sky.at(w.save.figures.general.arriveAt);
    await sky.pulse();
    // Второй пульс: слепок, собранный по спискам мира с прошлого пульса, догоняет место дружины.
    await sky.pulse();
  }
  return { world: sky.world, at: sky.now() };
}

/** Доля прорывов при силе набега `power`: настоящий бой у стены, ничего не трогая. */
function breakShare(w: Inside, at: number, power: number): number {
  let broke = 0;
  for (let i = 1; i <= BENCH_SEEDS; i++) {
    const m = { id: `bench${i}`, seed: i * 7919, power };
    if (w.wallField(m, at).field.won) broke++;
  }
  return broke / BENCH_SEEDS;
}

/**
 * Задача веера (`lib/fan.ts`): строка стенда у стены — случай `CASES[c]` при вере `faith` на посёлке
 * мерки уровня `level`. Отдаёт готовую строку: весь её счёт — внутри одного мира.
 */
export async function benchRow({ level, faith, c: k }: { level: number; faith: FaithId | null; c: number }): Promise<string> {
  const c = CASES[k];
  const g = withFaith(townAt(level), faith);
  const { world, at } = await fieldWorld(g, SEEDS[0], c.take);
  const label = faith ?? 'вера мира';
  const w: Inside = world;
  const home = w.defenders(at).all as TroopStack;
  const comp = byComposition(g, home);
  const d = defense(g);
  const raid = lairRaid(lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, g.pop), g.pop);
  const same = militiaMen(comp) === w.save.profile.militia && militiaArchers(comp) === w.save.profile.militiaArchers;
  const rates = SHARES.map((k) => breakShare(w, at, k * d));
  const i = rates.findIndex((r) => r >= 0.5);
  let half = NaN;
  if (i === 0) half = SHARES[0] * d;
  else if (i > 0) {
    const t = (0.5 - rates[i - 1]) / (rates[i] - rates[i - 1]);
    half = (SHARES[i - 1] + t * (SHARES[i] - SHARES[i - 1])) * d;
  }
  const fmt = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '—');
  return ` ${pad(level, 2)}  ${label.padEnd(13)}  ${c.name.padEnd(34)}  ${pad(troopTotal(home), 4)}  ${pad(Math.round(d), 7)}  ${pad(w.save.profile.militia, 9)}  ${pad(Number.isFinite(half) ? Math.round(half) : '—', 7)}  ${pad(fmt(half / d), 9)}  ${pad(Math.round(raid), 12)}  ${pad(pct(breakShare(w, at, raid)), 16)}  ${same ? 'совпала' : 'РАЗОШЛАСЬ'}`;
}

async function benchPart(): Promise<void> {
  console.log('');
  console.log(`--- 2. Что число говорит о бое у стены: LocalWorld.wallField, посёлок мерки 10-го уровня, ${BENCH_SEEDS} боёв на силу набега, мир ${SEEDS[0]} ---`);
  console.log('Полководец уводит дружину и стоит в поле в четырёх клетках от ворот. Сила набега — доля обороны с шагом 0.1;');
  console.log('«полпути» — сила, при которой прорывается половина боёв (между соседними ступенями — линейно), и она же в долях обороны.');
  console.log('«набег логова» — дозревшее логово медианной опоры при жителях посёлка (lairs.lairRaid), прорывов при нём.');
  console.log('«сверка» — ополчение и стрелки башни в слепке мира против подстановки по составу (в бой из обороны входят только они).');
  console.log('«вера мира» — вера, которую мир называет пульсом (у мира этого стенда — своя, печатается в разделе 3).');
  console.log(' ур  вера           случай                              дома  оборона  ополчение  полпути  к обороне  набег логова  прорывов при нём  сверка');
  const rows = [10].flatMap((level) => ([null, 'orthodox'] as const).flatMap((faith) => CASES.map((_, c) => ({ level, faith, c }))));
  for (const line of await fan(benchRow, import.meta.url, rows)) console.log(line);
}

// ---------- 3. Живые прогоны ----------

interface Watch {
  /** Ошибка обороны слепка против обороны по составу, по пульсам. */
  errors: number[];
  /** Пульсов, где ополчение или стрелки по среднему и по составу разошлись. */
  militiaApart: number;
  pulses: number;
  /** Дружина при полководце в конце прогона. */
  druzhinaEnd: number;
  /** На сколько бойцов дружина убыла от пульса к пульсу, пока полководец стоял в поле и в бой не ходил. */
  druzhinaCut: number;
}

/** Задача веера (`lib/fan.ts`): живой прогон раздела 3 — случай `CASES[c]` при вере `faith` на одном мире. */
export async function mixRun({ level, c: k, faith, seed }: { level: number; c: number; faith: 'мир' | 'orthodox'; seed: number }): Promise<{ out: Out; watch: Watch }> {
  const c = CASES[k];
  const x: Watch = { errors: [], militiaApart: 0, pulses: 0, druzhinaEnd: 0, druzhinaCut: 0 };
  const g = townAt(level);
  if (faith === 'orthodox') g.faith.id = 'orthodox';
  let step: 'muster' | 'move' | 'done' = c.take.length > 0 ? 'muster' : 'done';
  const out = await live({
    g,
    seed,
    style: 'meansHigh',
    hours: 4,
    ripe: true,
    profile: (p: PlayerProfile, s: GameState, away: Away) => {
      const comp = byComposition(s, homeOf(s.army, away));
      const dc = defense(comp);
      x.pulses++;
      if (dc > 0) x.errors.push(p.defense / dc - 1);
      const mm = militiaMen(comp);
      const ma = militiaArchers(comp);
      if (mm !== p.militia || ma !== p.militiaArchers) x.militiaApart++;
    },
    after: async ({ g: s, world, now, figures }) => {
      const gen = figures.find((f) => f.id === 'general');
      const held = troopTotal(gen?.troops ?? {});
      if (step === 'done' && held < x.druzhinaEnd) x.druzhinaCut += x.druzhinaEnd - held;
      x.druzhinaEnd = held;
      if (step === 'done' || !gen || gen.gone || gen.downUntil > START + now) return;
      if (step === 'muster') {
        if (!gen.atHome || gen.readyAt > START + now) return;
        const troops = pick(homeOf(s.army, awayOf([], figures)), c.take);
        if (troopTotal(troops) > 0 && (await world.setGarrison(troops)) === null) step = 'move';
        return;
      }
      if (gen.readyAt > START + now) return;
      const info = await world.info();
      if ((await world.moveFigure('general', { x: info.home.x + 4, y: info.home.y })) === null) step = 'done';
    },
  });
  return { out: portable(out), watch: x };
}

async function livePart(): Promise<void> {
  const HOURS = 4;
  const LEVEL = 10;
  console.log('');
  console.log(`--- 3. Живые прогоны: «${NAME.meansHigh}», посёлок мерки ${LEVEL}-го уровня, ${HOURS} ч × ${SEEDS.length} миров, логова дозрели ---`);
  const faiths = [];
  for (const seed of SEEDS) {
    const world = new LocalWorld({ seed, now: () => START, storage: null });
    await world.sync(playerProfile(townAt(1), NOBODY_AWAY));
    const w: Inside = world;
    faiths.push(`${seed}: ${faithAt(w.save.home.x, w.save.home.y)}`);
  }
  console.log(`Вера земли под замком: ${faiths.join(', ')}.`);
  console.log('Прогон — live раздела «Найм». «мир» — вера, которую мир называет пульсом, как world/store; «orthodox» — вера подставлена до прогона,');
  console.log('храм 10-го уровня. «увёл» — полководец в первые минуты');
  console.log('забирает всех бойцов этих видов, что дома, и уходит на 4 клетки в поле до конца прогона. «набег / оборона» — к обороне слепка;');
  console.log('«ошибка обороны» — сверка: оборона слепка против обороны племени, у которого войско — те, кто дома, 10-я…медиана…90-я по пульсам;');
  console.log('«ополчение врозь» — пульсов, где ополчение или стрелки слепка и той же подстановки разошлись;');
  console.log('«дружина в конце» — средняя по мирам; «убыла в поле» — сумма по мирам: на сколько бойцов дружина стала меньше от пульса к пульсу, пока полководец стоял в поле.');
  console.log('Полководец в бой не ходит: убыль в поле — не потери боя.');
  console.log(' вера      случай                              набегов  набег / оборона  у стены  прорвали  лагерей  доля осад  падений/ч  потери, удержали  войско дома: медиана  дружина в конце  убыла в поле  распущено  ошибка обороны  ополчение врозь');
  const rows: { faith: 'мир' | 'orthodox'; c: Case }[] = [
    { faith: 'мир', c: CASES[0] },
    { faith: 'мир', c: CASES[1] },
    { faith: 'мир', c: CASES[2] },
    { faith: 'orthodox', c: CASES[1] },
    { faith: 'orthodox', c: CASES[2] },
  ];
  unitsNote();
  const ran = await fan(mixRun, import.meta.url, rows.flatMap((r) => SEEDS.map((seed) => ({ level: LEVEL, c: CASES.indexOf(r.c), faith: r.faith, seed }))));
  for (const [k, r] of rows.entries()) {
    const got = ran.slice(k * SEEDS.length, (k + 1) * SEEDS.length);
    const outs = got.map((x) => x.out);
    const watch = got.map((x) => x.watch);
    const t = tally(
      outs.map((o) => o.run),
      HOURS,
    );
    const errs = watch.flatMap((x) => x.errors);
    console.log(
      ` ${r.faith.padEnd(8)}  ${r.c.name.padEnd(34)}  ${pad(t.raids, 7)}  ${pad(t.ratio, 15)}  ${pad(t.walls, 7)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.siegeShare, 9)}  ${pad(t.perHour, 9)}  ${pad(t.held, 16)}  ${pad(Math.round(q(outs.flatMap((o) => o.l.armyHome), 0.5)), 20)}  ${pad(Math.round(mean(watch.map((x) => x.druzhinaEnd))), 15)}  ${pad(sum(watch.map((x) => x.druzhinaCut)), 12)}  ${pad(sum(outs.map((o) => o.l.dismissed)), 9)}  ${pad(`${signed(q(errs, 0.1))}…${signed(q(errs, 0.5))}…${signed(q(errs, 0.9))}`, 14)}  ${pad(`${sum(watch.map((x) => x.militiaApart))} из ${sum(watch.map((x) => x.pulses))}`, 15)}`,
    );
  }
  const g = withFaith(townAt(LEVEL), 'orthodox');
  console.log(`(Стойкость православной деревни с храмом ${LEVEL}-го уровня — ${faithTilt(g).steadfast.toFixed(2)}; бойцов в мерке ${armySize(g)}.)`);
}

// ---------- 4. Волки и разбойники у ворот ----------

const GATE_SEEDS = 40;
const GATE_LEVELS = [1, 5, 10];

interface GateRow {
  line: string;
  label: string;
  wolves: number;
  raiders: number;
}

/**
 * Доля боёв у ворот, где пришедшие силой `power` взяли верх: бой настоящий, дверью мира (`gateParty` → `gateField`), ничего не
 * трогая; сид — свой на каждый из `GATE_SEEDS` боёв. Одна мерка на решётку раздела 4 и на таблицу по уровню (4б).
 */
function foeShare(w: Inside, at: number, foe: GateFoe, power: number): number {
  let broke = 0;
  for (let i = 1; i <= GATE_SEEDS; i++) {
    const call: GateCall = { id: `gate-bench${i}`, foe, power, seed: i * 7919 };
    if (w.gateField(w.gateParty(call), call.seed, w.save.home, at).field.won) broke++;
  }
  return broke / GATE_SEEDS;
}

/**
 * Задача веера (`lib/fan.ts`): строка раздела 4 — бой события у ворот (docs/battle_eu4.md, 14.28) на посёлке мерки
 * уровня `level` при вере `faith`, случай `CASES[c]`. Бой настоящий, дверью мира (`gateParty` → `gateField`), ничего не
 * трогая; сила — доля обороны той же функцией, что у события (`data/events.foePower`); сид — свой на каждый бой.
 */
export async function gateRow({ level, faith, c: k }: { level: number; faith: FaithId | null; c: number }): Promise<GateRow> {
  const c = CASES[k];
  const g = withFaith(townAt(level), faith);
  const { world, at } = await fieldWorld(g, SEEDS[0], c.take);
  const w: Inside = world;
  const home = w.defenders(at).all as TroopStack;
  const lost = (foe: GateFoe, share: number): { men: number; share: number } => {
    const power = foePower(g, share);
    return { men: menOfPower(power), share: foeShare(w, at, foe, power) };
  };
  const wolves = lost('wolves', WOLF_SHARE);
  const raiders = lost('raiders', RAIDER_SHARE);
  const faithName = faith ?? 'без веры';
  return {
    label: `${level}-й уровень, ${faithName}, ${c.name}`,
    wolves: wolves.share,
    raiders: raiders.share,
    line: ` ${pad(level, 2)}  ${faithName.padEnd(13)}  ${c.name.padEnd(34)}  ${pad(troopTotal(home), 4)}  ${pad(Math.round(defense(g)), 7)}  ${pad(w.save.profile.militia, 9)}  ${pad(wolves.men, 6)}  ${pad(pct(wolves.share), 19)}  ${pad(raiders.men, 11)}  ${pad(pct(raiders.share), 24)}`,
  };
}

async function gatePart(): Promise<void> {
  console.log('');
  console.log(`--- 4. Волки и разбойники у ворот: доля поражений на решётке нашей силы, ${GATE_SEEDS} боёв на клетку, мир ${SEEDS[0]} ---`);
  console.log('Бой события у ворот — ядром, той же дверью, что набег (LocalWorld.gateParty → gateField; docs/battle_eu4.md, 14.28), ничего не трогая.');
  console.log(`Сила — доля обороны (data/events.foePower): волки ${WOLF_SHARE}, разбойники ${RAIDER_SHARE} — числа руками, до пересмотра баланса (14.24).`);
  console.log('Волки — лёгкая конница без снаряжения, разбойники — отряд тем же генератором, что набег логова. Решётка — посёлок мерки 1, 5 и 10-го');
  console.log('уровня, без веры и православный, полководец увёл в поле часть войска или нет (случаи раздела 1). «поражений» — доля боёв, где пришедшие взяли верх.');
  console.log(' ур  вера           случай                              дома  оборона  ополчение  волков  поражений от волков  разбойников  поражений от разбойников');
  const rows = GATE_LEVELS.flatMap((level) => ([null, 'orthodox'] as const).flatMap((faith) => CASES.map((_, c) => ({ level, faith, c }))));
  const got = await fan(gateRow, import.meta.url, rows);
  for (const r of got) console.log(r.line);
  const span = (xs: number[]): string => `${pct(Math.min(...xs))}…${pct(Math.max(...xs))}`;
  console.log(`Поражений на решётке: от волков ${span(got.map((r) => r.wolves))}, от разбойников ${span(got.map((r) => r.raiders))}.`);
  // Прежнее обещание у волков — «почти всегда отбиваемся»: порог удалённого теста — больше 15 побед из 20, то есть
  // поражений не больше четверти.
  const wolfish = got.filter((r) => r.wolves > 1 / 4);
  console.log(
    wolfish.length > 0
      ? `Волки берут верх чаще четверти боёв («почти всегда отбиваемся» не держится) в ${wolfish.length} клетках из ${got.length}: ${wolfish.map((r) => `${r.label} — ${pct(r.wolves)}`).join('; ')}.`
      : `Волки берут верх чаще четверти боёв: ни в одной клетке из ${got.length}.`,
  );
  const often = got.filter((r) => r.raiders > 1 / 3);
  console.log(
    often.length > 0
      ? `РАЗБОЙНИКИ ПОБЕЖДАЮТ ЧАЩЕ ТРЕТИ БОЁВ в ${often.length} клетках из ${got.length}: ${often.map((r) => `${r.label} — ${pct(r.raiders)}`).join('; ')}.`
      : `Разбойники побеждают чаще трети боёв: ни в одной клетке из ${got.length}.`,
  );
}

// ---------- 4б. Сила у ворот по уровню посёлка ----------

/** Кривая «сила пришедших → поражений»: доли обороны посёлка от четверти до трёх шагом в четверть. */
const CURVE = Array.from({ length: 12 }, (_, i) => (i + 1) / 4);
/** Шагов деления отрезка у ровного боя внутри шага кривой, где доля впервые перешла половину. */
const EVEN_STEPS = 8;
/** Шагов мелкого просмотра окрестности ровного боя — от половины до полутора ровных. */
const NEAR_STEPS = 60;
/** Перевес «Ограничителя»: ровный бой, делённый на него, — таблица (слово владельца по 14.35, п. 4). */
const TABLE_EDGE = 1.1;

interface LevelFoe {
  /** Таблица, бойцов строя пришедших; `NaN` — ровного боя на кривой нет. */
  men: number;
  /** Кривая немонотонна: где-то больше пришедших — реже их верх. */
  bumpy: boolean;
  line: string;
}
interface LevelRow {
  head: string;
  wolves: LevelFoe;
  raiders: LevelFoe;
}

/**
 * Задача веера: строка таблицы силы у ворот по уровню посёлка (docs/battle_eu4.md, 14.35, слово владельца, п. 4). Гарнизон
 * мерки уровня `level` (`autopilot.townAt`, войско `armyAt`) — всё дома, без веры. Кривая — доля боёв, где пришедшие взяли
 * верх (`foeShare`, `GATE_SEEDS` боёв с костью конфига), при силе в долях обороны `CURVE`. «Ровный бой» — первое место, где
 * кривая переходит половину, уточнённое делением отрезка внутри шага; «таблица» — ровный бой, делённый на перевес
 * «Ограничителя». **Кривая не обязана быть монотонной** — бой у ворот по размеру стаи немонотонен (малый прогон при заведении
 * раздела: на 1-м уровне 110 волков брали верх чаще, чем 123), — поэтому печатается она сама, и строка помечена, где больше
 * пришедших берут верх реже. Это прибор: в игру таблица ляжет в П3, а шаг кости (П5) двигает ровный бой, и после него таблица
 * выводится заново той же командой.
 */
export async function gateLevelRow({ level }: { level: number }): Promise<LevelRow> {
  const g = withFaith(townAt(level), null);
  const { world, at } = await fieldWorld(g, SEEDS[0], []);
  const w: Inside = world;
  const d = defense(g);
  const foe = (who: GateFoe, share: number, name: string): LevelFoe => {
    const curve = CURVE.map((k) => foeShare(w, at, who, k * d));
    // Немонотонна — где-то доля упала больше чем на бой из `GATE_SEEDS`: не шум счёта, а бой другого вида.
    const bumpy = curve.some((x, i) => i > 0 && x < curve[i - 1] - 1.5 / GATE_SEEDS);
    const cross = curve.findIndex((x) => x >= 0.5);
    let men = NaN;
    let table = NaN;
    let near = '';
    let bumpyNear = false;
    if (cross >= 0) {
      let lo = cross === 0 ? 0 : CURVE[cross - 1] * d;
      let hi = CURVE[cross] * d;
      for (let k = 0; k < EVEN_STEPS; k++) {
        const mid = (lo + hi) / 2;
        if (foeShare(w, at, who, mid) < 0.5) lo = mid;
        else hi = mid;
      }
      table = hi / TABLE_EDGE;
      men = menOfPower(table);
      // Окрестность ровного боя мелким шагом: грубая кривая немонотонность между своими точками не видит.
      const sizes = Array.from({ length: NEAR_STEPS + 1 }, (_, i) => hi * (0.5 + i / NEAR_STEPS));
      const fine = sizes.map((p) => foeShare(w, at, who, p));
      const flips = fine.map((x, i) => i > 0 && x >= 0.5 !== fine[i - 1] >= 0.5).map((f, i) => (f ? i : -1)).filter((i) => i > 0);
      bumpyNear = fine.some((x, i) => i > 0 && x < fine[i - 1] - 1.5 / GATE_SEEDS);
      near = flips.length > 0 ? `; около ровного (${NEAR_STEPS} шагов от половины до полутора ровных): переходов через половину ${flips.length}, с ${menOfPower(sizes[flips[0]])} по ${menOfPower(sizes[flips[flips.length - 1]])} бойцов` : '';
    }
    const now = foePower(g, share);
    const even = Number.isFinite(table)
      ? `ровный ${menOfPower(table * TABLE_EDGE)} (${((table * TABLE_EDGE) / d).toFixed(2)} обороны), таблица ${men} — поражений ${pct(foeShare(w, at, who, table))}`
      : `ровного боя до ${CURVE[CURVE.length - 1]} обороны нет`;
    return {
      men,
      bumpy: bumpy || bumpyNear,
      line: `     ${name.padEnd(11)} ${even}; сейчас ${menOfPower(now)} (${share}) — ${pct(foeShare(w, at, who, now))}; кривая: ${curve.map((x) => pct(x)).join(' ')}${near}${bumpy || bumpyNear ? '  НЕМОНОТОННА' : ''}`,
    };
  };
  return {
    head: ` ${pad(level, 2)}-й уровень: войск ${troopTotal(g.army)}, оборона ${Math.round(d)}, ополчение ${w.save.profile.militia}`,
    wolves: foe('wolves', WOLF_SHARE, 'волки'),
    raiders: foe('raiders', RAIDER_SHARE, 'разбойники'),
  };
}

async function gateLevelPart(): Promise<void> {
  console.log('');
  console.log(`--- 4б. Сила у ворот по уровню посёлка: ровный бой для гарнизона мерки уровня, делённый на ${TABLE_EDGE} (слово владельца по 14.35, п. 4) ---`);
  console.log(`Гарнизон мерки уровня L (townAt, войско armyAt) — всё дома, без веры, мир ${SEEDS[0]}. Кривая — доля боёв, где пришедшие взяли верх, по ${GATE_SEEDS} боёв`);
  console.log(`с костью конфига, при силе ${CURVE[0]}…${CURVE[CURVE.length - 1]} обороны шагом ${CURVE[0]}. «ровный» — где кривая впервые переходит половину (уточнено делением отрезка),`);
  console.log(`«таблица» — ровный, делённый на перевес «Ограничителя» ${TABLE_EDGE}; «сейчас» — нынешняя сила, доля обороны (data/events.foePower). Бойцы — строя пришедших.`);
  const rows = Array.from({ length: MAX_BUILDING_LEVEL }, (_, i) => ({ level: i + 1 }));
  const got = await fan(gateLevelRow, import.meta.url, rows);
  for (const r of got) {
    console.log(r.head);
    console.log(r.wolves.line);
    console.log(r.raiders.line);
  }
  const rising = (xs: number[]): boolean => xs.every((x, i) => i === 0 || (Number.isFinite(x) && x >= xs[i - 1]));
  const bumpy = (pick: (r: LevelRow) => LevelFoe): string => {
    const levels = got.map((r, i) => (pick(r).bumpy ? i + 1 : 0)).filter((x) => x > 0);
    return levels.length > 0 ? levels.join(', ') : 'нет';
  };
  console.log(
    `Таблица растёт с уровнем: волки — ${rising(got.map((r) => r.wolves.men)) ? 'да' : 'НЕТ'}, разбойники — ${rising(got.map((r) => r.raiders.men)) ? 'да' : 'НЕТ'}. ` +
      `Кривая немонотонна по силе пришедших — у волков на уровнях: ${bumpy((r) => r.wolves)}; у разбойников: ${bumpy((r) => r.raiders)}.`,
  );
}

/**
 * Раздел 5 — срезает ли потолок морали прибавку обряда (docs/battle_eu4.md, 14.24; слово владельца по 14.34). Мораль на
 * входе в бой считает ядро (`battle.startMorale`): род вида, его ступень снаряжения (`kinds.gearOfTroop`) и стойкость
 * (`resolve`) — прибавка обряда той веры, уровня храма и устава, какой её даёт игра (`data/faiths.tiltAt`). Прибавка
 * срезана, если мораль с обрядом выше, чем без него, меньше чем на прибавку. Вид — однородный отряд: у смешанного мораль
 * на входе — средняя по людям, и выше самого стойкого вида она не бывает.
 */
export function ceilingPart(): void {
  console.log('');
  console.log('--- 5. Потолок морали и обряд: срезает ли потолок прибавку храма ---');
  console.log(`Мораль на входе — battle.startMorale: род вида, снаряжение (${GEAR.moralePerLevel} за ступень, ступеней до ${GEAR.max}) и прибавка обряда (data/faiths.tiltAt) — потолок ${MORALE.max}.`);
  const rites = FAITHS.filter((f) => f.tilt.fervour > 0).flatMap((f) =>
    OBSERVANCES.flatMap((o) => Array.from({ length: MAX_BUILDING_LEVEL }, (_, i) => ({ faith: f.id, obs: o.id, level: i + 1, add: tiltAt(f.id, i + 1, o.id).fervour }))),
  );
  const top = rites.reduce((a, b) => (b.add > a.add ? b : a));
  console.log(`Обряд даёт прибавку у веры: ${[...new Set(rites.map((r) => r.faith))].join(', ')}; наибольшая — +${top.add} (храм ${top.level}-го уровня, устав ${top.obs}).`);
  console.log(' вид                 род        снаряжение  без обряда  с наибольшим обрядом  запас до потолка  срезано с (храм, устав)');
  let cut = 0;
  for (const id of TROOP_IDS) {
    const kind = KIND_OF[id];
    const gear = gearOfTroop(id);
    const at = (add: number): number => startMorale({ ...deploySetup({ [kind]: 1 }), gear: { [kind]: gear }, resolve: add }, stackOf({ [kind]: 1 }));
    const bare = at(0);
    const first = rites.filter((r) => at(r.add) - bare < r.add - 1e-9).sort((a, b) => a.add - b.add)[0];
    if (first) cut += 1;
    console.log(
      ` ${TROOP_BY_ID[id].name.padEnd(19)} ${kind.padEnd(10)} ${pad(gear, 10)}  ${pad(bare, 10)}  ${pad(at(top.add), 20)}  ${pad(Math.round((MORALE.max - bare - top.add) * 100) / 100, 16)}  ${first ? `${first.level}-й, ${first.obs} (+${first.add})` : 'нет'}`,
    );
  }
  console.log(cut > 0 ? `ПОТОЛОК СРЕЗАЕТ ОБРЯД у ${cut} видов из ${TROOP_IDS.length}.` : `Потолок срезает обряд: ни у одного вида из ${TROOP_IDS.length}, ни при каком уровне храма и уставе.`);
}

export async function defenseMixSection(): Promise<void> {
  console.log('');
  console.log('=== Оборона по составу: долг среднего бойца ===');
  displayPart();
  await benchPart();
  await livePart();
  await gatePart();
  await gateLevelPart();
  ceilingPart();
}

serveFan(import.meta.url, { benchRow, mixRun, gateRow, gateLevelRow });
