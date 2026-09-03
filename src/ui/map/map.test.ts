// Тесты нарисованной карты. Всё, что здесь проверяется, — чистые числа: под
// vitest среда 'node', холста нет. Поэтому геометрия экрана и раскладка декора
// живут отдельно от отрисовки (`grid.ts`, `scatter.ts`), а рисование остаётся
// тонким слоем поверх них.
import { describe, expect, it } from 'vitest';
import { terrainAt } from '@/world/geo';
import { useWorld } from '@/world/store';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import type { Rect } from '@/world/types';
import {
  type Camera,
  type Viewport,
  detailAlpha,
  modeFor,
  panBy,
  scaleTo,
  tileIndexX,
  tileIndexY,
  tileRangeFor,
  tilesIn,
  TILE_LAST,
  viewRect,
  visibleCells,
  zoomAt,
} from './grid';
import { FADE_HI, FADE_LO, SCALE_DETAIL, SCALE_OVERVIEW, TILE_CELLS } from './const';
import { type Sample, fieldAt, forestAt, stampsFor, treesIn } from './scatter';

const SEED = 4242;
/** Ландшафт берётся настоящий: тест должен ловить и странности реального мира. */
const sampleFor = (seed: number): Sample => (x, y) => terrainAt(seed, x, y);

const VP: Viewport = { w: 390, h: 844 };
const HOME = { x: WORLD_ORIGIN.x + 60, y: WORLD_ORIGIN.y + 80 };

describe('декор земли детерминирован по сиду', () => {
  const rect: Rect = { x: HOME.x, y: HOME.y, w: TILE_CELLS, h: TILE_CELLS };

  it('один сид даёт одни и те же ёлки', () => {
    const a = treesIn(SEED, rect, sampleFor(SEED));
    const b = treesIn(SEED, rect, sampleFor(SEED));
    expect(b).toEqual(a);
    // Пустой результат сделал бы тест бессмысленным: ищем участок с лесом.
    expect(a.length).toBeGreaterThan(0);
  });

  it('один сид даёт одни и те же кляксы воды и холмов', () => {
    for (const kind of ['water', 'hills'] as const) {
      const a = stampsFor(SEED, rect, kind, sampleFor(SEED));
      const b = stampsFor(SEED, rect, kind, sampleFor(SEED));
      expect(b).toEqual(a);
    }
  });

  it('другой сид даёт другую картинку', () => {
    // Ищем участок, где в обоих мирах есть что рисовать: пустая трава совпала бы
    // и у разных сидов, и тест прошёл бы вхолостую.
    const wide: Rect = { x: WORLD_ORIGIN.x + 40, y: WORLD_ORIGIN.y + 40, w: 40, h: 40 };
    const a = treesIn(SEED, wide, sampleFor(SEED));
    const b = treesIn(SEED + 1, wide, sampleFor(SEED + 1));
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(b).not.toEqual(a);
  });

  it('ёлки не выстраиваются по сетке и не стоят в воде', () => {
    const wide: Rect = { x: HOME.x, y: HOME.y, w: 24, h: 24 };
    const trees = treesIn(SEED, wide, sampleFor(SEED));
    expect(trees.length).toBeGreaterThan(0);
    // Ни одна ёлка не села ровно в узел сетки — иначе лес читался бы рядами.
    expect(trees.every((t) => t.x % 1 !== 0 && t.y % 1 !== 0)).toBe(true);
    // И ни одна не оказалась внутри водяной кляксы.
    const wet = trees.filter((t) => fieldAt(SEED, t.x, t.y, 'water', sampleFor(SEED)) >= 1);
    expect(wet).toEqual([]);
  });

  it('плотность леса меняется плавно, а не ступенькой по клетке', () => {
    // Доля леса — сглаженная по 3×3, поэтому у края леса она обязана быть дробной.
    const values = new Set<number>();
    for (let y = HOME.y; y < HOME.y + 30; y++) {
      for (let x = HOME.x; x < HOME.x + 30; x++) values.add(forestAt(x, y, sampleFor(SEED)));
    }
    const partial = [...values].filter((v) => v > 0 && v < 1);
    expect(partial.length).toBeGreaterThan(0);
  });
});

describe('видимая область на краях мира', () => {
  it('не выходит за левый верхний угол', () => {
    const cam: Camera = { cx: WORLD_ORIGIN.x, cy: WORLD_ORIGIN.y, scale: SCALE_DETAIL };
    const cells = visibleCells(viewRect(cam, VP));
    expect(cells.x).toBe(WORLD_ORIGIN.x);
    expect(cells.y).toBe(WORLD_ORIGIN.y);
    expect(cells.w).toBeGreaterThan(0);
  });

  it('не выходит за правый нижний угол', () => {
    const cam: Camera = { cx: WORLD_ORIGIN.x + WORLD_SIZE, cy: WORLD_ORIGIN.y + WORLD_SIZE, scale: SCALE_DETAIL };
    const cells = visibleCells(viewRect(cam, VP));
    expect(cells.x + cells.w).toBe(WORLD_ORIGIN.x + WORLD_SIZE);
    expect(cells.y + cells.h).toBe(WORLD_ORIGIN.y + WORLD_SIZE);
  });

  it('целиком за краем мира даёт пустую область, а не отрицательную', () => {
    const rect: Rect = { x: WORLD_ORIGIN.x - 500, y: WORLD_ORIGIN.y - 500, w: 100, h: 100 };
    const cells = visibleCells(rect);
    expect(cells.w).toBe(0);
    expect(cells.h).toBe(0);
  });

  it('тайлы у края не уезжают за сетку мира', () => {
    for (const cam of [
      { cx: WORLD_ORIGIN.x - 6, cy: WORLD_ORIGIN.y - 6, scale: SCALE_OVERVIEW },
      { cx: WORLD_ORIGIN.x + WORLD_SIZE + 6, cy: WORLD_ORIGIN.y + WORLD_SIZE + 6, scale: SCALE_OVERVIEW },
    ] as Camera[]) {
      const range = tileRangeFor(viewRect(cam, VP), 1);
      expect(range.tx0).toBeGreaterThanOrEqual(0);
      expect(range.ty0).toBeGreaterThanOrEqual(0);
      expect(range.tx1).toBeLessThanOrEqual(TILE_LAST);
      expect(range.ty1).toBeLessThanOrEqual(TILE_LAST);
    }
  });
});

