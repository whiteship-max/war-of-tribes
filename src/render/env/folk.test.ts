// Люди и звери посёлка вида `next` (docs/graphics_world.md, 11.3): покрои и позы у огня, собака у
// костра, куры у огородов, на низком меньше; всё — фигуры общего пула, примитивов прежние семь.
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Figure, FigurePool, PARTS } from '../figures';
import { poseFigure } from '../poses';
import { FOLK_KINDS, dressVillager } from '../units';
import { VillagerAgent } from '../villagers';
import { FOLK_KINDS_NEXT, HENS, dressFolk, folkIdle, startLife } from './folk';
import { SeasonVisuals } from '../season';
import { buildEnv } from './index';
import { gardenSpots } from './rules';

// Сборка окружения пишет карты земли в `ImageData`, которого в node нет: заглушка, как в `build.test.ts`.
beforeAll(() => {
  const g = globalThis as { ImageData?: unknown };
  if (!g.ImageData) {
    g.ImageData = class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    };
  }
});

const slotsOf = (f: Figure): string[] => f.slots.map((s) => `${s.part}@${s.joint}`);

describe('люди у костра вида next', () => {
  it('покроев пять: прежние три те же, женщина — в подоле, переднике и платке, ребёнок — мельче', () => {
    expect(FOLK_KINDS_NEXT).toBe(FOLK_KINDS + 2);
    for (let k = 0; k < FOLK_KINDS; k++) {
      const a = new Figure();
      const b = new Figure();
      dressFolk(a, k);
      dressVillager(b, k);
      expect(slotsOf(a), `покрой ${k}`).toEqual(slotsOf(b));
      expect(a.scale).toBe(1);
    }
    const woman = new Figure();
    dressFolk(woman, FOLK_KINDS);
    // Подол — перевёрнутый корпус на тазе, передник — пластина на тазе, платок — шапка на голове.
    expect(slotsOf(woman)).toContain('body@hips');
    expect(slotsOf(woman)).toContain('plate@hips');
    expect(slotsOf(woman)).toContain('cap@head');
    const child = new Figure();
    dressFolk(child, FOLK_KINDS + 1);
    expect(child.scale).toBeLessThan(0.75);
    // Переодетый ребёнок становится взрослым: масштаб снимается при одевании.
    dressFolk(child, 0);
    expect(child.scale).toBe(1);
  });

  it('у огня греют руки — лицом к пламени и руки вперёд; ночью греются почти все', () => {
    let warm = 0;
    let warmNight = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      const f = new Figure();
      dressFolk(f, i);
      f.phase = i * 1.37;
      f.position.set(Math.cos(i) * 2, 0, Math.sin(i) * 2);
      folkIdle(f, 3.2, false);
      if (f.armMain < -0.6 && f.armOff < -0.6) {
        warm++;
        // Лицом к огню: взгляд (+z фигуры) повёрнут к началу координат.
        const look = { x: Math.sin(f.rotationY), z: Math.cos(f.rotationY) };
        const toFire = { x: -f.position.x / 2, z: -f.position.z / 2 };
        expect(look.x * toFire.x + look.z * toFire.z, 'смотрит в огонь').toBeGreaterThan(0.99);
      }
      folkIdle(f, 3.2, true);
      if (f.armMain < -0.6 && f.armOff < -0.6) warmNight++;
    }
    // Область: днём греется часть, не все и не никто.
    expect(warm).toBeGreaterThan(N * 0.2);
    expect(warm).toBeLessThan(N * 0.5);
    expect(warmNight).toBeGreaterThan(N * 0.55);
  });

  it('у прежнего вида поза у огня — прежняя стойка: без крючка житель стоит как стоял', () => {
    const a = new VillagerAgent(4);
    const b = new Figure();
    dressVillager(b, 4);
    b.phase = a.figure.phase;
    // Агент стоит на месте: цель — там же, где он.
    (a as unknown as { target: { set(x: number, y: number, z: number): void } }).target.set(a.figure.position.x, 0, a.figure.position.z);
    a.update(0.016, 5);
    poseFigure(b, 'stand', 5);
    expect(a.idle).toBeNull();
    for (const k of ['armMain', 'armOff', 'elbowMain', 'headNod', 'bob', 'torsoTilt'] as const) expect(a.figure[k], k).toBeCloseTo(b[k], 9);
    // С крючком (вид next) стоящий зовёт его.
    let called = 0;
    a.idle = (): void => void called++;
    a.update(0.016, 5.1);
    expect(called).toBe(1);
  });
});

