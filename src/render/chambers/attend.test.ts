// Глаз к гостю (docs/city_v3.md, Р-1): при входе слуги, служанки, супруги, гонца и советника глаз правителя плавно
// поворачивается к двери и держит вошедшего целиком в свободной полосе кадра, пока он входит и до начала разговора; в разговоре
// гость в кадре над плашкой; после «Ступай» и крестика глаз свободен — смотри куда хочешь, в том числе на стол. Числами, без
// WebGL, кадр телефона 390×844.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChambersRoom } from './room';
import { DEFAULT_ARMS } from '@/heraldry/arms';
import { HALF, POI_BY_ID } from './plan';
import type { Who } from './life';

const KEEP = { x: -4, z: -147, base: 16, height: 30, size: 13 };
const PHONE = { left: 0, top: 0, width: 390, height: 844 };
/** Свободная полоса кадра: под шапкой покоев и над кнопками (как у безделушки в руке, `chambers.test`). */
const FREE_TOP = 64;
const FREE_BOTTOM = 770;
/** Плашка разговора, точки от низа (ровно столько закрывает окно разговора с четырьмя ответами). */
const PLATE = 380;
/** Ближе этого гость целиком в кадр не встаёт (вертикаль кадра телефона — около 80°): точки ближе — вне области правила. */
const NEAR = 1.0;
/** Сколько глазу на поворот, прежде чем гость обязан быть в кадре, с первого кадра внимания к нему. */
const TURN = 1.5;
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

function phoneRoom(): ChambersRoom {
  const room = new ChambersRoom(KEEP, DEFAULT_ARMS, 'low', () => null);
  room.camera.aspect = PHONE.width / PHONE.height;
  room.camera.updateProjectionMatrix();
  room.setRect(PHONE);
  return room;
}

let clock = 0;
function run(room: ChambersRoom, s: number, each?: () => boolean | void): boolean {
  for (let i = 0; i < Math.round(s * 60); i++) {
    clock += 1 / 60;
    room.frame(1 / 60, clock, SKY);
    if (each?.()) return true;
  }
  return false;
}

/** Гость на экране: пятки, макушка и плечи — рамка в точках. */
function frameOf(room: ChambersRoom, who: Who): { x0: number; x1: number; y0: number; y1: number; front: boolean } {
  const p = room.life.personOf(who)!;
  const head = p.rig.at('head', [0, 0.22, 0]);
  const pts: [number, number, number][] = [
    [p.x, p.y, p.z],
    [head[0], head[1], head[2]],
  ];
  for (const s of [-1, 1]) pts.push([p.x + Math.cos(p.yaw) * 0.24 * s, p.y + 1.35, p.z - Math.sin(p.yaw) * 0.24 * s]);
  const sc = pts.map((q) => new THREE.Vector3(q[0], q[1], q[2]).add(room.origin).project(room.camera));
  const xs = sc.map((v) => ((v.x + 1) / 2) * PHONE.width);
  const ys = sc.map((v) => ((1 - v.y) / 2) * PHONE.height);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), front: sc.every((v) => v.z < 1) };
}

const talking = (room: ChambersRoom, who: Who) => (): boolean => room.life.view().talk?.who === who;

/**
 * Вход гостя — от первого кадра внимания к нему до начала разговора: каждый кадр, где гость в покоях, не ближе `NEAR` и глазу
 * было `TURN` на поворот, — он целиком в свободной полосе кадра. Возвращает, сколько кадров проверено.
 */
function entry(room: ChambersRoom, who: Who, label: string): number {
  let since = -1;
  let checked = 0;
  let closest = Infinity;
  const ok = run(room, 45, () => {
    if (talking(room, who)()) return true;
    const a = room.life.attention();
    if (a?.who === who && since < 0) since = 0;
    if (since >= 0) since += 1 / 60;
    const p = room.life.personOf(who);
    const s = room.state();
    if (p && p.z > -HALF + 0.1) closest = Math.min(closest, Math.hypot(p.x - s.x, p.z - s.z));
    if (!p || since < TURN || p.z < -HALF + 0.1 || Math.hypot(p.x - s.x, p.z - s.z) < NEAR) return;
    // Точка в области правила: гость — тот, кого держит глаз, и разговор ещё не начат.
    expect(a?.who, `${label}: глаз держит гостя`).toBe(who);
    expect(a?.talk).toBe(false);
    const f = frameOf(room, who);
    const where = `${label}, ${since.toFixed(2)} с: (${f.x0.toFixed(0)}…${f.x1.toFixed(0)}, ${f.y0.toFixed(0)}…${f.y1.toFixed(0)})`;
    expect(f.front, `${where}: перед глазом`).toBe(true);
    expect(f.x0, `${where}: не за левым краем`).toBeGreaterThanOrEqual(0);
    expect(f.x1, `${where}: не за правым краем`).toBeLessThanOrEqual(PHONE.width);
    expect(f.y0, `${where}: макушка ниже шапки`).toBeGreaterThanOrEqual(FREE_TOP);
    expect(f.y1, `${where}: пятки выше кнопок`).toBeLessThanOrEqual(FREE_BOTTOM);
    checked++;
  });
  expect(ok, `${label}: дошло до разговора`).toBe(true);
  // Мимо правителя — на шаг поодаль, не сквозь него.
  expect(closest, `${label}: не проходит сквозь правителя`).toBeGreaterThan(0.6);
  return checked;
}

