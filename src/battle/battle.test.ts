// Раздел 16 документа — это список тестов. Здесь они все: доминирующего состава
// нет, разрыв быстрой атаки в коридоре, кольцо работает, превосходство условно,
// бой детерминирован, укладывается в 50–100 тиков, а журнал объясняет исход и не
// врёт числам.
import { describe, expect, it } from 'vitest';
import { simulateBattle } from './sim';
import { quickSetup, quickAttack, presetWeights, armyTotal, stackTotal, stackOf, validateSetup, QUICK_PRESETS, QUICK_PRESET_IDS } from './setup';
import { ANNIHILATED_AT, COUNTER, GEAR, MORALE, PHASE_TICKS, TEMPER, UNIT_STATS } from './config';
import { ARMY_SIZE, BALANCED_ARMY, COMPOSITIONS, KNOWN_COUNTER, RING, TUNED, gapAgainst, lossRatio, mirrored, quickOf, setupOf } from './bench';
import { PHASES, SECTORS, UNIT_KINDS, type ArmySetup, type BattleEvent, type BattleResult, type Side, type Stack, type Winner } from './types';

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
    // Центр пехотный, но фланги заякорены малой долей пехоты: без неё фланг ломается первым.
    expect(s.sectors.B.infantry).toBe(140);
    expect(s.sectors.A.infantry).toBe(30);
    expect(s.sectors.C.infantry).toBe(30);
    expect(s.sectors.B.spear).toBe(0);
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
  it('настроенная армия выигрывает у быстрой атаки 10–25% по потерям на ста боях', () => {
    const { gap, lost } = gapAgainst(TUNED, quickOf, 100);
    expect(gap).toBeGreaterThanOrEqual(0.1);
    expect(gap).toBeLessThanOrEqual(0.25);
    expect(lost).toBeLessThan(25);
    for (let seed = 1; seed <= 4; seed += 1) expect(armyTotal(TUNED)).toEqual(armyTotal(quickOf(seed)));
  });

  it('против каждого пресета в отдельности настроенная армия не проигрывает', () => {
    for (const id of QUICK_PRESET_IDS) {
      const { gap } = gapAgainst(TUNED, () => QUICK_PRESETS[id].layout(stackOf(BALANCED_ARMY)), 30);
      expect(gap, id).toBeGreaterThan(-0.05);
    }
  });

  it('известный контрер стандартного пресета против случайного пресета падает до тех же ≈15%', () => {
    // Против одного известного шаблона контрер выигрывает вдвое и больше — это цена публичного
    // шаблона. Против быстрой атаки, где пресет неизвестен, его преимущество — не больше, чем у
    // любой настроенной армии.
    const known = gapAgainst(KNOWN_COUNTER, () => QUICK_PRESETS.standard.layout(stackOf(BALANCED_ARMY)), 60);
    const random = gapAgainst(KNOWN_COUNTER, quickOf, 100);
    expect(known.gap).toBeGreaterThan(0.4);
    expect(random.gap).toBeGreaterThan(0.05);
    expect(random.gap).toBeLessThanOrEqual(0.25);
    expect(random.gap).toBeLessThan(known.gap / 2);
  });
});

