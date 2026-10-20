// Город игрока в роликах осады и боя у города (docs/polish.md, П-6): где стоит настоящий город относительно стены ролика,
// какая под полем его земля и где он уступает место бою. Свойства проверяются на осадах стенда и на штурмах стены с обеих
// сторон — тем же путём, что в игре: раскладка, вырез, сборка города, перевод домов.
import { describe, expect, it } from 'vitest';
import { QUALITIES, type Quality } from '../quality';
import { showOfSiege } from '@/ui/battle/siege';
import { standSiege } from '../siege/stand';
import { layoutOf } from '../siege/layout';
import { siegeReel } from '../siege/reel';
import { poseAt, type TrackPose } from '../siege/tracks';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from './record';
import { poseFigures, type TwPlan } from './plan';
import { figureFrame } from '../reel/troupe';
import { heightAt } from '../reel/terrain';
import { cityPlan, heightAt as cityHeight, axisX, halfAt } from '../city/layout';
import { houseBox, townPlan, townWorld } from '../city/town';
import { CITY_M, type TwWall } from './site';
import { TOWN_FACE, TOWN_GATE, TOWN_HALF, TOWN_WALL_TOWERS, boxToReel, frameOf, houseOfTown, toCity, toReel, townCut, townLift, type Box2 } from './town';

const PLAN = cityPlan();
const SIEGES = ['gates', 'storm', 'hunger', 'broken', 'paid', 'repair'] as const;
const WALLS = ['site=wall&us=defender', 'site=wall&us=attacker', 'site=gate', 'site=sortie', 'site=camp', 'site=joint'] as const;

const siegeOf = (name: string, q: Quality = 'medium') => {
  const { rec, report } = standSiege(new URLSearchParams(`case=${name}`));
  return showOfSiege(rec, report);
};
const battleOf = (site: string, q: Quality = 'medium'): TwPlan => {
  const b = standBattle(new URLSearchParams(`replay=tw&men=500&foe=560&seed=3&${site}`));
  return twPlanOfRecord(b.result, b.us, b.troops, q, b.militia, b.place, b.beastSide, b.site, undefined, b.openings);
};

