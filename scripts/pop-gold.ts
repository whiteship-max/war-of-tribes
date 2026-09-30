// Спор за золото — прогон одного игрока с первой секунды до срока (docs/admin_branch.md, раздел 4.1). Задача веера
// (`lib/fan.ts`): модуль без действий на верхнем уровне, его зовёт `pop-report.ts` — и прямо, и веером по потокам.
//
// Поток случайности — всё, чем партия бросает кость (`sim/random.setRandom`: события, ответы, короткие стычки). В обычном
// прогоне отчёта оба игрока идут на общем потоке — том, что остался после дуги (`stream: null`), и спор — одна партия на
// одной случайности. С потоком `stream` у каждого прогона свой поток с начала (`seeded(stream)`): так прогоны не зависят
// ни от дуги, ни друг от друга, и разброс спора виден числом (`GOLD_STREAMS`, docs/battle_eu4.md, 14.35).
import { createInitialState } from '@/game/state';
import { seeded, setRandom } from '@/game/sim/random';
import { armyPower, armySize, buildRate, mastersCount, upkeepInfo } from '@/game/derived';
import { techLevel } from '@/game/sim/tech';
import { mastersInfo } from '@/game/sim/masters';
import { DAY_LENGTH } from '@/game/constants';
import { troopTotal } from '@/game/battle/kinds';
import { GATE_POP } from '@/game/data/events';
import type { GameState } from '@/game/types';
import { GATE_FOES } from '@/world/data/gate';
import type { GateFoe } from '@/world/types';
import { pilot, player, type Watch } from './autopilot';
import { fan, serveFan } from './lib/fan';

/** Мир партии — тихий, как у дуги `pop:report`: логова набегов на дом не шлют. */
export const GOLD_WORLD = 7;

/** Этот модуль — для веера из других отчётов: задачи спора (`typicalTowns`) он называет сам (`serveFan` в конце). */
export const GOLD_MODULE = import.meta.url;

/** Игрок в минуту срока: войско, посёлок и казна — столбцы таблицы спора. */
export interface GoldRow {
  army: number;
  power: number;
  pop: number;
  avg: number;
  max: number;
  rate: number;
  masters: number;
  admin: number;
  armyWages: number;
  mastersWages: number;
  income: number;
  wage: number;
  inSoldiers: number;
  /** Бои у ворот по вызову (волки, разбойники) за прогон: сколько, сколько проиграно и сколько бойцов пало. */
  gates: Partial<Record<GateFoe, { fights: number; lost: number; fell: number }>>;
}

/**
 * Партия игрока спора — одна на спор и на мерку силы у ворот (`typicalTowns`): `masters` — берёт наёмных мастеров первым,
 * до войска («вложился в админветвь»), иначе — «по умолчанию». Налог высокий, найм «по средствам», учат все ветви; сид
 * партии закреплён (`createInitialState(7)`), мир тихий (`GOLD_WORLD`); `stream` — свой поток случайности с начала.
 */
export async function goldFlight(arg: { masters: boolean; seconds: number; stream: number | null; watch?: Watch; until?: (g: GameState) => boolean }): Promise<GameState> {
  if (arg.stream !== null) setRandom(seeded(arg.stream));
  const g = createInitialState(7);
  g.tutorialDone = true;
  await pilot({
    g,
    seconds: arg.seconds,
    player: player('means', { tax: 'high', masters: arg.masters }),
    world: { seed: GOLD_WORLD, pulse: 30, raids: false },
    economy: 'live',
    tick: 1,
    decide: 30,
    ...(arg.watch ? { watch: arg.watch } : {}),
    ...(arg.until ? { until: arg.until } : {}),
  });
  return g;
}

/**
 * Типичный посёлок уровня L — игрок спора «по умолчанию» (docs/battle_eu4.md, 14.35, «Заход 30.09.2026»; направление
 * владельца): его партия на потоке `stream`, снятая в минуту, когда жители впервые доходят до жителей мерки уровня
 * (`data/events.GATE_POP`). Мерка силы у ворот (`raid-mix:report`, раздел 4б): таблица выводится на гарнизоне, который держит
 * игрок, а не на посёлке мерки (`autopilot.townAt`), у которого войско набрано смесью мерки. Партия идёт с таблицей игры, и
 * бои у ворот в ней настоящие — мерка зависит от самой таблицы, и раздел 4б печатает, сошлась ли она. Не дошёл до уровня к
 * сроку `seconds` — `null`.
 */
export async function typicalTowns(arg: { stream: number; seconds: number }): Promise<Array<GameState | null>> {
  const towns: Array<GameState | null> = GATE_POP.map(() => null);
  let level = 0;
  await goldFlight({
    masters: false,
    seconds: arg.seconds,
    stream: arg.stream,
    watch: {
      after: ({ g }) => {
        for (; level < GATE_POP.length && g.pop >= GATE_POP[level]; level += 1) towns[level] = structuredClone(g);
      },
    },
    until: () => level >= GATE_POP.length,
  });
  return towns;
}

/**
 * Один игрок спора: `masters` — берёт наёмных мастеров первым, до войска («вложился в админветвь»), иначе — «по
 * умолчанию» (`goldFlight`).
 */
