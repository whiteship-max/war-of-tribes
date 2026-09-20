// Классы величин времени — чтением исходников (docs/time.md, раздел 13).
//
// Класс записан там же, где число: величина объявлена через конструктор своего класса
// (`game/pace.ts`). Этот модуль списка не держит — он читает объявления и говорит, что нашёл:
// им печатает счёт `npm run time:report` (раздел 4) и им же тест ищет величину без класса.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export type TimeClass = 'game' | 'real' | 'owner';

/** Конструктор → класс. Единственное место, где они сведены; сами конструкторы — в `game/pace.ts`. */
export const CTOR_CLASS: Record<string, TimeClass> = {
  gameSec: 'game',
  gameRate: 'game',
  worldDays: 'game',
  realTime: 'real',
  realSec: 'real',
  sessionSec: 'real',
  shieldTime: 'real',
  ownerTime: 'owner',
  ownerSec: 'owner',
};

export interface TimeConst {
  file: string;
  name: string;
  ctor: string;
  cls: TimeClass;
  /** Для «решает владелец» — в чём вопрос, словами из объявления. */
  why?: string;
}

const code = (abs: string): string =>
  readFileSync(abs, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sources(abs));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(abs);
  }
  return out;
}

/** Где живут величины времени игры: племя и мир. Сеть, сцена и предыстория — свои часы, не эти. */
const ZONES = ['src/game', 'src/world'];
/** Сама дверь и единицы: здесь конструкторы объявлены, а не применены. */
const DOOR = ['src/game/pace.ts', 'src/game/time.ts'];

const files = (root: string): string[] =>
  ZONES.flatMap((z) => sources(path.join(root, z)))
    .map((abs) => path.relative(root, abs).split(path.sep).join('/'))
    .filter((f) => !DOOR.includes(f))
    .sort();

const CTORS = Object.keys(CTOR_CLASS).join('|');
const DECL = new RegExp('export const (\\w+)(?::[^=]+)? = (' + CTORS + ')\\(([^;]*)\\);', 'g');
const STARTS_WITH_CTOR = new RegExp('^(' + CTORS + ')\\(');

/** Все величины, объявленные через конструктор класса. */
export function timeConsts(root: string): TimeConst[] {
  const out: TimeConst[] = [];
  for (const file of files(root)) {
    const src = code(path.join(root, file));
    for (const m of src.matchAll(DECL)) {
      const why = m[3].match(/,\s*'([^']*)'\s*$/)?.[1];
      out.push({ file, name: m[1], ctor: m[2], cls: CTOR_CLASS[m[2]], why });
    }
  }
  return out;
}

/**
 * Строки таблиц со сроком в классе: поле объекта, а не своя константа (ступени изучения округи,
 * прибавка Дозора к предупреждению). Имени у них нет — считаются по файлу, полю и конструктору.
 */
export function tableRows(root: string): { file: string; field: string; ctor: string; cls: TimeClass; n: number }[] {
  const out: { file: string; field: string; ctor: string; cls: TimeClass; n: number }[] = [];
  const FIELD = new RegExp('\\b(\\w+): (' + CTORS + ')\\(', 'g');
  for (const file of files(root)) {
    const tally = new Map<string, number>();
    for (const m of code(path.join(root, file)).matchAll(FIELD)) tally.set(`${m[1]}|${m[2]}`, (tally.get(`${m[1]}|${m[2]}`) ?? 0) + 1);
    for (const [key, n] of tally) {
      const [field, ctor] = key.split('|');
      out.push({ file, field, ctor, cls: CTOR_CLASS[ctor], n });
    }
  }
  return out;
}

/** Игровое время по единице: срок в игровых днях (`*_DAYS`) — конструктор ему не нужен, класс в имени. */
export function dayConsts(root: string): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const file of files(root)) {
    const src = code(path.join(root, file));
    for (const m of src.matchAll(/export const (\w+_DAYS)\b(?::[^=]+)? = /g)) out.push({ file, name: m[1] });
  }
  return out;
}

/**
 * Величины времени без класса: объявление, в котором стоит единица настоящего времени (`MIN`,
 * `HOUR`, `MINUTE_MS`, `HOUR_MS`, `DAY_MS`, миллисекунды или секунды часа литералом), но нет
 * конструктора класса. Алиас другой величины (`FALL_MARK = BURN_IMMUNE`) единицы не несёт.
 */
export function unclassified(root: string): string[] {
  const unit = /(\*\s*(MIN|HOUR|MINUTE_MS|HOUR_MS|DAY_MS)\b|\b(\d+_)?\d*[05]_000\b(?=\s*$)|\b3_?600\b)/;
  const out: string[] = [];
  for (const file of files(root)) {
    const src = code(path.join(root, file));
    for (const m of src.matchAll(/export const (\w+)(?::[^=]+)? = ([^;]*);/g)) {
      const init = m[2].trim();
      // Функция, которая переводит единицы (`ms / 60_000`), — не величина: у неё нет своего срока.
      if (init.includes('=>')) continue;
      // Счёт, а не срок: клетки, золото. Срок в миллисекундах литералом узнаётся по имени.
      if (/^\d[\d_]*$/.test(init) && !/(_MS|_TTL|_AFTER|_EVERY|_BASE)$/.test(m[1])) continue;
      if (!unit.test(init) || STARTS_WITH_CTOR.test(init)) continue;
      out.push(`${file}: ${m[1]}`);
    }
  }
  return out;
}
