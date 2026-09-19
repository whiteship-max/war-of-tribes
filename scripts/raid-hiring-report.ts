// Найм и лазарет — отчёт `raid-hiring:report`. Разделы — `raid-hiring.ts` и `raid-infirmary.ts`.
//
// Прежде это были разделы `raid:report`; разведены отдельным отчётом, чтобы подсчёт по диффу гнал их
// только тогда, когда задето их замыкание (docs/realm.md, раздел 8, «Цена разделов raid:report»).
// Вывод разделов при разведении не изменился ни на букву — сверено с прогоном `raid:report` на 927bb5a.
//
// Два раздела живут одним отчётом нарочно: «Лазарет» читает прогоны «Найма» (`Hired`) и своих, кроме
// полководца, жгущего логова, не гоняет. Врозь он гонял бы их второй раз — пятьсот с лишним секунд, — а
// замыкание у него всё равно включает «Найм» целиком (`raid-infirmary.ts` импортирует `raid-hiring.ts`),
// так что правки, задевающей лазарет и не задевающей найм, не бывает.
//
//   npm run raid-hiring:report
import { hiringSection } from './raid-hiring';
import { infirmarySection } from './raid-infirmary';
import { measure } from './lib/measured';

// Сколько стоит каждый раздел — замером в ‹…›: удешевлять отчёт надо по числам, а не на глаз.
const clock = { at: performance.now(), rows: [] as [string, number][] };
const lap = (name: string): void => {
  const now = performance.now();
  clock.rows.push([name, (now - clock.at) / 1000]);
  clock.at = now;
};

const hired = await hiringSection();
lap('Найм');
await infirmarySection(hired);
lap('Лазарет');

console.log('');
console.log('=== Сколько стоит каждый раздел ===');
for (const [name, sec] of clock.rows) console.log(`  ${name.padEnd(28)} ${measure(`${sec.toFixed(0)} с`)}`);
