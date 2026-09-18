// Раздел 16 документа — это список тестов. Здесь они все: доминирующего состава
// нет, разрыв быстрой атаки в коридоре, кольцо работает, превосходство условно,
// бой детерминирован, укладывается в границы, выведенные из фаз, а журнал объясняет
// исход и не врёт числам.
import { describe, expect, it } from 'vitest';
import { simulateBattle } from './sim';
import { emptyStack, quickSetup, quickAttack, presetWeights, armyTotal, stackTotal, stackOf, validateSetup, QUICK_PRESETS, QUICK_PRESET_IDS } from './setup';
import { describeEvent } from './log';
import { ANNIHILATED_AT, COUNTER, GEAR, MORALE, PHASE_MIN, PHASE_TICKS, PLANS, PYRRHIC_BELOW, RANGED_TICKS, TEMPER, UNIT_STATS } from './config';
import { ARMY_SIZE, BALANCED_ARMY, COMPOSITIONS, LATTICE_STEP, SCREEN_KINDS, compositionLattice, compositionName, latticeDuels, screenArmy, screenCurve, screenPoints, screenThinner, type LatticeRow, KNOWN_COUNTER, OVERSIZE_CAP, RATIO_EVEN, RING, TUNED, gapAgainst, hasLine, homogeneous, layoutGrid, layoutName, layoutOf, lossRatio, mirrored, quickOf, setupOf } from './bench';
import { FRONT, HORSE_KINDS, PHASES, REAR, SECTORS, UNIT_KINDS, type ArmySetup, type BattleEvent, type BattleResult, type Plan, type Side, type Stack, type Winner } from './types';

const other = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');

/** Конница обоих родов: события журнала про коней пишет ядро по `HORSE_KINDS`, и сверять их надо так же. */
const horse = (st: Stack): number => HORSE_KINDS.reduce((n, k) => n + st[k], 0);

/** Все пары составов по нескольку сидов, с обеих сторон поля. `ratio` — средний размен a к b. */
function allPairs(seeds: number): Array<{ a: string; b: string; ratio: number; results: BattleResult[] }> {
  const out: Array<{ a: string; b: string; ratio: number; results: BattleResult[] }> = [];
  for (let i = 0; i < COMPOSITIONS.length; i += 1) {
    for (let j = i + 1; j < COMPOSITIONS.length; j += 1) {
      let ratio = 0;
      const results: BattleResult[] = [];
      for (let seed = 1; seed <= seeds; seed += 1) {
        const m = mirrored(COMPOSITIONS[i].setup, COMPOSITIONS[j].setup, seed);
        ratio += m.lossRatio;
        results.push(...m.results);
      }
      out.push({ a: COMPOSITIONS[i].name, b: COMPOSITIONS[j].name, ratio: ratio / seeds, results });
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
    expect(armyTotal(s)).toEqual({ spear: 150, infantry: 200, archer: 150, cavalry: 100, heavy: 0 });
    // Центр пехотный, но фланги заякорены малой долей пехоты: без неё фланг ломается первым.
    expect(s.sectors.B.infantry).toBe(140);
    expect(s.sectors.A.infantry).toBe(30);
    expect(s.sectors.C.infantry).toBe(30);
    expect(s.sectors.B.spear).toBe(0);
    expect(s.sectors.A.spear + s.sectors.C.spear).toBe(150);
    expect(s.sectors.D.archer + s.sectors.E.archer + s.sectors.F.archer).toBe(150);
    expect(s.sectors.R.cavalry).toBe(100);
    for (const army of [{ archer: 7 }, { cavalry: 3 }, { spear: 1 }, { infantry: 2, cavalry: 2 }]) {
      expect(stackTotal(armyTotal(quickSetup(army)))).toBe(stackTotal({ ...emptyStack(), ...army }));
    }
    // Некому держать фронт — конница выходит вперёд, а не ждёт в резерве.
    expect(quickSetup({ cavalry: 30 }).sectors.R.cavalry).toBe(0);
  });

  it('пустая армия не принимается', () => {
    expect(() => simulateBattle({ seed: 1, attacker: quickSetup({}), defender: quickSetup({ spear: 1 }) })).toThrow();
  });
});

