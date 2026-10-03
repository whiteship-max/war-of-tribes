// Имена крупных мест на дальнем масштабе (docs/map_tw.md, раздел 5; этап 2): моря, заливы, горы, острова.
// Карта кампании издали читается не значками, а именами — «Лигурийское море», «Апеннины», — и по ним игрок
// узнаёт, где он, без легенды и без координат.
//
// Это подписи картинки, а не данные игры: мир о них не знает и не узнает (ни проходимости, ни владений за
// ними нет), поэтому они живут здесь, при виде. Земля настоящая и одна на всех (атлас Natural Earth), и место
// имени — настоящие долгота и широта, переведённые той же проекцией, что запекала землю
// (`world/atlas/project.cellOf`). Имена — общеизвестная география, как на старой карте: море видно и с
// пергамента.
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import { cellOf } from '@/world/atlas/project';

export type RegionKind = 'ocean' | 'sea' | 'gulf' | 'range' | 'hills' | 'island';

interface RegionDef {
  name: string;
  kind: RegionKind;
  lon: number;
  lat: number;
}

/** Порядок — важность: при тесноте раньше встаёт то, что выше. */
const REGIONS: readonly RegionDef[] = [
  { name: 'Атлантический океан', kind: 'ocean', lon: -13.5, lat: 45.5 },
  { name: 'Средиземное море', kind: 'sea', lon: 17.5, lat: 34.6 },
  { name: 'Северное море', kind: 'sea', lon: 3.5, lat: 56.0 },
  { name: 'Балтийское море', kind: 'sea', lon: 18.8, lat: 56.6 },
  { name: 'Чёрное море', kind: 'sea', lon: 34.0, lat: 43.4 },
  { name: 'Тирренское море', kind: 'sea', lon: 12.2, lat: 39.8 },
  { name: 'Адриатическое море', kind: 'sea', lon: 15.6, lat: 42.9 },
  { name: 'Ионическое море', kind: 'sea', lon: 19.2, lat: 37.6 },
  { name: 'Эгейское море', kind: 'sea', lon: 25.0, lat: 38.8 },
  { name: 'Лигурийское море', kind: 'sea', lon: 8.9, lat: 43.6 },
  { name: 'Балеарское море', kind: 'sea', lon: 2.4, lat: 40.4 },
  { name: 'Море Альборан', kind: 'sea', lon: -3.4, lat: 36.0 },
  { name: 'Левантийское море', kind: 'sea', lon: 32.5, lat: 33.6 },
  { name: 'Ирландское море', kind: 'sea', lon: -5.0, lat: 53.7 },
  { name: 'Азовское море', kind: 'sea', lon: 36.6, lat: 46.1 },
  { name: 'Мраморное море', kind: 'gulf', lon: 28.1, lat: 40.75 },
  { name: 'Бискайский залив', kind: 'gulf', lon: -4.5, lat: 45.2 },
  { name: 'Лионский залив', kind: 'gulf', lon: 4.2, lat: 42.9 },
  { name: 'Ла-Манш', kind: 'gulf', lon: -1.2, lat: 50.1 },
  { name: 'Ботнический залив', kind: 'gulf', lon: 20.3, lat: 62.3 },
  { name: 'Финский залив', kind: 'gulf', lon: 26.0, lat: 59.85 },
  { name: 'Залив Сидра', kind: 'gulf', lon: 18.6, lat: 31.6 },
  { name: 'Альпы', kind: 'range', lon: 10.2, lat: 46.6 },
  { name: 'Пиренеи', kind: 'range', lon: 0.6, lat: 42.7 },
  { name: 'Карпаты', kind: 'range', lon: 24.2, lat: 47.9 },
  { name: 'Апеннины', kind: 'range', lon: 13.6, lat: 42.4 },
  { name: 'Атлас', kind: 'range', lon: -5.2, lat: 32.4 },
  { name: 'Балканы', kind: 'range', lon: 25.0, lat: 42.75 },
  { name: 'Динарское нагорье', kind: 'range', lon: 17.6, lat: 43.9 },
  { name: 'Тавр', kind: 'range', lon: 33.0, lat: 37.2 },
  { name: 'Понтийские горы', kind: 'range', lon: 38.5, lat: 40.7 },
  { name: 'Кавказ', kind: 'range', lon: 43.5, lat: 42.8 },
  { name: 'Скандинавские горы', kind: 'range', lon: 14.0, lat: 64.5 },
  { name: 'Пинд', kind: 'range', lon: 21.2, lat: 39.8 },
  { name: 'Родопы', kind: 'hills', lon: 24.6, lat: 41.6 },
  { name: 'Кантабрийские горы', kind: 'hills', lon: -5.0, lat: 43.0 },
  { name: 'Центральный массив', kind: 'hills', lon: 3.0, lat: 45.2 },
  { name: 'Судеты', kind: 'hills', lon: 16.0, lat: 50.7 },
  { name: 'Рудные горы', kind: 'hills', lon: 13.0, lat: 50.5 },
  { name: 'Сьерра-Невада', kind: 'hills', lon: -3.3, lat: 37.1 },
  { name: 'Шварцвальд', kind: 'hills', lon: 8.2, lat: 48.2 },
  { name: 'Юра', kind: 'hills', lon: 6.1, lat: 46.8 },
  { name: 'Вогезы', kind: 'hills', lon: 7.0, lat: 48.1 },
  { name: 'Грампианские горы', kind: 'hills', lon: -4.4, lat: 56.9 },
  { name: 'Сицилия', kind: 'island', lon: 14.2, lat: 37.55 },
  { name: 'Сардиния', kind: 'island', lon: 9.0, lat: 40.0 },
  { name: 'Корсика', kind: 'island', lon: 9.1, lat: 42.15 },
  { name: 'Крит', kind: 'island', lon: 24.9, lat: 35.25 },
  { name: 'Кипр', kind: 'island', lon: 33.2, lat: 35.05 },
  { name: 'Майорка', kind: 'island', lon: 2.95, lat: 39.6 },
];

