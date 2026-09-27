// Раздел 16 документа — это список тестов. Здесь они все, кроме тех, что ушли с раскладкой
// (docs/battle_eu4.md, 14.5): доминирующего состава нет, кольцо работает, превосходство условно,
// бой детерминирован, укладывается в границы, выведенные из фаз, а журнал объясняет исход и
// не врёт числам. Все стороны встают по правилу развёртывания (`setup.deploySetup`).
import { describe, expect, it } from 'vitest';
import { ringMult, simulateBattle, standing } from './sim';
import { deploySetup, armyTotal, emptyStack, stackTotal, stackOf } from './setup';
import { describeEvent } from './log';
import { ANNIHILATED_AT, BREAK_AFTER, COUNTER, DICE, BASE_CIRCLES, CIRCLE_MELEE, CIRCLE_PHASES, FRONT_WIDTH, GEAR, MELEE_RATE, MORALE, PHASE_MIN, PHASE_PIP, PHASE_TICKS, PYRRHIC_BELOW, TEMPER, INTO_LINES, circleLength, circleMin, circleTicks, meleeTicksOf, UNIT_STATS, roundsCap } from './config';
import { ARMY_AT_W, ARMY_SIZE, BALANCED_ARMY, COMPOSITIONS, LATTICE_STEP, compositionLattice, compositionName, latticeDuels, type LatticeRow, OVERSIZE_CAP, OVERSIZE_SEEDS, OVERSIZE_SIZES, RATIO_EVEN, RING, hasLine, holdSize, laneFront, lossRatio, mirrored, openFront, oversize, oversizeHold, scaleArmy, setupOf, standstill, withDiceStep } from './bench';
import { KEYS_MAX, summarize } from './report';
import { FRONT, HORSE_KINDS, PHASES, PIP_IDS, SECTORS, UNIT_KINDS, type ArmySetup, type BattleEvent, type BattleResult, type PipId, type Side, type Stack, type Winner } from './types';

const other = (s: Side): Side => (s === 'attacker' ? 'defender' : 'attacker');
/**
 * Глубина меньшей по ней стороны — вся армия к трём полосам ширины фронта; от неё потолок кругов сечи
 * (`roundsCap`). Ширина — та, что у боя: своя (`width`) или ширина фронта.
 */
const depthOf = (r: BattleResult, width = FRONT_WIDTH): number =>
  Math.min(r.sides.attacker.total.initial, r.sides.defender.total.initial) / (FRONT.length * width);

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
  { name: 'толпа против горстки', attacker: deploySetup({ infantry: 1000 }), defender: deploySetup({ spear: 10 }) },
  { name: 'горстка против толпы', attacker: deploySetup({ archer: 5 }), defender: deploySetup({ cavalry: 900, infantry: 300 }) },
  { name: 'один на один', attacker: deploySetup({ infantry: 1 }), defender: deploySetup({ spear: 1 }) },
  { name: 'только лучники с обеих сторон', attacker: deploySetup({ archer: 300 }), defender: deploySetup({ archer: 300 }) },
  { name: 'только конница с обеих сторон', attacker: deploySetup({ cavalry: 300 }), defender: deploySetup({ cavalry: 300 }) },
  // Широкий строй против узкого: у узкого пустые края, и широкий заходит ему во фланг.
  { name: 'широкий строй против узкого', attacker: deploySetup({ infantry: 400, cavalry: 150, archer: 100 }), defender: deploySetup({ spear: 150, archer: 100 }) },
  // Раскладка руками — так до поставки 2 стоит оборона игрока: сектора шире W и резерв.
  {
    name: 'своя раскладка против правила',
    attacker: setupOf({ A: { spear: 100 }, B: { infantry: 300 }, C: { spear: 100 }, D: { archer: 50 }, E: { archer: 100 }, F: { archer: 50 }, R: { cavalry: 80 } }),
    defender: deploySetup({ infantry: 400, cavalry: 160, archer: 100 }),
  },
];

function sampleBattles(): BattleResult[] {
  const out: BattleResult[] = [];
  for (const p of allPairs(2)) out.push(...p.results);
  for (const e of EXTREMES) for (const seed of [1, 2, 3]) out.push(simulateBattle({ seed, attacker: e.attacker, defender: e.defender }));
  for (const r of RING) out.push(simulateBattle({ seed: 5, attacker: r.a, defender: r.b }));
  return out;
}

describe('вход боя', () => {
  it('пустая армия не принимается', () => {
    expect(() => simulateBattle({ seed: 1, attacker: deploySetup({}), defender: deploySetup({ spear: 1 }) })).toThrow();
  });

  it('у стороны нет ни плана, ни приказов, ни условия резерва: только сектора и то, с чем войско вышло', () => {
    // Решения игрока в бою — состав и кто ведёт, как у EU4 (docs/battle_eu4.md, 14.1): где кто встанет, решает правило.
    expect(Object.keys(deploySetup(BALANCED_ARMY))).toEqual(['sectors']);
    expect(armyTotal(deploySetup(BALANCED_ARMY))).toEqual(stackOf(BALANCED_ARMY));
  });
});

describe('нет доминирующего состава', () => {
  // Противники — вся решётка составов (`bench.compositionLattice`), а не список, подобранный
  // руками: список не содержит того, кто доминирует, и промахивается мимо тех, кто его бьёт. Порог — по
  // размену, не по доле побед: поле держит тот, у кого дольше мораль, а платить за него можно
  // больше, чем за поражение. Все встают по правилу развёртывания — расстановку решётка не выбирает.
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
    let named: BattleResult | null = null;
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
      if (costly) {
        pyrrhic += 1;
        named ??= r;
      }
    }
    // Такие бои есть — чаще всего копья, удержавшие поле дороже противника, — и итог называет их прямо. Пример берётся
    // из самой выборки, а не из заранее выбранной пары: какая пара платит за поле, решает баланс, а правило — одно.
    expect(pyrrhic).toBeGreaterThan(0);
    expect(describeEvent(named!.log[named!.log.length - 1])).toContain('непомерными потерями');
  });
});

describe('кольцо контрров', () => {
  // «Лучники бьют копья» — КРАСНЫЙ с шага C поставки 1, честно: размен по сидам ниже 1.05. Кольцо — наше, у EU4 его нет;
  // решается на пересмотре баланса после поставки 5, до перемера мира (слово владельца, docs/battle_eu4.md, 14.24).
  // Порог не трогается. Числа —
  // `battle:report`, «Кольцо контрров»: с шагом 0.0928 до снятия паники 1.06 (по сидам 0.76–1.34), после — 1.00
  // (0.70–1.28); с выведенным шагом 0.0265 — 0.94 (0.87–1.03). Поле в этой паре у копий всегда; лучники «бьют» только
  // разменом. Почему снятие паники ударило по лучникам (14.22): паника в этой паре была только у лучников — строй
  // лучников стоит во второй линии без прикрытия, копья до него доходят, и первый сломавшийся сектор лучников валил
  // соседей, строй уходил с поля разом и рукопашную, где лучники беспомощны, обрывал. Без паники каждый сектор лучников
  // стоит в рукопашной до своего нуля — лучники теряют больше, а копья от стрел — почти столько же.
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
  const cavalry = deploySetup({ cavalry: ARMY_SIZE });
  const spears = deploySetup({ spear: ARMY_SIZE });

  it('конница против сомкнутых копий проигрывает размен', () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      const m = mirrored(cavalry, spears, seed);
      expect(m.lossRatio).toBeLessThanOrEqual(1 / RATIO_EVEN);
    }
  });

  it('копья держат конницу, пока не обойдены: обойдённые и смятые теряют упор — условие положение, а не приказ', () => {
    // Новый тест 8 поставки 1 (docs/battle_eu4.md, 14.5; Е17): сомкнутость копий — положение. Кольцо читает его
    // одной функцией (`sim.ringMult`), и граница области — оба рода конницы и обе стороны удара.
    for (const horse of ['cavalry', 'heavy'] as const) {
      expect(ringMult('spear', horse, false, false, false, false), `${horse}: сомкнутые копья`).toBe(COUNTER.spear.cavalryHolding);
      expect(ringMult('spear', horse, false, true, false, false), `${horse}: обойдённые или смятые копья`).toBe(1);
      expect(ringMult(horse, 'spear', false, false, false, false), `${horse} в лоб по сомкнутым`).toBe(COUNTER[horse].spearClosed);
      expect(ringMult(horse, 'spear', false, false, false, true), `${horse} по смятым`).toBe(1);
      expect(ringMult(horse, 'spear', true, false, false, false), `${horse} во фланг`).toBe(COUNTER[horse].flank);
    }
    expect(COUNTER.spear.cavalryHolding).toBeGreaterThan(1);
    // Приказа у стороны нет вовсе — значит, и сомкнутость не может от него зависеть.
    expect('orders' in spears).toBe(false);
  });

  it('лучники после контакта резко теряют ценность', () => {
    const shooters = setupOf({ A: { infantry: 100 }, B: { infantry: 200 }, C: { infantry: 100 }, D: { archer: 60 }, E: { archer: 80 }, F: { archer: 60 } });
    const wall = deploySetup({ infantry: 600 });
    for (let seed = 1; seed <= 4; seed += 1) {
      const r = simulateBattle({ seed, attacker: shooters, defender: wall });
      const clash = r.phases.find((p) => p.phase === 'clash')!;
      // Стрельба идёт до самого преследования: окно — от первого столкновения до конца отступления, кроме сближений
      // кругов — там линии разошлись, контакта нет, и лучники бьют в полную силу (правило круга, а не этого теста).
      // У стены лучников нет, поэтому всё, что она потеряла в сближении круга, выбито стрелами этого сближения.
      const retreat = r.phases.find((p) => p.phase === 'retreat')!;
      const apart = r.phases.filter((p) => p.round !== undefined && (p.phase === 'ranged' || p.phase === 'approach'));
      const apartShots = apart.reduce((n, p) => n + p.losses.defender, 0);
      const apartTicks = apart.reduce((n, p) => n + p.to - p.from + 1, 0);
      expect(r.sides.defender.initial.archer, 'у стены лучников нет').toBe(0);
      const before = r.sides.attacker.rangedBeforeContact / (clash.from - 1);
      const after = (r.sides.attacker.rangedTotal - r.sides.attacker.rangedBeforeContact - apartShots) / (retreat.to - clash.from + 1 - apartTicks);
      expect(before).toBeGreaterThan(0);
      expect(after).toBeLessThan(before * 0.5);
    }
    expect(COUNTER.archer.afterContact).toBeLessThan(0.5);
  });
});

/**
 * Гонг — потолок кругов сечи (`roundsCap`): бой дошёл до него, не сломав никого. До кругов гонгом был конец
 * первого прохода, и досрочным считался бой короче его; теперь сеча идёт кругами, пока кто-то не сломается,
 * и досрочен всякий бой, кончившийся сломом.
 */
const atGong = (r: BattleResult): boolean => r.log.some((e) => e.id === 'rounds-out');
const endedEarly = (r: BattleResult): boolean => !atGong(r);

/**
 * Бои, которые доходят до потолка кругов, дерясь (docs/battle_eu4.md, 14.25). Пока обходящие не дрались с обходящими,
 * до потолка доходили стоянием — и почти только им: у обеих сторон в строю оставались обходящие, друг до друга не
 * достававшие. Стояния нет — и почти всё доламывается раньше потолка; пары, которые доходят до него в драке, найдены
 * перебором решётки составов на ½W (сиды 1–2, обе стороны поля). Держит их не расчёт, а утверждения «дошли до потолка»
 * в тестах, которые их берут: сменится правило и утверждение упадёт — пары искать заново, а не двигать границу.
 */
