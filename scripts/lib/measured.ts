/**
 * Замер в выводе отчёта: число, которое меряется и плавает, отличается от числа, которое
 * обязано совпадать, — и отличает их сам отчёт, а не тот, кто сравнивает.
 *
 * Отчёты, которые гоняют настоящий браузер, печатают вперемешку два рода чисел: свойства
 * кода (сколько построек открылось, сколько диорам живо, какой срок у костра) и живые
 * замеры (миллисекунды, кадры, куча). Раньше их сравнивали глазами после маскировки всех
 * чисел подряд — а маска, закрывающая всё, закрывает и настоящий сдвиг. Здесь маскируется
 * ровно то, что отчёт назвал замером: `measure(v)` оборачивает значение в `‹…›`, и
 * сравнение (`stableLines`) выбрасывает содержимое скобок, но не саму строку.
 *
 * Правила сравнения, и других нет:
 *   — содержимое `‹…›` не сравнивается, место замера — сравнивается;
 *   — строка, в которой кроме замеров ничего нет, не сравнивается вовсе: так печатается
 *     живой журнал, где число событий само зависит от гонки;
 *   — пробелы сводятся к одному: выравнивание колонок подстраивается под ширину замера и
 *     смысла не несёт.
 * Всё остальное — буква в букву.
 */

export const OPEN = '‹';
export const CLOSE = '›';

/** Значение живого замера — то, что плавает от прогона к прогону. */
export const measure = (v: string | number): string => `${OPEN}${v}${CLOSE}`;

const MEASURED = new RegExp(`${OPEN}[^${CLOSE}\\n]*${CLOSE}`, 'g');
// Цвет терминала: ESC, скобка, числа, `m`. Сам ESC — кодом, чтобы в исходнике не было невидимого знака.
const ANSI = new RegExp(String.fromCharCode(27) + '[[][0-9;]*m', 'g');

/** Строки, которые обязаны совпасть между прогонами одного и того же кода. */
export function stableLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(ANSI, '').split(/\r?\n/)) {
    const hollow = raw.replace(MEASURED, OPEN + CLOSE);
    if (hollow !== raw && hollow.replace(new RegExp(`${OPEN}${CLOSE}`, 'g'), '').trim() === '') continue;
    out.push(hollow.replace(/\s+/g, ' ').trim());
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

/** Все замеры по порядку — чтобы показать, что именно плавало. */
export function measuredValues(text: string): string[] {
  return [...text.matchAll(MEASURED)].map((m) => m[0].slice(1, -1));
}

export interface Shift {
  /** Номер строки «до» и «после» (с единицы), `0` — строки нет с этой стороны. */
  before: number;
  after: number;
  was: string;
  now: string;
}

/**
 * Где разошлись устойчивые строки: сравнение по наибольшей общей подпоследовательности,
 * чтобы вставленная строка не сдвигала всё, что ниже. Пусто — совпало.
 */
export function shifts(before: string, after: string): Shift[] {
  const a = stableLines(before);
  const b = stableLines(after);
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const out: Shift[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      out.push({ before: 0, after: j + 1, was: '', now: b[j] });
      j++;
    } else {
      out.push({ before: i + 1, after: 0, was: a[i], now: '' });
      i++;
    }
  }
  return out;
}
