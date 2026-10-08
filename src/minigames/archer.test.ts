// Лучник у глаза (docs/minigames.md, раздел 16): руки идут за правилом и жестом, дрожь — только от долгой натяжки,
// новая стрела ложится на тетиву не раньше, чем правило даёт её тянуть.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { viewFov } from '@/prologue/glade';
import { ARROW_LEN, Archer, BOW_AIM, HOLD_CALM, HOLD_RAMP, PULL, RELOAD, SWAY, tremorOf, type ArcherInput } from './archer';
import { NOCK_S } from './hunt';

const FRAME = 1 / 60;

/** Входы рига на кадр; по умолчанию — стоит, лук опущен, стрел полный колчан. */
function input(now: number, over: Partial<ArcherInput> = {}): ArcherInput {
  return { now, dt: FRAME, pulling: false, drawn: 0, quiver: 8, sinceLoose: null, nockS: NOCK_S, walking: 0, turn: { yaw: 0, pitch: 0 }, ...over };
}

/** Прогнать риг `secs` секунд с одним и тем же входом (часы идут). */
function run(a: Archer, from: number, secs: number, over: (now: number) => Partial<ArcherInput>): number {
  let now = from;
  for (let k = 0; k < Math.round(secs / FRAME); k++) {
    now += FRAME;
    a.update(input(now, over(now)));
  }
  return now;
}

/** Камера игры на телефоне 390×844 — без приближения: риг сжат под угол без лука (`huntPlay.syncBow`). */
function phoneCamera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(viewFov(390 / 844), 390 / 844, 0.05, 150);
  c.updateMatrixWorld();
  return c;
}

const ndc = (p: THREE.Vector3, cam: THREE.Camera): THREE.Vector3 => p.clone().project(cam);

describe('правая на тетиве', () => {
  it('тянут — кисть там же, где хвост стрелы, и он уходит к стрелку ровно на натяжку', () => {
    const a = new Archer();
    let now = run(a, 0, 1, () => ({ pulling: true, drawn: 0 }));
    const grip = a.nock.clone();
    for (const drawn of [0.25, 0.5, 1]) {
      now = run(a, now, 0.5, () => ({ pulling: true, drawn }));
      expect(a.hand.distanceTo(a.nock), `натяжка ${drawn}`).toBeLessThan(1e-3);
      expect(a.state.hand).toBe('string');
      expect(a.state.arrow).toBe('nocked');
      expect(a.nock.distanceTo(grip), `натяжка ${drawn}`).toBeCloseTo(PULL * drawn, 2);
    }
  });

  it('не тянут — правая отпускает тетиву и опускается, стрела остаётся на тетиве', () => {
    const a = new Archer();
    run(a, 0, 2, () => ({}));
    expect(a.state.hand).toBe('low');
    expect(a.state.arrow).toBe('nocked');
    expect(a.hand.distanceTo(a.nock)).toBeGreaterThan(0.1);
  });

  it('натянутый лук: обе руки в кадре телефона, верхнее плечо — слева от прицела', () => {
    const a = new Archer();
    run(a, 0, 1.5, () => ({ pulling: true, drawn: 1 }));
    const cam = phoneCamera();
    a.root.updateMatrixWorld(true);
    const left = ndc(a.root.getObjectByName('bowHand')!.position, cam);
    const right = ndc(a.hand, cam);
    expect(Math.abs(left.x)).toBeLessThan(1);
    expect(Math.abs(left.y)).toBeLessThan(1);
    // Правая у края — из кадра видна кисть, предплечье уходит за край.
    expect(right.x).toBeGreaterThan(0.3);
    expect(right.x).toBeLessThan(1.05);
    expect(right.y).toBeGreaterThan(-1.05);
    // Остриё — у прицела слева снизу, не на нём: цель справа открыта.
    const bow = a.root.getObjectByName('bow')!;
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(bow.quaternion);
    const tip = ndc(a.nock.clone().addScaledVector(back, -ARROW_LEN), cam);
    expect(tip.x).toBeLessThan(0);
    expect(Math.hypot(tip.x, tip.y)).toBeLessThan(0.45);
    const top = ndc(bow.position.clone().add(new THREE.Vector3(0, 0.3, 0).applyQuaternion(bow.quaternion)), cam);
    expect(top.x, 'верхнее плечо завалено влево').toBeLessThan(0);
    expect(BOW_AIM.cant).toBeGreaterThan(0);
  });
});