export async function goldRun(arg: { masters: boolean; seconds: number; stream: number | null }): Promise<GoldRow> {
  // Бои у ворот — по последствию с отметкой вызова (`HomeEffect.gate`); кто пришёл, говорит вызов в слепке перед пульсом.
  const foes = new Map<string, GateFoe>();
  const gates: GoldRow['gates'] = {};
  const g = await goldFlight({
    ...arg,
    watch: {
      profile: (p) => {
        for (const call of p.gate ?? []) foes.set(call.id, call.foe);
      },
      effect: (e) => {
        const foe = e.gate ? foes.get(e.gate) : undefined;
        if (!foe) return;
        const row = (gates[foe] ??= { fights: 0, lost: 0, fell: 0 });
        row.fights += 1;
        if (e.battle === 'lost') row.lost += 1;
        row.fell += troopTotal(e.lostTroops ?? {});
      },
    },
  });
  const up = upkeepInfo(g);
  const mi = mastersInfo(g);
  return {
    army: armySize(g),
    power: armyPower(g),
    pop: g.pop,
    avg: g.buildings.reduce((n, b) => n + b.level, 0) / g.buildings.length,
    max: g.buildings.reduce((n, b) => Math.max(n, b.level), 0),
    rate: buildRate(g),
    masters: mastersCount(g),
    admin: techLevel(g, 'admin'),
    armyWages: up.armyWages,
    mastersWages: up.mastersWages,
    income: up.income,
    wage: mi.wage,
    inSoldiers: mi.inSoldiers,
    gates,
  };
}

/** Бои у ворот словами: по противнику — сколько, проиграно и пало бойцов. */
const gateWords = (gates: GoldRow['gates']): string =>
  (Object.keys(GATE_FOES) as GateFoe[]).map((f) => `${GATE_FOES[f].name.toLowerCase()} ${gates[f]?.fights ?? 0}/${gates[f]?.lost ?? 0}/${gates[f]?.fell ?? 0}`).join(', ');

/** Медиана: при чётном числе — среднее двух средних. */
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Разброс ряда словами: все значения по возрастанию, медиана и середина половины потоков (медианы нижней и верхней половин). */
function spread(xs: readonly number[]): string {
  const s = [...xs].sort((a, b) => a - b);
  const half = s.length >> 1;
  const lo = median(s.slice(0, half));
  const hi = median(s.slice(s.length - half));
  return `${s.join(' ')}; медиана ${median(s)}, середина половины потоков ${lo}…${hi}, всего ${s[0]}…${s[s.length - 1]}`;
}

/**
 * Спор за золото по потокам: оба игрока — на `streams` потоках случайности, у каждого прогона свой поток с начала
 * (`seeded(1…streams)`), срок — `seconds`. Вопрос раздела — сколько в одной партии спора разброса: игрок «по умолчанию»
 * к сроку — одна точка на общем потоке отчёта, и сдвиг между двумя кодами надо сравнивать с разбросом, а не с точкой.
 * Прогоны независимы и идут веером (`lib/fan.ts`, бюджет железа).
 */
export async function goldStreams(seconds: number, streams: number): Promise<void> {
  console.log(`\nСпор за золото по потокам случайности: ${streams} потоков, срок — день ${(seconds / DAY_LENGTH).toFixed(0)} (GOLD_STREAMS, GOLD_DAY).`);
  console.log('У каждого прогона свой поток с начала — seeded(1…N): события, ответы на них и стычки у стены; мир, сид партии и игроки — как выше.');
  const args = [false, true].flatMap((masters) => Array.from({ length: streams }, (_, i) => ({ masters, seconds, stream: i + 1 })));
  const rows = await fan(goldRun, import.meta.url, args);
  const byPlayer = [rows.slice(0, streams), rows.slice(streams)];
  console.log('  поток | по умолчанию: жители / войско / мощь | вложился: жители / войско / мощь | спор: жители | у ворот «по умолчанию»: боёв/проиграно/пало');
  for (let i = 0; i < streams; i += 1) {
    const [a, b] = [byPlayer[0][i], byPlayer[1][i]];
    console.log(
      `  ${String(i + 1).padStart(5)} | ${`${a.pop} / ${a.army} / ${a.power.toFixed(0)}`.padStart(36)} | ${`${b.pop} / ${b.army} / ${b.power.toFixed(0)}`.padStart(32)} | ${String(b.pop - a.pop).padStart(12)} | ${gateWords(a.gates)}`,
    );
  }
  for (const [label, list] of [
    ['по умолчанию', byPlayer[0]],
    ['вложился в админветвь', byPlayer[1]],
  ] as const) {
    console.log(`  ${label}: жители — ${spread(list.map((r) => r.pop))}`);
    console.log(`  ${label}: войско — ${spread(list.map((r) => r.army))}`);
    const all: GoldRow['gates'] = {};
    for (const r of list) {
      for (const [f, x] of Object.entries(r.gates) as [GateFoe, { fights: number; lost: number; fell: number }][]) {
        const t = (all[f] ??= { fights: 0, lost: 0, fell: 0 });
        t.fights += x.fights;
        t.lost += x.lost;
        t.fell += x.fell;
      }
    }
    console.log(`  ${label}: у ворот за все потоки, боёв/проиграно/пало — ${gateWords(all)}`);
  }
  console.log(`  Спор, жители «вложился» минус «по умолчанию»: ${spread(byPlayer[1].map((b, i) => b.pop - byPlayer[0][i].pop))}`);
}

serveFan(import.meta.url, { goldRun, typicalTowns });
