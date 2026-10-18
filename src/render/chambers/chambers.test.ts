// Покои правителя (docs/city_v3.md, Г-4, Г-5): план комнаты, ходьба и стены, дела касанием мебели, стол из кресла, руки,
// подписи, звук и огонь — числами, без WebGL (геометрия и касания three считаются в узле; атлас без страницы — пустой).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ChambersRoom } from './room';
import { buildRoom } from './build';
import { FIRE_SPEC } from './fire';
import { earGains } from './sound';
import { ACTS, actLength, frameAt, sampleAct } from './acts';
import { BODY_R, OBSTACLES, free, onFloor, pathTo, step, clear, NICHE_END, NICHE_HALF } from './walk';
import { layoutTags, TAG_MIN } from './tags';
import { DEFAULT_ARMS } from '@/heraldry/arms';
import { STICK_FULL } from '@/prologue/controls';
import {
  BED,
  CHAIR,
  CHESTS,
  DESK,
  DESK_THINGS,
  HALF,
  OPENINGS,
  POIS,
  POI_BY_ID,
  SHELVES,
  THINGS,
  TRINKETS,
  WALL_T,
  fitFov,
  type Door,
  type SpotId,
} from './plan';

/** Донжон города (`layout.ts`, `keep`): 13 м, 30 м высоты; подножие — любое, покои считаются от него. */
const KEEP = { x: -4, z: -147, base: 16, height: 30, size: 13 };
/** Экран телефона стоймя — граница области правил «видно», «подписи в кадре». */
const PHONE = { left: 0, top: 0, width: 390, height: 844 };

function phoneRoom(): ChambersRoom {
  const room = new ChambersRoom(KEEP, DEFAULT_ARMS, 'low', () => null);
  room.camera.aspect = PHONE.width / PHONE.height;
  room.camera.updateProjectionMatrix();
  room.setRect(PHONE);
  return room;
}

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

let clock = 0;
/** Прогнать кадры комнаты: `s` секунд по 1/60. */
function run(room: ChambersRoom, s: number, until?: () => boolean): void {
  for (let i = 0; i < Math.round(s * 60); i++) {
    clock += 1 / 60;
    room.frame(1 / 60, clock, SKY);
    if (until?.()) return;
  }
}

/** Где на экране телефона середина коробки предмета. */
function onScreen(room: ChambersRoom, b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }): { x: number; y: number; ndc: THREE.Vector3 } {
  const v = new THREE.Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2).add(room.origin).project(room.camera);
  return { x: ((v.x + 1) / 2) * PHONE.width, y: ((1 - v.y) / 2) * PHONE.height, ndc: v };
}

/** Тап пальцем в точку экрана (левая половина — палец движения: тап и там тап). */
function tap(room: ChambersRoom, x: number, y: number): void {
  room.down(1, x, y, PHONE);
  room.up(1);
}

