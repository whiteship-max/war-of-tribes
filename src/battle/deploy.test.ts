// Правило развёртывания (docs/battle_eu4.md, 14.5, новый тест 1): одно на всех, кто входит в бой, от
// центра к краям до ширины фронта, и своих чисел у него нет, кроме W.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRONT_WIDTH } from './config';
import { compositionLattice, LATTICE_STEP } from './bench';
import { deploy, deployInto, reinforceInto, stackOf, stackTotal } from './setup';
import { FRONT, REAR, UNIT_KINDS, type Sector, type Stack } from './types';

const W = FRONT_WIDTH;
const foot = (s: Stack): number => s.spear + s.infantry;
const horse = (s: Stack): number => s.cavalry + s.heavy;

/**
 * Армии проверки: составы по всем родам ядра на разных размерах против W — меньше полосы, между
 * одной и тремя полосами, больше трёх полос (резерв). Каждая точка должна лежать там, где правило
 * вообще что-то решает, — это утверждается ниже, а не считается в голове (правило 11).
 */
const MIXES: Array<Partial<Stack>> = [
  { infantry: 1 },
  { spear: 3, infantry: 5 },
  { spear: 150, infantry: 200, archer: 150, cavalry: 100 },
  { infantry: 350, archer: 250 },
  { cavalry: 250, archer: 350 },
  { infantry: 400, heavy: 200 },
  { cavalry: 500, heavy: 100 },
  { spear: 300, archer: 300 },
  { archer: 600 },
  { heavy: 600 },
];
const SCALES = [0.1, 0.3, 0.7, 1, 1.5, 2.5];
const ARMIES: Stack[] = MIXES.flatMap((m) => SCALES.map((k) => stackOf(Object.fromEntries(Object.entries(m).map(([kind, n]) => [kind, Math.round((n ?? 0) * k)])))));

