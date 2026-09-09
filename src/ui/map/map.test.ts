// Тесты нарисованной карты. Всё, что здесь проверяется, — чистые числа: под
// vitest среда 'node', холста нет. Поэтому геометрия экрана и раскладка декора
// живут отдельно от отрисовки (`grid.ts`, `scatter.ts`), а рисование остаётся
// тонким слоем поверх них.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { terrainAt } from '@/world/geo';
import { lineStamps } from './scatter';
import { WORLD_VIEW, freeCamera, revealWorld } from '@/debug';
import { useWorld } from '@/world/store';
import { CAMERA_LEASH, HOME_SIGHT, WORLD_ORIGIN, WORLD_SIZE, ZOOM_MARGIN } from '@/world/data/tuning';
import { FogMap, exploredReach } from '@/world/fog';
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
  LEASH_EDGE,
  type Leash,
  leashCamera,
  zoomFloor,
  toScreen,
  toWorld,
  tileRangeFor,
  tilesIn,
  TILE_LAST,
  viewRect,
  visibleCells,
  zoomAt,
} from './grid';
import { FADE_HI, FADE_LO, SCALE_DETAIL, SCALE_MAX, SCALE_MIN, SCALE_OVERVIEW, SCALE_START, TILE_CACHE, TILE_CELLS, TREE_FREE_R } from './const';
import { type Sample, fieldAt, forestAt, stampsFor, treesIn } from './scatter';
import { BUCKETS, STAGE_SHAPE, clearRadius, layout, pickBucket, ringOf, spriteKey, variantOf } from './village';
import {
  MEN_SHOWN,
  PARTY_BUCKETS,
  PARTY_STEPS,
  hasRear,
  lookOf,
  partyBucket,
  partyKey,
  partyMen,
  sizeOf,
  type PartySize,
} from './party';

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
    const look = {
      stage: 'town',
      relation: 'enemy',
      mine: false,
      variant: 1,
      castle: false,
      ruin: false,
      sacked: false,
    } as const;
    expect(spriteKey(look, 40, 2)).toBe(spriteKey({ ...look }, 40, 2));
    expect(spriteKey(look, 40, 2)).not.toBe(spriteKey({ ...look, mine: true }, 40, 2));
    expect(spriteKey(look, 40, 2)).not.toBe(spriteKey({ ...look, relation: 'ally' }, 40, 2));
    // Без этого замок получил бы спрайт обычного соседа той же стадии — молча.
    expect(spriteKey(look, 40, 2)).not.toBe(spriteKey({ ...look, castle: true }, 40, 2));
    // И то же самое про пепелище: сожжённое логово рисуется вместо поселения
    // целиком, и общий с ним ключ означал бы, что победа на карте не видна.
    expect(spriteKey(look, 40, 2)).not.toBe(spriteKey({ ...look, ruin: true }, 40, 2));
    // Разорение рисуется поверх обычного силуэта, а не вместо него, — и потому
    // тем более обязано быть в ключе: забудь его, и разорённый двор молча
    // получит спрайт целого, то есть последствие победы пропадёт с карты.
    expect(spriteKey(look, 40, 2)).not.toBe(spriteKey({ ...look, sacked: true }, 40, 2));
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

describe('линии местности', () => {
  const rect = { x: 0, y: 0, w: 8, h: 8 };
  const near = (stamps: { x: number; y: number }[], x: number, y: number): boolean =>
    stamps.some((s) => Math.abs(s.x - x) < 1e-6 && Math.abs(s.y - y) < 1e-6);

  it('не рвётся на диагональных соседях', () => {
    // Три клетки лесенкой — так и идёт русло, и колея тракта.
    const cells = new Set(['2|2', '3|3', '4|4']);
    const stamps = lineStamps(rect, (x, y) => cells.has(`${x}|${y}`), 0.4);
    // Диск в каждой клетке плюс перемычка между соседями: без перемычек между
    // центрами по диагонали (1.41 клетки) остаётся дыра.
    expect(near(stamps, 2.5, 2.5)).toBe(true);
    expect(near(stamps, 3.5, 3.5)).toBe(true);
    expect(near(stamps, 3, 3)).toBe(true);
    expect(near(stamps, 4, 4)).toBe(true);
  });

  it('перемычка между парой клеток рисуется один раз', () => {
    const cells = new Set(['2|2', '3|2']);
    const stamps = lineStamps(rect, (x, y) => cells.has(`${x}|${y}`), 0.4);
    expect(stamps.filter((s) => Math.abs(s.x - 3) < 1e-6 && Math.abs(s.y - 2.5) < 1e-6).length).toBe(1);
  });

  it('одинаковый вход даёт одинаковый выход', () => {
    const on = (x: number, y: number): boolean => (x + y) % 3 === 0;
    expect(lineStamps(rect, on, 0.5)).toEqual(lineStamps(rect, on, 0.5));
  });
});

