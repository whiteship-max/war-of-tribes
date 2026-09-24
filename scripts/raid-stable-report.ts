// Конюшня — отчёт `raid-stable:report` (docs/stable.md). Сам раздел — `raid-stable.ts`.
//
// Прежде это был раздел `raid:report`; разведён отдельным отчётом, чтобы подсчёт по диффу гнал его
// только тогда, когда задето его замыкание (docs/realm.md, раздел 8, «Цена разделов raid:report»).
// Вывод раздела при разведении не изменился ни на букву — сверено с прогоном `raid:report` на 927bb5a.
//
//   npm run raid-stable:report
import { stableSection } from './raid-stable';
import { quickFooter } from './lib/quick';

await stableSection();
quickFooter();
