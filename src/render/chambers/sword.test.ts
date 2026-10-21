// Бой мечом в покоях (docs/city_v3.md, Г-11): палец — удар или взгляд, двойное касание — блок в сторону экрана,
// выносливость, комбо, клинок по линии взмаха и встреча с чучелом и камнем.
import { describe, expect, it } from 'vitest';
import {
  BLADE_TO,
  BLOCK_HOLD,
  BLOCK_IN,
  COMBO_GAP,
  COST,
  DOUBLE_MS,
  DUMMY,
  DoubleTap,
  Fight,
  PHONE_VIEW,
  REST_AFTER,
  STANCE_T,
  SWIPE_DECIDE_MS,
  SwipeJudge,
  TIRED,
  contact,
  midOf,
  sideOf,
  surfaceAt,
  swingBlade,
  toRoom,
  type Eye,
  type FightEvent,
  type Side,
} from './sword';
import { free } from './walk';

const W = 390;
const H = 844;

/** Ведение пальцем от точки к точке за `ms`, шагами по 8 мс; всё, что сказал судья. */
function drag(j: SwipeJudge, id: number, x0: number, y0: number, x1: number, y1: number, ms: number, t0 = 0) {
  j.down(id, x0, y0, t0);
  const out = [];
  const n = Math.max(1, Math.round(ms / 8));
  for (let i = 1; i <= n; i++) {
    const v = j.move(id, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, t0 + (ms * i) / n);
    if (v) out.push(v);
  }
  return { out, up: j.up(id, t0 + ms + 4) };
}

/** Бой в стойке (меч уже повернулся в руке). */
function ready(): Fight {
  const f = new Fight();
  f.step(STANCE_T + 0.01);
  return f;
}

/** Довести удар до стойки: шаги по 1/60 с без комнаты. */
function settle(f: Fight, s = 1): void {
  for (let i = 0; i < s * 60; i++) f.step(1 / 60);
}

describe('бой мечом: палец', () => {
  it('быстрый взмах — удар по направлению взмаха; голова за ним не поворачивается', () => {
    const j = new SwipeJudge();
    const { out } = drag(j, 1, 330, 420, 150, 440, 70);
    const slash = out.find((v) => v.kind === 'slash');
    expect(slash, 'взмах 180 px за 70 мс — удар').toBeTruthy();
    expect(out.some((v) => v.kind === 'look'), 'ни пикселя взгляду').toBe(false);
    if (slash?.kind !== 'slash') return;
    expect(slash.to[0] - slash.from[0], 'справа налево').toBeLessThan(0);
    expect(slash.speed).toBeGreaterThan(1.5);
  });

  it('медленное ведение — взгляд, и он отдаётся целиком, когда палец решил', () => {
    const j = new SwipeJudge();
    const { out } = drag(j, 1, 300, 400, 200, 400, 600);
    expect(out.some((v) => v.kind === 'slash'), 'медленно — не удар').toBe(false);
    const dx = out.reduce((a, v) => a + (v.kind === 'look' ? v.dx : 0), 0);
    expect(dx, 'весь путь — взгляду').toBeCloseTo(-100, 5);
    // До решения голова стоит.
    const j2 = new SwipeJudge();
    j2.down(2, 300, 400, 0);
    expect(j2.move(2, 296, 400, SWIPE_DECIDE_MS - 10)).toBeNull();
  });

  it('короткое касание — касание, не удар и не взгляд', () => {
    const j = new SwipeJudge();
    j.down(1, 300, 400, 0);
    j.move(1, 303, 401, 40);
    const r = j.up(1, 90);
    expect(r.tap).toBe(true);
    expect(r.verdict).toBeNull();
  });

  it('двойное касание у стороны экрана — блок в эту сторону; по диагоналям из середины', () => {
    const at: Record<Side, [number, number]> = { left: [30, 430], right: [360, 400], up: [200, 120], down: [190, 760] };
    for (const side of Object.keys(at) as Side[]) {
      const d = new DoubleTap();
      const [x, y] = at[side];
      expect(sideOf(x, y, W, H), side).toBe(side);
      expect(d.tap(x, y, 1000, W, H), 'одно касание — не блок').toBeNull();
      expect(d.tap(x + 6, y - 4, 1000 + 200, W, H), `${side}: второе рядом и вскоре`).toBe(side);
    }
    const slow = new DoubleTap();
    slow.tap(30, 430, 0, W, H);
    expect(slow.tap(30, 430, DOUBLE_MS + 50, W, H), 'второе поздно — не блок').toBeNull();
    const apart = new DoubleTap();
    apart.tap(30, 430, 0, W, H);
    expect(apart.tap(360, 400, 150, W, H), 'в разных местах — не блок').toBeNull();
  });
});

