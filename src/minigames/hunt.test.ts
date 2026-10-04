/**
 * «Охота»: поле и олени от зерна, стрела по дуге, лук, колчан и счёт (docs/minigames.md, раздел 13).
 *
 * Область каждого правила названа и проверена утверждением (правило 11): раскладка — на двухстах зёрнах; дуга — на
 * дальностях, где у стрелы полной натяжки есть пологая дорога к цели (`aimFor` не `null`) и где падение больше
 * полувысоты корпуса (тридцать метров) или меньше её (восемь); поведение — на олене, который в эту секунду пасётся
 * (точка внутри: поза утверждается); повтор от зерна — на ряде, где стрелы и олени что-то делают (попадание и бег
 * утверждаются).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EYE as GLADE_EYE } from '@/prologue/glade';
import { carcass as carcassModel, deer as deerModel } from '@/prologue/models';
import {
  ALERT_S,
  ARROWS,
  BIRCH,
  BUSH,
  ARROW_STEP,
  CARCASS,
  COVER_COUNT,
  DEER,
  DEER_BODY,
  DEER_NECK,
  DRAW_S,
  ESCAPE_R,
  EYE_Y,
  FIELD_R,
  GRAVITY,
  HEAD_DOWN,
  HEAD_UP,
  HEAR,
  Hunt,
  LOOSE_MIN,
  NOCK_AHEAD,
  NOCK_S,
  REACT_S,
  ROAM_R,
  RUN_SPEED,
  SEE_R,
  SNEAK,
  START,
  TICK,
  V_FULL,
  aimFor,
  clearSight,
  coverRadius,
  flightAt,
  glanceAt,
  hitDeer,
  inCover,
  layHunt,
  pins,
  poseAt,
  speedOf,
  type DeerPose,
  type Hunter,
  type Shot,
} from './hunt';
import { coverMesh } from './huntModels';
import { Shade } from '@/prologue/models';
import { GAME_SECONDS } from './rules';

const SEEDS = Array.from({ length: 200 }, (_, i) => (i * 2654435761) >>> 0);
const STILL: Hunter = { x: START.x, z: START.z, walking: 0 };
const EYE = { x: START.x, y: EYE_Y, z: START.z };

/** Олень стоит в точке, голова поднята: форма попадания без бега и прыжка. */
const standing = (x: number, z: number, yaw = Math.PI / 2): DeerPose => ({ kind: 'alert', x, z, yaw, head: HEAD_UP, lift: 0, speed: 0, ran: 0 });

/** Пустить стрелу и вести её шагами полёта, пока не встретит оленя или землю: во что попала. */
function fly(p: DeerPose, dir: { x: number; y: number; z: number }, v: number): 'deer' | 'ground' | 'air' {
  const s: Shot = { id: 0, t0: 0, x: EYE.x + dir.x * NOCK_AHEAD, y: EYE.y + dir.y * NOCK_AHEAD, z: EYE.z + dir.z * NOCK_AHEAD, vx: dir.x * v, vy: dir.y * v, vz: dir.z * v };
  for (let k = 0; k < 4 / ARROW_STEP; k++) {
    const a = flightAt(s, k * ARROW_STEP);
    const b = flightAt(s, (k + 1) * ARROW_STEP);
    if (hitDeer(p, a.x, a.y, a.z, b.x, b.y, b.z) !== null) return 'deer';
    if (b.y <= 0) return 'ground';
  }
  return 'air';
}

/** Направление на точку с подъёмом `el` над горизонтом. */
function dirTo(x: number, z: number, el: number): { x: number; y: number; z: number } {
  const dx = x - EYE.x;
  const dz = z - EYE.z;
  const d = Math.hypot(dx, dz);
  return { x: (Math.cos(el) * dx) / d, y: Math.sin(el), z: (Math.cos(el) * dz) / d };
}

/** Прямо в середину корпуса — без поправки на падение. */
const straightAt = (x: number, z: number): { x: number; y: number; z: number } => {
  const d = Math.hypot(x - EYE.x, z - EYE.z);
  return dirTo(x, z, Math.atan2(DEER_BODY.y - EYE_Y, d));
};

