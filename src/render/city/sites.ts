// Места 24 построек игры в городе (docs/city.md, раздел 5): у каждой — коробки в мире, снятые с самих
// моделей (`Builder.extent`), по ним касание, значок над крышей, кольцо выбора и подсветка обучения.
// Чистый модуль без three: его зовут сборка (`budget.buildStatic`), сцена города и тест касания.
//
// Места — данные вида «город», не игры: набеги, осады и бой от положения построек не зависят.
import type { BuildingTypeId } from '@/game/types';
import type { Extent } from './geom';
import { heightAt, type P } from './layout';
import { WALL_H } from './forts';

/**
 * Постройки игры в порядке таблицы docs/city.md, раздел 5. Номер + 1 — четвёртый байт `cfg` вершины
 * (`geom.Builder.owner`): по нему шейдер подсвечивает выбранную постройку целиком — все дома Жилищ,
 * все башни, всю стену.
 */
export const CITY_OWNERS: readonly BuildingTypeId[] = [
  'campfire',
  'town_hall',
  'houses',
  'storage',
  'church',
  'statue',
  'market',
  'workshop',
  'smithy',
  'stable',
  'tavern',
  'infirmary',
  'barracks',
  'cache',
  'watch',
  'tower',
  'palisade',
  'gathering',
  'sawmill',
  'quarry',
  'hunter_hut',
  'mine',
  'farm',
  'pen',
];

/** Байт владельца для вершины: 0 — убранство без постройки. */
export const ownerCode = (t: BuildingTypeId): number => CITY_OWNERS.indexOf(t) + 1;

/**
 * Коробка постройки в мире: середина по плану (x, z), направление «вперёд» (fx, fz) — единичное,
 * полуразмеры вперёд (`hf`) и вправо (`hr`), низ и верх.
 */
export interface Site {
  type: BuildingTypeId;
  x: number;
  z: number;
  fx: number;
  fz: number;
  hf: number;
  hr: number;
  y0: number;
  y1: number;
}

/** Коробка из охвата вершин в рамке (cx, cz, fx, fz) — середина сдвигается в середину охвата. */
export function siteOf(type: BuildingTypeId, e: Extent, cx: number, cz: number, fx: number, fz: number): Site {
  const f = (e.f0 + e.f1) / 2;
  const r = (e.r0 + e.r1) / 2;
  return {
    type,
    // «Вправо» в рамке — (fz, −fx), как у `kit.Frame`.
    x: cx + fx * f + fz * r,
    z: cz + fz * f - fx * r,
    fx,
    fz,
    hf: (e.f1 - e.f0) / 2,
    hr: (e.r1 - e.r0) / 2,
    y0: e.y0,
    y1: e.y1,
  };
}

/** Стена — звеньями по ~12 м: коробка на звено, высота — от подножия до верха парапета. */
export function wallSites(pts: readonly P[]): Site[] {
  const out: Site[] = [];
  const n = pts.length;
  let k = 0;
  while (k < n) {
    const a = pts[k];
    let j = k;
    let len = 0;
    while (j < k + 12 && len < 12) {
      const p = pts[j % n];
      const q = pts[(j + 1) % n];
      len += Math.hypot(q.x - p.x, q.z - p.z);
      j++;
    }
    const b = pts[j % n];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const fx = -(b.z - a.z) / l;
    const fz = (b.x - a.x) / l;
    const lo = Math.min(heightAt(a.x, a.z), heightAt(b.x, b.z));
    const hi = Math.max(heightAt(a.x, a.z), heightAt(b.x, b.z));
    out.push({ type: 'palisade', x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, fx, fz, hf: 1.6, hr: l / 2, y0: lo - 1, y1: hi + WALL_H + 2.2 });
    k = j;
  }
  return out;
}

/** Углы коробки — восемь точек мира (x, y, z). */
export function siteCorners(s: Site): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const sf of [-1, 1]) {
    for (const sr of [-1, 1]) {
      const x = s.x + s.fx * s.hf * sf + s.fz * s.hr * sr;
      const z = s.z + s.fz * s.hf * sf - s.fx * s.hr * sr;
      out.push([x, s.y0, z], [x, s.y1, z]);
    }
  }
  return out;
}

/** Площадь коробки в плане — мера «главного» места постройки. */
const area = (s: Site): number => s.hf * s.hr;

/**
 * Главное место постройки — по нему значок, кольцо выбора и подсветка обучения. Одна коробка — она;
 * у Жилищ — дом у площади (ближайший к её середине), у башен — надвратная главных ворот (самая
 * большая), у Тайника — донжон (самый высокий: палас рядом ниже), у стены — звено южной половины
 * дальше всех от башен (звено у самой башни прячется за ней).
 */
export function mainSite(sites: readonly Site[], type: BuildingTypeId): Site | null {
  const own = sites.filter((s) => s.type === type);
  if (own.length === 0) return null;
  if (type === 'houses') return own.reduce((a, b) => (Math.hypot(a.x, a.z) <= Math.hypot(b.x, b.z) ? a : b));
  if (type === 'cache') return own.reduce((a, b) => (a.y1 - a.y0 >= b.y1 - b.y0 ? a : b));
  if (type === 'palisade') {
    const towers = sites.filter((s) => s.type === 'tower' || s.type === 'watch');
    const clear = (s: Site): number => Math.min(...towers.map((t) => Math.hypot(t.x - s.x, t.z - s.z)));
    const south = own.filter((s) => s.z > 0);
    return (south.length > 0 ? south : own).reduce((a, b) => (clear(a) >= clear(b) ? a : b));
  }
  return own.reduce((a, b) => (area(a) >= area(b) ? a : b));
}