const GONG_PAIRS: ReadonlyArray<readonly [Partial<Stack>, Partial<Stack>]> = [
  [{ spear: 300, archer: 300 }, { infantry: 450, archer: 150 }],
  [{ spear: 150, infantry: 300, archer: 150 }, { spear: 300, archer: 300 }],
];
function gongBattles(): BattleResult[] {
  const out: BattleResult[] = [];
  const half = OVERSIZE_SIZES[0];
  for (const [a, b] of GONG_PAIRS) {
    for (const [x, y] of [[a, b], [b, a]]) {
      for (let seed = 1; seed <= 2; seed += 1) out.push(simulateBattle({ seed, attacker: deploySetup(scaleArmy(x, half)), defender: deploySetup(scaleArmy(y, half)) }));
    }
  }
  return out;
}

describe('мораль по секторам', () => {
  it('бой обычно кончается отступлением, а не гонгом', () => {
    // Раньше 87% боёв шли до потолка тиков, а победителя объявляли по тому, кто впереди. Теперь сектора
    // бегут, резерв встаёт на их место, и армия отступает сама, когда встать некому: досрочный конец — норма,
    // ничья — редкость.
    // Гонг с кругами сечи — их потолок; сколько боёв до него доходит на размерах с шириной, держит
    // «круги сечи» → «ничья — редкий исход».
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
    // Ограничитель лавины: та же армия на 10% больше при прочих равных. Паники на соседей больше нет (14.21), но
    // потолки размена — числа теста, а не ручка: покрасневший выносится владельцу.
    // КРАСНЫЙ с записи выведенного шага 0.0265 (14.22), честно: «пехота+луки» — размен 1.64 при потолке 1.6 (с шагом
    // 0.0928 — 1.50); остальные составы с линией — не выше 1.47, в среднем ниже 1.5 (`battle:report`, «Ограничитель»).
    // Меньше кость — меньше удачи у меньшей стороны, и перевес в 10 % копится. Решается на пересмотре баланса после
    // поставки 5, до перемера мира (docs/battle_eu4.md, 14.24), не подгонкой потолка.
    // Составы без пешей линии рушатся сильнее по замыслу — без якоря сектор и должен рушиться,
    // а кольцо добивает лучников, когда линии нет, — но и у них есть потолок (`OVERSIZE_CAP.noLine`).
    //
    // Меряется там же и той же функцией, что раздел «Ограничитель» `battle:report` и доля кости: на размере W
    // (`holdSize`), где сбалансированный состав ставит в полосу ровно ширину фронта, — решение владельца
    // (26.09.2026): тест и отчёт мерят одно и то же. Прежде тест мерил на 600, ниже ширины.
    expect(holdSize(), 'размер W').toBe(ARMY_AT_W);
    const balanced = COMPOSITIONS.findIndex((c) => stackTotal(stackOf(c.army)) === ARMY_SIZE && UNIT_KINDS.every((k) => (c.army[k] ?? 0) === (BALANCED_ARMY[k] ?? 0)));
    // Граница области: на этом размере фронт полосы сбалансированного состава и есть ширина — ровно на ней.
    expect(Math.abs(openFront(scaleArmy(COMPOSITIONS[balanced].army, holdSize())) - FRONT_WIDTH), 'фронт полосы без ширины на размере W').toBeLessThan(1);
    expect(Math.abs(laneFront(deploySetup(scaleArmy(COMPOSITIONS[balanced].army, holdSize()))) - FRONT_WIDTH), 'фронт полосы на размере W').toBeLessThan(1);
    const ratios: number[] = [];
    for (const [i, c] of COMPOSITIONS.entries()) {
      const { bigLoss, smallLoss } = oversize(i, OVERSIZE_SEEDS, holdSize());
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

  it('паники на соседей нет: полоса рядом с бежавшим идёт так же, как без соседа', () => {
    // Поставка 1 (docs/battle_eu4.md, 14.21): как у EU4, каждый сектор отходит сам, по своей морали, — бегство соседа
    // мораль не трогает. Прежний тест «сломанный сектор тянет соседей» держал обратное и ушёл вместе с паникой.
    //
    // Полоса центра — одна и та же в двух боях. В первом слева у нападающего горстка, которую противник вырубает
    // первой, а позади неё тыл: он держит полосу занятой, иначе победитель слева пошёл бы обходом на центр (К5). Во
    // втором боя слева нет вовсе. Ряды не шире W — резерва нет ни у кого; лучников нет — ни стрельбы через полосу, ни
    // проигранной перестрелки; конницы нет — никто не дотянется из полосы в полосу. Всё, что связывает полосы, кроме
    // паники, выключено, и пока никто больше не побежал, центр обязан идти одинаково — фаза в фазу.
    const center = { B: { infantry: 120 } };
    const beside = { attacker: setupOf({ ...center, A: { infantry: 30 }, D: { infantry: 150 } }), defender: setupOf({ ...center, C: { infantry: 150 } }) };
    const alone = { attacker: setupOf(center), defender: setupOf(center) };
    let checked = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const r = simulateBattle({ seed, ...beside });
      const c = simulateBattle({ seed, ...alone });
      const rout = r.log.find((e) => e.id === 'sector-broken' && e.side === 'attacker' && e.sector === 'A');
      // Граница области: горстка побежала — и из первой линии, а не смятой в тыл: из тыла соседом центра она не была.
      expect(rout, `сид ${seed}: горстка слева не побежала`).toBeDefined();
      expect(
        r.log.some((e) => e.id === 'sector-collapsed' && e.side === 'attacker' && e.sector === 'A' && e.tick <= rout!.tick),
        `сид ${seed}: горстка смята в тыл до бегства`,
      ).toBe(false);
      // Конец окна — всё, что связывает полосы помимо паники: бегство кого-то ещё в любом из двух боёв или слом стороны.
      const others = [...r.log.filter((e) => e.id === 'sector-broken' && e !== rout), ...c.log.filter((e) => e.id === 'sector-broken')].map((e) => e.tick);
      const broken = [r, c].flatMap((x) => [x.sides.attacker.brokenAt ?? Infinity, x.sides.defender.brokenAt ?? Infinity]);
      const until = Math.min(...others, ...broken);
      const window = r.phases.filter((p) => p.to < until);
      // Граница области: горстка бежала внутри окна, и после её бегства в окне есть фаза, где центр дрался.
      const fought = window.filter((p) => p.to > rout!.tick && ((p.bySector?.attacker?.B ?? 0) > 0 || (p.bySector?.defender?.B ?? 0) > 0));
      if (rout!.tick >= until || fought.length === 0) continue;
      window.forEach((p, i) => {
        const q = c.phases[i];
        expect([q.phase, q.from, q.to], `сид ${seed}: фазы разошлись`).toEqual([p.phase, p.from, p.to]);
        for (const side of ['attacker', 'defender'] as const) {
          expect(
            p.bySector?.[side]?.B ?? 0,
            `сид ${seed}: ${side}/B в фазе «${p.phase}» (тики ${p.from}–${p.to}); горстка бежала на ${rout!.tick}-м — центр рядом с бежавшим пошёл иначе, чем без соседа`,
          ).toBe(q.bySector?.[side]?.B ?? 0);
        }
      });
      checked += 1;
    }
    expect(checked, 'боёв, где после бегства горстки центр ещё дрался в окне').toBeGreaterThan(0);
  });

  it('якорь: сектор с пехотой держит мораль дольше, чем без неё', () => {
    const wall = deploySetup({ infantry: 600 });
    const bare = setupOf({ A: { spear: 150 }, B: { spear: 300 }, C: { spear: 150 } });
    const anchoredLine = setupOf({ A: { spear: 110, infantry: 40 }, B: { spear: 220, infantry: 80 }, C: { spear: 110, infantry: 40 } });
    let bareBreak = 0;
    let anchoredBreak = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const firstBreak = (r: BattleResult): number => r.log.find((e) => e.id === 'sector-broken' && e.side === 'attacker')?.tick ?? r.ticks + 1;
      bareBreak += firstBreak(simulateBattle({ seed, attacker: bare, defender: wall }));
      anchoredBreak += firstBreak(simulateBattle({ seed, attacker: anchoredLine, defender: wall }));
    }
    expect(anchoredBreak).toBeGreaterThan(bareBreak);
    expect(MORALE.anchor).toBeLessThan(1);
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
    // Был красным с поставки 1 до снятия паники (14.21): один сид из двенадцати давал размен 0.996 при нужном > 1.
    const plain = deploySetup(BALANCED_ARMY);
    const geared = { ...deploySetup(BALANCED_ARMY), gear: { spear: GEAR.max, infantry: GEAR.max, archer: GEAR.max, cavalry: GEAR.max, heavy: 0 } };
    let ratio = 0;
    const N = 12;
    for (let seed = 1; seed <= N; seed += 1) {
      const m = mirrored(geared, plain, seed);
      expect(m.lossRatio).toBeGreaterThan(1);
      ratio += m.lossRatio;
    }
    expect(ratio / N).toBeGreaterThan(1.1);
    // Ступень выше потолка не даёт больше потолка.
    const capped = simulateBattle({ seed: 1, attacker: { ...deploySetup(BALANCED_ARMY), gear: { infantry: 99 } }, defender: plain });
    const max = simulateBattle({ seed: 1, attacker: { ...deploySetup(BALANCED_ARMY), gear: { infantry: GEAR.max } }, defender: plain });
    expect(JSON.stringify(capped.sides)).toBe(JSON.stringify(max.sides));
  });

  it('копейщики стойки, пока сомкнуты, и ломки под ударом во фланг', () => {
    // Сомкнутые против обойдённых, а не приказы: приказа «наступать» больше нет, сомкнутость — положение (Е17).
    expect(TEMPER.spear.holding).toBeLessThan(TEMPER.spear.advancing);
    expect(TEMPER.spear.advancing).toBeLessThan(TEMPER.spear.flanked);
    // Узкие копья в центре против пехоты той же численности: ряд копий шириной с ряд пехоты — лоб в лоб, а ряд пехоты
    // шире — её свес приходит копьям во фланг (дальность пешего — своя полоса, 14.5). Лишняя пехота лоб в лоб стоит в
    // полосе, где противника нет, — пешим оттуда никого не достать. Числа ниже ширины: резерва нет ни у кого.
    const narrow = FRONT_WIDTH - 42;
    const spears = setupOf({ B: { spear: narrow } });
    const frontal = setupOf({ A: { infantry: 42 }, B: { infantry: narrow } });
    const wide = setupOf({ B: { infantry: FRONT_WIDTH } });
    let head = 0;
    let turned = 0;
    // Мера — когда копья побежали: побежавшие уходят с поля, и мораль к концу боя у них ноль при любом исходе.
    const firstBreak = (r: BattleResult): number => r.log.find((e) => e.id === 'sector-broken' && e.side === 'attacker')?.tick ?? r.ticks + 1;
    for (let seed = 1; seed <= 6; seed += 1) {
      const f = simulateBattle({ seed, attacker: spears, defender: frontal });
      const w = simulateBattle({ seed, attacker: spears, defender: wide });
      // Граница: во втором бою копья правда обошли, в первом — нет.
      expect(w.log.some((e) => e.id === 'flank-turned' && e.side === 'attacker'), `сид ${seed}: обход`).toBe(true);
      expect(f.log.some((e) => e.id === 'flank-turned' && e.side === 'attacker'), `сид ${seed}: лоб в лоб`).toBe(false);
      head += firstBreak(f);
      turned += firstBreak(w);
    }
    expect(head).toBeGreaterThan(turned);
  });

  it('конница высока на разгоне, но хрупка, когда её остановили', () => {
    expect(TEMPER.cavalry.charging).toBeLessThan(TEMPER.cavalry.stalled);
    // Конница, вставшая во фронт против стены пехоты, ломается сама; та же конница в обходе — нет.
    const wall = deploySetup({ infantry: 400 });
    const stalled = setupOf({ A: { cavalry: 60 }, B: { cavalry: 80 }, C: { cavalry: 60 } });
    let broken = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const r = simulateBattle({ seed, attacker: stalled, defender: wall });
      if (r.log.some((e) => e.id === 'sector-broken' && e.side === 'attacker')) broken += 1;
    }
    expect(broken).toBeGreaterThanOrEqual(5);
  });

  it('лучники в рукопашной ломаются быстро', () => {
    expect(TEMPER.archer.melee).toBeGreaterThan(TEMPER.archer.shooting);
    // Армии — ровно в две ширины фронта, и не больше: правило развёртывания ставит в ряд не больше W. Порог «12 тиков»
    // снят без ширины; при рядах шире W ширина зажимает обе стороны, слом приходит позже, и тест мерил бы
    // ширину, а не характер лучников — так было на 400 против 400 (решение владельца 26.09.2026,
    // docs/battle_eu4.md, раздел 10). Не «чинить» обратно ни размером, ни порогом.
    const men = 2 * FRONT_WIDTH;
    const archers = deploySetup({ archer: men });
    const wall = deploySetup({ infantry: men });
    // Граница области: ни один ряд обеих сторон не шире W — ширине здесь нечего зажимать.
    for (const setup of [archers, wall]) for (const id of SECTORS) expect(stackTotal(setup.sectors[id]), id).toBeLessThanOrEqual(FRONT_WIDTH);
    for (let seed = 1; seed <= 4; seed += 1) {
      const r = simulateBattle({ seed, attacker: archers, defender: wall });
      expect(r.log.some((e) => e.id === 'depth'), 'ряд шире фронта — тест мерил бы ширину').toBe(false);
      const clash = r.phases.find((p) => p.phase === 'clash')!;
      const firstBreak = r.log.find((e) => e.id === 'sector-broken' && e.side === 'attacker');
      expect(firstBreak).toBeDefined();
      expect(firstBreak!.tick - clash.from).toBeLessThanOrEqual(12);
    }
  });
});