describe('пресеты быстрой атаки', () => {
  it('каждый пресет раскладывает любой состав целиком, и ни один не пуст', () => {
    const armies: Array<Partial<Stack>> = [BALANCED_ARMY, { infantry: 300 }, { spear: 200, archer: 100 }, { cavalry: 50 }, { archer: 40, cavalry: 40 }, { spear: 1 }];
    for (const id of QUICK_PRESET_IDS) {
      for (const army of armies) {
        const s = QUICK_PRESETS[id].layout(stackOf(army));
        expect(armyTotal(s), `${id}: ${JSON.stringify(army)}`).toEqual(stackOf(army));
        expect(validateSetup(s)).toBeNull();
      }
    }
  });

  it('быстрая атака выбирает пресет по сиду детерминированно, и без разведки все четыре в ходу', () => {
    const picks: Record<string, number> = {};
    for (let seed = 1; seed <= 400; seed += 1) {
      const a = quickAttack(BALANCED_ARMY, seed);
      const b = quickAttack(BALANCED_ARMY, seed);
      expect(a.preset).toBe(b.preset);
      expect(JSON.stringify(a.setup)).toBe(JSON.stringify(b.setup));
      picks[a.preset] = (picks[a.preset] ?? 0) + 1;
    }
    for (const id of QUICK_PRESET_IDS) expect(picks[id] ?? 0, id).toBeGreaterThan(400 * 0.15);
  });

  it('свежие разведданные сдвигают выбор: против массы конницы чаще приходит анти-кавалерия', () => {
    let plain = 0;
    let informed = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      if (quickAttack(BALANCED_ARMY, seed).preset === 'anti-cavalry') plain += 1;
      if (quickAttack(BALANCED_ARMY, seed, { cavalry: 300, infantry: 200 }).preset === 'anti-cavalry') informed += 1;
    }
    expect(informed).toBeGreaterThan(plain * 1.5);
    // Разведка без единого замеченного бойца ничего не сдвигает.
    expect(presetWeights({})).toEqual(presetWeights());
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

/** Полная длина боя без досрочного конца: стрелковая фаза плюс все остальные целиком. */
const fullLength = (r: BattleResult): number => r.phases.find((p) => p.phase === 'ranged')!.to + PHASES.filter((p) => p !== 'ranged').reduce((n, p) => n + PHASE_TICKS[p], 0);
const endedEarly = (r: BattleResult): boolean => r.ticks < fullLength(r);

describe('мораль по секторам', () => {
  it('бой обычно кончается отступлением, а не гонгом', () => {
    // Раньше 87% боёв шли до потолка тиков, а победителя объявляли по тому, кто впереди. Теперь сектора
    // ломаются, паника идёт по соседям, и армия отступает сама: досрочный конец — норма, ничья — редкость.
    const pairs = allPairs(4);
    let early = 0;
    let draws = 0;
    let total = 0;
    for (const p of pairs) {
      for (const r of p.results) {
        total += 1;
        if (endedEarly(r)) early += 1;
        if (r.winner === 'draw') draws += 1;
      }
    }
    expect(early / total).toBeGreaterThan(0.8);
    expect(draws / total).toBeLessThan(0.1);
  });

  it('перевес в 10% не даёт лавины: размен не выше ≈1.5', () => {
    // Ограничитель на перекидывание паники: та же армия на 10% больше при прочих равных.
    // Составы без пешей линии (одна конница с луками) сюда не входят: там кольцо — конница добивает
    // лучников, когда линии нет, — даёт больше по замыслу.
    const ratios: number[] = [];
    for (const c of COMPOSITIONS) {
      if (!(c.army.infantry ?? 0) && !(c.army.spear ?? 0)) continue;
      const bigger = quickSetup(Object.fromEntries(Object.entries(c.army).map(([k, n]) => [k, Math.round((n ?? 0) * 1.1)])));
      let bigLoss = 0;
      let smallLoss = 0;
      for (let seed = 1; seed <= 16; seed += 1) {
        const bigAttacks = seed % 2 === 1;
        const r = simulateBattle({ seed, attacker: bigAttacks ? bigger : c.setup, defender: bigAttacks ? c.setup : bigger });
        bigLoss += r.sides[bigAttacks ? 'attacker' : 'defender'].total.losses;
        smallLoss += r.sides[bigAttacks ? 'defender' : 'attacker'].total.losses;
      }
      const ratio = smallLoss / Math.max(1, bigLoss);
      expect(ratio, `${c.name}: размен ${ratio.toFixed(2)}`).toBeLessThanOrEqual(1.6);
      ratios.push(ratio);
    }
    expect(ratios.reduce((a, b) => a + b, 0) / ratios.length).toBeLessThanOrEqual(1.5);
  });

  it('сломанный сектор тянет соседей, и армия отступает, когда сломано достаточно', () => {
    let panics = 0;
    let breaks = 0;
    for (const r of sampleBattles()) {
      for (const e of r.log) {
        if (e.id === 'sector-broken') breaks += 1;
        if (e.id === 'panic-spread') panics += 1;
      }
      // Армия, сломавшаяся по морали, к этому моменту потеряла сектора весом не меньше порога — или линию целиком.
      for (const side of ['attacker', 'defender'] as const) {
        const collapsed = r.log.find((e) => e.id === 'morale-collapsed' && e.side === side);
        if (!collapsed || collapsed.id !== 'morale-collapsed') continue;
        const brokenBefore = r.log.filter((e) => e.id === 'sector-broken' && e.side === side && e.tick <= collapsed.tick).length;
        const lostShare = r.sides[side].total.losses / r.sides[side].total.initial;
        expect(brokenBefore > 0 || lostShare > MORALE.autoBreakLoss * 0.9).toBe(true);
      }
    }
    expect(breaks).toBeGreaterThan(0);
    expect(panics).toBeGreaterThan(0);
  });

  it('якорь: сектор с пехотой держит мораль дольше, чем без неё', () => {
    const wall = quickSetup({ infantry: 600 });
    const bare = setupOf({ A: { spear: 150 }, B: { spear: 300 }, C: { spear: 150 } }, { orders: { spear: 'advance', infantry: 'hold-center', archer: 'nearest', cavalry: 'charge' } });
    const anchoredLine = setupOf({ A: { spear: 110, infantry: 40 }, B: { spear: 220, infantry: 80 }, C: { spear: 110, infantry: 40 } }, { orders: { spear: 'advance', infantry: 'hold-center', archer: 'nearest', cavalry: 'charge' } });
    let bareBreak = 0;
    let anchoredBreak = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const firstBreak = (r: BattleResult): number => r.log.find((e) => e.id === 'sector-broken' && e.side === 'attacker')?.tick ?? r.ticks + 1;
      bareBreak += firstBreak(simulateBattle({ seed, attacker: bare, defender: wall }));
      anchoredBreak += firstBreak(simulateBattle({ seed, attacker: anchoredLine, defender: wall }));
    }
    expect(anchoredBreak).toBeGreaterThan(bareBreak);
    expect(MORALE.anchor).toBeLessThan(1);
    expect(MORALE.anchorPanic).toBeLessThan(1);
  });
});

describe('мораль как характеристика войск', () => {
  it('у каждого рода своя базовая мораль: пехота — масса, копейщики стойче', () => {
    expect(UNIT_STATS.infantry.morale).toBeLessThan(UNIT_STATS.spear.morale);
    for (const k of UNIT_KINDS) {
      expect(UNIT_STATS[k].morale).toBeGreaterThan(0);
      expect(UNIT_STATS[k].morale).toBeLessThanOrEqual(MORALE.max);
    }
  });

  it('снаряжение из кузницы делает войско стойче: та же армия со снаряжением выигрывает размен', () => {
    const plain = quickSetup(BALANCED_ARMY);
    const geared = quickSetup(BALANCED_ARMY, { gear: { spear: GEAR.max, infantry: GEAR.max, archer: GEAR.max, cavalry: GEAR.max } });
    let wins = 0;
    let ratio = 0;
    const N = 12;
    for (let seed = 1; seed <= N; seed += 1) {
      const m = mirrored(geared, plain, seed);
      if (m.winner === 'a') wins += 1;
      ratio += m.lossRatio;
    }
    expect(wins).toBeGreaterThanOrEqual(N - 2);
    expect(ratio / N).toBeGreaterThan(1.1);
    // Ступень выше потолка не даёт больше потолка.
    const capped = simulateBattle({ seed: 1, attacker: quickSetup(BALANCED_ARMY, { gear: { infantry: 99 } }), defender: plain });
    const max = simulateBattle({ seed: 1, attacker: quickSetup(BALANCED_ARMY, { gear: { infantry: GEAR.max } }), defender: plain });
    expect(JSON.stringify(capped.sides)).toBe(JSON.stringify(max.sides));
  });

  it('копейщики стойки, пока держат линию, и ломки под ударом во фланг', () => {
    expect(TEMPER.spear.holding).toBeLessThan(TEMPER.spear.advancing);
    expect(TEMPER.spear.advancing).toBeLessThan(TEMPER.spear.flanked);
    const wall = quickSetup({ infantry: 600 });
    const spears = (spear: ArmySetup['orders']['spear']): ArmySetup => quickSetup({ spear: 600 }, { orders: { spear, infantry: 'hold-center', archer: 'nearest', cavalry: 'charge' } });
    let holding = 0;
    let advancing = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      holding += simulateBattle({ seed, attacker: spears('hold-line'), defender: wall }).sides.attacker.morale;
      advancing += simulateBattle({ seed, attacker: spears('advance'), defender: wall }).sides.attacker.morale;
    }
    expect(holding).toBeGreaterThan(advancing);
  });

  it('конница высока на разгоне, но хрупка, когда её остановили', () => {
    expect(TEMPER.cavalry.charging).toBeLessThan(TEMPER.cavalry.stalled);
    // Конница, вставшая во фронт против стены пехоты, ломается сама; та же конница в обходе — нет.
    const wall = quickSetup({ infantry: 400 });
    const stalled = setupOf({ A: { cavalry: 60 }, B: { cavalry: 80 }, C: { cavalry: 60 } }, { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'charge' } });
    let broken = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const r = simulateBattle({ seed, attacker: stalled, defender: wall });
      if (r.log.some((e) => e.id === 'sector-broken' && e.side === 'attacker')) broken += 1;
    }
    expect(broken).toBeGreaterThanOrEqual(5);
  });

  it('лучники в рукопашной ломаются быстро', () => {
    expect(TEMPER.archer.melee).toBeGreaterThan(TEMPER.archer.shooting);
    const archers = quickSetup({ archer: 400 });
    const wall = quickSetup({ infantry: 400 });
    for (let seed = 1; seed <= 4; seed += 1) {
      const r = simulateBattle({ seed, attacker: archers, defender: wall });
      const clash = r.phases.find((p) => p.phase === 'clash')!;
      const firstBreak = r.log.find((e) => e.id === 'sector-broken' && e.side === 'attacker');
      expect(firstBreak).toBeDefined();
      expect(firstBreak!.tick - clash.from).toBeLessThanOrEqual(12);
      expect(r.winner).toBe('defender');
    }
  });
});

