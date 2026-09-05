// Лабиринт дня проверяется не глазами, а годом сидов подряд: задание одинаково
// у всех, и попытка одна — уровень, который сегодня не проходится, отнимает её
// у каждого игрока разом.
//
// Связность, «ключ не за дверью» и достижимость сундука проверяются своей
// волной по стенам, а не функциями генератора: ошибка в самой конструкции
// иначе подтвердила бы сама себя.
import { describe, expect, it } from 'vitest';
import {
  MAZE_BEST_MAX,
  MAZE_BEST_MIN,
  MAZE_N,
  MAZE_SECONDS,
  canStep,
  mazeLevel,
  solveFrom,
  type Cell,
  type MazeLevel,
} from './maze';

/** Год сидов подряд: столько дней ежедневка проживёт без единого просмотра. */
const SEEDS = 365;

/** Сколько секунд стоит один тап пальцем на 375 px. */
const TAP_SECONDS = 0.4;

const at = (c: Cell): number => c.y * MAZE_N + c.x;
const samePlace = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

/** Соседи по четырём сторонам — независимо от того, как их считает генератор. */
function around(c: Cell): Cell[] {
  const out: Cell[] = [];
  if (c.y > 0) out.push({ x: c.x, y: c.y - 1 });
  if (c.x > 0) out.push({ x: c.x - 1, y: c.y });
  if (c.x < MAZE_N - 1) out.push({ x: c.x + 1, y: c.y });
  if (c.y < MAZE_N - 1) out.push({ x: c.x, y: c.y + 1 });
  return out;
}

/** Стена между соседями, прочитанная прямо из разметки: верх и лево клетки. */
function walled(lv: MazeLevel, from: Cell, to: Cell): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1) return lv.walls[to.y][to.x].left;
  if (dx === -1) return lv.walls[from.y][from.x].left;
  if (dy === 1) return lv.walls[to.y][to.x].top;
  return lv.walls[from.y][from.x].top;
}

/** Куда дойдёт волна от клетки; `shutDoor` — дверь заперта, ключа нет. */
function reach(lv: MazeLevel, from: Cell, shutDoor: boolean): Set<number> {
  const seen = new Set<number>([at(from)]);
  const queue: Cell[] = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const c = queue[head];
    for (const n of around(c)) {
      if (seen.has(at(n))) continue;
      if (walled(lv, c, n)) continue;
      if (shutDoor && samePlace(n, lv.door)) continue;
      seen.add(at(n));
      queue.push(n);
    }
  }
  return seen;
}

const levels: MazeLevel[] = [];
for (let seed = 1; seed <= SEEDS; seed += 1) levels.push(mazeLevel(seed));

/** Уровни, где отбраковка не нашла ничего в коридоре и взяла ближайшее. */
const fallbacks = levels.filter((lv) => lv.best < MAZE_BEST_MIN || lv.best > MAZE_BEST_MAX);

describe('лабиринт дня: доска', () => {
  it('сетка ровно семь на семь', () => {
    for (const lv of levels) {
      expect(lv.walls.length).toBe(MAZE_N);
      for (const row of lv.walls) expect(row.length).toBe(MAZE_N);
    }
  });

  it('внешняя граница на месте: верхний ряд и левый столбец закрыты', () => {
    for (const lv of levels) {
      for (let i = 0; i < MAZE_N; i += 1) {
        expect(lv.walls[0][i].top).toBe(true);
        expect(lv.walls[i][0].left).toBe(true);
      }
    }
  });

  it('все клетки достижимы, если не считать двери: пустырей и отрезанных углов нет', () => {
    for (const lv of levels) {
      expect(reach(lv, lv.start, false).size).toBe(MAZE_N * MAZE_N);
    }
  });

  it('старт, ключ, дверь и сундук — четыре разные клетки', () => {
    for (const lv of levels) {
      const four = new Set([at(lv.start), at(lv.key), at(lv.door), at(lv.chest)]);
      expect(four.size).toBe(4);
    }
  });
});