describe('камера привязана к своим', () => {
  const SIGHT = 8;
  const LEASH = SIGHT + CAMERA_LEASH;
  /** Разведанный мир: эти тесты про поводок, и потолок отдаления им мешать не должен. */
  const OPEN = { left: 200, right: 200, up: 200, down: 200 };
  const anchorAt = (x: number, y: number): Leash => ({ x: x + 0.5, y: y + 0.5, r: LEASH, reach: OPEN });

  it('дальше поводка камера не уходит', () => {
    const a = anchorAt(HOME.x, HOME.y);
    // Бросок пальцем через полмира — камера остаётся при своих.
    const far = leashCamera({ cx: a.x + 200, cy: a.y - 150, scale: SCALE_OVERVIEW }, VP, a);
    expect(Math.abs(far.cx - a.x)).toBeLessThanOrEqual(LEASH + 1e-9);
    expect(Math.abs(far.cy - a.y)).toBeLessThanOrEqual(LEASH + 1e-9);
  });

  it('якорь не прячется под шапкой и не уходит за кромку', () => {
    const a = anchorAt(HOME.x, HOME.y);
    for (const scale of [SCALE_OVERVIEW, 16, SCALE_DETAIL]) {
      const cam = leashCamera({ cx: a.x + 999, cy: a.y + 999, scale }, VP, a);
      const [sx, sy] = toScreen(cam, VP, a.x, a.y);
      // Запас в пикселях, а не в клетках: шапку и ряды кнопок масштаб не сжимает.
      expect(sx).toBeGreaterThanOrEqual(LEASH_EDGE - 1e-6);
      expect(sx).toBeLessThanOrEqual(VP.w - LEASH_EDGE + 1e-6);
      expect(sy).toBeGreaterThanOrEqual(LEASH_EDGE - 1e-6);
      expect(sy).toBeLessThanOrEqual(VP.h - LEASH_EDGE + 1e-6);
    }
  });

  it('чем ближе масштаб, тем короче поводок', () => {
    const a = anchorAt(HOME.x, HOME.y);
    const slack = (scale: number): number => leashCamera({ cx: a.x + 999, cy: a.y, scale }, VP, a).cx - a.x;
    // На обзоре решает поводок, вблизи — экран: разгуляться там негде, и
    // камера почти стоит на якоре.
    expect(slack(SCALE_OVERVIEW)).toBeCloseTo(LEASH, 6);
    expect(slack(SCALE_DETAIL)).toBeLessThan(slack(SCALE_OVERVIEW));
    expect(slack(SCALE_MAX)).toBeLessThan(2);
    expect(slack(SCALE_MAX)).toBeGreaterThan(0);
  });

  it('свободный обзор мира выключен, пока его не позвали адресом', () => {
    // Ни в игре, ни в тестах адреса нет — значит, поводок работает всегда, а
    // отладочный обзор включается только руками.
    expect(WORLD_VIEW).toBe('off');
    expect(freeCamera()).toBe(false);
    expect(revealWorld()).toBe(false);
  });

  it('фигурой можно сделать десять шагов подряд в неразведанную сторону', () => {
    // Это и есть проверка требования: приказ отдаётся тапом по клетке, и каждый
    // раз должна находиться клетка за краем обзора, до которой палец достаёт, —
    // при том что фигура ни разу не пропадает с экрана.
    const start = { x: HOME.x, y: HOME.y };
    let at = start;
    let cam: Camera = { cx: at.x + 0.5, cy: at.y + 0.5, scale: SCALE_DETAIL };
    for (let step = 0; step < 10; step++) {
      const a = anchorAt(at.x, at.y);
      // Игрок тянет карту вниз до упора и тапает у нижнего края, над кнопками.
      cam = leashCamera(panBy(cam, 0, -VP.h), VP, a);
      const [, sy] = toScreen(cam, VP, a.x, a.y);
      expect(sy).toBeGreaterThanOrEqual(LEASH_EDGE - 1e-6);
      const target = toWorld(cam, VP, VP.w / 2, VP.h - 140);
      const next = { x: Math.floor(target.x), y: Math.floor(target.y) };
      // Шаг ведёт за край обзора — иначе разведывать было бы нечего.
      expect(next.y - at.y).toBeGreaterThan(SIGHT);
      at = next;
    }
    // Десять шагов — это заметный путь, и он умещается в мире.
    expect(at.y - start.y).toBeGreaterThan(90);
    expect(at.y).toBeLessThan(WORLD_ORIGIN.y + WORLD_SIZE);
  });
});

