// Расстановка: пустые заготовки и правило развёртывания. Раскладки игрока у удара нет, пресетов и
// быстрой атаки — тоже (docs/battle_eu4.md, 14.5): кто куда встанет, решает одно правило на всех, кто
// входит в бой. Сектора остались полем входа — их заполняет правило, а до поставки 2 и раскладка
// обороны игрока.
import { FRONT_WIDTH } from './config';
import { FRONT, REAR, SECTORS, UNIT_KINDS, type ArmySetup, type Sector, type Stack } from './types';

export const emptyStack = (): Stack => ({ spear: 0, infantry: 0, archer: 0, cavalry: 0, heavy: 0 });

export const stackOf = (part: Partial<Stack>): Stack => ({ ...emptyStack(), ...part });

export const stackTotal = (s: Stack): number => UNIT_KINDS.reduce((n, k) => n + s[k], 0);

export const emptySectors = (): Record<Sector, Stack> =>
  Object.fromEntries(SECTORS.map((id) => [id, emptyStack()])) as Record<Sector, Stack>;

/** Сумма по всем секторам. */
export function armyTotal(setup: ArmySetup): Stack {
  const out = emptyStack();
  for (const id of SECTORS) for (const k of UNIT_KINDS) out[k] += setup.sectors[id][k];
  return out;
}

// ---------- Правило развёртывания ----------
//
// Одно на всех, кто входит в бой (docs/battle_eu4.md, 14.5; решение владельца 27.09.2026 — ответ 2 в
// 14.13): как у EU4, строй заполняется от центра к краям до ширины фронта. Фланги — за конницей (14.21,
// как у EU4): конница встаёт первой — на края первой линии, поровну, до W на край. Пешие — первой линией
// в то, что конница оставила: центральная полоса до W, затем края. Конница, не вставшая на края, — в то,
// что осталось после пеших. Лучники — второй линией от центра, как пешие. Кто не встал — резерв (`R`).
// Своих чисел у правила нет, кроме W: ни долей по полосам, ни порогов; край конницы — вся полоса края.
//
// Меньшая армия поэтому стоит узко, и более широкая заходит ей во фланг — это и есть то, ради чего
// развёртывание от центра взято у EU4 буквально, а не «поровну на три полосы». А когда первая линия
// переполнена, в резерв уходят лишние пешие, а не конница: прежде пешие вставали первыми и вытесняли
// латных из строя, и большая армия того же состава проигрывала меньшей (разбор «лезвия», 14.20).

/** Полосы первой и второй линии слева направо со стороны своей армии; середина — центр. */
const LANES: ReadonlyArray<{ front: Sector; rear: Sector }> = FRONT.map((front, i) => ({ front, rear: REAR[i] }));
const CENTER = LANES.length >> 1;
const EDGES = LANES.map((_, i) => i).filter((i) => i !== CENTER);

/** Поровну по краям до их вместимости: сколько не влезло в один край, уходит в другой; лишний один — левому. */
function edgesEvenly(n: number, room: number[]): number[] {
  const out = room.map(() => 0);
  let left = n;
  let open = EDGES.filter((i) => room[i] > 0);
  while (left > 0 && open.length > 0) {
    const share = Math.floor(left / open.length);
    const extra = left - share * open.length;
    let moved = 0;
    open.forEach((i, j) => {
      const take = Math.min(room[i] - out[i], share + (j < extra ? 1 : 0));
      out[i] += take;
      moved += take;
    });
    left -= moved;
    open = open.filter((i) => out[i] < room[i]);
    if (moved === 0) break;
  }
  return out;
}

/** Сколько `n` встанет в каждую полосу: от центра (`center`) или с краёв (`edges`), до вместимости `room`. */
function fill(n: number, room: number[], from: 'center' | 'edges'): number[] {
  const out = room.map(() => 0);
  let left = n;
  const center = (): void => {
    out[CENTER] = Math.min(left, room[CENTER]);
    left -= out[CENTER];
  };
  const edges = (): void => {
    const e = edgesEvenly(left, room);
    for (const i of EDGES) {
      out[i] = e[i];
      left -= e[i];
    }
  };
  if (from === 'center') {
    center();
    edges();
  } else {
    edges();
    center();
  }
  return out;
}

/**
 * Разложить пару родов по частям `parts` (сумма — `a + b`) так, чтобы в каждой части была та же доля
 * родов, что во всех, — накопленным округлением: у каждой части ровно её число, у каждого рода — всё.
 */
function splitPair(a: number, b: number, parts: number[]): Array<[number, number]> {
  const total = a + b;
  let done = 0;
  let aDone = 0;
  return parts.map((p) => {
    done += p;
    const aCum = total > 0 ? Math.round((a * done) / total) : 0;
    const take = aCum - aDone;
    aDone = aCum;
    return [take, p - take];
  });
}

/**
 * Правило развёртывания: куда встанет каждый боец армии `army` при ширине фронта `width` (бойцов строя
 * на полосу). Кладёт армию целиком — сектора плюс резерв равны составу. Ширина бесконечна — пешие и
 * лучники встают в центр целиком, конница — на края, резерва нет: полоса вмещает всех.
 */