describe('детерминированность', () => {
  it('один вход и сид — один исход и один журнал', () => {
    const input = { seed: 4242, attacker: deploySetup(BALANCED_ARMY), defender: COMPOSITIONS[5].setup };
    const snapshot = JSON.stringify(input);
    const a = simulateBattle(input);
    const b = simulateBattle(JSON.parse(snapshot));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.log).toEqual(b.log);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('другой сид меняет ход боя, но не его форму', () => {
    const a = simulateBattle({ seed: 1, attacker: deploySetup(BALANCED_ARMY), defender: COMPOSITIONS[5].setup });
    const b = simulateBattle({ seed: 2, attacker: deploySetup(BALANCED_ARMY), defender: COMPOSITIONS[5].setup });
    expect(JSON.stringify({ ...a, seed: 0 })).not.toBe(JSON.stringify({ ...b, seed: 0 }));
    // Форма — обязательные фазы первого прохода в том же порядке; обходы и резерв бой вправе пропустить, если
    // сторона сломалась раньше, а круги сечи (`round`) — ход боя: сколько их, решает то, когда кто-то сломается.
    const must = (r: BattleResult): string[] =>
      r.phases.filter((p) => p.round === undefined).map((p) => p.phase).filter((p) => p !== 'flanking' && p !== 'reserve');
    expect(must(a)).toEqual(must(b));
  });
});

describe('продолжительность', () => {
  // Границы выводятся из фаз, а не записаны числом. Нижняя — самый ранний слом: бой линий и мораль обрываются на
  // своём минимуме, обходы и резерв пропущены, отступление и преследование идут целиком. Самый ранний слом с минимумом
  // боя EU4 (`BREAK_AFTER`, 14.21) — истребление: моралью раньше конца сшибки второго круга не ломается никто, а
  // перебитую сторону минимум не держит. Верхняя — все фазы до конца.
  // Стрельба — ровно `PHASE_TICKS.ranged` тиков на бой: темп планов, который её двигал, ушёл с планами (14.5).
  //
  // Бой идёт кругами всем боем (`CIRCLE_PHASES`), и границы выводятся из долей круга: нижняя — первый круг с боем
  // линий и моралью на своих минимумах, отход и погоня; верхняя — у каждого боя своя: все круги до потолка
  // (`roundsCap` от глубины меньшей по ней стороны).
  const SHORTEST =
    circleTicks('ranged', 1) + circleTicks('approach', 1) + circleTicks('clash', 1) + circleMin('lines', 1) + PHASE_TICKS.retreat + PHASE_TICKS.pursuit;
  const longest = (r: BattleResult): number =>
    Array.from({ length: roundsCap(depthOf(r)) + 1 }, (_, i) => circleLength(i + 1)).reduce((n, t) => n + t, 0) + PHASE_TICKS.retreat + PHASE_TICKS.pursuit;

  // Верхняя граница: до неё доходит только бой, дошедший до потолка кругов (`gongBattles`). Прежде пары искались
  // перебором составов бенча на ½W, и до потолка они доходили стоянием; с тех пор как обходящие дерутся с обходящими
  // (14.25), ни одна из них до него не доходит, и пары найдены заново — на решётке составов, а не сдвигом границы.

  it('любой бой укладывается в границы фаз, и выборка достаёт до обеих', () => {
    const battles = [...sampleBattles(), ...gongBattles()];
    // Точки выборки лежат на самих границах: без этого тест проходил бы при любой
    // регрессии в зазоре между выборкой и настоящим пределом.
    expect(battles.some((r) => r.ticks === SHORTEST), `ни один бой не кончился на ${SHORTEST}-м тике`).toBe(true);
    const top = Math.max(...battles.filter((r) => r.ticks < longest(r)).map((r) => r.ticks));
    expect(battles.some((r) => r.ticks === longest(r)), `ни один бой не дошёл до своей верхней границы; дальше всех — ${top} тиков`).toBe(true);
    for (const r of battles) {
      expect(r.ticks).toBeGreaterThanOrEqual(SHORTEST);
      expect(r.ticks).toBeLessThanOrEqual(longest(r));
      let next = 1;
      for (const span of r.phases) {
        expect(span.from).toBe(next);
        expect(span.to).toBeGreaterThanOrEqual(span.from);
        next = span.to + 1;
      }
      expect(next - 1).toBe(r.ticks);
      // Первый круг идёт в объявленном порядке; пропущенные — только между боем линий и моралью. Круги за ним —
      // по счёту, каждый в том же порядке; целиком — все, кроме последнего: в нём кто-то сломался, и он мог
      // пропустить обходы и резерв. Отступление и погоня — после кругов.
      const first = r.phases.filter((p) => p.round === undefined);
      const order = first.map((p) => PHASES.indexOf(p.phase));
      for (let i = 1; i < order.length; i += 1) expect(order[i]).toBeGreaterThan(order[i - 1]);
      for (const must of ['ranged', 'approach', 'clash', 'lines', 'retreat', 'pursuit']) {
        expect(first.some((p) => p.phase === must), must).toBe(true);
      }
      const tagged = r.phases.filter((p) => p.round !== undefined);
      const count = tagged.length ? tagged[tagged.length - 1].round! - 1 : 0;
      for (let k = 2; k <= count + 1; k += 1) {
        const circle = tagged.filter((p) => p.round === k).map((p) => CIRCLE_PHASES.indexOf(p.phase));
        expect(circle.length, `круг ${k}`).toBeGreaterThan(0);
        for (let i = 1; i < circle.length; i += 1) expect(circle[i]).toBeGreaterThan(circle[i - 1]);
        if (k <= count) expect(circle.length, `круг ${k} не последний — целиком`).toBe(CIRCLE_PHASES.length);
      }
      expect(tagged.map((p) => p.round!)).toEqual([...tagged.map((p) => p.round!)].sort((a, b) => a - b));
    }
  });
});

describe('круги сечи', () => {
  // Бой — круги всем боем (`CIRCLE_PHASES`): обстрел, сшибка, сеча, с новой костью, пока кто-то не сломается, но
  // не больше потолка (`roundsCap`). Ничья бывает только на потолке, и потолок обязан быть
  // редким: «бой обязан кончаться тем, что кто-то сломался» (решение владельца, docs/battle_eu4.md, пачка 3).
  /** Бои «Ограничителя» (большая на 10 %) в `total` бойцов строя с шириной `width`: `seeds` сидов на состав. */
  function oversized(total: number, width: number, seeds: number): Array<{ r: BattleResult; width: number; name: string }> {
    const out: Array<{ r: BattleResult; width: number; name: string }> = [];
    for (const c of COMPOSITIONS) {
      const army = scaleArmy(c.army, total);
      const small = deploySetup(army, width);
      const big = deploySetup(Object.fromEntries(Object.entries(army).map(([k, n]) => [k, Math.round((n ?? 0) * 1.1)])), width);
      for (let seed = 1; seed <= seeds; seed += 1) {
        const bigAttacks = seed % 2 === 1;
        const r = simulateBattle({ seed, attacker: bigAttacks ? big : small, defender: bigAttacks ? small : big, width });
        out.push({ r, width, name: `«Ограничитель» ${total}, ${c.name}, сид ${seed}` });
      }
    }
    return out;
  }

  it('потолок выведен, а не выбран: столько кругов, чтобы ровному фронту хватило сечи сломать меньшую сторону одними потерями', () => {
    // Круг — обстрел (стрельба, сближение), сшибка, сеча (бой линий); сеча — всё с первого удара. Обходы, ввод
    // резерва и падение морали фазами больше не идут: их тики — в бою линий (`INTO_LINES`, поставка 1).
    expect(CIRCLE_PHASES).toEqual(['ranged', 'approach', 'clash', 'lines']);
    expect(CIRCLE_MELEE).toEqual(CIRCLE_PHASES.slice(CIRCLE_PHASES.indexOf('clash')));
    expect(INTO_LINES).toEqual(['flanking', 'reserve', 'morale']);
    // Длины — из прежнего боя в один проход: каждая фаза делится на три круга без остатка и без прибавки, сшибка
    // повторяется целиком в каждом круге; дальше круги идут как третий.
    expect(BASE_CIRCLES).toBe(3);
    for (const p of CIRCLE_PHASES) {
      const first = Array.from({ length: BASE_CIRCLES }, (_, i) => circleTicks(p, i + 1)).reduce((n, t) => n + t, 0);
      const whole = p === 'lines' ? PHASE_TICKS.lines + INTO_LINES.reduce((n, q) => n + PHASE_TICKS[q], 0) : PHASE_TICKS[p];
      expect(first, p).toBe(p === 'clash' ? BASE_CIRCLES * PHASE_TICKS.clash : whole);
      expect(circleTicks(p, BASE_CIRCLES + 2), `${p} после трёх кругов`).toBe(circleTicks(p, BASE_CIRCLES));
      expect(circleTicks(p, BASE_CIRCLES), `${p}: доля не меньше единицы`).toBeGreaterThan(0);
      const min = PHASE_MIN[p];
      if (min !== undefined) expect(Array.from({ length: BASE_CIRCLES }, (_, i) => circleMin(p, i + 1)).reduce((n, t) => n + t, 0), `${p}: минимум`).toBe(min);
    }
    let prev = 0;
    const melee = (circles: number): number => Array.from({ length: circles }, (_, i) => meleeTicksOf(i + 1)).reduce((n, t) => n + t, 0);
    for (const depth of [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12]) {
      // Ровный фронт в полную силу выбивает долю `MELEE_RATE` за тик: армия глубины `depth` выбита целиком за столько
      // тиков сечи. Потолок — наименьшее число кругов сверх первого, при котором их хватает.
      // Целиком: автослома при 65 % потерь больше нет (14.19.5), и опора потолка — вся глубина.
      const need = Math.max(1, depth) / MELEE_RATE;
      const cap = roundsCap(depth);
      expect(melee(cap + 1), `глубина ${depth}`).toBeGreaterThanOrEqual(need);
      if (cap > 0) expect(melee(cap), `глубина ${depth}`).toBeLessThan(need);
      expect(cap, 'глубже — не короче').toBeGreaterThanOrEqual(prev);
      prev = cap;
    }
  });

  it('сеча идёт кругами, пока кто-то не сломается, — и ни кругом больше потолка', () => {
    // Зеркала — равные стороны, ломаются позже всех. Размеров два — ½W и 600. До потолка из них прежде доходили только
    // стоявшие (14.22); с тех пор как обходящие дерутся с обходящими (14.25), до него доходят бои `gongBattles` — в драке.
    const standoff = [OVERSIZE_SIZES[0], ARMY_SIZE].flatMap((total) =>
      COMPOSITIONS.flatMap((c) => {
        const s = deploySetup(scaleArmy(c.army, total));
        return [1, 2].map((seed) => ({ r: simulateBattle({ seed, attacker: s, defender: s }), width: FRONT_WIDTH }));
      }),
    );
    const battles = [
      ...allPairs(1).flatMap((p) => p.results.map((r) => ({ r, width: FRONT_WIDTH }))),
      ...OVERSIZE_SIZES.flatMap((total) => oversized(total, FRONT_WIDTH, 10)),
      ...standoff,
      ...gongBattles().map((r) => ({ r, width: FRONT_WIDTH })),
    ];
    let firstPass = 0;
    let broke = 0;
    let gong = 0;
    for (const { r, width } of battles) {
      const rounds = r.log.filter((e) => e.id === 'round').length;
      const cap = roundsCap(depthOf(r, width));
      expect(rounds, 'кругов больше потолка').toBeLessThanOrEqual(cap);
      const breaks = (['attacker', 'defender'] as const).map((side) => r.sides[side].brokenAt ?? Infinity);
      const firstBreak = Math.min(...breaks);
      const firstEnd = r.phases.filter((p) => p.round === undefined && CIRCLE_PHASES.includes(p.phase)).pop()!.to;
      if (firstBreak <= firstEnd) {
        // Сломались в первом проходе — кругов нет вовсе. Моралью в первом проходе не ломается никто — минимум боя EU4
        // (`BREAK_AFTER`, 14.21), — и этот путь остался только перебитым.
        expect(rounds, 'круг после слома в первом проходе').toBe(0);
        expect(atGong(r)).toBe(false);
        expect(r.reason, 'в первом проходе сломались моралью').toBe('annihilated');
        firstPass += 1;
      } else if (atGong(r)) {
        // Потолок: кругов ровно столько, и до него не сломался никто.
        expect(rounds, 'гонг раньше потолка').toBe(cap);
        const at = r.log.find((e) => e.id === 'rounds-out')!.tick;
        expect(firstBreak, 'гонг после слома').toBeGreaterThan(at);
        gong += 1;
      } else {
        // Не сломался никто в первом проходе и гонга не было — значит, сломались в последнем круге, и не раньше.
        expect(rounds, 'не сломался никто, а кругов нет').toBeGreaterThanOrEqual(1);
        const last = r.phases.filter((p) => p.round === rounds + 1);
        expect(last[0].phase, 'круг начинается обстрелом').toBe(CIRCLE_PHASES[0]);
        const order = last.map((p) => CIRCLE_PHASES.indexOf(p.phase));
        for (let i = 1; i < order.length; i += 1) expect(order[i]).toBeGreaterThan(order[i - 1]);
        expect(firstBreak, 'слом раньше последнего круга').toBeGreaterThanOrEqual(last[0].from);
        expect(firstBreak, 'слом после последнего круга').toBeLessThanOrEqual(last[last.length - 1].to);
        broke += 1;
      }
    }
    // Граница: в выборке есть оба пути боя, дошедшего до кругов, — иначе правило проверялось бы даром на одном из них.
    // Третий путь — слом в первом проходе — с минимумом боя EU4 остался только перебитым, и выборка до него может не
    // дойти; его держит «минимум боя EU4» ниже: истребление до минимума.
    expect(broke, 'сломались в круге').toBeGreaterThan(0);
    expect(gong, 'дошли до потолка').toBeGreaterThan(0);
    expect(
      battles.filter(({ r, width }) => atGong(r) && roundsCap(depthOf(r, width)) >= 2).length,
      'дошли до потолка в два круга и больше',
    ).toBeGreaterThan(0);
  }, 120_000);

  it('ничья — редкий исход: бывает только на потолке, а до потолка доходит не больше нескольких процентов боёв', () => {
    // Мерка владельца: больше нескольких процентов боёв на потолке — потолок выведен неверно. «Несколько» здесь —
    // пять из ста, на «Ограничителе» каждого размера: без ширины там, где держится кость сегодня, и с шириной на
    // размерах W, где ширина зажимает (`OVERSIZE_SIZES`).
    // Откуда была ничья (14.22): стояние, а не равный бой. В строю у обеих сторон оставались только обходящие группы
    // одной полосы (ряд обхода, К5) лицом друг к другу; обходящий бил фронт и тыл полосы противника, но не его
    // обходящих, — и драки не было, а сломаться некому. Бой стоял до потолка кругов, и «итог по сохранённым» при разнице
    // меньше `WITHDRAW_RATIO` давал ничью: на 2W с шагом 0.0265 — 19 боёв из 390 (4.9 %). Обходящие дерутся с
    // обходящими (14.25) — и на «Ограничителе» до потолка не доходит ни один бой, ничьих нет (`battle:report`, «Круги
    // сечи и ширина по размерам»); стояние держит следующий тест.
    const RARE = 0.05;
    const sets = [
      { label: `без ширины, ${ARMY_SIZE}`, battles: oversized(ARMY_SIZE, Infinity, OVERSIZE_SEEDS) },
      ...OVERSIZE_SIZES.map((total) => ({ label: `W ${FRONT_WIDTH}, ${total}`, battles: oversized(total, FRONT_WIDTH, OVERSIZE_SEEDS) })),
    ];
    for (const { label, battles } of sets) {
      let gong = 0;
      for (const { r } of battles) {
        if (r.winner === 'draw') expect(atGong(r), `${label}: ничья не на потолке`).toBe(true);
        if (atGong(r)) gong += 1;
      }
      expect(gong / battles.length, `${label}: до потолка ${gong} из ${battles.length}`).toBeLessThanOrEqual(RARE);
    }
  }, 120_000);

  it('обходящие дерутся с обходящими: у потолка кругов нет боя, где у обеих сторон в строю полные группы с моралью и без потерь', () => {
    // Слово владельца (docs/battle_eu4.md, 14.25): обходящая группа бьёт того, кто в её досягаемости, — и чужую
    // обходящую своей полосы, как полк EU4; строя противника не осталось ни в одной полосе — идёт к чужим обходящим в
    // соседнюю. Своего числа нет. Прежде бой стоял (14.22): к потолку у обеих сторон в строю оставались одни обходящие,
    // полные и с моралью, — в одной полосе друг друга не видели, в соседних им некуда было уйти, — и потерь не было ни
    // у кого до самого потолка.
    //
    // Стояние видно снаружи: круг, в котором ни одна сторона не потеряла ни человека, пока никто не сломан. В круге
    // линии сходятся заново, и кто до кого-то дотягивается, тот бьёт; ноль потерь за круг — никто ни с кем не дерётся,
    // и дальше в бою не меняется ничего: он стоит до потолка. Граница области — круги со второго, пока никто не сломан:
    // только в них стояние возможно, и тест проверяет каждый такой круг, а их наличие утверждает ниже.
    // Выборки — там, где стояло: «Ограничитель» на W и 2W (одна полоса: 4 и 19 боёв из 390, 14.22), матрица составов и
    // зеркала на ½W (соседние полосы), и бои, доходящие до потолка в драке (`gongBattles`). Стояние другого рода —
    // «тень», группа в строю, где каждого рода меньше половины бойца (14.25), — эта проверка поймала бы тоже, но в этих
    // выборках его нет; оно вынесено владельцу.
    const mirrors = COMPOSITIONS.flatMap((c) => {
      const s = deploySetup(scaleArmy(c.army, OVERSIZE_SIZES[0]));
      return Array.from({ length: 10 }, (_, i) => ({ r: simulateBattle({ seed: i + 1, attacker: s, defender: s }), name: `зеркало ${OVERSIZE_SIZES[0]}, ${c.name}, сид ${i + 1}` }));
    });
    const battles = [
      ...OVERSIZE_SIZES.slice(1).flatMap((total) => oversized(total, FRONT_WIDTH, OVERSIZE_SEEDS)),
      ...allPairs(4).flatMap((p) => p.results.map((r, i) => ({ r, name: `${p.a} × ${p.b}, бой ${i + 1}` }))),
      ...mirrors,
      ...gongBattles().map((r, i) => ({ r, name: `гонг, бой ${i + 1}` })),
    ];
    let circles = 0;
    let gong = 0;
    for (const { r, name } of battles) {
      const still = standstill(r);
      circles += still.checked;
      expect(still.circle, `${name}: круг ${still.circle} без потерь у обеих сторон, никто не сломан — стояние`).toBeNull();
      if (atGong(r)) gong += 1;
    }
    expect(circles, 'кругов, где никто не сломан').toBeGreaterThan(0);
    // Потолок: его последний круг — из проверенных выше (на потолке не сломан никто), и он в выборке есть.
    expect(gong, 'дошли до потолка').toBeGreaterThan(0);
  }, 120_000);

  it('«тень» перебита: группа, где каждого рода меньше половины бойца, не жива — «жив» в той же единице, что удар', () => {
    // Слово владельца (docs/battle_eu4.md, 14.27): удар рода меньше половины бойца пропускает (`distribute`), и «жив»
    // считается в той же единице — по роду, а не по сумме (`sim.standing`). Прежде группа «копья 0.4 + лёгкая 0.4» была
    // жива суммой, числилась в строю, а бить её было нечем: сторона не ломалась, и бой стоял до потолка кругов (14.25).
    // Граница области: по сумме в «тени» не меньше половины бойца — иначе она не была бы живой и по прежнему правилу.
    const shadow: Stack = { ...emptyStack(), spear: 0.4, cavalry: 0.4 };
    expect(stackTotal(shadow), 'граница: по сумме — не меньше половины бойца').toBeGreaterThanOrEqual(0.5);
    expect(standing(shadow), 'каждого рода меньше половины бойца — перебита').toBe(false);
    expect(standing({ ...shadow, cavalry: 0.5 }), 'полбойца одного рода — жива').toBe(true);
    // Бои, где «тень» стояла до потолка (решётка составов на 2W, сид 1 — щуп 14.25): теперь круга стояния в них нет. Граница
    // области — те же круги со второго, где никто не сломан (`standstill`), и в каждом бою они есть. Пятый бой того щупа
    // («копья 300 + лучники 150 + лёгкая 150» против «лёгкая 450 + тяжёлая 150») теперь кончается в первом проходе: кругов
    // у него нет, правило там не спрашивается, и в выборку он не взят.
    const SHADOWS: ReadonlyArray<readonly [Partial<Stack>, Partial<Stack>]> = [
      [{ spear: 300, cavalry: 150, heavy: 150 }, { cavalry: 300, heavy: 300 }],
      [{ infantry: 300, cavalry: 150, heavy: 150 }, { infantry: 150, cavalry: 300, heavy: 150 }],
      [{ spear: 150, infantry: 150, archer: 150, cavalry: 150 }, { infantry: 150, cavalry: 300, heavy: 150 }],
      [{ spear: 300, infantry: 300 }, { infantry: 300, cavalry: 150, heavy: 150 }],
    ];
    const total = OVERSIZE_SIZES[2];
    for (const [a, b] of SHADOWS) {
      const r = simulateBattle({ seed: 1, attacker: deploySetup(scaleArmy(a, total)), defender: deploySetup(scaleArmy(b, total)) });
      const still = standstill(r);
      const name = `${compositionName(a)} × ${compositionName(b)}`;
      expect(still.checked, `${name}: кругов, где никто не сломан`).toBeGreaterThan(0);
      expect(still.circle, `${name}: круг ${still.circle} без потерь — стоит «тень»`).toBeNull();
    }
  });
});

describe('круг боя: обстрел, сшибка, сеча', () => {
  // Круг — бой заново (`CIRCLE_PHASES`): линии расходятся для нового разбега, и в обстреле круга (стрельба и
  // сближение) рукопашной нет, лучники бьют в полную силу; сшибка снова даёт разбег латным и упор копьям; перестрелка круга
  // судится по своему обстрелу. Так у рода появляется слабая фаза (docs/battle_eu4.md, раздел 3.2).
  /** Бои, доходящие до кругов, `seeds` сидов, `total` бойцов, обе стороны по правилу развёртывания. */
  function roundBattles(a: Partial<Stack>, b: Partial<Stack>, seeds: number, total = OVERSIZE_SIZES[0]): BattleResult[] {
    const out: BattleResult[] = [];
    for (let seed = 1; seed <= seeds; seed += 1) {
      out.push(simulateBattle({ seed, attacker: deploySetup(scaleArmy(a, total)), defender: deploySetup(scaleArmy(b, total)) }));
    }
    return out;
  }
  const roundSpans = (r: BattleResult, ...phases: string[]) => r.phases.filter((p) => p.round !== undefined && phases.includes(p.phase));

  it('в обстреле круга рукопашной нет: у армий без лучников потерь там ни одного', () => {
    const battles = [
      ...roundBattles({ infantry: 600 }, { spear: 600 }, 6),
      ...roundBattles({ infantry: 400, heavy: 200 }, { infantry: 600 }, 6),
      ...roundBattles({ infantry: 600 }, { infantry: 600 }, 6),
    ];
    const approaches = battles.flatMap((r) => roundSpans(r, 'ranged', 'approach'));
    // Граница области: круги в выборке есть, лучников нет ни у кого, а в сшибке и сече тех же кругов потери есть — линии
    // в них сходятся, и ноль в сближении значит «разошлись», а не «никто никого не бьёт».
    expect(approaches.length, 'обстрелов круга в выборке').toBeGreaterThan(0);
    for (const r of battles) for (const side of ['attacker', 'defender'] as const) expect(r.sides[side].initial.archer).toBe(0);
    expect(battles.flatMap((r) => roundSpans(r, 'lines')).some((p) => p.losses.attacker + p.losses.defender > 0)).toBe(true);
    for (const p of approaches) expect(p.losses, `${p.phase} круга ${p.round}, тики ${p.from}–${p.to}`).toEqual({ attacker: 0, defender: 0 });
  });

  it('залп «до столкновения» — один, перед первой сшибкой; перестрелку круга судит его собственный обстрел', () => {
    // Пехота с лучниками против копий на размере W: у одной стороны луки, у другой нет, и в сближении круга без
    // рукопашной все потери безлукой стороны — стрелы этого круга. Ниже W лучников мало: за сближение круга они
    // выбивают меньше порога события (`EVENT_MIN`), и перестрелка круга не судится вовсе.
    const battles = roundBattles({ infantry: 350, archer: 250 }, { spear: 600 }, 6, holdSize());
    let judged = 0;
    for (const r of battles) {
      for (const e of r.log) {
        const span = r.phases.find((p) => e.tick >= p.from && e.tick <= p.to && p.phase === e.phase)!;
        if (e.id === 'volley') expect(span.round, `залп на ${e.tick}-м тике`).toBeUndefined();
        if (e.id !== 'ranged-lost' || span.round === undefined) continue;
        // Сшибка круга судит обстрел своего круга: проигравший потерял в стрельбе и сближении этого круга столько, сколько сказано.
        const shot = r.phases.filter((p) => (p.phase === 'ranged' || p.phase === 'approach') && p.round === span.round).reduce((n, p) => n + p.losses[e.side], 0);
        expect(Math.abs(e.losses - shot), `перестрелка круга ${span.round}`).toBeLessThanOrEqual(1);
        judged += 1;
      }
    }
    // Граница области: круги с перестрелкой в выборке есть, и в каждом бою — ровно один залп первого прохода.
    expect(judged, 'перестрелок, проигранных в круге').toBeGreaterThan(0);
    for (const r of battles) expect(r.log.filter((e) => e.id === 'volley' && e.side === 'attacker').length).toBe(1);
  });

  it('сшибка круга пишет свои события: копья, удержавшие удар снова, и конница, снова дошедшая до лучников', () => {
    // Круг — новая сшибка и новая сеча, и событие о них пишется снова, а не один раз за бой: иначе отчёт и ролик не
    // видят того, ради чего круг заведён. Конница с пехотой против лучников с пехотой по 2400: кругов там много, и
    // лёгкая снова и снова доходит до тех же лучников. Прежний вход — пехота с конницей против пехоты с лучниками —
    // с поставки 1 этого не показывает ни на каком размере: пеших хватает на весь фронт, конница стоит в резерве,
    // а до лучников за целым строем не дотянуться. Половину обещания — «копья, удержавшие удар снова» — этот вход не
    // показывает: копий в нём нет. Событие копий пишется редко — сколько боёв «Лезвия» его несут, печатает
    // `battle:report`, столбец «копья держат» (с флангами за конницей, 14.21, их стало больше: конница стоит в строю).
    const battles = roundBattles({ cavalry: 300, infantry: 300 }, { archer: 300, infantry: 200 }, 4, 2400);
    const key = (e: BattleEvent): string =>
      e.id === 'spears-held' ? `${e.id}:${e.side}:${e.sector}:${e.phase}` : e.id === 'cavalry-broke-archers' ? `${e.id}:${e.side}:${e.target}:${e.phase}` : '';
    let again = 0;
    for (const r of battles) {
      const seen = new Set<string>();
      for (const e of r.log) {
        const k = key(e);
        if (!k) continue;
        const span = r.phases.find((p) => e.tick >= p.from && e.tick <= p.to && p.phase === e.phase)!;
        if (seen.has(k)) {
          // Повтор — только в круге: в первом проходе фаза одна, и событие пишется в ней один раз.
          expect(span.round, `${k} на ${e.tick}-м тике`).toBeDefined();
          again += 1;
        }
        seen.add(k);
      }
    }
    expect(again, 'событий сшибки и сечи, повторённых в круге').toBeGreaterThan(0);
  });
});

/** События, которые объясняют, почему победитель победил. */
function explains(e: BattleEvent, winner: Winner): boolean {
  if (winner === 'draw') return false;
  const loser = other(winner);
  if (!('side' in e)) return false;
  if (e.side === loser) return ['morale-collapsed', 'annihilated', 'sector-collapsed', 'sector-broken', 'ranged-lost', 'flank-turned', 'rear-reached', 'outfought'].includes(e.id);
  return ['spears-held', 'cavalry-broke-archers', 'volley', 'pursuit', 'reserve-committed'].includes(e.id);
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
        // Фаза встречается не один раз — сеча идёт кругами, — поэтому событие ищет ту, в чьи тики попало.
        const span = r.phases.find((p) => p.phase === e.phase && e.tick >= p.from && e.tick <= p.to)!;
        expect(span, `${e.id} на ${e.tick}-м тике — вне любой фазы «${e.phase}»`).toBeDefined();
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
          case 'infantry-shifted':
          case 'archers-kiting':
            // Перехват обхода, сдвиг пехоты и дистанция лучников жили приказами — ядро их больше не пишет (14.5).
            throw new Error(`${e.id}: событие приказа в новом бою`);
          case 'panic-spread':
            // Паники на соседей нет, как у EU4 (14.21): ядро её больше не пишет; тип остался ради записей, посчитанных раньше.
            throw new Error(`${e.id}: паника на соседей в новом бою`);
          case 'sector-collapsed': {
            expect(['A', 'B', 'C']).toContain(e.sector);
            // Смять можно только то, что там стояло: своя расстановка или вошедший резерв.
            const manned =
              initialOf(e.side, e.sector) > 0 ||
              r.log.some((x) => x.tick <= e.tick && 'side' in x && x.side === e.side && x.id === 'reserve-committed' && x.sector === e.sector);
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
              r.log.some((x) => x.tick <= e.tick && 'side' in x && x.side === e.side && x.id === 'reserve-committed' && x.sector === e.sector);
            expect(manned, `сломан пустой сектор ${e.sector}`).toBe(true);
            expect(seen.has(`broken:${e.side}:${e.sector}`)).toBe(false);
            seen.add(`broken:${e.side}:${e.sector}`);
            break;
          }
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
          case 'round':
            // Круг начинается обстрелом — линии расходятся для нового разбега, — и начинается он, только пока не
            // сломан никто.
            expect(e.phase).toBe(CIRCLE_PHASES[0]);
            expect(e.tick).toBe(span.from);
            expect(span.round).toBe(e.round);
            // Сломаться можно уже в первом тике круга, но не раньше него.
            for (const side of ['attacker', 'defender'] as const) expect(r.sides[side].brokenAt === null || r.sides[side].brokenAt! >= e.tick).toBe(true);
            break;
          case 'rounds-out':
            // Потолок: не сломан никто, и исход решил итог по сохранённым, а не слом.
            for (const side of ['attacker', 'defender'] as const) expect(r.sides[side].brokenAt === null || r.sides[side].brokenAt! > e.tick).toBe(true);
            expect(['losses', 'draw']).toContain(r.reason);
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

  it('«копья остановили удар» меряется полосой: в бою сомкнутых копий против конницы событие есть в каждом бою', () => {
    // Решение владельца по 14.21: порог события и выбитое — в одних единицах, полосы (как у «конница дошла до лучников»).
    // Прежде доля бралась от всей конницы противника, а выбитое — в одной полосе, и в паре кольца «копья бьют конницу»
    // событие не писалось ни разу. На исход боя порог журнала не влияет — это сверено отпечатком исходов (14.22).
    const pair = RING.find((p) => p.name === 'копья бьют конницу')!;
    for (let seed = 1; seed <= 4; seed += 1) {
      const r = simulateBattle({ seed, attacker: pair.a, defender: pair.b });
      // Граница области: копья правда удержали конницу — выбили её больше, чем потеряли от неё.
      expect(lossRatio(r, 'attacker'), `сид ${seed}: размен копий`).toBeGreaterThan(1);
      expect(r.log.some((e) => e.id === 'spears-held' && e.side === 'attacker'), `сид ${seed}: копья держат, а в журнале этого нет`).toBe(true);
    }
  });

  it('у истреблённой стороны в журнале стоит истребление, а не только мораль', () => {
    // Истребляют в строю: бежавший уходит с поля, и достаёт его только погоня (мораль EU4, 14.15). Поэтому вход —
    // отряд, который вырубают раньше, чем он успевает побежать; граница области — в журнале слома сектора до
    // истребления нет.
    const r = simulateBattle({ seed: 1, attacker: deploySetup({ infantry: 1000 }), defender: deploySetup({ spear: 2 }) });
    const wiped = r.log.find((e) => e.id === 'annihilated' && e.side === 'defender');
    expect(r.winner).toBe('attacker');
    expect(wiped, 'истребление в журнале').toBeDefined();
    expect(r.log.some((e) => e.id === 'sector-broken' && e.side === 'defender' && e.tick < wiped!.tick), 'бежали раньше истребления').toBe(false);
    expect(r.reason).toBe('annihilated');
    expect(lossRatio(r, 'attacker')).toBeGreaterThan(1);
  });
});