describe('бой мечом: удар, блок, выносливость, комбо', () => {
  it('клинок идёт по линии взмаха: острие на экране — от начала к концу', () => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.7, 0.7],
    ] as const) {
      const spec = { dir: [dx, dy] as [number, number], mid: [0, 0] as [number, number], power: 0.5, heavy: false, weak: false, side: 'right' as const };
      const tipAt = (phi: number): [number, number] => {
        const b = swingBlade(spec, phi, PHONE_VIEW);
        const p = [b.hand[0] + b.axis[0] * BLADE_TO, b.hand[1] + b.axis[1] * BLADE_TO, b.hand[2] + b.axis[2] * BLADE_TO];
        // На экран: x вправо, y вниз (перспектива).
        return [p[0] / -p[2], -p[1] / -p[2]];
      };
      const a = tipAt(-0.5);
      const b = tipAt(0.5);
      const move = (b[0] - a[0]) * dx + (b[1] - a[1]) * dy;
      expect(move, `острие по взмаху (${dx}, ${dy})`).toBeGreaterThan(0.3);
      // Посреди дуги — прямо перед глазом, впереди.
      const m = swingBlade(spec, 0, PHONE_VIEW);
      expect(m.axis[2], 'посреди дуги клинок смотрит вперёд').toBeLessThan(-0.5);
      // И виден во всю длину: от кулака до острия на экране — не меньше трети высоты кадра (не остриём в глаз).
      const tip = [m.hand[0] + m.axis[0] * BLADE_TO, m.hand[1] + m.axis[1] * BLADE_TO, m.hand[2] + m.axis[2] * BLADE_TO];
      const span = Math.hypot(tip[0] / -tip[2] - m.hand[0] / -m.hand[2], tip[1] / -tip[2] - m.hand[1] / -m.hand[2]);
      expect(span / PHONE_VIEW.tanV, 'клинок во всю длину').toBeGreaterThan(0.66);
      expect(Math.abs(m.axis[0] * m.edge[0] + m.axis[1] * m.edge[1] + m.axis[2] * m.edge[2]), 'кромка поперёк клинка').toBeLessThan(1e-9);
    }
  });

  it('удар — по направлению: класс по преобладающей оси', () => {
    const f = ready();
    expect(f.strike(-200, 10, [0, 0], 2)?.side).toBe('left');
    settle(f);
    expect(f.strike(0, 180, [0, 0], 2)?.side).toBe('down');
  });

  it('частые удары утомляют: выносливость падает, ниже цены — удар слабый; отдых — возвращает', () => {
    const f = ready();
    let weak = false;
    for (let i = 0; i < 12; i++) {
      const s = f.strike(i % 2 ? 200 : -200, 0, [0, 0], 3);
      settle(f, 0.62);
      if (s?.weak) weak = true;
    }
    expect(f.stamina, 'выдохся').toBeLessThan(TIRED);
    expect(weak, 'на пустой выносливости удар слабый').toBe(true);
    f.strike(200, 0, [0, 0], 3);
    const low = f.stamina;
    settle(f, REST_AFTER * 0.8);
    expect(f.stamina, 'сразу после — не восстанавливается').toBeCloseTo(low, 5);
    settle(f, 3);
    expect(f.stamina, 'отдохнул').toBeGreaterThan(low + 0.5);
    expect(f.take().some((e) => e.kind === 'tired'), 'событие «устал» — звуку').toBe(true);
  });

  it('три удара разными направлениями подряд — третий сильный; одним направлением — нет; пауза рвёт комбо', () => {
    const f = ready();
    expect(f.strike(200, 0, [0, 0], 2)?.heavy).toBe(false);
    settle(f, 0.62);
    expect(f.strike(-200, 0, [0, 0], 2)?.heavy).toBe(false);
    settle(f, 0.62);
    expect(f.strike(0, 200, [0, 0], 2)?.heavy, 'вправо, влево, вниз').toBe(true);
    settle(f, 2);
    const g = ready();
    for (let i = 0; i < 3; i++) {
      expect(g.strike(200, 0, [0, 0], 2)?.heavy, 'одним направлением').toBe(false);
      settle(g, 0.62);
    }
    const p = ready();
    p.strike(200, 0, [0, 0], 2);
    settle(p, 0.62);
    p.strike(-200, 0, [0, 0], 2);
    settle(p, COMBO_GAP + 0.3);
    expect(p.strike(0, 200, [0, 0], 2)?.heavy, 'после паузы — не комбо').toBe(false);
    expect(COST).toBeGreaterThan(0);
  });

  it('блок: поза в свою сторону, держится и возвращается в стойку; посреди дуги удара — нет', () => {
    for (const side of ['left', 'right', 'up', 'down'] as Side[]) {
      const f = ready();
      expect(f.block(side)).toBe(true);
      for (let t = 0; t < BLOCK_IN + BLOCK_HOLD / 2; t += 1 / 60) f.step(1 / 60);
      const b = f.blade();
      if (side === 'left') expect(b.hand[0], 'кулак слева').toBeLessThan(0);
      if (side === 'right') expect(b.hand[0], 'кулак справа').toBeGreaterThan(0.1);
      if (side === 'left' || side === 'right') expect(b.axis[1], 'клинок стоймя').toBeGreaterThan(0.9);
      if (side === 'up') expect(Math.abs(b.axis[0]), 'клинок поперёк').toBeGreaterThan(0.9);
      if (side === 'up') expect(b.hand[1], 'над глазами').toBeGreaterThan(0);
      if (side === 'down') expect(b.axis[1], 'клинок к полу').toBeLessThan(-0.7);
      settle(f, 1);
      expect(f.state.kind).toBe('guard');
    }
    const f = ready();
    f.strike(200, 0, [0, 0], 2);
    settle(f, 0.12);
    expect(f.block('left'), 'меч уже летит').toBe(false);
  });
});

