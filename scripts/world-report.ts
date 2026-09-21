// Отчёт о географии мира: что за земля лежит на карте, сколько в клетке
// километров и сколько идти от Парижа до Лондона.
//
//   npm run world:report            — три сида по умолчанию
//   SEEDS=1,2,3 npm run world:report
//
// Земля теперь одна на всех (атлас из Natural Earth), поэтому первые разделы
// печатаются один раз и по сидам не разводятся. Сид решает только, где встал
// замок игрока и куда легли логова, — это последний раздел.
//
// Меняешь масштаб, скорости или числа в разделе «География» в `data/tuning.ts` —
// смотри сюда, а не на глаз.
import { FEATURE, dropGeography, featuresAt, landmasses, terrainAt } from '../src/world/geography';
import { generateWorld } from '../src/world/gen';
import { distance, terrainFactor, travelTime } from '../src/world/geo';
import { DAY_LENGTH, asGame, dayRealSeconds, gameDaysOfMs, realSeconds, type GameSec } from '../src/game/pace';
import { DEED_GAP } from '../src/game/data/agents';
import {
  AI_RANGE,
  FIGURE_DOWN,
  HANDOVER_BASE,
  HANDOVER_MAX,
  HOME_SIGHT,
  ORDER_BUSY_GIFT,
  ORDER_BUSY_INSULT,
  ORDER_BUSY_PACT,
  ORDER_BUSY_WAR,
  PATH_SAMPLES_PER_CELL,
  PERIL_MEMORY,
  SPY_BUSY,
  SPY_HELD,
  WORLD_ORIGIN,
  WORLD_SIZE,
} from '../src/world/data/tuning';
import { TERRAIN_META, TERRAIN_ORDER } from '../src/world/data/terrain';
import { FIGURES } from '../src/world/data/figures';
import { KM_PER_CELL, cellOf, kmAt, lonLatOf } from '../src/world/atlas/project';
import type { Coord } from '../src/world/types';

const seeds = (process.env.SEEDS ?? '7,101,4242').split(',').map((s) => Number(s.trim()));
const units = { warrior: 5 } as const;

const pct = (n: number, total: number): string => `${((n / total) * 100).toFixed(1)}%`;
const at = (c: Coord): string => `${c.x}|${c.y}`;
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - s.length));
const rpad = (s: string, n: number): string => ' '.repeat(Math.max(0, n - s.length)) + s;

/** Настоящие места. Городов в игре нет — здесь они только мерка расстояний. */
const PLACES: Record<string, [number, number]> = {
  Лиссабон: [-9.14, 38.72],
  Кордова: [-4.78, 37.89],
  Танжер: [-5.8, 35.79],
  Тунис: [10.18, 36.8],
  Марсель: [5.37, 43.3],
  Рим: [12.5, 41.9],
  Париж: [2.35, 48.86],
  Лондон: [-0.12, 51.51],
  Дублин: [-6.26, 53.35],
  Кёльн: [6.96, 50.94],
  Гамбург: [10.0, 53.55],
  Вена: [16.37, 48.21],
  Краков: [19.94, 50.06],
  Царьград: [28.98, 41.01],
  Киев: [30.52, 50.45],
  Новгород: [31.27, 58.52],
  Осло: [10.75, 59.91],
  Стокгольм: [18.07, 59.33],
  Трапезунд: [39.72, 41.0],
  Каир: [31.24, 30.04],
};

const cellAt = (name: string): Coord => {
  const [lon, lat] = PLACES[name];
  const c = cellOf(lon, lat);
  return { x: WORLD_ORIGIN.x + Math.round(c.col), y: WORLD_ORIGIN.y + Math.round(c.row) };
};

/**
 * «2 ч 05 м» или «7 м 30 с» — так же, как время читается в интерфейсе.
 *
 * Время пути — игровое (`geo.travelTime`, решение владельца, docs/time.md, раздел 19), а
 * ждёт его игрок своими часами: срок идёт через дверь. Печатать игровые секунды как
 * настоящие значило бы называть один срок тридцатью разными числами.
 */
