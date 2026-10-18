// Мерцание у окна (docs/city_v3.md, Г-9): подоконник южного окна (там сидит кот) темнел и светлел. Причина — две грани
// в одной плоскости: верх плиты подоконника и низ откоса проёма; видеокарта при каждом шаге взгляда отдавала пиксель то
// одной, то другой. Тест ищет в модели покоев грани, лежащие друг на друге лицом в одну сторону, — у окна и всюду. Второе —
// тень города за окном: изнутри её коробка стоит от стены донжона вперёд и на сетке своих текселей, качание головы её не
// двигает (`city/camera.shadowSnap`).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRoom } from './build';
import { HALF } from './plan';
import type { Mesher } from './geo';
import { cityShadowHalf, INSIDE_SHADOW_AHEAD, shadowSnap } from '../city/camera';
import { CITY_SPEC } from '../city/spec';

type P3 = [number, number, number];
interface Tri {
  a: P3;
  b: P3;
  c: P3;
  n: P3;
  d: number;
}

const sub = (p: P3, q: P3): P3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: P3, q: P3): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: P3, q: P3): P3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];

function trisOf(ms: Mesher[], at: P3 = [0, 0, 0]): Tri[] {
  const out: Tri[] = [];
  for (const m of ms) {
    const { pos, idx } = m.b;
    const v = (i: number): P3 => [pos[i * 3] + at[0], pos[i * 3 + 1] + at[1], pos[i * 3 + 2] + at[2]];
    for (let t = 0; t < idx.length; t += 3) {
      const a = v(idx[t]);
      const b = v(idx[t + 1]);
      const c = v(idx[t + 2]);
      const n = cross(sub(b, a), sub(c, a));
      const l = Math.hypot(...n);
      // Вырожденные (точки, нити) не видны — пропускаем.
      if (l < 1e-7) continue;
      const u: P3 = [n[0] / l, n[1] / l, n[2] / l];
      out.push({ a, b, c, n: u, d: dot(u, a) });
    }
  }
  return out;
}

/** Площадь пересечения двух треугольников одной плоскости (в её осях, отсечением выпуклого многоугольника). */
function overlap(s: Tri, t: Tri): number {
  const n = s.n;
  const ref: P3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = cross(ref, n);
  const l1 = Math.hypot(...e1);
  const ex: P3 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const ey = cross(n, ex);
  const to2 = (p: P3): [number, number] => [dot(p, ex), dot(p, ey)];
  const ccw = (poly: [number, number][]): [number, number][] => {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a < 0 ? poly.reverse() : poly;
  };
  let poly = ccw([to2(s.a), to2(s.b), to2(s.c)]);
  const clip = ccw([to2(t.a), to2(t.b), to2(t.c)]);
  for (let i = 0; i < 3 && poly.length; i++) {
    const p = clip[i];
    const q = clip[(i + 1) % 3];
    const side = (r: [number, number]): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const next: [number, number][] = [];
    for (let k = 0; k < poly.length; k++) {
      const r = poly[k];
      const w = poly[(k + 1) % poly.length];
      const sr = side(r);
      const sw = side(w);
      if (sr >= 0) next.push(r);
      if (sr * sw < 0) {
        const f = sr / (sr - sw);
        next.push([r[0] + (w[0] - r[0]) * f, r[1] + (w[1] - r[1]) * f]);
      }
    }
    poly = next;
  }
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area) / 2;
}