describe('охота: поле от зерна', () => {
  it('одно зерно — одно поле, другое — другое', () => {
    expect(layHunt(12345)).toEqual(layHunt(12345));
    expect(layHunt(12345)).not.toEqual(layHunt(12346));
  });

  it('шесть оленей тремя кучками на трёх далях, на поле; укрытия все, не у ног и не на оленях; каждая кучка видна со старта', () => {
    const total = Object.values(COVER_COUNT).reduce((n, k) => n + k, 0);
    for (const seed of SEEDS) {
      const f = layHunt(seed);
      expect(f.deer.length).toBe(DEER);
      expect(f.cover.length).toBe(total);
      const far: number[] = [];
      for (const d of f.deer) {
        expect(Math.hypot(d.x, d.z)).toBeLessThan(FIELD_R);
        far.push(Math.hypot(d.x - START.x, d.z - START.z));
      }
      // Даль кучек — ближняя, средняя, дальняя: разброс от пятнадцати шагов до сорока.
      expect(Math.min(...far)).toBeGreaterThan(SEE_R + 6);
      expect(Math.max(...far) - Math.min(...far)).toBeGreaterThan(8);
      for (const c of f.cover) {
        expect(Math.hypot(c.x - START.x, c.z - START.z)).toBeGreaterThanOrEqual(coverRadius(c) + 3.5 - 1e-9);
        for (const d of f.deer) expect(Math.hypot(c.x - d.x, c.z - d.z)).toBeGreaterThanOrEqual(coverRadius(c) + 3 - 1e-9);
      }
      for (let g = 0; g < 3; g++) {
        const seen = f.deer.filter((d) => d.group === g).some((d) => clearSight(f.cover, START.x, EYE_Y, START.z, d.x, DEER_BODY.y, d.z));
        expect(seen, `${seed}: кучка ${g}`).toBe(true);
      }
    }
  });

  it('глаз охотника — того же роста, что у поляны; уйти можно не дальше поля', () => {
    expect(EYE_Y).toBe(GLADE_EYE);
    expect(ROAM_R).toBeLessThan(FIELD_R);
    expect(GAME_SECONDS.hunt).toBeGreaterThan(GAME_SECONDS.berries);
  });
});

describe('охота: стрела по дуге, и дальность решает', () => {
  it('полёт — прямая плюс падение тяжестью', () => {
    const s: Shot = { id: 0, t0: 0, x: 1, y: 2, z: 3, vx: 10, vy: 5, vz: -20 };
    for (const tau of [0, 0.3, 1.1]) {
      const p = flightAt(s, tau);
      expect(p.x).toBeCloseTo(1 + 10 * tau, 9);
      expect(p.z).toBeCloseTo(3 - 20 * tau, 9);
      expect(p.y).toBeCloseTo(2 + 5 * tau - (GRAVITY * tau * tau) / 2, 9);
    }
  });

  it('вблизи бьют прямо в бок; вдали прямой выстрел уходит под оленя, а с поправкой дуги — в него', () => {
    const near = standing(START.x, START.z - 8);
    expect(fly(near, straightAt(near.x, near.z), V_FULL)).toBe('deer');
    for (const d of [25, 30, 35]) {
      const far = standing(START.x, START.z - d);
      // Область: на этой дали падение больше полувысоты корпуса — прямой выстрел обязан уйти вниз.
      const t = d / V_FULL;
      expect((GRAVITY * t * t) / 2).toBeGreaterThan(DEER_BODY.ry);
      expect(fly(far, straightAt(far.x, far.z), V_FULL), `прямо на ${d} м`).toBe('ground');
      const el = aimFor(d - NOCK_AHEAD, DEER_BODY.y - EYE_Y - 0, V_FULL);
      expect(el).not.toBeNull();
      expect(fly(far, dirTo(far.x, far.z, el ?? 0), V_FULL), `с поправкой на ${d} м`).toBe('deer');
    }
  });

  it('слабая натяжка — медленная стрела: на той же дали та же поправка недолетает', () => {
    const far = standing(START.x, START.z - 25);
    const el = aimFor(25 - NOCK_AHEAD, DEER_BODY.y - EYE_Y, V_FULL) ?? 0;
    expect(fly(far, dirTo(far.x, far.z, el), V_FULL)).toBe('deer');
    expect(fly(far, dirTo(far.x, far.z, el), speedOf(0.6))).toBe('ground');
  });

  it('метки прицела растут с далью — та же дуга, что у стрелы', () => {
    const p = pins();
    expect(p.length).toBeGreaterThan(1);
    for (let i = 1; i < p.length; i++) expect(p[i].angle).toBeGreaterThan(p[i - 1].angle);
    for (const { d, angle } of p) {
      // Положить метку на середину корпуса — и стрела полной натяжки попадёт.
      const deer = standing(START.x, START.z - d);
      const line = Math.atan2(DEER_BODY.y - EYE_Y, d);
      expect(fly(deer, dirTo(deer.x, deer.z, line + angle), V_FULL), `метка ${d}`).toBe('deer');
    }
  });

  it('скорость — от натяжки: ниже порога стрела не уходит, дальше — растёт до полной', () => {
    expect(speedOf(0)).toBe(0);
    expect(speedOf(LOOSE_MIN - 1e-6)).toBe(0);
    expect(speedOf(LOOSE_MIN)).toBeGreaterThan(0);
    let was = 0;
    for (let k = LOOSE_MIN; k <= 1 + 1e-9; k += 0.05) {
      expect(speedOf(k)).toBeGreaterThanOrEqual(was);
      was = speedOf(k);
    }
    expect(speedOf(1)).toBe(V_FULL);
    expect(speedOf(Number.NaN)).toBe(0);
  });
});

