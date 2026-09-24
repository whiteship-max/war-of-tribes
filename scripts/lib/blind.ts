/**
 * Слепота быстрой приёмки: исполнила ли она хоть раз код, который правка тронула.
 *
 * Быстрая приёмка (`lib/quick.ts`) гоняет те же строки отчёта на меньшем числе миров и боёв. Её вывод
 * детерминирован, и правка, изменившая хоть один её прогон, видна сдвигом буквы. Пропустить она может
 * ровно одно — правку кода, который на её мирах и боях **не исполнился ни разу**: её вывод такая правка не
 * тронет, а полный, где тот код исполняется, — может. Отсюда правило, и оно выводится из замера, а не из
 * догадки: прогон пишет покрытие V8 (блоками, вместе с дочерними процессами веера), и каждая тронутая
 * строка обязана быть исполненной целиком — иначе быстрая говорит «слепа» и называет строку.
 *
 * ЧТО СЧИТАЕТСЯ ТРОНУТЫМ:
 *   — строка в теле функции — она сама: исполнилась ли она целиком (у `a ? b : c` — и обе ветки);
 *   — строка на верхнем уровне модуля (число, таблица, объявление функции) исполняется при загрузке всегда,
 *     и её правка действует там, где читают объявленное: тронутыми становятся все строки кода, где встречается
 *     объявленное имя (и имя ключа таблицы, если строка — ключ таблицы). Имя вида `level` встречается везде, и
 *     правка такой таблицы почти всегда слепа — это правильно: правка чисел игры и так ведёт к полной приёмке;
 *   — удалённые и заменённые строки базы — тем же правилом по покрытию быстрого прогона базы;
 *   — файл не кода, тронутый правкой, — слепота: покрытие о нём не говорит ничего.
 *
 * ЧЕГО ЭТО НЕ ЛОВИТ — правку, чья строка исполнилась, но на других данных: порог `pop > 500 → 520`, когда на
 * мирах быстрой жителей не бывает между 500 и 520, а на мирах полной — бывает. Это и проверяется прогоном
 * на настоящих прошлых сдвигах (docs/realm.md, раздел 8).
 *
 * Модуль не знает ни vite, ни git: перевод исходника (`transform`) и изменённые строки ему подаёт приёмка.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Покрытие одного прогона: по файлу — строки кода, исполненные не целиком (с единицы). */
export interface Seen {
  /** Файлы, которые прогон загрузил и чьё покрытие удалось сопоставить с исходником. */
  files: Record<string, number[]>;
  /** Файлы, которые прогон загрузил, но сопоставить не удалось: о них быстрая не знает ничего. */
  unknown: string[];
}

// ---------- Карта исходника ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_OF = new Map([...B64].map((c, i) => [c, i]));

/** Отрезки карты: [строка кода, столбец кода, строка исходника] (с нуля). Только отрезки с исходником. */
export function mappings(map: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  let srcLine = 0;
  let srcCol = 0;
  let src = 0;
  let name = 0;
  map.split(';').forEach((line, genLine) => {
    let genCol = 0;
    for (const seg of line.split(',')) {
      if (!seg) continue;
      const v: number[] = [];
      let shift = 0;
      let acc = 0;
      for (const c of seg) {
        const d = B64_OF.get(c);
        if (d === undefined) throw new Error(`карта: знак «${c}»`);
        acc += (d & 31) << shift;
        if (d & 32) shift += 5;
        else {
          v.push(acc & 1 ? -(acc >>> 1) : acc >>> 1);
          acc = 0;
          shift = 0;
        }
      }
      genCol += v[0];
      if (v.length >= 4) {
        src += v[1];
        srcLine += v[2];
        srcCol += v[3];
        if (v.length >= 5) name += v[4];
        out.push([genLine, genCol, srcLine]);
      }
    }
  });
  void src;
  void srcCol;
  void name;
  return out;
}

/** Встроенная карта из переведённого кода (`sourceMappingURL=data:…base64,…`). */
export function inlineMap(code: string): string | null {
  const m = /\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/.exec(code);
  if (!m) return null;
  const json = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) as { mappings: string };
  return json.mappings;
}

// ---------- Покрытие ----------

interface Range {
  startOffset: number;
  endOffset: number;
  count: number;
}
interface Script {
  url: string;
  functions: { ranges: Range[] }[];
}

