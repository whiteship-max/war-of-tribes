// Отчёт о географии мира: сколько на карте рек, где переходы, куда легли тракты
// и во что обходится вода. Печатается по нескольким сидам, потому что один сид
// ничего не доказывает: карта детерминирована, но не одинакова.
//
//   npm run world:report            — три сида по умолчанию
//   SEEDS=1,2,3 npm run world:report
//
// Меняешь число в разделе «География» в `data/tuning.ts` — смотри сюда, а не на глаз.
import { FEATURE, cellCost, dropGeography, featuresAt, landmasses, roadNet, terrainAt, tribeCenters } from '../src/world/geography';
import { generateWorld } from '../src/world/gen';
import { distance, terrainFactor, travelSeconds } from '../src/world/geo';
import { AI_RANGE, PATH_SAMPLES_PER_CELL, WORLD_ORIGIN, WORLD_SIZE } from '../src/world/data/tuning';
import { TERRAIN_META } from '../src/world/data/terrain';
import type { Coord } from '../src/world/types';
import type { GenSettlement } from '../src/world/gen';

const seeds = (process.env.SEEDS ?? '7,101,4242').split(',').map((s) => Number(s.trim()));
const units = { warrior: 5 } as const;

const pct = (n: number, total: number): string => `${((n / total) * 100).toFixed(1)}%`;
const at = (c: Coord): string => `${c.x}|${c.y}`;

const inside = (c: Coord): boolean =>
  c.x >= WORLD_ORIGIN.x &&
  c.y >= WORLD_ORIGIN.y &&
  c.x < WORLD_ORIGIN.x + WORLD_SIZE &&
  c.y < WORLD_ORIGIN.y + WORLD_SIZE;

/** Клетка суши без реки и хребта — с такой начинают и такой кончают путь. */
const clear = (seed: number, c: Coord): boolean =>
  inside(c) && (featuresAt(seed, c.x, c.y) & (FEATURE.river | FEATURE.ridge)) === 0 && terrainAt(seed, c.x, c.y) !== 'water';

/**
 * Сколько раз путь лезет в воду вброд — считая по тем же точкам, что и время.
 * Число нужно ради честности примера: «через мост быстрее» имеет смысл только
 * тогда, когда прямой путь реку действительно переходит, а обход — нет.
 */
function swims(seed: number, a: Coord, b: Coord): number {
  const dist = distance(a, b);
  const samples = Math.max(3, Math.round(dist * PATH_SAMPLES_PER_CELL));
  let n = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    const f = featuresAt(seed, x, y);
    if (f & FEATURE.river && !(f & (FEATURE.bridge | FEATURE.ford))) n++;
  }
  return n;
}

const DIRS: Coord[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
];

/**
 * Пример «мост против вплавь». Берётся мост рядом с домом, вдоль русла от него
 * отходят на несколько клеток и ставят две точки по разным берегам: прямая между
 * ними реку переходит вброд, а крюк через мост — нет. Это ровно тот выбор,
 * который игрок делает пальцем на карте, а не отвлечённое сравнение множителей.
 */
function bridgeExample(seed: number, home: Coord): string[] {
  const bridges: Coord[] = [];
  for (let y = home.y - 40; y <= home.y + 40; y++) {
    for (let x = home.x - 40; x <= home.x + 40; x++) {
      if (!inside({ x, y })) continue;
      if (featuresAt(seed, x, y) & FEATURE.bridge) bridges.push({ x, y });
    }
  }
  if (bridges.length === 0) return ['  моста рядом с домом не нашлось'];
  // Ближние мосты первыми: пример должен быть про ту переправу, к которой игрок
  // и пойдёт, а не про случайную на краю карты.
  bridges.sort((a, b) => distance(home, a) - distance(home, b));

  for (const bridge of bridges) {
    const found = crossingPair(seed, bridge);
    if (found) return found;
  }
  return ['  подходящего русла в стороне от моста не нашлось'];
}

