// Оборона по составу — раздел `raid:report`.
//
// Долг (docs/PROMISES_DEBT.md, «Оборона дома и мощь дружины — средней мощью бойца»): племя знает, сколько
// бойцов не дома (`s.warriorsAway`), но не знает, кто это, и мощь тех, кто дома, считает долей всей мощи
// (`derived.homeArmyPower` = бойцов дома × средняя мощь всего войска). Когда дома всё войско, это одно и
// то же; расходится, когда полководец увёл часть. Раздел меряет, **где это число что-то решает сегодня**,
// когда набег больше не собирается из обороны (docs/lair_growth.md), и что станет с правилом «мощь дома —
// сумма мощи тех, кто дома».
//
// «По составу» — одна подстановка, и она собрана из функций самой игры, а не своей арифметикой: племя,
// у которого войско — ровно те, кто дома (`muster.homeOf`), и никто не в отлучке. Его `defense`,
// `militiaMen`, `militiaArchers` и `mutinyForecast` — и есть число по составу: при всём войске дома
// средняя мощь на число бойцов равна сумме мощи.
//
// Разделы:
//  1. **Что показывает число** — посёлок мерки, полководец увёл тяжёлых или лёгких: мощь дома, оборона,
//     ополчение и стража против мятежа — по среднему и по составу; разрешает ли роспуск в казармах тех, кого
//     дома нет.
//  2. **Что число говорит о бое у стены** — настоящий бой (`LocalWorld.wallField`) на мире, где полководец
//     увёл часть войска в поле: при какой силе набега прорывается половина набегов, в долях обеих оборон.
//  3. **Живые прогоны** — «по средствам, высокий налог» (docs/hiring.md) на посёлке мерки 10-го уровня, 4 ч ×
//     5 миров: игра против подстановки по составу, случаи «всё дома», «увёл тяжёлых», «увёл лёгких»; вера
//     мира и православная деревня (вера подставлена).
import { LocalWorld } from '@/world/local/LocalWorld';
import { awayTroops, militiaArchers, militiaMen, playerProfile, syncAway } from '@/world/bridge';
import { awayMen, awayOf, homeOf, NOBODY_AWAY, type Away } from '@/world/muster';
import { faithAt } from '@/world/faith';
import { lairPower, lairRaid } from '@/world/lairs';
import { LAIR_ANCHOR_MID, LAIR_RIPE } from '@/world/data/tuning';
import type { MarchView, FigureView, PlayerProfile } from '@/world/types';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { armySize, defense, faithTilt, homeArmyPower, mutinyForecast } from '@/game/derived';
import { dismissCheck } from '@/game/sim/upkeep';
import type { FaithId, GameState, TroopId } from '@/game/types';
import { SEEDS, START, mean, pad, pct, q, sum, tally, townAt, type Inside } from './raid-lair-growth';
import { NAME, live, type Out } from './raid-hiring';

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
  return { ...g, army, warriorsAway: 0, away: {} };
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
  console.log('warriorsAway — сколько не дома (muster.awayOf → awayMen, как у syncAway). «по среднему» — функции игры; «по составу» — они же на племени,');
  console.log('у которого войско — те, кто дома. «стража подавит» — mutinyForecast.crush: скольких невольников удержат бойцы дома.');
  console.log(' ур  вера           случай                              дома  мощь дома: ср.  сост.  ошибка  оборона: ср.  сост.  ошибка  ополчение: ср.  сост.  стража подавит: ср.  сост.');
  for (const level of [5, 10]) {
    for (const faith of [null, 'orthodox'] as const) {
      for (const c of CASES) {
        const g = withFaith(townAt(level), faith);
        const away = fieldAway(pick(g.army, c.take));
        g.warriorsAway = awayMen(away);
        g.away = awayTroops(g.army, away);
        const home = homeOf(g.army, away);
        const comp = byComposition(g, home);
        const pa = homeArmyPower(g);
        const pc = homeArmyPower(comp);
        const da = defense(g);
        const dc = defense(comp);
        console.log(
          ` ${pad(level, 2)}  ${(faith ?? 'без веры').padEnd(13)}  ${c.name.padEnd(34)}  ${pad(troopTotal(home), 4)}  ${pad(Math.round(pa), 14)}  ${pad(Math.round(pc), 5)}  ${pad(signed(pc > 0 ? pa / pc - 1 : 0), 6)}  ${pad(Math.round(da), 12)}  ${pad(Math.round(dc), 5)}  ${pad(signed(da / dc - 1), 6)}  ${pad(militiaMen(g), 14)}  ${pad(militiaMen(comp), 5)}  ${pad(mutinyForecast(g).crush, 19)}  ${pad(mutinyForecast(comp).crush, 5)}`,
        );
      }
    }
  }
  const g = townAt(10);
  const taken = pick(g.army, ['legionary', 'rider']);
  const away = fieldAway(taken);
  g.warriorsAway = awayMen(away);
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