describe('выстрел и новая стрела', () => {
  /** Натянуть, выстрелить и вести наложение по часам правила; что делала правая в каждый кадр. */
  function shot(quiverAfter: number): { at: number; hand: string; arrow: string; out: boolean }[] {
    const a = new Archer();
    let now = run(a, 0, 1.5, () => ({ pulling: true, drawn: 1 }));
    const cam = phoneCamera();
    const t0 = now;
    const seen: { at: number; hand: string; arrow: string; out: boolean }[] = [];
    while (now - t0 < NOCK_S + 0.3) {
      now += FRAME;
      a.update(input(now, { sinceLoose: now - t0, quiver: quiverAfter }));
      const p = ndc(a.hand, cam);
      seen.push({ at: now - t0, hand: a.state.hand, arrow: a.state.arrow, out: Math.abs(p.x) > 1 || Math.abs(p.y) > 1 });
    }
    return seen;
  }

  it('проводка, колчан, стрела в руке, тетива — по порядку и в срок наложения', () => {
    const seen = shot(7);
    // Порядок — в окне наложения (после него не тянущий палец отпускает тетиву, и правая опускается).
    const order = seen
      .filter((s) => s.at <= NOCK_S + FRAME)
      .map((s) => s.hand)
      .filter((h, i, all) => h !== all[i - 1]);
    expect(order).toEqual(['follow', 'quiver', 'return', 'string']);
    // У колчана рука — за краем кадра: стрелу берут у бедра.
    // Последний кадр у колчана — не проводка, а сама рука у бедра: она за краем.
    const atQuiver = seen.filter((s) => s.hand === 'quiver');
    expect(atQuiver.length).toBeGreaterThan(0);
    expect(atQuiver[atQuiver.length - 1].out).toBe(true);
    // Новая стрела — на тетиве не раньше доли `back` наложения и не позже самого наложения правила.
    const nocked = seen.find((s, i) => i > 0 && s.arrow === 'nocked')!;
    expect(nocked.at).toBeGreaterThanOrEqual(RELOAD.back * NOCK_S - FRAME);
    expect(nocked.at).toBeLessThanOrEqual(NOCK_S);
    // Пока правая у колчана и в проводке — стрелы на тетиве нет: та улетела.
    expect(seen.filter((s) => s.hand === 'follow' || s.hand === 'quiver').every((s) => s.arrow === 'none')).toBe(true);
    expect(seen.filter((s) => s.hand === 'return').every((s) => s.arrow === 'held')).toBe(true);
  });

  it('последняя стрела ушла — правая не возвращается со стрелой, тетива пуста', () => {
    const seen = shot(0);
    expect(seen.some((s) => s.hand === 'return')).toBe(false);
    expect(seen.every((s) => s.arrow === 'none')).toBe(true);
  });

  it('отдача толкает взгляд вверх и гаснет за полсекунды', () => {
    const a = new Archer();
    let now = run(a, 0, 1, () => ({ pulling: true, drawn: 1 }));
    const t0 = now;
    let peak = 0;
    now = run(a, now, 0.15, (n) => ({ sinceLoose: n - t0 }));
    peak = Math.max(peak, a.sway.pitch);
    expect(peak).toBeGreaterThan(0);
    run(a, now, 0.5, (n) => ({ sinceLoose: n - t0 }));
    expect(Math.abs(a.sway.pitch)).toBeLessThan(peak * 0.05);
  });
});

describe('дрожь', () => {
  it('до `HOLD_CALM` секунд в полной натяжке рука твёрдая; дальше прицел гуляет, но не шире `SWAY`', () => {
    const a = new Archer();
    // Точки окна «твёрдо» — внутри него: держим полную натяжку меньше `HOLD_CALM`.
    const calm = HOLD_CALM - 0.3;
    expect(calm).toBeGreaterThan(0);
    let now = run(a, 0, 0.6, () => ({ pulling: true, drawn: 1 }));
    let worst = 0;
    for (let k = 0; k < Math.round((calm - 0.6) / FRAME); k++) {
      now += FRAME;
      a.update(input(now, { pulling: true, drawn: 1 }));
      worst = Math.max(worst, Math.abs(a.sway.yaw), Math.abs(a.sway.pitch));
    }
    expect(worst).toBe(0);
    // Полная дрожь: за `HOLD_CALM + HOLD_RAMP` — прицел ходит, но в пределах.
    let wide = 0;
    for (let k = 0; k < Math.round((HOLD_RAMP + 1) / FRAME); k++) {
      now += FRAME;
      a.update(input(now, { pulling: true, drawn: 1 }));
      wide = Math.max(wide, Math.abs(a.sway.yaw));
    }
    expect(a.state.tremor).toBe(1);
    expect(wide).toBeGreaterThan(SWAY * 0.3);
    expect(wide).toBeLessThanOrEqual(SWAY);
  });

  it('ослабил тетиву — дрожь прошла сразу', () => {
    const a = new Archer();
    let now = run(a, 0, HOLD_CALM + HOLD_RAMP + 1, () => ({ pulling: true, drawn: 1 }));
    expect(a.state.tremor).toBe(1);
    now = run(a, now, FRAME, () => ({ pulling: true, drawn: 0.6 }));
    expect(a.state.tremor).toBe(0);
    expect(tremorOf(HOLD_CALM)).toBe(0);
    expect(tremorOf(HOLD_CALM + HOLD_RAMP)).toBe(1);
  });
});