describe('охота: лук и колчан', () => {
  it('недотянул — стрела не ушла и не потрачена; дотянул — ушла', () => {
    const h = new Hunt(7);
    h.advance(1, STILL);
    h.pull(1);
    expect(h.loose(1 + DRAW_S * LOOSE_MIN * 0.5, EYE, { x: 0, y: 0, z: -1 })).toBeNull();
    expect(h.quiver).toBe(ARROWS);
    h.pull(2);
    expect(h.drawn(2 + DRAW_S)).toBe(1);
    expect(h.loose(2 + DRAW_S, EYE, { x: 0, y: 0, z: -1 })).not.toBeNull();
    expect(h.quiver).toBe(ARROWS - 1);
  });

  it('новую стрелу накладывают не сразу: тетива в это время не тянется', () => {
    const h = new Hunt(7);
    h.pull(0);
    expect(h.loose(DRAW_S, EYE, { x: 0, y: 0.3, z: -1 })).not.toBeNull();
    h.pull(DRAW_S);
    expect(h.drawn(DRAW_S + NOCK_S * 0.9)).toBe(0);
    expect(h.drawn(DRAW_S + NOCK_S + DRAW_S)).toBe(1);
  });

  it('стрел ровно колчан: девятая не уходит', () => {
    const h = new Hunt(7);
    let t = 0;
    for (let i = 0; i < ARROWS; i++) {
      h.pull(t);
      t += NOCK_S + DRAW_S;
      expect(h.loose(t, EYE, { x: 0, y: 0.2, z: -1 }), `стрела ${i + 1}`).not.toBeNull();
    }
    expect(h.quiver).toBe(0);
    h.pull(t);
    expect(h.loose(t + 5, EYE, { x: 0, y: 0.2, z: -1 })).toBeNull();
    expect(h.arrows.length).toBe(ARROWS);
  });
});

/** Прицельный выстрел охотника из `eye` (по умолчанию — со старта) в оленя `i`: поправка дуги по дали, где тот стоит сейчас. */
function aimedAt(h: Hunt, i: number, t: number, eye = EYE): { x: number; y: number; z: number } {
  const p = h.pose(i, t);
  const dx = p.x - eye.x;
  const dz = p.z - eye.z;
  const d = Math.hypot(dx, dz);
  const el = aimFor(d - NOCK_AHEAD, DEER_BODY.y - EYE_Y, V_FULL) ?? 0;
  return { x: (Math.cos(el) * dx) / d, y: Math.sin(el), z: (Math.cos(el) * dz) / d };
}

/** Шаги кадра до `to`: охотник стоит на старте. */
function run(h: Hunt, from: number, to: number, dt: number, hunter: Hunter = STILL): void {
  for (let t = from + dt; t < to + 1e-9; t += dt) h.advance(Math.min(t, to), hunter);
}

/** Свободна ли дуга стрелы полной натяжки от глаза до дали `until` (по земле): ни укрытия, ни земли по пути. */
function arcClear(h: Hunt, eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, until: number): boolean {
  const s: Shot = { id: 0, t0: 0, x: eye.x + dir.x * NOCK_AHEAD, y: eye.y + dir.y * NOCK_AHEAD, z: eye.z + dir.z * NOCK_AHEAD, vx: dir.x * V_FULL, vy: dir.y * V_FULL, vz: dir.z * V_FULL };
  for (let k = 0; k < 4 / ARROW_STEP; k++) {
    const p = flightAt(s, k * ARROW_STEP);
    if (Math.hypot(p.x - eye.x, p.z - eye.z) > until) return true;
    if (p.y < 0 || h.field.cover.some((c) => inCover(c, p.x, p.y, p.z))) return false;
  }
  return false;
}

/** Ближайший видимый со старта олень, который сейчас пасётся. */
function visible(h: Hunt, t: number): number {
  let best = -1;
  let bestD = Infinity;
  h.field.deer.forEach((d, i) => {
    const p = h.pose(i, t);
    if (p.kind !== 'graze' || !clearSight(h.field.cover, EYE.x, EYE.y, EYE.z, p.x, DEER_BODY.y, p.z)) return;
    const dist = Math.hypot(p.x - EYE.x, p.z - EYE.z);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  });
  return best;
}

