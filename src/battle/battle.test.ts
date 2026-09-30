// Раздел 16 документа — это список тестов. Здесь они все, кроме тех, что ушли с раскладкой
// (docs/battle_eu4.md, 14.5): доминирующего состава нет, кольцо работает, превосходство условно,
// бой детерминирован, укладывается в границы, выведенные из фаз, а журнал объясняет исход и
// не врёт числам. Все стороны встают по правилу развёртывания (`setup.deploySetup`).
import { describe, expect, it } from 'vitest';
import { simulateBattle, standing } from './sim';
import { deploy, deploySetup, armyTotal, emptyStack, reinforceInto, stackTotal, stackOf } from './setup';
import { describeEvent } from './log';
import { ANNIHILATED_AT, BREAK_AFTER, DICE, FIRE_AFTER_CONTACT, EVENT_MIN, BASE_CIRCLES, CIRCLE_MELEE, CIRCLE_PHASES, FRONT_WIDTH, MELEE_RATE, MORALE, PHASE_PIPS, PHASE_TICKS, PYRRHIC_BELOW, TEMPER, INTO_LINES, circleLength, circleTicks, meleeTicksOf, splitTicks, UNIT_STATS, roundsCap } from './config';
import { ARMY_AT_W, ARMY_SIZE, BALANCED_ARMY, COMPOSITIONS, LATTICE_STEP, compositionLattice, compositionName, kindUse, latticeDuels, latticeFieldShare, latticeTop, type LatticeRow, OVERSIZE_CAP, OVERSIZE_SEEDS, OVERSIZE_SIZES, hasLine, holdSize, laneFront, latticeHold, lossRatio, mirrored, openFront, oversize, oversizeOf, pureKind, scaleArmy, setupOf, standstill, withDiceStep } from './bench';
import { KEYS_MAX, summarize } from './report';
import { FRONT, HORSE_KINDS, PHASES, PIP_IDS, SECTORS, UNIT_KINDS, type ArmySetup, type BattleEvent, type BattleResult, type PhaseId, type PhaseSpan, type PipId, type Side, type Stack, type Winner } from './types';

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

/**
 * Чистые пары родов — одним родом против другого, как прежние пары кольца (кольца с пересмотра баланса нет, 14.35), но
 * выборке они нужны по-прежнему: у чистого состава свой ход боя.
 */
const PURE_PAIRS: Array<{ a: ArmySetup; b: ArmySetup }> = [
  { a: deploySetup({ spear: ARMY_SIZE }), b: deploySetup({ cavalry: ARMY_SIZE }) },
  { a: deploySetup({ cavalry: ARMY_SIZE }), b: deploySetup({ archer: ARMY_SIZE }) },
  { a: deploySetup({ archer: ARMY_SIZE }), b: deploySetup({ spear: ARMY_SIZE }) },
];