describe('перетаскивание', () => {
  /** Каждая видимая клетка обязана лежать в одном из выданных тайлов. */
  const coversEverything = (cam: Camera): void => {
    const rect = viewRect(cam, VP);
    const cells = visibleCells(rect);
    const range = tileRangeFor(rect);
    for (let y = cells.y; y < cells.y + cells.h; y++) {
      for (let x = cells.x; x < cells.x + cells.w; x++) {
        const tx = tileIndexX(x);
        const ty = tileIndexY(y);
        const covered = tx >= range.tx0 && tx <= range.tx1 && ty >= range.ty0 && ty <= range.ty1;
        if (!covered) {
          throw new Error(`клетка ${x}|${y} не попала ни в один тайл при камере ${cam.cx}|${cam.cy} × ${cam.scale}`);
        }
      }
    }
  };

  it('не теряет клетки и не оставляет пустых полос', () => {
    // Дробные шаги нарочно: ровный сдвиг на целую клетку скрыл бы промах на краю.
    let cam: Camera = { cx: HOME.x, cy: HOME.y, scale: SCALE_DETAIL };
    coversEverything(cam);
    for (let i = 0; i < 120; i++) {
      cam = panBy(cam, 37.3, -19.7);
      coversEverything(cam);
    }
    for (let i = 0; i < 120; i++) {
      cam = panBy(cam, -53.1, 41.9);
      coversEverything(cam);
    }
  });

  it('не теряет клетки, когда камеру уводят за край мира', () => {
    for (const scale of [SCALE_OVERVIEW, SCALE_DETAIL]) {
      for (const [cx, cy] of [
        [WORLD_ORIGIN.x - 6, WORLD_ORIGIN.y - 6],
        [WORLD_ORIGIN.x + WORLD_SIZE + 6, WORLD_ORIGIN.y - 6],
        [WORLD_ORIGIN.x - 6, WORLD_ORIGIN.y + WORLD_SIZE + 6],
        [WORLD_ORIGIN.x + WORLD_SIZE + 6, WORLD_ORIGIN.y + WORLD_SIZE + 6],
      ]) {
        coversEverything({ cx, cy, scale });
      }
    }
  });

  it('число тайлов на экране остаётся небольшим', () => {
    const cam: Camera = { cx: HOME.x, cy: HOME.y, scale: SCALE_DETAIL };
    const tiles = tilesIn(tileRangeFor(viewRect(cam, VP)));
    // Земля стоит один drawImage на тайл: их должно быть единицы, а не сотни.
    expect(tiles.length).toBeLessThanOrEqual(16);
    expect(tiles.length).toBeGreaterThan(0);
  });
});

describe('переключение масштабов', () => {
  it('переход между видами идёт полосой, а не подменой', () => {
    expect(detailAlpha(FADE_LO)).toBe(0);
    expect(detailAlpha(FADE_HI)).toBe(1);
    expect(detailAlpha(SCALE_OVERVIEW)).toBe(0);
    expect(detailAlpha(SCALE_DETAIL)).toBe(1);
    const mid = detailAlpha((FADE_LO + FADE_HI) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('не сбрасывает выбранное поселение', () => {
    const chosen = { x: HOME.x + 3, y: HOME.y + 4 };
    useWorld.setState({ selected: chosen });

    let cam: Camera = { cx: HOME.x, cy: HOME.y, scale: SCALE_DETAIL };
    const modes = new Set([modeFor(cam.scale)]);
    // Полный путь пальцем: щипок туда, щипок обратно, кнопка масштаба, сдвиг.
    for (let i = 0; i < 12; i++) {
      cam = zoomAt(cam, VP, VP.w / 2, VP.h / 2, 0.8);
      modes.add(modeFor(cam.scale));
    }
    for (let i = 0; i < 12; i++) {
      cam = zoomAt(cam, VP, 10, 700, 1.25);
      modes.add(modeFor(cam.scale));
    }
    cam = scaleTo(cam, VP, SCALE_OVERVIEW);
    modes.add(modeFor(cam.scale));
    cam = panBy(cam, 120, -80);
    cam = scaleTo(cam, VP, SCALE_DETAIL);
    modes.add(modeFor(cam.scale));

    // Тест обязан был реально перейти из вида в вид, иначе он ничего не проверил.
    expect([...modes].sort()).toEqual(['detail', 'overview']);
    expect(useWorld.getState().selected).toEqual(chosen);

    useWorld.setState({ selected: null });
  });
});
