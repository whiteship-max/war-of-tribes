/**
 * Быстрая приёмка: одна дверь, через которую отчёт узнаёт, что его гонят быстро, — и через которую он
 * говорит, что при этом видит и чего не видит.
 *
 * ДВА РЕЖИМА (решение владельца). Полная приёмка — «выводим число»: миры, бои и часы такие, из каких
 * числа переписываются в документы. Быстрая — «не сломалось ли»: тот же отчёт на меньшем числе миров и
 * боёв. Включает её `TRIBE_QUICK=1` — ставит его `scripts/reports.ts`, руками — тоже можно.
 *
 * ЧТО РЕЖЕТСЯ — только число повторов: миры (`worlds`) и бои на точку (`fights`). Строки, разделы,
 * поведения, уровни и часы прогона — те же, что у полной: быстрая обязана пройти по каждой строке
 * таблицы, иначе правка, задевшая только выброшенную строку, прошла бы мимо неё целиком. Подмножество —
 * всегда первые: быстрый прогон мира 7 — тот же прогон, что в полной, буква в букву.
 *
 * ЧТО БЫСТРАЯ ВИДИТ. Вывод детерминирован, поэтому любая правка, изменившая хоть один её прогон, видна
 * сдвигом буквы — шума у сравнения нет. Слепа она к прогонам, которых не делала: правка, чей код ни разу
 * не исполнился на её мирах и боях, её вывод не тронет, а полный — может. Это не догадка, а замер:
 * приёмка пишет покрытие быстрого прогона и сверяет его с тронутыми строками (`lib/blind.ts`).
 *
 * ГРАНИЦА — второй вопрос: если вывод сдвинулся, велик ли сдвиг. Отчёт регистрирует ключевые доли и
 * частоты (`share`, `rate`) с 95-процентной границей, и в быстром режиме печатает их в конце отдельным
 * разделом. Сдвиг ключевого числа внутри прежней границы быстрая от перетасовки прогонов не отличит — это
 * и сказано в выводе; за границей — отличит. В полном режиме дверь не печатает ничего и ничего не режет:
 * полный вывод обязан совпасть с прежним буква в букву.
 */
import { wilson, Z95 } from './halfband';

/** Быстрая ли приёмка сейчас. */
export const QUICK = process.env.TRIBE_QUICK === '1';

interface Cut {
  what: string;
  kept: number;
  of: number;
}
const cuts: Cut[] = [];
const bounds: string[] = [];

/** Миры (сиды) прогона: в полной — все, в быстрой — первые `keep`. `what` — как назвать срез в выводе. */
export function worlds<T>(what: string, all: readonly T[], keep: number): T[] {
  if (!QUICK || keep >= all.length) return [...all];
  cuts.push({ what, kept: keep, of: all.length });
  return all.slice(0, keep);
}