/** Пара берегов у одного моста: прямая между ними реку переходит, а обход — нет. */
function crossingPair(seed: number, bridge: Coord): string[] | null {
  for (let away = 5; away <= 12; away++) {
    for (const t of DIRS) {
      for (const sign of [1, -1]) {
        // Точка русла в стороне от моста: переправы здесь нет.
        const r = { x: bridge.x + t.x * away * sign, y: bridge.y + t.y * away * sign };
        if (!inside(r)) continue;
        const rf = featuresAt(seed, r.x, r.y);
        if (!(rf & FEATURE.river) || rf & (FEATURE.bridge | FEATURE.ford)) continue;
        for (const n of DIRS) {
          for (const gap of [3, 4, 5]) {
            const a = { x: r.x - n.x * gap, y: r.y - n.y * gap };
            const b = { x: r.x + n.x * gap, y: r.y + n.y * gap };
            if (!clear(seed, a) || !clear(seed, b)) continue;
            // Прямая обязана лезть в воду, а обход — не обязан: иначе сравнивать нечего.
            if (swims(seed, a, b) === 0) continue;
            if (swims(seed, a, bridge) > 0 || swims(seed, bridge, b) > 0) continue;
            const direct = travelSeconds(seed, a, b, units);
            const viaBridge = travelSeconds(seed, a, bridge, units) + travelSeconds(seed, bridge, b, units);
            const way = distance(a, bridge) + distance(bridge, b);
            return [
              `  вплавь ${at(a)} → ${at(b)}: ${distance(a, b).toFixed(1)} кл напрямик, ${direct.toFixed(0)} с`,
              `  через мост ${at(bridge)}: ${way.toFixed(1)} кл в обход, ${viaBridge.toFixed(0)} с`,
              `  дорога длиннее в ${(way / distance(a, b)).toFixed(2)} раза, а времени отнимает в ${(direct / viaBridge).toFixed(2)} раза меньше`,
            ];
          }
        }
      }
    }
  }
  return null;
}

/**
 * Вода: сколько на карте материков, где стоит дом и не отрезано ли водой хоть
 * одно поселение.
 *
 * Отвечает на единственный вопрос, ради которого вода вообще дорога: остаётся ли
 * она трудностью, а не стеной. Островные поселения — желанная цель; недопустим
 * один случай — дом игрока, до соседей которого не дойти посуху.
 */
function waterReport(seed: number, home: Coord, settlements: GenSettlement[]): string[] {
  const land = landmasses(seed);
  const biggest = land.sizes.indexOf(Math.max(...land.sizes));
  const homeMass = land.at(home.x, home.y);
  const off = settlements.filter((s) => land.at(s.x, s.y) !== homeMass);
  const byLand = settlements.filter((s) => land.at(s.x, s.y) === homeMass && distance(home, s) <= 25);

  // Ширина протоки: от островного поселения до ближайшей клетки материка дома.
  const strait = (s: Coord): number => {
    for (let r = 1; r <= 80; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (land.at(s.x + dx, s.y + dy) === homeMass) return Math.hypot(dx, dy);
        }
      }
    }
    return Infinity;
  };

  // Ближние цели: те, до которых игрок и ходит. По ним и видно, стала ли вода
  // стеной — если бы стала, множитель прямой упёрся бы в её собственную цену.
  const near = settlements.filter((s) => distance(home, s) <= AI_RANGE);
  const factors = near.map((s) => ({ s, f: terrainFactor(seed, home, s) })).sort((a, b) => b.f - a.f);
  const swimming = near.filter((s) => waterShare(seed, home, s) > 0.5).length;
  const worst = factors[0];

  const out = [
    `  материков ${land.sizes.length}, дом на ${homeMass === biggest ? 'главном' : 'НЕ главном'} (${land.sizeOf(homeMass)} кл)`,
    `  соседей по суше в 25 клетках: ${byLand.length}; поселений вне материка дома: ${off.length}`,
  ];
  if (off.length > 0) {
    out.push(
      `  острова: ` +
        off
          .map((s) => `${at(s)} (клочок ${land.sizeOf(land.at(s.x, s.y))} кл, протока ${strait(s).toFixed(1)} кл)`)
          .join(', '),
    );
  }
  out.push(`  целей ближе ${AI_RANGE} кл: ${near.length}, из них прямая больше чем наполовину по воде: ${swimming}`);
  if (worst) {
    out.push(
      `  худшая ближняя прямая: ${at(worst.s)} ×${worst.f.toFixed(2)} на ${distance(home, worst.s).toFixed(1)} кл` +
        ` (вода ${(waterShare(seed, home, worst.s) * 100).toFixed(0)}%, река ${(riverShare(seed, home, worst.s) * 100).toFixed(0)}%,` +
        ` сама вода стоит ×${TERRAIN_META.water.cost})`,
    );
  }
  return out;
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