describe('охота: счёт', () => {
  it('прицельный выстрел валит оленя: счёт один из шести, лежащий не встаёт и второй раз не считается', () => {
    let tried = 0;
    for (const seed of SEEDS.slice(0, 40)) {
      const h = new Hunt(seed);
      run(h, 0, 1, 1 / 60);
      const i = visible(h, 1);
      if (i < 0) continue;
      h.pull(1);
      run(h, 1, 1 + DRAW_S, 1 / 60);
      // Область: дуга до оленя свободна — хвоя над прямой линией взгляда её не ловит.
      const aim = aimedAt(h, i, 1 + DRAW_S);
      const p = h.pose(i, 1 + DRAW_S);
      if (!arcClear(h, EYE, aim, Math.hypot(p.x - EYE.x, p.z - EYE.z) - 1)) continue;
      tried++;
      h.loose(1 + DRAW_S, EYE, aim);
      run(h, 1 + DRAW_S, 4, 1 / 60);
      expect(h.arrows[0].struck, `зерно ${seed}`).toBe('deer');
      expect(h.tally()).toEqual({ got: 1, total: DEER });
      const lay = h.pose(h.arrows[0].what, 4);
      expect(lay.kind).toBe('down');
      // Вторая стрела в тушу — в упор, сверху, с двух шагов: втыкается, но оленя не прибавляет.
      h.pull(4);
      run(h, 4, 4 + DRAW_S, 1 / 60);
      const near = { x: lay.x, y: EYE_Y, z: lay.z + 1.2 };
      const down = { x: 0, y: -(EYE_Y - CARCASS.y), z: -1.2 };
      const len = Math.hypot(down.y, down.z);
      h.loose(4 + DRAW_S, near, { x: 0, y: down.y / len, z: down.z / len });
      run(h, 4 + DRAW_S, 8, 1 / 60);
      expect(h.arrows[1].struck).toBe('deer');
      expect(h.tally().got).toBe(1);
      expect(h.pose(h.arrows[0].what, 8)).toMatchObject({ kind: 'down', x: lay.x, z: lay.z });
    }
    expect(tried, 'точек внутри области — больше половины зёрен').toBeGreaterThan(20);
  });

  it('стрела в ствол останавливается, сквозь укрытие оленя не достать', () => {
    let tried = 0;
    for (const seed of SEEDS.slice(0, 40)) {
      const h = new Hunt(seed);
      // Стрела в ствол берёзы на высоте корпуса оленя — в ту, до которой дуга свободна.
      const aimAt = (k: { x: number; z: number }): { x: number; y: number; z: number } => {
        const d = Math.hypot(k.x - EYE.x, k.z - EYE.z);
        return dirTo(k.x, k.z, aimFor(d - NOCK_AHEAD, 1.0 - EYE_Y, V_FULL) ?? 0);
      };
      const c = h.field.cover.find((k) => k.kind === 'birch' && arcClear(h, EYE, aimAt(k), Math.hypot(k.x - EYE.x, k.z - EYE.z) - 0.5));
      if (!c) continue;
      tried++;
      h.pull(0);
      h.loose(DRAW_S, EYE, aimAt(c));
      run(h, DRAW_S, 4, 1 / 60);
      const a = h.arrows[0];
      expect(a.struck, `зерно ${seed}`).toBe('cover');
      expect(h.field.cover[a.what]).toBe(c);
      expect(inCover(c, a.at!.x + a.dir!.x * 0.05, a.at!.y + a.dir!.y * 0.05, a.at!.z + a.dir!.z * 0.05)).toBe(true);
    }
    expect(tried).toBeGreaterThan(10);
  });

  it('охота кончается раньше времени: колчан пуст и стрелы легли — через полторы секунды', () => {
    const h = new Hunt(3);
    let t = 0;
    for (let i = 0; i < ARROWS; i++) {
      h.pull(t);
      run(h, t, t + NOCK_S + DRAW_S, 1 / 30);
      t += NOCK_S + DRAW_S;
      // Семь — в землю под ноги, последняя — высоко вверх: летит долго.
      const up = i === ARROWS - 1;
      h.loose(t, EYE, up ? { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 } : { x: 0, y: -0.3, z: 0.95 });
      if (!up) run(h, t, t + 3, 1 / 30);
      if (!up) t += 3;
    }
    // Пока последняя в воздухе, охота не кончена, хоть прежние легли давно.
    run(h, t, t + 1, 1 / 30);
    expect(h.flying).toBe(true);
    expect(h.over(t + 1)).toBe(false);
    run(h, t + 1, t + 6, 1 / 30);
    const last = Math.max(...h.arrows.map((a) => a.end ?? Infinity));
    expect(last).toBeLessThan(t + 6);
    expect(h.over(last + 1.4)).toBe(false);
    expect(h.over(last + 1.6)).toBe(true);
  });

  it('пока есть стрелы и олени, охота идёт', () => {
    const h = new Hunt(3);
    run(h, 0, 30, 1 / 30);
    expect(h.over(30)).toBe(false);
  });
});

