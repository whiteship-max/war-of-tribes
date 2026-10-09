// Обстрел перед штурмом в ролике TW (docs/battle_tw.md, раздел 15): пролог показывает залпы, а бой от него не меняется ни
// в одном числе; пролом — той же таблицей, что у ядра; машины — за тылом стреляющих; сбитые — доля `wallMen`.
import { barrageShares } from '@/ui/battle/barrage';
import { describe, expect, it } from 'vitest';
import { breachOf } from '@/world/siegecraft';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from './record';
import { BARRAGE_INTRO, armAt, breachColumns, breachWidth, type TwBarrage } from './barrage';
import { cuesOf } from './cues';
import { inGate, onWalk, outOf, type TwWall } from './site';
import type { TwPlan } from './plan';

const planOf = (q: string, shots?: number): TwPlan => {
  const b = standBattle(new URLSearchParams(q));
  return twPlanOfRecord(b.result, b.us, b.troops, 'medium', b.militia, b.place, b.beastSide, b.site, barrageShares(shots));
};

/** Набор штурмов: разные силы и сиды, город берут и отбивают. */
const WALLS = [
  'site=wall&men=300&foe=300&seed=7',
  'site=wall&men=200&foe=420&seed=3',
  'site=wall&men=500&foe=260&seed=11',
  'site=wall&men=120&foe=150&seed=5&place=woods',
];
/** Малые штурмы: на стене мало людей, и доля сбитых не упирается в потолок уровня. */
const SMALL_WALLS = ['site=wall&men=8&foe=12&seed=7&militia=2', 'site=wall&men=6&foe=10&seed=3&militia=2'];
const LAIRS = ['site=lair&men=200&foe=150&seed=7', 'site=lair&men=90&foe=160&seed=2'];

/** Всё, по чему кадр боя раскладывается: если пролог тронул хоть одно число — ролик боя уже другой. */
function battleDigest(p: TwPlan): unknown {
  return {
    seconds: p.seconds,
    clashAt: p.clashAt,
    timing: p.timing,
    k: p.k,
    units: p.units.map((u) => ({ ...u })),
    arrays: [p.unitOf, p.lx, p.lz, p.deathAt, p.deadX, p.deadZ, p.fallOrder, p.goAt, p.path, p.climb, p.fromGate, p.deadShown].map((a) => Array.from(a)),
    site: p.site,
  };
}

const wallOf = (p: TwPlan): TwWall => {
  expect(p.site?.kind).toBe('wall');
  return p.site!.wall!;
};

