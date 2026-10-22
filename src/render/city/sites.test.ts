// Места 24 построек в городе и касание по ним (docs/city.md, раздел 5): все постройки игры стоят в своих
// зданиях, дворы `outside` — за стеной, а палец попадает в каждую на ракурсе игры. Пороги владельца «33 px и
// 780 мс»: цель не меньше 33 px (квадрат 33 × 33 px открывает постройку целиком; сама цель касания раздувается
// до `TAP_TARGET`, 44 px), а время и сход пальца судит общий разбор жеста — своего у города нет: палец,
// пролежавший 780 мс или сошедший на 33 px, — уже не тап (граничные столбец и строка стенда `tap:report`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BuildingTypeId } from '@/game/types';
import { BUILDINGS } from '@/game/data/buildings';
import { isOutsideWall } from '@/game/derived';
import { Gesture, TAP_TARGET } from '@/gestures';
import { cityPlan, insidePoly } from './layout';
import { buildStatic } from './budget';
import { CITY_OWNERS, mainSite, type Site } from './sites';
import { cityPick, pickFrame, pickIn, screenBox, type Pickable } from './pick';
import { CITY_AZIMUTH, cityFraming, cityLeash } from './camera';

const plan = cityPlan();
const { sites } = buildStatic(plan, 'medium');
const W = 390;
const H = 844;
const rect = { left: 0, top: 0, width: W, height: H };
/** Порог владельца: цель пальца не меньше 33 px. */
const FINGER = 33;

const items: Pickable[] = CITY_OWNERS.map((t, k) => ({ id: k + 1, sites: sites.filter((s) => s.type === t) }));
const typeOf = (id: number | null): BuildingTypeId | null => (id === null ? null : CITY_OWNERS[id - 1]);

/** Камера игры на телефоне 390×844: стартовая или сдвинутая панорамой к точке (тот же поводок). */
function camera(at?: { x: number; z: number }): THREE.PerspectiveCamera {
  const f = cityFraming(W / H);
  const cam = new THREE.PerspectiveCamera(f.fov, W / H, 1, 4000);
  const p = at ? cityLeash(at.x, at.z) : f.target;
  const target = new THREE.Vector3(p.x, f.target.y, p.z);
  cam.position.setFromSpherical(new THREE.Spherical(f.dist, f.polar, CITY_AZIMUTH)).add(target);
  cam.lookAt(target);
  cam.updateMatrixWorld();
  return cam;
}

const main = (t: BuildingTypeId): Site => {
  const m = mainSite(sites, t);
  if (!m) throw new Error(`нет места у ${t}`);
  return m;
};

/**
 * Есть ли у постройки квадрат пальца 33 × 33 px, весь открывающий её: касания — сеткой через 3 px по
 * её силуэту и полпальца вокруг, затем окно 12 × 12 узлов (33 px) ищется по сетке.
 */
function fingerSomewhere(cam: THREE.Camera, type: BuildingTypeId): boolean {
  const m = main(type);
  const box = screenBox(0, [m], cam, rect);
  expect(box, `${type}: главное место перед камерой`).not.toBeNull();
  const b = box!;
  const frame = pickFrame(items, cam, rect);
  const step = 3;
  const n = Math.ceil(FINGER / step);
  const x0 = b.x - b.hw - FINGER / 2;
  const y0 = b.y - b.hh - FINGER / 2;
  const nx = Math.ceil((2 * b.hw + FINGER) / step) + 1;
  const ny = Math.ceil((2 * b.hh + FINGER) / step) + 1;
  const hit: boolean[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const y = y0 + j * step;
      // Граница области: касание — на экране; за краем экрана постройку не открыть ничем.
      hit.push(x > 0 && x < W && y > 0 && y < H && typeOf(pickIn(frame, x, y)) === type);
    }
  }
  // Граница области: силуэт на экране, сетка не пуста.
  expect(hit.some(Boolean), `${type}: хоть одно касание открывает постройку`).toBe(true);
  for (let j = 0; j + n < ny; j++) {
    for (let i = 0; i + n < nx; i++) {
      let all = true;
      for (let jj = 0; jj <= n && all; jj++) for (let ii = 0; ii <= n && all; ii++) all = hit[(j + jj) * nx + i + ii];
      if (all) return true;
    }
  }
  return false;
}

describe('город: 21 постройка игры', () => {
  it('у каждой постройки игры — своё здание в городе, и ни одной лишней', () => {
    expect([...CITY_OWNERS].sort()).toEqual(BUILDINGS.map((b) => b.id).sort());
    for (const t of CITY_OWNERS) expect(sites.some((s) => s.type === t), `место у ${t}`).toBe(true);
    // Коробки сняты с моделей: у каждой есть объём.
    for (const s of sites) expect(s.hf > 0.3 && s.hr > 0.3 && s.y1 - s.y0 > 0.8, `объём места ${s.type}`).toBe(true);
  });

  it('дворы за стеной — за стеной и за гласисом, остальные — внутри стены или замка', () => {
    let outside = 0;
    for (const t of CITY_OWNERS) {
      const m = main(t);
      const p = { x: m.x, z: m.z };
      const inside = insidePoly(p, plan.wall) || insidePoly(p, plan.castleWall);
      if (isOutsideWall(t)) {
        outside++;
        expect(inside, `${t}: двор за стеной`).toBe(false);
      } else if (t !== 'palisade' && t !== 'tower' && t !== 'watch') {
        expect(inside, `${t}: в стене`).toBe(true);
      }
    }
    // Граница области: дворов за стеной столько, сколько их у игры.
    expect(outside).toBe(BUILDINGS.filter((b) => isOutsideWall(b.id)).length);
    expect(outside).toBe(4);
  });
});

