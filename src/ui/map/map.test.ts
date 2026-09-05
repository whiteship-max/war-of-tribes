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
import { FADE_HI, FADE_LO, SCALE_DETAIL, SCALE_OVERVIEW, TILE_CACHE, TILE_CELLS, TREE_FREE_R } from './const';
import { type Sample, fieldAt, forestAt, stampsFor, treesIn } from './scatter';
import { BUCKETS, STAGE_SHAPE, clearRadius, layout, pickBucket, ringOf, spriteKey, variantOf } from './village';

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

  it('кэш тайлов не меньше того, что помещается на экран', () => {
    // Кэш меньше видимого — это не экономия, а вечная перевыпечка: тайл
    // вытесняют раньше, чем он пригодится, и следующий кадр печёт его снова.
    // Проверяем весь рабочий диапазон нарисованного слоя, а не только удобный
    // ближний масштаб: на широком экране и у нижнего края полосы перехода
    // тайлов больше всего.
    const tall: Viewport = { w: 430, h: 932 };
    for (const scale of [FADE_LO, 30, 34, SCALE_DETAIL, 70]) {
      for (const vp of [VP, tall]) {
        const need = tilesIn(tileRangeFor(viewRect({ cx: HOME.x, cy: HOME.y, scale }, vp))).length;
        expect(need).toBeLessThanOrEqual(TILE_CACHE);
      }
    }
  });
});

describe('поселения читаются силуэтом', () => {
  const STAGES = ['camp', 'village', 'stronghold', 'town'] as const;

  it('стадия видна по ограде, а не только по размеру', () => {
    // Главный признак на 48 px — есть ли кольцо и какое. У четырёх стадий оно
    // обязано различаться, иначе игрок не отличит деревню от города силуэтом.
    expect(STAGES.map((s) => ringOf(s, false))).toEqual(['none', 'none', 'palisade', 'stone']);
    // Лагерь и деревня без ограды обе — их разводит число построек и размер двора.
    expect(STAGE_SHAPE.village.count).toBeGreaterThan(STAGE_SHAPE.camp.count);
  });

  it('поселение растёт вширь со стадией', () => {
    for (let i = 1; i < STAGES.length; i++) {
      expect(clearRadius(STAGES[i])).toBeGreaterThan(clearRadius(STAGES[i - 1]));
      expect(STAGE_SHAPE[STAGES[i]].count).toBeGreaterThan(STAGE_SHAPE[STAGES[i - 1]].count);
    }
  });

  it('варвары не строят правильных стен', () => {
    for (const s of STAGES) {
      const ring = ringOf(s, true);
      expect(ring === 'palisade' || ring === 'stone').toBe(false);
    }
  });

  it('ёлки не лезут даже в самый большой двор', () => {
    // Пятно двора рисует спрайт, а лес отбраковывает тайл, и радиусы у них
    // разные. Если двор перерастёт вырубку, по краю города пойдут ёлки прямо
    // по пашне. Стадия города — самый большой двор, с него и проверяем.
    expect(TREE_FREE_R).toBeGreaterThan(clearRadius('town'));
    // Замок расширяет двор мелких стадий, и его тоже надо держать под вырубкой.
    for (const s of STAGES) expect(TREE_FREE_R).toBeGreaterThan(clearRadius(s, true));
  });

  it('расстановка построек детерминирована и идёт от дальних к ближним', () => {
    for (const s of STAGES) {
      const a = layout(s, false, 1);
      expect(layout(s, false, 1)).toEqual(a);
      expect(a.length).toBe(STAGE_SHAPE[s].count);
      // Порядок художника: дальний дом рисуется раньше ближнего, иначе крыши
      // наложатся не в том порядке.
      expect(a.map((p) => p.y)).toEqual([...a.map((p) => p.y)].sort((x, y) => x - y));
    }
  });

  it('соседние деревни не выходят близнецами', () => {
    const variants = new Set(['s1', 's2', 's3', 's4', 's5', 'b7'].map(variantOf));
    expect(variants.size).toBeGreaterThan(1);
    expect(variantOf('s1')).toBe(variantOf('s1'));
  });

  it('корзины размера не дают перепекать спрайт на каждый щипок', () => {
    // Между корзинами спрайт растягивается копированием: масштаб меняется
    // непрерывно, а выпечка дорогая.
    expect(BUCKETS).toEqual([...BUCKETS].sort((a, b) => a - b));
    for (const px of [10, 23, 31, 45, 60, 200]) {
      expect(BUCKETS).toContain(pickBucket(px));
    }
    expect(pickBucket(23)).toBe(pickBucket(29));
    // Ключ кэша разводит то, от чего зависит картинка, и только это.
    const look = { stage: 'town', relation: 'enemy', mine: false, variant: 1, castle: false } as const;
    expect(spriteKey(look, 40, 2)).toBe(spriteKey({ ...look }, 40, 2));
    expect(spriteKey(look, 40, 2)).not.toBe(spriteKey({ ...look, mine: true }, 40, 2));
    expect(spriteKey(look, 40, 2)).not.toBe(spriteKey({ ...look, relation: 'ally' }, 40, 2));
    // Без этого замок получил бы спрайт обычного соседа той же стадии — молча.
    expect(spriteKey(look, 40, 2)).not.toBe(spriteKey({ ...look, castle: true }, 40, 2));
  });
});

