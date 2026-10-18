// Покои правителя (docs/city_v3.md, Г-4): план комнаты, касания предметов стола из кресла, руки, звук и огонь — числами,
// без WebGL (геометрия и касания three считаются в узле; атлас без страницы — пустой).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChambersRoom } from './room';
import { buildRoom } from './build';
import { FIRE_SPEC } from './fire';
import { earGains } from './sound';
import { DEFAULT_ARMS } from '@/heraldry/arms';
import {
  CHAIR,
  DESK,
  DESK_THINGS,
  HALF,
  OPENINGS,
  POIS,
  POI_BY_ID,
  THINGS,
  TRINKETS,
  WALL_T,
  clampLook,
  fitFov,
  inBox,
  type Door,
} from './plan';

/** Донжон города (`layout.ts`, `keep`): 13 м, 30 м высоты; подножие — любое, покои считаются от него. */
const KEEP = { x: -4, z: -147, base: 16, height: 30, size: 13 };
/** Экран телефона стоймя — граница области правила «видно из кресла». */
const PHONE = { left: 0, top: 0, width: 390, height: 844 };

function phoneRoom(): ChambersRoom {
  const room = new ChambersRoom(KEEP, DEFAULT_ARMS, 'low', () => null);
  room.camera.aspect = PHONE.width / PHONE.height;
  room.camera.updateProjectionMatrix();
  return room;
}

/** Где на экране телефона середина коробки предмета. */
function onScreen(room: ChambersRoom, b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }): { x: number; y: number; ndc: THREE.Vector3 } {
  const v = new THREE.Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2).add(room.origin).project(room.camera);
  return { x: ((v.x + 1) / 2) * PHONE.width, y: ((1 - v.y) / 2) * PHONE.height, ndc: v };
}

describe('покои: план', () => {
  it('комната — внутри донжона: стены покоев и окна кончаются наружной гранью башни', () => {
    expect(HALF + WALL_T, 'полуширина башни').toBeCloseTo(KEEP.size / 2, 6);
    for (const o of OPENINGS) {
      expect(o.outW, `${o.wall}: проём уже ниши`).toBeLessThan(o.midW);
      expect(o.midW, `${o.wall}: ниша сужается к доске`).toBeLessThan(o.inW);
      expect(o.plate, `${o.wall}: доска — в толще стены`).toBeLessThan(WALL_T);
      expect(Math.abs(o.at) + o.inW / 2, `${o.wall}: ниша на стене`).toBeLessThan(HALF);
    }
  });

  it('точки интереса: глаз в комнате (у окна — в нише), взгляд точки — в её пределах', () => {
    for (const p of POIS) {
      const { x, y, z } = p.pose;
      const lim = p.id === 'window' ? HALF + 0.95 : HALF - 0.2;
      expect(Math.abs(x), `${p.id}: x`).toBeLessThan(HALF - 0.2);
      expect(Math.abs(z), `${p.id}: z`).toBeLessThan(lim);
      expect(y, `${p.id}: высота глаза`).toBeGreaterThan(0.8);
      expect(y).toBeLessThan(1.8);
      const c = clampLook(p, p.pose.yaw, p.pose.pitch);
      expect(c.yaw).toBeCloseTo(p.pose.yaw, 9);
      expect(c.pitch).toBeCloseTo(p.pose.pitch, 9);
      expect(p.hits.length, `${p.id}: есть чем позвать`).toBeGreaterThan(0);
    }
  });

  it('предметы стола — на столе, у каждого своё окно игры, номера подсветки разные', () => {
    const doors = new Set<Door>();
    for (const t of DESK_THINGS) {
      expect(t.box.y0, `${t.id}: на столешнице`).toBeCloseTo(DESK.top, 6);
      expect(Math.abs(t.box.x0) <= DESK.w / 2 && Math.abs(t.box.x1) <= DESK.w / 2, `${t.id}: по ширине стола`).toBe(true);
      expect(t.box.z0 >= DESK.z - DESK.d / 2 && t.box.z1 <= DESK.z + DESK.d / 2, `${t.id}: по глубине стола`).toBe(true);
      expect(doors.has(t.door), `${t.id}: окно не повторяется`).toBe(false);
      doors.add(t.door);
    }
    // Шесть окон из задания (Вести, Карта, Держава, Жители, Дружина, Ратуша) и два своих (кошель, печать).
    expect([...doors].sort()).toEqual(['arms', 'army', 'build', 'decrees', 'map', 'news', 'people', 'treasury']);
    const codes = THINGS.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => c > 0 && c < 256)).toBe(true);
  });

  it('безделушки: кубок, шахматная фигура, меч, корона, свеча — каждую берут со своей точки', () => {
    expect(TRINKETS.map((t) => t.id).sort()).toEqual(['candle', 'chess', 'crown', 'goblet', 'sword']);
    for (const t of TRINKETS) expect(POI_BY_ID[t.poi], t.id).toBeDefined();
  });

  it('поле зрения: телефон стоймя видит по горизонтали не меньше 42°, широкий экран — как у точки', () => {
    const v = fitFov(62, PHONE.width / PHONE.height);
    const h = (2 * Math.atan(Math.tan((v * Math.PI) / 360) * (PHONE.width / PHONE.height)) * 180) / Math.PI;
    expect(h).toBeGreaterThanOrEqual(41.9);
    expect(fitFov(62, 16 / 9)).toBe(62);
  });
});

