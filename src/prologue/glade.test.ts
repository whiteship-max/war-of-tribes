/**
 * Поляна: где что стоит, куда можно дойти и до чего дотянуться.
 *
 * Числа тут — факты, и проверять их надо таблицей, а не разглядыванием сцены:
 * ровно тем же способом, каким проверяется план посёлка (`render/plan.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import {
  AXE_STUMP,
  BODY_R,
  FIRE,
  GLADE_R,
  REACH,
  REGROW_MS,
  START,
  TENT,
  TREES,
  TREE_R,
  blockers,
  nearest,
  slide,
  standing,
  yawTo,
} from './glade';

const NONE = TREES.map(() => 0);

describe('поляна расставлена', () => {
  it('всё стоит внутри поляны и никто ни на ком', () => {
    const all = [
      { x: FIRE.x, z: FIRE.z, r: FIRE.r },
      { x: TENT.x, z: TENT.z, r: TENT.r },
      { x: AXE_STUMP.x, z: AXE_STUMP.z, r: AXE_STUMP.r },
      ...TREES.map((t) => ({ ...t, r: TREE_R })),
    ];
    for (const a of all) {
      expect(Math.hypot(a.x, a.z) + a.r, 'вылезло за поляну').toBeLessThan(GLADE_R);
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z);
        // Между двумя предметами обязан проходить человек, иначе он застрянет.
        expect(d, `${i} и ${j} стоят вплотную`).toBeGreaterThan(all[i].r + all[j].r + BODY_R * 2 + 0.3);
      }
    }
  });

  it('игрок входит на свободное место и лицом к делу', () => {
    const free = slide(START.x, START.z, blockers(NONE, 0));
    expect(free.x).toBeCloseTo(START.x, 6);
    expect(free.z).toBeCloseTo(START.z, 6);
    // Первое, что он видит, — колода с топором: с неё начинается вся цепочка.
    expect(START.yaw).toBeCloseTo(yawTo(START.x, START.z, AXE_STUMP.x, AXE_STUMP.z), 9);
  });

  it('на старте игрок у костра, но топор и деревья — за прогулкой', () => {
    // У костра он просыпается, и это правильно: первая же надпись говорит, что
    // огню нужны дрова. А вот дрова придётся идти добывать — иначе первый кусок
    // отвечал бы на вопрос про кнопку, а не про ходьбу.
    expect(nearest(START.x, START.z, NONE, 0)?.kind).toBe('fire');
    const far = (s: { x: number; z: number; r: number }): number =>
      Math.hypot(START.x - s.x, START.z - s.z) - s.r;
    expect(far(AXE_STUMP), 'топор дают, не сходя с места').toBeGreaterThan(REACH);
    for (let i = 0; i < TREES.length; i++) {
      expect(far({ ...TREES[i], r: TREE_R }), `дерево ${i} в руках сразу`).toBeGreaterThan(REACH);
    }
  });

  it('каждое дерево достижимо: до каждого можно подойти на расстояние удара', () => {
    for (let i = 0; i < TREES.length; i++) {
      const t = TREES[i];
      const d = Math.hypot(t.x, t.z);
      // Подходим по прямой от костра, останавливаясь у ствола.
      const k = (d - TREE_R - BODY_R) / d;
      const spot = nearest(t.x * k, t.z * k, NONE, 0);
      expect(spot?.kind, `дерево ${i} не даётся в руки`).toBe('tree');
      expect(spot?.index).toBe(i);
    }
  });
});

describe('до чего дотянулись — то и сделаем', () => {
  it('у самого костра предлагается костёр', () => {
    expect(nearest(FIRE.x + FIRE.r + 0.3, FIRE.z, NONE, 0)?.kind).toBe('fire');
  });

  it('дальше досягаемости — ничего', () => {
    expect(nearest(FIRE.x, FIRE.z + FIRE.r + REACH + 0.5, NONE, 0)).toBeNull();
  });

  it('меряется от края, а не от середины: «вплотную» одно на все предметы', () => {
    // Дерево тонкое, костёр толстый; если мерить от середины, до толстого
    // придётся тянуться сквозь него.
    const atFire = nearest(0, FIRE.r + REACH - 0.05, NONE, 0);
    expect(atFire?.kind).toBe('fire');
    const t = TREES[0];
    const d = Math.hypot(t.x, t.z);
    const k = (d - TREE_R - REACH + 0.05) / d;
    expect(nearest(t.x * k, t.z * k, NONE, 0)?.kind).toBe('tree');
  });

  it('из двух рядом берётся ближнее', () => {
    // Стоим между колодой и первым деревом, но ближе к колоде.
    const spot = nearest(AXE_STUMP.x + AXE_STUMP.r + 0.2, AXE_STUMP.z, NONE, 0);
    expect(spot?.kind).toBe('axe');
  });

  it('сваленное дерево в руки не даётся, а отросшее — снова да', () => {
    const felled = TREES.map((_, i) => (i === 0 ? 1000 : 0));
    const t = TREES[0];
    const d = Math.hypot(t.x, t.z);
    const k = (d - TREE_R - BODY_R) / d;
    expect(nearest(t.x * k, t.z * k, felled, 1000)).toBeNull();
    expect(nearest(t.x * k, t.z * k, felled, 1000 + REGROW_MS)?.kind).toBe('tree');
  });
});

describe('пень зарастает по времени, а не по тику', () => {
  it('стоит, свалено, отросло', () => {
    expect(standing(0, 0)).toBe(true);
    expect(standing(1000, 1000)).toBe(false);
    expect(standing(1000, 1000 + REGROW_MS - 1)).toBe(false);
    expect(standing(1000, 1000 + REGROW_MS)).toBe(true);
  });

  it('поляна не кончается: последнее дерево когда-нибудь вернётся', () => {
    // Семь пней и погасший костёр — тупик, из которого игрок не выйдет ничем.
    const all = TREES.map(() => 1);
    expect(blockers(all, 1).length).toBe(3);
    expect(blockers(all, 1 + REGROW_MS).length).toBe(3 + TREES.length);
  });
});

describe('в преграды не входят, а обходят их', () => {
  it('шаг в костёр выталкивает наружу', () => {
    const p = slide(0.1, 0.1, blockers(NONE, 0));
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(FIRE.r + BODY_R, 6);
  });

  it('ровно в середине преграды направления нет, но и застрять нельзя', () => {
    const p = slide(FIRE.x, FIRE.z, blockers(NONE, 0));
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
    expect(Math.hypot(p.x - FIRE.x, p.z - FIRE.z)).toBeCloseTo(FIRE.r + BODY_R, 6);
  });

  it('идущий по касательной скользит, а не встаёт насухо', () => {
    // Упёршись в дерево под углом, игрок обязан его обойти, ведя палец туда же.
    const t = TREES[0];
    let x = t.x - 2;
    let z = t.z - 0.4;
    const blocks = blockers(NONE, 0);
    let moved = 0;
    for (let i = 0; i < 60; i++) {
      const p = slide(x + 0.08, z, blocks);
      moved += Math.hypot(p.x - x, p.z - z);
      x = p.x;
      z = p.z;
    }
    // Прошёл заметный путь и оказался с другой стороны ствола.
    expect(moved).toBeGreaterThan(2);
    expect(x).toBeGreaterThan(t.x);
  });

  it('за край поляны не уйти', () => {
    const p = slide(100, 100, blockers(NONE, 0));
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(GLADE_R, 6);
  });

  it('пень преградой не считается: через него перешагивают', () => {
    const felled = TREES.map(() => 1);
    const t = TREES[0];
    const p = slide(t.x, t.z, blockers(felled, 1));
    expect(p.x).toBeCloseTo(t.x, 6);
    expect(p.z).toBeCloseTo(t.z, 6);
  });
});

describe('куда смотреть', () => {
  it('камера без поворота смотрит вдоль −Z', () => {
    expect(yawTo(0, 0, 0, -1)).toBeCloseTo(0, 9);
    expect(yawTo(0, 0, -1, 0)).toBeCloseTo(Math.PI / 2, 9);
    expect(yawTo(0, 0, 1, 0)).toBeCloseTo(-Math.PI / 2, 9);
  });
});
