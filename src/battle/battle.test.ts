// Раздел 16 документа — это список тестов. Здесь они все: доминирующего состава
// нет, разрыв быстрой атаки в коридоре, кольцо работает, превосходство условно,
// бой детерминирован, укладывается в 50–100 тиков, а журнал объясняет исход и не
// врёт числам.
import { describe, expect, it } from 'vitest';
import { simulateBattle } from './sim';
import { quickSetup, armyTotal, stackTotal } from './setup';
import { ANNIHILATED_AT, COUNTER } from './config';
import { ARMY_SIZE, BALANCED_ARMY, COMPOSITIONS, RING, TUNED_VS_QUICK, lossRatio, mirrored, setupOf } from './bench';
import { PHASES, SECTORS, type ArmySetup, type BattleEvent, type BattleResult, type Side, type Winner } from './types';

const other = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');

/** Все пары составов по нескольку сидов, с обеих сторон поля. */
function allPairs(seeds: number): Array<{ a: string; b: string; wins: number; losses: number; results: BattleResult[] }> {
  const out: Array<{ a: string; b: string; wins: number; losses: number; results: BattleResult[] }> = [];
  for (let i = 0; i < COMPOSITIONS.length; i += 1) {
    for (let j = i + 1; j < COMPOSITIONS.length; j += 1) {
      let wins = 0;
      let losses = 0;
      const results: BattleResult[] = [];
      for (let seed = 1; seed <= seeds; seed += 1) {
        const m = mirrored(COMPOSITIONS[i].setup, COMPOSITIONS[j].setup, seed);
        if (m.winner === 'a') wins += 1;
        else if (m.winner === 'b') losses += 1;
        results.push(...m.results);
      }
      out.push({ a: COMPOSITIONS[i].name, b: COMPOSITIONS[j].name, wins, losses, results });
    }
  }
  return out;
}

/** Крайние случаи: они должны и завершаться в срок, и давать честный журнал. */
const EXTREMES: Array<{ name: string; attacker: ArmySetup; defender: ArmySetup }> = [
  { name: 'толпа против горстки', attacker: quickSetup({ infantry: 1000 }), defender: quickSetup({ spear: 10 }) },
  { name: 'горстка против толпы', attacker: quickSetup({ archer: 5 }), defender: quickSetup({ cavalry: 900, infantry: 300 }) },
  { name: 'один на один', attacker: quickSetup({ infantry: 1 }), defender: quickSetup({ spear: 1 }) },
  { name: 'только лучники с обеих сторон', attacker: quickSetup({ archer: 300 }), defender: quickSetup({ archer: 300 }) },
  { name: 'только конница с обеих сторон', attacker: quickSetup({ cavalry: 300 }), defender: quickSetup({ cavalry: 300 }) },
  {
    name: 'вся конница в преследовании против одних копий',
    attacker: quickSetup({ cavalry: 200 }, { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'pursue' } }),
    defender: quickSetup({ spear: 200 }),
  },
  {
    name: 'изматывание против агрессии',
    attacker: quickSetup(BALANCED_ARMY, { plan: 'attrition' }),
    defender: quickSetup(BALANCED_ARMY, { plan: 'aggressive' }),
  },
  {
    name: 'копья охраняют лучников, конница обходит',
    attacker: setupOf(
      { A: { spear: 100 }, B: { infantry: 200 }, C: { spear: 100 }, D: { archer: 50 }, E: { archer: 100 }, F: { archer: 50 } },
      { orders: { spear: 'guard-archers', infantry: 'hold-center', archer: 'keep-distance', cavalry: 'charge' } },
    ),
    defender: setupOf(
      { A: { infantry: 100, cavalry: 80 }, B: { infantry: 200 }, C: { infantry: 100, cavalry: 80 }, E: { archer: 100 } },
      { plan: 'cavalry-strike', orders: { spear: 'hold-line', infantry: 'support-weak-flank', archer: 'support-center', cavalry: 'flank' } },
    ),
  },
];

function sampleBattles(): BattleResult[] {
  const out: BattleResult[] = [];
  for (const p of allPairs(2)) out.push(...p.results);
  for (const e of EXTREMES) for (const seed of [1, 2, 3]) out.push(simulateBattle({ seed, attacker: e.attacker, defender: e.defender }));
  for (const r of RING) out.push(simulateBattle({ seed: 5, attacker: r.a, defender: r.b }));
  return out;
}