/**
 * Прибавить к счёту строк одного файла покрытие одного процесса. `code` — переведённый исходник, который
 * процесс выполнил; `lines` — по строке исходника: у скольких её отрезков счёт ноль, у скольких — нет.
 * Скрипт vite-node — это код модуля, обёрнутый в функцию: длина обёртки — разница длин.
 */
function paint(code: string, script: Script, marks: Map<number, { ran: boolean[] }>, maps: [number, number, number][]): boolean {
  const whole = script.functions[0]?.ranges[0];
  if (!whole) return false;
  // Обёртка vite-node: `…=>{{` спереди и `\n}}` сзади (vite-node/client, runModule).
  const prefix = whole.endOffset - code.length - 3;
  if (prefix < 0 || prefix > 400) return false;
  const counts = new Int32Array(whole.endOffset + 1);
  const all: Range[] = script.functions.flatMap((f) => f.ranges);
  all.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of all) counts.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1);
  maps.forEach(([gl, gc, sl], i) => {
    const at = prefix + (starts[gl] ?? Infinity) + gc;
    if (!(at < counts.length)) return;
    let m = marks.get(sl);
    if (!m) {
      m = { ran: [] };
      marks.set(sl, m);
    }
    m.ran[i] = m.ran[i] || counts[at] > 0;
  });
  return true;
}

/**
 * Покрытие прогона из папки `NODE_V8_COVERAGE`: по каждому файлу `wanted`, который прогон загрузил, — строки
 * кода, исполненные не целиком. Процессов может быть много (отчёт и его веер): отрезок исполнен, если исполнен
 * хоть в одном. `transform` — переведённый vite код файла (тот же, что выполнял прогон) или `null`.
 */
export async function collect(dir: string, root: string, wanted: ReadonlySet<string>, transform: (file: string) => Promise<string | null>): Promise<Seen> {
  const scripts = new Map<string, Script[]>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let json: { result: Script[] };
    try {
      json = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    for (const s of json.result) {
      if (!s.url.startsWith('file:')) continue;
      let rel: string;
      try {
        rel = path.relative(root, fileURLToPath(s.url)).split(path.sep).join('/');
      } catch {
        continue;
      }
      if (!wanted.has(rel)) continue;
      scripts.set(rel, [...(scripts.get(rel) ?? []), s]);
    }
  }
  const seen: Seen = { files: {}, unknown: [] };
  for (const [rel, list] of [...scripts].sort()) {
    const code = await transform(rel);
    const raw = code === null ? null : inlineMap(code);
    if (code === null || raw === null) {
      seen.unknown.push(rel);
      continue;
    }
    const maps = mappings(raw);
    const marks = new Map<number, { ran: boolean[] }>();
    let ok = false;
    for (const s of list) ok = paint(code, s, marks, maps) || ok;
    if (!ok) {
      seen.unknown.push(rel);
      continue;
    }
    const dark: number[] = [];
    for (const [sl, m] of marks) if (m.ran.some((x) => x === false)) dark.push(sl + 1);
    seen.files[rel] = dark.sort((a, b) => a - b);
  }
  return seen;
}

// ---------- Тронутые строки ----------

/** Правка одного файла: строки базы (удалённые и заменённые) и строки нынешнего дерева (новые и заменённые). */
export interface Touch {
  file: string;
  was: number[];
  now: number[];
}

/** Разбор `git diff -U0`: по файлу — тронутые строки с обеих сторон. */
export function touches(diff: string): Touch[] {
  const out: Touch[] = [];
  let cur: Touch | null = null;
  for (const line of diff.split('\n')) {
    const f = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (f) {
      cur = { file: f[2], was: [], now: [] };
      out.push(cur);
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && cur) {
      const [a, b, c, d] = [Number(h[1]), h[2] === undefined ? 1 : Number(h[2]), Number(h[3]), h[4] === undefined ? 1 : Number(h[4])];
      for (let i = 0; i < b; i++) cur.was.push(a + i);
      for (let i = 0; i < d; i++) cur.now.push(c + i);
      // Чистая вставка: место вставки — строка базы перед ней; чистое удаление — строка дерева перед ним.
      if (b === 0 && a > 0) cur.was.push(a);
      if (d === 0 && c > 0) cur.now.push(c);
    }
  }
  return out;
}

const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;

const isFunction = (n: ts.Node): boolean =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n);

/**
 * Имена, которые объявляет строка верхнего уровня: имя объявления и ключи таблицы на этой строке. Строка в
 * теле функции — пусто: её правку видно по ней самой.
 */
