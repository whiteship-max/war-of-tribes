// Места появления на Сицилии (docs/test_world.md): двенадцать мест — данные, выведенные из атласа; все на суше острова,
// все в одном регионе, одной кучкой узлов шестиугольной решётки — равномерно, ближе прежних 8–10 клеток и так, что из
// любого места кольцо обзора острова видит все остальные.
import { describe, expect, it } from 'vitest';
import { landmasses, settleable } from './land';
import { HOME_SIGHT, LAIR_HOME_GAP, SETTLE_GAP } from './data/tuning';
import { theatreAt } from './theatre/theatre';
import { homeSight } from './sight';
import {
  SICILY,
  SICILY_COUNT,
  SICILY_SIGHT,
  SICILY_STEP,
  SICILY_THEATRE,
  deriveSicily,
  inSicilyTheatre,
  islandNeighbours,
  sicilyAt,
  sicilyFit,
  sicilyLand,
  sicilyPatches,
  sicilySlot,
  spawnModeOf,
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

  it('двенадцать мест: разные, на суше острова, годные под город, в регионе острова', () => {
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
    // Шаг — порог дома: сосед стоит там, ближе чего к одиночке не подходит логово.
    expect(SICILY_STEP).toBe(LAIR_HOME_GAP);
  });

  it('шаг — наибольший, при котором двенадцать встают на годную сушу острова одной кучкой', () => {
    expect(sicilyAt(SICILY_STEP)).not.toBeNull();
    expect(sicilyAt(SICILY_STEP + 1)).toBeNull();
  });

  it('кучка решётки: двенадцать разных узлов, соседи — в шаге или по диагонали, поперечник — три шага', () => {
    const patches = sicilyPatches(SICILY_STEP);
    expect(patches.length).toBe(4);
    for (const patch of patches) {
      expect(new Set(patch.map((p) => `${p.x}|${p.y}`)).size).toBe(SICILY_COUNT);
      for (const d of nearest(patch)) expect(d >= DIAGONAL - 1e-9 && d <= SICILY_STEP).toBe(true);
      expect(across(patch)).toBe(3 * SICILY_STEP);
    }
  });

  it('одна часть острова: из любого места кольцо обзора острова видит все одиннадцать — и кольцо не больше нужного', () => {
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

  it('чужие места острова: у места — остальные одиннадцать, не у места — никого', () => {
    for (const s of SICILY) {
      const others = islandNeighbours(s);
      expect(others.length).toBe(SICILY_COUNT - 1);
      expect(others.some((o) => o.x === s.x && o.y === s.y)).toBe(false);
    }
    expect(islandNeighbours({ x: SICILY[0].x + 1, y: SICILY[0].y })).toEqual([]);
  });

  it('номер места — по порядку списка, не место — 0', () => {
    expect(sicilySlot(SICILY[0])).toBe(1);
    expect(sicilySlot(SICILY[11])).toBe(12);
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
