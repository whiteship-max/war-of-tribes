/**
 * Запись прочитанного: какие файлы процесс на самом деле открыл.
 *
 * Подгружается раньше всего остального (`node --import`, через `NODE_OPTIONS`, поэтому
 * наследуется и дочерними процессами: ступенями сборки, vite-node внутри npx) и оборачивает
 * чтение в `node:fs`. Замыкание в `deps.ts` выводится из текста файлов и не видит пути,
 * собранного из переменных во время работы; эта запись видит всё, что прошло через Node,
 * а через Node проходит всё: модули читает vite, страницу и её ресурсы отдаёт сервер в том
 * же процессе, собранное читает статический сервер отчёта. Прочитанное вне замыкания —
 * значит подсчёт ошибся, и прогон говорит об этом вслух (`scripts/reports.ts`).
 *
 * Пишется только папка процесса, запросившего запись: `TRIBE_TRACE` — файл, куда дописать,
 * `TRIBE_TRACE_ROOT` — корень, вне которого ничего не записывается. Без них модуль не
 * делает ничего.
 */
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Адрес этого модуля — то, что прогон кладёт в `--import`. Импорт ради него ничего не включает. */
export const hook = import.meta.url;

const out = process.env.TRIBE_TRACE;
const root = process.env.TRIBE_TRACE_ROOT;

if (out && root) {
  const base = path.resolve(root).toLowerCase() + path.sep;
  const seen = new Set();
  const note = (p, dir) => {
    try {
      let s = p;
      if (s instanceof URL) s = fileURLToPath(s);
      else if (Buffer.isBuffer(s)) s = s.toString('utf8');
      if (typeof s !== 'string') return;
      const abs = path.resolve(s);
      if (!abs.toLowerCase().startsWith(base)) return;
      const rel = abs.slice(base.length).split(path.sep).join('/');
      seen.add(dir ? `${rel}/` : rel);
    } catch {
      // запись не имеет права ронять чтение
    }
  };
  const wrap = (obj, name, dir) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function traced(p, ...rest) {
      note(p, dir);
      return orig.call(this, p, ...rest);
    };
  };
  for (const n of ['readFileSync', 'readFile', 'createReadStream', 'openSync', 'open']) wrap(fs, n, false);
  for (const n of ['readdirSync', 'readdir', 'opendirSync', 'opendir']) wrap(fs, n, true);
  for (const n of ['readFile', 'open']) wrap(fs.promises, n, false);
  for (const n of ['readdir', 'opendir']) wrap(fs.promises, n, true);
  syncBuiltinESMExports();
  process.on('exit', () => {
    if (seen.size > 0) fs.appendFileSync(out, [...seen].join('\n') + '\n');
  });
}
