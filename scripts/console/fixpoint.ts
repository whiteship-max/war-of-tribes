// Правила остановки вывода неподвижной точки (правила 16 и 19) — чистые функции драйвера `npm run derive`
// (scripts/console/derive.ts), отдельно, чтобы их держал тест: сам драйвер при импорте сразу начинает вывод.
//
// Решение владельца 26.10.2026 (вывод W на слиянии dr-5, docs/siege_v2.md, 22.6): «не сошлось» — стоп и доклад: драйвер
// выходит с ненулевым кодом и записанное не трогает, а не печатает строку с кодом 0 (прежде за ним сразу шёл вывод таблицы на
// несошедшемся W). Качание W в пределах ±2 — полусумма по правилу 19, флаг и конец вывода: шаг проверки на полусумме
// соседних W повторял измеренное, и вывод не кончался (находка 22.4). Таблица у ворот — так же: не севшие строки, повернувшие
// назад, — полусуммой; идущие в одну сторону к последнему шагу — стоп.

/** Допуск качания W, бойцов строя (решение владельца 26.10.2026): повернувшее назад выведенное не дальше 2 от записанного. */
export const W_SWING = 2;
/** Строка таблицы у ворот села: выведенное в 1 % от записанного. */
export const GATE_SETTLE = 0.01;
/** Код выхода «не сошлось» — стоп и доклад (ошибка доводов — 2, `lib.fail`). */
export const NOT_SETTLED_EXIT = 3;

export type WMove =
  /** Выведенное равно записанному — неподвижная точка. */
  | { kind: 'fixed' }
  /** Качание в пределах ±`W_SWING` — записать полусумму записанного и выведенного, флаг, конец вывода. */
  | { kind: 'swing'; next: number }
  /** Записать выведенное и сделать шаг ещё. */
  | { kind: 'step'; next: number }
  /** Шаг последний, а точка не села — не сошлось: стоп, записанное не трогается. */
  | { kind: 'stuck' };

/** Повернуло ли назад: записанное ушло от прежнего в одну сторону, выведенное от записанного — в другую. */
const turned = (prev: number | undefined, was: number, derived: number): boolean =>
  prev !== undefined && prev !== was && Math.sign(derived - was) === -Math.sign(was - prev);

/**
 * Ход вывода W после шага. `seen` — записанные W по шагам этого вывода (последнее — то, на котором шаг считал), `derived` —
 * выведенное шагом, `last` — шаг последний. Качание — выведенное повернуло назад и не дальше `W_SWING` от записанного: точка
 * между ними, полусумма — округлением до целого.
 */
export function wMove(seen: readonly number[], derived: number, last: boolean): WMove {
  const was = seen[seen.length - 1];
  if (derived === was) return { kind: 'fixed' };
  if (turned(seen[seen.length - 2], was, derived) && Math.abs(derived - was) <= W_SWING) return { kind: 'swing', next: Math.round((derived + was) / 2) };
  if (last) return { kind: 'stuck' };
  return { kind: 'step', next: derived };
}

export type Foe = 'wolves' | 'raiders';
export type Table = Record<Foe, number[]>;
export const FOES: readonly Foe[] = ['wolves', 'raiders'];
/** Строка таблицы словами: «волки 8-го». */
export const rowName = (who: Foe, i: number): string => `${who === 'wolves' ? 'волки' : 'разбойники'} ${i + 1}-го`;

const sat = (x: number, was: number): boolean => Math.abs(x - was) <= GATE_SETTLE * Math.abs(was);

/** Все строки выведенной таблицы в `GATE_SETTLE` от записанной. */
export const gateSettled = (was: Table, table: Table): boolean => FOES.every((who) => table[who].every((x, i) => sat(x, was[who][i])));

export type GateMove =
  /** Все строки сели — записать выведенную. */
  | { kind: 'settled' }
  /** Не севшие строки все повернули назад — записать их полусуммой (севшие — выведенными), флаг, конец вывода. */
  | { kind: 'swing'; table: Table; rows: string[] }
  /** Записать: повернувшие назад — полусуммой, прочие — выведенными; шаг ещё. */
  | { kind: 'step'; table: Table }
  /** Шаг последний, а строки `rows` всё идут в одну сторону — не сошлось: стоп, записанное не трогается. */
  | { kind: 'stuck'; rows: string[] };

/**
 * Ход вывода таблицы у ворот после шага: `seen` — записанные таблицы по шагам этого вывода (последняя — та, на которой шаг
 * считал), `table` — выведенная, `last` — шаг последний. Строка, повернувшая назад, качается вокруг точки между записанным и
 * выведенным — её полусумма (правило 16); строка, идущая в одну сторону, ещё не сошлась.
 */
