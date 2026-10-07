// Жизнь города (docs/city.md, 11.4): фигуры той цены, что считает бюджет; стража — на боевом ходу стены,
// прохожие — на улицах и площади; ночью улицы пустеют, стража остаётся; на низком уровне фигур меньше.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITIES } from '../quality';
import { cityPlan, distPoly, insidePoly } from './layout';
import { buildStatic } from './budget';
import { wallTops } from './forts';
import { CITY_SMOKE, CITY_WIND, CityLife, CitySmoke, NIGHT_SHARE, ROUTE_MAX, beastGeometry, guardGeometry, patrolAt, personGeometry, poseAt, type Route } from './life';
import { HEARTH_LOOK } from '../weather';
import { LIFE_CAP, LIFE_TRIS } from './spec';

const plan = cityPlan();
const st = buildStatic(plan, 'medium');

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Положения экземпляров, которые меш рисует сейчас. */
function placed(im: THREE.InstancedMesh): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const m = new THREE.Matrix4();
  for (let k = 0; k < im.count; k++) {
    im.getMatrixAt(k, m);
    out.push(new THREE.Vector3().setFromMatrixPosition(m));
  }
  return out;
}

const mesh = (life: CityLife, name: string): THREE.InstancedMesh => life.group.getObjectByName(name) as THREE.InstancedMesh;