/** Мир, где полководец увёл `take` в поле и стоит там. Возвращает мир и минуту боя. */
async function fieldWorld(g: GameState, seed: number, take: readonly TroopId[]): Promise<{ world: LocalWorld; at: number }> {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  const w: Inside = world;
  let marches: MarchView[] = [];
  let figures: FigureView[] = [];
  const pulse = async (): Promise<void> => {
    const p = await world.sync(playerProfile(g, awayOf(marches, figures)));
    syncAway(g, p.marches, p.figures);
    marches = p.marches;
    figures = p.figures;
  };
  await pulse();
  const troops = pick(g.army, take);
  if (troopTotal(troops) > 0) {
    const err = await world.setGarrison(troops);
    if (err) throw new Error(`setGarrison: ${err}`);
    now = w.save.figures.general.handover.until;
    await pulse();
    const home = w.save.home;
    const err2 = await world.moveFigure('general', { x: home.x + 4, y: home.y });
    if (err2) throw new Error(`moveFigure: ${err2}`);
    now = w.save.figures.general.arriveAt;
    await pulse();
    // Второй пульс: слепок, собранный по спискам мира с прошлого пульса, догоняет место дружины.
    await pulse();
  }
  return { world, at: now };
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

async function benchPart(): Promise<void> {
  console.log('');
  console.log(`--- 2. Что число говорит о бое у стены: LocalWorld.wallField, посёлок мерки 10-го уровня, ${BENCH_SEEDS} боёв на силу набега, мир ${SEEDS[0]} ---`);
  console.log('Полководец уводит дружину и стоит в поле в четырёх клетках от ворот. Сила набега — доля обороны по составу с шагом 0.1;');
  console.log('«полпути» — сила, при которой прорывается половина боёв (между соседними ступенями — линейно), в долях обеих оборон.');
  console.log('«набег логова» — дозревшее логово медианной опоры при жителях посёлка (lairs.lairRaid), прорывов при нём.');
  console.log('«по составу» у боя — ополчение и стрелки башни из подстановки по составу (оборона в бой не входит, входят только они).');
  console.log('Где ополчение по среднему и по составу совпало, бой тот же до сида, и строка «по составу» не гоняется, а пишется «то же».');
  console.log(' ур  вера           случай                              вариант       дома  оборона: ср.  сост.  ополчение  полпути  к ср.  к сост.  набег логова  прорывов при нём');
  for (const level of [10]) {
    for (const faith of [null, 'orthodox'] as const) {
      for (const c of CASES) {
        const g = withFaith(townAt(level), faith);
        const { world, at } = await fieldWorld(g, SEEDS[0], c.take);
        const w: Inside = world;
        const home = w.defenders(at).all as TroopStack;
        const comp = byComposition(g, home);
        const da = defense(g);
        const dc = defense(comp);
        const raid = lairRaid(lairPower(LAIR_ANCHOR_MID, { bornAt: 0, burnedAt: 0 }, LAIR_RIPE, g.pop), g.pop);
        const was = { militia: w.save.profile.militia, archers: w.save.profile.militiaArchers };
        for (const variant of ['игра', 'по составу'] as const) {
          const same = militiaMen(comp) === was.militia && militiaArchers(comp) === was.archers;
          if (variant === 'по составу' && same) {
            console.log(` ${pad(level, 2)}  ${(faith ?? 'без веры').padEnd(13)}  ${c.name.padEnd(34)}  ${variant.padEnd(12)}  то же`);
            continue;
          }
          if (variant === 'по составу') {
            w.save.profile.militia = militiaMen(comp);
            w.save.profile.militiaArchers = militiaArchers(comp);
          } else {
            w.save.profile.militia = was.militia;
            w.save.profile.militiaArchers = was.archers;
          }
          const rates = SHARES.map((k) => breakShare(w, at, k * dc));
          const i = rates.findIndex((r) => r >= 0.5);
          let half = NaN;
          if (i === 0) half = SHARES[0] * dc;
          else if (i > 0) {
            const t = (0.5 - rates[i - 1]) / (rates[i] - rates[i - 1]);
            half = (SHARES[i - 1] + t * (SHARES[i] - SHARES[i - 1])) * dc;
          }
          const fmt = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '—');
          console.log(
            ` ${pad(level, 2)}  ${(faith ?? 'без веры').padEnd(13)}  ${c.name.padEnd(34)}  ${variant.padEnd(12)}  ${pad(troopTotal(home), 4)}  ${pad(Math.round(da), 12)}  ${pad(Math.round(dc), 5)}  ${pad(w.save.profile.militia, 9)}  ${pad(Number.isFinite(half) ? Math.round(half) : '—', 7)}  ${pad(fmt(half / da), 5)}  ${pad(fmt(half / dc), 7)}  ${pad(Math.round(raid), 12)}  ${pad(pct(breakShare(w, at, raid)), 16)}`,
          );
        }
      }
    }
  }
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

async function liveRow(level: number, c: Case, variant: 'игра' | 'по составу', faith: 'мир' | 'нет' | 'orthodox'): Promise<{ outs: Out[]; watch: Watch[] }> {
  const outs: Out[] = [];
  const watch: Watch[] = [];
  for (const seed of SEEDS) {
    const x: Watch = { errors: [], militiaApart: 0, pulses: 0, druzhinaEnd: 0, druzhinaCut: 0 };
    const g = townAt(level);
    if (faith === 'orthodox') g.faith.id = 'orthodox';
    let step: 'muster' | 'move' | 'done' = c.take.length > 0 ? 'muster' : 'done';
    outs.push(
      await live({
        g,
        seed,
        style: 'meansHigh',
        hours: 4,
        ripe: true,
        faith: faith !== 'нет',
        profile: (p: PlayerProfile, s: GameState, away: Away) => {
          const comp = byComposition(s, homeOf(s.army, away));
          const dc = defense(comp);
          x.pulses++;
          if (dc > 0) x.errors.push(p.defense / dc - 1);
          const mm = militiaMen(comp);
          const ma = militiaArchers(comp);
          if (mm !== p.militia || ma !== p.militiaArchers) x.militiaApart++;
          if (variant === 'по составу') {
            p.defense = dc;
            p.militia = mm;
            p.militiaArchers = ma;
          }
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
      }),
    );
    watch.push(x);
  }
  return { outs, watch };
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
  console.log('Прогон — live раздела «Найм». «вера: нет» — как мерился «Найм» (мир веру называл, автопилот её не брал: syncFaith не звался); «мир» — вера, которую');
  console.log('мир называет пульсом, как world/store; «orthodox» — вера подставлена до прогона, храм 10-го уровня. «увёл» — полководец в первые минуты');
  console.log('забирает всех бойцов этих видов, что дома, и уходит на 4 клетки в поле до конца прогона. «по составу» — подстановка в слепок перед');
  console.log('каждым пульсом: оборона, ополчение и стрелки башни. «набег / оборона» — к обороне слепка того варианта; «ошибка обороны» — оборона слепка');
  console.log('игры против обороны по составу, 10-я…медиана…90-я по пульсам; «ополчение врозь» — пульсов, где ополчение или стрелки разошлись;');
  console.log('«дружина в конце» — средняя по мирам; «убыла в поле» — сумма по мирам: на сколько бойцов дружина стала меньше от пульса к пульсу, пока полководец стоял в поле.');
  console.log('Полководец в бой не ходит: убыль в поле — не потери боя.');
  console.log(' вера      случай                              вариант       набегов  набег / оборона  у стены  прорвали  лагерей  доля осад  падений/ч  потери, удержали  войско дома: медиана  дружина в конце  убыла в поле  распущено  ошибка обороны  ополчение врозь');
  const rows: { faith: 'мир' | 'нет' | 'orthodox'; c: Case; variants: ('игра' | 'по составу')[] }[] = [
    { faith: 'нет', c: CASES[0], variants: ['игра'] },
    { faith: 'мир', c: CASES[0], variants: ['игра'] },
    { faith: 'мир', c: CASES[1], variants: ['игра', 'по составу'] },
    { faith: 'мир', c: CASES[2], variants: ['игра', 'по составу'] },
    { faith: 'orthodox', c: CASES[1], variants: ['игра', 'по составу'] },
    { faith: 'orthodox', c: CASES[2], variants: ['игра', 'по составу'] },
  ];
  for (const r of rows) {
    for (const variant of r.variants) {
      const { outs, watch } = await liveRow(LEVEL, r.c, variant, r.faith);
      const t = tally(
        outs.map((o) => o.run),
        HOURS,
      );
      const errs = watch.flatMap((x) => x.errors);
      console.log(
        ` ${r.faith.padEnd(8)}  ${r.c.name.padEnd(34)}  ${variant.padEnd(12)}  ${pad(t.raids, 7)}  ${pad(t.ratio, 15)}  ${pad(t.walls, 7)}  ${pad(t.broke, 8)}  ${pad(t.sieges, 7)}  ${pad(t.siegeShare, 9)}  ${pad(t.perHour, 9)}  ${pad(t.held, 16)}  ${pad(Math.round(q(outs.flatMap((o) => o.l.armyHome), 0.5)), 20)}  ${pad(Math.round(mean(watch.map((x) => x.druzhinaEnd))), 15)}  ${pad(sum(watch.map((x) => x.druzhinaCut)), 12)}  ${pad(sum(outs.map((o) => o.l.dismissed)), 9)}  ${pad(`${signed(q(errs, 0.1))}…${signed(q(errs, 0.5))}…${signed(q(errs, 0.9))}`, 14)}  ${pad(`${sum(watch.map((x) => x.militiaApart))} из ${sum(watch.map((x) => x.pulses))}`, 15)}`,
      );
    }
  }
  const g = withFaith(townAt(LEVEL), 'orthodox');
  console.log(`(Стойкость православной деревни с храмом ${LEVEL}-го уровня — ${faithTilt(g).steadfast.toFixed(2)}; бойцов в мерке ${armySize(g)}.)`);
}

export async function defenseMixSection(): Promise<void> {
  console.log('');
  console.log('=== Оборона по составу: долг среднего бойца ===');
  displayPart();
  await benchPart();
  await livePart();
}