export function deploy(army: Partial<Stack>, width: number): Record<Sector, Stack> {
  const cap = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : Infinity;
  const into = deployInto(stackOf(army), { front: LANES.map(() => cap), rear: LANES.map(() => cap) });
  const sectors = emptySectors();
  LANES.forEach((lane, i) => {
    sectors[lane.front] = into.front[i];
    sectors[lane.rear] = into.rear[i];
  });
  sectors.R = into.rest;
  return sectors;
}

/**
 * То же правило, но в места, которые есть: `room` — сколько ещё встанет в ряд каждой полосы (слева направо со
 * стороны своей армии). Им ставится войско перед боем (`deploy`, места — ширина фронта) и им же резерв встаёт в
 * дыры строя посреди боя (`sim`, места — ширина минус те, кто в ряду стоит): правило одно на расстановку и на
 * ввод резерва, иначе резерв вставал бы не туда, куда встало бы то же войско с начала. Числа целые.
 */
export function deployInto(army: Stack, room: { front: readonly number[]; rear: readonly number[] }): { front: Stack[]; rear: Stack[]; rest: Stack } {
  const out = { front: LANES.map(() => emptyStack()), rear: LANES.map(() => emptyStack()), rest: emptyStack() };
  const place = (x: keyof Stack, y: keyof Stack | null, lanes: number[], row: 'front' | 'rear'): void => {
    const placed = lanes.reduce((n, v) => n + v, 0);
    const reserve = army[x] + (y ? army[y] : 0) - placed;
    const split = y ? splitPair(army[x], army[y], [...lanes, reserve]) : [...lanes, reserve].map((n): [number, number] => [n, 0]);
    lanes.forEach((_, i) => {
      out[row][i][x] += split[i][0];
      if (y) out[row][i][y] += split[i][1];
    });
    out.rest[x] += split[lanes.length][0];
    if (y) out.rest[y] += split[lanes.length][1];
  };
  // Конница — первой, на края; пешие — от центра в то, что осталось; конница сверх краёв — туда, где ещё есть место.
  const riders = army.cavalry + army.heavy;
  const flanks = fill(riders, room.front.map((r, i) => (EDGES.includes(i) ? r : 0)), 'edges');
  const foot = fill(army.spear + army.infantry, room.front.map((r, i) => r - flanks[i]), 'center');
  const more = fill(riders - flanks.reduce((n, v) => n + v, 0), room.front.map((r, i) => r - flanks[i] - foot[i]), 'edges');
  place('spear', 'infantry', foot, 'front');
  place('cavalry', 'heavy', flanks.map((n, i) => n + more[i]), 'front');
  place('archer', null, fill(army.archer, [...room.rear], 'center'), 'rear');
  return out;
}

/**
 * Раскладка руками — у обороны игрока до поставки 2 — ряд шире ширины не держит: кто сверх, стоит в резерве стороны
 * (`R`), как у всех (docs/battle_eu4.md, 14.5, автоматический резерв). Роды уходят в резерв в той же доле, в какой
 * стоят в секторе; всё целое, и армия не теряет ни одного.
 */
export function fitRows(sectors: Record<Sector, Stack>, width: number): Record<Sector, Stack> {
  const cap = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : Infinity;
  const out = Object.fromEntries(SECTORS.map((id) => [id, { ...sectors[id] }])) as Record<Sector, Stack>;
  for (const lane of LANES) {
    for (const id of [lane.front, lane.rear]) {
      const total = stackTotal(out[id]);
      if (total <= cap) continue;
      // Остаются в ряду `cap` человек: накопленным округлением по родам, чтобы доля родов в ряду не сдвинулась.
      let done = 0;
      let kept = 0;
      for (const k of UNIT_KINDS) {
        done += out[id][k];
        const keepCum = Math.round((cap * done) / total);
        const keep = keepCum - kept;
        kept = keepCum;
        out.R[k] += out[id][k] - keep;
        out[id][k] = keep;
      }
    }
  }
  return out;
}

/**
 * Сторона, вставшая по правилу развёртывания: так входят в бой все, у кого нет своей раскладки, — удар,
 * перехват, лагерь, вылазка, логова и отряды мира, викторина ежедневки, стенд ролика. `width` — ширина
 * фронта боя; нет — `FRONT_WIDTH`, та же, с которой бой идёт по умолчанию.
 */
export const deploySetup = (army: Partial<Stack>, width: number = FRONT_WIDTH): ArmySetup => ({ sectors: deploy(army, width) });

/** Проверка входа: хотя бы один боец, ни одного отрицательного или дробного числа. */
export function validateSetup(setup: ArmySetup): string | null {
  let total = 0;
  for (const id of SECTORS) {
    for (const k of UNIT_KINDS) {
      const n = setup.sectors[id][k];
      if (!Number.isInteger(n) || n < 0) return `сектор ${id}: ${k} = ${n}`;
      total += n;
    }
  }
  if (total === 0) return 'армия пуста';
  return null;
}

export { FRONT, REAR };