describe('дальше разведанного не отдалить', () => {
  const DESKTOP: Viewport = { w: 1440, h: 900 };
  /** Туман настоящий: тот же `FogMap`, что и в мире, а не выдуманная функция. */
  const fogOf = (make: (f: FogMap) => void): FogMap => {
    const fog = new FogMap();
    make(fog);
    return fog;
  };
  const startFog = (): FogMap => fogOf((f) => f.revealDisc(HOME, HOME_SIGHT));
  const leashOn = (fog: FogMap, at: { x: number; y: number }): Leash => ({
    x: at.x + 0.5,
    y: at.y + 0.5,
    r: HOME_SIGHT + CAMERA_LEASH,
    reach: exploredReach(at, (x, y) => fog.has(x, y)),
  });
  /** Пролёт разведанного плюс запас — в клетках, по каждой оси. */
  const span = (l: Leash): { w: number; h: number } => ({
    w: l.reach.left + l.reach.right + 1 + ZOOM_MARGIN * 2,
    h: l.reach.up + l.reach.down + 1 + ZOOM_MARGIN * 2,
  });

  it('щипок до упора не показывает больше разведанного', () => {
    const a = leashOn(startFog(), HOME);
    for (const vp of [VP, DESKTOP]) {
      // Игрок разводит пальцы до предела — камера останавливается раньше.
      const cam = leashCamera({ cx: a.x, cy: a.y, scale: SCALE_MIN }, vp, a);
      expect(cam.scale).toBeGreaterThan(SCALE_MIN);
      const rect = viewRect(cam, vp);
      expect(rect.w).toBeLessThanOrEqual(span(a).w + 1e-6);
      expect(rect.h).toBeLessThanOrEqual(span(a).h + 1e-6);
      // Мир — двести клеток по стороне; в кадр не влезает и четверть.
      expect(Math.max(rect.w, rect.h)).toBeLessThan(WORLD_SIZE / 4);
    }
  });

  it('начальный вид от этого не становится тесным', () => {
    // На старте разведано около девятисот клеток: круг обзора деревни.
    const fog = startFog();
    expect(fog.count()).toBeGreaterThan(850);
    const a = leashOn(fog, HOME);
    const floor = zoomFloor(VP, a.reach);
    // Отдалить можно заметно дальше, чем открывается карта, и в кадр по длинной
    // стороне влезает вся округа деревни: и она сама, и оба ближних соседа.
    expect(floor).toBeLessThan(SCALE_START);
    expect(Math.max(VP.w, VP.h) / floor).toBeGreaterThanOrEqual(2 * HOME_SIGHT);
  });

  it('дальний поход разведчика не растягивает предел у дома', () => {
    const near = startFog();
    const far = fogOf((f) => {
      f.revealDisc(HOME, HOME_SIGHT);
      // Разведчик ушёл почти через полмира и открыл за собой коридор.
      f.revealPath(HOME, { x: HOME.x + 90, y: HOME.y }, 8);
    });
    expect(far.count()).toBeGreaterThan(near.count() * 2);
    // Предел меряется вокруг якоря, а не по границе всего открытого: коридор
    // шириной в обзор разведчика на потолок у деревни не влияет вовсе.
    expect(leashOn(far, HOME).reach).toEqual(leashOn(near, HOME).reach);
    expect(zoomFloor(VP, leashOn(far, HOME).reach)).toBeCloseTo(zoomFloor(VP, leashOn(near, HOME).reach), 9);
    // А на самом разведчике открыто только вдоль коридора: поперёк — его обзор.
    const scout = leashOn(far, { x: HOME.x + 90, y: HOME.y });
    expect(scout.reach.left).toBeGreaterThan(50);
    expect(scout.reach.up).toBeLessThan(HOME_SIGHT);
    expect(scout.reach.down).toBeLessThan(HOME_SIGHT);
  });

  it('потолок один и тот же на телефоне и на десктопе', () => {
    // Предел задан в клетках, поэтому по длинной стороне кадра их одинаково
    // много и там, и там: в пикселях это были бы совсем разные карты.
    const a = leashOn(startFog(), HOME);
    const phone = leashCamera({ cx: a.x, cy: a.y, scale: SCALE_MIN }, VP, a);
    const desk = leashCamera({ cx: a.x, cy: a.y, scale: SCALE_MIN }, DESKTOP, a);
    expect(phone.scale).not.toBeCloseTo(desk.scale, 1);
    const long = (cam: Camera, vp: Viewport): number => Math.max(viewRect(cam, vp).w, viewRect(cam, vp).h);
    expect(long(phone, VP)).toBeCloseTo(long(desk, DESKTOP), 6);
  });

  it('приближение не ограничено', () => {
    const a = leashOn(startFog(), HOME);
    const cam = leashCamera({ cx: a.x, cy: a.y, scale: SCALE_MAX }, VP, a);
    expect(cam.scale).toBe(SCALE_MAX);
  });

  it('неразведанный якорь не роняет потолок в ноль', () => {
    // Так бывает на первом кадре, пока не приехал ни один кусок карты.
    const dark = exploredReach(HOME, () => false);
    expect(dark).toEqual({ left: 0, right: 0, up: 0, down: 0 });
    expect(zoomFloor(VP, dark)).toBeLessThanOrEqual(SCALE_MAX);
    expect(zoomFloor(VP, dark)).toBeGreaterThan(0);
  });
});