export function gateMove(seen: readonly Table[], table: Table, last: boolean): GateMove {
  const was = seen[seen.length - 1];
  const prev = seen.length >= 2 ? seen[seen.length - 2] : undefined;
  if (gateSettled(was, table)) return { kind: 'settled' };
  const swung: string[] = [];
  const moving: string[] = [];
  const next = {} as Table;
  for (const who of FOES) {
    next[who] = table[who].map((x, i) => {
      const w = was[who][i];
      if (sat(x, w)) return x;
      if (turned(prev?.[who][i], w, x)) {
        swung.push(rowName(who, i));
        return Math.round((x + w) / 2);
      }
      moving.push(rowName(who, i));
      return x;
    });
  }
  if (moving.length === 0) return { kind: 'swing', table: next, rows: swung };
  if (last) return { kind: 'stuck', rows: moving };
  return { kind: 'step', table: next };
}

// ---------- Стена и лестницы (ПБ-1, п. 3) ----------
//
// Грани обороны стены и лестниц (`world/data/wall.ts`) выводятся тем же кругом, что W и шаг кости (`npm run derive -- w`): бои у стен
// — выборка W, а ширина решает бой у стены. Допуск — тот же, что у раздела «сила стены» `siege:report` (там «РАСХОДИТСЯ» с
// четверти грани); повернувшая назад грань — полусуммой до десятых (правило 16).

/** Грань села: выведенная ближе четверти грани к записанной — допуск раздела «сила стены». */
export const WALL_SETTLE = 0.25;

/** Грани стены: оборона и лестницы сверх неё (`WallFaces` мира — без импорта: файл держит тест без мира). */
export interface Faces {
  wall: number;
  ladder: number;
}
const FACES = ['wall', 'ladder'] as const;
const faceName = { wall: 'оборона стены', ladder: 'лестницы' } as const;

export type FacesMove =
  /** Обе грани сели — записать выведенные. */
  | { kind: 'settled' }
  /** Не севшие грани повернули назад — записать их полусуммой, флаг. */
  | { kind: 'swing'; next: Faces; faces: string[] }
  /** Записать: повернувшие — полусуммой, прочие — выведенными; шаг ещё. */
  | { kind: 'step'; next: Faces }
  /** Шаг последний, а грани `faces` идут в одну сторону — не сошлось. */
  | { kind: 'stuck'; faces: string[] };

/** Ход вывода граней после шага: `seen` — записанные грани по шагам, `derived` — выведенные, `last` — шаг последний. */
export function facesMove(seen: readonly Faces[], derived: Faces, last: boolean): FacesMove {
  const was = seen[seen.length - 1];
  const prev = seen.length >= 2 ? seen[seen.length - 2] : undefined;
  const next = { ...derived };
  const swung: string[] = [];
  const moving: string[] = [];
  for (const f of FACES) {
    if (Math.abs(derived[f] - was[f]) < WALL_SETTLE) continue;
    if (turned(prev?.[f], was[f], derived[f])) {
      swung.push(faceName[f]);
      next[f] = Math.round(((derived[f] + was[f]) / 2) * 10) / 10;
    } else moving.push(faceName[f]);
  }
  if (swung.length === 0 && moving.length === 0) return { kind: 'settled' };
  if (moving.length === 0) return { kind: 'swing', next, faces: swung };
  if (last) return { kind: 'stuck', faces: moving };
  return { kind: 'step', next };
}

/** Записать грани в исходник `world/data/wall.ts`: строки `WALL_FACES = N;` и `LADDER_FACES = N;`. Не нашлось — `null`. */
export function withFaces(src: string, faces: Faces): string | null {
  const a = src.replace(/export const WALL_FACES = [\d.]+;/, `export const WALL_FACES = ${faces.wall};`);
  const b = a.replace(/export const LADDER_FACES = [\d.]+;/, `export const LADDER_FACES = ${faces.ladder};`);
  const found = /export const WALL_FACES = [\d.]+;/.test(src) && /export const LADDER_FACES = [\d.]+;/.test(src);
  return found ? b : null;
}

// ---------- Окно после сожжения (ПБ-1, п. 6) ----------

/** Записать окно после сожжения в исходник `world/data/tuning.ts`: `BURN_IMMUNE = shieldTime(N * 24 * 60 * MIN)`. Не нашлось — `null`. */
export function withBurn(src: string, days: number): string | null {
  const re = /export const BURN_IMMUNE = shieldTime\(\d+ \* 24 \* 60 \* MIN\);/;
  return re.test(src) ? src.replace(re, `export const BURN_IMMUNE = shieldTime(${days} * 24 * 60 * MIN);`) : null;
}
