// Таблица наград разового дела для античита (AC-1): `npx vite-node scripts/deeds/build.ts` выводит её из данных игры
// (`derive.ts`) и кладёт в `src/game/data/deedgain.ts`. Печатает таблицу и сколько ответов вестей прогнано.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveDeedTable, eventsPerScale, renderDeedTable } from './derive';

const out = fileURLToPath(new URL('../../src/game/data/deedgain.ts', import.meta.url));
const t0 = performance.now();
const table = deriveDeedTable();
writeFileSync(out, renderDeedTable(table));
console.log(JSON.stringify(table, null, 1));
console.log(`ответов вестей (с вестями державы): ${eventsPerScale().answers}; ${Math.round(performance.now() - t0)} мс`);
console.log(`записано: ${out}`);