describe('отряд на карте: размер — это разведданные', () => {
  const foe = (units: Record<string, number>, seen: boolean) =>
    lookOf({ own: false, units, standing: false, seen, west: false });

  it('чужой отряд вне живого обзора не показывает, сколько их', () => {
    // Донесение Дозора говорит «идут», а не «сколько идёт». Показать колонну в
    // полный рост значило бы отдать даром то, за что игрок платит лазутчиком.
    expect(foe({ warrior: 200 }, false).size).toBe('rumor');
    expect(foe({ warrior: 3 }, false).size).toBe('rumor');
    // И картинка обязана быть про это: у слуха нет ни одной фигуры.
    expect(MEN_SHOWN.rumor).toBe(0);
  });

  it('тот же отряд в живом обзоре считают глазами', () => {
    expect(foe({ warrior: 200 }, true).size).toBe('horde');
    expect(foe({ warrior: 3 }, true).size).toBe('small');
  });

  it('свой отряд считают всегда: игрок сам его и собрал', () => {
    const mine = (n: number) => lookOf({ own: true, units: { warrior: n }, standing: false, seen: false, west: false });
    expect(mine(3).size).toBe('small');
    expect(mine(200).size).toBe('horde');
    expect(mine(200).side).toBe('own');
  });

  it('вид «слух» не выдаёт себя ни одной другой приметой', () => {
    // Ни размером знамени, ни задними рядами: всё, что считается из числа
    // людей, у слуха обязано молчать.
    expect(hasRear('rumor')).toBe(false);
    expect(MEN_SHOWN.rumor).toBeLessThan(MEN_SHOWN.small);
  });

  it('лестница монотонна и покрывает то, что ходит по карте', () => {
    // Числа меряные (npm run map:report): чужие набеги — 2..42 человека, своё
    // войско идёт на сотни. Каждая ступень обязана кому-то достаться.
    const ladder: PartySize[] = ['small', 'band', 'host', 'horde'];
    const at = (n: number) => ladder.indexOf(sizeOf(n));
    for (let n = 1; n < 400; n++) expect(at(n)).toBeGreaterThanOrEqual(at(n - 1 || 1));
    expect(sizeOf(2)).toBe('small');
    expect(sizeOf(42)).toBe('host');
    expect(sizeOf(200)).toBe('horde');
    for (const step of PARTY_STEPS) expect(step).toBeGreaterThan(0);
  });

  it('людей считают все виды войск, а не только «воины»', () => {
    // Тем же счётом меряется войско при полководце, а это TroopStack.
    expect(partyMen({ warrior: 5, scout: 2 })).toBe(7);
    expect(partyMen({ legionary: 40, rider: 10 })).toBe(50);
    expect(partyMen({})).toBe(0);
  });

  it('стоянка не путается с походом ни в ключе кэша, ни в виде', () => {
    const camp = lookOf({ own: true, units: { warrior: 30 }, standing: true, seen: true, west: false });
    expect(camp.shape).toBe('camp');
    // Направления у стоянки нет, и в ключ оно не входит: иначе один и тот же
    // лагерь занимал бы в кэше две ячейки под одну картинку.
    const west = { ...camp, west: true };
    expect(partyKey(camp, 40, 2)).toBe(partyKey(west, 40, 2));
    // А у колонны — входит: её печут зеркально.
    const going = lookOf({ own: true, units: { warrior: 30 }, standing: false, seen: true, west: false });
    expect(partyKey(going, 40, 2)).not.toBe(partyKey({ ...going, west: true }, 40, 2));
  });

  it('ключ кэша различает всё, от чего зависит картинка', () => {
    const base = lookOf({ own: true, units: { warrior: 30 }, standing: false, seen: true, west: false });
    const keys = new Set<string>();
    for (const side of ['own', 'foe'] as const) {
      for (const size of ['rumor', 'small', 'band', 'host', 'horde'] as PartySize[]) {
        for (const shape of ['column', 'camp'] as const) {
          keys.add(partyKey({ ...base, side, size, shape }, 40, 2));
        }
      }
    }
    // Забыть здесь поле значит молча выдать орде спрайт горстки.
    expect(keys.size).toBe(2 * 5 * 2);
  });

  it('корзины размера не дают перепекать отряд на каждый щипок', () => {
    // То же правило, что у поселений: масштаб непрерывен, выпечка дискретна.
    expect(PARTY_BUCKETS).toEqual([...PARTY_BUCKETS].sort((a, b) => a - b));
    const seen = new Set<number>();
    for (let px = FADE_LO; px <= 80; px += 0.5) seen.add(partyBucket(px));
    expect(seen.size).toBeLessThanOrEqual(PARTY_BUCKETS.length);
    // Растяжение копии не больше трети: дальше рисунок мылится.
    for (let i = 1; i < PARTY_BUCKETS.length; i++) {
      expect(PARTY_BUCKETS[i] / PARTY_BUCKETS[i - 1]).toBeLessThan(1.4);
    }
  });
});