describe('шаблон быстрой атаки', () => {
  it('раскладывает любой состав целиком и по правилу', () => {
    const s = quickSetup(BALANCED_ARMY);
    expect(armyTotal(s)).toEqual({ spear: 150, infantry: 200, archer: 150, cavalry: 100 });
    expect(s.sectors.B.infantry).toBe(200);
    expect(s.sectors.A.spear + s.sectors.C.spear).toBe(150);
    expect(s.sectors.D.archer + s.sectors.E.archer + s.sectors.F.archer).toBe(150);
    expect(s.sectors.R.cavalry).toBe(100);
    for (const army of [{ archer: 7 }, { cavalry: 3 }, { spear: 1 }, { infantry: 2, cavalry: 2 }]) {
      expect(stackTotal(armyTotal(quickSetup(army)))).toBe(stackTotal({ spear: 0, infantry: 0, archer: 0, cavalry: 0, ...army }));
    }
    // Некому держать фронт — конница выходит вперёд, а не ждёт в резерве.
    expect(quickSetup({ cavalry: 30 }).sectors.R.cavalry).toBe(0);
  });

  it('пустая армия не принимается', () => {
    expect(() => simulateBattle({ seed: 1, attacker: quickSetup({}), defender: quickSetup({ spear: 1 }) })).toThrow();
  });
});

describe('нет доминирующего состава', () => {
  it('каждый состав кому-нибудь проигрывает', () => {
    const pairs = allPairs(6);
    const losesTo = new Map<string, string[]>();
    for (const c of COMPOSITIONS) losesTo.set(c.name, []);
    for (const p of pairs) {
      if (p.wins > p.losses) losesTo.get(p.b)!.push(p.a);
      else if (p.losses > p.wins) losesTo.get(p.a)!.push(p.b);
    }
    for (const c of COMPOSITIONS) {
      expect(losesTo.get(c.name)!.length, `${c.name} не проигрывает никому`).toBeGreaterThan(0);
    }
  });
});

describe('разрыв быстрой атаки', () => {
  it('настроенная армия выигрывает у шаблона 10–25% по потерям на ста боях', () => {
    let quick = 0;
    let tuned = 0;
    let tunedLost = 0;
    for (let seed = 1; seed <= 100; seed += 1) {
      const tunedAttacks = seed % 2 === 1;
      const r = simulateBattle({
        seed,
        attacker: tunedAttacks ? TUNED_VS_QUICK.tuned : TUNED_VS_QUICK.quick,
        defender: tunedAttacks ? TUNED_VS_QUICK.quick : TUNED_VS_QUICK.tuned,
      });
      const t: Side = tunedAttacks ? 'attacker' : 'defender';
      tuned += r.sides[t].total.losses;
      quick += r.sides[other(t)].total.losses;
      if (r.winner === other(t)) tunedLost += 1;
    }
    const gap = quick / tuned - 1;
    expect(gap).toBeGreaterThanOrEqual(0.1);
    expect(gap).toBeLessThanOrEqual(0.25);
    expect(tunedLost).toBeLessThan(10);
    expect(armyTotal(TUNED_VS_QUICK.tuned)).toEqual(armyTotal(TUNED_VS_QUICK.quick));
  });
});

describe('кольцо контрров', () => {
  for (const pair of RING) {
    it(pair.name, () => {
      let wins = 0;
      let ratio = 0;
      const N = 12;
      for (let seed = 1; seed <= N; seed += 1) {
        const m = mirrored(pair.a, pair.b, seed);
        if (m.winner === 'a') wins += 1;
        ratio += m.lossRatio;
      }
      expect(wins).toBe(N);
      expect(ratio / N).toBeGreaterThan(1.5);
    });
  }
});

