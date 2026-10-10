// Места появления на Сицилии (docs/test_world.md): двадцать пять мест — данные, выведенные из атласа; все на суше острова,
// все в одном регионе, одной кучкой узлов шестиугольной решётки — равномерно, ближе прежних 8–10 клеток и так, что из
// любого места кольцо обзора острова видит все остальные. За ними — цепочка мест на материке, от пролива вдоль западного
// берега до Флоренции, и места острова от неё не сдвинулись.
import { describe, expect, it } from 'vitest';
import { landmasses, settleable } from './land';
import { HOME_SIGHT, SETTLE_GAP } from './data/tuning';
import { theatreAt } from './theatre/theatre';
import { homeSight } from './sight';
import {
  COAST_REACH,
  MAINLAND,
  SICILY,
  SICILY_COUNT,
  SICILY_SIGHT,
  SICILY_STEP,
  SICILY_THEATRE,
  SPAWNS,
  coastPath,
  deriveMainland,
  deriveSicily,
  inSicilyTheatre,
  islandNeighbours,
  mainlandFit,
  sicilyAt,
  sicilyFit,
  sicilyLand,
  sicilyPatches,
  sicilySlot,
  spawnModeOf,
  spawnSlot,
} from './spawn';

type P = { x: number; y: number };
const dist = (a: P, b: P): number => Math.hypot(a.x - b.x, a.y - b.y);
/** Ближний сосед каждого места. */
const nearest = (spots: readonly P[]): number[] =>
  spots.map((s, i) => Math.min(...spots.filter((_, j) => j !== i).map((t) => dist(s, t))));
/** Самая дальняя пара. */
const across = (spots: readonly P[]): number => Math.max(...spots.flatMap((s) => spots.map((t) => dist(s, t))));
/** Диагональ ряда решётки на целых клетках: полшага вбок и ряд вниз. */
const DIAGONAL = Math.hypot(Math.floor(SICILY_STEP / 2), Math.round((SICILY_STEP * Math.sqrt(3)) / 2));

