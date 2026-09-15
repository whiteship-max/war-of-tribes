// Ежедневная игра «Ключ и сундук»: рыцарь, лабиринт семь на семь, запертая дверь.
//
// Здесь только уровень и правила хождения по нему — ни React, ни DOM, ни
// состояния игры, ни часов. Всё выводится из одного числа, потому что задание
// дня одинаково у всех: сид приходит из `dailySeed(day)`, и сервер, получив то
// же число, обязан построить тот же лабиринт до последней стены.
//
// Единственный источник случайности — `seeded` (mulberry32). Кость партии `roll` из
// sim/random сюда не годится: она у каждой партии своя, да ещё её подменяют тесты, — и
// развалила бы главное обещание: «у всех сегодня один лабиринт».
import { seeded } from '../sim/random';

/** Сторона доски в клетках. Семь — столько, сколько влезает пальцем в 375 px. */
export const MAZE_N = 7;

/** Сколько секунд даётся на прохождение. */
export const MAZE_SECONDS = 30;

/**
 * Коридор длины оптимального решения, в ходах. Тап пальцем стоит примерно
 * 0.4 с, значит 14..22 хода — это 5.6..8.8 с чистого тапанья, а остальные
 * двадцать с лишним секунд остаются на то, чтобы прочитать доску и заплатить
 * за пару тупиков (тупик у Прима стоит 2..6 ходов). Ниже четырнадцати игра
 * перестаёт быть игрой, выше двадцати двух — не проходится пальцем за полминуты.
 */
export const MAZE_BEST_MIN = 14;
export const MAZE_BEST_MAX = 22;

/** К этой длине тянемся, когда ни одна попытка не попала в коридор. */
const MAZE_BEST_AIM = 18;

/**
 * Сколько подсидов перебираем, прежде чем взять лучшее из отбракованного.
 * Потолок обязателен: цикл «пока не понравится» — это зависание на неудачном
 * сиде, а зависание в ежедневке отнимает у игрока единственную попытку.
 */
const MAZE_TRIES = 64;

/** Шаг подсида — золотое сечение в 32 битах: соседние попытки расходятся сразу. */
const SUBSEED_STEP = 0x9e3779b1;

/**
 * Сколько клеток должно оказаться за дверью. Меньше восьми — дверь ничего не
 * запирает и сундук стоит на пороге; больше двадцати — за дверью полдоски, и
 * ключ искать негде.
 */
const BEHIND_MIN = 8;
const BEHIND_MAX = 20;

/** Ближе этого ключ у старта не кладём: иначе он подбирается по дороге даром. */
const KEY_MIN_DIST = 3;

const CELLS = MAZE_N * MAZE_N;

export interface Cell {
  x: number;
  y: number;
}

/**
 * Стены клетки — только верхняя и левая.
 *
 * Так рисует разметка: у каждой клетки сетки `border-top` и `border-left`, а
 * низ и правый край доски закрывает общая рамка. Общая стена двух соседей —
 * одно поле на двоих (стена между (x,y) и (x+1,y) — это `left` правого),
 * поэтому две половинки одной стены физически не могут разойтись.
 *
 * Верхний ряд всегда с `top`, левый столбец всегда с `left` — это внешняя
 * граница; её можно рисовать хоть клетками, хоть рамкой доски, результат один.
 */
export interface CellWalls {
  top: boolean;
  left: boolean;
}

/** Стены всей доски: `walls[y][x]`, строки сверху вниз. */
export type MazeWalls = CellWalls[][];

export interface MazeLevel {
  walls: MazeWalls;
  start: Cell;
  key: Cell;
  door: Cell;
  chest: Cell;
  /** Длина оптимального решения в ходах: старт → ключ → дверь → сундук. */
  best: number;
}

const idx = (c: Cell): number => c.y * MAZE_N + c.x;
const cellAt = (i: number): Cell => ({ x: i % MAZE_N, y: Math.floor(i / MAZE_N) });
const samePlace = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

/** Соседи по четырём сторонам, не глядя на стены. */
function around(c: Cell): Cell[] {
  const out: Cell[] = [];
  if (c.y > 0) out.push({ x: c.x, y: c.y - 1 });
  if (c.x > 0) out.push({ x: c.x - 1, y: c.y });
  if (c.x < MAZE_N - 1) out.push({ x: c.x + 1, y: c.y });
  if (c.y < MAZE_N - 1) out.push({ x: c.x, y: c.y + 1 });
  return out;
}

/** Стоит ли стена между двумя соседями. Не соседи — считается стеной. */
function walled(walls: MazeWalls, from: Cell, to: Cell): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return true;
  if (dx === 1) return walls[to.y][to.x].left;
  if (dx === -1) return walls[from.y][from.x].left;
  if (dy === 1) return walls[to.y][to.x].top;
  return walls[from.y][from.x].top;
}

/** Убрать стену между соседями. Поле одно на двоих, снимать с двух сторон нечего. */
function carve(walls: MazeWalls, from: Cell, to: Cell): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1) walls[to.y][to.x].left = false;
  else if (dx === -1) walls[from.y][from.x].left = false;
  else if (dy === 1) walls[to.y][to.x].top = false;
  else walls[from.y][from.x].top = false;
}