describe('замок — вторая ось, а не пятая стадия', () => {
  const STAGES = ['camp', 'village', 'stronghold', 'town'] as const;

  it('стена и донжон появляются при любой стадии', () => {
    // Мир считает стадию по мощи и населению, а замок ставит отдельным полем.
    // Замок на стадии лагеря или деревни без этого выглядел бы кучкой хижин без
    // ограды — картинка обещала бы лёгкую цель там, где стоит крепость вдвое
    // сильнее обычного соседа.
    for (const s of STAGES) {
      expect(ringOf(s, false, true)).toBe('stone');
      expect(layout(s, false, 1, true).some((p) => p.kind === 'keep')).toBe(true);
    }
  });

  it('без замка донжона не бывает ни на одной стадии', () => {
    for (const s of STAGES) {
      expect(layout(s, false, 1, false).some((p) => p.kind === 'keep')).toBe(false);
    }
  });

  it('донжон выше всего, что стоит в обычном поселении', () => {
    // Он должен торчать над стеной: кольцо у замка каменное и высокое, и низкая
    // башня спряталась бы за ним на нижней корзине размера.
    const keep = layout('village', false, 1, true).find((p) => p.kind === 'keep');
    const tallest = Math.max(...STAGES.flatMap((s) => layout(s, false, 1, false).map((p) => p.h)));
    expect(keep).toBeDefined();
    expect(keep?.h).toBeGreaterThan(tallest);
  });

  it('двор замка не меньше укреплённого поселения и не больше города', () => {
    for (const s of STAGES) {
      expect(clearRadius(s, true)).toBeGreaterThanOrEqual(clearRadius('stronghold'));
      expect(clearRadius(s, true)).toBeLessThanOrEqual(clearRadius('town'));
    }
  });

  it('замок не отменяет стадию: число построек остаётся её признаком', () => {
    for (const s of STAGES) {
      expect(layout(s, false, 1, true).length).toBe(STAGE_SHAPE[s].count);
    }
    expect(layout('town', false, 1, true).length).toBeGreaterThan(layout('camp', false, 1, true).length);
  });

  it('варвары не получают стены даже замком', () => {
    // Замков у варваров не бывает (`gen.ts`), но правило «правильной стены у них
    // не бывает» держится и здесь, а не только на честном слове генератора.
    for (const s of STAGES) {
      const ring = ringOf(s, true, true);
      expect(ring === 'palisade' || ring === 'stone').toBe(false);
    }
  });

  it('расстановка замка детерминирована и отличается от обычной', () => {
    const a = layout('stronghold', false, 2, true);
    expect(layout('stronghold', false, 2, true)).toEqual(a);
    expect(a).not.toEqual(layout('stronghold', false, 2, false));
    expect(a.map((p) => p.y)).toEqual([...a.map((p) => p.y)].sort((x, y) => x - y));
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
