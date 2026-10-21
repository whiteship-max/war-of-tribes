// Бой мечом в покоях (docs/city_v3.md, Г-11): комната целиком — стойка со стены, ходьба с мечом, взмах — удар по
// направлению, попадание по чучелу (зарубка, солома, счёт), двойное касание — блок, выносливость, «Повесить на стену».
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChambersRoom } from './room';
import { Drill } from './drill';
import { DUMMY } from './plan';
import { BLADE_TO, TIRED } from './sword';
import { DEFAULT_ARMS } from '@/heraldry/arms';

const KEEP = { x: -4, z: -147, base: 16, height: 30, size: 13 };
const PHONE = { left: 0, top: 0, width: 390, height: 844 };
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
let clock = 0;

function phoneRoom(): ChambersRoom {
  const room = new ChambersRoom(KEEP, DEFAULT_ARMS, 'low', () => null);
  room.camera.aspect = PHONE.width / PHONE.height;
  room.camera.updateProjectionMatrix();
  room.setRect(PHONE);
  return room;
}

function run(room: ChambersRoom, s: number, until?: () => boolean): void {
  for (let i = 0; i < Math.round(s * 60); i++) {
    clock += 1 / 60;
    room.frame(1 / 60, clock, SKY);
    if (until?.()) return;
  }
}

/** Меч со стены — в стойку, стойка встала. */
function inStance(): ChambersRoom {
  const room = phoneRoom();
  room.snap('arms');
  run(room, 0.7);
  expect(room.view().stance, 'меч в руке у стены — можно в стойку').toBe(true);
  room.stance();
  run(room, 0.6);
  return room;
}

/** Острие меча на экране телефона, пиксели. */
function tipOnScreen(room: ChambersRoom): { x: number; y: number } {
  const mesh = room.scene.getObjectByName('chambers-sword') as THREE.Mesh;
  mesh.updateMatrixWorld();
  const v = new THREE.Vector3(0, 0, 0.035 + BLADE_TO).applyMatrix4(mesh.matrixWorld).project(room.camera);
  return { x: ((v.x + 1) / 2) * PHONE.width, y: ((1 - v.y) / 2) * PHONE.height };
}