describe('охота: олени от зерна и вестей', () => {
  it('пасущийся вскидывает голову сам, раз в несколько секунд; голова — между «щиплет» и «смотрит»', () => {
    const h = new Hunt(11);
    for (const d of h.field.deer) {
      let up = 0;
      let down = 0;
      for (let t = 0; t < GAME_SECONDS.hunt; t += 0.1) {
        const p = poseAt(d, h.segs[d.id], t);
        expect(p.kind).toBe('graze');
        expect(p.head).toBeGreaterThanOrEqual(Math.min(HEAD_UP, HEAD_DOWN) - 1e-9);
        expect(p.head).toBeLessThanOrEqual(Math.max(HEAD_UP, HEAD_DOWN) + 1e-9);
        if (glanceAt(d, t) === 1) up++;
        if (glanceAt(d, t) === 0) down++;
      }
      expect(up).toBeGreaterThan(20);
      expect(down).toBeGreaterThan(up);
    }
  });

  it('пасётся плавно: за кадр не перескакивает, и место — функция секунды, а не порядка вопросов', () => {
    const h = new Hunt(11);
    const d = h.field.deer[0];
    let prev = poseAt(d, h.segs[0], 0);
    for (let t = 1 / 60; t < 60; t += 1 / 60) {
      const p = poseAt(d, h.segs[0], t);
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(0.05);
      prev = p;
    }
    expect(poseAt(d, h.segs[0], 37.3)).toEqual(poseAt(d, h.segs[0], 37.3));
  });

  it('на стыке отрезков — без скачка: насторожился и снова пасётся с того же места', () => {
    const h = new Hunt(5);
    run(h, 0, 2, 1 / 30);
    const p = h.pose(0, 2);
    expect(p.kind).toBe('graze');
    const from = { x: p.x + (HEAR.twang.flee + HEAR.twang.alert) / 2, z: p.z };
    h.hear({ t: 2, kind: 'twang', x: from.x, z: from.z, loud: 1, hx: from.x, hz: from.z });
    // Точки внутри области: по обе стороны каждого стыка — пасётся → насторожился → пасётся.
    for (const at of [2, 2 + ALERT_S]) {
      const a = h.pose(0, at - 1e-4);
      const b = h.pose(0, at + 1e-4);
      expect(a.kind).not.toBe(b.kind);
      expect(Math.hypot(a.x - b.x, a.z - b.z), `стык ${at}`).toBeLessThan(1e-3);
    }
    expect(h.pose(0, 2 + ALERT_S + 1e-4).kind).toBe('graze');
  });

  it('тетива рядом срывает, дальше — настораживает; сорвавшийся уходит прочь и в укрытия не бежит', () => {
    let tried = 0;
    for (const seed of SEEDS.slice(0, 60)) {
      const h = new Hunt(seed);
      run(h, 0, 2, 1 / 30);
      // Тетива из точки рядом с оленем 0 и из точки поодаль от оленя 0 — на одну и ту же секунду.
      const p = h.pose(0, 2);
      if (p.kind !== 'graze') continue;
      tried++;
      const from = { x: p.x + HEAR.twang.flee * 0.6, z: p.z };
      h.hear({ t: 2, kind: 'twang', x: from.x, z: from.z, loud: 1, hx: from.x, hz: from.z });
      run(h, 2, 2 + REACT_S + 2, 1 / 30, { x: from.x, z: from.z, walking: 0 });
      const q = h.pose(0, 2 + REACT_S + 2);
      expect(['run', 'alert', 'gone']).toContain(q.kind);
      expect(Math.hypot(q.x - from.x, q.z - from.z), `зерно ${seed}`).toBeGreaterThan(Math.hypot(p.x - from.x, p.z - from.z) + RUN_SPEED);
      // Дорога бегущего — мимо укрытий.
      const run0 = h.segs[0].find((g) => g.kind === 'run');
      expect(run0).toBeDefined();
      for (let s = 1; s < (run0?.dist ?? 0) && Math.hypot(run0!.x + run0!.dx! * s, run0!.z + run0!.dz! * s) < ESCAPE_R; s += 0.5)
        for (const c of h.field.cover) expect(Math.hypot(run0!.x + run0!.dx! * s - c.x, run0!.z + run0!.dz! * s - c.z)).toBeGreaterThan(coverRadius(c));
    }
    expect(tried).toBeGreaterThan(40);
  });

  it('тетива вдали — только настораживает: стоит, смотрит на звук, потом снова пасётся там же', () => {
    const h = new Hunt(5);
    run(h, 0, 2, 1 / 30);
    const p = h.pose(0, 2);
    expect(p.kind).toBe('graze');
    const from = { x: p.x + (HEAR.twang.flee + HEAR.twang.alert) / 2, z: p.z };
    h.hear({ t: 2, kind: 'twang', x: from.x, z: from.z, loud: 1, hx: from.x, hz: from.z });
    const a = h.pose(0, 3);
    expect(a.kind).toBe('alert');
    expect(Math.hypot(a.x - p.x, a.z - p.z)).toBeLessThan(1e-9);
    expect(Math.sin(a.yaw - Math.atan2(from.x - p.x, from.z - p.z))).toBeCloseTo(0, 6);
    expect(h.pose(0, 2 + ALERT_S + 0.1).kind).toBe('graze');
  });

  it('сорвавшегося поздняя весть не останавливает: бег, назначенный тетивой, не отменяет шаг', () => {
    const h = new Hunt(5);
    run(h, 0, 2, 1 / 30);
    const p = h.pose(0, 2);
    h.hear({ t: 2, kind: 'twang', x: p.x + 3, z: p.z, loud: 1, hx: p.x + 3, hz: p.z });
    // Внутри окна «вскинул голову» (`REACT_S`) приходит шаг с той дали, где он только настораживает (между долей
    // второй вести и слышимостью насторожившегося), — олень всё равно бежит.
    const far = HEAR.step.alert * 2 * 0.875;
    h.hear({ t: 2 + REACT_S / 2, kind: 'step', x: p.x - far, z: p.z, loud: 1, hx: p.x - far, hz: p.z });
    expect(h.pose(0, 2 + REACT_S / 2).kind).toBe('alert');
    expect(h.pose(0, 2 + REACT_S + 0.5).kind).toBe('run');
  });

  it('крадущийся не слышен; идущий в полный шаг рядом — слышен', () => {
    for (const walking of [SNEAK, 1]) {
      const h = new Hunt(5);
      const p = h.pose(0, 0);
      // Охотник в шести с лишним шагах (дальше `SEE_R`), но ближе слышимости шага.
      const at: Hunter = { x: p.x + (SEE_R + HEAR.step.alert) / 2, z: p.z, walking };
      run(h, 0, 3, 1 / 30, at);
      const heard = h.noises.some((n) => n.kind === 'step');
      expect(heard, `шаг ${walking}`).toBe(walking > SNEAK);
      const k = h.pose(0, 3).kind;
      if (walking > SNEAK) expect(k).not.toBe('graze');
      else expect(k).toBe('graze');
    }
  });

  it('упавший рядом срывает и непуганого; дальше — настораживает', () => {
    for (const [d, want] of [
      [HEAR.fall.flee * 0.7, 'run'],
      [(HEAR.fall.flee + HEAR.fall.alert) / 2, 'alert'],
    ] as const) {
      const h = new Hunt(5);
      run(h, 0, 2, 1 / 30);
      const p = h.pose(0, 2);
      // Точка внутри области: олень пасётся и ни разу не насторожен.
      expect(h.segs[0].length).toBe(1);
      h.hear({ t: 2, kind: 'fall', x: p.x + d, z: p.z, loud: 1, hx: p.x + 40, hz: p.z + 40 });
      expect(h.pose(0, 2 + REACT_S + 0.2).kind, `упал в ${d} м`).toBe(want);
    }
  });

  it('упавший срывает свою кучку', () => {
    let tried = 0;
    for (const seed of SEEDS.slice(0, 40)) {
      const h = new Hunt(seed);
      run(h, 0, 1, 1 / 60);
      const i = visible(h, 1);
      if (i < 0) continue;
      h.pull(1);
      run(h, 1, 1 + DRAW_S, 1 / 60);
      h.loose(1 + DRAW_S, EYE, aimedAt(h, i, 1 + DRAW_S));
      run(h, 1 + DRAW_S, 6, 1 / 60);
      if (h.arrows[0].struck !== 'deer') continue;
      tried++;
      const mate = h.field.deer.find((d) => d.group === h.field.deer[h.arrows[0].what].group && d.id !== h.arrows[0].what)!;
      expect(h.segs[mate.id].some((g) => g.kind === 'run'), `зерно ${seed}`).toBe(true);
    }
    expect(tried).toBeGreaterThan(20);
  });

  it('перебежавший опушку ушёл в лес: его не видно и в него не попасть', () => {
    let gone = 0;
    for (const seed of SEEDS.slice(0, 20)) {
      const h = new Hunt(seed);
      run(h, 0, 1, 1 / 30);
      // Дальний от середины олень; тетива — в пяти шагах от него со стороны поля: бежит наружу, к опушке.
      let i = 0;
      h.field.deer.forEach((_, k) => {
        if (Math.hypot(h.pose(k, 1).x, h.pose(k, 1).z) > Math.hypot(h.pose(i, 1).x, h.pose(i, 1).z)) i = k;
      });
      const p = h.pose(i, 1);
      const r = Math.hypot(p.x, p.z);
      const src = { x: p.x * (1 - 5 / r), z: p.z * (1 - 5 / r) };
      h.hear({ t: 1, kind: 'twang', x: src.x, z: src.z, loud: 1, hx: src.x, hz: src.z });
      const end = 1 + 30;
      run(h, 1, end, 1 / 30, { x: src.x, z: src.z, walking: 0 });
      for (let k = 0; k < DEER; k++) {
        const q = h.pose(k, end);
        if (q.kind !== 'gone') continue;
        gone++;
        expect(Math.hypot(q.x, q.z)).toBeGreaterThan(ESCAPE_R);
        expect(hitDeer(q, q.x - 1, 1, q.z, q.x + 1, 1, q.z)).toBeNull();
      }
    }
    // Точка внутри области: кто-то и правда ушёл.
    expect(gone).toBeGreaterThan(3);
  });
});