export interface Region {
  name: string;
  kind: RegionKind;
  /** Мировая точка имени (дробная клетка). */
  x: number;
  y: number;
  /** Важность: индекс в списке (меньше — важнее). */
  rank: number;
}

/** Места имён в клетках мира — один раз на запуск; за краем мира имени нет. */
export const REGION_CELLS: readonly Region[] = REGIONS.map((r, rank) => {
  const c = cellOf(r.lon, r.lat);
  return { name: r.name, kind: r.kind, x: c.col + WORLD_ORIGIN.x, y: c.row + WORLD_ORIGIN.y, rank };
}).filter((r) => r.x >= WORLD_ORIGIN.x && r.y >= WORLD_ORIGIN.y && r.x < WORLD_ORIGIN.x + WORLD_SIZE && r.y < WORLD_ORIGIN.y + WORLD_SIZE);

/** Имена видны издали и уходят вблизи: с какого масштаба гаснут и с какого их нет. */
export const REGION_FULL = 9;
export const REGION_GONE = 20;

export function regionAlpha(scale: number): number {
  if (scale <= REGION_FULL) return 1;
  if (scale >= REGION_GONE) return 0;
  return 1 - (scale - REGION_FULL) / (REGION_GONE - REGION_FULL);
}

/** Кегль имени: океан и моря крупнее гор, острова — мельче всех; вблизи кегль чуть растёт. */
export function regionSize(kind: RegionKind, scale: number): number {
  const base = kind === 'ocean' ? 21 : kind === 'sea' ? 17 : kind === 'gulf' || kind === 'range' ? 14 : 12;
  return Math.round(base + Math.min(3, Math.max(0, (scale - 5) * 0.3)));
}

export const onWater = (kind: RegionKind): boolean => kind === 'ocean' || kind === 'sea' || kind === 'gulf';