/** Сеяная кость теста. */
function bone(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/** Мебель телом: коробки, внутри которых глаза быть не может (стол до столешницы, спинка кресла, кровать с пологом…). */
const SOLID: { id: string; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }[] = [
  { id: 'стол', x0: -DESK.w / 2, y0: 0, z0: DESK.z - DESK.d / 2, x1: DESK.w / 2, y1: DESK.top + 0.02, z1: DESK.z + DESK.d / 2 },
  { id: 'спинка кресла', x0: CHAIR.x - 0.32, y0: 0, z0: CHAIR.z - 0.29, x1: CHAIR.x + 0.32, y1: 1.5, z1: CHAIR.z - 0.18 },
  { id: 'сиденье кресла', x0: CHAIR.x - 0.32, y0: 0, z0: CHAIR.z - 0.29, x1: CHAIR.x + 0.32, y1: 0.75, z1: CHAIR.z + 0.27 },
  { id: 'кровать', x0: BED.x0, y0: 0, z0: BED.z0, x1: BED.x1, y1: BED.top + 0.12, z1: BED.z1 },
  { id: 'полог', x0: BED.x0, y0: BED.canopy - 0.4, z0: BED.z0, x1: BED.x1, y1: BED.canopy + 0.2, z1: BED.z1 },
  ...CHESTS.map((c) => ({ id: c.id, x0: c.x0, y0: 0, z0: c.z0, x1: c.x1, y1: c.h, z1: c.z1 })),
  ...SHELVES.map((c) => ({ id: c.id, x0: c.x0, y0: 0, z0: c.z0, x1: c.x1, y1: c.h, z1: c.z1 })),
];

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

  it('места дел: подход — на свободном полу, у мебели и лицом к ней; у каждого дела есть чем его позвать', () => {
    for (const p of POIS) {
      if (p.id === 'hall') {
        expect(free(p.pose.x, p.pose.z), 'вход — на свободном полу').toBe(true);
        continue;
      }
      const a = p.approach!;
      expect(free(a.x, a.z), `${p.id}: подход свободен`).toBe(true);
      expect(p.hits.length, `${p.id}: мебель зовёт касанием`).toBeGreaterThan(0);
      // Лицом к мебели: хоть одна её коробка — в пределах 75° от взгляда подхода (у стола — стол, кресло сбоку).
      const off = Math.min(
        ...p.hits.map((hb) => {
          const dir = Math.atan2((hb.x0 + hb.x1) / 2 - a.x, (hb.z0 + hb.z1) / 2 - a.z);
          return Math.abs(((dir - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        }),
      );
      expect(off, `${p.id}: лицом к мебели`).toBeLessThan((75 * Math.PI) / 180);
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
    expect([...doors].sort()).toEqual(['arms', 'army', 'build', 'decrees', 'map', 'news', 'people', 'treasury']);
    const codes = THINGS.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => c > 0 && c < 256)).toBe(true);
  });

  it('безделушки: кубок, шахматная фигура, меч, корона, свеча — у каждой есть откуда взять', () => {
    expect(TRINKETS.map((t) => t.id).sort()).toEqual(['candle', 'chess', 'crown', 'goblet', 'sword']);
    for (const t of TRINKETS) {
      if (t.stand) expect(free(t.stand.x, t.stand.z), `${t.id}: место у предмета свободно`).toBe(true);
      else expect(t.poi, `${t.id}: берут делом`).toBe('arms');
    }
  });

  it('поле зрения: телефон стоймя видит по горизонтали не меньше 42°, широкий экран — как у точки', () => {
    const v = fitFov(62, PHONE.width / PHONE.height);
    const h = (2 * Math.atan(Math.tan((v * Math.PI) / 360) * (PHONE.width / PHONE.height)) * 180) / Math.PI;
    expect(h).toBeGreaterThanOrEqual(41.9);
    expect(fitFov(62, 16 / 9)).toBe(62);
  });
});

describe('покои: ходьба', () => {
  it('пол — комната и ниша южного окна; стены и мебель — не пол', () => {
    expect(onFloor(0, 0)).toBe(true);
    expect(onFloor(0, NICHE_END - BODY_R - 0.01), 'в нише у окна').toBe(true);
    expect(onFloor(NICHE_HALF, HALF + 0.3), 'на сиденье ниши').toBe(false);
    expect(onFloor(HALF, 0), 'в стене').toBe(false);
    expect(free(0, DESK.z), 'в столе').toBe(false);
    expect(free((BED.x0 + BED.x1) / 2, (BED.z0 + BED.z1) / 2), 'в кровати').toBe(false);
  });

  it('палец движения ведёт сквозь комнату, но ни сквозь стену, ни сквозь мебель — ни на сантиметр', () => {
    // Область правила: всё, куда тело может зайти, — от каждой свободной точки сетки комнаты во все стороны, полным ходом
    // и с поворотами; каждая точка пути — на полу и вне мебели (утверждение — в каждом шаге).
    const room = phoneRoom();
    const r = bone(7);
    let steps = 0;
    let blocked = 0;
    for (let n = 0; n < 40; n++) {
      let p = { x: (r() * 2 - 1) * (HALF - 0.3), z: (r() * 2 - 1) * (HALF - 0.3) };
      if (!free(p.x, p.z)) continue;
      let yaw = r() * Math.PI * 2;
      for (let k = 0; k < 240; k++) {
        if (k % 40 === 0) yaw += (r() - 0.5) * 2.4;
        const d = 1.5 / 60;
        const want = { x: p.x + Math.sin(yaw) * d, z: p.z + Math.cos(yaw) * d };
        const q = step(p, want.x, want.z);
        // Своей меркой, а не судьёй ходьбы: стены — по полуширине комнаты (и ниша окна), мебель — коробками `SOLID`.
        const inNiche = Math.abs(q.x) <= NICHE_HALF - BODY_R + 1e-6 && q.z > 0 && q.z <= NICHE_END - BODY_R + 1e-6;
        const inRoom = Math.abs(q.x) <= HALF - BODY_R + 1e-6 && Math.abs(q.z) <= HALF - BODY_R + 1e-6;
        expect(inRoom || inNiche, `шаг ${n}:${k} — не в стене (${q.x.toFixed(2)}, ${q.z.toFixed(2)})`).toBe(true);
        for (const b of SOLID) {
          const dx = q.x - Math.min(Math.max(q.x, b.x0), b.x1);
          const dz = q.z - Math.min(Math.max(q.z, b.z0), b.z1);
          expect(Math.hypot(dx, dz), `шаг ${n}:${k} — тело в «${b.id}» (${q.x.toFixed(2)}, ${q.z.toFixed(2)})`).toBeGreaterThan(BODY_R - 1e-6);
        }
        if (Math.hypot(q.x - want.x, q.z - want.z) > 1e-3) blocked++;
        p = q;
        steps++;
      }
    }
    // Мебель и стены правда встречались — иначе свойство проверено даром.
    expect(steps).toBeGreaterThan(5000);
    expect(blocked, 'тело упиралось в стены и мебель').toBeGreaterThan(300);
    room.dispose();
  });

  it('пальцем в комнате: от входа в стену наискось — встаёт у стены и скользит вдоль неё', () => {
    const room = phoneRoom();
    // Лицом на запад с уклоном к югу; палец движения слева — вверх на полный ход, пять секунд.
    room.snap('hall', -Math.PI / 2 + 0.35 - POI_BY_ID.hall.pose.yaw, 0);
    room.down(1, 80, 700, PHONE);
    room.move(1, 80, 700 - STICK_FULL - 10);
    run(room, 3);
    const mid = room.state();
    run(room, 2);
    const s = room.state();
    expect(s.x, 'у западной стены').toBeLessThan(-(HALF - BODY_R - 0.02));
    expect(s.x, 'не в стене').toBeGreaterThanOrEqual(-(HALF - BODY_R) - 1e-6);
    expect(s.z - mid.z, 'вдоль стены — скользит').toBeGreaterThan(0.4);
    expect(free(s.x, s.z)).toBe(true);
    room.up(1);
    room.dispose();
  });

  it('путь к каждому делу — в обход мебели: от сотни свободных точек комнаты каждый отрезок свободен', () => {
    const r = bone(11);
    let paths = 0;
    for (let n = 0; n < 200 && paths < 100; n++) {
      const a = { x: (r() * 2 - 1) * (HALF - 0.3), z: (r() * 2 - 1) * (HALF - 0.3) };
      if (!free(a.x, a.z)) continue;
      for (const p of POIS) {
        if (!p.approach) continue;
        const path = pathTo(a, p.approach);
        expect(path, `от (${a.x.toFixed(2)}, ${a.z.toFixed(2)}) к «${p.name}»`).not.toBeNull();
        let q = a;
        for (const s of path!) {
          // Своей пробой, а не судьёй пути: каждые 5 см отрезка — тело на полу и вне мебели.
          const n = Math.ceil(Math.hypot(s.x - q.x, s.z - q.z) / 0.05);
          for (let i = 0; i <= n; i++) expect(free(q.x + ((s.x - q.x) * i) / n, q.z + ((s.z - q.z) * i) / n), `отрезок к «${p.name}» свободен`).toBe(true);
          expect(clear(q, s)).toBe(true);
          q = s;
        }
        expect(q.x).toBeCloseTo(p.approach.x, 6);
        expect(q.z).toBeCloseTo(p.approach.z, 6);
      }
      paths++;
    }
    expect(paths).toBe(100);
  });

  it('препятствий хватает: стол, кресло, кровать, камин, сундуки, полки, шахматы, подсвечники', () => {
    const ids = OBSTACLES.map((o) => o.id);
    for (const id of ['desk', 'chair', 'bed', 'hearth', 'chestBed', 'chestArms', 'chestSouth', 'books', 'scrolls', 'chess', 'standW', 'standE']) expect(ids, id).toContain(id);
  });
});

describe('покои: дела касанием мебели', () => {
  /** Повернуться от входа к мебели дела и найти точку экрана, касание которой зовёт это дело. */
  function aimAt(room: ChambersRoom, id: SpotId): { x: number; y: number } {
    const hb = POI_BY_ID[id].hits[0];
    const hall = POI_BY_ID.hall.pose;
    const cx = (hb.x0 + hb.x1) / 2;
    const cz = (hb.z0 + hb.z1) / 2;
    const yaw = Math.atan2(cx - hall.x, cz - hall.z);
    const pitch = Math.atan2((hb.y0 + hb.y1) / 2 - 1.62, Math.hypot(cx - hall.x, cz - hall.z));
    room.snap('hall', yaw - hall.yaw, pitch - hall.pitch);
    for (let y = 120; y < 760; y += 16) {
      for (let x = 20; x < 380; x += 16) {
        const a = room.pickAt(x, y);
        if (a?.kind === 'poi' && a.poi.id === id) return { x, y };
      }
    }
    throw new Error(`${id}: мебели не видно`);
  }

  it('каждое дело — касанием своей мебели: подходит сам, делает дело, глаз — в позе дела', () => {
    for (const id of ['desk', 'window', 'hearth', 'bed', 'arms'] as SpotId[]) {
      const room = phoneRoom();
      const at = aimAt(room, id);
      tap(room, at.x, at.y);
      expect(['walk', 'act'], `${id}: пошёл`).toContain(room.state().mode);
      run(room, 20, () => room.state().mode === 'in');
      const s = room.state();
      expect(s.mode, `${id}: в деле`).toBe('in');
      expect(s.spot).toBe(id);
      const pose = POI_BY_ID[id].pose;
      expect(Math.hypot(s.x - pose.x, s.y - pose.y, s.z - pose.z), `${id}: глаз в позе дела`).toBeLessThan(0.01);
      if (id === 'arms') expect(room.view().held, 'меч в руке').toBe('sword');
      room.dispose();
    }
  });

  it('палец движения поднимает из дела: встаёт к месту подхода и дальше идёт сам', () => {
    const room = phoneRoom();
    room.snap('desk');
    room.down(1, 80, 700, PHONE);
    room.move(1, 80, 700 + STICK_FULL);
    run(room, 4, () => room.state().mode === 'free');
    expect(room.state().mode).toBe('free');
    room.up(1);
    const a = POI_BY_ID.desk.approach!;
    // Встал у подлокотника и, может быть, уже шагнул назад — но не дальше полуметра.
    expect(Math.hypot(room.state().x - a.x, room.state().z - a.z)).toBeLessThan(0.5);
    room.dispose();
  });

  it('глаз в деле не проходит сквозь мебель и стены: каждые 20 мс пути — вне мебели и в комнате', () => {
    for (const a of Object.values(ACTS)) {
      for (const f of sampleAct(a)) {
        expect(Math.abs(f.x) < HALF && f.z > -HALF && f.z < NICHE_END, `${a.id}: в комнате`).toBe(true);
        for (const b of SOLID) {
          const inside = f.x > b.x0 && f.x < b.x1 && f.y > b.y0 && f.y < b.y1 && f.z > b.z0 && f.z < b.z1;
          expect(inside, `${a.id}: глаз в «${b.id}» (${f.x.toFixed(2)}, ${f.y.toFixed(2)}, ${f.z.toFixed(2)})`).toBe(false);
        }
      }
    }
  });

  it('дела плавные: с места и до места без рывка, скорость глаза и поворота — в пределах шага и взгляда', () => {
    // Граница области — всё время дела, шаг 20 мс; утверждения: на концах скорость — ноль, в середине глаз не быстрее
    // 1,6 м/с и голова не быстрее 3 рад/с, ускорение — без скачков (не больше 14 м/с² и 30 рад/с²).
    for (const a of Object.values(ACTS)) {
      const dt = 0.02;
      const fs = sampleAct(a, dt);
      expect(fs.length).toBeGreaterThan(30);
      const vel = (i: number): { v: number; w: number } => ({
        v: Math.hypot(fs[i + 1].x - fs[i].x, fs[i + 1].y - fs[i].y, fs[i + 1].z - fs[i].z) / dt,
        w: Math.hypot(fs[i + 1].yaw - fs[i].yaw, fs[i + 1].pitch - fs[i].pitch) / dt,
      });
      expect(vel(0).v, `${a.id}: трогается плавно`).toBeLessThan(0.08);
      expect(vel(fs.length - 2).v, `${a.id}: встаёт плавно`).toBeLessThan(0.08);
      for (let i = 0; i + 2 < fs.length; i++) {
        const v0 = vel(i);
        const v1 = vel(i + 1);
        expect(v0.v, `${a.id}: глаз не бежит`).toBeLessThan(1.6);
        expect(v0.w, `${a.id}: голова не дёргается`).toBeLessThan(3);
        expect(Math.abs(v1.v - v0.v) / dt, `${a.id}: без рывка шага (${i})`).toBeLessThan(14);
        expect(Math.abs(v1.w - v0.w) / dt, `${a.id}: без рывка взгляда (${i})`).toBeLessThan(30);
      }
      // Начало — поза подхода, конец — поза дела.
      expect(frameAt(a, 0).y).toBeCloseTo(1.62, 6);
      expect(frameAt(a, actLength(a)).y).toBeCloseTo(POI_BY_ID[a.id].pose.y, 6);
    }
  });
});

describe('покои: стол из кресла', () => {
  it('из кресла на телефоне видны все предметы стола — ниже шапки и выше нижнего края', () => {
    const room = phoneRoom();
    room.snap('desk');
    for (const t of DESK_THINGS) {
      const s = onScreen(room, t.box);
      expect(s.ndc.z, `${t.id}: перед глазом`).toBeLessThan(1);
      expect(s.x, `${t.id}: по ширине экрана`).toBeGreaterThan(8);
      expect(s.x).toBeLessThan(PHONE.width - 8);
      expect(s.y, `${t.id}: ниже шапки`).toBeGreaterThan(70);
      expect(s.y, `${t.id}: выше «Встать»`).toBeLessThan(760);
    }
    room.dispose();
  });

  it('касание предмета стола из кресла открывает его окно; издали — ведёт к столу, садит, и окна не открывает', () => {
    const room = phoneRoom();
    const used: [Door, string][] = [];
    room.onUse = (door, id) => used.push([door, id]);
    room.snap('desk');
    for (const t of DESK_THINGS) {
      const s = onScreen(room, t.box);
      tap(room, s.x, s.y);
      expect(used[used.length - 1], `${t.id}: окно ${t.door}`).toEqual([t.door, t.id]);
    }
    expect(used.length).toBe(DESK_THINGS.length);
    // Из середины покоев: касание письма — шаг к столу, а не окно.
    room.snap('hall');
    const letters = DESK_THINGS.find((t) => t.id === 'letters')!;
    const s = onScreen(room, letters.box);
    tap(room, s.x, s.y);
    expect(used.length, 'издали окно не открылось').toBe(DESK_THINGS.length);
    run(room, 20, () => room.state().mode === 'in');
    expect(room.state().spot, 'сел за стол').toBe('desk');
    expect(used.length, 'и сев, окна не открыл').toBe(DESK_THINGS.length);
    room.dispose();
  });

  it('ведение пальцем справа — поворот головы, а не касание: окно не открывается', () => {
    const room = phoneRoom();
    let used = 0;
    room.onUse = () => used++;
    room.snap('desk');
    const map = onScreen(room, DESK_THINGS.find((t) => t.id === 'map')!.box);
    const x = Math.max(map.x, PHONE.width / 2 + 10);
    const yaw0 = room.state().yaw;
    room.down(1, x, map.y, PHONE);
    for (let k = 1; k <= 6; k++) room.move(1, x - k * 10, map.y);
    room.up(1);
    run(room, 0.1);
    expect(used).toBe(0);
    expect(room.state().yaw, 'голова повернулась').not.toBeCloseTo(yaw0, 3);
    expect(room.state().mode, 'и не встал').toBe('in');
    room.dispose();
  });

  it('безделушку берут в руки касанием сидя, а положить — касанием мимо', () => {
    const room = phoneRoom();
    const goblet = TRINKETS.find((t) => t.id === 'goblet')!;
    // Кубок — у края кадра: берём его, повернув голову к нему.
    room.snap('desk', -0.35, 0);
    const s = onScreen(room, goblet.box);
    tap(room, s.x, s.y);
    expect(room.view().held).toBe('goblet');
    tap(room, 300, 140);
    run(room, 1);
    expect(room.view().held, 'кладёт').toBe(null);
    room.dispose();
  });
});

describe('покои: подписи предметов стола', () => {
  /** Подписи кадра: видимые — в рамке экрана и не налезают друг на друга. */
  function checkTags(room: ChambersRoom, what: string): number {
    const tags = room.layoutDeskTags();
    const vis = tags.filter((t) => t.visible);
    for (const t of vis) {
      expect(t.x - t.w / 2, `${what}: ${t.id} не за левым краем`).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w / 2, `${what}: ${t.id} не за правым краем`).toBeLessThanOrEqual(PHONE.width);
      expect(t.y - t.h / 2, `${what}: ${t.id} ниже шапки`).toBeGreaterThanOrEqual(60);
      expect(t.y + t.h / 2, `${what}: ${t.id} не за нижним краем`).toBeLessThanOrEqual(PHONE.height);
    }
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i];
        const b = vis[j];
        const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
        expect(overlap, `${what}: «${a.id}» налезает на «${b.id}»`).toBe(false);
      }
    return vis.length;
  }

  it('сидя за столом — все восемь, при повороте головы — каждая, чей предмет на экране, на месте у предмета', () => {
    const room = phoneRoom();
    // Область: повороты головы сидя, при которых предмет стола в кадре (точка над ним — внутри экрана).
    let checked = 0;
    for (const dyaw of [0, -0.12, 0.12, -0.3, 0.3]) {
      for (const dp of [0, -0.15, 0.12]) {
        room.snap('desk', dyaw, dp);
        run(room, 0.05);
        const n = checkTags(room, `поворот ${dyaw}/${dp}`);
        const tags = room.layoutDeskTags();
        for (const t of tags) {
          const inFrame = t.ax > 0 && t.ax < PHONE.width && t.ay > 64 && t.ay < PHONE.height;
          if (!inFrame) continue;
          checked++;
          expect(t.visible, `поворот ${dyaw}/${dp}: «${t.id}» на экране — подпись видна`).toBe(true);
          expect(Math.abs(t.x - t.ax), `«${t.id}»: подпись у предмета по ширине`).toBeLessThan(t.w);
          expect(Math.abs(t.y - t.ay), `«${t.id}»: подпись у предмета по высоте`).toBeLessThan(3.5 * t.h);
        }
        if (dyaw === 0 && dp === 0) expect(n, 'сидя прямо — все восемь').toBe(DESK_THINGS.length);
      }
    }
    expect(checked).toBeGreaterThan(60);
    room.dispose();
  });

  it('вдали подписи мельче, но не мельче кегля 12, и тоже не налезают', () => {
    const room = phoneRoom();
    room.snap('desk');
    const near = room.layoutDeskTags().filter((t) => t.visible).map((t) => t.scale);
    room.snap('hall');
    run(room, 0.05);
    checkTags(room, 'из глубины покоев');
    const far = room.layoutDeskTags().filter((t) => t.visible).map((t) => t.scale);
    expect(far.length, 'издали подписи есть').toBeGreaterThan(0);
    expect(Math.max(...far)).toBeLessThan(Math.min(...near));
    expect(Math.min(...far)).toBeGreaterThanOrEqual(TAG_MIN - 1e-9);
    room.dispose();
  });

  it('раскладка прячет подпись, которой нет места, а не кладёт её поверх', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, text: 'Перечень войска', ax: 195, ay: 300, dist: 1, on: true }));
    const out = layoutTags(items, { left: 0, top: 64, right: 390, bottom: 844 });
    const vis = out.filter((t) => t.visible);
    expect(vis.length).toBeGreaterThan(2);
    expect(vis.length).toBeLessThan(12);
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
    // Потолок покоев — тот же, что у Г-4: 12 / 16 / 20 тысяч; город за окном несёт свои (docs/city_v3.md, Г-5, «Скорость»).
    expect(tris[0]).toBeLessThan(12000);
    expect(tris[1]).toBeLessThan(16000);
    expect(tris[2]).toBeLessThan(20000);
  });

  it('тело: руки на подлокотниках сидя, у огня, на подоконнике; стоя — тела нет', () => {
    for (const id of ['desk', 'hearth', 'window'] as SpotId[]) {
      const room = phoneRoom();
      room.snap(id);
      run(room, 0.05);
      const body = room.scene.getObjectByName('chambers-body') as THREE.Mesh;
      expect(body.visible, `${id}: руки видны`).toBe(true);
      // Кисти в кадре: хоть часть вершин тела — на экране телефона.
      const pos = body.geometry.getAttribute('position');
      let seen = 0;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i).add(room.origin).project(room.camera);
        if (Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1 && v.z > -1) seen++;
      }
      expect(seen, `${id}: руки в кадре`).toBeGreaterThan(20);
      room.dispose();
    }
    const room = phoneRoom();
    room.snap('hall');
    run(room, 0.05);
    expect((room.scene.getObjectByName('chambers-body') as THREE.Mesh).visible, 'стоя — рук нет').toBe(false);
    room.dispose();
  });

  it('сторож плавности опускает покои: на «Низком» — меньше ламп, без тени огня и без рельефа камня', () => {
    const room = new ChambersRoom(KEEP, DEFAULT_ARMS, 'medium', () => null);
    const mats = () => room.scene.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh && o.name === 'chambers-stone').map((m) => m.material as THREE.ShaderMaterial);
    expect(mats()[0].defines.BUMP, 'на «Среднем» камень с рельефом').toBe(1);
    const before = mats()[0].defines.LIGHTS as number;
    room.setLevel('low');
    expect(mats()[0].defines.BUMP).toBeUndefined();
    expect(mats()[0].defines.FIRE_SHADOW).toBeUndefined();
    expect(mats()[0].defines.LIGHTS as number).toBeLessThan(before);
    room.dispose();
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
});