const waterShare = (seed: number, a: Coord, b: Coord): number => shares(seed, a, b).water;
const riverShare = (seed: number, a: Coord, b: Coord): number => shares(seed, a, b).river;

/**
 * Пример «тракт против целины»: сколько прямая между станами идёт по дороге и
 * во что обходится тот же путь, если бы дороги не было вовсе.
 */
function roadExample(seed: number): string[] {
  const net = roadNet(seed);
  if (net.edges.length === 0) return ['  трактов в этом мире не проложено'];
  const [a, b] = net.edges[0];
  const dist = distance(a, b);
  const samples = Math.max(3, Math.round(dist * PATH_SAMPLES_PER_CELL));
  let onRoad = 0;
  let wild = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    if (featuresAt(seed, x, y) & FEATURE.road) onRoad++;
    else wild += cellCost(seed, x, y);
  }
  const seconds = travelSeconds(seed, a, b, units);
  const wildFactor = wild / Math.max(1, samples - onRoad);
  return [
    `  стан ${at(a)} → стан ${at(b)}: ${dist.toFixed(1)} кл, ${seconds.toFixed(0)} с, множитель пути ×${terrainFactor(seed, a, b).toFixed(2)}`,
    `  прямая идёт по тракту на ${((onRoad / samples) * 100).toFixed(0)}% длины; целина на остатке — ×${wildFactor.toFixed(2)}`,
  ];
}

for (const seed of seeds) {
  dropGeography();
  const world = generateWorld(seed);
  let river = 0;
  let bridges = 0;
  let fords = 0;
  let ridge = 0;
  let passes = 0;
  let roads = 0;
  let water = 0;
  const total = WORLD_SIZE * WORLD_SIZE;
  for (let y = WORLD_ORIGIN.y; y < WORLD_ORIGIN.y + WORLD_SIZE; y++) {
    for (let x = WORLD_ORIGIN.x; x < WORLD_ORIGIN.x + WORLD_SIZE; x++) {
      const f = featuresAt(seed, x, y);
      if (f & FEATURE.river) river++;
      if (f & FEATURE.bridge) bridges++;
      if (f & FEATURE.ford) fords++;
      if (f & FEATURE.ridge) ridge++;
      if (f & FEATURE.pass) passes++;
      if (f & FEATURE.road) roads++;
      if (terrainAt(seed, x, y) === 'water') water++;
    }
  }
  const net = roadNet(seed);
  const homeCost = cellCost(seed, world.home.x, world.home.y);
  console.log(`\n=== сид ${seed} ===`);
  console.log(`дом ${at(world.home)} (клетка ×${homeCost}), станов ${tribeCenters(seed).length}, поселений ${world.settlements.length}`);
  console.log(`реки ${river} кл (${pct(river, total)}), клеток моста ${bridges}, брода ${fords}`);
  console.log(`хребты ${ridge} кл (${pct(ridge, total)}), перевалы ${passes}`);
  console.log(`тракты ${roads} кл, отрезков ${net.edges.length}`);
  console.log(`вода ${water} кл (${pct(water, total)})`);
  console.log('вода и острова:');
  for (const line of waterReport(seed, world.home, world.settlements)) console.log(line);
  console.log('мост против вплавь:');
  for (const line of bridgeExample(seed, world.home)) console.log(line);
  console.log('тракт:');
  for (const line of roadExample(seed)) console.log(line);
}