describe('отрисовка отряда ходит через правило разведки, а не мимо', () => {
  // Читается исходник, а не поведение, и это тот самый случай, ради которого
  // такие тесты и заводят: поведение здесь — картинка, а сломать правило можно
  // одной строкой `seen: true`, и ни один прогон этого не заметит.
  const read = (f: string): string =>
    readFileSync(join(process.cwd(), 'src/ui/map', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('кадр берёт живой обзор у общего модуля, а не считает его сам', () => {
    const src = read('frame.ts');
    // `sightDiscs` из world/store и `inSight` из world/fog — те же, которыми
    // мир решал, показывать ли этот отряд вообще (LocalWorld.visibleMarches).
    expect(src).toMatch(/import \{[^}]*sightDiscs[^}]*\} from '@\/world\/store'/);
    expect(src).toMatch(/import \{[^}]*inSight[^}]*\} from '@\/world\/fog'/);
    expect(src).toMatch(/const discs = sightDiscs\(now\)/);
    // Своего HOME_SIGHT, своего радиуса лазутчика и своего перебора фигур в
    // кадре быть не должно: это была бы вторая правда о том, кто наблюдает.
    expect(src).not.toMatch(/HOME_SIGHT|watchSight|liveSight/);
  });

  it('чужому отряду «видно» не приписывается, а вычисляется', () => {
    const src = read('frame.ts');
    // Единственное `seen:` в кадре — вычисленное. Литерал `true` тут означал бы
    // карту, на которой все армии ползают на виду.
    const seen = [...src.matchAll(/seen: (.+),$/gm)].map((m) => m[1].trim());
    expect(seen).toEqual(['m.own || inSight(discs, pos.x, pos.y)']);
  });

  it('свои фигуры считаются своими, и только они', () => {
    const src = read('figures.ts');
    // У фигур `seen: true` законно — но ровно потому, что там же стоит
    // `own: true`: это войско игрока, он его и собрал.
    const calls = [...src.matchAll(/partyLook\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('own: true');
    expect(calls[0]).toContain('seen: true');
    // Чужих фигур на карте не бывает вовсе, и заводить их здесь нельзя.
    expect(src).not.toMatch(/own:\s*false/);
  });

  it('спрайт отряда не знает про мир и достать разведданные ему неоткуда', () => {
    const src = read('party.ts');
    expect(src).not.toMatch(/from '@\/world/);
    // Ступень считается ровно в одном месте — в `lookOf`, под условием. Два
    // упоминания: само определение и единственный вызов; третье означало бы
    // вторую дверь к числу людей мимо проверки.
    expect([...src.matchAll(/sizeOf\(/g)].length).toBe(2);
    expect(src).toMatch(/o\.own \|\| o\.seen \? sizeOf\(partyMen\(o\.units\)\) : 'rumor'/);
  });
});