/** Боёв на точку: в полной — `n`, в быстрой — `keep`. */
export function fights(what: string, n: number, keep: number): number {
  if (!QUICK || keep >= n) return n;
  cuts.push({ what, kept: keep, of: n });
  return keep;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/**
 * Интервал для числа событий Пуассона `k` (95 %, приближение Байара — точнее нормального и при малых `k`).
 * При `k` = 0 нижний край — ноль.
 */
export function poisson(k: number, z: number = Z95): { lo: number; hi: number } {
  const lo = k === 0 ? 0 : k * (1 - 1 / (9 * k) - z / (3 * Math.sqrt(k))) ** 3;
  const k1 = k + 1;
  const hi = k1 * (1 - 1 / (9 * k1) + z / (3 * Math.sqrt(k1))) ** 3;
  return { lo: Math.max(0, lo), hi };
}

/**
 * Меньше скольких случаев у доли границы нет. Уилсон обещает 95 % в среднем по доле, а в худшей точке держит
 * тем меньше, чем меньше случаев: от десяти — не хуже 89 %, при одном — 80 % (точный счёт — `quick.test.ts`).
 */
export const SHARE_FROM = 10;

/** Строка границы доли: «12% [5%…25%] из 40»; при малом числе случаев — без границы, так и сказано. */
export function shareText(k: number, n: number): string {
  if (n <= 0) return '— (ни одного случая)';
  if (n < SHARE_FROM) return `${pct(k / n)} из ${n} — мало случаев, границы нет`;
  const b = wilson(k, n);
  return `${pct(k / n)} [${pct(b.lo)}…${pct(b.hi)}] из ${n}`;
}

/** Строка границы частоты: `k` событий на `exposure` единиц — «0.15 [0.05…0.31] на ч, событий 6». */
export function rateText(k: number, exposure: number, unit: string): string {
  const b = poisson(k);
  const f = (x: number): string => (x / exposure).toFixed(2);
  return `${f(k)} [${f(b.lo)}…${f(b.hi)}] ${unit}, событий ${k}`;
}

/** Ключевая доля отчёта: `k` из `n`. Печатается только в быстрой приёмке. */
export function share(label: string, k: number, n: number): void {
  if (QUICK) bounds.push(`  ${label}: ${shareText(k, n)}`);
}

/** Ключевая частота отчёта: `k` событий на `exposure` единиц. Печатается только в быстрой приёмке. */
export function rate(label: string, k: number, exposure: number, unit: string): void {
  if (QUICK) bounds.push(`  ${label}: ${rateText(k, exposure, unit)}`);
}

/** Своя граница отчёта — уже посчитанная строка (например, граница полпути из `halfband.ts`). */
export function bound(label: string, text: string): void {
  if (QUICK) bounds.push(`  ${label}: ${text}`);
}

/** Заголовок раздела границы: по нему его находит сверка (`boundsOf`). */
export const FIELD_HEAD = '=== Быстрая приёмка: поле зрения и граница ===';

/** Ключевое число из вывода: значение и край его границы в тех единицах, в каких напечатано. */
export interface Bound {
  value: number;
  lo: number;
  hi: number;
}

/** Ключевые числа из раздела границы вывода — по подписи. Одна дверь с печатью: формат один. */
export function boundsOf(output: string): Map<string, Bound> {
  const out = new Map<string, Bound>();
  const lines = output.split(/\r?\n/);
  const at = lines.indexOf(FIELD_HEAD);
  if (at < 0) return out;
  for (const line of lines.slice(at + 1)) {
    const m = /^ {2}(.+): (-?[\d.]+)%? \[(-?[\d.]+)%?…(-?[\d.]+)%?\]/.exec(line);
    if (m) out.set(m[1], { value: Number(m[2]), lo: Number(m[3]), hi: Number(m[4]) });
  }
  return out;
}

/**
 * Сдвиг ключевых чисел против базы: какие вышли за прежнюю границу. Внутри прежней границы — быстрая от
 * перетасовки прогонов не отличит; за ней — отличит. Подпись, которой нет у одной из сторон, — тоже за
 * границей: сравнивать её не с чем.
 */
export function boundShift(before: string, after: string): { inside: number; outside: string[] } {
  const a = boundsOf(before);
  const b = boundsOf(after);
  let inside = 0;
  const outside: string[] = [];
  for (const [label, now] of b) {
    const was = a.get(label);
    if (!was) outside.push(`${label} (новое)`);
    else if (now.value === was.value) continue;
    else if (now.value >= was.lo && now.value <= was.hi) inside++;
    else outside.push(`${label}: ${was.value} [${was.lo}…${was.hi}] → ${now.value}`);
  }
  for (const label of a.keys()) if (!b.has(label)) outside.push(`${label} (пропало)`);
  return { inside, outside };
}

/** Конец отчёта в быстрой приёмке: что срезано и граница ключевых чисел. В полной — ничего. */
export function quickFooter(): void {
  if (!QUICK) return;
  console.log('');
  console.log(FIELD_HEAD);
  console.log('Срезано (строки, разделы, поведения и часы — те же, что в полной; подмножество — первые):');
  const seen = new Set<string>();
  for (const c of cuts) {
    const line = `  ${c.what}: ${c.kept} из ${c.of}`;
    if (seen.has(line)) continue;
    seen.add(line);
    console.log(line);
  }
  if (bounds.length > 0) {
    console.log(`Ключевые числа с границей 95 % (доля — Уилсон: в среднем 95 %, от ${SHARE_FROM} случаев не хуже 89 %; частота — Пуассон,`);
    console.log('не хуже 95 %). Сдвиг внутри прежней границы быстрая от перетасовки прогонов не отличит — его решает полная; за границей — отличит:');
    for (const b of bounds) console.log(b);
  }
}
