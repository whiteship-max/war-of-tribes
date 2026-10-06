// Значки карты нового вида (`tw/marks.ts`, `tw/glyph.ts`; docs/map_tw.md, раздел 14): рисунок — из листа значков, а
// не своей кистью; ключ спрайта называет всё, от чего зависит картинка; размер читается и плашкой, и диском; свой
// город отличается от соседа при любой стадии; тело значка лежит в холсте.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SettlementView, Stage } from '@/world/types';
import { RELATION_META } from '@/world/data/meta';
import { SIDE_COLOR } from '@/side';
import { DRAWN_ICONS } from '@/ui/icons/generated';
import { SCALE_MAX, SCALE_MIN } from '../const';
import { fakeCanvasEnv } from '../fakecanvas';
import { type ShapeNode, shapesOf } from './glyph';
import { type MarkLook, BADGE_D, PIPS, STAGE_PIPS, badgeLook, dropMarks, markBase, markGeo, markKey, markPx, markSprite } from './marks';
import type { BadgeKind } from './marks';
import { RUIN_RING, hostMarkOf, placeMarkOf } from './scene';

const STAGES: Stage[] = ['camp', 'village', 'stronghold', 'town'];

const place = (o: Partial<SettlementView>): SettlementView => ({
  id: 's',
  x: 0,
  y: 0,
  name: 'Место',
  stage: 'town',
  relation: 'neutral',
  owner: null,
  tribeId: null,
  tribeName: null,
  color: RELATION_META.neutral.color,
  mine: false,
  castle: true,
  visible: true,
  seenAt: 0,
  stale: false,
  seenPop: 100,
  marching: false,
  ruin: false,
  sacked: false,
  besieged: null,
  fell: null,
  ...o,
});

/** Все виды значка, которые рисует карта: места всех видов и стадий, отряды всех размеров, метки. */
function allLooks(): MarkLook[] {
  const out: MarkLook[] = [];
  for (const stage of STAGES) {
    out.push(placeMarkOf(place({ stage, mine: true, relation: 'self', color: SIDE_COLOR.ours })));
    out.push(placeMarkOf(place({ stage })));
    out.push(placeMarkOf(place({ stage, relation: 'enemy', color: RELATION_META.enemy.color, sacked: true })));
    out.push(placeMarkOf(place({ stage, relation: 'barbarian', color: RELATION_META.barbarian.color, castle: false })));
    out.push(placeMarkOf(place({ stage, ruin: true, relation: 'barbarian', castle: false })));
  }
  for (const size of [0, 1, 2, 3, 4] as const) {
    for (const camp of [false, true]) out.push(hostMarkOf({ color: SIDE_COLOR.foe, size, west: false, camp }));
  }
  for (const k of ['attack', 'troops', 'siege', 'wolves', 'raiders'] as BadgeKind[]) out.push(badgeLook(k));
  return out;
}

describe('значки карты: рисунок из листа', () => {
  it('каждый рисунок, который берёт карта, нарисован в листе значков', () => {
    const drawn = new Set(DRAWN_ICONS);
    const names = new Set<string>(['ui-crown']);
    for (const l of allLooks()) {
      names.add(l.glyph);
      if (l.corner) names.add(l.corner);
    }
    for (const n of names) expect(drawn.has(n), n).toBe(true);
  });

  it('разбор символа: прямоугольник, круг, многоугольник и путь — по порядку слоёв, чужой тег пропускается', () => {
    const node = (tagName: string, a: Record<string, string>): ShapeNode => ({ tagName, getAttribute: (k) => a[k] ?? null });
    const shapes = shapesOf([
      node('rect', { x: '1', y: '2', width: '3', height: '4', fill: '#111111' }),
      node('circle', { cx: '5', cy: '6', r: '7', fill: '#222222' }),
      node('polygon', { points: '1,2 3,4 5,6', fill: '#333333' }),
      node('path', { d: 'M0 0H4V4Z', fill: '#444444' }),
      node('title', {}),
    ]);
    expect(shapes).toEqual([
      { k: 'rect', x: 1, y: 2, w: 3, h: 4, fill: '#111111' },
      { k: 'circle', cx: 5, cy: 6, r: 7, fill: '#222222' },
      { k: 'poly', pts: [1, 2, 3, 4, 5, 6], fill: '#333333' },
      { k: 'path', d: 'M0 0H4V4Z', fill: '#444444' },
    ]);
  });
});