describe('кость фазы', () => {
  // Кость — одна на сторону на фазу, из сида боя (docs/battle_eu4.md, пачка 1). Её величина выведена
  // из доли владельца: сторона на 10 % больше удерживает поле в `DICE.hold` боёв «Ограничителя»
  // (`bench.diceStepFor`, `npm run battle:report`, раздел «Кость фазы»).

  it('сторона на 10 % больше удерживает поле в доле владельца, а без кости — всегда', () => {
    // Был красным с поставки 1 до записи выведенного шага (14.22): шаг 0.0928 поставки 2 давал 65.9 %, выведенный
    // после поставки 1 — 0.0265, и с ним ровно 80.0 % (`battle:report`, «Кость фазы»). Граница «без кости — всегда»
    // держится с флангов за конницей (14.21).
    // КРАСНЫЙ с шага 0 поставки 2 (docs/battle_eu4.md, 14.25), честно: обходящие дерутся с обходящими, и четыре боя
    // «Ограничителя» на W, стоявшие у потолка ничьей, решились — все четыре у большей: 312 → 316 из 390, 80.0 → 81.0 %
    // при коридоре 78–80 %; вывод на этом бое — 0.0342 (`battle:report`, «Кость фазы»; «тень» этих чисел не сдвинула,
    // 14.27). Шаг кости не меняется (слово владельца по 14.25): держим красным до общего вывода — один раз, вместе с W,
    // после последней боевой поставки, перед перемером мира (14.24). Коридор не трогается.
    // Граница области: без кости бой — арифметика, и большая держит поле во всех боях. Иначе
    // «кость сдвинула долю» проверялось бы на наборе, где сдвигать было нечего.
    expect(withDiceStep(0, () => oversizeHold()), 'без кости: все бои у большей').toBe(1);
    const held = oversizeHold();
    expect(held, `с костью: поле у большей в ${(held * 100).toFixed(1)} % боёв`).toBeLessThanOrEqual(DICE.hold);
    // Выведено наименьшим шагом, при котором доля не выше цели, — значит, и не намного ниже.
    expect(held).toBeGreaterThanOrEqual(DICE.hold - 0.02);
  }, 60_000);

  it('в каждой фазе с костью — один бросок на сторону, в гранях кости; у отступления и погони кости нет', () => {
    for (const r of [...allPairs(1).flatMap((p) => p.results), ...RING.map((p) => simulateBattle({ seed: 3, attacker: p.a, defender: p.b }))]) {
      for (const span of r.phases) {
        const dice = r.log.filter((e) => e.id === 'dice' && e.phase === span.phase && e.tick >= span.from && e.tick <= span.to);
        expect(dice.length, `${span.phase}: бросков`).toBe(PHASE_PIP[span.phase] ? 1 : 0);
        for (const e of dice) {
          if (e.id !== 'dice') continue;
          expect(e.tick, 'бросок — в начале фазы').toBe(span.from);
          for (const side of ['attacker', 'defender'] as const) {
            expect(Number.isInteger(e.rolls[side])).toBe(true);
            expect(e.rolls[side]).toBeGreaterThanOrEqual(0);
            expect(e.rolls[side]).toBeLessThan(DICE.faces);
            expect(e.pips[side], 'у этих армий полководцев нет').toBe(0);
          }
        }
      }
    }
  });

  /**
   * Бой с отметками фазы `pip` у нападающего и тот же бой без них. Возвращает первую фазу, к кости
   * которой отметка идёт, — если она в этом бою случилась.
   */
  function withAndWithout(pip: PipId, seed: number): { plain: BattleResult; led: BattleResult; first: number } {
    const plain = simulateBattle({ seed, attacker: deploySetup(BALANCED_ARMY), defender: deploySetup(BALANCED_ARMY) });
    const led = simulateBattle({ seed, attacker: { ...deploySetup(BALANCED_ARMY), pips: { [pip]: 3 } }, defender: deploySetup(BALANCED_ARMY) });
    return { plain, led, first: plain.phases.findIndex((p) => PHASE_PIP[p.phase] === pip) };
  }

  it('манёвр фазы не держит: без переправы бой с отметками манёвра тот же до бита', () => {
    // Фазы манёвра — обходы и ввод резерва — ушли в бой линий (поставка 1); работа манёвра — переправа (14.5).
    expect(PHASES.filter((p) => PHASE_PIP[p] === 'maneuver')).toEqual([]);
    for (let seed = 1; seed <= 6; seed += 1) {
      const plain = simulateBattle({ seed, attacker: deploySetup(BALANCED_ARMY), defender: deploySetup(BALANCED_ARMY) });
      const led = simulateBattle({ seed, attacker: { ...deploySetup(BALANCED_ARMY), pips: { maneuver: 3 } }, defender: deploySetup(BALANCED_ARMY) });
      expect(led.phases, `сид ${seed}`).toEqual(plain.phases);
    }
  });

  it('отметка действует только в своих фазах: до первой из них бой тот же до бита, в ней — другой', () => {
    for (const pip of PIP_IDS.filter((p) => PHASES.some((ph) => PHASE_PIP[ph] === p))) {
      // Точка внутри области: фаза отметки в бою случилась и в ней кто-то погиб у обороны — иначе
      // «в ней другой» проверялось бы даром. Обходы и резерв бой вправе пропустить, поэтому сид ищется.
      let found = false;
      for (let seed = 1; seed <= 40 && !found; seed += 1) {
        const { plain, led, first } = withAndWithout(pip, seed);
        if (first < 0 || plain.phases[first].losses.defender <= 0) continue;
        found = true;
        for (let i = 0; i < first; i += 1) {
          expect(led.phases[i], `${pip}, сид ${seed}: ${plain.phases[i].phase} — до своей фазы отметка ничего не меняет`).toEqual(plain.phases[i]);
        }
        const d = led.log.find((e) => e.id === 'dice' && e.phase === plain.phases[first].phase);
        expect(d && d.id === 'dice' ? d.pips.attacker : null, `${pip}: отметки в кости своей фазы`).toBe(3);
        expect(led.phases[first].losses.defender, `${pip}, сид ${seed}: в своей фазе отметка бьёт сильнее`).toBeGreaterThan(plain.phases[first].losses.defender);
        // Броски от отметок не зависят: поток генератора тот же, меняется только их сумма.
        const rolls = (r: BattleResult): string => JSON.stringify(r.log.filter((e) => e.id === 'dice' && e.tick <= plain.phases[first].from).map((e) => (e.id === 'dice' ? e.rolls : null)));
        expect(rolls(led)).toBe(rolls(plain));
      }
      expect(found, `${pip}: ни в одном бою не нашлось своей фазы с потерями — проверять нечего`).toBe(true);
    }
  });

  it('отчёт называет удачу, только когда она разошлась хотя бы на полкости, — и называет верно', () => {
    let named = 0;
    for (const r of allPairs(1).flatMap((p) => p.results)) {
      const gaps = r.log.flatMap((e) => (e.id === 'dice' ? [e.rolls.attacker + e.pips.attacker - (e.rolls.defender + e.pips.defender)] : []));
      const widest = gaps.reduce((w, g) => (Math.abs(g) > Math.abs(w) ? g : w), 0);
      const keys = summarize(r, 'attacker').keys;
      const line = keys.find((k) => k.art === 'bat-dice');
      if (Math.abs(widest) < DICE.faces / 2) {
        expect(line, 'удача не разошлась — строки о ней нет').toBeUndefined();
        continue;
      }
      if (!line) {
        // Строк больше, чем держит отчёт: кость могла уйти за край по времени.
        expect(keys.length).toBe(KEYS_MAX);
        continue;
      }
      named += 1;
      expect(line.good, 'хорошо или плохо — по знаку самого широкого расхождения').toBe(widest > 0);
    }
    expect(named, 'точка внутри области: удача называлась хоть раз').toBeGreaterThan(0);
  });
});

