// Клубок в окно (docs/city_v3.md, Р-1): брошен в окно — летит в проём и наружу, кот прыгает за ним, исчезает, через секунду
// возвращается с клубком в зубах (окно в кадре — вспрыгивает на подоконник из-под его края; отвернулся — запрыгивает снизу
// экрана), кладёт его и играет на полу; ни клубок, ни кот не проходят сквозь камень. Кидать — не чаще раза в десять секунд.
// Числами, без WebGL.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChambersRoom } from './room';
import { DEFAULT_ARMS } from '@/heraldry/arms';
import { HALF, OPENINGS, WALL_T } from './plan';
import { BALL_EVERY, BALL_R, depthOf, flightAt, passable, windowShot } from './toss';
import { free } from './walk';
import { ballWords } from '@/ui/chambers/Chambers';

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

function catRoom(): ChambersRoom {
  const room = new ChambersRoom(KEEP, DEFAULT_ARMS, 'low', () => null, { cat: true, catSpot: 'hearth' });
  room.camera.aspect = PHONE.width / PHONE.height;
  room.camera.updateProjectionMatrix();
  room.setRect(PHONE);
  return room;
}

let clock = 0;
function run(room: ChambersRoom, s: number, each?: () => void): void {
  for (let i = 0; i < Math.round(s * 60); i++) {
    clock += 1 / 60;
    room.frame(1 / 60, clock, SKY);
    each?.();
  }
}

/** Точка комнаты на экране телефона, точки. */
function screen(room: ChambersRoom, p: readonly [number, number, number]): { x: number; y: number; front: boolean } {
  const v = new THREE.Vector3(p[0], p[1], p[2]).add(room.origin).project(room.camera);
  return { x: ((v.x + 1) / 2) * PHONE.width, y: ((1 - v.y) / 2) * PHONE.height, front: v.z < 1 };
}

const south = OPENINGS.find((o) => o.wall === 'south')!;
const east = OPENINGS.find((o) => o.wall === 'east')!;
const west = OPENINGS.find((o) => o.wall === 'west')!;

/** Откуда и куда смотреть, чтобы кинуть в окно: южное (большое), восточное и западное (парные). */
const AIMS = [
  { name: 'южное', o: south, x: 0, z: 1.0, yaw: 0, pitch: 0.05 },
  { name: 'южное наискось', o: south, x: -1.5, z: 3.8, yaw: 0.3, pitch: 0.1 },
  { name: 'восточное', o: east, x: 2.5, z: 2.3, yaw: Math.PI / 2, pitch: 0.1 },
  { name: 'западное', o: west, x: -2.5, z: 2.3, yaw: -Math.PI / 2, pitch: 0.1 },
] as const;

