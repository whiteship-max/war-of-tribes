// Правило развёртывания (docs/battle_eu4.md, 14.5, новый тест 1): одно на всех, кто входит в бой, от
// центра к краям до ширины фронта, и своих чисел у него нет, кроме W.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRONT_WIDTH } from './config';
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

  it('пешие встают от центра: центр до W, края поровну, резерв — только когда вся линия полна', () => {
    for (const a of ARMIES) {
      const s = deploy(a, W);
      const [l, c, r] = FRONT.map((id) => foot(s[id]));
      expect(c, `${JSON.stringify(a)}: центр`).toBe(Math.min(foot(a), W));
      expect(Math.abs(l - r), 'края поровну').toBeLessThanOrEqual(1);
      if (foot(s.R) > 0) for (const id of FRONT) expect(stackTotal(s[id]), `${id}: резерв при неполной линии`).toBe(W);
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
      if (horse(s.R) > 0) for (const id of FRONT) expect(stackTotal(s[id]), `${id}: конница в резерве при неполной линии`).toBe(W);
    }
  });

  it('фланги — за конницей: она встаёт на края первой, пешие — в центр и остаток; в переполненной линии в резерв уходят пешие', () => {
    // 14.21, как у EU4: конница занимает края первой линии до W на край, пешие — то, что осталось. Прежде пешие вставали
    // первыми, и лишняя пехота вытесняла латных из строя — и при расстановке, и при вводе резерва (разбор «лезвия», 14.20).
    // Граница области: в выборке есть армии, где правило решает, — первая линия переполнена, и в ней и пешие, и конница.
    const crowded = ARMIES.filter((a) => foot(a) > 0 && horse(a) > 0 && foot(a) + horse(a) > 3 * W);
    expect(crowded.length, 'армий с переполненной линией, где есть и пешие, и конница').toBeGreaterThan(0);
    for (const a of ARMIES) {
      const s = deploy(a, W);
      const [left, , right] = FRONT.map((id) => horse(s[id]));
      // На краях — вся конница, сколько её есть, но не больше двух полос: пешие места на краях у неё не отнимают.
      expect(left + right, `${JSON.stringify(a)}: конница на краях`).toBe(Math.min(horse(a), 2 * W));
      expect(Math.abs(left - right), `${JSON.stringify(a)}: края поровну`).toBeLessThanOrEqual(1);
    }
    for (const a of crowded) {
      const s = deploy(a, W);
      expect(foot(s.R), `${JSON.stringify(a)}: лишние пешие — в резерве`).toBe(Math.max(0, foot(a) - (3 * W - Math.min(horse(a), 2 * W))));
    }
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
    // Начальная расстановка — по-прежнему фланги за конницей: тот же состав в пустой строй встаёт иначе.
    const initial = deployInto(pool, { front: [10, 20, 15], rear: [5, 4, 0] });
    expect(initial.front.map(horse), 'при расстановке конница — на края').toEqual([10, 0, 15]);
  });

  it('лучники встают второй линией тем же порядком, что пешие', () => {
    for (const a of ARMIES) {
      const s = deploy(a, W);
      const [l, c, r] = REAR.map((id) => s[id].archer);
      expect(c).toBe(Math.min(a.archer, W));
      expect(Math.abs(l - r)).toBeLessThanOrEqual(1);
      if (s.R.archer > 0) for (const id of REAR) expect(s[id].archer).toBe(W);
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