describe('превосходство условно', () => {
  const cavalry = quickSetup({ cavalry: ARMY_SIZE });
  const spears = (spear: ArmySetup['orders']['spear']): ArmySetup =>
    quickSetup({ spear: ARMY_SIZE }, { orders: { spear, infantry: 'hold-center', archer: 'nearest', cavalry: 'charge' } });

  it('копейщики с приказом «наступать» теряют преимущество над конницей', () => {
    let holding = 0;
    let advancing = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      holding += mirrored(spears('hold-line'), cavalry, seed).lossRatio;
      advancing += mirrored(spears('advance'), cavalry, seed).lossRatio;
    }
    expect(advancing).toBeLessThan(holding * 0.6);
    expect(COUNTER.spear.cavalryAdvancing).toBeLessThan(COUNTER.spear.cavalryHolding);
  });

  it('конница против сомкнутых копий проигрывает', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const m = mirrored(cavalry, spears('hold-line'), seed);
      expect(m.winner).toBe('b');
      expect(m.lossRatio).toBeLessThan(1);
    }
  });

  it('конница в обход закрытого тыла с копьями разбивается о них', () => {
    // Копья охраняют лучников в тылу: конница, зашедшая туда, встречает сомкнутый строй.
    const guarded = setupOf(
      { A: { infantry: 100 }, B: { infantry: 200 }, C: { infantry: 100 }, D: { archer: 40, spear: 60 }, E: { archer: 70, spear: 80 }, F: { archer: 40, spear: 60 } },
      { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'charge' } },
    );
    const open = setupOf(
      { A: { infantry: 100, spear: 60 }, B: { infantry: 200, spear: 80 }, C: { infantry: 100, spear: 60 }, D: { archer: 40 }, E: { archer: 70 }, F: { archer: 40 } },
      { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'charge' } },
    );
    const striker = setupOf(
      { A: { infantry: 200 }, B: { infantry: 300 }, C: { infantry: 200 }, R: { cavalry: 100 } },
      { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'flank' }, reserve: { kind: 'immediate' } },
    );
    let guardedArchers = 0;
    let openArchers = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const g = simulateBattle({ seed, attacker: striker, defender: guarded });
      const o = simulateBattle({ seed, attacker: striker, defender: open });
      guardedArchers += g.sides.defender.losses.archer;
      openArchers += o.sides.defender.losses.archer;
      // В закрытый тыл конница упирается в копья, в открытый — вырубает лучников.
      expect(g.log.some((e) => e.id === 'spears-held' && e.side === 'defender')).toBe(true);
      expect(o.log.some((e) => e.id === 'cavalry-broke-archers' && e.side === 'attacker')).toBe(true);
      expect(g.sides.attacker.losses.cavalry).toBeGreaterThan(o.sides.attacker.losses.cavalry);
    }
    expect(guardedArchers * 1.5).toBeLessThan(openArchers);
  });

  it('лучники после контакта резко теряют ценность', () => {
    const shooters = setupOf({ A: { infantry: 100 }, B: { infantry: 200 }, C: { infantry: 100 }, D: { archer: 60 }, E: { archer: 80 }, F: { archer: 60 } });
    const wall = quickSetup({ infantry: 600 });
    for (let seed = 1; seed <= 4; seed += 1) {
      const r = simulateBattle({ seed, attacker: shooters, defender: wall });
      const clash = r.phases.find((p) => p.phase === 'clash')!;
      // Стрельба идёт до самого преследования: окно — от первого столкновения до конца отступления.
      const retreat = r.phases.find((p) => p.phase === 'retreat')!;
      const before = r.sides.attacker.rangedBeforeContact / (clash.from - 1);
      const after = (r.sides.attacker.rangedTotal - r.sides.attacker.rangedBeforeContact) / (retreat.to - clash.from + 1);
      expect(before).toBeGreaterThan(0);
      expect(after).toBeLessThan(before * 0.5);
    }
    expect(COUNTER.archer.afterContact).toBeLessThan(0.5);
  });
});

