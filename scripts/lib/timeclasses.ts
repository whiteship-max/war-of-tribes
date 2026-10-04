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
  worldDayRate: 'game',
  realTime: 'real',
  realSec: 'real',
  sessionSec: 'real',
  shieldTime: 'real',
  realHourRate: 'real',
  ownerTime: 'owner',
  ownerSec: 'owner',
};

/**
 * Кто из них — **ставка**, а не срок. Таблица классов одна на всех (второй развела бы две правды
 * об одном конструкторе), но ищут их по-разному: срок носит единицу в своём объявлении, ставка —
 * в имени того, кто её несёт (`unclassifiedRates`). Идёт ставка со шкалой обратно сроку: за
 * настоящий час игровая ставка отдаёт во столько же раз меньше, во сколько день длиннее.
 */
export const RATE_CTORS = ['gameRate', 'worldDayRate', 'realHourRate'];

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
    // В дереве есть файлы и с CRLF, и с LF: правило, писанное через перевод строки, на первых
    // молчало бы — так и вышло с первым наброском поиска ставок.
    .split('\r\n')
    .join('\n')
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
      // Таблица (`[…]`, `{…}`) — не величина: её строки считает `tableRows`. Объявление здесь режется по первой `;`, и
      // у таблицы она стоит где придётся — в строке текста или вовсе за таблицей: `BUILDINGS` читался до вместимости
      // склада `storage: 3600` и выдавал её за час, как только из описания ратуши ушла точка с запятой (этап 3 текстов).
      if (/^[[{]/.test(init)) continue;
      // Счёт, а не срок: клетки, золото. Срок в миллисекундах литералом узнаётся по имени.
      if (/^\d[\d_]*$/.test(init) && !/(_MS|_TTL|_AFTER|_EVERY|_BASE)$/.test(m[1])) continue;
      if (!unit.test(init) || STARTS_WITH_CTOR.test(init)) continue;
      out.push(`${file}: ${m[1]}`);
    }
  }
  return out;
}

/**
 * Ставки без класса.
 *
 * **Ставка — число, встречающееся с прошедшим временем**, и единицу ей называет не список, а тот
 * идентификатор, что её несёт: `townPerHour`, `consumptionPerHour`, `perManPerHour`. Час, минута и
 * секунда на часах мира настоящие (`siege.fallsAt` умножает остаток еды на `HOUR`), поэтому всё,
 * что втекает в такое имя, обязано пройти дверь: `worldDayRate` — если ставка сравнивается с
 * хозяйством, `realHourRate` — если она идёт временем игрока.
 *
 * Игровой день (`…PerDay`, `*_PER_DAY`) сюда не входит, и это не поблажка: на часах племени он
 * `DAY_LENGTH` игровых секунд, шаг симуляции двигает `s.time` тоже игровыми — настоящего времени
 * такая ставка не встречает никогда, и класс у неё в имени, как у `*_DAYS` в `dayConsts`.
 *
 * Считается один переход: именованное число, стоящее в объявлении такого идентификатора или
 * значением такого поля. Дальше идти незачем — ровно на одном переходе и потерялся
 * `SIEGE_TOWN_EAT`: единица стояла в прозе, а пачка 2 искала сроки (docs/time.md, раздел 18).
 */
export function unclassifiedRates(root: string): string[] {
  const REAL_UNIT = /(?:[a-z]P|^p|_P)er(?:Hour|Minute|Second)\b|_PER_(?:HOUR|MINUTE|SECOND)\b/;
  const THROUGH_DOOR = new RegExp('^(' + RATE_CTORS.join('|') + ')\\(');
  const NAMED = /\b([A-Z][A-Z0-9_]{2,})\b/g;

  // Чем объявлено каждое именованное число зоны: по нему и видно, прошло ли оно дверь.
  const decl = new Map<string, string>();
  for (const file of files(root))
    for (const m of code(path.join(root, file)).matchAll(/export const ([A-Z][A-Z0-9_]*)(?::[^=]+)? = ([^;]*);/g))
      decl.set(m[1], m[2].trim());

  const out = new Set<string>();
  const charge = (file: string, carrier: string, value: string): void => {
    if (THROUGH_DOOR.test(value.trim())) return;
    for (const m of value.matchAll(NAMED)) {
      const init = decl.get(m[1]);
      if (init === undefined || THROUGH_DOOR.test(init)) continue;
      out.add(`${file}: ${carrier} ← ${m[1]} = ${init}`);
    }
  };

  for (const file of files(root)) {
    const src = code(path.join(root, file));
    for (const m of src.matchAll(/\b(?:export )?const (\w+)(?::[^=]+)? = ([\s\S]*?);\n/g))
      if (REAL_UNIT.test(m[1])) charge(file, m[1], m[2]);
    for (const m of src.matchAll(/\b(\w+):\s*([^,;\n{}]+)[,;\n]/g))
      if (REAL_UNIT.test(m[1]) && m[2].trim() !== 'number') charge(file, m[1], m[2]);
  }
  return [...out].sort();
}