describe('автоматический резерв', () => {
  // Новый тест 2 поставки 1 (docs/battle_eu4.md, 14.2 и 14.5; решение владельца — вариант (а)): кто сверх ширины,
  // стоит в резерве стороны и встаёт в любую дыру строя — на место убитых и бежавших — со своей моралью.
  /**
   * Армии больше трёх W: у обеих есть резерв. Размер — 6W: с флангами за конницей (14.21) у «пех+конн» края держит
   * конница, в резерве одни пешие, и на 5W бегство края съедало весь резерв в ту же фазу — граница «резерв ещё не
   * исчерпан» не выполнялась ни в одном бою. Утверждения теста не тронуты.
   */
  const big = (seed: number): BattleResult =>
    simulateBattle({ seed, attacker: deploySetup(scaleArmy(BALANCED_ARMY, 6 * FRONT_WIDTH)), defender: deploySetup(scaleArmy(COMPOSITIONS[8].army, 6 * FRONT_WIDTH)) });

  it('встаёт на место убитых и бежавших, в любую полосу, со своей моралью', () => {
    const lanes = new Set<string>();
    let afterBreak = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      const r = big(seed);
      // Граница области: армии больше трёх W, у обеих резерв есть.
      for (const side of ['attacker', 'defender'] as const) {
        expect(stackTotal(r.sides[side].initial), `${side}: больше трёх W`).toBeGreaterThan(3 * FRONT_WIDTH);
        expect(stackTotal(r.sides[side].sectors.R.initial), `${side}: резерв`).toBeGreaterThan(0);
      }
      for (const e of r.log) if (e.id === 'reserve-committed') lanes.add(`${e.side}:${e.sector}`);
      // Сектор первой линии сломался до конца боя — и в его полосу встал резерв той же стороны в тот же шаг: резерв
      // встаёт в начале следующего тика, строка журнала — в конце той фазы, куда этот тик попал.
      for (const e of r.log) {
        if (e.id !== 'sector-broken' || !['A', 'B', 'C'].includes(e.sector)) continue;
        const next = r.phases.find((p) => e.tick + 1 >= p.from && e.tick + 1 <= p.to);
        if (!next) continue;
        const entered = r.log.reduce((n, x) => (x.id === 'reserve-committed' && x.side === e.side && x.tick <= next.to ? n + x.men : n), 0);
        // Граница области: к концу той фазы резерв ещё не исчерпан, и бежавших был хоть один — дыра в целого человека.
        const resLeft = entered < stackTotal(r.sides[e.side].sectors.R.initial);
        const hole = stackTotal(r.sides[e.side].sectors[e.sector].final) >= 1;
        if (!resLeft || !hole) continue;
        const refilled = r.log.some((x) => x.id === 'reserve-committed' && x.side === e.side && x.sector === e.sector && x.tick >= e.tick && x.tick <= next.to);
        expect(refilled, `сид ${seed}: ${e.side}/${e.sector} сломан на ${e.tick}-м тике — резерв на его место не встал`).toBe(true);
        afterBreak += 1;
      }
    }
    // Точки внутри области: резерв вставал на место бежавших, и не в одну полосу.
    expect(afterBreak, 'сектора, сломанные при живом резерве').toBeGreaterThan(0);
    expect(new Set([...lanes].map((l) => l.split(':')[1])).size, 'полос, куда вставал резерв').toBeGreaterThan(1);
  });

  it('бежавший сектор сменяется резервом целиком, а не одними убитыми', () => {
    // Лучники в центре первой линии ломаются в сече быстро — против стены вдвое шире фронта; за ними — резерв пехоты.
    // Когда центр бежит, в его полосу встаёт резерв на место всех бежавших: за фазу слома и следующую — не меньше
    // половины ширины. Одни убитые за это время такой дыры не дают.
    const victim = setupOf({ A: { infantry: FRONT_WIDTH }, B: { archer: FRONT_WIDTH }, C: { infantry: FRONT_WIDTH }, R: { infantry: 3 * FRONT_WIDTH } });
    const wall = deploySetup({ infantry: 6 * FRONT_WIDTH });
    let checked = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const r = simulateBattle({ seed, attacker: wall, defender: victim });
      const broke = r.log.find((e) => e.id === 'sector-broken' && e.side === 'defender' && e.sector === 'B');
      // Граница области: центр сломался, пока резерв ещё был.
      if (!broke) continue;
      const at = r.phases.findIndex((p) => broke.tick >= p.from && broke.tick <= p.to);
      const until = r.phases[Math.min(r.phases.length - 1, at + 1)].to;
      const entered = r.log.reduce((n, e) => (e.id === 'reserve-committed' && e.side === 'defender' && e.sector === 'B' && e.tick >= broke.tick && e.tick <= until ? n + e.men : n), 0);
      expect(entered, `сид ${seed}: в полосу бежавшего центра встало`).toBeGreaterThanOrEqual(FRONT_WIDTH / 2);
      checked += 1;
    }
    expect(checked, 'боёв, где центр сломался при живом резерве').toBeGreaterThan(0);
  });

  it('до ввода резерв мораль не теряет, и встаёт со своей, а не с моралью тех, чьё место занял', () => {
    // Решение владельца 14.19.4: вне строя резерв мораль не теряет. Встаёт он группой рода «R», и мораль сектора R в
    // итоге — мораль вошедших: не ноль сломанных и не сброшенная до нуля.
    let checked = 0;
    for (let seed = 1; seed <= 4; seed += 1) {
      const r = big(seed);
      for (const side of ['attacker', 'defender'] as const) {
        const R = r.sides[side].sectors.R;
        if (stackTotal(R.final) === 0 || R.broken) continue;
        expect(R.morale, `сид ${seed}, ${side}: мораль вошедшего резерва`).toBeGreaterThan(0);
        checked += 1;
      }
    }
    // Точка внутри области: резерв входил и держался — вошедший с чужой (нулевой) моралью бежал бы тут же.
    expect(checked, 'сторон, чей вошедший резерв держится к концу боя').toBeGreaterThan(0);
  });
});