describe('обстрел перед штурмом — пролог ролика TW', () => {
  it('нет залпов или нет стены и логова — пролога нет', () => {
    expect(planOf(WALLS[0]).barrage).toBeNull();
    expect(planOf(WALLS[0], 0).barrage).toBeNull();
    expect(planOf('site=gate&men=200&foe=150&seed=7', 2).barrage).toBeNull();
    expect(planOf('men=200&foe=150&seed=7', 3).barrage).toBeNull();
  });

  it('бой тот же до бита: пролог ничего не меняет в плане боя', () => {
    let checked = 0;
    for (const q of [...WALLS, ...LAIRS]) {
      const bare = battleDigest(planOf(q));
      for (const shots of [1, 2, 3]) {
        const p = planOf(q, shots);
        // Точка внутри области правила: пролог у этого боя есть.
        expect(p.barrage, q).not.toBeNull();
        expect(battleDigest(p), `${q} shots=${shots}`).toEqual(bare);
        checked++;
      }
    }
    expect(checked).toBe(18);
  });

  it('звук боя сдвинут на длину пролога, его звуки — впереди', () => {
    const bare = cuesOf(planOf(WALLS[0]));
    const p = planOf(WALLS[0], 2);
    const pre = p.barrage!.seconds;
    const all = cuesOf(p);
    const battle = all.filter((c) => !['engine', 'stone', 'impact', 'collapse'].includes(c.kind) && c.at >= pre);
    expect(battle.map((c) => [c.kind, +(c.at - pre).toFixed(6)])).toEqual(bare.map((c) => [c.kind, +c.at.toFixed(6)]));
    const before = all.filter((c) => c.at < pre);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((c) => ['engine', 'stone', 'impact', 'collapse', 'wallcry'].includes(c.kind))).toBe(true);
  });

  it('пролом — та же таблица, что у ядра: доля стены залпами, по куску на залп', () => {
    for (const shots of [1, 2, 3]) {
      const p = planOf(WALLS[0], shots);
      const br = p.barrage!.breach!;
      expect(br.width).toBeCloseTo(breachOf({ shots }) * 20, 9);
      expect(br.chunks).toHaveLength(shots);
      // Куски не перекрываются и вместе — весь пролом; каждый следующий — позже.
      const spans = br.chunks.flatMap((c) => c.spans).sort((a, b) => a[0] - b[0]);
      expect(spans[0][0]).toBeCloseTo(br.x - br.width / 2, 9);
      expect(spans[spans.length - 1][1]).toBeCloseTo(br.x + br.width / 2, 9);
      for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeCloseTo(spans[i - 1][1], 9);
      for (let i = 1; i < br.chunks.length; i++) expect(br.chunks[i].at).toBeGreaterThan(br.chunks[i - 1].at);
      // Ширина каждого залпа — его доля стены (20 / 10 / 5 % → 4 / 2 / 1 м).
      br.chunks.forEach((c, i) => {
        const w = c.spans.reduce((s, [a, b]) => s + b - a, 0);
        expect(w).toBeCloseTo(breachWidth(p.barrage!.shares, i + 1) - breachWidth(p.barrage!.shares, i), 9);
      });
      // Столбцы опущенной половины — внутри пролома, не глубже стены.
      for (const c of breachColumns(br, p.cast.seed)) {
        expect(c.drop).toBeGreaterThan(0);
        expect(c.drop).toBeLessThanOrEqual(wallOf(p).top);
      }
    }
  });

  it('пролом — в пролёте стены: не в воротах и не в башне', () => {
    for (const q of WALLS) {
      for (const shots of [1, 3]) {
        const p = planOf(q, shots);
        const w = wallOf(p);
        const br = p.barrage!.breach!;
        const a = br.x - br.width / 2;
        const b = br.x + br.width / 2;
        expect(a, q).toBeGreaterThan(-w.halfX);
        expect(b, q).toBeLessThan(w.halfX);
        for (let x = a; x <= b; x += 0.25) expect(inGate(w, x), `${q} x=${x}`).toBe(false);
        for (const t of w.towers) expect(b < t.x - t.size / 2 || a > t.x + t.size / 2, `${q} башня ${t.x}`).toBe(true);
      }
    }
  });

  it('машины — за тылом стреляющих, на поле; камни ложатся в кладку пролома и рядом', () => {
    for (const q of WALLS) {
      const p = planOf(q, 3);
      const w = wallOf(p);
      const b = p.barrage as TwBarrage;
      expect(b.engines).toHaveLength(3);
      expect(b.engines.filter((e) => e.kind === 'trebuchet')).toHaveLength(1);
      const besieger = p.units.filter((u) => u.side !== w.side);
      const rear = Math.max(...besieger.map((u) => outOf(w, u.z) + u.depth));
      for (const e of b.engines) {
        expect(outOf(w, e.z), q).toBeGreaterThan(rear);
        expect(e.z).toBeGreaterThanOrEqual(p.field.minZ);
        expect(e.z).toBeLessThanOrEqual(p.field.maxZ);
        expect(Math.abs(e.x)).toBeLessThanOrEqual(p.field.halfX);
      }
      for (const s of b.stones) {
        expect(s.at).toBeGreaterThanOrEqual(BARRAGE_INTRO - 0.11);
        expect(s.at + s.flight).toBeLessThan(b.seconds);
        if (s.hit === 'wall') {
          // В наружную грань, по высоте стены.
          expect(Math.abs(s.z1 - w.z)).toBeLessThan(0.5);
          expect(s.y1).toBeGreaterThan(w.base);
          expect(s.y1).toBeLessThan(w.base + w.top);
        }
        if (s.hit === 'short') expect(outOf(w, s.z1)).toBeGreaterThan(0);
        if (s.hit === 'over') expect(outOf(w, s.z1)).toBeLessThan(0);
      }
      // Рушит кусок последний камень своего круга, и обвал — в миг его удара.
      for (const [i, c] of b.breach!.chunks.entries()) {
        const s = b.stones.find((x) => x.chunk === i)!;
        expect(c.at).toBeCloseTo(s.at + s.flight, 9);
      }
      // Каждая машина срывается столько раз, сколько кругов (пристрелка и залпы), и до срыва взведена.
      for (const e of b.engines) {
        expect(e.shots).toHaveLength(4);
        expect(armAt(e, e.shots[0] - 0.01)).toBe(0);
        expect(armAt(e, e.shots[0] + 0.5)).toBeGreaterThan(0.95);
      }
    }
  });

  it('сбитых со стены — та доля, что снял пролом: b / (1 − b) к оставшимся', () => {
    let checked = 0;
    let free = 0;
    for (const q of [...WALLS, ...SMALL_WALLS]) {
      for (const shots of [1, 2, 3]) {
        const p = planOf(q, shots);
        const w = wallOf(p);
        const b = p.barrage!;
        const share = breachOf({ shots });
        const onWall = p.units.filter((u) => u.side === w.side && u.perch && u.kind !== 'cavalry' && u.kind !== 'heavy').reduce((s, u) => s + u.figures, 0);
        expect(onWall, q).toBeGreaterThan(0);
        const raw = Math.round((onWall * share) / (1 - share));
        // Точка внутри области правила — доля не упёрлась в потолок уровня (8 на среднем); у больших штурмов — упёрлась.
        if (raw < 8) free++;
        expect(b.fallers, q).toHaveLength(Math.min(8, raw));
        for (const f of b.fallers) {
          // Стоят на ходу, падают наружу — к подножию, после обвала своего куска.
          expect(onWalk(w, f.x, f.z), `${q} ${f.x},${f.z}`).toBe(true);
          expect(outOf(w, f.z1)).toBeGreaterThan(0);
          expect(f.at).toBeGreaterThanOrEqual(b.breach!.chunks[0].at);
          expect(Math.abs(f.x - b.breach!.x)).toBeLessThanOrEqual(b.breach!.width / 2);
        }
        checked++;
      }
    }
    expect(checked).toBe(18);
    expect(free).toBeGreaterThanOrEqual(3);
  });

  it('логово: стены нет — пролома и сбитых нет, камни ложатся в шалаши', () => {
    for (const q of LAIRS) {
      const p = planOf(q, 2);
      const b = p.barrage!;
      expect(p.site?.kind).toBe('lair');
      expect(b.walls).toBe(false);
      expect(b.breach).toBeNull();
      expect(b.fallers).toHaveLength(0);
      const huts = p.site!.camp!.tents;
      const hits = b.stones.filter((s) => s.hit === 'hut');
      expect(hits.length).toBeGreaterThan(0);
      for (const s of hits) expect(huts.some((t) => Math.hypot(t.x - s.x1, t.z - s.z1) < 0.01)).toBe(true);
      expect(b.smoke.length).toBeGreaterThan(0);
    }
  });
});