describe('город в ролике: где он стоит', () => {
  it('переход ролик ↔ город взаимно обратный, ворота ролика — главные ворота города, внутрь — к площади', () => {
    for (const inward of [1, -1] as const) {
      const f = frameOf({ inward, gateX: 3, z: inward * 5 });
      for (const [x, z] of [[0, 0], [12, -30], [-25, 40], [3, 5]]) {
        const c = toCity(f, x, z);
        const r = toReel(f, c.x, c.z);
        expect(r.x, `обратный x (inward ${inward})`).toBeCloseTo(x, 6);
        expect(r.z, `обратный z (inward ${inward})`).toBeCloseTo(z, 6);
      }
      const g = toCity(f, 3, inward * 5);
      expect(g.x, 'ворота ролика — ворота города по X').toBeCloseTo(TOWN_GATE.x, 6);
      expect(g.z, 'наружная грань стены ролика — наружная грань стены города').toBeCloseTo(TOWN_FACE, 6);
      // Площадь города (середина её четырёхугольника) — по ту сторону стены, куда смотрит `inward`.
      const sq = toReel(f, 1, 2);
      expect((sq.z - inward * 5) * inward, `площадь внутри (inward ${inward})`).toBeGreaterThan(50);
      // Масштаб: метр города — `CITY_M` единиц ролика.
      const a = toReel(f, 0, 0);
      const b = toReel(f, 10, 0);
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(10 * CITY_M, 6);
    }
  });

  it('стена ролика — от угла до угла южной стены города: её боковые стены идут по бровке мыса к углам ролика', () => {
    const half = (halfAt(TOWN_GATE.z) - 4) * CITY_M;
    expect(TOWN_HALF).toBeCloseTo(half, 6);
    for (const name of SIEGES) {
      const lay = layoutOf(siegeOf(name), 'medium');
      expect(lay.wall!.halfX, `${name}: стена осады — южная стена города`).toBeCloseTo(TOWN_HALF, 6);
    }
    for (const site of WALLS) {
      const w = battleOf(site).site!.wall!;
      expect(w.halfX, `${site}: стена боя не короче южной стены города`).toBeGreaterThanOrEqual(TOWN_HALF - 1e-9);
    }
    // Ось мыса у ворот — середина стены: углы на равном расстоянии от ворот (ворота — на оси у начала стены, сантиметры).
    expect(Math.abs(axisX(TOWN_GATE.z) - TOWN_GATE.x)).toBeLessThan(0.05);
  });

  it('земля поля — земля города: растр под полем совпадает с мысом, подошва стены — ноль у ворот', () => {
    const fields = [...SIEGES.map((n) => layoutOf(siegeOf(n), 'medium')), ...WALLS.map((s) => battleOf(s))].map((l) => ({ field: l.field, wall: ('wall' in l ? l.wall : l.site?.wall) as TwWall }));
    for (const { field, wall } of fields) {
      expect(field.town, 'у места со стеной — земля города').toBeTruthy();
      expect(wall.base, 'подошва стены у ворот').toBeCloseTo(0, 1);
      const f = frameOf(wall);
      let n = 0;
      let worst = 0;
      // Где стоят и ходят люди и лежит плита: полоса строёв и лагеря (у края поля осады — берег реки, туда никто не ходит).
      const reach = Math.min(field.halfX, 50);
      for (let x = -reach; x <= reach; x += 3.7) {
        for (let z = field.minZ; z <= field.maxZ; z += 3.1) {
          // Граница области: точки — внутри поля и полосы строёв.
          expect(Math.abs(x) <= reach && z >= field.minZ && z <= field.maxZ).toBe(true);
          worst = Math.max(worst, Math.abs(heightAt(field, x, z) - townLift(f, x, z)));
          n++;
        }
      }
      expect(n).toBeGreaterThan(800);
      // Растр в 1.2 единицы на рельефе в десятки метров: расхождение — сантиметры.
      expect(worst, 'растр против мыса, единиц').toBeLessThan(0.06);
    }
    // Высота ролика — высота города масштабом.
    const lay = layoutOf(siegeOf('gates'), 'medium');
    const f = frameOf(lay.wall!);
    const c = toCity(f, 10, -40);
    expect(townLift(f, 10, -40)).toBeCloseTo((cityHeight(c.x, c.z) - cityHeight(TOWN_GATE.x, TOWN_GATE.z)) * CITY_M, 6);
  });

  it('дом города в ролике: место и фасад поворотом, конёк над землёй', () => {
    for (const inward of [1, -1] as const) {
      const f = frameOf({ inward, gateX: 0, z: 0 });
      // Фасад на юг (к воротам) — в ролике наружу, к полю (`−inward`).
      const h = houseOfTown(f, { x: 6, z: 100, fx: 0, fz: 1, w: 5, d: 10, floors: 2, top: cityHeight(6, 100) + 12, seed: 1 });
      expect(Math.cos(h.yaw) * inward, `фасад к полю (inward ${inward})`).toBeCloseTo(-1, 6);
      expect(h.w).toBeCloseTo(5 * CITY_M, 6);
      expect(h.top! - townLift(f, h.x, h.z), 'конёк над землёй, единиц').toBeCloseTo(12 * CITY_M, 1);
    }
  });
});

/** Дома, что остались под бой, — следы в единицах ролика (чуть внутрь: касаться стены дома можно). */
function houseBoxes(w: TwWall, inside: Box2[], outside: Box2): Box2[] {
  const { plan } = townPlan(PLAN, townCut(w, inside, outside));
  const f = frameOf(w);
  return [...plan.houses, ...plan.suburb].map((h) => {
    const b = boxToReel(f, houseBox(h));
    return { x0: b.x0 + 0.3, x1: b.x1 - 0.3, z0: b.z0 + 0.3, z1: b.z1 - 0.3 };
  });
}

const inBox = (b: Box2, x: number, z: number): boolean => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;