describe('детерминированность', () => {
  it('один вход и сид — один исход и один журнал', () => {
    const input = { seed: 4242, attacker: TUNED_VS_QUICK.tuned, defender: TUNED_VS_QUICK.quick };
    const snapshot = JSON.stringify(input);
    const a = simulateBattle(input);
    const b = simulateBattle(JSON.parse(snapshot));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.log).toEqual(b.log);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('другой сид меняет ход боя, но не его форму', () => {
    const a = simulateBattle({ seed: 1, attacker: TUNED_VS_QUICK.tuned, defender: TUNED_VS_QUICK.quick });
    const b = simulateBattle({ seed: 2, attacker: TUNED_VS_QUICK.tuned, defender: TUNED_VS_QUICK.quick });
    expect(a.sides.attacker.total.losses).not.toBe(b.sides.attacker.total.losses);
    expect(a.phases.map((p) => p.phase)).toEqual(b.phases.map((p) => p.phase));
  });
});

describe('продолжительность', () => {
  it('любой бой укладывается в 50–100 тиков и идёт по фазам без разрывов', () => {
    for (const r of sampleBattles()) {
      expect(r.ticks).toBeGreaterThanOrEqual(50);
      expect(r.ticks).toBeLessThanOrEqual(100);
      let next = 1;
      for (const span of r.phases) {
        expect(span.from).toBe(next);
        expect(span.to).toBeGreaterThanOrEqual(span.from);
        next = span.to + 1;
      }
      expect(next - 1).toBe(r.ticks);
      // Фазы идут в объявленном порядке; пропущенные — только между боем линий и моралью.
      const order = r.phases.map((p) => PHASES.indexOf(p.phase));
      for (let i = 1; i < order.length; i += 1) expect(order[i]).toBeGreaterThan(order[i - 1]);
      for (const must of ['ranged', 'approach', 'clash', 'lines', 'morale', 'retreat', 'pursuit']) {
        expect(r.phases.some((p) => p.phase === must), must).toBe(true);
      }
    }
  });
});

/** События, которые объясняют, почему победитель победил. */
function explains(e: BattleEvent, winner: Winner): boolean {
  if (winner === 'draw') return false;
  const loser = other(winner);
  if (!('side' in e)) return false;
  if (e.side === loser) return ['morale-collapsed', 'annihilated', 'sector-collapsed', 'flank-turned', 'rear-reached', 'outfought'].includes(e.id);
  return ['spears-held', 'cavalry-broke-archers', 'volley', 'pursuit', 'reserve-committed', 'archers-kiting', 'infantry-shifted'].includes(e.id);
}

describe('журнал осмыслен', () => {
  it('в каждом бою есть событие, объясняющее исход, и ни одно не противоречит числам', () => {
    for (const r of sampleBattles()) {
      const last = r.log[r.log.length - 1];
      expect(last.id).toBe('result');
      if (last.id === 'result') {
        expect(last.winner).toBe(r.winner);
        expect(last.reason).toBe(r.reason);
      }
      if (r.winner !== 'draw') {
        expect(r.log.some((e) => explains(e, r.winner)), `нет объяснения: ${JSON.stringify(r.log.map((e) => e.id))}`).toBe(true);
        expect(r.reason).not.toBe('draw');
      } else {
        expect(r.reason).toBe('draw');
      }

      for (const side of ['attacker', 'defender'] as const) {
        const s = r.sides[side];
        // Потери сходятся по родам, по секторам и в сумме.
        for (const k of ['spear', 'infantry', 'archer', 'cavalry'] as const) {
          expect(s.final[k]).toBeGreaterThanOrEqual(0);
          expect(s.final[k]).toBeLessThanOrEqual(s.initial[k]);
          expect(s.losses[k]).toBe(s.initial[k] - s.final[k]);
          const bySectors = SECTORS.reduce((n, id) => n + s.sectors[id].final[k], 0);
          expect(bySectors).toBe(s.final[k]);
        }
        expect(s.total.losses).toBe(s.total.initial - s.total.final);
        expect(s.rangedBeforeContact).toBeLessThanOrEqual(r.sides[other(side)].total.losses);
        expect(s.rangedTotal).toBeGreaterThanOrEqual(s.rangedBeforeContact);
      }

      const initialOf = (side: Side, sector: string): number => stackTotal(r.sides[side].sectors[sector as 'A'].initial);
      const seen = new Set<string>();
      let retreats = 0;
      for (const e of r.log) {
        expect(e.tick).toBeGreaterThanOrEqual(1);
        expect(e.tick).toBeLessThanOrEqual(r.ticks);
        const span = r.phases.find((p) => p.phase === e.phase)!;
        expect(e.tick).toBeGreaterThanOrEqual(span.from);
        expect(e.tick).toBeLessThanOrEqual(span.to);
        switch (e.id) {
          case 'volley':
            // Событие записано в момент контакта, итог округлён по секторам: расходятся не больше чем на единицу.
            expect(Math.abs(e.losses - r.sides[e.side].rangedBeforeContact)).toBeLessThanOrEqual(1);
            expect(e.phase).toBe('clash');
            break;
          case 'spears-held':
            expect(r.sides[e.side].initial.spear).toBeGreaterThan(0);
            expect(r.sides[other(e.side)].initial.cavalry).toBeGreaterThan(0);
            expect(e.cavalryLost).toBeLessThanOrEqual(r.sides[other(e.side)].losses.cavalry);
            expect(e.cavalryLost).toBeGreaterThanOrEqual(e.spearsLost);
            break;
          case 'cavalry-broke-archers':
            expect(r.sides[e.side].initial.cavalry).toBeGreaterThan(0);
            expect(e.archersLost).toBeLessThanOrEqual(r.sides[other(e.side)].losses.archer);
            break;
          case 'cavalry-intercepted':
            expect(r.sides[e.side].initial.cavalry).toBeGreaterThan(0);
            break;
          case 'sector-collapsed': {
            expect(['A', 'B', 'C']).toContain(e.sector);
            // Смять можно только то, что там стояло: своя расстановка, вошедший резерв или сдвинутая пехота.
            const manned =
              initialOf(e.side, e.sector) > 0 ||
              r.log.some((x) => x.tick <= e.tick && 'side' in x && x.side === e.side && ((x.id === 'reserve-committed' && x.sector === e.sector) || (x.id === 'infantry-shifted' && x.to === e.sector)));
            expect(manned, `смят пустой сектор ${e.sector}`).toBe(true);
            expect(seen.has(`collapsed:${e.side}:${e.sector}`)).toBe(false);
            seen.add(`collapsed:${e.side}:${e.sector}`);
            break;
          }
          case 'flank-turned':
          case 'rear-reached':
            expect(e.by).toBe(other(e.side));
            expect(e.phase).not.toBe('ranged');
            expect(e.phase).not.toBe('approach');
            break;
          case 'reserve-committed':
            expect(e.men).toBeGreaterThan(0);
            expect(e.men).toBeLessThanOrEqual(r.sides[e.side].total.initial);
            expect(initialOf(e.side, 'R') > 0 || r.sides[e.side].initial.cavalry > 0).toBe(true);
            break;
          case 'infantry-shifted':
            expect(r.sides[e.side].initial.infantry).toBeGreaterThanOrEqual(e.men);
            break;
          case 'archers-kiting':
            expect(r.sides[e.side].initial.archer).toBeGreaterThan(0);
            break;
          case 'morale-collapsed':
            expect(r.sides[e.side].brokenAt).toBe(e.tick);
            expect(e.morale).toBeLessThanOrEqual(100);
            break;
          case 'annihilated':
            expect(r.sides[e.side].total.final).toBeLessThanOrEqual(Math.ceil(ANNIHILATED_AT * r.sides[e.side].total.initial));
            expect(r.winner).not.toBe(e.side);
            break;
          case 'outfought':
            expect(r.winner).toBe(other(e.side));
            expect(r.reason).toBe('losses');
            expect(e.kept).toBeLessThan(e.enemyKept);
            break;
          case 'retreat':
            retreats += 1;
            expect(r.winner).toBe(other(e.side));
            // Отходят строем, если к этому моменту не сломались; сломаться можно и позже, уже на отходе.
            if (e.orderly) expect(r.sides[e.side].brokenAt === null || r.sides[e.side].brokenAt! >= e.tick).toBe(true);
            else expect(r.sides[e.side].brokenAt! <= e.tick).toBe(true);
            expect(e.phase).toBe('retreat');
            break;
          case 'pursuit':
            expect(r.winner).toBe(e.side);
            expect(e.losses).toBeGreaterThan(0);
            expect(e.losses).toBeLessThanOrEqual(r.sides[other(e.side)].total.losses);
            expect(e.phase).toBe('pursuit');
            break;
          case 'phase-start':
            expect(e.tick).toBe(span.from);
            break;
          case 'result':
            expect(e).toBe(last);
            break;
        }
      }
      expect(retreats).toBe(r.winner === 'draw' ? 0 : 1);
      if (r.reason === 'morale' || r.reason === 'annihilated') {
        const loser = r.sides[other(r.winner as Side)];
        expect(loser.brokenAt).not.toBeNull();
      }
      if (r.winner !== 'draw') {
        // Победитель не может быть перебит.
        expect(r.sides[r.winner].total.final).toBeGreaterThan(0);
      }
    }
  });

  it('у истреблённой стороны в журнале стоит истребление, а не только мораль', () => {
    const r = simulateBattle({ seed: 1, attacker: quickSetup({ infantry: 1000 }), defender: quickSetup({ spear: 10 }) });
    expect(r.winner).toBe('attacker');
    expect(r.log.some((e) => e.id === 'annihilated' && e.side === 'defender')).toBe(true);
    expect(lossRatio(r, 'attacker')).toBeGreaterThan(1);
  });
});
