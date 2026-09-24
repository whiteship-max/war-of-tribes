// Рост логова — отчёт `raid-growth:report`. Сам раздел — `raid-lair-growth.ts`.
//
// Прежде это был раздел `raid:report`; разведён отдельным отчётом, чтобы подсчёт по диффу гнал его
// только тогда, когда задето его замыкание (docs/realm.md, раздел 8, «Цена разделов raid:report»).
// Вывод раздела при разведении не изменился ни на букву — сверено с прогоном `raid:report` на 927bb5a.
//
//   npm run raid-growth:report
import { lairGrowthSection } from './raid-lair-growth';
import { quickFooter } from './lib/quick';

await lairGrowthSection();
quickFooter();