describe('город: касание по раскладке', () => {
  it('стартовый кадр: город от ворот до донжона, каждая постройка в нём открывается пальцем в 33 px', () => {
    const cam = camera();
    const seen: BuildingTypeId[] = [];
    for (const t of CITY_OWNERS) {
      if (isOutsideWall(t)) continue;
      const b = screenBox(0, [main(t)], cam, rect);
      // На стартовом кадре — то, что внутри стены (дворы за стеной — панорамой, следующий тест).
      if (!b || b.x < 0 || b.x > W || b.y < 0 || b.y > H) continue;
      seen.push(t);
      expect(fingerSomewhere(cam, t), `${t}: квадрат ${FINGER} px открывает постройку`).toBe(true);
    }
    // Граница области: в кадре почти все постройки внутри стены — не пустой проход.
    expect(seen.length).toBeGreaterThanOrEqual(15);
  });

  it('все 21 постройка: панорамой к любой её открывает палец в 33 px', () => {
    let checked = 0;
    for (const t of CITY_OWNERS) {
      const m = main(t);
      const cam = camera({ x: m.x, z: m.z });
      expect(fingerSomewhere(cam, t), `${t}: квадрат ${FINGER} px открывает постройку`).toBe(true);
      checked++;
    }
    // Граница области: проверены все постройки игры — двадцать одна (ЗД-1: три пары дворов стали тремя), а не часть.
    expect(checked).toBe(BUILDINGS.length);
    expect(checked).toBe(21);
  });

  it('время и сход пальца — общий судья жеста: 620 мс и 31 px — тап, 780 мс и 33 px — уже не тап', () => {
    /** Одно касание: лежит `ms`, а на `at`-й миллисекунде сходит на `slip` px (как след стенда `tap:report`). */
    const tap = (ms: number, slip = 0, at = 0): boolean => {
      const g = new Gesture();
      g.down(1, 100, 100, 0);
      if (slip > 0) g.move(1, 100 + slip * 0.78, 100 + slip * 0.62, at);
      return g.up(1, ms);
    };
    expect(tap(200), '200 мс — тап').toBe(true);
    expect(tap(620), '620 мс — тап').toBe(true);
    expect(tap(780), '780 мс — уже не тап').toBe(false);
    // Сход — сразу (палец садится), посередине (повёл и встал) и перед снятием: правило одно.
    for (const at of [80, 220, 360]) {
      expect(tap(380, 31, at), `31 px на ${at} мс — тап`).toBe(true);
      expect(tap(380, 33, at), `33 px на ${at} мс — уже не тап`).toBe(false);
    }
    // Своего судьи у города нет: касание ведёт оболочка сцены (`Scene.ts`), город отвечает только «что под пальцем».
    const city = readFileSync(join(__dirname, 'scene.ts'), 'utf8');
    expect(city, 'у города нет своего разбора жеста').not.toMatch(/onPointer|addEventListener\('pointer|new Gesture/);
    expect(city, 'город отвечает, что под пальцем').toMatch(/protected override pickAt\(/);
  });

  it('мелкая постройка раздувается до цели пальца, крупная — нет', () => {
    const cam = camera();
    for (const t of ['statue', 'campfire'] as const) {
      const raw = screenBox(0, items[CITY_OWNERS.indexOf(t)].sites, cam, rect);
      // Область: статуя и чаша на стартовом кадре мельче пальца — правило действует.
      expect(raw && (raw.hw * 2 < TAP_TARGET || raw.hh * 2 < TAP_TARGET), `${t} мельче пальца`).toBe(true);
      expect(typeOf(cityPick(items, cam, rect, raw!.x + TAP_TARGET / 2 - 3, raw!.y)), `${t}: край раздутой цели`).toBe(t);
    }
  });

  it('луч: что видно первым, то и открывается — передний дом закрывает высокий храм за ним', () => {
    const cam = camera();
    // Камера смотрит круто сверху (52°): «перед» храмом — это выше по лучу, дом перед ним высокий.
    const back: Site = { type: 'church', x: 0, z: 0, fx: 1, fz: 0, hf: 12, hr: 12, y0: 0, y1: 12 };
    const front: Site = { type: 'houses', x: 0, z: 22, fx: 1, fz: 0, hf: 10, hr: 10, y0: 0, y1: 26 };
    const two: Pickable[] = [
      { id: 1, sites: [back] },
      { id: 2, sites: [front] },
    ];
    const bb = screenBox(1, [back], cam, rect)!;
    const fb = screenBox(2, [front], cam, rect)!;
    // Область: передний дом крупнее пальца и накрывает середину храма на экране — иначе луч не спрашивается.
    expect(fb.hw * 2 > TAP_TARGET && fb.hh * 2 > TAP_TARGET).toBe(true);
    expect(Math.abs(bb.x - fb.x) < fb.hw && Math.abs(bb.y - fb.y) < fb.hh, 'середина храма — за домом').toBe(true);
    // Тап в середину храма на экране попадает в дом перед ним: по экранным прямоугольникам выиграл бы храм.
    expect(cityPick(two, cam, rect, bb.x, bb.y)).toBe(2);
  });

  it('тап мимо всего — в чистое поле — не открывает ничего', () => {
    const cam = camera({ x: 200, z: -240 });
    // Северо-восток за полями: ни двора, ни дороги, ни стены рядом.
    const b = screenBox(0, [{ type: 'farm', x: 200, z: -240, fx: 1, fz: 0, hf: 1, hr: 1, y0: -8, y1: -7 }], cam, rect);
    expect(b).not.toBeNull();
    expect(cityPick(items, cam, rect, b!.x, b!.y)).toBeNull();
  });
});