describe('лабиринт дня: ключ не заперт за дверью', () => {
  it('ключ достижим без ключа, а сундук — нет: дверь обязательна, ключ свободен', () => {
    for (const lv of levels) {
      const free = reach(lv, lv.start, true);
      expect(free.has(at(lv.key))).toBe(true);
      expect(free.has(at(lv.chest))).toBe(false);
      expect(free.has(at(lv.door))).toBe(false);
    }
  });

  it('за дверью лежит кусок доски, а не порог: сундук не вплотную к ней', () => {
    for (const lv of levels) {
      const whole = reach(lv, lv.start, false);
      const behind = whole.size - reach(lv, lv.start, true).size - 1;
      expect(behind).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('лабиринт дня: длина решения', () => {
  it('решение лежит в коридоре 14..22 хода', () => {
    for (const lv of levels) {
      if (fallbacks.includes(lv)) continue;
      expect(lv.best).toBeGreaterThanOrEqual(MAZE_BEST_MIN);
      expect(lv.best).toBeLessThanOrEqual(MAZE_BEST_MAX);
    }
  });

  it('запасной вариант — редкость, и он всё равно проходим', () => {
    // Отбраковка перебирает 64 подсида; если ближайшее берётся часто, значит
    // разошлись коридор и то, что умеет строить генератор.
    expect(fallbacks.length).toBeLessThanOrEqual(Math.round(SEEDS * 0.05));
    for (const lv of fallbacks) {
      expect(lv.best).toBeGreaterThan(0);
      expect(Number.isFinite(lv.best)).toBe(true);
      expect(solveFrom(lv, lv.start, false).length).toBe(lv.best);
    }
  });

  it('полминуты хватает на решение с запасом на чтение доски и тупики', () => {
    // Неравенство стоит здесь, чтобы MAZE_SECONDS нельзя было тихо уронить:
    // тапанье не должно занимать больше трети срока.
    for (const lv of levels) {
      expect(lv.best * TAP_SECONDS).toBeLessThanOrEqual(MAZE_SECONDS / 3);
    }
    expect(MAZE_BEST_MAX * TAP_SECONDS).toBeLessThanOrEqual(MAZE_SECONDS / 3);
    expect(MAZE_SECONDS - MAZE_BEST_MAX * TAP_SECONDS).toBeGreaterThanOrEqual(20);
  });
});

describe('лабиринт дня: подсказка пути', () => {
  it('путь из старта — ровно оптимальный, законный по ходам и кончается сундуком', () => {
    for (const lv of levels) {
      const path = solveFrom(lv, lv.start, false);
      expect(path.length).toBe(lv.best);

      let from = lv.start;
      let hasKey = false;
      for (const step of path) {
        expect(canStep(lv, from, step, hasKey)).toBe(true);
        if (samePlace(step, lv.key)) hasKey = true;
        from = step;
      }
      expect(hasKey).toBe(true); // без ключа дверь не пройти, значит он подобран
      expect(samePlace(from, lv.chest)).toBe(true);
    }
  });

  it('из середины пути остаток короче, чем из старта, ровно на пройденное', () => {
    for (const lv of levels) {
      const path = solveFrom(lv, lv.start, false);
      const k = Math.floor(path.length / 2);
      let hasKey = false;
      for (let i = 0; i <= k; i += 1) if (samePlace(path[i], lv.key)) hasKey = true;
      const rest = solveFrom(lv, path[k], hasKey);
      expect(rest.length).toBe(lv.best - (k + 1));
      expect(rest.length).toBeLessThan(lv.best);
    }
  });
});

describe('лабиринт дня: правила хода', () => {
  it('сквозь стену, за край и по диагонали не ходят', () => {
    for (const lv of levels) {
      // За край доски.
      expect(canStep(lv, { x: 0, y: 0 }, { x: -1, y: 0 }, true)).toBe(false);
      expect(canStep(lv, { x: 6, y: 6 }, { x: 7, y: 6 }, true)).toBe(false);
      // По диагонали и на месте.
      expect(canStep(lv, { x: 3, y: 3 }, { x: 4, y: 4 }, true)).toBe(false);
      expect(canStep(lv, { x: 3, y: 3 }, { x: 3, y: 3 }, true)).toBe(false);
      // Каждая стена доски непроходима, каждый проход проходим.
      for (let y = 0; y < MAZE_N; y += 1) {
        for (let x = 0; x < MAZE_N; x += 1) {
          const c = { x, y };
          for (const n of around(c)) {
            const allowed = canStep(lv, c, n, true);
            expect(allowed).toBe(!walled(lv, c, n));
          }
        }
      }
    }
  });

  it('в дверь пускают только с ключом', () => {
    for (const lv of levels) {
      for (const n of around(lv.door)) {
        if (walled(lv, n, lv.door)) continue;
        expect(canStep(lv, n, lv.door, false)).toBe(false);
        expect(canStep(lv, n, lv.door, true)).toBe(true);
      }
    }
  });
});

describe('лабиринт дня: сид', () => {
  it('один сид — один и тот же лабиринт до последней стены', () => {
    for (const seed of [1, 7, 42, 1000, 123456]) {
      expect(JSON.stringify(mazeLevel(seed))).toBe(JSON.stringify(mazeLevel(seed)));
    }
  });

  it('разные сиды — разные лабиринты: год не повторяется', () => {
    const seen = new Set(levels.map((lv) => JSON.stringify(lv)));
    // Совпадения допустимы (уровней конечное число), но год не должен ходить по кругу.
    expect(seen.size).toBeGreaterThanOrEqual(SEEDS - 3);
  });
});