describe('детерминированность', () => {
  it('один вход и сид — один исход и один журнал', () => {
    const input = { seed: 4242, attacker: TUNED, defender: quickOf(4242) };
    const snapshot = JSON.stringify(input);
    const a = simulateBattle(input);
    const b = simulateBattle(JSON.parse(snapshot));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.log).toEqual(b.log);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('другой сид меняет ход боя, но не его форму', () => {
    const a = simulateBattle({ seed: 1, attacker: TUNED, defender: quickOf(1) });
    const b = simulateBattle({ seed: 2, attacker: TUNED, defender: quickOf(1) });
    expect(JSON.stringify({ ...a, seed: 0 })).not.toBe(JSON.stringify({ ...b, seed: 0 }));
    // Форма — обязательные фазы в том же порядке; обходы и резерв бой вправе пропустить, если сторона сломалась раньше.
    const must = (r: BattleResult): string[] => r.phases.map((p) => p.phase).filter((p) => p !== 'flanking' && p !== 'reserve');
    expect(must(a)).toEqual(must(b));
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
  if (e.side === loser) return ['morale-collapsed', 'annihilated', 'sector-collapsed', 'sector-broken', 'panic-spread', 'ranged-lost', 'flank-turned', 'rear-reached', 'outfought'].includes(e.id);
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
            expect(e.brokenShare).toBeGreaterThanOrEqual(0);
            expect(e.brokenShare).toBeLessThanOrEqual(1);
            break;
          case 'sector-broken': {
            // Сломаться может только сектор, где кто-то стоял.
            const manned =
              initialOf(e.side, e.sector) > 0 ||
              r.log.some((x) => x.tick <= e.tick && 'side' in x && x.side === e.side && ((x.id === 'reserve-committed' && x.sector === e.sector) || (x.id === 'infantry-shifted' && x.to === e.sector)));
            expect(manned, `сломан пустой сектор ${e.sector}`).toBe(true);
            expect(seen.has(`broken:${e.side}:${e.sector}`)).toBe(false);
            seen.add(`broken:${e.side}:${e.sector}`);
            break;
          }
          case 'panic-spread':
            expect(e.from).not.toBe(e.to);
            // Паника идёт только от уже сломанного сектора.
            expect(r.log.some((x) => x.id === 'sector-broken' && x.side === e.side && x.sector === e.from && x.tick <= e.tick)).toBe(true);
            break;
          case 'ranged-lost':
            expect(e.phase).toBe('clash');
            expect(e.losses).toBeGreaterThan(e.enemyLosses);
            expect(e.losses).toBeLessThanOrEqual(r.sides[e.side].total.losses + 1);
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
      // Мораль секторов сходится с журналом: сломан — значит, в журнале есть слом или сектор перебит.
      for (const side of ['attacker', 'defender'] as const) {
        for (const id of SECTORS) {
          const sec = r.sides[side].sectors[id];
          expect(sec.morale).toBeGreaterThanOrEqual(0);
          expect(sec.morale).toBeLessThanOrEqual(100);
          if (stackTotal(sec.initial) === 0) expect(sec.broken).toBe(false);
          if (sec.broken && stackTotal(sec.final) > 0) expect(sec.morale).toBe(0);
        }
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
