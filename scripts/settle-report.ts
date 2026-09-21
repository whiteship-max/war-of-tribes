// Отчёт о расселении живых игроков: куда сервер сажает замок и сколько до
// соседа идти.
//
//   npm run settle:report
//   PLAYERS=2,5,20,50 npm run settle:report
//   RUNS=8 npm run settle:report
//
// Правило расселения — `world/settle.ts`, числа — `SETTLE_GAP` и `SETTLE_REACH`
// в `data/tuning.ts`. Меняешь их — смотри сюда, а не на глаз: «в досягаемости»
// меряется не клетками, а минутами похода, и минуты зависят от того, через что
// этот поход идёт.
//
// Что здесь проверяется словами, а не только глазами:
//   — каждый замок стоит на материке и на том же куске суши, что и соседи;
//   — до ближайшего соседа войско доходит за разумное время;
//   — никто не садится вплотную и никто не остаётся один на острове.
import { placeCastle, settleRandom, type Spot } from '../src/world/settle';
import { landmasses } from '../src/world/land';
import { distance, terrainFactor, travelTime } from '../src/world/geo';
import { terrainAt } from '../src/world/geography';
import { KM_PER_CELL } from '../src/world/atlas/project';
import { MAINLAND_MIN, SETTLE_GAP, SETTLE_REACH } from '../src/world/data/tuning';
import { TERRAIN_META } from '../src/world/data/terrain';
import { UNIT_BY_ID } from '../src/world/data/units';
import { asGame, dayRealSeconds, realSeconds, type GameSec } from '../src/game/pace';

const counts = (process.env.PLAYERS ?? '2,5,20,50').split(',').map((s) => Number(s.trim()));
const runs = Number(process.env.RUNS ?? '6');

const rpad = (s: string, n: number): string => ' '.repeat(Math.max(0, n - s.length)) + s;
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - s.length));

/**
 * «2 ч 05 м» или «7 м 30 с» — так же, как время читается в интерфейсе.
 *
 * Время пути — игровое (`geo.travelTime`, решение владельца, docs/time.md, раздел 19), а
 * ждёт его игрок своими часами: срок идёт через дверь.
 */
