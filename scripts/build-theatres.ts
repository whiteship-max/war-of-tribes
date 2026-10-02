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