/** Пары граней лицом в одну сторону в одной плоскости (ближе `GAP`) с общей площадью больше `min` м² (5 см² — с трёх метров пятно в несколько точек экрана). */
function stacked(tris: Tri[], min = 5e-4): { at: P3; area: number; n: P3; gap: number; tris: Tri[] }[] {
  const key = (t: Tri, dd: number): string => `${Math.round(t.n[0] * 20)},${Math.round(t.n[1] * 20)},${Math.round(t.n[2] * 20)},${Math.floor(t.d / GAP) + dd}`;
  const buckets = new Map<string, number[]>();
  tris.forEach((t, i) => {
    const k = key(t, 0);
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  });
  const out: { at: P3; area: number; n: P3; gap: number; tris: Tri[] }[] = [];
  tris.forEach((s, i) => {
    for (const dd of [0, 1]) {
      for (const j of buckets.get(key(s, dd)) ?? []) {
        if (dd === 0 && j <= i) continue;
        const t = tris[j];
        if (dot(s.n, t.n) < 0.9995 || Math.abs(s.d - t.d) > GAP) continue;
        const a = overlap(s, t);
        if (a > min) out.push({ at: [(s.a[0] + s.b[0] + s.c[0]) / 3, (s.a[1] + s.b[1] + s.c[1]) / 3, (s.a[2] + s.b[2] + s.c[2]) / 3], area: a, n: s.n, gap: Math.abs(s.d - t.d), tris: [s, t] });
      }
    }
  });
  return out;
}

/**
 * Ближе скольких метров две грани одной плоскости — одна глубина (Г-9): глубина покоев сжата в первую долю буфера
 * (`city/inside.INSIDE_DEPTH`, 0,004), ближняя плоскость — 5 см; в 24 битах шаг глубины — 0,3 мм на метре и 2,7 мм на трёх.
 * Через всю комнату (до 3 м) грани ближе этого спорят за пиксель.
 */
const GAP = 0.003;

/** Лежит ли точка плана (x, z) внутри треугольника по плану. */
function inTri2(t: Tri, x: number, z: number): boolean {
  const s = (p: P3, q: P3): number => (q[0] - p[0]) * (z - p[2]) - (q[2] - p[2]) * (x - p[0]);
  const a = s(t.a, t.b);
  const b = s(t.b, t.c);
  const c = s(t.c, t.a);
  return (a >= 0 && b >= 0 && c >= 0) || (a <= 0 && b <= 0 && c <= 0);
}

const fmt = (p: P3): string => p.map((x) => x.toFixed(2)).join(', ');