describe('дальность обхода по роду', () => {
  // Новый тест 4 поставки 1 (docs/battle_eu4.md, 14.5; ответ владельца 4): край строя, против которого нет
  // противника, бьёт во фланг — пеший противника своей полосы, конный ещё и соседней; ширину ряд занимает тем, чем
  // встал, и поредевший край бьёт долей живых от начальной.
  const turnedBy = (r: BattleResult, by: Side): boolean => r.log.some((e) => e.id === 'flank-turned' && e.by === by);

  it('конный край достаёт соседнюю полосу, пеший — нет: он стоит', () => {
    // Слева у нападающего край, против которого в полосе нет никого: противник стоит в центре — пехота и лучники за
    // ней. Конный край дотягивается до центра и бьёт первым тыл — лучников; пеший край стоит.
    const target = setupOf({ B: { infantry: FRONT_WIDTH }, E: { archer: 100 } });
    for (let seed = 1; seed <= 4; seed += 1) {
      const horse = simulateBattle({ seed, attacker: setupOf({ A: { cavalry: 100 }, B: { infantry: FRONT_WIDTH } }), defender: target });
      const foot = simulateBattle({ seed, attacker: setupOf({ A: { infantry: 100 }, B: { infantry: FRONT_WIDTH } }), defender: target });
      // Граница области: у нападающего есть край без противника — полоса A, против которой у обороны нет ни фронта,
      // ни тыла; центр при этом стоит лоб в лоб, и обходить там некому. Сам край достать могут — обход полосы, очищенной
    // в бою (К5), — но он никого не обходит.
      for (const r of [horse, foot]) expect(stackTotal(r.sides.defender.sectors.C.initial) + stackTotal(r.sides.defender.sectors.F.initial), 'против края никого').toBe(0);
      expect(
        horse.log.some((e) => e.id === 'flank-turned' && e.by === 'attacker' && e.sector === 'E'),
        `сид ${seed}: конный край дошёл до лучников центра`,
      ).toBe(true);
      expect(turnedBy(foot, 'attacker'), `сид ${seed}: пеший край дотянулся до центра`).toBe(false);
    }
  });

  it('в своей полосе край шире бьёт во фланг — по ширине, какой ряды встали, а не по разнице потерь', () => {
    // Свес ряда над рядом противника — край без противника в своей полосе (дальность пешего). Ширину ряд занимает тем,
    // чем встал, а не живыми: полк держит своё место, сколько бы в нём ни осталось, — иначе разница потерь делала бы
    // «край» из ничего.
    for (let seed = 1; seed <= 4; seed += 1) {
      const wider = simulateBattle({ seed, attacker: setupOf({ B: { infantry: FRONT_WIDTH } }), defender: setupOf({ B: { infantry: 100 } }) });
      expect(turnedBy(wider, 'attacker'), `сид ${seed}: ряд шире обошёл`).toBe(true);
      expect(turnedBy(wider, 'defender'), `сид ${seed}: ряд уже обошёл`).toBe(false);
    }
    // Зеркальные армии: ряды полос встали той ширины, какую дало правило развёртывания, — лоб в лоб они равны или
    // различаются на край по округлению. Обход до того, как чей-то сектор побежал или смят, — только там, где ряд
    // обходящего встал шире.
    const facingFront: Record<'A' | 'B' | 'C', 'A' | 'B' | 'C'> = { A: 'C', B: 'B', C: 'A' };
    let early = 0;
    for (const c of COMPOSITIONS) {
      for (let seed = 1; seed <= 3; seed += 1) {
        const setup = deploySetup(scaleArmy(c.army, holdSize()));
        const r = simulateBattle({ seed, attacker: setup, defender: setup });
        const freedAt = Math.min(...r.log.filter((e) => e.id === 'sector-broken' || e.id === 'sector-collapsed').map((e) => e.tick));
        for (const e of r.log) {
          if (e.id !== 'flank-turned' || e.tick >= freedAt || !(e.sector === 'A' || e.sector === 'B' || e.sector === 'C')) continue;
          const own = stackTotal(setup.sectors[facingFront[e.sector]]);
          const theirs = stackTotal(setup.sectors[e.sector]);
          expect(own, `${c.name}, сид ${seed}: ${e.by} обошёл ${e.sector} на ${e.tick}-м тике, а встал не шире`).toBeGreaterThan(theirs);
          early += 1;
        }
      }
    }
    // Граница области: обход до первого бегства в зеркалах правда бывает — на краях, разошедшихся округлением.
    expect(early, 'обходов в зеркалах до первого бегства').toBeGreaterThan(0);
  });

  it('край бьёт по морали долей накрытого ряда: край в одного человека даёт не больше перевеса в 10 %', () => {
    // Разовый удар и потеря морали за обход (И3, И4) писались под обход целой группой. Край строя накрывает долю ряда
    // противника — ей и бьёт. Мерка — доля владельца: армия больше на одного человека держит поле не чаще, чем большая
    // на 10 % (`DICE.hold`).
    const N = 20;
    let held = 0;
    for (let seed = 1; seed <= N; seed += 1) {
      const r = simulateBattle({ seed, attacker: setupOf({ B: { infantry: 101 } }), defender: setupOf({ B: { infantry: 100 } }) });
      // Граница области: край в одного человека правда есть и обходит.
      expect(turnedBy(r, 'attacker'), `сид ${seed}: край обошёл`).toBe(true);
      if (r.winner === 'attacker') held += 1;
    }
    expect(held / N, `большая на одного держит поле в ${held} из ${N}`).toBeLessThanOrEqual(DICE.hold);
  });
});