describe('охота: тот же ряд — те же олени и стрелы, с какой бы частотой ни шли кадры', () => {
  /**
   * Охотник стоит, потом идёт к ближнему оленю — по целым секундам: на 12, 9,5 и 6,9 метра от него (последний шаг
   * слышен и опущенной голове, но дальше, чем олень подпускает), потом снова стоит. Выстрелы — в целые секунды.
   */
  const SEED = 4242;
  const deer0 = layHunt(SEED).deer.reduce((a, b) => (Math.hypot(b.x - START.x, b.z - START.z) < Math.hypot(a.x - START.x, a.z - START.z) ? b : a));
  // Где олень пасся бы в секунду `s`, не услышав ничего: до первой вести он идёт по своему первому отрезку.
  const grazing = (s: number): { x: number; z: number } => poseAt(deer0, [{ kind: 'graze', t0: 0, x: deer0.x, z: deer0.z, yaw: deer0.yaw }], s);
  const toward = (gap: number, s: number): { x: number; z: number } => {
    const at = grazing(s);
    const d = Math.hypot(at.x - START.x, at.z - START.z);
    const k = (d - gap) / d;
    return { x: START.x + (at.x - START.x) * k, z: START.z + (at.z - START.z) * k };
  };
  const hunterAt = (t: number): Hunter => {
    const s = Math.floor(t + 1e-9);
    if (s < 3) return STILL;
    if (s < 6) return { ...toward([12, 9.5, 6.9][s - 3], s), walking: 1 };
    return { ...toward(6.9, 5), walking: 0 };
  };

  function play(dt: number): Hunt {
    const h = new Hunt(SEED);
    // Выстрелы — после подхода: шаги слышит непуганое стадо.
    const shots = [7, 9, 11];
    let t = 0;
    for (;;) {
      const next = Math.min(GAME_SECONDS.hunt, Math.round((t + dt) / dt) * dt);
      // Кадр не перескакивает через выстрел: в целую секунду кадр есть при любой частоте из набора.
      const cut = shots.find((s) => s > t + 1e-9 && s < next - 1e-9);
      const to = cut ?? next;
      h.advance(to, hunterAt(to));
      for (const s of shots) {
        if (Math.abs(s - to) < 1e-9) {
          h.pull(s - DRAW_S);
          const eye = { x: hunterAt(s).x, y: EYE_Y, z: hunterAt(s).z };
          // Ближний стоящий олень — стоящий не уйдёт из-под стрелы, пока она летит.
          let i = -1;
          h.field.deer.forEach((_, k) => {
            const p = h.pose(k, s);
            if (p.kind !== 'graze' && p.kind !== 'alert') return;
            if (i < 0 || Math.hypot(p.x - eye.x, p.z - eye.z) < Math.hypot(h.pose(i, s).x - eye.x, h.pose(i, s).z - eye.z)) i = k;
          });
          h.loose(s, eye, i >= 0 ? aimedAt(h, i, s, eye) : { x: 0, y: 0.1, z: -1 });
        }
      }
      t = to;
      if (t >= 20 - 1e-9) break;
    }
    return h;
  }

  it('кадр 1/60, 1/30, 1/45 и 1/144 — одни и те же попадания и места оленей', () => {
    const base = play(1 / 60);
    // Внутри области: в ряду есть попадание, бег и услышанный шаг, от которого олень насторожился, — иначе
    // сравнивать нечего.
    expect(base.arrows.some((a) => a.struck === 'deer')).toBe(true);
    expect(base.segs.some((s) => s.some((g) => g.kind === 'run'))).toBe(true);
    const steps = base.noises.filter((n) => n.kind === 'step').map((n) => n.t);
    expect(steps.length).toBeGreaterThan(0);
    expect(base.segs.some((s) => s.some((g) => g.kind !== 'graze' && steps.some((t) => Math.abs(g.t0 - t) < 1e-9)))).toBe(true);
    // 1/45 — нечётная частота: тик слуха (`TICK`) и шаг (полсекунды) у неё падают между кадрами.
    for (const dt of [1 / 30, 1 / 45, 1 / 144]) {
      const other = play(dt);
      expect(other.arrows.map((a) => [a.struck, a.what, a.end?.toFixed(6)])).toEqual(base.arrows.map((a) => [a.struck, a.what, a.end?.toFixed(6)]));
      // Отрезки жизни каждого оленя — те же и с тех же секунд: весть, услышанная на кадр позже, сдвинула бы их.
      const rows = (h: Hunt): string[][] => h.segs.map((ss) => ss.map((g) => `${g.kind} ${g.t0.toFixed(6)} ${g.x.toFixed(6)} ${g.z.toFixed(6)}`));
      expect(rows(other), `кадр 1/${Math.round(1 / dt)}`).toEqual(rows(base));
      for (let i = 0; i < DEER; i++) {
        const a = base.pose(i, 20);
        const b = other.pose(i, 20);
        expect(b.kind).toBe(a.kind);
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.z).toBeCloseTo(a.z, 6);
      }
    }
  });

  it('шаг слуха — тик, а не кадр', () => {
    expect(1 / TICK).toBe(Math.round(1 / TICK));
  });
});