describe('покои: свет у окна ровный (Г-9)', () => {
  it('в модели покоев нет граней, лежащих друг на друге лицом в одну сторону — у окон и всюду, на каждом уровне', () => {
    for (const detail of [0, 1, 2] as const) {
      const room = buildRoom(detail);
      // С крышками сундуков, закрытыми (Г-9): в осях петли — сдвиг на петлю.
      const tris = [...trisOf([room.stone, room.cloth]), ...Object.values(room.lids).flatMap((l) => trisOf([l.stone, l.cloth], l.hinge))];
      // Граница области — вся комната с нишами окон и тамбуром; подоконник южного окна (там сидит кот) — внутри неё.
      expect(tris.some((t) => t.n[1] > 0.99 && Math.abs(t.a[1] - 0.8) < 1e-6 && t.a[2] > 6.0), 'плита подоконника в модели').toBe(true);
      // Видимое глазу: грань лицом вверх выше глаза (стоя — 1,62 м) и лицом вниз ниже глаза лёжа (1,0 м) не видна никогда.
      // Видимое глазу: грань лицом вверх выше глаза (стоя — 1,62 м), лицом вниз ниже глаза лёжа (1,0 м) и лицом в стену у
      // самой стены не видны никогда.
      const intoWall = (f: { at: P3; n: P3 }): boolean => (Math.abs(f.at[0]) > HALF - 0.002 && f.n[0] * f.at[0] > 0.5) || (Math.abs(f.at[2]) > HALF - 0.002 && f.n[2] * f.at[2] > 0.5 && Math.abs(f.at[2]) < HALF + 0.05);
      // И низ того, что лежит на полке или столе (в миллиметрах над ней лицом вниз): его заслоняет сама полка.
      const resting = (f: { at: P3; n: P3 }): boolean => f.n[1] < -0.9 && tris.some((t) => t.n[1] > 0.99 && t.a[1] <= f.at[1] && t.a[1] > f.at[1] - 0.006 && inTri2(t, f.at[0], f.at[2]));
      const found = stacked(tris).filter((f) => !(f.n[1] > 0.5 && f.at[1] > 1.7) && !(f.n[1] < -0.5 && f.at[1] < 0.9) && !intoWall(f) && !resting(f));
      expect(found.map((f) => `(${fmt(f.at)}) ${(f.area * 1e4).toFixed(0)} см²`), `уровень ${detail}: грани друг на друге`).toEqual([]);
    }
  });

  it('тень города изнутри: коробка — от стены донжона вперёд, на сетке текселей; качание головы её не двигает', () => {
    const half = cityShadowHalf(190);
    // Коробка берёт город от стены донжона до точки взгляда в 130 м: середина в `INSIDE_SHADOW_AHEAD` м вперёд.
    expect(INSIDE_SHADOW_AHEAD - half, 'ближний край коробки — у донжона').toBeLessThanOrEqual(0);
    expect(INSIDE_SHADOW_AHEAD + half, 'дальний край — за точкой взгляда').toBeGreaterThanOrEqual(130);
    for (const q of ['low', 'medium', 'high'] as const) {
      const texel = (2 * half) / CITY_SPEC[q].shadowMap;
      for (const sun of [
        { x: -0.41, y: 0.46, z: 0.79 },
        { x: 0.7, y: 0.2, z: -0.3 },
        { x: 0.05, y: 0.98, z: 0.1 },
      ]) {
        // Голова дышит у окна: взгляд качается на тысячные доли радиана — середина коробки ездит на сантиметры.
        const at = { x: 12.3, y: 0, z: -80.7 };
        const base = shadowSnap(at, sun, texel);
        const seen = new Set<string>();
        let moved = 0;
        for (let k = 0; k < 40; k++) {
          const sway = 0.003 * Math.sin(k * 0.7) * INSIDE_SHADOW_AHEAD;
          const p = shadowSnap({ x: at.x + sway * 0.6, y: 0, z: at.z + sway * 0.8 }, sun, texel);
          const d = Math.hypot(p.x - base.x, p.y - base.y, p.z - base.z);
          // Коробка или стоит, или шагнула на целые тексели — сетка тени та же.
          if (d > 1e-9) moved++;
          // Место коробки — поперёк светила (вдоль него сдвиг тень не меняет).
          const l = Math.hypot(sun.x, sun.y, sun.z);
          const along = (p.x * sun.x + p.y * sun.y + p.z * sun.z) / (l * l);
          seen.add(`${(p.x - sun.x * along).toFixed(5)},${(p.y - sun.y * along).toFixed(5)},${(p.z - sun.z * along).toFixed(5)}`);
          // Узел сетки: проекция середины на оси камеры тени — целое число текселей.
          const again = shadowSnap(p, sun, texel);
          expect(Math.hypot(again.x - p.x, again.y - p.y, again.z - p.z), `${q}: узел сетки`).toBeLessThan(1e-6);
        }
        // Коробка встаёт лишь в немногие узлы (размах качания — в текселях), а не в сорок мест за сорок кадров.
        const amp = 0.003 * INSIDE_SHADOW_AHEAD;
        const cells = Math.ceil((2 * amp) / texel) + 1;
        expect(seen.size, `${q}: мест коробки за 40 кадров качания`).toBeLessThanOrEqual(cells * cells);
        expect(moved).toBeLessThan(40);
        // Без сетки середина ездила бы за каждым кадром: проверка не пустая.
        const raw = { x: at.x + 0.003 * INSIDE_SHADOW_AHEAD * 0.6, y: 0, z: at.z };
        expect(Math.hypot(raw.x - at.x, raw.z - at.z)).toBeGreaterThan(0.1);
      }
    }
  });

  it('сцена города изнутри ставит солнце от коробки теней на сетке, а свет считает от самого светила', () => {
    const src = readFileSync(join(__dirname, '../city/scene.ts'), 'utf8');
    expect(src).toMatch(/this\.inside \? shadowSnap\(this\.shadowAt, sun\.position,/);
    expect(src, 'направление на солнце — от светила к его цели, а не к точке взгляда').not.toMatch(/sun\.position\)\.sub\(this\.eye\)/);
  });
});