/**
 * Волна от клетки: расстояния в ходах, −1 — не дошли. `shut` помечает клетки,
 * в которые входить нельзя (дверь без ключа или чужая половина доски).
 */
function flood(walls: MazeWalls, from: number, shut: boolean[]): number[] {
  const dist = new Array<number>(CELLS).fill(-1);
  if (shut[from]) return dist;
  dist[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head];
    const c = cellAt(i);
    for (const n of around(c)) {
      const j = idx(n);
      if (shut[j] || dist[j] >= 0 || walled(walls, c, n)) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

const nothingShut = (): boolean[] => new Array<boolean>(CELLS).fill(false);

/**
 * Рандомизированный Прим: остовное дерево растёт пятном от стартовой клетки
 * через список фронтира, ребро берётся случайное.
 *
 * Не «поиск с возвратом»: тот растит одну длинную змею, и на доске семь на семь
 * решение регулярно уходит за тридцать ходов — пальцем за полминуты непроходимо.
 * Прим даёт короткие тупики и короткий путь. Случайные стены не годятся вовсе:
 * они не обещают ни связности, ни отсутствия пустых залов.
 */
function grow(rng: () => number): { walls: MazeWalls; start: Cell } {
  const walls: MazeWalls = [];
  for (let y = 0; y < MAZE_N; y += 1) {
    const row: CellWalls[] = [];
    for (let x = 0; x < MAZE_N; x += 1) row.push({ top: true, left: true });
    walls.push(row);
  }

  const start = cellAt(Math.floor(rng() * CELLS));
  const seen = new Array<boolean>(CELLS).fill(false);
  seen[idx(start)] = true;

  const front: Array<[number, number]> = [];
  const offer = (c: Cell): void => {
    for (const n of around(c)) if (!seen[idx(n)]) front.push([idx(c), idx(n)]);
  };
  offer(start);

  while (front.length) {
    const i = Math.floor(rng() * front.length);
    const [a, b] = front[i];
    front.splice(i, 1);
    if (seen[b]) continue;
    seen[b] = true;
    carve(walls, cellAt(a), cellAt(b));
    offer(cellAt(b));
  }

  return { walls, start };
}

/**
 * Можно ли шагнуть в соседнюю клетку: не за край, не сквозь стену, и в дверь
 * только с ключом. Ход по диагонали и «ход» на месте — не ходы.
 */
export function canStep(lv: MazeLevel, from: Cell, to: Cell, hasKey: boolean): boolean {
  if (to.x < 0 || to.y < 0 || to.x >= MAZE_N || to.y >= MAZE_N) return false;
  if (from.x < 0 || from.y < 0 || from.x >= MAZE_N || from.y >= MAZE_N) return false;
  if (walled(lv.walls, from, to)) return false;
  if (samePlace(to, lv.door) && !hasKey) return false;
  return true;
}

/**
 * Кратчайший остаток пути до сундука — по ходам, а не по клеткам поля: волна
 * идёт по 98 состояниям (49 клеток × есть ли ключ), потому что одна и та же
 * клетка до ключа и после ключа — это разные положения дел.
 *
 * Нужен он проигравшему по таймеру: показать, где он свернул не туда. Без
 * этого он завтра свернёт туда же. Пустой массив — пути нет.
 */
export function solveFrom(lv: MazeLevel, at: Cell, hasKey: boolean): Cell[] {
  const state = (i: number, key: boolean): number => i * 2 + (key ? 1 : 0);
  const from = idx(at);
  const startKey = hasKey || samePlace(at, lv.key);
  const first = state(from, startKey);

  const prev = new Array<number>(CELLS * 2).fill(-2);
  prev[first] = -1;
  const queue = [first];
  const chest = idx(lv.chest);

  for (let head = 0; head < queue.length; head += 1) {
    const st = queue[head];
    const i = st >> 1;
    if (i === chest) {
      // Разматываем назад: в ответе только ходы, самой клетки `at` в нём нет.
      const path: Cell[] = [];
      for (let cur = st; prev[cur] !== -1; cur = prev[cur]) path.push(cellAt(cur >> 1));
      return path.reverse();
    }
    const key = (st & 1) === 1;
    const c = cellAt(i);
    for (const n of around(c)) {
      if (!canStep(lv, c, n, key)) continue;
      const nextKey = key || samePlace(n, lv.key);
      const to = state(idx(n), nextKey);
      if (prev[to] !== -2) continue;
      prev[to] = st;
      queue.push(to);
    }
  }
  return [];
}

/**
 * Один лабиринт по подсиду — или `null`, если на этом дереве двери не нашлось.
 *
 * Ключ не может оказаться за дверью по построению, а не по проверке после:
 * сначала выбирается дверь, потом доска разваливается ею надвое, и ключ берётся
 * только из ближней половины, сундук — только из дальней. Проверять постфактум
 * значило бы ловить редкий случай тестом; здесь ловить нечего.
 */
function buildLevel(sub: number): MazeLevel | null {
  const rng = seeded(sub);
  const { walls, start } = grow(rng);
  const home = idx(start);

  interface Door {
    door: number;
    behind: number[];
    /** Расстояния от старта при запертой двери: −1 — это и есть «за дверью». */
    dist: number[];
  }

  const loose: Door[] = [];
  const strict: Door[] = [];
  for (let d = 0; d < CELLS; d += 1) {
    if (d === home) continue;
    const shut = nothingShut();
    shut[d] = true;
    const dist = flood(walls, home, shut);
    const behind: number[] = [];
    for (let i = 0; i < CELLS; i += 1) if (i !== d && dist[i] < 0) behind.push(i);
    // Нужен и запертый кусок, и место под ключ в незапертом.
    if (!behind.length || CELLS - 1 - behind.length < 2) continue;
    const cand: Door = { door: d, behind, dist };
    loose.push(cand);
    if (behind.length >= BEHIND_MIN && behind.length <= BEHIND_MAX) strict.push(cand);
  }

  // Дверь — это разрезающая клетка дерева, то есть любая не-лист. В дереве из
  // 49 клеток со степенью не выше четырёх листьев не больше 33, так что не-листов
  // всегда за десяток и `loose` пуст не бывает. Проверка стоит на случай, если
  // генерацию когда-нибудь заменят на другую.
  const pool = strict.length ? strict : loose;
  if (!pool.length) return null;
  const cand = pool[Math.floor(rng() * pool.length)];

  // Ключ — из ближней половины и подальше от старта: лежащий под ногами он не
  // добавляет ни хода, ни решения.
  const near: number[] = [];
  const far: number[] = [];
  for (let i = 0; i < CELLS; i += 1) {
    if (i === home || cand.dist[i] < 0) continue;
    near.push(i);
    if (cand.dist[i] >= KEY_MIN_DIST) far.push(i);
  }
  const keyPool = far.length ? far : near;
  if (!keyPool.length) return null;
  const key = keyPool[Math.floor(rng() * keyPool.length)];

  // Сундук — самая дальняя от двери клетка запертой половины: за дверью должен
  // быть путь, а не порог с наградой.
  const beyond = new Array<boolean>(CELLS).fill(true);
  for (const i of cand.behind) beyond[i] = false;
  beyond[cand.door] = false;
  const deep = flood(walls, cand.door, beyond);
  let chest = -1;
  for (const i of cand.behind) if (chest < 0 || deep[i] > deep[chest]) chest = i;
  if (chest < 0) return null;

  const lv: MazeLevel = {
    walls,
    start,
    key: cellAt(key),
    door: cellAt(cand.door),
    chest: cellAt(chest),
    best: 0,
  };
  const path = solveFrom(lv, start, false);
  if (!path.length) return null;
  lv.best = path.length;
  return lv;
}

/**
 * Запасной уровень на случай, который не должен случиться никогда: у Прима
 * дверь находится всегда (см. рассуждение в `buildLevel`). Но функция обязана
 * что-то вернуть, и «что-то» лучше собрать руками, чем гадать сидом.
 *
 * Устроен он проще некуда: пустой зал, разрезанный сплошной стеной, и один
 * проход в ней — клетка двери. Решение — ровно восемнадцать ходов, середина
 * коридора.
 */
function hallLevel(): MazeLevel {
  const walls: MazeWalls = [];
  for (let y = 0; y < MAZE_N; y += 1) {
    const row: CellWalls[] = [];
    for (let x = 0; x < MAZE_N; x += 1) row.push({ top: y === 0, left: x === 0 || x === 4 });
    walls.push(row);
  }
  walls[3][4].left = false; // единственный проход, он же дверь

  const lv: MazeLevel = {
    walls,
    start: { x: 0, y: 0 },
    key: { x: 0, y: 6 },
    door: { x: 4, y: 3 },
    chest: { x: 6, y: 6 },
    best: 0,
  };
  lv.best = solveFrom(lv, lv.start, false).length;
  return lv;
}

/**
 * Лабиринт дня. Подсиды перебираются, пока решение не ляжет в коридор 14..22;
 * не легло ни разу за `MAZE_TRIES` попыток — берём ближайшую к середине
 * коридора. Отбраковка без потолка была бы зависанием, отбраковка без запасного
 * варианта — пустым экраном.
 */
export function mazeLevel(seed: number): MazeLevel {
  let closest: MazeLevel | null = null;
  for (let i = 0; i < MAZE_TRIES; i += 1) {
    const lv = buildLevel((seed + i * SUBSEED_STEP) >>> 0);
    if (!lv) continue;
    if (lv.best >= MAZE_BEST_MIN && lv.best <= MAZE_BEST_MAX) return lv;
    if (!closest || Math.abs(lv.best - MAZE_BEST_AIM) < Math.abs(closest.best - MAZE_BEST_AIM)) {
      closest = lv;
    }
  }
  return closest ?? hallLevel();
}