describe('нет доминирующего состава', () => {
  // Противники — вся решётка составов (`bench.compositionLattice`), а не список, подобранный
  // руками: список не содержит того, кто доминирует, и промахивается мимо тех, кто его бьёт. Порог — по
  // размену, не по доле побед: поле держит тот, у кого дольше мораль, а платить за него можно
  // больше, чем за поражение. Дыру заслона ловит свой тест («линия по силе»), а не этот.
  let rows: LatticeRow[] | null = null;
  const lattice = (): LatticeRow[] => (rows ??= latticeDuels());

  it('решётка — все составы по всем родам ядра, от нуля до всей армии', () => {
    const armies = compositionLattice();
    // Граница области: число составов — сочетания с повторениями, и каждый род хоть раз
    // стоит армией целиком, — иначе «каждый кому-то проигрывает» проверялось бы не на всех.
    const slots = ARMY_SIZE / LATTICE_STEP;
    const choose = (n: number, k: number): number => (k === 0 ? 1 : (choose(n - 1, k - 1) * n) / k);
    expect(armies.length).toBe(choose(slots + UNIT_KINDS.length - 1, UNIT_KINDS.length - 1));
    for (const army of armies) expect(stackTotal(stackOf(army))).toBe(ARMY_SIZE);
    for (const k of UNIT_KINDS) expect(armies.some((a) => a[k] === ARMY_SIZE), k).toBe(true);
  });

  it('каждый состав решётки кому-нибудь проигрывает размен', () => {
    const r = lattice();
    for (const row of r) expect(row.lostTo.length, `${compositionName(row.army)} не проигрывает размен никому`).toBeGreaterThan(0);
  }, 120_000);
});

describe('результат и цена', () => {
  it('победа с непомерными потерями называется прямо и сходится с числами', () => {
    let pyrrhic = 0;
    for (const r of sampleBattles()) {
      const last = r.log[r.log.length - 1];
      expect(last.id === 'result' && last.pyrrhic).toBe(r.pyrrhic);
      if (r.winner === 'draw') {
        expect(r.pyrrhic).toBe(false);
        expect(r.sides.attacker.verdict).toBe('draw');
        expect(r.sides.defender.verdict).toBe('draw');
        continue;
      }
      const w = r.sides[r.winner];
      const l = r.sides[other(r.winner)];
      expect(l.verdict).toBe('defeat');
      // Поле удержано, но потеряно больше противника — это отдельная категория, а не победа.
      const costly = w.total.losses > 0 && l.total.losses / w.total.losses < PYRRHIC_BELOW;
      expect(r.pyrrhic).toBe(costly);
      expect(w.verdict).toBe(costly ? 'pyrrhic' : 'victory');
      if (costly) pyrrhic += 1;
    }
    // Такие бои есть: копья удерживают поле против лучников, теряя вдвое больше.
    expect(pyrrhic).toBeGreaterThan(0);
    const r = simulateBattle({ seed: 1, attacker: quickSetup({ spear: 600 }), defender: quickSetup({ archer: 600 }) });
    expect(r.winner).toBe('attacker');
    expect(r.pyrrhic).toBe(true);
    expect(describeEvent(r.log[r.log.length - 1])).toContain('непомерными потерями');
  });
});

