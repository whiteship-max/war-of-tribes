// Найм и лазарет — отчёт `raid-hiring:report`. Разделы — `raid-hiring.ts`, `raid-infirmary.ts`,
// `raid-burnt.ts` и `raid-width.ts` (ширина поля — прибор пачки 2 боя, docs/battle_eu4.md, раздел 8).
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
//   DECIDE_SWEEP=1 npm run raid-hiring:report   — только перемер «зависит ли исход от частоты решений» (docs/hiring.md, раздел 16)
//   MASTERS_SWEEP=1 npm run raid-hiring:report  — только спор за золото с набегами: отнимают ли мастера у войска
import { cadenceSection, hiringSection, mastersSection } from './raid-hiring';
import { infirmarySection } from './raid-infirmary';
import { burntSection } from './raid-burnt';
import { widthSection } from './raid-width';
import { restSection } from './raid-rest';
import { spiritSection } from './raid-spirit';
import { measure } from './lib/measured';

// Сколько стоит каждый раздел — замером в ‹…›: удешевлять отчёт надо по числам, а не на глаз.
const clock = { at: performance.now(), rows: [] as [string, number][] };
const lap = (name: string): void => {
  const now = performance.now();
  clock.rows.push([name, (now - clock.at) / 1000]);
  clock.at = now;
};

if (process.env.DECIDE_SWEEP) {
  // Перемер одного свойства прибора (docs/hiring.md, раздел 16) — не приёмка, и прочих разделов не гонит.
  await cadenceSection();
} else if (process.env.MASTERS_SWEEP) {
  // Спор за золото с набегами (docs/admin_branch.md, раздел 4.1) — замер, не приёмка; прочих разделов не гонит.
  await mastersSection();
} else {
  const hired = await hiringSection();
  lap('Найм');
  await infirmarySection(hired);
  lap('Лазарет');
  await burntSection(hired);
  lap('Сожжённые посёлки');
  widthSection(hired);
  lap('Ширина поля');
  restSection(hired);
  lap('Мораль между боями');
  spiritSection(hired);
  lap('Дух дружины');

  console.log('');
  console.log('=== Сколько стоит каждый раздел ===');
  for (const [name, sec] of clock.rows) console.log(`  ${name.padEnd(28)} ${measure(`${sec.toFixed(0)} с`)}`);
}