describe('места появления: Сицилия', () => {
  it('запечённый список — ровно вывод из атласа (детерминированно)', () => {
    // Поправил вывод или атлас и не пересобрал список — красное здесь, а не тихо другие места у сервера.
    expect(deriveSicily()).toEqual([...SICILY]);
  });

  it('остров размечен целиком и без материка: сотни клеток, все западнее Мессинского пролива', () => {
    const land = sicilyLand();
    // Граница области: разлив обязан остановиться на острове. Сицилия в атласе — 664 клетки (~25 тыс. км²);
    // уйди он через пролив — клеток были бы сотни тысяч, и правило «весь остров в одном регионе» проверялось бы
    // на материке.
    expect(land.length).toBe(664);
    expect(Math.max(...land.map((p) => p.x))).toBeLessThan(784);
  });

  it('весь остров — один регион, и это регион острова: на острове воюют друг с другом', () => {
    const ids = new Set(sicilyLand().map((p) => theatreAt(p.x, p.y)?.id ?? null));
    expect([...ids]).toEqual([SICILY_THEATRE]);
  });

  it('двадцать пять мест: разные, на суше острова, годные под город, в регионе острова', () => {
    expect(SICILY.length).toBe(SICILY_COUNT);
    const land = new Set(sicilyLand().map((p) => `${p.x}|${p.y}`));
    const keys = new Set(SICILY.map((s) => `${s.x}|${s.y}`));
    expect(keys.size).toBe(SICILY_COUNT);
    for (const s of SICILY) {
      expect([s, land.has(`${s.x}|${s.y}`)]).toEqual([s, true]);
      expect([s, settleable(s.x, s.y), sicilyFit(s)]).toEqual([s, true, true]);
      expect([s, inSicilyTheatre(s)]).toEqual([s, true]);
      // Мир клиента строит дом на любой клетке, которую назвал реестр; но материк — условие обычного расселения, и
      // остров с ним связан: город на нём не «скала посреди моря».
      expect(landmasses().at(s.x, s.y)).toBe(landmasses().at(SICILY[0].x, SICILY[0].y));
    }
  });

  it('равномерно: у каждого места ближний сосед — в шаге решётки или по диагонали ряда, ближе никого', () => {
    const near = nearest(SICILY);
    for (const [i, d] of near.entries()) {
      expect([SICILY[i], d >= DIAGONAL - 1e-9 && d <= SICILY_STEP]).toEqual([SICILY[i], true]);
    }
    // Ближе прежних мест (8,1–10 клеток по острову), и ослабленная граница — только для этих мест.
    expect(Math.max(...near)).toBeLessThan(8);
    expect(SICILY_STEP).toBeLessThan(SETTLE_GAP);
  });

  it('выдача от середины к краю: каждое следующее место не ближе к середине кучки, первые три — соседи', () => {
    const n = SICILY.length;
    const cx = SICILY.reduce((v, s) => v + s.x, 0) / n;
    const cy = SICILY.reduce((v, s) => v + s.y, 0) / n;
    const far = SICILY.map((s) => Math.hypot(s.x - cx, s.y - cy));
    for (let i = 1; i < n; i++) expect([i, far[i] >= far[i - 1]]).toEqual([i, true]);
    // Первые пришедшие — ближе друг к другу, чем кто угодно из последних.
    const first = SICILY.slice(0, 3);
    expect(across(first)).toBeLessThanOrEqual(SICILY_STEP);
    expect(across(first)).toBeLessThan(across(SICILY.slice(-3)));
  });

  it('шаг — наибольший, при котором двадцать пять встают на годную сушу острова одной кучкой', () => {
    expect(sicilyAt(SICILY_STEP)).not.toBeNull();
    expect(sicilyAt(SICILY_STEP + 1)).toBeNull();
  });

  it('кучка решётки: двадцать пять разных узлов, соседи — в шаге или по диагонали, поперечник — около четырёх с половиной шагов', () => {
    const patches = sicilyPatches(SICILY_STEP);
    expect(patches.length).toBe(4);
    for (const patch of patches) {
      expect(new Set(patch.map((p) => `${p.x}|${p.y}`)).size).toBe(SICILY_COUNT);
      for (const d of nearest(patch)) expect(d >= DIAGONAL - 1e-9 && d <= SICILY_STEP).toBe(true);
      expect(across(patch)).toBeGreaterThan(4 * SICILY_STEP);
      expect(across(patch)).toBeLessThan(5 * SICILY_STEP);
    }
  });

  it('одна часть острова: из любого места кольцо обзора острова видит все двадцать четыре — и кольцо не больше нужного', () => {
    for (const s of SICILY) {
      const seen = SICILY.filter((t) => t !== s && dist(s, t) <= SICILY_SIGHT);
      expect([s, seen.length]).toEqual([s, SICILY_COUNT - 1]);
    }
    // Кольцо — поперечник кучки, округлённый вверх: на клетку меньше — крайняя пара друг друга не видит.
    expect(SICILY_SIGHT).toBe(Math.ceil(across(SICILY)));
    expect(across(SICILY)).toBeGreaterThan(SICILY_SIGHT - 1);
    // «Чуть больше» обычного: обычное кольцо крайней пары не видит — без нового радиуса видно было бы не всех.
    expect(SICILY_SIGHT).toBeGreaterThan(HOME_SIGHT);
    expect(across(SICILY)).toBeGreaterThan(HOME_SIGHT);
  });

  it('кольцо острова — только у города на месте острова; любой другой город — обычное кольцо', () => {
    for (const s of SICILY) expect(homeSight(s)).toBe(SICILY_SIGHT);
    // Соседние клетки мест — не места: там стоял бы город обычного расселения.
    for (const s of SICILY) expect(homeSight({ x: s.x + 1, y: s.y })).toBe(HOME_SIGHT);
    expect(homeSight({ x: 541, y: 822 })).toBe(HOME_SIGHT);
  });

  it('чужие места острова: у места — остальные двадцать четыре, не у места — никого', () => {
    for (const s of SICILY) {
      const others = islandNeighbours(s);
      expect(others.length).toBe(SICILY_COUNT - 1);
      expect(others.some((o) => o.x === s.x && o.y === s.y)).toBe(false);
    }
    expect(islandNeighbours({ x: SICILY[0].x + 1, y: SICILY[0].y })).toEqual([]);
  });

  it('номер места — по порядку списка, не место — 0', () => {
    expect(sicilySlot(SICILY[0])).toBe(1);
    expect(sicilySlot(SICILY[24])).toBe(25);
    expect(sicilySlot({ x: SICILY[0].x + 1, y: SICILY[0].y })).toBe(0);
  });

  it('режим — только sicily; пусто и прочее — обычное расселение', () => {
    expect(spawnModeOf('sicily')).toBe('sicily');
    expect(spawnModeOf(' Sicily ')).toBe('sicily');
    expect(spawnModeOf(undefined)).toBeNull();
    expect(spawnModeOf('')).toBeNull();
    expect(spawnModeOf('malta')).toBeNull();
  });
});

/** Где на пути вдоль берега лежит клетка: расстояние до пути и длина пути до ближней его точки. */
function onPath(path: readonly P[], p: P): { off: number; along: number } {
  let off = Infinity;
  let along = 0;
  let walked = 0;
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k];
    const b = path[k + 1];
    const len = dist(a, b);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)));
    const d = dist(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (d < off) {
      off = d;
      along = walked + t * len;
    }
    walked += len;
  }
  return { off, along };
}