describe('разрыв быстрой атаки', () => {
  it('настроенная армия выигрывает у быстрой атаки 10–25% по потерям на ста боях', () => {
    const { gap } = gapAgainst(TUNED, quickOf, 100);
    expect(gap).toBeGreaterThanOrEqual(0.1);
    expect(gap).toBeLessThanOrEqual(0.25);
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
      // По размену: в каждой паре боёв контрящий теряет меньше, в среднем — заметно меньше.
      let ratio = 0;
      const N = 12;
      for (let seed = 1; seed <= N; seed += 1) {
        const m = mirrored(pair.a, pair.b, seed);
        expect(m.lossRatio).toBeGreaterThanOrEqual(RATIO_EVEN);
        ratio += m.lossRatio;
      }
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

  it('конница против сомкнутых копий проигрывает размен', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const m = mirrored(cavalry, spears('hold-line'), seed);
      expect(m.lossRatio).toBeLessThanOrEqual(1 / RATIO_EVEN);
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

describe('манёвр — только за своей линией', () => {
  // Армия без линии в обходе была недосягаема: по ждущей коннице не стреляют и с ней не сходятся, и вся
  // конница, которая в лоб проигрывала вдвое сильнейшему, «обходом» его била (docs/stable.md, раздел 3).
  const CAV = 600;
  const foe = (k: number): ArmySetup => quickSetup(Object.fromEntries(Object.entries(BALANCED_ARMY).map(([kind, n]) => [kind, Math.round((n ?? 0) * k)])));
  const lineless = (cavalry: ArmySetup['orders']['cavalry']): ArmySetup =>
    quickSetup({ cavalry: CAV }, { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry } });
  const hasLineIn = (setup: ArmySetup): boolean => SECTORS.some((id) => setup.sectors[id].spear + setup.sectors[id].infantry + setup.sectors[id].archer > 0);

  it('армия без линии с манёвром не выигрывает того, что проигрывает в лоб', () => {
    const charge = lineless('charge');
    // Граница: у армии нет ни одного пешего и лучника, и конница стоит на полосах, а не в резерве.
    expect(hasLineIn(charge)).toBe(false);
    expect(FRONT.reduce((n, id) => n + charge.sectors[id].cavalry, 0)).toBe(CAV);
    for (const order of ['flank', 'attack-archers', 'pursue'] as const) {
      const maneuver = lineless(order);
      expect(hasLineIn(maneuver)).toBe(false);
      for (let seed = 1; seed <= 12; seed += 1) {
        const inFront = simulateBattle({ seed, attacker: charge, defender: foe(2) });
        const around = simulateBattle({ seed, attacker: maneuver, defender: foe(2) });
        // Граница: в лоб эта армия бой проигрывает — иначе «не выиграл больше» проверялось бы даром.
        expect(inFront.winner, `${order}, сид ${seed}: в лоб`).toBe('defender');
        expect(around.winner, `${order}, сид ${seed}: без линии манёвра нет`).toBe('defender');
      }
    }
  });

  it('за своей линией манёвр остаётся манёвром', () => {
    // План натиска: охвата у пехоты нет, и заход во фланг может сделать только конница.
    const screened = (cavalry: ArmySetup['orders']['cavalry']): ArmySetup =>
      setupOf({ A: { infantry: 150, cavalry: 100 }, B: { infantry: 200 }, C: { infantry: 150, cavalry: 100 } }, { plan: 'assault', orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry } });
    // Граница: конница стоит на полосах вместе с пехотой — её прикрывают.
    expect(hasLineIn(screened('flank'))).toBe(true);
    const turned = (cavalry: ArmySetup['orders']['cavalry']): number => {
      let n = 0;
      for (let seed = 1; seed <= 6; seed += 1) {
        const r = simulateBattle({ seed, attacker: screened(cavalry), defender: foe(1) });
        n += r.log.filter((e) => e.id === 'flank-turned' && e.by === 'attacker' && e.phase === 'flanking').length;
      }
      return n;
    };
    expect(turned('charge'), 'в лоб во фланг в фазе обходов не заходят').toBe(0);
    expect(turned('flank'), 'за линией обход заходит во фланг').toBeGreaterThan(0);
  });
});

describe('линия по силе', () => {
  // Заслон прикрывал по наличию: сотня латных впереди прятала пятьсот лёгких, и самый тонкий
  // заслон был лучшим — чем меньше латных, тем больше лёгких за ними (docs/stable.md, раздел 12).
  // Теперь линия прикрывает не больше `линия / COVER.K` силы ждущих (`Battle.expose`).
  it('за заслоном тоньше ждущих манёвр не выигрывает от того, что заслон тоньше', () => {
    const foes = compositionLattice().map((a) => quickSetup(a));
    for (const screen of SCREEN_KINDS) {
      const points = screenPoints(screen);
      // Граница области: каждая точка — заслон тоньше ждущих по силе боя, и точек хватает на кривую.
      expect(points.length, screen).toBeGreaterThanOrEqual(3);
      for (const men of points) expect(screenThinner(screen, men), `${screen} ${men}`).toBe(true);
      // Лёгкие ждут на полосах, а не в резерве: иначе заслон их не прикрывал бы вовсе.
      const army = screenArmy(screen, points[0], 'attack-archers');
      expect(army.sectors.R.cavalry + FRONT.reduce((n, id) => n + army.sectors[id].cavalry, 0)).toBe(ARMY_SIZE - points[0]);
      expect(army.sectors.R.cavalry).toBe(0);
      const curve = screenCurve(screen, foes);
      for (let i = 1; i < curve.length; i += 1) {
        expect(curve[i - 1].worth, `${screen}: заслон ${curve[i - 1].men} даёт манёвру больше, чем заслон ${curve[i].men}`).toBeLessThanOrEqual(curve[i].worth);
      }
    }
  }, 120_000);
});

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

  it('перевес в 10% не даёт лавины: размен не выше ≈1.5, у составов без линии — не выше своего потолка', () => {
    // Ограничитель на перекидывание паники: та же армия на 10% больше при прочих равных.
    // Составы без пешей линии рушатся сильнее по замыслу — без якоря сектор и должен рушиться,
    // а кольцо добивает лучников, когда линии нет, — но и у них есть потолок (`OVERSIZE_CAP.noLine`).
    const ratios: number[] = [];
    for (const c of COMPOSITIONS) {
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
      if (!hasLine(c.army)) {
        expect(ratio, `${c.name} (без линии): размен ${ratio.toFixed(2)}`).toBeLessThanOrEqual(OVERSIZE_CAP.noLine);
        continue;
      }
      expect(ratio, `${c.name}: размен ${ratio.toFixed(2)}`).toBeLessThanOrEqual(OVERSIZE_CAP.line);
      ratios.push(ratio);
    }
    expect(ratios.reduce((a, b) => a + b, 0) / ratios.length).toBeLessThanOrEqual(OVERSIZE_CAP.lineMean);
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
    const geared = quickSetup(BALANCED_ARMY, { gear: { spear: GEAR.max, infantry: GEAR.max, archer: GEAR.max, cavalry: GEAR.max, heavy: 0 } });
    let ratio = 0;
    const N = 12;
    for (let seed = 1; seed <= N; seed += 1) {
      const m = mirrored(geared, plain, seed);
      expect(m.lossRatio).toBeGreaterThan(1);
      ratio += m.lossRatio;
    }
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
  // Границы выводятся из фаз, а не записаны числом. Нижняя — самый ранний слом: стрелковая
  // фаза зажата до минимума темпом планов, бой линий и мораль обрываются на своём минимуме,
  // обходы и резерв пропущены, отступление и преследование идут целиком. Верхняя — стрелковая
  // фаза на максимуме и все фазы до конца. Прежде тест держал «50–100»: пятьдесят было неверно
  // (одна «агрессивная атака» против плана с нулевым темпом кончает бой на 48-м тике), и
  // зелёным он оставался только потому, что таких пар в выборке не было; сто — на двадцать
  // тиков выше настоящего максимума, и бой, растянувшийся до ста, прошёл бы.
  const SHORTEST = RANGED_TICKS.min + PHASE_TICKS.approach + PHASE_TICKS.clash + PHASE_MIN.lines! + PHASE_MIN.morale! + PHASE_TICKS.retreat + PHASE_TICKS.pursuit;
  const LONGEST = RANGED_TICKS.max + PHASES.filter((p) => p !== 'ranged').reduce((n, p) => n + PHASE_TICKS[p], 0);

  /** Выборка с крайними темпами: каждая пара планов на нескольких парах составов. */
  function tempoBattles(): BattleResult[] {
    const out: BattleResult[] = [];
    const plans = Object.keys(PLANS) as Plan[];
    for (const a of plans) {
      for (const b of plans) {
        for (const [x, y] of [[0, 0], [4, 6], [0, 2], [2, 3]]) {
          out.push(simulateBattle({ seed: x + y + 1, attacker: { ...COMPOSITIONS[x].setup, plan: a }, defender: { ...COMPOSITIONS[y].setup, plan: b } }));
        }
      }
    }
    return out;
  }

  it('любой бой укладывается в границы фаз, и выборка достаёт до обеих', () => {
    const battles = [...sampleBattles(), ...tempoBattles()];
    // Точки выборки лежат на самих границах: без этого тест проходил бы при любой
    // регрессии в зазоре между выборкой и настоящим пределом.
    expect(battles.some((r) => r.ticks === SHORTEST), `ни один бой не кончился на ${SHORTEST}-м тике`).toBe(true);
    expect(battles.some((r) => r.ticks === LONGEST), `ни один бой не дошёл до ${LONGEST}-го тика`).toBe(true);
    for (const r of battles) {
      expect(r.ticks).toBeGreaterThanOrEqual(SHORTEST);
      expect(r.ticks).toBeLessThanOrEqual(LONGEST);
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

describe('нет доминирующей расстановки', () => {
  // «Всё в один сектор» держало поле против любой разложенной по фронту расстановки: группа
  // в нескольких стычках разом била в полную силу в каждой, и обход умножал силу окружённого.
  // Перебор, на котором прежде стояло «потолок ≈25 %», в репозитории не существовал, — поэтому
  // здесь проверяется ровно то, что тогда пропало: однородные вклады против разложенных.
  const grid = layoutGrid().map((spec) => ({ spec, setup: layoutOf(BALANCED_ARMY, spec) }));

  it('перебор кладёт армию целиком и содержит однородные вклады в один сектор', () => {
    for (const g of grid) expect(armyTotal(g.setup), layoutName(g.spec)).toEqual(stackOf(BALANCED_ARMY));
    const lineIn = (setup: ArmySetup, id: 'A' | 'B'): boolean => setup.sectors[id].infantry + setup.sectors[id].spear === BALANCED_ARMY.infantry! + BALANCED_ARMY.spear!;
    const archersIn = (setup: ArmySetup, id: 'D' | 'E'): boolean => setup.sectors[id].archer === BALANCED_ARMY.archer;
    expect(grid.some((g) => lineIn(g.setup, 'B'))).toBe(true);
    expect(grid.some((g) => lineIn(g.setup, 'A'))).toBe(true);
    expect(grid.some((g) => archersIn(g.setup, 'E'))).toBe(true);
    expect(grid.some((g) => archersIn(g.setup, 'D'))).toBe(true);
    expect(grid.some((g) => lineIn(g.setup, 'B') && archersIn(g.setup, 'E'))).toBe(true);
    // Признак однородности читает поле, а не имя оси.
    for (const g of grid) {
      const oneFront = FRONT.filter((id) => g.setup.sectors[id].infantry + g.setup.sectors[id].spear > 0).length === 1;
      const oneRear = REAR.filter((id) => g.setup.sectors[id].archer > 0).length === 1;
      expect(homogeneous(g.setup), layoutName(g.spec)).toBe(oneFront || oneRear);
    }
  });

  it('всё в один сектор не держит поле против всех разложенных расстановок', () => {
    // Кандидаты — пешая линия целиком в центре, с планами и конницей, при которых до правки
    // она держала поле против каждой разложенной расстановки; соперники — каждая шестнадцатая
    // разложенная расстановка сетки, того же состава и числа людей.
    const plans: Plan[] = ['assault', 'aggressive', 'defense'];
    const candidates = grid.filter(
      (g) =>
        g.spec.line === 'всё в центр' &&
        g.spec.reserve === 'immediate' &&
        plans.includes(g.spec.plan) &&
        (g.spec.archers === 'во фронте' || g.spec.archers === 'всё за центром') &&
        g.spec.cavalry !== 'фронт ровно' &&
        g.spec.cavalry !== 'резерв: обход',
    );
    const opponents = grid.filter((g) => !homogeneous(g.setup)).filter((_, i) => i % 16 === 0);
    expect(candidates.length).toBe(18);
    expect(opponents.length).toBeGreaterThanOrEqual(25);
    for (const c of candidates) expect(homogeneous(c.setup), layoutName(c.spec)).toBe(true);
    for (const o of opponents) expect(armyTotal(o.setup)).toEqual(armyTotal(candidates[0].setup));
    for (const c of candidates) {
      let held = 0;
      opponents.forEach((o, i) => {
        const attacks = i % 2 === 0;
        const r = simulateBattle({ seed: i + 1, attacker: attacks ? c.setup : o.setup, defender: attacks ? o.setup : c.setup });
        if (r.winner === (attacks ? 'attacker' : 'defender')) held += 1;
      });
      expect(held, `«${layoutName(c.spec)}» держит поле против всех ${opponents.length} разложенных расстановок`).toBeLessThan(opponents.length);
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
            expect(horse(r.sides[other(e.side)].initial)).toBeGreaterThan(0);
            expect(e.cavalryLost).toBeLessThanOrEqual(horse(r.sides[other(e.side)].losses));
            expect(e.cavalryLost).toBeGreaterThanOrEqual(e.spearsLost);
            break;
          case 'cavalry-broke-archers':
            expect(horse(r.sides[e.side].initial)).toBeGreaterThan(0);
            expect(e.archersLost).toBeLessThanOrEqual(r.sides[other(e.side)].losses.archer);
            break;
          case 'cavalry-intercepted':
            expect(horse(r.sides[e.side].initial)).toBeGreaterThan(0);
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
            expect(initialOf(e.side, 'R') > 0 || horse(r.sides[e.side].initial) > 0).toBe(true);
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