describe('монотонность: больше того же — не хуже', () => {
  // Новый тест по слову владельца (27.09.2026): «армия того же состава и большего размера без кости не проигрывает
  // меньшей — для всех составов решётки». Был красным до ввода резерва без предпочтения рода (14.22): большая на 10 %
  // проигрывала меньшей в 19 боях из 420 до снятия паники, в 2 после («пехота 450 + тяжёлая 150» на W: пешие
  // вставали первыми и вытесняли латных), в 2 с флангами за конницей и при расстановке, и при вводе («копья 300 +
  // пехота 150 + лёгкая 150» на 2W: лишняя лёгкая большей первой вставала на края, где меньшая латала дыры копьями).
  // Мутация «резерв — конница первой на края» возвращает ровно эти два сбоя.
  it('армия того же состава и большего размера без кости не проигрывает меньшей — все составы решётки, ½W, W и 2W', () => {
    withDiceStep(0, () => {
      const lost: string[] = [];
      let checked = 0;
      let wider = 0;
      for (const total of [Math.round(holdSize() / 2), holdSize(), 2 * holdSize()]) {
        for (const army of compositionLattice()) {
          const small = deploySetup(scaleArmy(army, total));
          const big = deploySetup(scaleArmy(army, Math.round(total * 1.1)));
          // Граница области: у большей правда больше людей в строю или в резерве — иначе «не хуже» было бы даром.
          if (stackTotal(armyTotal(big)) > stackTotal(armyTotal(small))) wider += 1;
          for (const bigSide of ['attacker', 'defender'] as const) {
            const r = simulateBattle({ seed: 1, attacker: bigSide === 'attacker' ? big : small, defender: bigSide === 'attacker' ? small : big });
            checked += 1;
            if (r.winner === other(bigSide)) lost.push(`${total}: ${compositionName(army)} (${bigSide === 'attacker' ? 'большая нападает' : 'большая обороняется'})`);
          }
        }
      }
      expect(wider, 'составов, где большая правда больше').toBe(3 * compositionLattice().length);
      expect(checked).toBe(6 * compositionLattice().length);
      expect(lost, 'меньшая того же состава выиграла без кости').toEqual([]);
    });
  });
});