function span(gameSec: GameSec): string {
  const s = Math.round(realSeconds(gameSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} м`;
  return `${m} м ${String(s % 60).padStart(2, '0')} с`;
}

/** Доля замеров прямой, попавших в воду и в русло без переправы. */
function shares(seed: number, a: Coord, b: Coord): { water: number; river: number } {
  const dist = distance(a, b);
  const samples = Math.max(3, Math.round(dist * PATH_SAMPLES_PER_CELL));
  let water = 0;
  let river = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    const f = featuresAt(seed, x, y);
    if (f & FEATURE.river && !(f & (FEATURE.bridge | FEATURE.ford | FEATURE.road))) river++;
    else if (terrainAt(seed, x, y) === 'water') water++;
  }
  return { water: water / samples, river: river / samples };
}

const SEED = seeds[0];
dropGeography();

// ---------- 1. Земля ----------

const total = WORLD_SIZE * WORLD_SIZE;
const tally = new Map<string, number>();
let river = 0;
let bridges = 0;
let fords = 0;
let ridge = 0;
let passes = 0;
let roads = 0;
for (let y = WORLD_ORIGIN.y; y < WORLD_ORIGIN.y + WORLD_SIZE; y++) {
  for (let x = WORLD_ORIGIN.x; x < WORLD_ORIGIN.x + WORLD_SIZE; x++) {
    const t = terrainAt(SEED, x, y);
    tally.set(t, (tally.get(t) ?? 0) + 1);
    const f = featuresAt(SEED, x, y);
    if (f & FEATURE.river) river++;
    if (f & FEATURE.bridge) bridges++;
    if (f & FEATURE.ford) fords++;
    if (f & FEATURE.ridge) ridge++;
    if (f & FEATURE.pass) passes++;
    if (f & FEATURE.road) roads++;
  }
}
const nw = lonLatOf(0, 0);
const se = lonLatOf(WORLD_SIZE - 1, WORLD_SIZE - 1);
const land = landmasses(SEED);
const biggest = Math.max(...land.sizes);
const km2 = (cells: number): string => `${Math.round((cells * KM_PER_CELL * KM_PER_CELL) / 1000)} тыс. кв. км`;

console.log('\n=== земля ===');
console.log(`сетка ${WORLD_SIZE}×${WORLD_SIZE}, ${KM_PER_CELL.toFixed(2)} км в клетке; рамка ${(WORLD_SIZE * KM_PER_CELL).toFixed(0)} км в стороне`);
console.log(
  `углы рамки: ${nw.lat.toFixed(1)}°с.ш. ${nw.lon.toFixed(1)}°в.д. — ${se.lat.toFixed(1)}°с.ш. ${se.lon.toFixed(1)}°в.д.`,
);
const kms: number[] = [];
for (let lat = 26; lat <= 70; lat += 1) kms.push(kmAt(lat));
console.log(
  `клетка на широтах 26…70: ${Math.min(...kms).toFixed(2)}…${Math.max(...kms).toFixed(2)} км ` +
    `(коническая равноугольная Ламберта; у Меркатора разброс был бы полуторным)`,
);
console.log(
  `ландшафт: ` +
    TERRAIN_ORDER.map((t) => `${TERRAIN_META[t].name.toLowerCase()} ${pct(tally.get(t) ?? 0, total)}`).join(', '),
);
const dry = total - (tally.get('water') ?? 0);
console.log(`реки ${river} кл (${pct(river, dry)} суши), клеток моста ${bridges}, брода ${fords}`);
console.log(`хребты ${ridge} кл (${pct(ridge, dry)} суши), перевалы ${passes}`);
console.log(
  roads > 0
    ? `тракты ${roads} кл`
    : `трактов нет: они соединяли станы племён, а станов на общей карте не осталось`,
);
console.log(`кусков суши ${land.sizes.length}, материк ${biggest} кл (${km2(biggest)})`);
console.log(
  `следом: ` +
    [...land.sizes]
      .sort((a, b) => b - a)
      .slice(1, 5)
      .map((s) => `${s} кл (${km2(s)})`)
      .join(', '),
);

// ---------- 2. Масштаб: сколько идти ----------

const PAIRS: [string, string][] = [
  ['Кордова', 'Танжер'],
  ['Париж', 'Лондон'],
  ['Париж', 'Кёльн'],
  ['Вена', 'Краков'],
  ['Кёльн', 'Гамбург'],
  ['Париж', 'Марсель'],
  ['Париж', 'Рим'],
  ['Рим', 'Царьград'],
  ['Танжер', 'Тунис'],
  ['Кордова', 'Киев'],
  ['Лиссабон', 'Киев'],
  ['Осло', 'Царьград'],
  ['Лиссабон', 'Новгород'],
];

console.log('\n=== масштаб: сколько идти ===');
console.log(
  pad('пара', 24) +
    rpad('км', 6) +
    rpad('клеток', 8) +
    rpad('×местн', 8) +
    FIGURES.map((f) => rpad(f.name, 13)).join(''),
);
for (const [a, b] of PAIRS) {
  const ca = cellAt(a);
  const cb = cellAt(b);
  const d = distance(ca, cb);
  const f = terrainFactor(SEED, ca, cb);
  console.log(
    pad(`${a}→${b}`, 24) +
      rpad((d * KM_PER_CELL).toFixed(0), 6) +
      rpad(d.toFixed(0), 8) +
      rpad(f.toFixed(2), 8) +
      FIGURES.map((fig) => rpad(span(travelTime(d, f, fig.speed)), 13)).join(''),
  );
}
console.log('');
console.log('насквозь по чистой равнине (×1):');
for (const f of FIGURES) {
  console.log(
    `  ${pad(f.name, 14)} поперёк ${span(travelTime(WORLD_SIZE, 1, f.speed))}` +
      `   по диагонали ${span(travelTime(WORLD_SIZE * Math.SQRT2, 1, f.speed))}`,
  );
}
console.log('');
console.log(`за игровой день (${dayRealSeconds()} с настоящего времени) проходят:`);
for (const f of FIGURES) console.log(`  ${pad(f.name, 14)} ${(f.speed * KM_PER_CELL).toFixed(0)} км`);
console.log('  (настоящее войско позднего средневековья шло 20–30 км в день)');

// ---------- 3. Мост против вплавь ----------

console.log('\n=== мост против вплавь ===');
/**
 * Лучший пример «мост против вплавь», а не первый попавшийся. Первый попавшийся
 * на настоящей карте оказывается на притоке в норвежских горах и даёт разницу в
 * тринадцать процентов — по такому примеру о правиле не судят.
 */
let best: { gain: number; lines: string[] } | null = null;
for (let y = WORLD_ORIGIN.y + 200; y < WORLD_ORIGIN.y + 520; y += 1) {
  for (let x = WORLD_ORIGIN.x + 260; x < WORLD_ORIGIN.x + 620; x += 1) {
    if (!(featuresAt(SEED, x, y) & FEATURE.bridge)) continue;
    const bridge = { x, y };
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ] as [number, number][]) {
      for (const away of [5, 6, 7, 8]) {
        const r = { x: x + dx * away, y: y + dy * away };
        const f = featuresAt(SEED, r.x, r.y);
        if (!(f & FEATURE.river) || f & (FEATURE.bridge | FEATURE.ford)) continue;
        for (const [nx, ny] of [
          [1, 0],
          [0, 1],
          [1, 1],
          [1, -1],
        ] as [number, number][]) {
          const a = { x: r.x - nx * 4, y: r.y - ny * 4 };
          const b = { x: r.x + nx * 4, y: r.y + ny * 4 };
          if (terrainAt(SEED, a.x, a.y) === 'water' || terrainAt(SEED, b.x, b.y) === 'water') continue;
          if (shares(SEED, a, b).river === 0) continue;
          const direct = travelTime(distance(a, b), terrainFactor(SEED, a, b), units.warrior);
          const via = asGame(
            travelTime(distance(a, bridge), terrainFactor(SEED, a, bridge), units.warrior) +
              travelTime(distance(bridge, b), terrainFactor(SEED, bridge, b), units.warrior),
          );
          const gain = direct / via;
          if (gain <= 1 || (best && best.gain >= gain)) continue;
          const ll = lonLatOf(a.x - WORLD_ORIGIN.x, a.y - WORLD_ORIGIN.y);
          best = {
            gain,
            lines: [
              `  вплавь ${at(a)} → ${at(b)}: ${distance(a, b).toFixed(1)} кл, ${span(direct)}`,
              `  через мост ${at(bridge)}: ${(distance(a, bridge) + distance(bridge, b)).toFixed(1)} кл в обход, ${span(via)}`,
              `  крюк длиннее в ${((distance(a, bridge) + distance(bridge, b)) / distance(a, b)).toFixed(2)} раза,` +
                ` а времени отнимает в ${gain.toFixed(2)} раза меньше`,
              `  место: ${ll.lat.toFixed(1)}°с.ш. ${ll.lon.toFixed(1)}°в.д.`,
            ],
          };
        }
      }
    }
  }
}
for (const line of best ? best.lines : ['  подходящей пары берегов не нашлось']) console.log(line);

// ---------- 4. Первый день игрока ----------

console.log('\n=== первый день: где встал замок и что вокруг ===');
const sightCells = Math.round(Math.PI * HOME_SIGHT * HOME_SIGHT);
console.log(
  `круг обзора деревни — ${HOME_SIGHT} клеток, это ${(HOME_SIGHT * KM_PER_CELL).toFixed(0)} км радиусом,` +
    ` ${sightCells} клеток (${pct(sightCells, total)} карты, ${km2(sightCells)})`,
);
for (const seed of seeds) {
  dropGeography();
  const world = generateWorld(seed);
  const home = world.home;
  const ll = lonLatOf(home.x - WORLD_ORIGIN.x, home.y - WORLD_ORIGIN.y);
  const nearest = Object.keys(PLACES)
    .map((n) => ({ n, d: distance(home, cellAt(n)) }))
    .sort((a, b) => a.d - b.d)[0];
  const lairs = world.settlements
    .map((s) => ({ s, d: distance(home, s) }))
    .sort((a, b) => a.d - b.d);
  const inSight = lairs.filter((l) => l.d <= HOME_SIGHT);
  const near = lairs.filter((l) => l.d <= AI_RANGE);
  console.log(`\n  сид ${seed}: замок ${at(home)} — ${ll.lat.toFixed(1)}°с.ш. ${ll.lon.toFixed(1)}°в.д.`);
  console.log(
    `    ближе всего к: ${nearest.n} (${(nearest.d * KM_PER_CELL).toFixed(0)} км), земля вокруг — ${TERRAIN_META[terrainAt(seed, home.x, home.y)].name.toLowerCase()}`,
  );
  console.log(`    логов на карте ${world.settlements.length}; в круге обзора ${inSight.length}, в ${AI_RANGE} клетках ${near.length}`);
  if (lairs[0]) {
    const f = terrainFactor(seed, home, lairs[0].s);
    console.log(
      `    ближайшее ${at(lairs[0].s)}: ${lairs[0].d.toFixed(1)} кл (${(lairs[0].d * KM_PER_CELL).toFixed(0)} км), ×${f.toFixed(2)},` +
        ` войско идёт ${span(travelTime(lairs[0].d, f, units.warrior))}, разведчик ${span(travelTime(lairs[0].d, f, 9))}`,
    );
  }
  const mass = land.at(home.x, home.y);
  console.log(`    земля под замком: кусок ${land.sizeOf(mass)} кл — ${mass === land.sizes.indexOf(biggest) ? 'материк' : 'НЕ материк'}`);
}
console.log('');

// --------------------------------------------- сроки мира против плеча пути ---
//
// Срок, который мир накладывает на игрока — фигура вне строя, лазутчик задержан, дипломат
// занят, дружина собирается, — значит ровно столько, сколько он весит **против дороги**. Пока
// дорога шла настоящими минутами, а сроки — тоже настоящими, весы сходились сами. После того,
// как время пути пошло игровым (docs/time.md, раздел 19), сроки, оставшиеся настоящими,
// обесценились втридцатеро: наказание за провал стало короче, чем дойти до цели.
//
// Раздел печатает обе стороны из одного числа: срок в игровых днях — и его долю плеча пути, и
// долю, которая вышла бы, если то же число прочесть настоящими минутами (так и было до правки).
console.log('=== СРОКИ МИРА ПРОТИВ ПЛЕЧА ПУТИ ===');
console.log('Плечо — половина круга похода к ближайшему логову, медиана по сидам ниже: столько идти в одну сторону.');
console.log('«как настоящие» — доля, которая вышла бы, если то же число читать настоящими минутами: так эти сроки и стояли до 22.09.2026.');
console.log('');
{
  const legs: number[] = [];
  for (const seed of seeds) {
    dropGeography();
    const w = generateWorld(seed);
    const near = w.settlements.map((s) => ({ s, d: distance(w.home, s) })).sort((a, b) => a.d - b.d)[0];
    if (!near) continue;
    legs.push(travelTime(near.d, terrainFactor(seed, w.home, near.s), units.warrior));
  }
  legs.sort((a, b) => a - b);
  const leg = legs.length > 0 ? legs[Math.floor(legs.length / 2)] : 0;
  console.log(`  Плечо пути: ${leg.toFixed(0)} игровых секунд — ${span(asGame(leg))}.`);
  console.log('');
  console.log('  срок                    игр. дн.   настоящее время   доля плеча   как настоящие');
  const rows: [string, number][] = [
    ['фигура вне строя', FIGURE_DOWN],
    ['лазутчик задержан', SPY_HELD],
    ['лазутчик занят', SPY_BUSY],
    ['дипломат: пакт', ORDER_BUSY_PACT],
    ['дипломат: дар', ORDER_BUSY_GIFT],
    ['дипломат: война', ORDER_BUSY_WAR],
    ['дипломат: обида', ORDER_BUSY_INSULT],
    ['сбор дружины, потолок', HANDOVER_MAX],
    ['сбор дружины, основа', HANDOVER_BASE],
    ['срок между делами', DEED_GAP],
    ['память цели о заходах', PERIL_MEMORY],
  ];
  for (const [name, ms] of rows) {
    const days = gameDaysOfMs(ms);
    const sec = days * DAY_LENGTH;
    const asReal = (days * 60) / Math.max(1, realSeconds(leg));
    console.log(
      `  ${name.padEnd(22)}  ${days.toFixed(1).padStart(8)}   ${span(asGame(sec)).padStart(15)}   ` +
        `${`${Math.round((sec / Math.max(1, leg)) * 100)}%`.padStart(10)}   ${`${(asReal * 100).toFixed(1)}%`.padStart(13)}`,
    );
  }
  console.log('');
  console.log('  Все одиннадцать — последствия в мире, а не окна, дающие игроку время прийти и ответить,');
  console.log('  и потому идут временем мира (решение владельца, docs/time.md, раздел 20). Остаются');
  console.log('  настоящими: почта (срок ответа игрока), предупреждение о разрыве пакта (оно даёт увести');
  console.log('  дипломата) и кэш кусков карты — он инструмент, а не мир.');
  console.log('');
}