/** Крайние случаи: они должны и завершаться в срок, и давать честный журнал. */
const EXTREMES: Array<{ name: string; attacker: ArmySetup; defender: ArmySetup }> = [
  { name: 'толпа против горстки', attacker: deploySetup({ infantry: 1000 }), defender: deploySetup({ spear: 10 }) },
  { name: 'горстка против толпы', attacker: deploySetup({ archer: 5 }), defender: deploySetup({ cavalry: 900, infantry: 300 }) },
  { name: 'один на один', attacker: deploySetup({ infantry: 1 }), defender: deploySetup({ spear: 1 }) },
  // Один против строя: перебит в первый же тик сшибки — самый короткий бой, какой бывает (нижняя граница
  // «продолжительности»). Прежде до неё доставала «горстка против толпы»: конный край дотягивался до её тыла из полосы,
  // где противника не было, и выбивал горстку за тик; с охватом одним правилом (14.35) она успевает побежать.
  { name: 'один против строя', attacker: deploySetup({ infantry: 1 }), defender: deploySetup({ infantry: 300 }) },
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
  for (const r of PURE_PAIRS) out.push(simulateBattle({ seed: 5, attacker: r.a, defender: r.b }));
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

describe('составы при равной цене', () => {
  // Противники — вся решётка составов (`bench.compositionLattice`), а не список, подобранный
  // руками: список не содержит того, кто доминирует, и промахивается мимо тех, кто его бьёт. Все встают по правилу
  // развёртывания — расстановку решётка не выбирает. Решётка — равные по людям армии, а при весе из цены (П2) равные
  // бойцы строя и есть равная цена: вид весит в бою своей ценой (`game/battle/price`, docs/battle_eu4.md, 14.35).
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

  // Тест «каждый состав решётки кому-нибудь проигрывает размен» (обещание «никто не бьёт всех»: у каждого состава решётки
  // есть противник, берущий у него размен не ниже `RATIO_EVEN`) снят словом владельца (docs/battle_eu4.md, 14.35, слово по
  // щупу веса, п. 4): было обещанием кольца; кольцо убрано решением владельца; в EU4 лучший состав существует — пехота на
  // ширину, конница с флангов, стрелки сзади. Это смена обещания, а не сдвиг порога. На его место — три теста ниже, с
  // мутациями: каждый вид полезен, лучший состав — смешанный, «Ограничитель» держится.

  it('каждый вид полезен: при равной цене добавка рода хоть в одну смесь поднимает долю поля хоть против одного противника', () => {
    const r = lattice();
    for (const k of UNIT_KINDS) {
      // Граница области: роду есть куда прибавиться — в решётке есть смесь без него и она же с шагом решётки, отданным ему.
      expect(r.some((row) => !(row.army[k] ?? 0) && r.some((x) => x.army[k] === LATTICE_STEP)), k).toBe(true);
      const use = kindUse(r, k);
      expect(use, `${k}: добавка рода не подняла долю поля ни против кого`).not.toBeNull();
    }
    // Виды одного рода при равной цене — одна армия (`game/battle/price.test.ts`): полезен род — полезен и каждый его вид.
  }, 120_000);

  it('лучший состав — смешанный: ни один чистый вид не бьёт все', () => {
    const r = lattice();
    for (const k of UNIT_KINDS) {
      const i = r.findIndex((row) => pureKind(row.army) === k);
      // Граница области: чистый состав рода в решётке есть.
      expect(i, `чистые ${k} в решётке`).toBeGreaterThanOrEqual(0);
      expect(r[i].beats.length, `чистые ${k} бьют все`).toBeLessThan(r.length - 1);
    }
    const [best] = latticeTop(r);
    expect(pureKind(r[best].army), `лучший — ${compositionName(r[best].army)}`).toBeNull();
  }, 120_000);

  it('«Ограничитель» держится: лучший состав на 10 % больше себя не выигрывает лавиной', () => {
    // Лучший состав существует (в EU4 — тоже), и «Ограничитель» (`oversize`) обязан держать и его: на 10 % больше себя он
    // берёт размен не выше потолка составов с линией (`OVERSIZE_CAP.line`). Как лучший стоит против следующего за ним,
    // печатает `battle:report` («Решётка составов»): верх решётки — соседние составы шагом решётки, и утверждение о них
    // проходило бы при любом коде (правило 11).
    const r = lattice();
    const [best, second] = latticeTop(r);
    const name = compositionName(r[best].army);
    // Граница области: лучший и правда впереди, и у него пешая линия — потолок у составов без линии свой (`noLine`).
    expect(latticeFieldShare(r, best)).toBeGreaterThanOrEqual(latticeFieldShare(r, second));
    expect(hasLine(r[best].army), name).toBe(true);
    const { bigLoss, smallLoss } = oversizeOf(r[best].army, OVERSIZE_SEEDS, holdSize());
    expect(smallLoss / Math.max(1, bigLoss), `${name}: на 10 % больше себя — размен`).toBeLessThanOrEqual(OVERSIZE_CAP.line);
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

// Кольца контрров нет (слово владельца по 14.35, docs/battle_eu4.md, п. 2): таблица «род против рода» ушла целиком, и с ней
// тесты «кольцо контрров» — «лучники бьют копья» (обещание — лучники выигрывают у копий размен на каждом сиде, в среднем
// выше 1.5; красный с поставки 1), «копья бьют конницу» и «конница бьёт лучников» (то же для своих пар). Кто кого бьёт,
// следует из показателей родов (`KIND_PROFILE`, `PIP`), как у EU4; обещания о составах при равной цене — каждый вид полезен,
// лучший состав смешанный, «Ограничитель» держится — держит решётка выше (слово владельца по 14.35, п. 4).

describe('превосходство по положению', () => {

  // Тесты «конница против сомкнутых копий проигрывает размен» и «копья держат конницу, пока не обойдены: обойдённые теряют
  // упор» сняты словом владельца по 14.35 (п. 2): упор копий против конницы (×2.0) и удар конницы о сомкнутые копья (×0.5) —
  // кольцо, и оно ушло. Сомкнутость копий осталась положением — её читает характер (`TEMPER.spear`; тест «копейщики стойки,
  // пока сомкнуты, и ломки под ударом во фланг»).

  it('лучники после контакта бьют через головы своих вполсилы, как вторая линия EU4', () => {
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
      expect(after, `сид ${seed}: после контакта — вполсилы, не больше`).toBeLessThanOrEqual(before * FIRE_AFTER_CONTACT * 1.05);
      expect(after, `сид ${seed}: через головы бьют`).toBeGreaterThan(0);
    }
    // Вторая линия EU4 бьёт половиной (слово владельца по 14.35, п. 3): прежние 0.3 были назначены без вывода.
    expect(FIRE_AFTER_CONTACT).toBe(0.5);
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
 * Потолок кругов — страховка, а не часть боя (слово владельца, поставка 5, docs/battle_eu4.md, 14.33): настоящие бои
 * кончаются моралью. Он выведен из боя в полную силу (`roundsCap`), а без урона от морали урон всегда в полную силу, и до
 * потолка не доходит ни один бой выборок — ни пары решётки на ½W, W, 2W и 600, ни зеркала до 10W (щуп сверки). Пары,
 * доходившие до него в драке (`GONG_PAIRS`, 14.25), ушли вместе с уроном от морали, а утверждения «выборка доходит до
 * потолка» — из «продолжительности», «сеча идёт кругами» и «обходящие дерутся». Ветку потолка держит страж на нарочно
 * собранном бое (`guardBattle`, тест «страж потолка»).
 */
/**
 * Бой, который никто не ломает: штраф места снимает с кости обеих сторон всё — урон фазы ноль (`phaseLuck`), — а ряды
 * стоят лоб в лоб ровно по ширине: свеса нет, обходить некого. Прежде страж ставил пеших на краях, которые друг на друга
 * не смотрят, — пешему с края соседнюю полосу было не достать; с охватом одним правилом (слово владельца,
 * docs/battle_eu4.md, 14.35) такой бой решается, и ветку потолка держит бой без урона.
 */
const blind = { ground: { land: 1000 } };
const guardBattle = (seed: number): BattleResult =>
  simulateBattle({ seed, attacker: { ...setupOf({ B: { infantry: 40 } }), ...blind }, defender: { ...setupOf({ B: { infantry: 40 } }), ...blind } });

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
    // Был красным с записи выведенного шага 0.0265 (14.22): «пехота+луки» — размен 1.64 при потолке 1.6 (с шагом 0.0928 —
    // 1.50). ЗЕЛЁНЫЙ со снятия урона от морали (поставка 5, пункт 3, docs/battle_eu4.md, 14.33): «пехота+луки» 1.53,
    // наибольший с линией — «копья+луки» 1.57, без линии — «конн+луки» 1.59 (`battle:report`, «Ограничитель»). Потолки не
    // трогались. Пересмотр баланса после поставки 5 (14.24) меряет его заново — на итоговом бое.
    // КРАСНЫЙ с охвата одним правилом (14.35, пункт 1), честно: «копья+луки» 1.61 при потолке 1.6 (было 1.57), прочие не
    // сдвинулись выше потолка — сдвинуло снятие медленных копий (`SLOW_CONTACT` ушёл с кольцом: пока копья обеих сторон
    // «шли», лучники били в полную силу). Потолок не трогается; меряется заново на показателях родов (шаг 5 пересмотра).
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
    // первой, а позади неё тыл: он держит полосу занятой, иначе победитель слева пошёл бы охватом на центр (14.35). Во
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
      // Граница области: горстка побежала — из первой линии: смятия фронта в тыл больше нет (поставка 5, 14.33), и из строя
      // она уходит только бегством.
      expect(rout, `сид ${seed}: горстка слева не побежала`).toBeDefined();
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

  // Тест «снаряжение из кузницы делает войско стойче: та же армия со снаряжением выигрывает размен» снят вместе с моралью
  // за ступень снаряжения (`GEAR`, `ArmySetup.gear`) — решение владельца по 14.35, путь П2: вещи идут в бой только через цену
  // вида и его вес. Обещание «кузница меняет бой» держит `game/battle/price.test.ts`: каждая вещь поднимает вес вида.

  it('копейщики стойки, пока сомкнуты, и ломки под ударом во фланг', () => {
    // Сомкнутые против обойдённых, а не приказы: приказа «наступать» больше нет, сомкнутость — положение (Е17).
    expect(TEMPER.spear.holding).toBeLessThan(TEMPER.spear.advancing);
    expect(TEMPER.spear.advancing).toBeLessThan(TEMPER.spear.flanked);
    // Узкие копья в центре против пехоты той же численности: ряд копий шириной с ряд пехоты — лоб в лоб, а ряд пехоты
    // шире — её свес приходит копьям во фланг. Лишняя пехота лоб в лоб стоит второй линией за своим рядом: из соседней
    // полосы она пошла бы охватом (14.35), а за своим рядом ей никого не достать. Числа ниже ширины: резерва нет ни у кого.
    const narrow = FRONT_WIDTH - 42;
    const spears = setupOf({ B: { spear: narrow } });
    const frontal = setupOf({ B: { infantry: narrow }, E: { infantry: 42 } });
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

  // Тест «конница высока на разгоне, но хрупка, когда её остановили» снят словом владельца по 14.35 (п. 2): слабости конницы
  // в сече (×1.3 «остановленной») и её крепости в сшибке нет — сшибка и сеча обе натиск, и что род приносит в натиске,
  // говорят показатели. Крепость конницы в обходе (`TEMPER.cavalry.charging`) — положение — осталась.

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
  // Границы выводятся из фаз, а не записаны числом. Круг — огонь и натиск, как у EU4 (14.35); сломался кто-то — круг
  // обрывается в тик слома, в любой своей фазе, и дальше отступление и преследование целиком. Моралью раньше минимума боя EU4
  // (`BREAK_AFTER`: две фазы огня и две натиска — два круга) не ломается никто, поэтому нижняя граница боя, кончившегося
  // моралью, — тик после минимума, отход и погоня. Перебитую сторону минимум не держит: её бой бывает и короче. Верхняя —
  // у каждого боя своя: все круги до потолка (`roundsCap` от глубины меньшей по ней стороны).
  /** Тиков до конца минимума боя EU4: круги подряд, пока не прошли фазы каждого вида `BREAK_AFTER`. */
  const MINIMUM_END = ((): number => {
    const passed: Partial<Record<PipId, number>> = {};
    let t = 0;
    for (let k = 1; k <= 10; k += 1) {
      for (const [i, p] of CIRCLE_PHASES.entries()) {
        t += circleTicks(p, k);
        const kind = PHASE_PIPS[p][0];
        const next = CIRCLE_PHASES[i + 1];
        if (kind && (!next || PHASE_PIPS[next][0] !== kind)) passed[kind] = (passed[kind] ?? 0) + 1;
        if (Object.entries(BREAK_AFTER).every(([q, n]) => (passed[q as PipId] ?? 0) >= (n ?? 0))) return t;
      }
    }
    return Infinity;
  })();
  const SHORTEST = MINIMUM_END + 1 + PHASE_TICKS.retreat + PHASE_TICKS.pursuit;
  const longest = (r: BattleResult): number =>
    Array.from({ length: roundsCap(depthOf(r)) + 1 }, (_, i) => circleLength(i + 1)).reduce((n, t) => n + t, 0) + PHASE_TICKS.retreat + PHASE_TICKS.pursuit;

  // Верхняя граница: до неё доходит только бой, дошедший до потолка кругов, а настоящие бои кончаются моралью раньше —
  // без урона от морали до потолка не доходит ни один бой выборок (поставка 5, 14.33). Утверждение «выборка достаёт до
  // верхней границы» ушло по слову владельца; ветку потолка — и эту границу — держит «страж потолка» в «кругах сечи».

  it('любой бой укладывается в границы фаз, и выборка достаёт до нижней', () => {
    const battles = sampleBattles();
    const byMorale = battles.filter((r) => r.reason === 'morale');
    // Точка выборки лежит на нижней границе: без этого тест проходил бы при любой регрессии в зазоре между выборкой и
    // настоящим пределом.
    expect(byMorale.some((r) => r.ticks === SHORTEST), `ни один бой, кончившийся моралью, не кончился на ${SHORTEST}-м тике`).toBe(true);
    for (const r of battles) {
      if (r.reason === 'morale') expect(r.ticks, 'моралью — не раньше минимума боя EU4').toBeGreaterThanOrEqual(SHORTEST);
      expect(r.ticks).toBeGreaterThan(PHASE_TICKS.retreat + PHASE_TICKS.pursuit);
      expect(r.ticks).toBeLessThanOrEqual(longest(r));
      let next = 1;
      for (const span of r.phases) {
        expect(span.from).toBe(next);
        expect(span.to).toBeGreaterThanOrEqual(span.from);
        next = span.to + 1;
      }
      expect(next - 1).toBe(r.ticks);
      // Первый круг идёт в объявленном порядке; его хвост пропущен, только если кто-то сломался в нём. Круги за ним —
      // по счёту, каждый в том же порядке; целиком — все, кроме последнего: в нём кто-то сломался, и он оборвался в тик
      // слома. Отступление и погоня — после кругов.
      const first = r.phases.filter((p) => p.round === undefined);
      const order = first.map((p) => PHASES.indexOf(p.phase));
      for (let i = 1; i < order.length; i += 1) expect(order[i]).toBeGreaterThan(order[i - 1]);
      for (const must of ['ranged', 'retreat', 'pursuit']) {
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
  // Бой — круги всем боем (`CIRCLE_PHASES`): огонь и натиск, как у EU4, с новой костью, пока кто-то не сломается, но
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
    // Круг — огонь (стрельба и сближение) и натиск (сшибка, в которую ушла сеча), как у EU4 (слово владельца по 14.35, п. 2).
    expect(CIRCLE_PHASES).toEqual(['ranged', 'approach', 'clash']);
    expect(CIRCLE_MELEE).toEqual(['clash']);
    expect(CIRCLE_PHASES.map((p) => PHASE_PIPS[p][0])).toEqual(['fire', 'fire', 'shock']);
    // Длина круга — нынешняя, из прежнего боя в один проход: прежний круг — обстрел, сближение, сшибка и бой линий с долями
    // обходов, резерва и морали (`INTO_LINES`), каждая фаза на три круга (`BASE_CIRCLES`), сшибка целиком; огонь и натиск
    // делят её поровну с точностью до тика, огонь — меньшая половина, из него сближение — своя доля прежнего боя.
    expect(BASE_CIRCLES).toBe(3);
    expect(INTO_LINES).toEqual(['flanking', 'reserve', 'morale']);
    const old = (k: number): number =>
      splitTicks(PHASE_TICKS.ranged, k) + splitTicks(PHASE_TICKS.approach, k) + PHASE_TICKS.clash + splitTicks(PHASE_TICKS.lines, k) +
      INTO_LINES.reduce((n, q) => n + splitTicks(PHASE_TICKS[q], k), 0);
    for (let k = 1; k <= BASE_CIRCLES + 2; k += 1) {
      expect(circleLength(k), `круг ${k}`).toBe(old(k));
      const fire = circleTicks('ranged', k) + circleTicks('approach', k);
      expect(fire + circleTicks('clash', k), `круг ${k}: огонь и натиск — весь круг`).toBe(circleLength(k));
      expect(circleTicks('clash', k) - fire, `круг ${k}: поровну с точностью до тика`).toBeGreaterThanOrEqual(0);
      expect(circleTicks('clash', k) - fire, `круг ${k}: поровну с точностью до тика`).toBeLessThanOrEqual(1);
      expect(circleTicks('approach', k), `круг ${k}: сближение — своя доля`).toBe(splitTicks(PHASE_TICKS.approach, k));
      for (const p of CIRCLE_PHASES) expect(circleTicks(p, k), `${p}, круг ${k}: не меньше тика`).toBeGreaterThan(0);
    }
    expect(circleLength(BASE_CIRCLES + 2), 'после трёх кругов — как третий').toBe(circleLength(BASE_CIRCLES));
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

  it('страж потолка: бой, который никто не ломает, кончается на потолке — ровно на нём, итогом по сохранённым', () => {
    // Слово владельца (поставка 5, docs/battle_eu4.md, 14.33): потолок кругов — страховка, а не часть боя; бой обязан
    // кончиться — его повторит сервер. Настоящие бои кончаются моралью, и ветку потолка держит этот страж на нарочно
    // собранном бое (`guardBattle`): урона нет ни у кого, ряды лоб в лоб — и сломаться некому. Без потолка такой бой не
    // кончился бы никогда.
    for (let seed = 1; seed <= 3; seed += 1) {
      const r = guardBattle(seed);
      const cap = roundsCap(depthOf(r));
      // Граница области: никто никого не бьёт и не сломан никто — бой может кончиться только потолком.
      expect(r.sides.attacker.total.losses + r.sides.defender.total.losses, `сид ${seed}: потерь`).toBe(0);
      expect([r.sides.attacker.brokenAt, r.sides.defender.brokenAt], `сид ${seed}: сломанных`).toEqual([null, null]);
      expect(atGong(r), `сид ${seed}: бой кончился на потолке`).toBe(true);
      expect(r.log.filter((e) => e.id === 'round').length, `сид ${seed}: кругов сверх первого — ровно потолок`).toBe(cap);
      const all = Array.from({ length: cap + 1 }, (_, i) => circleLength(i + 1)).reduce((n, t) => n + t, 0);
      expect(r.ticks, `сид ${seed}: длина — все круги до потолка, отход и погоня`).toBe(all + PHASE_TICKS.retreat + PHASE_TICKS.pursuit);
      expect([r.winner, r.reason], `сид ${seed}: итог по сохранённым — сохранили поровну`).toEqual(['draw', 'draw']);
    }
  });

  it('сеча идёт кругами, пока кто-то не сломается, — и ни кругом больше потолка', () => {
    // Зеркала — равные стороны, ломаются позже всех. Размеров два — ½W и 600. До потолка из них прежде доходили только
    // стоявшие (14.22), потом — пары `GONG_PAIRS` в драке (14.25); без урона от морали не доходит ни один бой выборок
    // (поставка 5, 14.33), и ветку потолка держит «страж потолка» выше.
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
    ];
    let firstPass = 0;
    let broke = 0;
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
    // Граница: в выборке есть путь боя, дошедшего до кругов и сломавшегося в круге. Путь «дошли до потолка» утверждался
    // здесь же — «дошли до потолка» и «дошли до потолка в два круга и больше» — и ушёл по слову владельца (поставка 5,
    // 14.33): настоящие бои кончаются моралью, ветку потолка держит «страж потолка» — и мутацию «потолок на круг длиннее»
    // с тех пор ловит он, а не этот тест (принято владельцем). Слом в первом проходе с минимумом боя EU4 остался только
    // перебитым, и выборка до него может не дойти; его держит «минимум боя EU4» ниже.
    expect(broke, 'сломались в круге').toBeGreaterThan(0);
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
    // зеркала на ½W (соседние полосы); бои, доходившие до потолка в драке (`GONG_PAIRS`), ушли — без урона от морали до
    // потолка не доходит ни один бой выборок (поставка 5, 14.33). Стояние другого рода —
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
    ];
    let circles = 0;
    for (const { r, name } of battles) {
      const still = standstill(r);
      circles += still.checked;
      expect(still.circle, `${name}: круг ${still.circle} без потерь у обеих сторон, никто не сломан — стояние`).toBeNull();
    }
    expect(circles, 'кругов, где никто не сломан').toBeGreaterThan(0);
    // Утверждение «дошли до потолка» ушло по слову владельца (поставка 5, 14.33): настоящие бои кончаются моралью, и до
    // потолка не доходит ни один бой выборок; ветку потолка держит «страж потолка».
  }, 120_000);

  it('нечётный остаток не стоит на краю: на боях W+1 пеших и на решётке ни один бой не стоит до потолка', () => {
    // Слово владельца (поставка 5, docs/battle_eu4.md, 14.33). Прежде «лишний один — левому»: армия W+1 пеших вставала
    // центром W и одиночкой на своём левом краю — у обеих сторон, а свой левый смотрит на чужой правый, где с начала боя
    // никого. Пешему с края соседнюю полосу не достать, и ход (`relocate`) — только у того, чья полоса очищена в бою; если
    // центры бежали разом, одиночки стояли мимо друг друга до потолка кругов. Теперь нечётный остаток ждёт в резерве.
    const N = FRONT_WIDTH + 1;
    const splits: Array<Partial<Stack>> = [0, 34, 68, 102, 136, N].map((spear) => ({ spear, infantry: N - spear }));
    // Граница области: у каждой армии пеших сверх центра нечётное число, а края не полны — прежнее правило поставило бы
    // одиночку на край.
    for (const a of splits) {
      const beyond = (a.spear ?? 0) + (a.infantry ?? 0) - FRONT_WIDTH;
      expect(beyond % 2 === 1 && beyond < 2 * FRONT_WIDTH, `${compositionName(a)}: нечётный остаток при неполных краях`).toBe(true);
    }
    const battles: Array<{ r: BattleResult; name: string }> = [];
    for (const a of splits) for (const b of splits) for (let seed = 1; seed <= 12; seed += 1) {
      battles.push({ r: simulateBattle({ seed, attacker: deploySetup(a), defender: deploySetup(b) }), name: `${compositionName(a)} × ${compositionName(b)}, сид ${seed}` });
    }
    // Решётка — зеркала на ½W, W и 2W и на W + 1: равные стороны ломаются позже всех.
    for (const total of [...OVERSIZE_SIZES, N]) {
      for (const army of compositionLattice()) {
        const setup = deploySetup(scaleArmy(army, total));
        battles.push({ r: simulateBattle({ seed: 1, attacker: setup, defender: setup }), name: `зеркало ${total}, ${compositionName(army)}` });
      }
    }
    let circles = 0;
    for (const { r, name } of battles) {
      const still = standstill(r);
      circles += still.checked;
      expect(atGong(r), `${name}: бой стоял до потолка кругов`).toBe(false);
      expect(still.circle, `${name}: круг ${still.circle} без потерь у обеих сторон — стояние`).toBeNull();
    }
    // Граница области: круги, где никто не сломан, в выборке есть — только в них стояние и возможно.
    expect(circles, 'кругов, где никто не сломан').toBeGreaterThan(0);
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
    // у него нет, правило там не спрашивается, и в выборку он не взят. Тем же правилом с поставки 5 не взят и первый
    // («копья 300 + лёгкая 150 + тяжёлая 150» против «лёгкая 300 + тяжёлая 300»): без урона от морали он кончается в
    // первом проходе (14.33).
    const SHADOWS: ReadonlyArray<readonly [Partial<Stack>, Partial<Stack>]> = [
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

describe('круг боя: огонь и натиск', () => {
  // Круг — бой заново (`CIRCLE_PHASES`): линии расходятся для нового разбега, и в огне круга (стрельба и сближение)
  // рукопашной нет, лучники бьют в полную силу; натиск снова даёт разбег латным (docs/battle_eu4.md, раздел 3.2; фазы EU4 —
  // шаг 2 пересмотра, 14.35).
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
    expect(battles.flatMap((r) => roundSpans(r, 'clash')).some((p) => p.losses.attacker + p.losses.defender > 0)).toBe(true);
    for (const p of approaches) expect(p.losses, `${p.phase} круга ${p.round}, тики ${p.from}–${p.to}`).toEqual({ attacker: 0, defender: 0 });
  });

  it('залп «до столкновения» — один, перед первой сшибкой', () => {
    // Пехота с лучниками против копий на размере W: у одной стороны луки, у другой нет. Вторая половина теста — «перестрелку
    // круга судит его собственный обстрел» — ушла с судьёй перестрелки (поставка 5, 14.33): судьи больше нет.
    const battles = roundBattles({ infantry: 350, archer: 250 }, { spear: 600 }, 6, holdSize());
    let circles = 0;
    for (const r of battles) {
      if (r.phases.some((p) => p.round !== undefined)) circles += 1;
      for (const e of r.log) {
        const span = r.phases.find((p) => e.tick >= p.from && e.tick <= p.to && p.phase === e.phase)!;
        if (e.id === 'volley') expect(span.round, `залп на ${e.tick}-м тике`).toBeUndefined();
      }
    }
    // Граница области: бои с кругами в выборке есть — залпу было где повториться, — и в каждом бою ровно один залп первого
    // прохода.
    expect(circles, 'боёв с кругами').toBeGreaterThan(0);
    for (const r of battles) expect(r.log.filter((e) => e.id === 'volley' && e.side === 'attacker').length).toBe(1);
  });

  it('судьи перестрелки нет: проигранный обстрел бьёт по морали только потерями', () => {
    // Поставка 5 (docs/battle_eu4.md, 14.33; И6): прежде сторона, потерявшая в обстреле круга не меньше `EVENT_MIN` и в 1.3
    // раза больше противника (порог прежнего судьи), в начале сшибки теряла по 8 морали в каждой группе строя — второй счёт
    // того, что мораль уже взяла потерями (14.19.3). Судьи нет: события «проиграли перестрелку» ядро не пишет.
    let inside = 0;
    for (const r of sampleBattles()) {
      // Граница области: обстрел круга, который прежний судья засудил бы.
      const shot = new Map<number, Record<Side, number>>();
      for (const p of r.phases) {
        if (p.phase !== 'ranged' && p.phase !== 'approach') continue;
        const c = shot.get(p.round ?? 1) ?? { attacker: 0, defender: 0 };
        c.attacker += p.losses.attacker;
        c.defender += p.losses.defender;
        shot.set(p.round ?? 1, c);
      }
      for (const c of shot.values()) for (const side of ['attacker', 'defender'] as const) if (c[side] >= EVENT_MIN && c[side] >= 1.3 * c[other(side)]) inside += 1;
      expect(r.log.some((e) => e.id === 'ranged-lost'), 'перестрелку судили: проигравшему обстрел — удар по морали сверх потерь').toBe(false);
    }
    expect(inside, 'обстрелов, которые прежний судья засудил бы').toBeGreaterThan(0);
  });

  it('сшибка круга пишет свои события: копья, удержавшие удар снова, и конница, снова дошедшая до лучников', () => {
    // Круг — новая сшибка и новая сеча, и событие о них пишется снова, а не один раз за бой: иначе отчёт и ролик не
    // видят того, ради чего круг заведён. Конница против копий с лучниками по 2400: кругов там много, конница снова и
    // снова сшибается с копьями и доходит до лучников за ними — обе половины обещания. Прежний вход — конница с пехотой
    // против лучников с пехотой — с охвата одним правилом (14.35) повтора не показывает: обходящая конница бьёт сперва
    // строй полосы, а до лучников за ним доходит, когда строя нет.
    const battles = roundBattles({ cavalry: 600 }, { spear: 300, archer: 300 }, 4, 2400);
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
  if (e.side === loser) return ['morale-collapsed', 'annihilated', 'sector-broken', 'flank-turned', 'rear-reached', 'outfought'].includes(e.id);
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
          case 'sector-collapsed':
            // Смятия фронта потерями нет (поставка 5, 14.33): из строя выходят бегством или перебитыми, ядро его больше не
            // пишет; тип остался ради записей, посчитанных раньше.
            throw new Error(`${e.id}: смятие фронта в новом бою`);
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
            // Судьи перестрелки нет (поставка 5, 14.33): ядро это больше не пишет; тип остался ради записей, посчитанных раньше.
            throw new Error(`${e.id}: судья перестрелки в новом бою`);
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
    // Копья против конницы вчетверо меньше: копья держат её в любом ходе боя — кольца для этого не нужно (14.35).
    const pair = { a: deploySetup({ spear: ARMY_SIZE }), b: deploySetup({ cavalry: ARMY_SIZE / 4 }) };
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
  // из доли владельца: сторона на 10 % больше удерживает поле в `DICE.hold` боёв решётки «Лезвия»
  // (`bench.latticeHold`, `bench.diceStepFor`, `npm run battle:report`, раздел «Кость фазы»).

  it('сторона на 10 % больше удерживает поле в доле владельца на решётке «Лезвия», а без кости — всегда', () => {
    // Переопределён по имени (docs/battle_eu4.md, 14.35, заход 30.09 (день), шаг 3; правило 16): набор доли владельца —
    // решётка «Лезвия», а не «Ограничитель». Критерий владельца «+10 % — около 80 %» стоит на «Лезвии»; решётка — правило, а
    // не список, и по месту прибавки большей (в строю или в резерве) делится так же, как бои мира вокруг W. На «Ограничителе»
    // тест жил с поставки 1 до П5 (история красных и зелёных — 14.22…14.35); там с шагом решётки доля ниже коридора, и это
    // печатает тот же раздел отчёта.
    // Граница области: без кости бой — арифметика, и большая держит поле во всех боях. Иначе
    // «кость сдвинула долю» проверялось бы на наборе, где сдвигать было нечего.
    expect(withDiceStep(0, () => latticeHold(1)), 'без кости: все бои у большей').toBe(1);
    const held = latticeHold();
    expect(held, `с костью: поле у большей в ${(held * 100).toFixed(1)} % боёв`).toBeLessThanOrEqual(DICE.hold);
    // Выведено наименьшим шагом, при котором доля не выше цели, — значит, и не намного ниже.
    expect(held).toBeGreaterThanOrEqual(DICE.hold - 0.02);
  }, 120_000);

  it('в каждой фазе EU4 — огне и натиске — один бросок на сторону, в гранях кости; у сближения своего нет, у погони свой без отметок, у отступления кости нет', () => {
    // Кость одна на фазу EU4 (слово владельца по 14.35, п. 2): сближение — хвост огня, и бросок стрельбы идёт через него.
    // У погони кость своя (П2, слово владельца по 14.35, п. 5), отметок полководца у неё нет — они и не ставятся армиям ниже.
    const starts = (phase: PhaseId): boolean => {
      if (phase === 'pursuit') return true;
      const kind = PHASE_PIPS[phase][0];
      const prev = CIRCLE_PHASES[CIRCLE_PHASES.indexOf(phase) - 1];
      return Boolean(kind) && !(prev && PHASE_PIPS[prev][0] === kind);
    };
    expect(starts('approach'), 'граница: сближение — хвост огня').toBe(false);
    expect(PHASE_PIPS.pursuit, 'у погони отметок нет').toEqual([]);
    for (const r of [...allPairs(1).flatMap((p) => p.results), ...PURE_PAIRS.map((p) => simulateBattle({ seed: 3, attacker: p.a, defender: p.b }))]) {
      for (const span of r.phases) {
        const dice = r.log.filter((e) => e.id === 'dice' && e.phase === span.phase && e.tick >= span.from && e.tick <= span.to);
        expect(dice.length, `${span.phase}: бросков`).toBe(starts(span.phase) ? 1 : 0);
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
    return { plain, led, first: plain.phases.findIndex((p) => PHASE_PIPS[p.phase].includes(pip)) };
  }

  it('манёвр фазы не держит: без переправы бой с отметками манёвра тот же до бита', () => {
    // Фазы манёвра — обходы и ввод резерва — ушли в бой линий (поставка 1); работа манёвра — переправа (14.5).
    expect(PHASES.filter((p) => PHASE_PIPS[p].includes('maneuver'))).toEqual([]);
    for (let seed = 1; seed <= 6; seed += 1) {
      const plain = simulateBattle({ seed, attacker: deploySetup(BALANCED_ARMY), defender: deploySetup(BALANCED_ARMY) });
      const led = simulateBattle({ seed, attacker: { ...deploySetup(BALANCED_ARMY), pips: { maneuver: 3 } }, defender: deploySetup(BALANCED_ARMY) });
      expect(led.phases, `сид ${seed}`).toEqual(plain.phases);
    }
  });

  it('отметка действует только в своих фазах: до первой из них бой тот же до бита, в ней — другой', () => {
    for (const pip of PIP_IDS.filter((p) => CIRCLE_PHASES.some((ph) => PHASE_PIPS[ph].includes(p)))) {
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

  it('встаёт только туда, где сторона стояла: нечётный всадник не встаёт один в пустой центр', () => {
    // Пересмотр баланса, шаг 2 (docs/battle_eu4.md, 14.35). Расстановка оставляет центр конной армии пустым, пока края не
    // полны, и нечётный остаток краёв ждёт в резерве. Прежде резерв считал местом всю ширину ряда и на первом же тике
    // ставил этого всадника одного в пустой центр: стрелы противника тратили на него тик, край сохранял мораль, и стая на
    // одного волка больше проигрывала там, где меньшая брала верх (`world/gatemono.test.ts`).
    const foe = deploySetup({ infantry: 150, archer: 50 });
    let checked = 0;
    for (const n of [101, 237, 239]) {
      const setup = deploySetup({ cavalry: n });
      // Граница области: центр при расстановке пуст, нечётный — в резерве.
      expect(stackTotal(setup.sectors.B), `${n}: центр при расстановке`).toBe(0);
      expect(setup.sectors.R.cavalry, `${n}: нечётный в резерве`).toBe(1);
      for (let seed = 1; seed <= 3; seed += 1) {
        const r = simulateBattle({ seed, attacker: setup, defender: foe });
        const center = r.log.filter((e) => e.id === 'reserve-committed' && e.side === 'attacker' && e.sector === 'B');
        expect(center, `${n}, сид ${seed}: резерв встал в полосу, где стороны не было`).toEqual([]);
        checked += 1;
      }
    }
    expect(checked).toBe(9);
  });
});

describe('охват и край строя', () => {
  // Охват — одно правило без истории (слово владельца, docs/battle_eu4.md, 14.35, пункт 1): группа, у которой в своей
  // полосе нет противника, бьёт соседнюю. Край строя в своей полосе бьёт во фланг свесом; ширину ряд занимает тем, чем
  // встал, и поредевший край бьёт долей живых от начальной (14.5).
  //
  // Тест «конный край достаёт соседнюю полосу, пеший — нет: он стоит» (поставка 1, ответ владельца 4 — дальность обхода
  // по роду в полосах, `REACH`) снят словом владельца по 14.35: правило «пешие в полосе, где противника не было с начала
  // боя, стоят» делало бой зависимым от истории полосы, и больший того же состава держал поле реже меньшего. Его обещание
  // «конный край достаёт соседнюю» держит новый тест ниже — вместе с пешими.
  const turnedBy = (r: BattleResult, by: Side): boolean => r.log.some((e) => e.id === 'flank-turned' && e.by === by);

  it('группа, у которой в своей полосе нет противника, бьёт соседнюю — пешая так же, как конная, с самого начала боя', () => {
    // Слева у нападающего край, против которого в полосе нет никого с начала боя: противник стоит в центре — пехота и
    // лучники за ней. Край идёт охватом на центр и бьёт его строй с фланга — любого рода. Центр стоит лоб в лоб ровно по
    // ширине, и сам по себе никого не обходит: обход центра — только от края.
    const target = setupOf({ B: { infantry: FRONT_WIDTH }, E: { archer: 100 } });
    for (let seed = 1; seed <= 4; seed += 1) {
      for (const kind of ['infantry', 'spear', 'cavalry', 'heavy'] as const) {
        const r = simulateBattle({ seed, attacker: setupOf({ A: { [kind]: 100 }, B: { infantry: FRONT_WIDTH } }), defender: target });
        // Граница области: против края в его полосе нет никого с начала боя — ни фронта, ни тыла, — а центр равен центру.
        expect(stackTotal(r.sides.defender.sectors.C.initial) + stackTotal(r.sides.defender.sectors.F.initial), 'против края никого').toBe(0);
        expect(stackTotal(r.sides.attacker.sectors.B.initial), 'центр лоб в лоб').toBe(stackTotal(r.sides.defender.sectors.B.initial));
        expect(
          r.log.some((e) => e.id === 'flank-turned' && e.by === 'attacker' && e.sector === 'B'),
          `сид ${seed}, ${kind}: край пошёл охватом на центр`,
        ).toBe(true);
      }
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
    // Каждый состав на W против себя же на 10 % больше, большая — с обеих сторон поля: ряды полос встают разными из-за
    // настоящей разницы в числе людей. Обход до того, как чей-то сектор побежал, — только у стороны, чей строй хоть в одной
    // полосе встал шире строя напротив: краем в своей полосе или излишком, ушедшим в охват на соседнюю (`relocate`, охват по
    // излишку ширины, 14.35). Прежде вход был зеркальным: ряды зеркал различались на край только остатком округления —
    // «лишний один — левому» у обеих сторон, а свой левый смотрит на чужой правый, — и все ранние обходы давала эта ошибка
    // (поставка 5, 14.33).
    const facingFront: Record<'A' | 'B' | 'C', 'A' | 'B' | 'C'> = { A: 'C', B: 'B', C: 'A' };
    const wider = (own: ArmySetup, their: ArmySetup): boolean =>
      (['A', 'B', 'C'] as const).some((id) => stackTotal(own.sectors[id]) > stackTotal(their.sectors[facingFront[id]]));
    let early = 0;
    for (const c of COMPOSITIONS) {
      const small = deploySetup(scaleArmy(c.army, holdSize()));
      const big = deploySetup(scaleArmy(c.army, Math.round(holdSize() * 1.1)));
      for (let seed = 1; seed <= 3; seed += 1) {
        for (const [att, def] of [[small, big], [big, small]] as const) {
          const r = simulateBattle({ seed, attacker: att, defender: def });
          const freedAt = Math.min(...r.log.filter((e) => e.id === 'sector-broken').map((e) => e.tick));
          for (const e of r.log) {
            if (e.id !== 'flank-turned' || e.tick >= freedAt || !(e.sector === 'A' || e.sector === 'B' || e.sector === 'C')) continue;
            const [own, their] = e.by === 'attacker' ? [att, def] : [def, att];
            expect(wider(own, their), `${c.name}, сид ${seed}: ${e.by} обошёл ${e.sector} на ${e.tick}-м тике, а ни в одной полосе не встал шире`).toBe(true);
            early += 1;
          }
        }
      }
    }
    // Граница области: обход до первого бегства правда бывает — там, где ряды разошлись настоящей разницей.
    expect(early, 'обходов до первого бегства').toBeGreaterThan(0);
    // Зеркала: ряды встают ровно равными — края поровну, нечётный остаток ждёт в резерве, — и обхода до первого бегства нет:
    // разница потерь края не делает.
    let mirrored = 0;
    let fought = 0;
    for (const c of COMPOSITIONS) {
      for (let seed = 1; seed <= 3; seed += 1) {
        const setup = deploySetup(scaleArmy(c.army, holdSize()));
        // Граница области: ряды правда встали равными — лоб в лоб и край против края.
        for (const id of ['A', 'B', 'C'] as const) expect(stackTotal(setup.sectors[id]), `${c.name}: ряд ${id} против своего зеркала`).toBe(stackTotal(setup.sectors[facingFront[id]]));
        const r = simulateBattle({ seed, attacker: setup, defender: setup });
        const freedAt = Math.min(...r.log.filter((e) => e.id === 'sector-broken').map((e) => e.tick));
        // Граница области: до первого бегства обе стороны теряли людей — разнице потерь было из чего сделать «край».
        if (r.phases.some((p) => p.to < freedAt && p.losses.attacker > 0 && p.losses.defender > 0)) fought += 1;
        for (const e of r.log) if (e.id === 'flank-turned' && e.tick < freedAt && (e.sector === 'A' || e.sector === 'B' || e.sector === 'C')) mirrored += 1;
      }
    }
    expect(fought, 'зеркал, где до первого бегства обе стороны теряли людей').toBeGreaterThan(0);
    expect(mirrored, 'обходов в зеркалах до первого бегства: ряды равны, а обход был — край сделала разница потерь').toBe(0);
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
  // Мутация «резерв — конница первой на края» возвращает ровно эти два сбоя. С поставки 5 держится без ×1.05 фронту без
  // пехоты (Д8, 14.34): без него сбоил тот же состав на W, большая обороняется, — конница на краях вся вытесняла у большей её
  // копья; держит его правило флангов по доле, и мутация «прежнее правило флангов» без ×1.05 возвращает этот сбой.
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

  it('одновременный слом — у обеих сторон: кто сломан, читается на начало тика, а не порядком счёта', () => {
    // Пересмотр баланса, шаг 2 (docs/battle_eu4.md, 14.35). Прежде атакующего считали первым, и оборона в тот же тик уже
    // «не боялась»: слом обеих решал порядок обхода в её пользу, а правило одновременного слома (`decide`: меньше
    // сохранил — тот и отходит) не срабатывало никогда. Зеркало без кости теряет мораль одинаково с обеих сторон.
    let checked = 0;
    withDiceStep(0, () => {
      for (const c of COMPOSITIONS) {
        const army = scaleArmy(c.army, holdSize());
        const r = simulateBattle({ seed: 1, attacker: deploySetup(army), defender: deploySetup(army) });
        const at = (side: Side): number | undefined => r.log.find((e) => e.id === 'morale-collapsed' && e.side === side)?.tick;
        // Граница области: зеркало кончается моралью, и атакующий ломается.
        expect(r.reason, c.name).toBe('morale');
        expect(at('attacker'), `${c.name}: атакующий сломался`).toBeDefined();
        expect(at('defender'), `${c.name}: оборона ломается в тот же тик`).toBe(at('attacker'));
        checked += 1;
      }
    });
    expect(checked).toBe(COMPOSITIONS.length);
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
          const pip = PHASE_PIPS[p][0];
          const next = CIRCLE_PHASES[i + 1];
          if (pip && (!next || PHASE_PIPS[next][0] !== pip)) passed[pip] = (passed[pip] ?? 0) + 1;
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

  it('погоня — рукопашная, и догоняет она только того, кто быстрее: равных и более быстрых не достаёт никто', () => {
    // П2 (слово владельца по 14.35, п. 5): погоня одной дверью урона, «догоняет только быстрый» — ставок и потолка нет.
    // Копья (скорость 1) против копий, латные (2) против лёгкой конницы (3) — никого; пехота (2) против копий (1) — да.
    const pursuitLoss = (r: BattleResult, side: Side): number => r.phases.filter((p) => p.phase === 'pursuit').reduce((n, p) => n + p.losses[side], 0);
    const cases: Array<{ name: string; winner: Partial<Stack>; loser: Partial<Stack>; caught: boolean }> = [
      { name: 'копья за копьями', winner: { spear: 600 }, loser: { spear: 100 }, caught: false },
      { name: 'латные за лёгкой конницей', winner: { heavy: 600 }, loser: { cavalry: 100 }, caught: false },
      { name: 'пехота за копьями', winner: { infantry: 600 }, loser: { spear: 100 }, caught: true },
    ];
    for (const c of cases) {
      for (let seed = 1; seed <= 4; seed += 1) {
        const r = simulateBattle({ seed, attacker: deploySetup(c.winner), defender: deploySetup(c.loser) });
        // Граница области: победитель — большая армия, проигравший отходит, погоня идёт, и гнать есть кем и кого.
        expect(r.winner, `${c.name}, сид ${seed}: поле у большей`).toBe('attacker');
        expect(r.log.some((e) => e.id === 'retreat' && e.side === 'defender'), `${c.name}: отходит`).toBe(true);
        expect(r.phases.some((p) => p.phase === 'pursuit'), `${c.name}: погоня идёт`).toBe(true);
        expect(r.sides.attacker.total.final, `${c.name}: гнать есть кем`).toBeGreaterThan(0);
        const lost = pursuitLoss(r, 'defender');
        if (c.caught) expect(lost, `${c.name}, сид ${seed}: быстрый догоняет`).toBeGreaterThan(0);
        else expect(lost, `${c.name}, сид ${seed}: равных и более быстрых не догоняет никто`).toBe(0);
      }
    }
  });

  it('погоня без потолка: выбила всех бегущих — армия уничтожена, и журнал пишет это в погоне, а добитых — числом', () => {
    // Слово владельца по 14.35, п. 6: уничтожения стека отдельным правилом нет — оно следует из погони. Горстка копий против
    // пехоты, которая быстрее: до погони она бежит, сохранив людей, в погоне её выбивают до последнего.
    for (let seed = 1; seed <= 4; seed += 1) {
      const r = simulateBattle({ seed, attacker: deploySetup({ infantry: 300 }), defender: deploySetup({ spear: 20 }) });
      const at = r.phases.findIndex((p) => p.phase === 'pursuit');
      const before = r.phases.slice(0, at).reduce((n, p) => n + p.losses.defender, 0);
      // Граница области: к погоне у проигравшего были люди — перебили его не в бою, а в погоне.
      expect(r.winner, `сид ${seed}`).toBe('attacker');
      expect(before, `сид ${seed}: к погоне горстка жива`).toBeLessThan(20 * (1 - ANNIHILATED_AT));
      const wiped = r.log.find((e) => e.id === 'annihilated' && e.side === 'defender');
      expect(wiped?.phase, `сид ${seed}: погоня выбила всех бегущих`).toBe('pursuit');
      expect(r.sides.defender.total.final, `сид ${seed}`).toBeLessThan(20 * ANNIHILATED_AT);
      const chase = r.log.find((e) => e.id === 'pursuit');
      const inPursuit = r.phases[at].losses.defender;
      expect(chase?.id === 'pursuit' ? Math.abs(chase.losses - inPursuit) : Infinity, `сид ${seed}: в журнале — добитые погоней`).toBeLessThanOrEqual(0.55);
    }
  });

  it('бежавший уходит с поля: после слома сектор не получает ни одного удара до погони', () => {
    // Новый тест 10. Бежавших в строю нет — не бьют, не стоят в ряду, не закрывают собой тех, кто за ними; достаёт
    // их только преследование. Он же держит обещание снятого «сломанная бьёт и получает ×0.6» (Д13, поставка 5, 14.33):
    // сломанная выходит из контакта сразу — множителю бить некого, и мутация «вернуть ×0.6» эквивалентна. По записи боя
    // это видно потерями сектора по фазам: сектор в журнале сломан, когда побежала последняя его стоящая часть (излишек
    // строя уходит в обход частью сектора — `relocate`, 14.35), и после этого у сектора нет потерь ни в одной фазе, кроме
    // погони.
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

  it('смятия нет: из строя выходят бегством или перебитыми — и горстка, выбитая за тик больше чем на 70 %', () => {
    // Поставка 5 (docs/battle_eu4.md, 14.33; И11): смятие фронта потерями ушло. Фронт, где осталось меньше 30 % своих (без
    // пехоты — 40 %), прежде откатывался в тыл и переставал быть сомкнутым строем — второй путь из строя рядом с моралью;
    // у EU4 полк уходит по морали. С моралью EU4 сектор бежит, потеряв четверть–треть, и смятие застаёт только того, кого за
    // один тик выбивают больше чем на 70 %: горстку пехоты в центре против лучников на все три полосы.
    const wall = setupOf({ D: { archer: FRONT_WIDTH }, E: { archer: FRONT_WIDTH }, F: { archer: FRONT_WIDTH } });
    let inside = 0;
    for (const n of [3, 4, 5, 6]) {
      for (let seed = 1; seed <= 8; seed += 1) {
        const r = simulateBattle({ seed, attacker: setupOf({ B: { infantry: n } }), defender: wall });
        // Граница области: горстка (одна пехота — заякорена, порог прежнего правила 30 %) побежала в первом же тике и в
        // обстреле потеряла больше 70 % — все её потери до погони: бежавших нет в строю, и стрелы до них не достают. Прежнее
        // правило смяло бы её в тот же тик, раньше бегства.
        const fled = r.log.find((e) => e.id === 'sector-broken' && e.side === 'attacker' && e.sector === 'B');
        const lost = r.phases.find((p) => p.phase === 'ranged')!.bySector?.attacker?.B ?? 0;
        if (fled?.tick === 1 && lost > 0.7 * n && r.reason !== 'annihilated') inside += 1;
        expect(r.log.some((e) => e.id === 'sector-collapsed'), `горстка ${n}, сид ${seed}: фронт смят потерями — второй путь из строя рядом с моралью`).toBe(false);
      }
    }
    expect(inside, 'боёв, где горстку выбили за тик больше чем на 70 %, а она ещё стояла').toBeGreaterThan(0);
  });

  it('урон — от силы, а не от морали: уставшие лучники бьют так же, как свежие', () => {
    // Поставка 5 (docs/battle_eu4.md, 14.33; Д6): урон группы больше не падает с её моралью — прежде он множился на
    // 0.5 + 0.5 · мораль / 100; у EU4 урон от силы полка, а не от его морали. Лучники против пехоты без луков: в обстреле
    // первого круга пехоте ответить нечем, и всё, что она потеряла, — стрелы. Уставшие (мораль между боями, `rest`) встают с
    // половиной морали; кость та же — поток генератора от морали не зависит.
    const foot = deploySetup({ infantry: 600 });
    const shot = (r: BattleResult): PhaseSpan => r.phases.find((p) => p.phase === 'ranged')!;
    for (let seed = 1; seed <= 4; seed += 1) {
      const fresh = simulateBattle({ seed, attacker: deploySetup({ archer: 300 }), defender: foot });
      const tired = simulateBattle({ seed, attacker: { ...deploySetup({ archer: 300 }), rest: 0.5 }, defender: foot });
      // Граница области: мораль уставших правда ниже (событие усталости), стрелы легли, а сами лучники в обстреле не
      // потеряли никого — не бежал никто, и стреляли все.
      expect(tired.log.some((e) => e.id === 'weary' && e.side === 'attacker'), `сид ${seed}: усталость`).toBe(true);
      expect(shot(fresh).losses.defender, `сид ${seed}: стрелы`).toBeGreaterThan(0);
      for (const r of [fresh, tired]) expect(shot(r).losses.attacker, `сид ${seed}: лучники в обстреле`).toBe(0);
      expect(shot(tired).losses.defender, `сид ${seed}: уставшие лучники выбили меньше свежих — урон зависит от морали`).toBe(shot(fresh).losses.defender);
    }
  });

  it('фронт без пехоты получает урон как все: лучники в первой линии теряют от стрел столько же, сколько во второй', () => {
    // Поставка 5 (docs/battle_eu4.md, 14.34; Д8): ×1.05 урона фронту без пехоты ушёл — у EU4 его нет, а монотонность,
    // которую он подпирал, держит правило флангов по доле (`setup.deployInto`). Лучники против лучников: рукопашной нет,
    // и всё, что сторона теряет в обстреле, — стрелы. Тот же отряд встаёт в первую линию (B) или во вторую (E); кость та же —
    // поток генератора от места не зависит.
    const shot = (r: BattleResult): PhaseSpan => r.phases.find((p) => p.phase === 'ranged')!;
    const foe = deploySetup({ archer: 300 });
    for (let seed = 1; seed <= 4; seed += 1) {
      const front = simulateBattle({ seed, attacker: foe, defender: setupOf({ B: { archer: 150 } }) });
      const rear = simulateBattle({ seed, attacker: foe, defender: setupOf({ E: { archer: 150 } }) });
      // Граница области: в первой линии стоят одни лучники — фронт без пехоты, прежнее правило здесь и било, — и стрелы легли.
      expect(shot(front).losses.defender, `сид ${seed}: стрелы`).toBeGreaterThan(0);
      expect(shot(front).losses.defender, `сид ${seed}: в первой линии лучники потеряли не столько же, сколько во второй — фронт без пехоты получает больше`).toBe(shot(rear).losses.defender);
    }
  });

  it('после слома круг не доигрывается: он обрывается в тик слома, в огне и в натиске, и дальше — отступление', () => {
    // Поставка 5 (docs/battle_eu4.md, 14.33; Г13): минимума фазы больше нет — драться после слома некому, сломанная моралью в
    // строю никого не держит. С фазами EU4 (14.35) правило то же для огня: иначе после слома в огне шли бы пустые тики до
    // конца половины круга.
    let inside = 0;
    for (const r of sampleBattles()) {
      const b = Math.min(r.sides.attacker.brokenAt ?? Infinity, r.sides.defender.brokenAt ?? Infinity);
      if (!Number.isFinite(b)) continue;
      const at = r.phases.findIndex((p) => b >= p.from && b <= p.to);
      const span = r.phases[at];
      if (!CIRCLE_PHASES.includes(span.phase)) continue;
      // Граница области: слом пришёлся на тик, после которого у фазы по расписанию круга ещё оставались тики.
      if (span.from + circleTicks(span.phase, span.round ?? 1) - 1 > b) inside += 1;
      expect(span.to, `${span.phase} ${span.from}–${span.to}: сломались на ${b}-м тике, а фаза шла дальше`).toBe(b);
      expect(r.phases[at + 1]?.phase, `после слома в «${span.phase}» — сразу отступление`).toBe('retreat');
    }
    expect(inside, 'боёв, сломавшихся посреди фазы').toBeGreaterThan(0);
  });

  it('стрелы бьют по морали одинаково весь бой: в дуэли лучников сектор бежит, потеряв долю, которую уносит его мораль', () => {
    // Поставка 5 (docs/battle_eu4.md, 14.33; Г19): «обвыклись» ушло — прежде после 8-го тика боя потери от стрел шли в
    // мораль вполсилы, и со второго круга обстрел пугал вдвое слабее первого. Отдельного счёта у морали нет (14.19.3): она
    // уходит от потерь одинаково. В дуэли лучников рукопашной нет вовсе — строя в первой линии нет ни у кого, — и мораль
    // уходит только от стрел: сектор (без пехоты, стреляет, не обойдён) бежит, потеряв долю `мораль рода / MORALE.perLoss`,
    // и не больше чем на тик сверх неё.
    const need = UNIT_STATS.archer.morale / MORALE.perLoss;
    let late = 0;
    for (const n of [150, 300, 456]) {
      for (let seed = 1; seed <= 4; seed += 1) {
        const r = simulateBattle({ seed, attacker: deploySetup({ archer: n }), defender: deploySetup({ archer: n }) });
        for (const e of r.log) {
          if (e.id !== 'sector-broken') continue;
          const init = stackTotal(r.sides[e.side].sectors[e.sector].initial);
          let lost = 0;
          for (const p of r.phases) {
            lost += p.bySector?.[e.side]?.[e.sector] ?? 0;
            if (e.tick <= p.to) break;
          }
          // Граница области: бежали после 8-го тика — там, где прежнее правило считало стрелы вполсилы.
          if (e.tick > 8) late += 1;
          expect(lost / init, `${n}, сид ${seed}: ${e.side}/${e.sector} бежал на ${e.tick}-м тике, потеряв ${(lost / init).toFixed(3)} при доле морали ${need.toFixed(3)}`).toBeGreaterThanOrEqual(need - 0.005);
          expect(lost / init, `${n}, сид ${seed}: ${e.side}/${e.sector} бежал на ${e.tick}-м тике, потеряв ${(lost / init).toFixed(3)} — стрелы пугали слабее своих потерь`).toBeLessThanOrEqual(need + 0.02);
        }
      }
    }
    expect(late, 'секторов, бежавших после 8-го тика').toBeGreaterThan(0);
  });

  it('армия больше W не бесполезна: большая держит поле дольше меньшей и выше трёх W, и ниже', () => {
    // Новый тест 3. Большая на четверть против меньшей, та же ширина: сторона держит поле, пока не сломалась. Точки —
    // по обе стороны трёх W: ниже вся армия в строю, выше лишние стоят в резерве и встают на место выбывших. Какая
    // точка где, утверждено в самом тесте — есть ли у меньшей резерв сверх нечётного остатка.
    const W = FRONT_WIDTH;
    const until = (r: BattleResult, side: Side): number => r.sides[side].brokenAt ?? r.ticks + 1;
    for (const [n, above] of [[Math.round(2.5 * W), false], [6 * W, true], [9 * W, true]] as const) {
      const small = scaleArmy(BALANCED_ARMY, n);
      const large = scaleArmy(BALANCED_ARMY, Math.round(n * 1.25));
      // Ниже трёх W в резерве меньшей — только нечётный остаток, не больше одного на род: края встают ровно поровну, и
      // нечётный ждёт в резерве (поставка 5, 14.33); выше — лишние сверх полной линии.
      const reserve = deploySetup(small).sectors.R;
      expect(UNIT_KINDS.some((k) => reserve[k] > 1), `${n}: резерв у меньшей сверх нечётного остатка`).toBe(above);
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

  it('фронт не шире W ни при расстановке, ни после ввода резерва, и края встают ровно поровну — нечётный ждёт в резерве', () => {
    // Слово владельца (поставка 5, docs/battle_eu4.md, 14.33): что сверх — в резерв, как у EU4; нечётный остаток на край не
    // встаёт. Одно правило округления на расстановку и на ввод резерва (`setup.edgesEvenly`), поэтому и проверка — на обоих.
    // Края поровну — это и зеркальность: свой край стороны смотрит на край противника, а не мимо.
    const odd = [FRONT_WIDTH + 1, FRONT_WIDTH + 3, 2 * FRONT_WIDTH + 1];
    const armies = [...odd.map((n) => stackOf({ infantry: n })), ...odd.map((n) => stackOf({ cavalry: n - FRONT_WIDTH })), ...compositionLattice().map((a) => stackOf(scaleArmy(a, holdSize() + 1)))];
    for (const a of armies) {
      const s = deploy(a, FRONT_WIDTH);
      for (const id of [...FRONT, 'D', 'E', 'F'] as const) expect(stackTotal(s[id]), `${JSON.stringify(a)}: ряд ${id} шире W`).toBeLessThanOrEqual(FRONT_WIDTH);
      expect(stackTotal(s.A), `${JSON.stringify(a)}: край первой линии`).toBe(stackTotal(s.C));
      expect(stackTotal(s.D), `${JSON.stringify(a)}: край второй линии`).toBe(stackTotal(s.F));
    }
    // Ввод резерва: дыры на краях поровну и нечётный резерв — край получает поровну, нечётный остаётся ждать.
    const into = reinforceInto(stackOf({ infantry: 7, archer: 5 }), { front: [4, 0, 4], rear: [3, 0, 3] });
    expect(into.front.map(stackTotal), 'дыры первой линии — поровну').toEqual([3, 0, 3]);
    expect(into.rear.map(stackTotal), 'дыры второй линии — поровну').toEqual([2, 0, 2]);
    expect(stackTotal(into.rest), 'нечётные ждут в резерве').toBe(2);
    // Бой с резервом: ни один ряд первой и второй линии шире W не встаёт — ширина зажимает только ряд обхода.
    let entered = 0;
    for (let seed = 1; seed <= 4; seed += 1) {
      for (const [a, b] of [[BALANCED_ARMY, COMPOSITIONS[8].army], [COMPOSITIONS[3].army, COMPOSITIONS[5].army]] as const) {
        const r = simulateBattle({ seed, attacker: deploySetup(scaleArmy(a, 5 * FRONT_WIDTH + 1)), defender: deploySetup(scaleArmy(b, 4 * FRONT_WIDTH + 1)) });
        entered += r.log.filter((e) => e.id === 'reserve-committed').length;
        for (const e of r.log) if (e.id === 'depth') expect(e.row, `сид ${seed}: ряд ${e.row} шире W после ввода резерва`).toBe('strike');
      }
    }
    // Граница области: резерв правда вставал — иначе «после ввода» проверялось бы даром.
    expect(entered, 'строк ввода резерва').toBeGreaterThan(0);
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