export function namesAt(text: string, file: string, line: number): { inFunction: boolean; names: string[] } {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const starts = src.getLineStarts();
  const from = starts[line - 1] ?? text.length;
  const to = starts[line] ?? text.length;
  const names = new Set<string>();
  let inFunction = false;
  let touched = false;
  const visit = (n: ts.Node, fn: boolean): void => {
    const s = n.getStart(src);
    if (n.getEnd() <= from || s >= to) return;
    touched = true;
    // Тело функции начинается после `{`: строка шапки функции — не внутри неё.
    const inside = fn || (isFunction(n) && !!(n as ts.FunctionLikeDeclaration).body && (n as ts.FunctionLikeDeclaration).body!.getStart(src) < from);
    if (inside && !ts.isSourceFile(n)) inFunction = true;
    if (!inside) {
      if ((ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isEnumDeclaration(n)) && n.name && ts.isIdentifier(n.name)) {
        if (n.getStart(src) < to) names.add(n.name.text);
      }
      if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && s >= from && s < to && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
        names.add(n.name.text);
      }
    }
    ts.forEachChild(n, (c) => visit(c, inside));
  };
  ts.forEachChild(src, (c) => visit(c, false));
  // Строка, у которой нет ни одного узла (пустая, комментарий), ничего не объявляет и не исполняется.
  if (!touched) return { inFunction: false, names: [] };
  // Объявление внутри функции — её локальная переменная: читают её строки той же функции.
  return { inFunction, names: inFunction ? [] : [...names] };
}

export interface Blind {
  /** Что именно не исполнилось: `файл:строка` и почему. */
  spots: string[];
}

/**
 * Слепа ли быстрая к правке. `now` и `was` — покрытие быстрого прогона дерева и базы (`null` — базу быстрой
 * не гоняли: тогда о строках базы быстрая не знает ничего), `read(side, file)` — текст файла, `closure` —
 * файлы отчёта.
 */
export function blindTo(
  list: Touch[],
  closure: ReadonlySet<string>,
  now: Seen,
  was: Seen | null,
  read: (side: 'now' | 'was', file: string) => string | null,
): Blind {
  const spots: string[] = [];
  const dark = (seen: Seen, file: string, line: number): boolean | null => {
    if (seen.unknown.includes(file)) return null;
    const lines = seen.files[file];
    if (!lines) return false; // не загружен — не исполняется ни в быстрой, ни в полной: загрузка модулей одна
    return lines.includes(line);
  };
  const readers = (side: 'now' | 'was', seen: Seen, name: string): string[] => {
    const out: string[] = [];
    const re = new RegExp(`(?<![\\w$])${name.replace(/[$]/g, '\\$')}(?![\\w$])`);
    for (const f of closure) {
      if (!CODE.test(f)) continue;
      const lines = seen.files[f];
      if (!lines || lines.length === 0) continue;
      const text = read(side, f);
      if (text === null) continue;
      const all = text.split('\n');
      for (const l of lines) if (re.test(all[l - 1] ?? '')) out.push(`${f}:${l}`);
    }
    return out;
  };
  for (const t of list) {
    if (!closure.has(t.file)) continue;
    if (!CODE.test(t.file)) {
      spots.push(`${t.file} — не код: покрытие о нём не говорит`);
      continue;
    }
    for (const [side, seen, lines] of [
      ['now', now, t.now],
      ['was', was, t.was],
    ] as const) {
      if (lines.length === 0) continue;
      if (seen === null) {
        spots.push(`${t.file} — строки базы ${lines.slice(0, 3).join(', ')}: покрытия быстрой на базе нет`);
        continue;
      }
      const text = read(side, t.file);
      if (text === null) continue;
      for (const line of lines) {
        const d = dark(seen, t.file, line);
        const where = `${side === 'was' ? 'база ' : ''}${t.file}:${line}`;
        if (d === null) {
          spots.push(`${where} — покрытие файла не сопоставилось`);
          break;
        }
        if (d) {
          spots.push(`${where} — не исполнилась целиком`);
          continue;
        }
        const { names } = namesAt(text, t.file, line);
        for (const name of names) {
          const r = readers(side, seen, name);
          if (r.length > 0) spots.push(`${where} — «${name}» читают строки, не исполненные целиком: ${r.slice(0, 3).join(', ')}${r.length > 3 ? ` и ещё ${r.length - 3}` : ''}`);
        }
      }
    }
  }
  return { spots: [...new Set(spots)] };
}
