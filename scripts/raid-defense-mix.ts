// Оборона по составу — отчёт `raid-mix:report` (прежде — раздел `raid:report`).
//
// Долг закрыт (docs/defense_mix.md): мощь тех, кто дома, — сумма мощи тех, кто дома (`price.troopPower`
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
//  4б. **Сила у ворот по уровню посёлка** — таблица слова владельца по 14.35, п. 4: ровный бой для типичного гарнизона уровня —
//     игрока «по умолчанию» спора за золото на жителях мерки, медианой по потокам, — делённый на перевес «Ограничителя»;
//     кривая «сила пришедших → поражений» и её окрестность мелким шагом.
//  4в. **Один боец у ворот** — сколько волков держит гарнизон мерки без кости и сколько — он же с одним бойцом сверху
//     (docs/battle_eu4.md, 14.35, «Всадник у ворот»: охват по излишку ширины).
//  5. **Потолок морали и обряд** — срезает ли потолок морали прибавку храма у какого-нибудь вида, уровня храма и устава
//     (docs/battle_eu4.md, 14.24).
import { MORALE, deploySetup, stackOf, stackTotal, startMorale } from '@/battle';
import { withDiceStep } from '@/battle/bench';
import { FAITHS, OBSERVANCES, tiltAt } from '@/game/data/faiths';
import { DAY_LENGTH, MAX_BUILDING_LEVEL } from '@/game/constants';
import { KIND_OF } from '@/game/battle/kinds';
import { LocalWorld } from '@/world/local/LocalWorld';
import { awayTroops, militiaArchers, militiaMen, playerProfile } from '@/world/bridge';
import { awayOf, homeOf, NOBODY_AWAY, type Away } from '@/world/muster';
import { faithAt } from '@/world/faith';
import { lairLevel, lairPower, lairRaid } from '@/world/lairs';
import { LAIR_ANCHOR_MID, LAIR_RIPE } from '@/world/data/tuning';
import type { GateCall, GateFoe, PlayerProfile } from '@/world/types';
import { menOfPower } from '@/world/garrison';
import { GATE_POP, GATE_POWER, gatePower } from '@/game/data/events';
import { BATTLE_MAN, troopTotal, type TroopStack } from '@/game/battle/kinds';
import { troopPower } from '@/game/battle/price';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { armySize, defense, faithTilt, homeArmyPower, mutinyForecast } from '@/game/derived';
import { dismissCheck } from '@/game/sim/upkeep';
import type { FaithId, GameState, TroopId } from '@/game/types';
import { SEEDS, mean, pad, pct, q, sum, tally } from './raid-common';
import { START, openSky, townAt, unitsNote, type Inside } from './autopilot';
import { NAME, live, portable, type Out } from './raid-live';
import { fan, serveFan } from './lib/fan';
import { GOLD_MODULE, GOLD_WORLD, typicalTowns } from './pop-gold';

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
    // Дома перевод мгновенный (docs/retinue.md, раздел 7): сбора нет, и ждать его конца нечего. Прежде стенд ждал
    // `handover.until` и с 06.10.2026 падал на нём — сбор остался только в осаде.
    const until: number | undefined = w.save.figures.general.handover?.until;
    if (until !== undefined) sky.at(until);
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
  const raid = lairRaid(lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, g.pop), g.pop, troopPower(g.army));
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
 * трогая; сила — таблица по уровню посёлка той же функцией, что у события (`data/events.gatePower`); сид — свой на каждый бой.
 */
