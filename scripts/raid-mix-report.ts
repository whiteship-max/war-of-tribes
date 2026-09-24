// Оборона по составу — отчёт `raid-mix:report`. Сам раздел — `raid-defense-mix.ts`.
//
// Прежде это был раздел `raid:report`; разведён отдельным отчётом, чтобы подсчёт по диффу гнал его
// только тогда, когда задето его замыкание (docs/realm.md, раздел 8, «Цена разделов raid:report»).
// Вывод раздела при разведении не изменился ни на букву — сверено с прогоном `raid:report` на 927bb5a.
//
//   npm run raid-mix:report
import { defenseMixSection } from './raid-defense-mix';
import { quickFooter } from './lib/quick';

await defenseMixSection();
quickFooter();