describe('правило развёртывания', () => {
  it('точки проверки лежат там, где правило решает', () => {
    const f = (a: Stack): number => foot(a);
    expect(ARMIES.some((a) => f(a) > W && f(a) < 3 * W), 'пешие шире центра, но уже трёх полос: края заполнены частью').toBe(true);
    expect(ARMIES.some((a) => f(a) + horse(a) > 3 * W), 'первая линия переполнена: есть резерв').toBe(true);
    expect(ARMIES.some((a) => horse(a) > 0 && f(a) < W && horse(a) < 2 * W), 'конница у неполного строя: только края').toBe(true);
    expect(ARMIES.some((a) => horse(a) > 2 * W && f(a) < W), 'конницы больше, чем вмещают края: встаёт и в центр').toBe(true);
    expect(ARMIES.some((a) => a.archer > 3 * W), 'лучников больше второй линии').toBe(true);
    expect(ARMIES.some((a) => a.spear > 0 && a.infantry > 0), 'два пеших рода вместе').toBe(true);
  });

  it('кладёт армию целиком: сектора плюс резерв — весь состав, ни одного лишнего и ни одного потерянного', () => {
    for (const a of ARMIES) {
      const s = deploy(a, W);
      for (const k of UNIT_KINDS) {
        const placed = (Object.values(s) as Stack[]).reduce((n, st) => n + st[k], 0);
        expect(placed, `${JSON.stringify(a)}: ${k}`).toBe(a[k]);
      }
      for (const st of Object.values(s) as Stack[]) for (const k of UNIT_KINDS) expect(Number.isInteger(st[k]) && st[k] >= 0).toBe(true);
    }
  });

  it('пешие и конница — первой линией, лучники — второй, и ни один ряд не шире W', () => {
    for (const a of ARMIES) {
      const s = deploy(a, W);
      for (const id of FRONT) {
        expect(s[id].archer, `${id}: лучников в первой линии нет`).toBe(0);
        expect(stackTotal(s[id])).toBeLessThanOrEqual(W);
      }
      for (const id of REAR) {
        expect(stackTotal(s[id]) - s[id].archer, `${id}: во второй линии только лучники`).toBe(0);
        expect(stackTotal(s[id])).toBeLessThanOrEqual(W);
      }
    }
  });

  it('пешие встают от центра: центр до W, края ровно поровну, в резерве — сверх полной линии и нечётный остаток', () => {
    // Слово владельца (поставка 5, 14.33): нечётный остаток на край не встаёт, а ждёт в резерве. Прежде тест держал «края
    // поровну ±1, резерв — только когда вся линия полна»: лишний один вставал на левый край, и у обеих сторон одиночки
    // смотрели мимо друг друга.
    for (const a of ARMIES) {
      const s = deploy(a, W);
      const [l, c, r] = FRONT.map((id) => foot(s[id]));
      expect(c, `${JSON.stringify(a)}: центр`).toBe(Math.min(foot(a), W));
      expect(l, `${JSON.stringify(a)}: края ровно поровну`).toBe(r);
      const free = FRONT.some((id) => stackTotal(s[id]) < W);
      if (free && foot(s.R) > 0) expect(foot(s.R), `${JSON.stringify(a)}: при неполной линии в резерве — только нечётный остаток`).toBe(1);
      // Роды в полосе — в той же доле, что во всех пеших: правило ставит пеших, а не выбирает род.
      if (foot(a) > 0) for (const id of FRONT) expect(Math.abs(s[id].spear - (foot(s[id]) * a.spear) / foot(a))).toBeLessThanOrEqual(1);
    }
  });

  it('конница встаёт с краёв первой линии: в центр — только когда края полны', () => {
    for (const a of ARMIES) {
      const s = deploy(a, W);
      const [left, center, right] = FRONT.map((id) => s[id]);
      if (horse(center) > 0) {
        expect(stackTotal(left), `${JSON.stringify(a)}: конница в центре при неполном левом крае`).toBe(W);
        expect(stackTotal(right), `${JSON.stringify(a)}: конница в центре при неполном правом крае`).toBe(W);
      }
      // В резерве конные — сверх полной линии или один нечётный, который на края поровну не делится (поставка 5, 14.33).
      const free = FRONT.some((id) => stackTotal(s[id]) < W);
      if (free && horse(s.R) > 0) expect(horse(s.R), `${JSON.stringify(a)}: при неполной линии в резерве — только нечётный конный`).toBe(1);
    }
  });

  // Тест «фланги — за конницей: она встаёт на края первой, пешие — в центр и остаток; в переполненной линии в резерв
  // уходят пешие» ушёл вместе с правилом, которое держал (слово владельца по 14.34): в полном строю конница вставала на
  // края вся, до W на край, и прибавка всадников у большей армии вытесняла с краёв её пеших. Его обещания — «фланги за
  // конницей» и «в полном строю лишние в резерве» — держат два теста ниже: (а) в полном строю первая линия от размера армии
  // не зависит, (б) на границе полного строя число конных в строю не прыгает. Конница с краёв — тест выше.

  /** Решётка составов в наименьших долях: состав `LATTICE_STEP`-ми, делённый на шаг, — целые числа по родам. */
  const units = compositionLattice().map((mix) => stackOf(Object.fromEntries(Object.entries(mix).map(([k, n]) => [k, (n ?? 0) / LATTICE_STEP]))));
  const times = (unit: Stack, n: number): Stack => stackOf(Object.fromEntries(UNIT_KINDS.map((k) => [k, unit[k] * n])));

  it('(а) в полном строю первая линия не зависит от размера армии того же состава: лишние каждого рода ждут в резерве', () => {
    // Слово владельца по 14.34: в полном строю конница занимает края своей долей — долей всадников по головам среди пеших и
    // конных армии, — это «X мест с края» EU4, выведенные из состава. Большая армия того же состава ставит ту же первую
    // линию, что меньшая; её перевес — в резерве. Состав — точно тот же: армии — целые кратные наименьших долей решётки.
    let decided = 0;
    let center = 0;
    for (const unit of units) {
      const heads = foot(unit) + horse(unit);
      if (heads === 0) continue;
      // Граница области, вторая: меньшая армия может поставить ту же линию — пеших и конных у неё не меньше, чем их стоит в
      // первой линии большей. У самой малой армии полного строя этого может не быть: при нечётном W 97 у состава «пехота,
      // лучники ×2, латные» на ней 146 пеших, а линия большей — 147 (W в центре и по 25 на краю), — повторить её она не может
      // ничем. При W 94 та же точка попадала в область по чётности. Поэтому наименьшая — вдвое за границей полного строя;
      // саму границу держит тест (б). Проверка — после свойства: мутация правила падает его утверждением, а не этим.
      const full = Math.floor((3 * W) / heads) + 1;
      const least = 2 * full;
      const armies = [least, least + 1, 2 * least + 3, 10 * least].map((n) => times(unit, n));
      const lines = armies.map((a) => {
        // Граница области: строй полон — пеших и конных больше, чем мест в первой линии; правило доли здесь и решает.
        expect(foot(a) + horse(a), `${JSON.stringify(a)}: строй полон`).toBeGreaterThan(3 * W);
        return deploy(a, W);
      });
      for (const s of lines.slice(1)) for (const id of FRONT) expect(s[id], `${JSON.stringify(unit)}: ряд ${id} у большей армии`).toEqual(lines[0][id]);
      const big = lines[lines.length - 1];
      const inLine = (f: (x: Stack) => number): number => FRONT.reduce((n, id: Sector) => n + f(big[id]), 0);
      expect(foot(armies[0]) >= inLine(foot) && horse(armies[0]) >= inLine(horse), `${JSON.stringify(unit)}: у меньшей людей на линию большей хватает`).toBe(true);
      // Правилу есть что решать: у большей армии конница ждёт в резерве, а края она делит с пешими.
      if (horse(big.R) > 0 && foot(big.A) > 0) decided += 1;
      if (foot(unit) > 0 && horse(big.B) > 0) center += 1;
    }
    expect(decided, 'составов, где у большей армии конница ждёт в резерве, а края она делит с пешими').toBeGreaterThan(0);
    expect(center, 'составов, где конница долей встаёт и в центр — раньше пеших').toBeGreaterThan(0);
  });

  it('(б) на границе полного строя число конных в строю не прыгает: 3W − 1, 3W и 3W + 1 пеших и конных', () => {
    // Слово владельца по 14.34. Граница — там, где строй становится полным: мест в первой линии три полосы по W. По одну
    // её сторону конница встаёт вся, по другую — своей долей, и доля берётся среди пеших и конных: лучники второй линии в
    // неё не входят. Прибавка одного пешего сдвигает долю не больше чем на одного всадника.
    let archers = 0;
    for (const unit of units) {
      if (foot(unit) === 0 || horse(unit) === 0) continue;
      const heads = foot(unit) + horse(unit);
      const riders = Math.round(((3 * W - 1) * horse(unit)) / heads);
      const walkers = 3 * W - 1 - riders;
      const cavalry = Math.round((riders * unit.cavalry) / horse(unit));
      const spear = Math.round((walkers * unit.spear) / foot(unit));
      const archer = Math.round((unit.archer * (3 * W - 1)) / heads);
      const walk: keyof Stack = unit.infantry > 0 ? 'infantry' : 'spear';
      if (archer > 0) archers += 1;
      const inLine = [0, 1, 2].map((plus) => {
        const a = stackOf({ spear, infantry: walkers - spear, archer, cavalry, heavy: riders - cavalry });
        a[walk] += plus;
        // Граница области: три армии — по обе стороны границы полного строя.
        expect(foot(a) + horse(a), `${JSON.stringify(a)}: пеших и конных`).toBe(3 * W - 1 + plus);
        const s = deploy(a, W);
        return FRONT.reduce((n, id) => n + horse(s[id]), 0);
      });
      for (let i = 1; i < inLine.length; i += 1) {
        expect(Math.abs(inLine[i] - inLine[i - 1]), `${JSON.stringify(unit)}: конных в строю ${inLine.join(' → ')}`).toBeLessThanOrEqual(1);
      }
    }
    expect(archers, 'армий с лучниками — тех, чья доля не должна их видеть').toBeGreaterThan(0);
  });

  it('резерв посреди боя встаёт без предпочтения рода, как у EU4: фланги за конницей — только при расстановке', () => {
    // Решение владельца по 14.21 (вики EU4, «Reinforcements»: «Infantry/cavalry will always instantly deploy to fill any
    // available space in the front row»). Пешие и конные резерва — в дыры первой линии одним потоком, в каждой дыре — в
    // доле их во всём резерве; лучники — во вторую линию от центра.
    const pool = stackOf({ infantry: 40, heavy: 30, archer: 12 });
    const into = reinforceInto(pool, { front: [10, 20, 15], rear: [5, 4, 0] });
    // Граница области: дыры есть и на краях, и в центре, а пеших и конных в резерве больше, чем дыр, — правилу есть что
    // решать: кому достанутся края.
    expect(foot(pool) + horse(pool), 'резерва больше, чем дыр').toBeGreaterThan(10 + 20 + 15);
    expect(into.front.map(stackTotal), 'все дыры первой линии закрыты').toEqual([10, 20, 15]);
    into.front.forEach((s, i) => {
      expect(Math.abs(horse(s) - (stackTotal(s) * horse(pool)) / (foot(pool) + horse(pool))), `полоса ${i}: конные в доле резерва`).toBeLessThanOrEqual(1);
    });
    expect(into.rear.map((s) => s.archer), 'лучники — во вторую линию от центра').toEqual([5, 4, 0]);
    for (const k of UNIT_KINDS) {
      const placed = [...into.front, ...into.rear].reduce((n, s) => n + s[k], 0) + into.rest[k];
      expect(placed, `${k}: резерв весь на счету`).toBe(pool[k]);
    }
    // Начальная расстановка — по-прежнему фланги за конницей: тот же состав в пустой строй встаёт иначе — конница только с
    // краёв, центр пешим. Прежде здесь стояло «[10, 0, 15]»: конница вставала на края вся, сколько войдёт, и это утверждение
    // ушло с тем правилом (слово владельца по 14.34); строй здесь полон, и конница встаёт своей долей — «(а)» выше.
    const initial = deployInto(pool, { front: [10, 20, 15], rear: [5, 4, 0] });
    // Верно для состава этого теста: конницы в полной линии меньше двух третей. Где её доля больше — она встаёт и в центр
    // («(а)» выше: «конница долей встаёт и в центр — раньше пеших»).
    expect(horse(initial.front[1]), 'при расстановке в центре конницы нет — у этого состава').toBe(0);
    expect(horse(initial.front[0]), 'при расстановке конница — с краёв').toBeGreaterThan(0);
    expect(horse(into.front[1]), 'при вводе резерва — и в центр').toBeGreaterThan(0);
  });

  it('лучники встают второй линией тем же порядком, что пешие', () => {
    for (const a of ARMIES) {
      const s = deploy(a, W);
      const [l, c, r] = REAR.map((id) => s[id].archer);
      expect(c).toBe(Math.min(a.archer, W));
      expect(l, 'края ровно поровну').toBe(r);
      // В резерве лучники — сверх полной второй линии или один нечётный (поставка 5, 14.33).
      if (s.R.archer > 0 && REAR.some((id) => s[id].archer < W)) expect(s.R.archer, 'при неполной линии в резерве — только нечётный').toBe(1);
    }
  });

  it('держит одно число — W: другая ширина — другая раскладка по тем же правилам, при бесконечной резерва нет', () => {
    const a = stackOf({ spear: 150, infantry: 200, archer: 150, cavalry: 100 });
    for (const w of [50, 100, W, 300]) {
      const s = deploy(a, w);
      for (const id of [...FRONT, ...REAR]) expect(stackTotal(s[id])).toBeLessThanOrEqual(w);
      expect(foot(s.B)).toBe(Math.min(foot(a), w));
    }
    const wide = deploy(a, Infinity);
    // Полоса вмещает всех: пешие и лучники — в центре целиком, конница — на краях, резерва нет.
    const side: Sector[] = ['D', 'F', 'R'];
    for (const id of side) expect(stackTotal(wide[id]), `${id} при бесконечной ширине`).toBe(0);
    expect(foot(wide.B) + wide.E.archer).toBe(foot(a) + a.archer);
    expect(horse(wide.A) + horse(wide.C)).toBe(horse(a));
    // Своих чисел нет и в исходнике: ни долей по полосам, ни порогов — только ноль и единица счёта.
    const src = readFileSync(new URL('./setup.ts', import.meta.url), 'utf8');
    // Правило — от шапки раздела до конца `deployInto`: расстановка и ввод резерва — один код.
    const rule = src.slice(src.indexOf('// ---------- Правило развёртывания'), src.indexOf('\n}\n', src.indexOf('export function deployInto')));
    const code = rule.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const literals = [...code.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)].map((m) => Number(m[1]));
    expect(literals.filter((n) => n !== 0 && n !== 1), 'числа в правиле развёртывания').toEqual([]);
  });
});