describe('город уступает место бою', () => {
  it.each(SIEGES)('осада %s: люди ролика за стеной не заходят в дома города (кадр каждые полсекунды)', (name) => {
    const show = siegeOf(name);
    const lay = layoutOf(show, 'medium');
    const w = lay.wall!;
    const boxes = houseBoxes(w, lay.town!.inside, lay.town!.outside);
    const reel = siegeReel(show, 'medium');
    const p: TrackPose = { x: 0, y: 0, z: 0, yaw: 0, clip: 'idle', time: 0, shown: true };
    let inside = 0;
    for (let t = 0; t <= reel.seconds; t += 0.5) {
      for (let i = 0; i < reel.tracks.count; i++) {
        poseAt(reel.tracks, i, t, reel.phase[i], p);
        if (!p.shown) continue;
        // Граница области: правило про людей за стеной — в городе, а не в поле.
        if ((p.z - w.z) * w.inward <= w.thick) continue;
        inside++;
        const hit = boxes.find((b) => inBox(b, p.x, p.z));
        expect(hit, `${name}: фигура ${i} на ${t.toFixed(1)} с в доме города (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeUndefined();
      }
    }
    expect(inside, `${name}: фигур за стеной в обходе`).toBeGreaterThan(200);
  });

  it.each(WALLS)('бой у стены %s: строи и бегущие за стеной не в домах города', (site) => {
    const plan = battleOf(site);
    const w = plan.site!.wall!;
    const boxes = houseBoxes(w, plan.site!.town!.inside as Box2[], plan.site!.town!.outside);
    const frame = figureFrame(plan.figures);
    let inside = 0;
    for (let t = 0; t <= plan.timing.end; t += 0.5) {
      poseFigures(plan, t, frame);
      for (let i = 0; i < plan.figures; i++) {
        if (!frame.shown[i]) continue;
        if ((frame.z[i] - w.z) * w.inward <= w.thick) continue;
        inside++;
        const hit = boxes.find((b) => inBox(b, frame.x[i], frame.z[i]));
        expect(hit, `${site}: фигура ${i} на ${t.toFixed(1)} с в доме города (${frame.x[i].toFixed(1)}, ${frame.z[i].toFixed(1)})`).toBeUndefined();
      }
    }
    // Граница области: на штурме за стеной — строи обороны; у ворот, на вылазке и у лагеря за стеной почти никого (стрелки
    // — на ходу стены, вышедшие — в поле), и правило там почти пустое — его держат штурмы.
    if (site.includes('wall')) expect(inside, `${site}: фигур за стеной в обходе`).toBeGreaterThan(1000);
  });

  it('вырез под бой: большие здания города остаются все, перед стеной — ни дома, ни двора, стена ролика — в кольце', () => {
    for (const q of QUALITIES) {
      const lay = layoutOf(siegeOf('gates'), q);
      const cut = townCut(lay.wall!, lay.town!.inside, lay.town!.outside);
      const { plan, cleared } = townPlan(PLAN, cut);
      expect(plan.civic.length, `${q}: храм, ратуша, склад, лазарет, трактир — все`).toBe(PLAN.civic.length);
      expect(plan.houses.length, `${q}: город не опустел`).toBeGreaterThan(PLAN.houses.length * 0.85);
      expect(cleared.length, `${q}: ушедшее закрывает земля ролика`).toBe(PLAN.houses.length - plan.houses.length + PLAN.suburb.length - plan.suburb.length + PLAN.stalls.length - plan.stalls.length);
      for (const h of plan.suburb) {
        const b = houseBox(h);
        expect(b.x1 < cut.field.x0 || b.x0 > cut.field.x1 || b.z1 < cut.field.z0 || b.z0 > cut.field.z1, `${q}: дом предместья перед стеной`).toBe(true);
      }
      // Кольцо: углы ролика в контуре, южной дуги города нет, башен на прямой ролика нет.
      expect(plan.wall.some((p) => p.x === cut.west.x && p.z === cut.west.z)).toBe(true);
      expect(plan.wall.some((p) => p.x === cut.east.x && p.z === cut.east.z)).toBe(true);
      expect(plan.wall.filter((p) => p.z > cut.west.z + 0.5).length, `${q}: южная дуга ушла`).toBe(0);
      expect(plan.towers.filter((t) => t.kind === 'gate' && t.z > 120).length, `${q}: главные ворота — ролика`).toBe(0);
      expect(plan.towers.filter((t) => t.kind === 'keep').length, `${q}: донжон на месте`).toBe(1);
    }
  });

  it('сборка города под ролик: тень — у ближних, всё здание в двух списках; дома у ворот — в единицах города', () => {
    const lay = layoutOf(siegeOf('gates'), 'medium');
    for (const wood of [false, true]) {
      const cut = { ...townCut(lay.wall!, lay.town!.inside, lay.town!.outside), wood };
      const w = townWorld({ quality: 'medium', cut, plan: PLAN, ground: false });
      expect((w.near.length + w.far.length) / 3, `${wood ? 'частокол' : 'камень'}: треугольники зданий`).toBe(w.buildingTris);
      expect(w.near.length, 'ближних с тенью меньше всех').toBeLessThan(w.far.length + w.near.length);
      expect(w.houses.length, 'дома у ворот — под огонь и дым').toBeGreaterThan(5);
      for (const h of w.houses) expect(h.top, 'конёк выше пола').toBeGreaterThan(cityHeight(h.x, h.z) + 5);
      expect(w.grid.index.length / 3, 'своя сетка земли').toBeGreaterThan(5000);
    }
  });
});

// Р-5 (docs/siege_v2.md, 21.1): в ролике осады своего города стояли деревянные стены первых версий — вид шёл от уровня
// частокола (брёвна до третьего, башен 2/4/6), а окно города рисует камень на любом уровне. Правило — одно: что в городе,
// то и в ролике.
describe('стены ролика — стены окна города', () => {
  it('башни стены ролика — башни южной стены плана города: вид, место, размер, высота', () => {
    const near = (t: { x: number; z: number }) => PLAN.towers.find((q) => Math.hypot(q.x - t.x, q.z - t.z) < 0.05);
    for (const t of [TOWN_WALL_TOWERS.east, TOWN_WALL_TOWERS.west, ...TOWN_WALL_TOWERS.inner]) {
      const q = near(t);
      expect(q, `башня (${t.x}, ${t.z}) — в плане города`).toBeTruthy();
      expect(q!.kind).toBe(t.kind);
      expect(q!.size).toBeCloseTo(t.size, 2);
      expect(q!.height).toBeCloseTo(t.height, 2);
    }
    // Промежуточные — все башни плана на линии южной стены между углами, кроме главных ворот (их надвратная — у ролика).
    const lay = layoutOf(siegeOf('gates'), 'medium');
    const cut = townCut(lay.wall!, lay.town!.inside, lay.town!.outside);
    const onFront = PLAN.towers.filter((q) => q.kind === 'square' && q.z > 0 && Math.abs(q.z - TOWN_GATE.z) < 5 && q.x > cut.west.x && q.x < cut.east.x);
    expect(onFront.length, 'точка внутри области: на южной стене есть промежуточные').toBeGreaterThan(0);
    expect(onFront.map((q) => Math.round(q.x * 10) / 10).sort()).toEqual(TOWN_WALL_TOWERS.inner.map((t) => Math.round(t.x * 10) / 10).sort());
  });

  it('на каждом уровне стены 1…10 — камень, башни города, кольцо города камнем', () => {
    const base = siegeOf('gates');
    const f = frameOf({ inward: 1, gateX: 0, z: 0 });
    for (let level = 1; level <= 10; level++) {
      const lay = layoutOf({ ...base, wall: level }, 'medium');
      const w = lay.wall!;
      expect(w, `ур. ${level}: стена есть`).toBeTruthy();
      expect(w.wood ?? false, `ур. ${level}: стена ролика — камень, как в окне города`).toBe(false);
      expect(townCut(w, lay.town!.inside, lay.town!.outside).wood, `ур. ${level}: кольцо города — камень`).toBe(false);
      const towers = [...w.towers].sort((a, b) => a.x - b.x);
      expect(towers.length, `ур. ${level}: башен — как на южной стене города`).toBe(2 + TOWN_WALL_TOWERS.inner.length);
      // Восток города — слева в ролике, запад — справа (`toReel`), промежуточные — на своих местах.
      expect(towers[0].round).toBe(TOWN_WALL_TOWERS.east.kind === 'round');
      expect(towers[0].h).toBeCloseTo(TOWN_WALL_TOWERS.east.height * CITY_M, 6);
      expect(towers[towers.length - 1].h).toBeCloseTo(TOWN_WALL_TOWERS.west.height * CITY_M, 6);
      for (const t of TOWN_WALL_TOWERS.inner) {
        const x = toReel(f, t.x, t.z).x;
        const r = towers.find((q) => Math.abs(q.x - x) < 0.1);
        expect(r, `ур. ${level}: башня города у x ${x.toFixed(1)}`).toBeTruthy();
        expect(r!.round).toBe(false);
        expect(r!.size).toBeCloseTo(t.size * CITY_M, 6);
      }
    }
  });

  it('ролик боя у стены — тоже камень', () => {
    for (const site of ['site=wall&us=defender', 'site=wall&us=attacker'] as const) {
      const plan = battleOf(site);
      expect(plan.site?.wall, `${site}: стена есть`).toBeTruthy();
      expect(plan.site?.wall?.wood ?? false, `${site}: стена — камень`).toBe(false);
    }
  });
});