describe('места появления: материк после острова', () => {
  it('запечённый список — ровно вывод из атласа (детерминированно)', () => {
    expect(deriveMainland()).toEqual([...MAINLAND]);
  });

  it('места острова не сдвинулись: номера 1..25 — те же клетки, что заняты на сервере', () => {
    // Слепок списка на 11.10.2026, до материка: на этих клетках уже стоят игроки. Пересобрал остров — красное здесь.
    const before =
      '765|1340 768|1338 768|1342 771|1340 765|1336 765|1344 762|1338 762|1342 771|1336 771|1344 768|1334 768|1346 774|1338 ' +
      '774|1342 762|1334 762|1346 759|1340 765|1332 765|1348 759|1336 759|1344 771|1332 771|1348 774|1334 774|1346';
    expect(SICILY.map((s) => `${s.x}|${s.y}`).join(' ')).toBe(before);
    expect(SPAWNS.slice(0, SICILY_COUNT)).toEqual([...SICILY]);
    SICILY.forEach((s, i) => expect(spawnSlot(s)).toBe(i + 1));
  });

  it('не меньше тридцати мест, все разные, на годной суше материка, в регионе острова', () => {
    expect(MAINLAND.length).toBeGreaterThanOrEqual(30);
    expect(SPAWNS.length).toBe(SICILY_COUNT + MAINLAND.length);
    expect(new Set(SPAWNS.map((s) => `${s.x}|${s.y}`)).size).toBe(SPAWNS.length);
    const island = new Set(sicilyLand().map((p) => `${p.x}|${p.y}`));
    for (const s of MAINLAND) {
      expect([s, settleable(s.x, s.y), sicilyFit(s), mainlandFit(s, island)]).toEqual([s, true, true, true]);
      // Тот же регион, что у острова: воевать между игроками можно только внутри региона (`theatre.inHomeTheatre`).
      expect([s, theatreAt(s.x, s.y)?.id]).toEqual([s, SICILY_THEATRE]);
      expect([s, island.has(`${s.x}|${s.y}`)]).toEqual([s, false]);
    }
  });

  it('соседи по цепочке — как на острове: не ближе шага острова ни к одному месту, до следующего — не дальше полутора шагов', () => {
    for (const s of MAINLAND) {
      const near = Math.min(...SPAWNS.filter((t) => t !== s).map((t) => dist(s, t)));
      expect([s, near >= SICILY_STEP]).toEqual([s, true]);
    }
    for (let k = 1; k < MAINLAND.length; k++) {
      const d = dist(MAINLAND[k - 1], MAINLAND[k]);
      expect([k, d >= SICILY_STEP && d <= 1.5 * SICILY_STEP]).toEqual([k, true]);
    }
  });

  it('вдоль западного берега, с юга на север: от пролива до самой Флоренции, чем позже — тем севернее', () => {
    const path = coastPath();
    const reggio = path[0];
    const florence = path[path.length - 1];
    // Граница области — путь вдоль берега: каждое место в `COAST_REACH` от него (диагональ клетки — допуск округления).
    const at = MAINLAND.map((s) => onPath(path, s));
    at.forEach((a, k) => expect([k, a.off <= COAST_REACH + Math.SQRT2]).toEqual([k, true]));
    for (let k = 1; k < MAINLAND.length; k++) {
      expect([k, at[k].along > at[k - 1].along]).toEqual([k, true]);
      expect([k, MAINLAND[k].y <= MAINLAND[k - 1].y]).toEqual([k, true]);
    }
    expect(dist(MAINLAND[0], reggio)).toBeLessThan(SICILY_STEP);
    expect(MAINLAND[MAINLAND.length - 1]).toEqual(florence);
    // Начало цепочки — у острова, за проливом: ближе любого места материка к острову.
    const toIsland = (s: P): number => Math.min(...SICILY.map((t) => dist(s, t)));
    expect(MAINLAND.every((s) => toIsland(s) >= toIsland(MAINLAND[0]))).toBe(true);
  });

  it('номер места: остров 1..25, материк дальше по порядку, соседняя клетка — 0', () => {
    MAINLAND.forEach((s, k) => expect(spawnSlot(s)).toBe(SICILY_COUNT + k + 1));
    expect(spawnSlot({ x: MAINLAND[0].x + 1, y: MAINLAND[0].y })).toBe(0);
    for (const s of MAINLAND) expect(sicilySlot(s)).toBe(0);
  });

  it('чужие места: у острова — только остров (мир острова не сдвинулся), у материка — все остальные', () => {
    for (const s of SICILY) {
      const others = islandNeighbours(s);
      expect(others.length).toBe(SICILY_COUNT - 1);
      expect(others.some((o) => spawnSlot(o) > SICILY_COUNT)).toBe(false);
    }
    for (const s of MAINLAND) {
      const others = islandNeighbours(s);
      expect(others.length).toBe(SPAWNS.length - 1);
      expect(others.some((o) => o.x === s.x && o.y === s.y)).toBe(false);
    }
  });

  it('кольцо обзора на материке — обычное: соседи стоят цепочкой, а не кучкой', () => {
    for (const s of MAINLAND) expect(homeSight(s)).toBe(HOME_SIGHT);
  });
});
