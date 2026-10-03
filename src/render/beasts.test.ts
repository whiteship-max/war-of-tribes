// Волк ролика из деталей фигур (docs/graphics_world.md, 11.4): скелет четвероногого, только семь примитивов пула;
// позы — в пределах, припав и падение опускают корпус; волк — в цвете стороны. Собака у костра ушла с посёлком
// (docs/city.md, «Город — единственный вид»): её проверки сняты, у волка остались те же.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CANINE_NECK, WOLF_DARK, WOLF_SIZE, darker, dressCanine, poseCanine, wolfLook, type CanineAction } from './beasts';
import { Figure, PARTS, figureBox } from './figures';
import { sidePaint } from '@/side';

const ACTIONS: CanineAction[] = ['stand', 'trot', 'crouch', 'lunge', 'fall'];
const WOLF = wolfLook(sidePaint(false));

describe('псовые', () => {
  it('волк — четвероногий из примитивов пула, хвост поленом', () => {
    const wolf = new Figure();
    dressCanine(wolf, WOLF);
    expect(wolf.rig.mount, 'скелет четвероногого').not.toBeNull();
    for (const s of wolf.slots) expect(PARTS).toContain(s.part);
    // Четыре ноги в два звена и хвост — на своих суставах.
    for (const j of ['legFL', 'legFR', 'legBL', 'legBR', 'hockFL', 'hockFR', 'hockBL', 'hockBR', 'tail', 'neck'] as const) {
      expect(wolf.slots.some((s) => s.joint === j), j).toBe(true);
    }
    const size = (f: Figure): THREE.Vector3 => figureBox(f).getSize(new THREE.Vector3());
    // Хвост поленом — волчья стать: толще, чем был бы у того же зверя без неё.
    const plain = new Figure();
    dressCanine(plain, { ...WOLF, bushy: false });
    const tail = (f: Figure): THREE.Vector3 => new THREE.Vector3().setFromMatrixScale(f.slots.find((s) => s.joint === 'tail')!.local);
    expect(tail(wolf).x, 'хвост поленом').toBeGreaterThan(tail(plain).x * 1.5);
    // Спереди волк не палочка: ролик смотрит на стаю в лоб, и ширина в плечах (грива) — не меньше трети высоты.
    for (const a of ['stand', 'crouch', 'lunge', 'trot'] as const) {
      poseCanine(wolf, a, 1.3);
      const s = size(wolf);
      expect(s.x / s.y, `${a}: ширина спереди`).toBeGreaterThanOrEqual(1 / 3);
    }
  });

  it('бросок — низом: волк не встаёт на дыбы, как конь, а тянет голову вперёд', () => {
    const f = new Figure();
    dressCanine(f, WOLF);
    let lunged = 0;
    for (let t = 0; t < 3; t += 0.05) {
      poseCanine(f, 'lunge', t);
      // Граница области: бросок идёт — перед поднимается хоть сколько-то.
      if (f.pitch < -0.05) lunged++;
      expect(f.pitch, 'перед поднят не выше 0.2 рад').toBeGreaterThanOrEqual(-0.2);
      expect(f.rig.mount!.neckPitch, 'голова вперёд').toBeGreaterThan(CANINE_NECK + 0.4);
    }
    expect(lunged).toBeGreaterThan(5);
  });

  it('волк ролика — весь в цвете своей стороны: шерсть — цвет стороны, тёмное — он же темнее', () => {
    const sides = [sidePaint(true), sidePaint(false)];
    for (const cloth of sides) {
      const f = new Figure();
      dressCanine(f, wolfLook(cloth));
      const tones = new Set(f.slots.map((s) => s.color.getHex()));
      expect([...tones].sort(), `сторона ${cloth.toString(16)}`).toEqual([cloth, darker(cloth, WOLF_DARK)].sort());
      // Тёмный тон — тот же цвет: каналы в той же пропорции и темнее.
      const dark = darker(cloth, WOLF_DARK);
      for (const shift of [16, 8, 0]) {
        const c = (cloth >> shift) & 255;
        expect((dark >> shift) & 255, `канал ${shift}`).toBe(Math.round(c * WOLF_DARK));
      }
    }
    expect(darker(sidePaint(true), WOLF_DARK)).not.toBe(darker(sidePaint(false), WOLF_DARK));
  });

  it('стоит на земле: лапы у нуля, голова выше спины спереди', () => {
    const f = new Figure();
    dressCanine(f, WOLF);
    poseCanine(f, 'stand', 0);
    const box = figureBox(f);
    expect(Math.abs(box.min.y), 'лапы у земли').toBeLessThan(WOLF_SIZE * 0.12);
    expect(box.max.z, 'голова спереди').toBeGreaterThan(WOLF_SIZE * 0.5);
  });

  it('позы в пределах; припав и падение опускают корпус, падение кладёт набок', () => {
    const f = new Figure();
    dressCanine(f, WOLF);
    for (const a of ACTIONS) {
      for (let t = 0; t < 6; t += 0.37) {
        const drop = poseCanine(f, a, t, 1);
        for (const k of ['gait', 'pitch', 'roll'] as const) expect(Math.abs(f[k]), `${a}: ${k}`).toBeLessThanOrEqual(Math.PI);
        expect(drop, `${a}: опускание`).toBeGreaterThanOrEqual(0);
      }
    }
    expect(poseCanine(f, 'stand', 1)).toBe(0);
    // Припал перед броском: корпус ниже, голова вперёд и вниз, хвост не ходит.
    expect(poseCanine(f, 'crouch', 1)).toBeGreaterThan(0);
    expect(f.rig.mount!.neckPitch).toBeGreaterThan(CANINE_NECK + 0.4);
    const tail = f.phase;
    poseCanine(f, 'crouch', 3);
    expect(f.phase, 'хвост не ходит').toBe(tail);
    poseCanine(f, 'fall', 1, 1);
    expect(f.roll).toBeCloseTo(Math.PI / 2, 6);
    poseCanine(f, 'fall', 1, 0);
    expect(f.roll).toBe(0);
  });

  it('хвост ходит: у стоящего фаза хвоста меняется со временем, своя у каждого зверя', () => {
    const a = new Figure();
    const b = new Figure();
    dressCanine(a, WOLF);
    dressCanine(b, WOLF);
    poseCanine(a, 'stand', 1);
    const p1 = a.phase;
    poseCanine(a, 'stand', 2);
    expect(a.phase).not.toBe(p1);
    poseCanine(b, 'stand', 2);
    expect(b.phase).not.toBe(a.phase);
  });
});