describe('покои: бой мечом', () => {
  it('стойка: меч в руке, правитель стоит и ходит с ним, мебель касанием не зовут', () => {
    const room = inStance();
    const v = room.view();
    expect(v.fight, 'бой начат').not.toBeNull();
    expect(v.mode).toBe('free');
    expect(v.held).toBe('sword');
    const tip = tipOnScreen(room);
    expect(tip.y, 'острие стойки — в верхней половине кадра').toBeLessThan(PHONE.height / 2);
    expect(tip.x).toBeGreaterThan(0);
    expect(tip.x).toBeLessThan(PHONE.width);
    // Ходьба: шаг клавишей вперёд — глаз сместился.
    const a = room.state();
    room.keyDown('KeyS');
    run(room, 0.6);
    room.keyUp('KeyS');
    const b = room.state();
    expect(Math.hypot(b.x - a.x, b.z - a.z), 'идёт с мечом').toBeGreaterThan(0.3);
    // Касание стола в стойке ничего не делает: стоит, где стоял.
    const desk = room.pickAt(195, 600);
    room.touch(desk ?? { kind: 'poi', poi: { id: 'desk' } as never });
    run(room, 0.2);
    expect(room.view().mode, 'касание в стойке не ведёт к мебели').toBe('free');
    room.dispose();
  });

  it('взмах — удар по линии: острие на экране идёт туда же, куда палец; по чучелу — зарубка, солома, счёт', () => {
    const room = inStance();
    room.standAtPoint(DUMMY.x - 0.92, DUMMY.z, Math.PI / 2, -0.06);
    run(room, 0.3);
    const xs: number[] = [];
    room.swipe(340, 470, 90, 480, 64);
    for (let i = 0; i < 24; i++) {
      run(room, 1 / 60);
      xs.push(tipOnScreen(room).x);
    }
    const i0 = xs.findIndex((x) => x > PHONE.width * 0.55);
    const i1 = xs.findIndex((x, i) => i > i0 && x < PHONE.width * 0.45);
    expect(i0, 'острие сперва справа (замах против взмаха)').toBeGreaterThanOrEqual(0);
    expect(i1, 'и уходит влево — справа налево, как палец').toBeGreaterThan(i0);
    run(room, 0.6);
    const f = room.fightNow()!;
    expect(f.hits, 'попал по чучелу').toBe(1);
    expect(room.view().fight?.hits).toBe(1);
    const d = room.drillNow();
    expect(d.dented, 'зарубка на соломе').toBe(1);
    room.dispose();
  });

  it('солома летит из чучела, чучело качается; по стене — искры', () => {
    const room = inStance();
    room.standAtPoint(DUMMY.x - 0.92, DUMMY.z, Math.PI / 2, -0.06);
    run(room, 0.3);
    room.swipe(80, 470, 330, 480, 64);
    run(room, 0.2, () => room.drillNow().flying.bits > 0);
    expect(room.drillNow().flying.bits, 'солома в воздухе').toBeGreaterThan(5);
    run(room, 0.1);
    expect(room.drillNow().lean, 'чучело качнулось').toBeGreaterThan(0.005);
    run(room, 2);
    // К стене лицом, вплотную: удар — камень, искры.
    room.standAtPoint(4.5, 1.0, Math.PI / 2, 0);
    run(room, 0.5);
    room.swipe(330, 420, 80, 430, 64);
    run(room, 0.3, () => room.drillNow().flying.sparks > 0);
    expect(room.drillNow().flying.sparks, 'искры по камню').toBeGreaterThan(5);
    expect(room.fightNow()!.hits, 'стена — не чучело').toBe(1);
    room.dispose();
  });

  it('двойное касание у стороны экрана — блок в эту сторону (и слева, где палец движения)', () => {
    for (const [x, y, side] of [
      [24, 430, 'left'],
      [366, 420, 'right'],
      [200, 150, 'up'],
      [200, 740, 'down'],
    ] as const) {
      const room = inStance();
      room.down(1, x, y, PHONE);
      room.up(1);
      room.down(2, x + 4, y + 3, PHONE);
      room.up(2);
      const st = room.fightNow()!.state;
      expect(st.kind === 'block' && st.side, `${side}: блок`).toBe(side);
      room.dispose();
    }
  });

  it('частые удары утомляют: полоса выносливости падает, отдых её возвращает', () => {
    const room = inStance();
    for (let i = 0; i < 10; i++) {
      room.swipe(i % 2 ? 80 : 330, 450, i % 2 ? 330 : 80, 460, 60);
      run(room, 0.55);
    }
    const low = room.view().fight!.stamina;
    expect(low, 'выдохся').toBeLessThan(TIRED);
    expect(room.view().fight!.tired).toBe(true);
    run(room, 3.5);
    expect(room.view().fight!.stamina, 'отдохнул').toBeGreaterThan(low + 0.6);
    room.dispose();
  });

  it('«Повесить на стену»: к стене оружия, меч — на колышки, бой кончен', () => {
    const room = inStance();
    room.standAtPoint(0.5, 0.5, 0, 0);
    run(room, 0.2);
    const sword = room.scene.getObjectByName('chambers-sword') as THREE.Mesh;
    room.hangSword();
    expect(room.view().fight?.stowing, 'убирают').toBe(true);
    run(room, 14, () => room.view().held === null && room.view().mode === 'free');
    expect(room.view().held, 'меч не в руке').toBeNull();
    expect(room.view().fight, 'бой кончен').toBeNull();
    expect(room.view().mode).toBe('free');
    run(room, 0.3);
    // Где меч лежит в покоях, куда ещё не входили: колышки на стене.
    const fresh = phoneRoom();
    const rest = (fresh.scene.getObjectByName('chambers-sword') as THREE.Mesh).position;
    expect(sword.position.distanceTo(rest), 'меч на стене, на своих колышках').toBeLessThan(0.005);
    fresh.dispose();
    room.dispose();
  });

  it('отдача лёгкая: удары о камень и чучело и при редком кадре (0,1 с) не уводят взгляд дальше полутора градусов', () => {
    for (const at of [
      [4.5, 1.0],
      [DUMMY.x - 0.92, DUMMY.z],
    ] as const) {
      const room = inStance();
      room.standAtPoint(at[0], at[1], Math.PI / 2, 0);
      run(room, 0.3);
      let worst = 0;
      let hits = 0;
      for (let k = 0; k < 4; k++) {
        room.swipe(k % 2 ? 80 : 330, 430, k % 2 ? 330 : 80, 440, 60);
        for (let i = 0; i < 12; i++) {
          clock += 0.1;
          room.frame(0.1, clock, SKY);
          const d = room.camera.getWorldDirection(new THREE.Vector3());
          const st = room.state();
          worst = Math.max(worst, Math.abs(Math.asin(d.y) - st.pitch), Math.abs(Math.atan2(d.x, d.z) - st.yaw));
          expect(Math.abs(room.camera.up.y - 1), 'без крена').toBeLessThan(1e-9);
          hits += room.drillNow().flying.sparks + room.drillNow().flying.bits;
        }
      }
      expect(hits, 'удары встретили камень или чучело').toBeGreaterThan(0);
      expect(worst, 'взгляд от отдачи — не дальше 1,5°').toBeLessThan(0.03);
      room.dispose();
    }
  });

  it('чучело, след и зарубки — в бюджете отработки на каждом уровне', () => {
    const tris = ([0, 1, 2] as const).map((d) => {
      const dr = new Drill(new THREE.MeshBasicMaterial(), new THREE.Vector3(), d);
      const n = dr.counts();
      dr.dispose();
      return n;
    });
    expect(tris[0]).toBeLessThanOrEqual(tris[1]);
    expect(tris[1]).toBeLessThanOrEqual(tris[2]);
    expect(tris[2], 'потолок отработки — 480 треугольников').toBeLessThan(480);
  });
});