describe('покои: стол из кресла', () => {
  it('из кресла на телефоне видны все предметы стола — выше нижней полосы кнопок и ниже шапки', () => {
    const room = phoneRoom();
    room.snap('desk');
    for (const t of DESK_THINGS) {
      const s = onScreen(room, t.box);
      expect(s.ndc.z, `${t.id}: перед глазом`).toBeLessThan(1);
      expect(s.x, `${t.id}: по ширине экрана`).toBeGreaterThan(8);
      expect(s.x).toBeLessThan(PHONE.width - 8);
      // Шапка — до 70 px, полоса точек — от 770 px (`chambers.css`).
      expect(s.y, `${t.id}: ниже шапки`).toBeGreaterThan(70);
      expect(s.y, `${t.id}: выше полосы кнопок`).toBeLessThan(770);
    }
    room.dispose();
  });

  it('касание предмета стола из кресла открывает его окно; издали — ведёт к столу и окна не открывает', () => {
    const room = phoneRoom();
    const used: [Door, string][] = [];
    room.onUse = (door, id) => used.push([door, id]);
    room.snap('desk');
    for (const t of DESK_THINGS) {
      const s = onScreen(room, t.box);
      room.down(1, s.x, s.y, PHONE);
      room.up(1);
      expect(used.at(-1), `${t.id}: окно ${t.door}`).toEqual([t.door, t.id]);
    }
    expect(used.length).toBe(DESK_THINGS.length);
    // Из середины покоев: касание письма — шаг к столу, а не окно.
    room.snap('hall');
    const letters = DESK_THINGS.find((t) => t.id === 'letters')!;
    const s = onScreen(room, letters.box);
    room.down(1, s.x, s.y, PHONE);
    room.up(1);
    expect(used.length, 'издали окно не открылось').toBe(DESK_THINGS.length);
    expect(room.view().poi).toBe('desk');
    room.dispose();
  });

  it('ведение пальцем — поворот головы, а не касание: окно не открывается', () => {
    const room = phoneRoom();
    let used = 0;
    room.onUse = () => used++;
    room.snap('desk');
    const map = onScreen(room, DESK_THINGS.find((t) => t.id === 'map')!.box);
    const yaw0 = room.camera.getWorldDirection(new THREE.Vector3()).x;
    room.down(1, map.x, map.y, PHONE);
    room.move(1, map.x + 60, map.y);
    room.up(1);
    room.frame(0.016, 1, SKY);
    expect(used).toBe(0);
    expect(room.camera.getWorldDirection(new THREE.Vector3()).x).not.toBeCloseTo(yaw0, 3);
    room.dispose();
  });

  it('безделушку берут в руки касанием у её точки и кладут касанием мимо', () => {
    const room = phoneRoom();
    room.snap('desk');
    const goblet = TRINKETS.find((t) => t.id === 'goblet')!;
    // Кубок — у края кадра: берём его, повернув голову к нему.
    room.snap('desk', 0.35, 0);
    const s = onScreen(room, goblet.box);
    room.down(1, s.x, s.y, PHONE);
    room.up(1);
    expect(room.view().held).toBe('goblet');
    room.down(1, 20, 120, PHONE);
    room.up(1);
    expect(room.view().held, 'кладёт').toBe(null);
    room.dispose();
  });
});

