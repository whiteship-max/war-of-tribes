// Запекание регионов карты (docs/map_tw.md, раздел 13): `npm run theatres:build`.
//
// Разметка выводится из атласа (`src/ui/map/tw/theatre/derive.ts`) по списку центров и цене местности
// (`list.ts`) и ложится в `src/ui/map/tw/theatre/data.ts` — его руками не правят. Тест `theatre.test.ts`
// сверяет запечённое с выводом: поправил список или цену и не пересобрал — красный тест.
//
// Печатает таблицу регионов: клетки, рамку и память заранее испечённого по уровням — это числа раздела 13.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atlasSize } from '@/world/atlas/atlas';
import { deriveTheatres } from '@/ui/map/tw/theatre/derive';
import { THEATRE_LIST } from '@/ui/map/tw/theatre/list';
import { fnv1a, pack } from '@/ui/map/tw/theatre/pack';

const out = fileURLToPath(new URL('../src/ui/map/tw/theatre/data.ts', import.meta.url));
const t0 = performance.now();
const cells = deriveTheatres();
const ms = performance.now() - t0;
const rle = pack(cells);
const hash = fnv1a(cells);
const body = `// Сгенерирован \`npm run theatres:build\` (scripts/build-theatres.ts) из атласа по списку регионов
// (\`list.ts\`) и разметке (\`derive.ts\`). Руками не править — скрипт перезапишет, а тест \`theatre.test.ts\`
// сверит с выводом.
//
// Клетка — один байт: номер региона 1..N по порядку \`THEATRE_IDS\`, 0 — ничья земля. Построчно, прогонами
// (значение, длина байтом до 253, иначе 254 и два байта), base64; распаковывает \`theatre.ts\`.

/** Сторона квадрата в клетках — та же, что у атласа. */
export const THEATRE_SIZE = ${atlasSize()};

/** Регионы по номерам: номер — место в списке плюс один. */
export const THEATRE_IDS = ${JSON.stringify(THEATRE_LIST.map((t) => t.id))} as const;

/** FNV-1a распакованной разметки. */
export const THEATRE_HASH = ${hash};

export const THEATRE_RLE =
  '${rle}';
`;
writeFileSync(out, body, 'utf8');
console.log(`Разметка: ${ms.toFixed(0)} мс, ${rle.length} знаков base64, подпись ${hash}. Записано: ${out}`);

// Таблица — по только что записанным данным: модуль регионов читает их сам.
const { theatres } = await import('@/ui/map/tw/theatre/theatre');
const { PREBAKE_BUDGET, planBytes, theatrePlan } = await import('@/ui/map/tw/theatre/plan');
const { tileMemory } = await import('@/ui/map/grid');
const MB = (b: number): string => (b / 1048576).toFixed(1).padStart(5);
const near = tileMemory({ w: 375, h: 812 });
console.log(`\nПамять заранее испечённого, МБ: обзор и листы — на всех уровнях, средний слой — на средней и высокой;`);
console.log(`ближний масштаб — кэш вокруг камеры, ${MB(near).trim()} МБ на экране 375×812 (grid.tileMemory), в таблицу не входит.`);
console.log(`Потолок заранее испечённого на средней и высокой — ${MB(PREBAKE_BUDGET).trim()} МБ (plan.PREBAKE_BUDGET).\n`);
console.log(`${'регион'.padEnd(10)} ${'имя'.padEnd(18)} ${'клеток'.padStart(6)} ${'рамка'.padStart(9)} ${'обзор'.padStart(5)} ${'листы'.padStart(5)} ${'средн'.padStart(5)} ${'низкая'.padStart(6)} ${'средняя'.padStart(7)}`);
let worst = { low: 0, mid: 0 };
for (const t of theatres()) {
  const plan = theatrePlan(t);
  const b = planBytes(plan, true);
  const low = b.overview + b.sheets;
  const medium = low + b.mid;
  worst = { low: Math.max(worst.low, low), mid: Math.max(worst.mid, medium) };
  console.log(
    `${t.id.padEnd(10)} ${t.name.padEnd(18)} ${String(t.cells).padStart(6)} ${`${t.box.w}×${t.box.h}`.padStart(9)} ${MB(b.overview)} ${MB(b.sheets)} ${MB(b.mid)} ${MB(low).padStart(6)} ${MB(medium).padStart(7)}`,
  );
}
console.log(`\nХудший регион: низкая ${MB(worst.low).trim()} МБ, средняя и высокая ${MB(worst.mid).trim()} МБ (без ближнего кэша).`);

// Где регион упрётся в ядро (docs/map_tw.md, раздел 13.7): логово мир заводит в кольце `LAIR_HOME_GAP`…`AI_RANGE`
// клеток от дома в любую сторону (`gen.ts`, `LocalWorld.spawnLair`) — регионов он не знает. Сколько мест под логово
// у дома ложится за границей региона: такое логово карта не рисует и целью не даёт, а набег из него идёт.
const { fitToSettle } = await import('@/world/settle');
const { settleable } = await import('@/world/land');
const { AI_RANGE, LAIR_HOME_GAP, WORLD_ORIGIN, WORLD_SIZE } = await import('@/world/data/tuning');
const { theatreIndexAt } = await import('@/ui/map/tw/theatre/theatre');
const STEP = 3;
let homes = 0;
let touched = 0;
let shareSum = 0;
const byTheatre = new Map<number, { homes: number; touched: number }>();
for (let y = WORLD_ORIGIN.y; y < WORLD_ORIGIN.y + WORLD_SIZE; y += STEP) {
  for (let x = WORLD_ORIGIN.x; x < WORLD_ORIGIN.x + WORLD_SIZE; x += STEP) {
    if (!fitToSettle({ x, y })) continue;
    const own = theatreIndexAt(x, y);
    let spots = 0;
    let out = 0;
    for (let dy = -AI_RANGE; dy <= AI_RANGE; dy++) {
      for (let dx = -AI_RANGE; dx <= AI_RANGE; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < LAIR_HOME_GAP || d > AI_RANGE) continue;
        if (!settleable(x + dx, y + dy)) continue;
        spots++;
        if (theatreIndexAt(x + dx, y + dy) !== own) out++;
      }
    }
    homes++;
    const b = byTheatre.get(own) ?? { homes: 0, touched: 0 };
    b.homes++;
    if (out > 0) {
      touched++;
      b.touched++;
    }
    byTheatre.set(own, b);
    shareSum += spots ? out / spots : 0;
  }
}
const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;
console.log(`
Логово за границей: мест под город (каждая ${STEP}-я клетка) — ${homes}; у ${pct(touched / homes)} из них часть кольца`);
console.log(`логов (${LAIR_HOME_GAP}…${AI_RANGE} клеток от дома) лежит в чужом регионе; в среднем за границей ${pct(shareSum / homes)} мест под логово.`);
const most = [...byTheatre.entries()].sort((a, b) => b[1].touched / b[1].homes - a[1].touched / a[1].homes).slice(0, 5);
console.log(`Чаще всего: ${most.map(([k, v]) => `${theatres()[k - 1]?.id ?? '—'} ${pct(v.touched / v.homes)}`).join(', ')}.`);