describe('клубок в окно (Р-1)', () => {
  it('брошен в окно — кот прыгает за ним, исчезает, через секунду возвращается с клубком в зубах, кладёт и играет; сквозь камень — ни клубок, ни кот', () => {
    for (const a of AIMS) {
      const room = catRoom();
      const cues: string[] = [];
      room.onLifeCue = (c) => cues.push(c);
      const c = room.life.cat!;
      c.sitAt(a.x - 0.5, a.z - 0.5, 0);
      room.standAtPoint(a.x, a.z, a.yaw, a.pitch);
      run(room, 0.1);
      expect(room.life.throwBall(), `${a.name}: кинул`).toBe(true);
      const seen = new Set<string>();
      let gone = -1;
      let back = -1;
      let wentOut = false;
      let t = 0;
      run(room, 14, () => {
        t += 1 / 60;
        const b = room.life.ballNow();
        if (b) seen.add(b.mode);
        // Сквозь камень — никогда: клубок в полёте и на полу, кот — спиной и лапами.
        if (b && b.visible && b.mode !== 'mouth') expect(passable(b.p, BALL_R * 0.9), `${a.name}: клубок в воздухе (${b.p.map((q) => q.toFixed(2))})`).toBe(true);
        if (c.visible) expect(passable([c.x, c.y + 0.15, c.z], 0.05), `${a.name}: кот в воздухе (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}, ${c.mind})`).toBe(true);
        if (b?.mode === 'out' && depthOf(a.o, b.p) > WALL_T) wentOut = true;
        if (!c.visible && gone < 0) {
          gone = t;
          // Ушёл в то же окно, за грань стены.
          expect(depthOf(a.o, [c.x, c.y, c.z]), `${a.name}: кот ушёл наружу`).toBeGreaterThan(WALL_T);
        }
        if (gone >= 0 && back < 0 && c.visible) {
          back = t;
          expect(c.mouthful, `${a.name}: вернулся с клубком в зубах`).toBe(true);
          expect(room.life.ballNow()?.mode).toBe('mouth');
        }
      });
      expect(seen.has('flight'), `${a.name}: клубок полетел в окно (точка — в области правила)`).toBe(true);
      expect(wentOut, `${a.name}: клубок вылетел за стену`).toBe(true);
      expect(gone, `${a.name}: кот исчез за окном`).toBeGreaterThan(0);
      // «Через секунду» — слово владельца, а не константа кода.
      expect(back - gone, `${a.name}: за окном — секунду`).toBeGreaterThanOrEqual(0.98);
      expect(back - gone, `${a.name}: за окном — секунду`).toBeLessThan(1.3);
      // Положил и играет: клубок на полу в покоях, кот гоняет его, мурчит.
      const b = room.life.ballNow()!;
      expect(b.mode, `${a.name}: клубок на полу`).toBe('floor');
      expect(Math.abs(b.p[0]) < HALF && Math.abs(b.p[2]) < HALF && b.p[1] < 0.1, `${a.name}: клубок в покоях на полу`).toBe(true);
      expect(c.mouthful).toBe(false);
      expect(['play', 'wander']).toContain(c.mind);
      expect(cues, `${a.name}: звук прыжка`).toContain('catLeap');
      expect(cues, `${a.name}: звук приземления`).toContain('catLand');
      room.dispose();
    }
  });

  it('принёс — мурчит', () => {
    const room = catRoom();
    const c = room.life.cat!;
    const a = AIMS[2];
    c.sitAt(a.x - 0.5, a.z - 0.5, 0);
    room.standAtPoint(a.x, a.z, a.yaw, a.pitch);
    room.life.throwBall();
    let purr = 0;
    let dropped = false;
    run(room, 14, () => {
      if (room.life.ballNow()?.mode === 'mouth') dropped = false;
      if (!dropped && room.life.ballNow()?.mode === 'floor' && room.life.view().fetching === false && c.visible) dropped = true;
      if (dropped) purr = Math.max(purr, c.purring);
    });
    expect(dropped).toBe(true);
    expect(purr, 'мурчит, принеся клубок').toBeGreaterThan(0.5);
    room.dispose();
  });

  it('окно в кадре — кот вспрыгивает на подоконник из-под его края; отвернулся — запрыгивает снизу экрана', () => {
    // Окно в кадре: правитель смотрит туда же, куда кинул.
    {
      const room = catRoom();
      const c = room.life.cat!;
      const a = AIMS[0];
      c.sitAt(a.x - 0.5, a.z - 0.5, 0);
      room.standAtPoint(a.x, a.z, a.yaw, a.pitch);
      room.life.throwBall();
      let first: [number, number, number] | null = null;
      let wasGone = false;
      run(room, 14, () => {
        if (!c.visible) wasGone = true;
        if (wasGone && c.visible && !first) first = [c.x, c.y, c.z];
      });
      expect(first, 'вернулся').not.toBeNull();
      // Снаружи, ниже подоконника — из-под его края.
      expect(depthOf(south, first!)).toBeGreaterThan(WALL_T);
      expect(first![1]).toBeLessThan(south.sill - 0.5);
      room.dispose();
    }
    // Отвернулся: кот возникает под нижним краем экрана и прыгает в кадр снизу.
    {
      const room = catRoom();
      const c = room.life.cat!;
      const a = AIMS[0];
      c.sitAt(a.x - 0.5, a.z - 0.5, 0);
      room.standAtPoint(a.x, a.z, a.yaw, a.pitch);
      room.life.throwBall();
      run(room, 2.5);
      expect(c.mind === 'fetch' || !c.visible, 'кот за клубком').toBe(true);
      room.standAtPoint(a.x, a.z, Math.PI, -0.2);
      const path: { x: number; y: number; front: boolean }[] = [];
      let wasGone = false;
      run(room, 12, () => {
        if (!c.visible) wasGone = true;
        if (wasGone && c.visible && room.life.ballNow()?.mode === 'mouth') path.push(screen(room, [c.x, c.y + 0.2, c.z]));
      });
      expect(path.length, 'прыжок обратно виден по кадрам').toBeGreaterThan(10);
      expect(path[0].y > PHONE.height || !path[0].front, `возник вне кадра, снизу (${path[0].x.toFixed(0)}, ${path[0].y.toFixed(0)})`).toBe(true);
      const last = path[path.length - 1];
      expect(last.front && last.y > 0 && last.y < PHONE.height && last.x > 0 && last.x < PHONE.width, `приземлился в кадре (${last.x.toFixed(0)}, ${last.y.toFixed(0)})`).toBe(true);
      // Входит снизу: пока не в кадре — ниже его нижнего края, а не сбоку и не сверху.
      for (const p of path) if (p.front && (p.y < 0 || p.x < -40 || p.x > PHONE.width + 40)) throw new Error(`кот вошёл не снизу: (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
      room.dispose();
    }
  });

  it('кинуть — не чаще раза в десять секунд: кнопка говорит, через сколько', () => {
    const room = catRoom();
    const c = room.life.cat!;
    // На пол, прочь от окон: взгляд в пол посреди покоев.
    c.sitAt(0.4, -1.3, Math.PI);
    room.standAtPoint(0.4, -0.5, Math.PI, -0.6);
    run(room, 0.1);
    expect(room.life.view().ballIn).toBe(0);
    expect(ballWords(room.life.view())).toBe('Кинуть клубок');
    expect(room.life.throwBall()).toBe(true);
    expect(room.life.ballNow()?.mode, 'бросок на пол — не в окно').toBe('floor');
    const t0 = room.life.clock.t;
    run(room, 3);
    expect(room.life.view().ballIn).toBe(7);
    expect(ballWords(room.life.view())).toBe('Клубок — через 7 с');
    expect(room.life.throwBall(), 'через три секунды — нельзя').toBe(false);
    // Граница — `BALL_EVERY` секунд от броска: точки по обе её стороны.
    run(room, BALL_EVERY - 3 - 0.1);
    const before = room.life.clock.t - t0;
    expect(before).toBeLessThan(BALL_EVERY);
    expect(room.life.throwBall(), `${before.toFixed(2)} с — нельзя`).toBe(false);
    run(room, 0.2);
    const after = room.life.clock.t - t0;
    expect(after).toBeGreaterThanOrEqual(BALL_EVERY);
    expect(room.life.view().ballIn).toBe(0);
    expect(room.life.throwBall(), `${after.toFixed(2)} с — можно`).toBe(true);
    room.dispose();
  });

  it('пока кот за окном — кинуть нельзя, и кнопка говорит, что он несёт', () => {
    const room = catRoom();
    const c = room.life.cat!;
    const a = AIMS[2];
    c.sitAt(a.x - 0.5, a.z - 0.5, 0);
    room.standAtPoint(a.x, a.z, a.yaw, a.pitch);
    room.life.throwBall();
    run(room, 1);
    expect(room.life.view().fetching).toBe(true);
    expect(ballWords(room.life.view())).toBe('Кот несёт клубок…');
    expect(room.life.throwBall()).toBe(false);
    room.dispose();
  });

  it('дуга в окно — воздухом от руки до наружной грани: откуда ни кинь, ни камня, ни мебели', () => {
    // Область правила — броски, которые приняты за бросок в окно: из каждой точки пола сеткой в три четверти метра, взглядом на середину
    // каждого окна и мимо неё (в пядь в стороны, ниже и выше).
    let shots = 0;
    for (let x = -4.5; x <= 4.5; x += 0.75) {
      for (let z = -2; z <= 4.75; z += 0.75) {
        if (!free(x, z)) continue;
        for (const o of OPENINGS) {
          const n = o.wall === 'south' ? [0, 1] : o.wall === 'east' ? [1, 0] : [-1, 0];
          const cx = o.wall === 'south' ? o.at : n[0] * (HALF + o.plate);
          const cz = o.wall === 'south' ? HALF + o.plate : o.at;
          const base = Math.atan2(cx - x, cz - z);
          for (const dy of [-0.12, 0, 0.12]) {
            for (const pitch of [-0.15, 0, 0.12, 0.3]) {
              const yaw = base + dy;
              const eye: [number, number, number] = [x, 1.62, z];
              const hand: [number, number, number] = [x + Math.sin(yaw) * 0.35, 1.17, z + Math.cos(yaw) * 0.35];
              const shot = windowShot(eye, yaw, pitch, hand);
              if (!shot) continue;
              shots++;
              let out = false;
              for (let t = 0; t < 3 && !out; t += 1 / 600) {
                const p = flightAt(hand, shot.v, t);
                const where = `(${x}, ${z}) → ${o.wall}, ${t.toFixed(3)} с: (${p.map((q) => q.toFixed(2))})`;
                expect(passable(p, BALL_R * 0.95), `${where}: воздух`).toBe(true);
                if (Math.abs(p[0]) < HALF && Math.abs(p[2]) < HALF && p[1] - BALL_R < 0.8) expect(free(p[0], p[2], BALL_R * 0.95), `${where}: мимо мебели`).toBe(true);
                out = depthOf(shot.o, p) > WALL_T + 0.3;
              }
              expect(out, `(${x}, ${z}) → ${o.wall}: вылетел наружу`).toBe(true);
            }
          }
        }
      }
    }
    expect(shots, 'бросков в окно в сетке').toBeGreaterThan(100);
  });

  it('воздух и камень: проём, ниша и комната — воздух; стена рядом с окном и подоконник под проёмом — камень; в стену рядом с окном — не в окно', () => {
    expect(passable([0, 1.6, 0], BALL_R)).toBe(true);
    expect(passable([0, 1.6, HALF + 0.5], BALL_R), 'ниша южного окна').toBe(true);
    expect(passable([0, 1.6, HALF + 1.1], BALL_R), 'проём южного окна').toBe(true);
    expect(passable([0, 1.6, HALF + WALL_T + 0.4], BALL_R), 'за стеной').toBe(true);
    expect(passable([2.2, 1.6, HALF + 0.5], BALL_R), 'стена рядом с нишей').toBe(false);
    expect(passable([0, south.sill - 0.1, HALF + 1.1], BALL_R), 'подоконник').toBe(false);
    expect(passable([0, 1.6, HALF + 1.1].map((v, i) => (i === 0 ? south.outW / 2 + 0.05 : v)) as [number, number, number], BALL_R), 'откос проёма').toBe(false);
    // Парное окно: столбик между проёмами — камень.
    expect(passable([HALF + 1.05, 1.6, east.at], BALL_R), 'столбик парного окна').toBe(false);
    // В стену рядом с окном и в пол ниши — бросок обычный.
    const hand: [number, number, number] = [0.3, 1.17, 1.3];
    expect(windowShot([0, 1.62, 1.0], 0, 0.05, [0, 1.17, 1.35]), 'в окно').not.toBeNull();
    expect(windowShot([3, 1.62, 1.0], 0, 0.05, [3, 1.17, 1.35]), 'в стену с гербом').toBeNull();
    expect(windowShot([0, 1.62, 1.3], 0, -0.3, hand), 'в пол ниши под подоконником').toBeNull();
  });
});