describe('звери посёлка вида next', () => {
  it('собака одна, кур по уровню — на низком меньше; все в пуле, снимаются с ним; примитивов те же семь', () => {
    expect(HENS.low).toBeLessThan(HENS.medium);
    expect(HENS.medium).toBeLessThanOrEqual(HENS.high);
    for (const q of ['low', 'medium', 'high'] as const) {
      const pool = new FigurePool();
      const life = startLife({ pool, quality: q });
      expect(life.beasts, q).toBe(1 + HENS[q]);
      expect(pool.size, q).toBe(1 + HENS[q]);
      life.dispose();
      expect(pool.size, `${q}: снято`).toBe(0);
    }
    expect(PARTS).toHaveLength(7);
  });

  it('собака не отходит от костра и не лезет в огонь; куры не уходят от своих огородов', () => {
    const pool = new FigurePool();
    const life = startLife({ pool, quality: 'high' });
    const spots = gardenSpots();
    const figures = (pool as unknown as { figures: Figure[] }).figures;
    const [dog, ...hens] = figures;
    // Граница области: звери двигаются — без этого правило «не уходят» выполнялось бы даром.
    const start = dog.position.clone();
    const hen0 = hens[0].position.clone();
    let moved = 0;
    for (let i = 0; i < 4000; i++) {
      life.update(0.05, i * 0.05, i > 2000);
      const r = Math.hypot(dog.position.x, dog.position.z);
      expect(r, 'собака у костра').toBeGreaterThan(0.9);
      expect(r, 'собака у костра').toBeLessThan(1.3);
      for (const h of hens) {
        const d = Math.min(...spots.map((s) => Math.hypot(h.position.x - s.x, h.position.z - s.z)));
        expect(d, 'курица у огорода').toBeLessThan(0.61);
      }
      if (dog.position.distanceTo(start) > 0.1 || hens[0].position.distanceTo(hen0) > 0.1) moved++;
    }
    expect(moved, 'звери двигаются').toBeGreaterThan(100);
    life.dispose();
  });

  it('овцы пасутся, трава — нет: определение пастьбы — только у материала овец', () => {
    const season = new SeasonVisuals();
    season.update('summer', 1);
    const w = buildEnv({ quality: 'medium', season, village: null });
    const sheep = w.group.getObjectByName('sheep') as THREE.Mesh;
    const grass = w.group.getObjectByName('grass') as THREE.Mesh;
    // Граница области: на среднем овцы есть — правило спрашивается.
    expect((sheep as THREE.InstancedMesh).count).toBeGreaterThan(0);
    expect((sheep.material as THREE.Material & { defines: Record<string, string> }).defines).toHaveProperty('ENV_GRAZE');
    expect((grass.material as THREE.Material & { defines: Record<string, string> }).defines).not.toHaveProperty('ENV_GRAZE');
    w.dispose();
  });

  it('новый житель одевается в покрой вида next, и пул пересчитывает спрос', () => {
    const pool = new FigurePool();
    const life = startLife({ pool, quality: 'medium' });
    const agent = new VillagerAgent(FOLK_KINDS);
    pool.add(agent.figure);
    const before = pool.demand().plate;
    life.dressFolk(agent);
    expect(agent.idle).toBe(folkIdle);
    expect(pool.demand().plate, 'передник прибавил пластину').toBeGreaterThan(before);
    life.dispose();
  });
});
