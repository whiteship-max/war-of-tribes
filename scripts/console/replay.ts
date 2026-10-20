// `npm run replay [-- файл]` — ролик записи консоли в браузере: бой — ролик ГФ-1, осада — ролик ГФ-2 (docs/handbook/console.md).
import { fail, has, helpIf, parseArgs, rejectUnknown, text } from './lib';
import { openReplay } from './open';

const HELP = `
npm run replay [-- snaps/console/<запись>.json] [--no-open] [--quality low|medium|high]
Ролик боя или осады, который посчитала консольная команда (fight, raid, gate, siege, camp, intercept): тот же ролик,
что в игре, на записи из файла. Без файла — последняя запись (snaps/console/last.json). Поднимает dev-сервер vite
на 127.0.0.1:5199 и открывает браузер; выход — Ctrl+C. --no-open — только напечатать адрес.`;

const args = parseArgs();
helpIf(args, HELP);
const open = !has(args, 'no-open');
const quality = text(args, 'quality');
rejectUnknown('replay', args);
if (args.free.length > 1) fail('replay', 'одна запись за раз');
await openReplay(args.free[0] ?? 'snaps/console/last.json', { open, ...(quality ? { quality } : {}) });
process.exit(0);