describe('покои: модель, огонь, звук', () => {
  it('модель по уровням: мелочи больше с уровнем, треугольников — в пределах бюджета покоев', () => {
    const tris = [0, 1, 2].map((d) => {
      const m = buildRoom(d as 0 | 1 | 2);
      return m.stone.b.triangleCount + m.cloth.b.triangleCount + Object.values(m.trinkets).reduce((a, t) => a + t.stone.b.triangleCount, 0);
    });
    expect(tris[0]).toBeLessThan(tris[1]);
    expect(tris[1]).toBeLessThanOrEqual(tris[2]);
    // Потолок покоев: 12 / 16 / 20 тысяч — город за окном несёт свои (docs/city_v3.md, Г-4, «Скорость»).
    expect(tris[0]).toBeLessThan(12000);
    expect(tris[1]).toBeLessThan(16000);
    expect(tris[2]).toBeLessThan(20000);
  });

  it('огонь по уровням: языков, искр и пылинок не меньше на уровне выше', () => {
    expect(FIRE_SPEC.low.tongues).toBeLessThanOrEqual(FIRE_SPEC.medium.tongues);
    expect(FIRE_SPEC.medium.tongues).toBeLessThanOrEqual(FIRE_SPEC.high.tongues);
    expect(FIRE_SPEC.low.embers + FIRE_SPEC.low.dust).toBe(0);
  });

  it('звук: у огня огонь громче, у окна — ветер и город; всё в пределах 0…1', () => {
    const at = (fire: number, win: number) => earGains({ fire, firePan: 0, window: win, wind: 0.6, rain: 0.5 });
    const hearth = at(1.5, 9);
    const window = at(8, 0.6);
    expect(hearth.fire).toBeGreaterThan(window.fire);
    expect(window.wind).toBeGreaterThan(hearth.wind);
    expect(window.town).toBeGreaterThan(hearth.town);
    expect(window.rain).toBeGreaterThan(hearth.rain);
    for (const g of [hearth, window]) for (const v of Object.values(g)) expect(v >= 0 && v <= 1).toBe(true);
  });

  it('кресло стоит у стола, спиной к покоям, лицом к окну', () => {
    expect(CHAIR.z).toBeLessThan(DESK.z - DESK.d / 2);
    expect(inBox(POI_BY_ID.desk.hits[0], CHAIR.x, 0.5, CHAIR.z)).toBe(true);
  });
});

/** Небо кадра для шага комнаты в узле: день, ясно. */
const SKY = {
  daylight: 1,
  night: 0,
  nightK: 0,
  sky: new THREE.Color(0.6, 0.7, 0.85),
  haze: new THREE.Color(0.7, 0.75, 0.8),
  sunDir: new THREE.Vector3(-0.4, 0.5, 0.77).normalize(),
  sun: new THREE.Color(2, 1.6, 1.1),
  hemi: new THREE.Color(0.6, 0.65, 0.7),
  rain: 0,
  snow: 0,
  mist: 0,
  cloud: 0,
  wind: 0.3,
  windX: 1,
  windZ: 0,
  flash: 0,
};
