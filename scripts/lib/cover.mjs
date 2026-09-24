/**
 * Покрытие по функциям для быстрой приёмки: какие функции процесс вызвал хоть раз.
 *
 * `NODE_V8_COVERAGE` пишет покрытие по блокам, и стоит оно прогону ×1.75 (замер: живой прогон 2 ч — 5.4 с без
 * покрытия, 9.5 с по блокам, 5.8 с по функциям; docs/realm.md, раздел 8). По блокам быстрая стоила бы почти
 * столько же, сколько полная, — поэтому быстрая пишет покрытие по функциям: V8 считает вызовы функций, не
 * трогая блоков. Что это значит для вердикта «слепа», — `blind.ts` (зерно `function`).
 *
 * Подгружается раньше всего (`node --import`, через `NODE_OPTIONS`, поэтому наследуется и дочерними процессами
 * веера), как `trace-fs.mjs`. `TRIBE_COVER` — папка, куда процесс кладёт своё покрытие при выходе, в том же
 * виде, что `NODE_V8_COVERAGE` (`{ result: [...] }`). Без переменной модуль не делает ничего.
 */
import fs from 'node:fs';
import inspector from 'node:inspector';
import path from 'node:path';

/** Адрес этого модуля — то, что прогон кладёт в `--import`. */
export const hook = import.meta.url;

const dir = process.env.TRIBE_COVER;

if (dir) {
  const session = new inspector.Session();
  session.connect();
  session.post('Profiler.enable');
  session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
  process.on('exit', () => {
    // Сессия в том же потоке отвечает сразу: обратный вызов срабатывает до выхода.
    session.post('Profiler.takePreciseCoverage', (err, res) => {
      if (err || !res) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `coverage-${process.pid}-${Date.now()}.json`), JSON.stringify({ result: res.result }));
      } catch {
        // покрытие не имеет права ронять прогон
      }
    });
  });
}