describe('мораль EU4', () => {
  // Поставка 1 (docs/battle_eu4.md, 14.15): бежавший уходит с поля, резерв встаёт на его место, и армия больше W
  // перестаёт быть бесполезной.

  it('сторона не сломана, пока встать есть кому: слом — когда в строю никого и резерв исчерпан, или перебита', () => {
    // Новый тест 9. Слома по весу сломанных секторов и автослома по доле потерь нет: сторона со свежим резервом стоит,
    // пока резерв встаёт на место бежавших. Сломалась моралью — значит, весь резерв вошёл в строй, и в строю не
    // осталось никого: каждый её сектор — и резерв тоже — бежал или перебит.
    let checked = 0;
    // Размеры — 5W против 4W и 10W против 9W: во втором резерв — больше половины армии.
    const sizes = [[5, 4], [10, 9]] as const;
    const pairs = [[BALANCED_ARMY, COMPOSITIONS[8].army], [COMPOSITIONS[3].army, COMPOSITIONS[5].army], [COMPOSITIONS[1].army, BALANCED_ARMY]] as const;
    for (let seed = 1; seed <= 4; seed += 1) {
      for (const [[a, b], [na, nb]] of pairs.flatMap((p) => sizes.map((s) => [p, s] as const))) {
        const r = simulateBattle({ seed, attacker: deploySetup(scaleArmy(a, na * FRONT_WIDTH)), defender: deploySetup(scaleArmy(b, nb * FRONT_WIDTH)) });
        for (const side of ['attacker', 'defender'] as const) {
          const collapsed = r.log.find((e) => e.id === 'morale-collapsed' && e.side === side);
          if (!collapsed) continue;
          const reserve = stackTotal(r.sides[side].sectors.R.initial);
          const firstBreak = r.log.find((e) => e.id === 'sector-broken' && e.side === side);
          // Граница области: у стороны был резерв, и её сектора ломались раньше, чем сломалась она сама.
          if (reserve === 0 || !firstBreak || firstBreak.tick >= collapsed.tick) continue;
          const entered = r.log.reduce((n, e) => (e.id === 'reserve-committed' && e.side === side ? n + e.men : n), 0);
          expect(entered, `сид ${seed}, ${side}: сломалась на ${collapsed.tick}-м тике, а резерв вошёл не весь`).toBe(reserve);
          for (const id of SECTORS) {
            const sector = r.sides[side].sectors[id];
            if (stackTotal(sector.initial) === 0) continue;
            expect(sector.broken || stackTotal(sector.final) === 0, `сид ${seed}, ${side}/${id}: стоял, когда сторона сломалась`).toBe(true);
          }
          checked += 1;
        }
      }
    }
    expect(checked, 'сторон, сломавшихся моралью при резерве').toBeGreaterThan(0);
  });

  it('минимум боя EU4: моралью сторона не ломается раньше двух фаз огня и двух натиска — и ломается в первый тик после', () => {
    // Слово владельца 27.09.2026 (docs/battle_eu4.md, 14.21; вики EU4: «Retreat cannot happen until both two fire and two
    // shock phases have been completed»). Фаза огня — обстрел круга, натиска — сшибка. Сектора бегут сами и резерв
    // встаёт, как прежде; ждёт только слом стороны. Перебитую сторону минимум не держит: отходить некому.
    /** Последний тик минимума: круги целиком, пока не прошли фазы каждой отметки `BREAK_AFTER`. */
    const floor = ((): number => {
      const passed: Partial<Record<PipId, number>> = {};
      let t = 0;
      for (let k = 1; k <= 10; k += 1) {
        for (const [i, p] of CIRCLE_PHASES.entries()) {
          t += circleTicks(p, k);
          const pip = PHASE_PIP[p];
          if (pip && PHASE_PIP[CIRCLE_PHASES[i + 1]] !== pip) passed[pip] = (passed[pip] ?? 0) + 1;
          if (Object.entries(BREAK_AFTER).every(([q, n]) => (passed[q as PipId] ?? 0) >= (n ?? 0))) return t;
        }
      }
      return Infinity;
    })();
    // Прочтение правила, названное вслух: две фазы огня и две натиска — это конец сшибки второго круга.
    expect(BREAK_AFTER).toEqual({ fire: 2, shock: 2 });
    expect(floor, 'конец сшибки второго круга').toBe(circleLength(1) + circleTicks('ranged', 2) + circleTicks('approach', 2) + circleTicks('clash', 2));

    // Горстка против толпы: строй горстки пустеет в первом круге, резерва у неё нет — правило здесь и решает.
    const handful = (seed: number): BattleResult => simulateBattle({ seed, attacker: deploySetup({ infantry: 30 }), defender: deploySetup({ infantry: 600 }) });
    const battles = [...sampleBattles(), ...[1, 2, 3, 4].map(handful)];
    for (const r of battles) {
      for (const e of r.log) {
        if (e.id === 'morale-collapsed') expect(e.tick, `${e.side} сломалась моралью на ${e.tick}-м тике при минимуме по ${floor}-й`).toBeGreaterThan(floor);
      }
    }
    for (let seed = 1; seed <= 4; seed += 1) {
      const r = handful(seed);
      const fled = r.log.find((e) => e.id === 'sector-broken' && e.side === 'attacker');
      const collapsed = r.log.find((e) => e.id === 'morale-collapsed' && e.side === 'attacker');
      // Граница области: горстка побежала в первом круге, задолго до минимума, и резерва у неё не было.
      expect(fled && fled.tick <= circleLength(1), `сид ${seed}: горстка не побежала в первом круге`).toBe(true);
      expect(stackTotal(r.sides.attacker.sectors.R.initial), `сид ${seed}: резерв горстки`).toBe(0);
      expect(collapsed?.tick, `сид ${seed}: строй пуст с ${fled!.tick}-го тика — сторона ломается в первый тик после минимума`).toBe(floor + 1);
    }
    // Истребление минимум не держит: перебитая сторона ломается сразу.
    const wiped = simulateBattle({ seed: 1, attacker: deploySetup({ infantry: 1000 }), defender: deploySetup({ spear: 2 }) });
    const at = wiped.log.find((e) => e.id === 'annihilated' && e.side === 'defender');
    expect(at, 'истребление в журнале').toBeDefined();
    expect(at!.tick, `истреблены на ${at!.tick}-м тике при минимуме по ${floor}-й`).toBeLessThanOrEqual(floor);
  });

  it('бежавший уходит с поля: после слома сектор не получает ни одного удара до погони', () => {
    // Новый тест 10. Бежавших в строю нет — не бьют, не стоят в ряду, не закрывают собой тех, кто за ними; достаёт
    // их только преследование. По записи боя это видно потерями сектора по фазам: у сектора одна группа — та, что
    // встала в него перед боем, и после её слома у сектора нет потерь ни в одной фазе, кроме погони.
    let checked = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      for (const [a, b] of [[BALANCED_ARMY, COMPOSITIONS[8].army], [COMPOSITIONS[3].army, COMPOSITIONS[5].army]] as const) {
        const r = simulateBattle({ seed, attacker: deploySetup(scaleArmy(a, 5 * FRONT_WIDTH)), defender: deploySetup(scaleArmy(b, 5 * FRONT_WIDTH)) });
        for (const e of r.log) {
          if (e.id !== 'sector-broken' || e.sector === 'R') continue;
          const at = r.phases.findIndex((p) => e.tick >= p.from && e.tick <= p.to);
          const after = r.phases.slice(at + 1).filter((p) => p.phase !== 'pursuit');
          // Граница области: после слома бой ещё шёл хоть одну фазу до погони, и у стороны оставались люди в строю —
          // противнику было по кому бить.
          if (after.length === 0 || (r.sides[e.side].brokenAt !== null && r.sides[e.side].brokenAt! <= e.tick)) continue;
          const lost = after.reduce((n, p) => n + (p.bySector?.[e.side]?.[e.sector] ?? 0), 0);
          expect(lost, `сид ${seed}: ${e.side}/${e.sector} бежал на ${e.tick}-м тике, а потом терял людей`).toBe(0);
          checked += 1;
        }
      }
    }
    expect(checked, 'слома секторов посреди боя').toBeGreaterThan(0);
  });

  it('армия больше W не бесполезна: большая держит поле дольше меньшей и выше трёх W, и ниже', () => {
    // Новый тест 3. Большая на четверть против меньшей, та же ширина: сторона держит поле, пока не сломалась. Точки —
    // по обе стороны трёх W: ниже вся армия в строю, выше лишние стоят в резерве и встают на место выбывших. Какая
    // точка где, утверждено в самом тесте — резерв у меньшей есть или нет.
    const W = FRONT_WIDTH;
    const until = (r: BattleResult, side: Side): number => r.sides[side].brokenAt ?? r.ticks + 1;
    for (const [n, above] of [[Math.round(2.5 * W), false], [6 * W, true], [9 * W, true]] as const) {
      const small = scaleArmy(BALANCED_ARMY, n);
      const large = scaleArmy(BALANCED_ARMY, Math.round(n * 1.25));
      expect(stackTotal(deploySetup(small).sectors.R) > 0, `${n}: резерв у меньшей`).toBe(above);
      let largeLonger = 0;
      let smallLonger = 0;
      for (let seed = 1; seed <= 8; seed += 1) {
        for (const largeSide of ['attacker', 'defender'] as const) {
          const [a, b] = largeSide === 'attacker' ? [large, small] : [small, large];
          const r = simulateBattle({ seed, attacker: deploySetup(a), defender: deploySetup(b) });
          const smallSide = other(largeSide);
          if (until(r, largeSide) > until(r, smallSide)) largeLonger += 1;
          if (until(r, smallSide) > until(r, largeSide)) smallLonger += 1;
        }
      }
      expect(largeLonger, `${n} против ${Math.round(n * 1.25)}: большая дольше — ${largeLonger}, меньшая — ${smallLonger}`).toBeGreaterThan(smallLonger);
    }
  });
});

describe('ширина фронта', () => {
  // Ширина одна и включена всегда: выключателя больше нет, у боя с автоматическим резервом режим один
  // (docs/battle_eu4.md, 14.5). Механизм проверяется своей шириной боя (`BattleInput.width`), а умолчание —
  // тем, что по умолчанию бой тот же бит в бит, что с шириной фронта.

  /** Каждая пара составов бенча в обе стороны поля: бои, где ряды полос бывают и уже, и шире W. */
  const pairs = (width: number | undefined): BattleResult[] => {
    const out: BattleResult[] = [];
    for (let i = 0; i < COMPOSITIONS.length; i += 1) {
      for (let j = i + 1; j < COMPOSITIONS.length; j += 1) {
        for (const [a, d] of [[i, j], [j, i]]) {
          out.push(simulateBattle({ seed: 1, attacker: COMPOSITIONS[a].setup, defender: COMPOSITIONS[d].setup, ...(width === undefined ? {} : { width }) }));
        }
      }
    }
    return out;
  };
  const depthCount = (rs: BattleResult[]): number => rs.reduce((n, r) => n + r.log.filter((e) => e.id === 'depth').length, 0);

  it('по умолчанию бой идёт с шириной фронта: бит в бит, что с ней', () => {
    // Граница области: на этих боях ширина что-то решает — без неё хоть один бой идёт иначе. Иначе «тот же бой»
    // проверялось бы на наборе, где ширине нечего менять, и бой без ширины прошёл бы за бой с ней.
    const plain = pairs(undefined);
    const narrow = pairs(FRONT_WIDTH);
    const wide = pairs(Infinity);
    expect(wide.some((r, k) => JSON.stringify(r) !== JSON.stringify(narrow[k])), 'без ширины хоть один бой другой').toBe(true);
    for (let k = 0; k < plain.length; k += 1) expect(plain[k], `бой ${k}`).toEqual(narrow[k]);
  });

  it('незаполненная ширина ничего не меняет: бой тот же бит в бит', () => {
    // Ширина не меньше всей армии каждой стороны — ни один ряд её не заполнит.
    for (const [a, d] of [[BALANCED_ARMY, { infantry: 1000 }], [{ spear: 900, archer: 300 }, { cavalry: 800, heavy: 200 }]] as Array<[Partial<Stack>, Partial<Stack>]>) {
      const attacker = deploySetup(a);
      const defender = deploySetup(d);
      const width = Math.max(stackTotal(armyTotal(attacker)), stackTotal(armyTotal(defender)));
      for (const seed of [1, 2, 3]) {
        const wide = simulateBattle({ seed, attacker, defender, width });
        expect(depthCount([wide]), 'ряд шире всей армии не бывает').toBe(0);
        expect(wide).toEqual(simulateBattle({ seed, attacker, defender, width: Infinity }));
      }
    }
  });

  it('заполненная ширина зажимает: у стороны, большей на 10 %, размен ниже, чем без ширины', () => {
    const total = OVERSIZE_SIZES[2];
    let widthed = 0;
    let bare = 0;
    let counted = 0;
    for (let i = 0; i < COMPOSITIONS.length; i += 1) {
      // Точка внутри области: фронт полосы меньшей стороны, какой правило поставило бы без ширины, шире ширины.
      // Составы без первой линии (одни лучники) в счёт не идут.
      if (openFront(scaleArmy(COMPOSITIONS[i].army, total)) <= FRONT_WIDTH) continue;
      const w = oversize(i, 6, total, FRONT_WIDTH);
      const b = oversize(i, 6, total, Infinity);
      widthed += w.smallLoss / Math.max(1, w.bigLoss);
      bare += b.smallLoss / Math.max(1, b.bigLoss);
      counted += 1;
    }
    expect(counted, 'составов с фронтом шире ширины').toBeGreaterThanOrEqual(8);
    expect(widthed / counted, `размен с шириной ${(widthed / counted).toFixed(2)}, без — ${(bare / counted).toFixed(2)}`).toBeLessThan(bare / counted - 0.1);
  });
});