describe('город: жизнь', () => {
  it('фигуры той цены, что считает бюджет', () => {
    expect(tris(personGeometry())).toBe(LIFE_TRIS.person);
    expect(tris(guardGeometry())).toBe(LIFE_TRIS.guard);
    expect(tris(beastGeometry())).toBe(LIFE_TRIS.beast);
  });

  it('уровни идут по убыванию: низкий не богаче среднего, средний — высокого', () => {
    for (const k of ['people', 'guards', 'birds', 'animals', 'smoke', 'lanterns', 'carts', 'ducks', 'boats', 'banners'] as const) {
      expect(LIFE_CAP.low[k], k).toBeLessThanOrEqual(LIFE_CAP.medium[k]);
      expect(LIFE_CAP.medium[k], k).toBeLessThanOrEqual(LIFE_CAP.high[k]);
    }
    expect(LIFE_CAP.low.people).toBeLessThan(LIFE_CAP.high.people);
  });

  it('стража — на боевом ходу стены, прохожие — на улицах, у рядов и колодца', () => {
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'medium' });
    life.set(1000, 1000, []);
    for (let k = 0; k < 20; k++) life.update(0.1, k * 0.1, 0, 0);
    const guards = placed(mesh(life, 'city-guards'));
    const people = placed(mesh(life, 'city-people'));
    // Граница области: днём при большом городе фигур — сколько позволяет уровень.
    expect(guards.length).toBe(LIFE_CAP.medium.guards);
    expect(people.length).toBe(LIFE_CAP.medium.people);
    const tops = wallTops(plan.wall);
    const top = (p: THREE.Vector3): number => {
      let best = 0;
      let bd = Infinity;
      plan.wall.forEach((w, k) => {
        const d = Math.hypot(w.x - p.x, w.z - p.z);
        if (d < bd) {
          bd = d;
          best = tops[k];
        }
      });
      return best;
    };
    for (const g of guards) {
      expect(distPoly({ x: g.x, z: g.z }, plan.wall, true), 'страж у стены').toBeLessThan(2);
      expect(Math.abs(g.y - top(g)), 'страж на высоте хода').toBeLessThan(1.5);
    }
    const streets = [...plan.streets, ...plan.roads];
    for (const p of people) {
      const q = { x: p.x, z: p.z };
      const onStreet = streets.some((s) => distPoly(q, s.pts) < s.half + 1);
      const onSquare = insidePoly(q, plan.square) || Math.hypot(q.x - plan.well.x, q.z - plan.well.z) < 8 || (Math.abs(q.x + 9) < 13 && Math.abs(q.z + 29) < 5);
      expect(onStreet || onSquare, `прохожий на улице или площади (${q.x.toFixed(0)}, ${q.z.toFixed(0)})`).toBe(true);
    }
    life.dispose();
  });

  it('ночью улицы пустеют до трети, стража остаётся; людей — от населения, не больше уровня', () => {
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'low' });
    life.set(50, 8, []);
    life.update(0.1, 0, 0, 0);
    const day = mesh(life, 'city-people').count;
    const guardsDay = mesh(life, 'city-guards').count;
    expect(day).toBe(50);
    life.update(0.1, 0.1, 1, 0);
    const night = mesh(life, 'city-people').count;
    expect(night).toBeLessThanOrEqual(Math.ceil(day * NIGHT_SHARE));
    expect(night).toBeLessThanOrEqual(Math.ceil(day * 0.25));
    expect(night).toBeGreaterThan(0);
    expect(mesh(life, 'city-guards').count).toBe(guardsDay);
    life.set(100000, 100000, []);
    life.update(0.1, 0.2, 0, 0);
    expect(mesh(life, 'city-people').count).toBe(LIFE_CAP.low.people);
    life.dispose();
  });

  it('ночью у каждого стража факел над плечом, днём факелы погашены', () => {
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'medium' });
    const torches = life.group.getObjectByName('city-torches') as THREE.Points;
    life.set(100, 12, []);
    life.update(0.1, 0, 0, 0);
    expect(torches.visible, 'днём факела нет').toBe(false);
    life.update(0.1, 0.1, 1, 0);
    const guards = placed(mesh(life, 'city-guards'));
    // Граница области: ночь и стража на стене — иначе факелов нечем проверить.
    expect(guards.length).toBe(12);
    expect(torches.visible, 'ночью факел горит').toBe(true);
    expect(torches.geometry.drawRange.count).toBe(guards.length);
    const pos = torches.geometry.attributes.position as THREE.BufferAttribute;
    guards.forEach((g, i) => {
      const t = new THREE.Vector3().fromBufferAttribute(pos, i);
      expect(Math.hypot(t.x - g.x, t.z - g.z), 'факел у своего стража').toBeLessThan(0.6);
      expect(t.y - g.y, 'факел над плечом').toBeGreaterThan(1.6);
      expect(t.y - g.y, 'факел над плечом').toBeLessThan(2.6);
    });
    life.dispose();
  });

  it('флаги и дым — по одному ветру, и это ветер посёлка', () => {
    const deg = (a: { x: number; z: number }, c: { x: number; z: number }): number =>
      (Math.acos(Math.min(1, (a.x * c.x + a.z * c.z) / (Math.hypot(a.x, a.z) * Math.hypot(c.x, c.z)))) * 180) / Math.PI;
    const village = HEARTH_LOOK.drift!;
    expect(deg(CITY_WIND, village), 'ветер города — снос дыма очагов посёлка').toBeLessThan(0.5);
    expect(deg(CITY_SMOKE.drift!, village), 'дым города — по ветру посёлка').toBeLessThan(0.5);
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'medium' });
    const g = (life.group.getObjectByName('city-flags') as THREE.Mesh).geometry;
    const pos = g.attributes.position;
    const flap = g.attributes.flap;
    // Граница области: флаги есть, и у каждого есть дальний край полотнища (flap = 1).
    let tips = 0;
    for (const [x, , z] of st.flagTops) {
      let best = -1;
      let bd = Infinity;
      for (let k = 0; k < pos.count; k++) {
        if (flap.getX(k) < 0.999) continue;
        const d = Math.hypot(pos.getX(k) - x, pos.getZ(k) - z);
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      expect(bd, 'дальний край полотнища у своего древка').toBeLessThan(3);
      expect(deg({ x: pos.getX(best) - x, z: pos.getZ(best) - z }, village), 'полотнище смотрит по ветру').toBeLessThan(1);
      tips++;
    }
    expect(tips).toBe(plan.towers.length);
    life.dispose();
  });

  it('у каждой башни флаг; дым идёт не из всех труб и не больше уровня; зимой топят больше, ночью меньше', () => {
    for (const q of QUALITIES) {
      const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: q });
      const flags = life.group.getObjectByName('city-flags') as THREE.Mesh;
      expect(tris(flags.geometry)).toBe(st.flagTops.length * LIFE_TRIS.flag);
      expect(st.flagTops.length).toBe(plan.towers.length);
      const smoke = life.group.getObjectByName('city-smoke') as THREE.Points;
      const puff = smoke.geometry.attributes.puff;
      // Порог трубы — у каждого её клуба один; трубы — по пять клубов.
      const thr: number[] = [];
      for (let k = 0; k < puff.count; k += 5) thr.push(puff.getZ(k));
      // Граница области: дым есть, труб с дымом не больше уровня.
      expect(thr.length).toBeGreaterThan(0);
      expect(thr.length).toBeLessThanOrEqual(LIFE_CAP[q].smoke);
      const burning = (night: number, snow: number): number => thr.filter((t) => t < CitySmoke.share(night, snow)).length;
      const all = Math.min(LIFE_CAP[q].smoke, st.chimneys.length);
      // Летним днём топит меньше половины труб города, в мороз — больше, но и тогда не все; ночью огонь прикрыт.
      expect(burning(0, 0), q).toBeLessThan(st.chimneys.length * 0.5);
      expect(burning(0, 1), q).toBeGreaterThan(burning(0, 0));
      expect(burning(0, 1), q).toBeLessThan(all);
      expect(burning(1, 0), q).toBeLessThan(burning(0, 0));
      expect(burning(0, 0), q).toBeGreaterThan(0);
      life.dispose();
    }
  });

  it('прохожие — функция времени: тот же миг — то же место, как бы ни шли кадры; шаг без скачков', () => {
    const a = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'medium' });
    const b = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'medium' });
    a.set(1000, 1000, []);
    b.set(1000, 1000, []);
    // a — кадрами по 0.1 с до 30 с, b — сразу в 30 с (вошёл в город, вернулся из фона).
    for (let k = 0; k <= 300; k++) a.update(0.1, k * 0.1, 0, 0);
    b.update(5, 30, 0, 0);
    for (const name of ['city-people', 'city-guards']) {
      const pa = placed(mesh(a, name));
      const pb = placed(mesh(b, name));
      expect(pa.length).toBeGreaterThan(0);
      pa.forEach((p, k) => expect(p.distanceTo(pb[k]), `${name} ${k}`).toBeLessThan(1e-4));
    }
    // Без скачков: за 0.05 с никто не уходит дальше тройного шага (1.5 м/с) — и на перекрёстках, и на поворотах маршрута.
    // Тройного, а не одного: на крутом изломе улицы сдвиг от середины поворачивает вместе с касательной, и внешний край
    // поворота идёт быстрее середины (до двух шагов у угла улицы вдоль стены). Скачок — это метры за кадр: так сдвиг
    // прыгал на изломе, пока касательная бралась отрезком (0.5 м за 0.05 с). Граница области: каждый маршрут — на полном
    // своём круге, туда и обратно (2 · длина / скорость), и маршрут не длиннее своей меры (`ROUTE_MAX`).
    const L = a as unknown as { routes: (Route | null)[]; paths: Parameters<typeof poseAt>[0] };
    let max = 0;
    let checked = 0;
    for (const r of L.routes) {
      if (!r) continue;
      expect(r.len, 'маршрут не длиннее меры').toBeLessThanOrEqual(ROUTE_MAX + 1e-6);
      const period = (2 * r.len) / r.v;
      let prev = { ...poseAt(L.paths, r, 0) };
      for (let t = 0.05; t <= period + 0.05; t += 0.05) {
        const p = poseAt(L.paths, r, t);
        max = Math.max(max, Math.hypot(p.x - prev.x, p.z - prev.z));
        prev = { ...p };
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(LIFE_CAP.medium.people * 0.6);
    expect(max, 'шаг за 0.05 с').toBeLessThan(1.5 * 0.05 * 3);
    a.dispose();
    b.dispose();
  });

  it('прохожие ходят по графу улиц: большинство сворачивает на другие улицы и на площадь', () => {
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'high' });
    const r = (life as unknown as { routes: ({ legs: { path: number }[] } | null)[] }).routes.filter((x) => x !== null);
    // Граница области: идущих — две трети потолка и больше.
    expect(r.length).toBeGreaterThan(LIFE_CAP.high.people * 0.6);
    const many = r.filter((x) => new Set(x!.legs.filter((l) => l.path >= 0).map((l) => l.path)).size > 1).length;
    expect(many / r.length, 'сворачивают').toBeGreaterThan(0.5);
    // Через площадь и меж рядов кто-то идёт всегда: пути площади — последние пять в графе.
    const paths = (life as unknown as { paths: unknown[] }).paths.length;
    const square = r.filter((x) => x!.legs.some((l) => l.path >= paths - 5)).length;
    expect(square, 'через площадь').toBeGreaterThan(r.length * 0.25);
    life.dispose();
  });

  it('дозор стража — функция времени: в своём отрезке, без скачков, на концах стоит', () => {
    let prev = patrolAt(0, 0.7, 22, 6, 0.3);
    let still = 0;
    // Граница области: два полных круга дозора (2 × (2·44/0.7 + 12) с).
    const cycle = (2 * 44) / 0.7 + 12;
    for (let t = 0.05; t < 2 * cycle; t += 0.05) {
      const g = patrolAt(t, 0.7, 22, 6, 0.3);
      expect(Math.abs(g.s)).toBeLessThanOrEqual(22 + 1e-9);
      expect(Math.abs(g.s - prev.s)).toBeLessThan(0.7 * 0.05 + 1e-6);
      if (g.moving === 0) still++;
      prev = g;
    }
    expect(still * 0.05, 'стоит на концах').toBeGreaterThan(2 * 2 * 6 * 0.9);
  });
});