describe('охота: форма попадания — по модели', () => {
  it('корпус оленя — эллипсоид по туловищу модели предыстории; ось головы — там, где голова', () => {
    const g = deerModel();
    const torso = g.getObjectByName('torso') as THREE.Mesh;
    torso.geometry.computeBoundingBox();
    const box = torso.geometry.boundingBox!;
    const c = box.getCenter(new THREE.Vector3());
    const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    expect(Math.abs(c.y - DEER_BODY.y)).toBeLessThan(0.05);
    expect(Math.abs(c.z - DEER_BODY.z)).toBeLessThan(0.05);
    // Эллипсоид чуть шире рамки — иначе углы брусов были бы «мимо».
    for (const [r, h] of [
      [DEER_BODY.rx, half.x],
      [DEER_BODY.ry, half.y],
      [DEER_BODY.rz, half.z],
    ]) {
      expect(r).toBeGreaterThanOrEqual(h);
      expect(r).toBeLessThanOrEqual(h * 1.3);
    }
    const head = g.getObjectByName('head')!;
    expect(head.position.y).toBeCloseTo(DEER_NECK.y, 6);
    expect(head.position.z).toBeCloseTo(DEER_NECK.z, 6);
  });

  it('туша — эллипсоид по рамке туши: лежит на земле, по длине — от крупа до шеи', () => {
    const m = carcassModel();
    m.geometry.computeBoundingBox();
    const box = m.geometry.boundingBox!;
    // Рамка туши — с рогами, ногами и головой; корпус — нижняя её часть, от крупа (минимум по z) до шеи.
    expect(CARCASS.y - CARCASS.ry).toBeLessThan(box.min.y + 0.05);
    expect(CARCASS.y + CARCASS.ry).toBeLessThan(box.max.y);
    expect(Math.abs(CARCASS.z - CARCASS.rz - box.min.z)).toBeLessThan(0.1);
    expect(CARCASS.z + CARCASS.rz).toBeLessThan(box.max.z);
  });

  it('хвоя, кора и листва нарисованы там, где в них втыкается стрела', () => {
    const f = layHunt(77);
    for (const kind of ['spruce', 'birch', 'bush'] as const) {
      const c = f.cover.find((k) => k.kind === kind)!;
      const m = coverMesh([c], 'summer', new Shade());
      const pos = m.geometry.attributes.position;
      // Середина укрытия по высоте: ель — хвоя, берёза — нижняя шапка кроны, куст — сам куст.
      const mid = (kind === 'spruce' ? 1.6 : kind === 'birch' ? BIRCH.crowns[0].y : BUSH.y) * c.s;
      let inside = 0;
      for (let i = 0; i < pos.count; i++) {
        // Точка чуть внутрь — к оси и к середине укрытия: вершины лежат на самой поверхности.
        const x = c.x + (pos.getX(i) - c.x) * 0.9;
        const z = c.z + (pos.getZ(i) - c.z) * 0.9;
        const y = pos.getY(i) + (mid - pos.getY(i)) * 0.03;
        if (inCover(c, x, y, z)) inside++;
      }
      expect(inside / pos.count, kind).toBeGreaterThan(0.85);
    }
  });
});