function span(gameSec: GameSec): string {
  const s = Math.round(realSeconds(gameSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} м`;
  return `${m} м ${String(s % 60).padStart(2, '0')} с`;
}

const WARRIOR = UNIT_BY_ID.warrior.speed;
const SCOUT = UNIT_BY_ID.scout.speed;

const median = (xs: number[]): number => {
  const a = [...xs].sort((p, q) => p - q);
  return a.length === 0 ? 0 : a[Math.floor(a.length / 2)];
};

interface Pair {
  from: Spot;
  to: Spot;
  cells: number;
  factor: number;
  warrior: GameSec;
  scout: GameSec;
}

/** Один мир: сажаем `n` игроков подряд, как это делал бы сервер. */
function settleRun(n: number, run: number): { spots: Spot[]; pairs: Pair[] } {
  const spots: Spot[] = [];
  for (let i = 0; i < n; i++) {
    // Ключ — то же, чем он будет у сервера: постоянный признак игрока. Прогон
    // входит в ключ, чтобы шесть миров подряд не оказались одним и тем же.
    spots.push(placeCastle(settleRandom(`run${run}:player${i}`), spots));
  }
  const pairs: Pair[] = [];
  for (const s of spots) {
    let best: Spot | null = null;
    let bestD = Infinity;
    for (const o of spots) {
      if (o === s) continue;
      const d = distance(s, o);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) continue;
    const f = terrainFactor(0, s, best);
    pairs.push({
      from: s,
      to: best,
      cells: bestD,
      factor: f,
      warrior: travelTime(bestD, f, WARRIOR),
      scout: travelTime(bestD, f, SCOUT),
    });
  }
  return { spots, pairs };
}

console.log('=== расселение живых игроков ===');
console.log(
  `правило: не ближе ${SETTLE_GAP} клеток (${(SETTLE_GAP * KM_PER_CELL).toFixed(0)} км) ни к одному замку,` +
    ` не дальше ${SETTLE_REACH} (${(SETTLE_REACH * KM_PER_CELL).toFixed(0)} км) от ближайшего,` +
    ` и на том же куске суши`,
);
console.log(
  `мерка: ${runs} миров на каждое число игроков; войско ${WARRIOR} кл, разведчик ${SCOUT} кл за игровой день ` +
    `(${dayRealSeconds()} с настоящего времени); сроки — настоящие`,
);

const land = landmasses();
const biggest = Math.max(...land.sizes);

console.log('');
console.log(
  `  ${pad('игроков', 8)}${rpad('до соседа, кл', 15)}${rpad('км', 7)}${rpad('×', 7)}` +
    `${rpad('войско', 12)}${rpad('разведчик', 12)}${rpad('на материке', 13)}${rpad('один кусок', 12)}`,
);
for (const n of counts) {
  const all: Pair[] = [];
  let onMainland = 0;
  let total = 0;
  let oneLand = 0;
  let worldsChecked = 0;
  for (let r = 0; r < runs; r++) {
    const { spots, pairs } = settleRun(n, r);
    all.push(...pairs);
    for (const s of spots) {
      total++;
      const id = land.at(s.x, s.y);
      if (id >= 0 && land.sizeOf(id) >= MAINLAND_MIN) onMainland++;
    }
    const ids = new Set(spots.map((s) => land.at(s.x, s.y)));
    if (ids.size === 1) oneLand++;
    worldsChecked++;
  }
  const cells = median(all.map((p) => p.cells));
  const factor = median(all.map((p) => p.factor));
  const warrior = asGame(median(all.map((p) => p.warrior)));
  const scout = asGame(median(all.map((p) => p.scout)));
  console.log(
    `  ${pad(String(n), 8)}${rpad(cells.toFixed(1), 15)}${rpad((cells * KM_PER_CELL).toFixed(0), 7)}` +
      `${rpad(factor.toFixed(2), 7)}${rpad(span(warrior), 12)}${rpad(span(scout), 12)}` +
      `${rpad(`${onMainland}/${total}`, 13)}${rpad(`${oneLand}/${worldsChecked}`, 12)}`,
  );
}

console.log('');
console.log('  «до соседа» — до ближайшего, медиана по всем игрокам всех прогонов.');
console.log('  «один кусок» — в скольких мирах все замки оказались на одной суше.');

// ---------- Худший случай ----------
//
// Медиана говорит, как обычно; решает же самый неудачливый игрок. Он и есть
// мерка «дойти можно за разумное время».

console.log('\n=== кому идти дольше всех ===');
console.log(
  `  ${pad('игроков', 10)}${rpad('9 из 10 короче', 16)}${rpad('самый дальний', 15)}${rpad('кл', 7)}${rpad('×', 7)}  что между`,
);
for (const n of counts) {
  const all: Pair[] = [];
  for (let r = 0; r < runs; r++) all.push(...settleRun(n, r).pairs);
  if (all.length === 0) continue;
  const sorted = [...all].sort((a, b) => a.warrior - b.warrior);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  const worst = sorted[sorted.length - 1];
  const mid = { x: Math.round((worst.from.x + worst.to.x) / 2), y: Math.round((worst.from.y + worst.to.y) / 2) };
  console.log(
    `  ${pad(String(n), 10)}${rpad(span(p90.warrior), 16)}${rpad(span(worst.warrior), 15)}` +
      `${rpad(worst.cells.toFixed(1), 7)}${rpad(worst.factor.toFixed(2), 7)}` +
      `  ${TERRAIN_META[terrainAt(0, mid.x, mid.y)].name.toLowerCase()}`,
  );
}
console.log('');
console.log('  Время — войска, самого медленного отряда. Правило обещает землю и расстояние,');
console.log('  а не ровную дорогу: сосед за хребтом остаётся соседом за хребтом, и час пути');
console.log('  до него — не сбой расселения, а география.');

// ---------- Что за земля под замками ----------

console.log('\n=== что под замком ===');
const kinds = new Map<string, number>();
let sample = 0;
for (let r = 0; r < runs; r++) {
  for (const s of settleRun(20, r).spots) {
    const t = TERRAIN_META[terrainAt(0, s.x, s.y)].name;
    kinds.set(t, (kinds.get(t) ?? 0) + 1);
    sample++;
  }
}
for (const [name, count] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(name, 12)}${rpad(String(count), 5)} ${rpad(`${((count / sample) * 100).toFixed(0)}%`, 6)}`);
}
console.log(`\n  материк — ${biggest} клеток, порог «это материк» — ${MAINLAND_MIN}.`);
console.log('');