export async function gateRow({ level, faith, c: k }: { level: number; faith: FaithId | null; c: number }): Promise<GateRow> {
  const c = CASES[k];
  const g = withFaith(townAt(level), faith);
  const { world, at } = await fieldWorld(g, SEEDS[0], c.take);
  const w: Inside = world;
  const home = w.defenders(at).all as TroopStack;
  const lost = (foe: GateFoe): { men: number; share: number } => {
    const power = gatePower(g, foe);
    return { men: menOfPower(power), share: foeShare(w, at, foe, power) };
  };
  const wolves = lost('wolves');
  const raiders = lost('raiders');
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
  console.log('Сила — таблица по уровню посёлка (data/events.gatePower; раздел 4б её выводит): уровень — зрелость жителями, войско в него не входит.');
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
/**
 * До какого уровня кривая проверяется ещё и без кости — боем на каждую голову пришедших, от одного до конца кривой (слово
 * владельца по П0, 14.35: с костью кривая немонотонна на 1–3-м уровнях, и тест монотонности у ворот спрашивает ровно их).
 */
const BARE_LEVELS = 3;

/** Потоков мерки силы у ворот — столько же, сколько у спора за золото по потокам (`pop:report`, `GOLD_STREAMS`). */
const GATE_STREAMS = 12;
/**
 * Игроки мерки — оба игрока спора за золото (`pop-gold.goldFlight`, `masters`): «по умолчанию» и «вложился в админветвь»
 * (docs/remeasure.md, шаг 0: так играют оба, и мерка на одном делает второй путь тем, от чего таблица не спрашивается). Ровный
 * бой — медиана по всем партиям: `GATE_STREAMS` потоков у каждого игрока.
 */
const GATE_PLAYERS: readonly boolean[] = [false, true];
const playerName = (masters: boolean): string => (masters ? '«вложился в админветвь»' : '«по умолчанию»');
/**
 * Срок партии мерки, игровых дней — с запасом на медленные потоки: партия останавливается, как только дошла до жителей мерки
 * 10-го уровня, а не дошла к сроку — партия уровня не видит, и раздел печатает, сколько партий дошло («дошли N партий из 24»).
 */
const TYPICAL_DAYS = 720;

/** Ровный бой пришедших против гарнизона — первое место, где кривая переходит половину, уточнённое делением отрезка. */
interface Even {
  /** Мощь пришедших в ровном бою; `NaN` — до конца кривой ровного боя нет. */
  power: number;
}

/**
 * Взяли ли пришедшие верх хотя бы в половине боёв `foeShare` — ровно `foeShare(…) >= 0.5`, теми же боями в том же порядке, но
 * только до тех пор, пока ответ не решён: половина побед набрана — да; оставшимися боями её уже не набрать — нет. Ровный бой
 * спрашивает у кривой только это, а бои после решённого ответа были большей частью раздела (docs/handbook/console.md,
 * «Где было время»). Доли кривой — `foeShare`, целиком.
 */
function foeHalf(w: Inside, at: number, foe: GateFoe, power: number): boolean {
  const need = GATE_SEEDS / 2;
  let broke = 0;
  for (let i = 1; i <= GATE_SEEDS; i++) {
    if (broke >= need) return true;
    if (broke + (GATE_SEEDS - i + 1) < need) return false;
    const call: GateCall = { id: `gate-bench${i}`, foe, power, seed: i * 7919 };
    if (w.gateField(w.gateParty(call), call.seed, w.save.home, at).field.won) broke++;
  }
  return broke >= need;
}

/** Кривая: доля боёв, где пришедшие взяли верх, при силе `CURVE` долей обороны. */
const curveOf = (w: Inside, at: number, who: GateFoe, d: number): number[] => CURVE.map((k) => foeShare(w, at, who, k * d));

/**
 * Ровный бой: первая точка кривой, где доля доходит до половины, и деление отрезка до неё — теми же решениями, что по
 * кривой целиком (`curveOf(…)[i] >= 0.5`), но без долей: кривая нужна только медианной партии, и её строит `gateFoeRow`.
 */
function evenOf(w: Inside, at: number, who: GateFoe, d: number): Even {
  const cross = CURVE.findIndex((k) => foeHalf(w, at, who, k * d));
  if (cross < 0) return { power: NaN };
  let lo = cross === 0 ? 0 : CURVE[cross - 1] * d;
  let hi = CURVE[cross] * d;
  for (let k = 0; k < EVEN_STEPS; k++) {
    const mid = (lo + hi) / 2;
    if (!foeHalf(w, at, who, mid)) lo = mid;
    else hi = mid;
  }
  return { power: hi };
}

/** Посёлок мерки силы у ворот — снимок партии: вызовы к воротам, ждавшие боя в минуту снимка, в бой мерки не идут. */
const benchTown = (g: GameState): GameState => ({ ...structuredClone(g), gate: [] });

interface StreamEven {
  level: number;
  /** Партия мерки — номер в списке партий раздела (игрок и поток). */
  flight: number;
  army: number;
  defense: number;
  militia: number;
  wolves: Even;
  raiders: Even;
}

/**
 * Задача веера: ровный бой у ворот на гарнизоне типичного посёлка уровня `level` — игрока спора в партии `flight`
 * (`pop-gold.typicalTowns`): всё его войско дома, вера — какая у него есть; мир боя — `SEEDS[0]`, как у раздела 4.
 */
export async function gateEven({ level, flight, g: town }: { level: number; flight: number; g: GameState }): Promise<StreamEven> {
  const g = benchTown(town);
  const { world, at } = await fieldWorld(g, SEEDS[0], []);
  const w: Inside = world;
  const d = defense(g);
  return { level, flight, army: troopTotal(g.army), defense: Math.round(d), militia: w.save.profile.militia, wolves: evenOf(w, at, 'wolves', d), raiders: evenOf(w, at, 'raiders', d) };
}

interface LevelFoe {
  /** Таблица, бойцов строя пришедших; `NaN` — ровного боя на кривой нет. */
  men: number;
  /** Таблица мощью — той мерой, которой её зовёт вызов к воротам (`GateCall.power`); `NaN` — ровного боя нет. */
  power: number;
  /** Кривая немонотонна: где-то больше пришедших — реже их верх. */
  bumpy: boolean;
  line: string;
  /** Без кости, на каждую голову (`BARE_LEVELS`): где пришедшим на одного больше — и верх уже не их. */
  bare?: string;
}

interface FoeJob {
  level: number;
  who: GateFoe;
  g: GameState;
  /** Чья партия медианная: поток и игрок. */
  flight: string;
  even: Even;
  table: number;
  spread: string;
}

/**
 * Задача веера: строка таблицы одного противника на уровне `level`. Таблица — медиана ровного боя по партиям, делённая на
 * перевес «Ограничителя» (`table`, мощью); подробности — кривая, окрестность ровного боя мелким шагом, бой без кости на первых
 * уровнях и доля поражений от таблицы и от силы игры — на снимке партии, чей ровный бой — нижняя медиана (`g`). **Кривая не
 * обязана быть монотонной** — бой у ворот по размеру стаи немонотонен, — поэтому печатается она сама, и строка помечена, где
 * больше пришедших берут верх реже.
 */
export async function gateFoeRow({ level, who, g: town, flight, even, table, spread }: FoeJob): Promise<LevelFoe> {
  const g = benchTown(town);
  const { world, at } = await fieldWorld(g, SEEDS[0], []);
  const w: Inside = world;
  const d = defense(g);
  const name = who === 'wolves' ? 'волки' : 'разбойники';
  const curve = curveOf(w, at, who, d);
  // Немонотонна — где-то доля упала больше чем на бой из `GATE_SEEDS`: не шум счёта, а бой другого вида.
  const bumpy = curve.some((x, i) => i > 0 && x < curve[i - 1] - 1.5 / GATE_SEEDS);
  let near = '';
  let bumpyNear = false;
  if (Number.isFinite(even.power)) {
    // Окрестность ровного боя мелким шагом: грубая кривая немонотонность между своими точками не видит.
    const hi = even.power;
    const sizes = Array.from({ length: NEAR_STEPS + 1 }, (_, i) => hi * (0.5 + i / NEAR_STEPS));
    const fine = sizes.map((p) => foeShare(w, at, who, p));
    const flips = fine.map((x, i) => i > 0 && x >= 0.5 !== fine[i - 1] >= 0.5).map((f, i) => (f ? i : -1)).filter((i) => i > 0);
    bumpyNear = fine.some((x, i) => i > 0 && x < fine[i - 1] - 1.5 / GATE_SEEDS);
    near = flips.length > 0 ? `; около ровного (${NEAR_STEPS} шагов от половины до полутора ровных): переходов через половину ${flips.length}, с ${menOfPower(sizes[flips[0]])} по ${menOfPower(sizes[flips[flips.length - 1]])} бойцов` : '';
  }
  const now = gatePower(g, who);
  let bare: string | undefined;
  if (level <= BARE_LEVELS) {
    // Бой — той же дверью, что у события: мощь две на голову (`menOfPower` ставит ровно `n`), сид один на кривую.
    const top = menOfPower(CURVE[CURVE.length - 1] * d);
    const won: boolean[] = [];
    withDiceStep(0, () => {
      for (let n = 1; n <= top; n++) {
        const call: GateCall = { id: 'gate-bare', foe: who, power: n * BATTLE_MAN, seed: 7919 };
        won[n] = w.gateField(w.gateParty(call), call.seed, w.save.home, at).field.won;
      }
    });
    const drops = won.flatMap((x, n) => (n > 1 && won[n - 1] && !x ? [n] : []));
    const first = won.findIndex((x) => x);
    const span = drops.length > 0 ? ` (с ${drops[0]} по ${drops[drops.length - 1]}; при нечётном числе пришедших — ${drops.filter((n) => n % 2 === 1).length})` : '';
    bare = `       без кости, 1…${top} по одному: верх впервые при ${first < 0 ? '—' : first}; на одного больше — и верх уже не их: ${drops.length} раз${span}`;
  }
  const head = Number.isFinite(table)
    ? `ровный по партиям ${spread}; таблица ${menOfPower(table)} — поражений медианного (${flight}, ровный ${menOfPower(even.power)}) ${pct(foeShare(w, at, who, table))}`
    : `ровного боя до ${CURVE[CURVE.length - 1]} обороны нет ни в одной партии`;
  return {
    men: Number.isFinite(table) ? menOfPower(table) : NaN,
    power: table,
    bumpy: bumpy || bumpyNear,
    line: `     ${name.padEnd(11)} ${head}; в игре ${menOfPower(now)} (мощь ${Math.round(now)}, таблица уровня ${GATE_POWER[who][level - 1]}) — ${pct(foeShare(w, at, who, now))}; кривая медианного: ${curve.map((x) => pct(x)).join(' ')}${near}${bumpy || bumpyNear ? '  НЕМОНОТОННА' : ''}`,
    ...(bare ? { bare } : {}),
  };
}

interface LevelRow {
  head: string;
  /** Жители посёлка мерки уровня — столбец жителей таблицы игры (`GATE_POP`). */
  pop: number;
  wolves: LevelFoe;
  raiders: LevelFoe;
}

/** Медиана: при чётном числе — среднее двух средних; пусто — `NaN`. */
const medianOf = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length === 0 ? NaN : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function gateLevelPart(): Promise<void> {
  console.log('');
  console.log(`--- 4б. Сила у ворот по уровню посёлка: ровный бой для типичного гарнизона уровня, делённый на ${TABLE_EDGE} (слово владельца по 14.35, п. 4) ---`);
  console.log(`Типичный гарнизон уровня L — оба игрока спора за золото, ${GATE_PLAYERS.map(playerName).join(' и ')} (pop-gold.typicalTowns: высокий налог, найм по средствам, мир ${GOLD_WORLD}),`);
  console.log(`в минуту, когда его жители впервые доходят до жителей мерки уровня (data/events.GATE_POP), на ${GATE_STREAMS} потоках случайности у каждого, срок ${TYPICAL_DAYS} игровых дней;`);
  console.log(`всё войско дома, вера — его; бой у ворот — мир ${SEEDS[0]}, как у раздела 4 (направление владельца, docs/battle_eu4.md, 14.35, «Заход 30.09.2026»).`);
  console.log(`Кривая — доля боёв, где пришедшие взяли верх, по ${GATE_SEEDS} боёв с костью конфига, при силе ${CURVE[0]}…${CURVE[CURVE.length - 1]} обороны шагом ${CURVE[0]};`);
  console.log(`«ровный» — где кривая впервые переходит половину (уточнено делением отрезка), по каждой партии; «таблица» — медиана ровного по всем ${GATE_STREAMS * GATE_PLAYERS.length} партиям,`);
  console.log(`делённая на перевес «Ограничителя» ${TABLE_EDGE}; подробности — на медианной партии (нижняя медиана ровного). «в игре» — сила, с которой`);
  console.log('пришедшие выходят к этому посёлку (data/events.gatePower по жителям), и строка таблицы игры его уровня (data/events.GATE_POWER).');
  console.log('Партии мерки идут с таблицей игры, и бои у ворот в них настоящие: мерка зависит от самой таблицы — сошлась ли она, печатают последние строки.');
  console.log(`На ${BARE_LEVELS} первых уровнях кривая медианного ещё и без кости: бой на каждую голову пришедших, от одного до ${CURVE[CURVE.length - 1]} обороны (разбор — 14.35).`);
  const flights = GATE_PLAYERS.flatMap((masters) => Array.from({ length: GATE_STREAMS }, (_, i) => ({ masters, stream: i + 1 })));
  const towns = await fan(typicalTowns, GOLD_MODULE, flights.map(({ masters, stream }) => ({ masters, stream, seconds: TYPICAL_DAYS * DAY_LENGTH })));
  const jobs = flights.flatMap((_, i) => towns[i].flatMap((g, l) => (g ? [{ level: l + 1, flight: i, g }] : [])));
  const flightName = (i: number): string => `поток ${flights[i].stream}, ${playerName(flights[i].masters)}`;
  const evens = await fan(gateEven, import.meta.url, jobs);
  const table: Record<GateFoe, number[]> = { wolves: [], raiders: [] };
  const foeJobs: FoeJob[] = [];
  const heads: string[] = [];
  for (let level = 1; level <= MAX_BUILDING_LEVEL; level++) {
    const at = evens.filter((e) => e.level === level);
    const m = townAt(level);
    const span = (xs: number[]): string => (xs.length ? `${medianOf(xs)} (${Math.min(...xs)}…${Math.max(...xs)})` : '—');
    heads.push(
      ` ${pad(level, 2)}-й уровень: жителей ${GATE_POP[level - 1]} (по прямой лестницы логов — ${lairLevel(GATE_POP[level - 1]).toFixed(2)}-й); дошли ${at.length} партий из ${flights.length}; войско ${span(at.map((e) => e.army))}, оборона ${span(at.map((e) => e.defense))}, ополчение ${span(at.map((e) => e.militia))}; у посёлка мерки (townAt) — войско ${troopTotal(m.army)}, оборона ${Math.round(defense(m))}`,
    );
    for (const who of ['wolves', 'raiders'] as const) {
      const got = at.filter((e) => Number.isFinite(e[who].power)).sort((a, b) => a[who].power - b[who].power);
      const value = got.length > 0 ? medianOf(got.map((e) => e[who].power)) / TABLE_EDGE : NaN;
      table[who].push(Math.round(value));
      const mid = got[(got.length - 1) >> 1] ?? at[0];
      if (!mid) continue;
      // Медиана у каждого игрока порознь — видно, чей гарнизон тянет таблицу; таблица — по всем партиям.
      const own = GATE_PLAYERS.map((masters) => {
        const xs = got.filter((e) => flights[e.flight].masters === masters).map((e) => e[who].power);
        return `${playerName(masters)} ${xs.length > 0 ? menOfPower(medianOf(xs)) : '—'}`;
      });
      const spread = got.length > 0 ? `медиана ${menOfPower(value * TABLE_EDGE)} (${menOfPower(got[0][who].power)}…${menOfPower(got[got.length - 1][who].power)}; ${got.length} партий; ${own.join(', ')})` : '—';
      foeJobs.push({ level, who, g: towns[mid.flight][level - 1]!, flight: flightName(mid.flight), even: mid[who], table: value, spread });
    }
  }
  const foeRows = await fan(gateFoeRow, import.meta.url, foeJobs);
  const got: LevelRow[] = heads.map((head, i) => {
    const pick = (who: GateFoe): LevelFoe => {
      const k = foeJobs.findIndex((j) => j.level === i + 1 && j.who === who);
      return k >= 0 ? foeRows[k] : { men: NaN, power: NaN, bumpy: false, line: `     ${who === 'wolves' ? 'волки' : 'разбойники'} — ни один поток до уровня не дошёл` };
    };
    return { head, pop: townAt(i + 1).pop, wolves: pick('wolves'), raiders: pick('raiders') };
  });
  for (const r of got) {
    console.log(r.head);
    console.log(r.wolves.line);
    if (r.wolves.bare) console.log(r.wolves.bare);
    console.log(r.raiders.line);
    if (r.raiders.bare) console.log(r.raiders.bare);
  }
  const rising = (xs: number[]): boolean => xs.every((x, i) => i === 0 || (Number.isFinite(x) && x >= xs[i - 1]));
  const bumpy = (pick: (r: LevelRow) => LevelFoe): string => {
    const levels = got.map((r, i) => (pick(r).bumpy ? i + 1 : 0)).filter((x) => x > 0);
    return levels.length > 0 ? levels.join(', ') : 'нет';
  };
  console.log(
    `Таблица растёт с уровнем: волки — ${rising(table.wolves) ? 'да' : 'НЕТ'}, разбойники — ${rising(table.raiders) ? 'да' : 'НЕТ'}. ` +
      `Кривая медианного немонотонна по силе пришедших — у волков на уровнях: ${bumpy((r) => r.wolves)}; у разбойников: ${bumpy((r) => r.raiders)}.`,
  );
  const pops = got.map((r) => r.pop);
  const samePop = pops.every((x, i) => x === GATE_POP[i]);
  console.log(`Жители мерки в таблице игры (data/events.GATE_POP): ${samePop ? 'совпадают с посёлками мерки' : `РАЗОШЛИСЬ с посёлками мерки — в игре ${GATE_POP.join(', ')}; у мерки ${pops.join(', ')}`}.`);
  // Таблица игры против выведенной. Мерка зависит от таблицы — партии мерки бьются у ворот с таблицей игры, — и выведенная на
  // таблице игры — следующий шаг той же неподвижной точки: совпала — точка найдена; нет — насколько далеко (по уровням).
  for (const [who, name] of [['wolves', 'волки'], ['raiders', 'разбойники']] as const) {
    const derived = table[who];
    const same = derived.every((x, i) => x === GATE_POWER[who][i]);
    const off = derived.map((x, i) => `${((100 * (x - GATE_POWER[who][i])) / GATE_POWER[who][i]).toFixed(1)}`);
    console.log(
      `Таблица игры (data/events.GATE_POWER), ${name}: ${same ? 'совпадает с выведенной' : `РАЗОШЛАСЬ с выведенной — в игре ${GATE_POWER[who].join(', ')}; выведено ${derived.join(', ')}; выведенная против игры по уровням, %: ${off.join(' ')}`}.`,
    );
  }
}

// ---------- 4в. Один боец у ворот ----------

const ONE_LEVELS = [1, 2, 3];

interface OneRow {
  lines: string[];
}

/**
 * Задача веера (`lib/fan.ts`): раздел 4в на гарнизоне мерки уровня `level` — как есть или без всадников (`bare`). Бой — дверью
 * мира (`gateParty` → `gateField`), без кости: от сида он тогда не зависит, и это не один бой, а ожидание. «Держит» —
 * наибольшая стая, которую гарнизон отбивает вместе со всеми меньшими (первая стая, что берёт верх, минус один). Та же
 * мерка — у теста «один боец у ворот не двигает выдерживаемую стаю скачком» (`world/gatemono.test.ts`).
 */
export async function oneSoldierRow({ level, bare }: { level: number; bare: boolean }): Promise<OneRow> {
  const held = async (add: TroopId | null): Promise<{ held: number; men: number; edges: number }> => {
    const g = townAt(level);
    g.faith.id = null;
    if (bare) g.army.rider = 0;
    if (add) g.army[add] = (g.army[add] ?? 0) + 1;
    const sky = openSky(g, { seed: SEEDS[0], pulse: 30, raids: true });
    await sky.pulse();
    const w: Inside = sky.world;
    const at = sky.now();
    let first = -1;
    let men = 0;
    let edges = 0;
    withDiceStep(0, () => {
      for (let n = 1; n <= 4000; n += 1) {
        const call: GateCall = { id: 'one', foe: 'wolves', power: n * BATTLE_MAN, seed: 7919 };
        const r = w.gateField(w.gateParty(call), call.seed, w.save.home, at).field;
        if (n === 1 && r.result) {
          const d = r.result.sides.defender;
          men = stackTotal(d.initial);
          edges = stackTotal(d.sectors.A.initial) + stackTotal(d.sectors.C.initial);
        }
        if (r.won) {
          first = n;
          break;
        }
      }
    });
    return { held: first - 1, men, edges };
  };
  const base = await held(null);
  const lines = [`  ${pad(level, 2)}-й уровень${bare ? ', без всадников' : ''}: держит ${base.held} волков; гарнизон в бою ${base.men} бойцов строя, на краях ${base.edges}`];
  const parts: string[] = [];
  for (const id of TROOP_IDS) {
    const one = await held(id);
    const moved = one.held - base.held;
    parts.push(`${TROOP_BY_ID[id].name} ${moved >= 0 ? '+' : ''}${moved} (${((100 * moved) / Math.max(1, base.held)).toFixed(1)} %)`);
  }
  lines.push(`      +1 боец — сдвиг стаи, которую держит: ${parts.join('; ')}`);
  return { lines };
}

async function oneSoldierPart(): Promise<void> {
  console.log('');
  console.log('--- 4в. Один боец у ворот: сколько волков держит гарнизон мерки без кости и сколько — с одним бойцом сверху ---');
  console.log(`Гарнизон мерки уровня L (townAt), без веры, мир ${SEEDS[0]}; «без всадников» — те же, всадников ноль. Бой — дверью мира, без кости`);
  console.log('(от сида не зависит). «Держит» — наибольшая стая, которую гарнизон отбивает вместе со всеми меньшими. Охват — по излишку ширины:');
  console.log('горстка в полосе держит столько, сколько занимает (docs/battle_eu4.md, 14.35, «Всадник у ворот»). Сдвиг — в волках и в доле стаи.');
  const rows = ONE_LEVELS.flatMap((level) => [false, true].map((bare) => ({ level, bare })));
  const got = await fan(oneSoldierRow, import.meta.url, rows);
  for (const r of got) for (const l of r.lines) console.log(l);
}

/**
 * Раздел 5 — срезает ли потолок морали прибавку обряда (docs/battle_eu4.md, 14.24; слово владельца по 14.34). Мораль на
 * входе в бой считает ядро (`battle.startMorale`): род вида (морали за снаряжение нет — путь П2, 14.35) и стойкость
 * (`resolve`) — прибавка обряда той веры, уровня храма и устава, какой её даёт игра (`data/faiths.tiltAt`). Прибавка
 * срезана, если мораль с обрядом выше, чем без него, меньше чем на прибавку. Вид — однородный отряд: у смешанного мораль
 * на входе — средняя по людям, и выше самого стойкого вида она не бывает.
 */
export function ceilingPart(): void {
  console.log('');
  console.log('--- 5. Потолок морали и обряд: срезает ли потолок прибавку храма ---');
  console.log(`Мораль на входе — battle.startMorale: мораль рода вида (за снаряжение морали нет — путь П2, 14.35) и прибавка обряда (data/faiths.tiltAt) — потолок ${MORALE.max}.`);
  const rites = FAITHS.filter((f) => f.tilt.fervour > 0).flatMap((f) =>
    OBSERVANCES.flatMap((o) => Array.from({ length: MAX_BUILDING_LEVEL }, (_, i) => ({ faith: f.id, obs: o.id, level: i + 1, add: tiltAt(f.id, i + 1, o.id).fervour }))),
  );
  const top = rites.reduce((a, b) => (b.add > a.add ? b : a));
  console.log(`Обряд даёт прибавку у веры: ${[...new Set(rites.map((r) => r.faith))].join(', ')}; наибольшая — +${top.add} (храм ${top.level}-го уровня, устав ${top.obs}).`);
  console.log(' вид                 род        без обряда  с наибольшим обрядом  запас до потолка  срезано с (храм, устав)');
  let cut = 0;
  for (const id of TROOP_IDS) {
    const kind = KIND_OF[id];
    const at = (add: number): number => startMorale({ ...deploySetup({ [kind]: 1 }), resolve: add }, stackOf({ [kind]: 1 }));
    const bare = at(0);
    const first = rites.filter((r) => at(r.add) - bare < r.add - 1e-9).sort((a, b) => a.add - b.add)[0];
    if (first) cut += 1;
    console.log(
      ` ${TROOP_BY_ID[id].name.padEnd(19)} ${kind.padEnd(10)} ${pad(bare, 10)}  ${pad(at(top.add), 20)}  ${pad(Math.round((MORALE.max - bare - top.add) * 100) / 100, 16)}  ${first ? `${first.level}-й, ${first.obs} (+${first.add})` : 'нет'}`,
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
  await oneSoldierPart();
  ceilingPart();
}

serveFan(import.meta.url, { benchRow, mixRun, gateRow, gateEven, gateFoeRow, oneSoldierRow });