describe('бой мечом: обо что бьётся клинок', () => {
  /** Стоит перед чучелом лицом к нему, на шаг. */
  const front: Eye = { x: DUMMY.x - 0.9, y: 1.62, z: DUMMY.z, yaw: Math.PI / 2, pitch: -0.05 };

  /** Удар целиком с комнатой: события. */
  function swing(eye: Eye, dx: number, dy: number, mid: [number, number]): { f: Fight; ev: FightEvent[] } {
    const f = ready();
    f.strike(dx, dy, mid, 2.5);
    const ev: FightEvent[] = [];
    for (let i = 0; i < 60; i++) {
      f.advance(1 / 60, eye);
      ev.push(...f.take());
    }
    return { f, ev };
  }

  it('чучело — солома, его столб — дерево, стена — камень, пол — доски, посреди покоев — воздух', () => {
    expect(surfaceAt([DUMMY.x + 0.1, 1.2, DUMMY.z])).toBe('straw');
    expect(surfaceAt([DUMMY.x, DUMMY.top - 0.01, DUMMY.z]), 'столб над головой').toBe('wood');
    expect(surfaceAt([5.3, 1.5, 0])).toBe('stone');
    expect(surfaceAt([0, -0.01, 0])).toBe('wood');
    expect(surfaceAt([0.5, 1.4, -0.5])).toBeNull();
    // Чучело — на полу, не в мебели: место перед ним свободно для тела.
    expect(free(front.x, front.z), 'перед чучелом можно встать').toBe(true);
  });

  it('удар по чучелу — попадание соломой, счёт растёт, клинок проходит медленнее, а не отскакивает', () => {
    for (const [dx, dy, mid] of [
      [-200, 0, [0, -0.15]],
      [200, 0, [0, -0.15]],
      [0, 200, [0, -0.1]],
      [150, 150, [0, -0.15]],
    ] as const) {
      const { f, ev } = swing(front, dx, dy, mid as [number, number]);
      const hit = ev.find((e) => e.kind === 'hit');
      expect(hit && hit.kind === 'hit' && hit.surface, `(${dx}, ${dy}): по соломе`).toBe('straw');
      expect(f.hits, 'одно попадание за удар').toBe(1);
    }
  });

  it('по линии взмаха и по высоте: взмах ниже середины экрана рубит тело чучела, высоко — голову', () => {
    for (const back of [0.9, 1.07]) {
      const low = swing({ ...front, x: DUMMY.x - back }, -220, 0, [0, -0.2]).ev.find((e) => e.kind === 'hit');
      expect(low?.kind === 'hit' && low.at[1], `низкий взмах с ${back} м — по телу`).toBeLessThan(DUMMY.y1);
    }
    const high = swing(front, -220, 0, [0, 0.55]).ev.find((e) => e.kind === 'hit');
    expect(high?.kind === 'hit' && high.at[1], 'высокий взмах — по голове').toBeGreaterThan(DUMMY.y1);
  });

  it('удар в стену — камень и отскок; в воздух — ничего', () => {
    const wall: Eye = { x: 4.4, y: 1.62, z: 1.0, yaw: Math.PI / 2, pitch: 0 };
    expect(toRoom(wall, [0, 0, -1])[0], 'смотрит на восток').toBeCloseTo(5.4, 5);
    const { f, ev } = swing(wall, -200, 0, [0, 0]);
    const hit = ev.find((e) => e.kind === 'hit');
    expect(hit && hit.kind === 'hit' && hit.surface).toBe('stone');
    expect(f.hits, 'в стену — не попадание по чучелу').toBe(0);
    const mid: Eye = { x: 0, y: 1.62, z: -0.3, yaw: 0, pitch: 0 };
    expect(swing(mid, -200, 0, [0, 0]).ev.some((e) => e.kind === 'hit'), 'посреди покоев — воздух').toBe(false);
    // Стойка у стены поднимает меч: в камень не воткнут.
    const g = ready();
    for (let i = 0; i < 30; i++) g.advance(1 / 60, wall);
    expect(contact(wall, g.blade()), 'у стены клинок стойки — не в камне').toBeNull();
  });

  it('середина взмаха на экране — доли от середины, вверх — плюс', () => {
    expect(midOf([0, 0], [W, H], W, H)).toEqual([0, -0]);
    expect(midOf([0, 0], [0, 0], W, H)).toEqual([-1, 1]);
  });
});