/** Повести пальцем взгляда (правая половина экрана). */
function drag(room: ChambersRoom, dx: number, dy: number): void {
  room.down(7, 300, 420, PHONE);
  room.move(7, 300 + dx, 420 + dy);
  run(room, 1 / 60);
  room.up(7);
}

describe('глаз к гостю (Р-1)', () => {
  it('слуга на стук и служанка с вином: правитель у двери — оба целиком в кадре, пока входят и до разговора', () => {
    const room = phoneRoom();
    room.touch({ kind: 'poi', poi: POI_BY_ID.door });
    expect(entry(room, 'servant', 'слуга'), 'кадры входа слуги').toBeGreaterThan(30);
    room.life.order('wine');
    // Служанка идёт мимо правителя к столу, наливает и возвращается — глаз ведёт её и через плечо.
    expect(entry(room, 'maid', 'служанка'), 'кадры входа служанки').toBeGreaterThan(300);
    room.dispose();
  });

  it('супруга: целиком в кадре, пока входит и до разговора', () => {
    const room = phoneRoom();
    room.standAtPoint(0.3, -0.8, Math.PI * 0.75, -0.1);
    room.touch({ kind: 'poi', poi: POI_BY_ID.door });
    run(room, 30, talking(room, 'servant'));
    room.life.order('wife');
    expect(entry(room, 'wife', 'супруга')).toBeGreaterThan(30);
    room.dispose();
  });

  it('гонец: стучит — глаз к двери; входит — целиком в кадре; стоя спиной к двери и сидя за столом', () => {
    for (const [label, set] of [
      ['стоя спиной', (r: ChambersRoom) => r.standAtPoint(0, -1, Math.PI, -0.1)],
      ['за столом', (r: ChambersRoom) => r.snap('desk')],
    ] as const) {
      const room = phoneRoom();
      set(room);
      run(room, 0.2);
      expect(room.life.summonHerald()).toBe(true);
      // Стучит за затворённой дверью: глаз — к двери, она в кадре.
      let doorSeen = false;
      run(room, 12, () => {
        const a = room.life.attention();
        if (a?.door) {
          const v = new THREE.Vector3(a.bottom[0], 1.1, a.bottom[2]).add(room.origin).project(room.camera);
          if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) doorSeen = true;
        }
        return !!room.life.personOf('herald') && room.life.doorOpen > 0.5;
      });
      expect(doorSeen || label === 'за столом', `${label}: дверь в кадре, пока стучат`).toBe(true);
      expect(entry(room, 'herald', `гонец ${label}`)).toBeGreaterThan(30);
      room.dispose();
    }
  });

  it('советник после отлучки: целиком в кадре до доклада', () => {
    const room = phoneRoom();
    room.life.advisorWaits();
    expect(entry(room, 'advisor', 'советник')).toBeGreaterThan(30);
    room.dispose();
  });

  it('в разговоре гость в кадре над плашкой; после «Ступай» и крестика глаз свободен — и на стол', () => {
    // Сидя за столом: советник у стола докладывает.
    const room = phoneRoom();
    room.setPlate(PLATE);
    room.snap('desk');
    room.life.advisorWaits();
    expect(run(room, 20, talking(room, 'advisor'))).toBe(true);
    run(room, 2.5);
    const f = frameOf(room, 'advisor');
    expect(f.front && f.x0 >= 0 && f.x1 <= PHONE.width, 'советник в кадре по ширине').toBe(true);
    expect(f.y0, 'макушка ниже шапки').toBeGreaterThanOrEqual(FREE_TOP);
    expect(f.y0 + 120, 'голова и плечи — над плашкой').toBeLessThanOrEqual(PHONE.height - PLATE);
    // В разговоре глаз отвели к столу — он возвращается к гостю.
    const yaw0 = room.state().yaw;
    drag(room, 160, 120);
    expect(Math.abs(room.state().yaw - yaw0), 'палец отвёл глаз').toBeGreaterThan(0.2);
    run(room, 3);
    expect(Math.abs(room.state().yaw - yaw0), 'в разговоре глаз вернулся к гостю').toBeLessThan(0.08);
    // Крестик: советник остался стоять у стола, а глаз свободен — посмотреть на стол и остаться.
    room.life.endTalk();
    drag(room, 160, 160);
    const free = room.state();
    run(room, 4);
    expect(room.life.personOf('advisor'), 'советник стоит у стола').not.toBeNull();
    expect(room.life.attention(), 'никого не держит').toBeNull();
    expect(Math.abs(room.state().yaw - free.yaw), 'после крестика глаз не тянется к советнику').toBeLessThan(0.01);
    expect(Math.abs(room.state().pitch - free.pitch)).toBeLessThan(0.01);
    room.dispose();
  });

  it('«Ступай»: гость уходит, глаз не провожает его — смотрит, куда повёл палец', () => {
    const room = phoneRoom();
    room.standAtPoint(0.3, -0.8, Math.PI * 0.75, -0.1);
    room.touch({ kind: 'poi', poi: POI_BY_ID.door });
    expect(run(room, 30, talking(room, 'servant'))).toBe(true);
    run(room, 2);
    room.life.order('dismiss');
    drag(room, 180, 60);
    const free = room.state();
    run(room, 5);
    expect(room.life.attention()).toBeNull();
    expect(Math.abs(room.state().yaw - free.yaw), 'глаз свободен').toBeLessThan(0.01);
    expect(Math.abs(room.state().pitch - free.pitch)).toBeLessThan(0.01);
    room.dispose();
  });
});