describe('значки карты: вид места', () => {
  it('свой город отличается от соседа той же стадии: корона, золото, крупнее — при любой стадии и масштабе', () => {
    for (const stage of STAGES) {
      const own = placeMarkOf(place({ stage, mine: true, relation: 'self', color: SIDE_COLOR.ours }));
      const other = placeMarkOf(place({ stage: 'town' }));
      expect(own.own).toBe(true);
      expect(own.ring).toBe(SIDE_COLOR.ours);
      expect(other.own).toBe(false);
      expect(other.ring).not.toBe(SIDE_COLOR.ours);
      // Сосед — даже крепость против своей стоянки — мельче своего.
      for (const scale of [SCALE_MIN, 7, 15, 24, 44, SCALE_MAX]) expect(markPx(scale, own.pips, true)).toBeGreaterThan(markPx(scale, other.pips, false));
    }
  });

  it('размер места — плашкой по стадии у всех, у своего тоже; диск соседа растёт со стадией', () => {
    for (const stage of STAGES) {
      expect(placeMarkOf(place({ stage })).pips).toBe(STAGE_PIPS[stage]);
      expect(placeMarkOf(place({ stage, mine: true, relation: 'self' })).pips).toBe(STAGE_PIPS[stage]);
      expect(placeMarkOf(place({ stage, relation: 'barbarian', castle: false })).pips).toBe(STAGE_PIPS[stage]);
    }
    for (const scale of [7, 24, 44]) {
      const d = STAGES.map((stage) => markPx(scale, STAGE_PIPS[stage], false));
      for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
    }
  });

  it('рисунок по виду: чужой город — своей стадией, логово — разбойники, пепелище — приглушённый огонь, разорено — огонь в углу', () => {
    for (const stage of STAGES) expect(placeMarkOf(place({ stage })).glyph).toBe(`stage-${stage}`);
    expect(placeMarkOf(place({ mine: true, relation: 'self', stage: 'camp' })).glyph).toBe('stage-town');
    expect(placeMarkOf(place({ relation: 'barbarian', castle: false })).glyph).toBe('evt-raiders');
    const ruin = placeMarkOf(place({ ruin: true, relation: 'barbarian', castle: false }));
    expect(ruin).toMatchObject({ glyph: 'evt-fire', dim: true, ring: RUIN_RING });
    expect(placeMarkOf(place({ sacked: true })).corner).toBe('evt-fire');
    expect(placeMarkOf(place({})).corner).toBeNull();
  });

  it('отряд: в поле — воин, у цели — шатры; слух — без плашки и приглушённо', () => {
    expect(hostMarkOf({ color: SIDE_COLOR.ours, size: 2, west: true, camp: false })).toMatchObject({ glyph: 'troop-legionary', pips: 2, dim: false });
    expect(hostMarkOf({ color: SIDE_COLOR.foe, size: 3, west: false, camp: true })).toMatchObject({ glyph: 'stage-camp', pips: 3 });
    expect(hostMarkOf({ color: SIDE_COLOR.foe, size: 0, west: false, camp: false })).toMatchObject({ pips: 0, dim: true });
  });
});

describe('значки карты: размер и тело', () => {
  it('диск растёт с масштабом плавно и в пределах 22…42 px', () => {
    let prev = 0;
    for (let s = SCALE_MIN; s <= SCALE_MAX; s += 0.5) {
      const b = markBase(s);
      expect(b).toBeGreaterThanOrEqual(22);
      expect(b).toBeLessThanOrEqual(42);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('тело — диск и плашка размера; корона своего — над диском', () => {
    for (const d of [20, 26, 40, 52]) {
      const plain = markGeo({ own: false, pips: 0 }, d);
      const pips = markGeo({ own: false, pips: 2 }, d);
      const own = markGeo({ own: true, pips: 2 }, d);
      expect(pips.down).toBeGreaterThan(plain.down);
      expect(own.up).toBeGreaterThan(pips.up);
      expect(pips.pillW).toBeLessThanOrEqual(d);
      expect(PIPS * pips.pip).toBeLessThan(pips.pillW);
    }
  });
});

describe('значки карты: спрайт', () => {
  let env: ReturnType<typeof fakeCanvasEnv>;
  beforeAll(() => {
    env = fakeCanvasEnv();
  });
  afterAll(() => {
    dropMarks();
    env.restore();
  });

  it('ключ различает каждое поле вида, размер и плотность', () => {
    const base: MarkLook = { glyph: 'stage-town', ring: '#cbbca6', pips: 2, own: false, dim: false, corner: null };
    const variants: MarkLook[] = [
      { ...base, glyph: 'stage-camp' },
      { ...base, ring: '#e06b5a' },
      { ...base, pips: 3 },
      { ...base, own: true },
      { ...base, dim: true },
      { ...base, corner: 'evt-fire' },
    ];
    const keys = new Set([markKey(base, 30, 2), markKey(base, 32, 2), markKey(base, 30, 3), ...variants.map((v) => markKey(v, 30, 2))]);
    expect(keys.size).toBe(3 + variants.length);
  });

  it('тело значка лежит в холсте — при любом виде и размере; точка привязки — середина диска', () => {
    for (const l of allLooks()) {
      for (const d of [BADGE_D, 22, 30, 42, 54]) {
        const m = markSprite(l, d, 2);
        const g = markGeo(l, d);
        expect(m.ax - g.rx).toBeGreaterThanOrEqual(0);
        expect(m.ax + g.rx).toBeLessThanOrEqual(m.w);
        expect(m.ax - g.pillW / 2).toBeGreaterThanOrEqual(0);
        expect(m.ay - g.up).toBeGreaterThanOrEqual(0);
        expect(m.ay + g.down).toBeLessThanOrEqual(m.h);
        expect(m.ax).toBeCloseTo(m.w / 2, 6);
      }
    }
  });

  it('один ключ — один спрайт', () => {
    const l = placeMarkOf(place({}));
    expect(markSprite(l, 30, 2)).toBe(markSprite(l, 30, 2));
    expect(markSprite(l, 30, 2)).not.toBe(markSprite(l, 32, 2));
  });
});
