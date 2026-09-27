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
// 14.13): как у EU4, строй заполняется от центра к краям до ширины фронта. Пешие — первой линией:
// центральная полоса до W, затем края поровну до W. Конница — с краёв первой линии, в то, что пешие
// оставили: края поровну, затем центр. Лучники — второй линией тем же порядком, что пешие. Кто не
// встал — резерв (`R`). Своих чисел у правила нет, кроме W: ни долей по полосам, ни порогов.
//
// Меньшая армия поэтому стоит узко, и более широкая заходит ей во фланг — это и есть то, ради чего
// развёртывание от центра взято у EU4 буквально, а не «поровну на три полосы».

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
  const a = stackOf(army);
  const cap = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : Infinity;
  const sectors = emptySectors();
  const place = (x: keyof Stack, y: keyof Stack | null, lanes: number[], row: 'front' | 'rear'): void => {
    const placed = lanes.reduce((n, v) => n + v, 0);
    const reserve = a[x] + (y ? a[y] : 0) - placed;
    const split = y ? splitPair(a[x], a[y], [...lanes, reserve]) : [...lanes, reserve].map((n): [number, number] => [n, 0]);
    lanes.forEach((_, i) => {
      sectors[LANES[i][row]][x] += split[i][0];
      if (y) sectors[LANES[i][row]][y] += split[i][1];
    });
    sectors.R[x] += split[lanes.length][0];
    if (y) sectors.R[y] += split[lanes.length][1];
  };
  const foot = fill(a.spear + a.infantry, LANES.map(() => cap), 'center');
  place('spear', 'infantry', foot, 'front');
  const horse = fill(a.cavalry + a.heavy, foot.map((n) => cap - n), 'edges');
  place('cavalry', 'heavy', horse, 'front');
  place('archer', null, fill(a.archer, LANES.map(() => cap), 'center'), 'rear');
  return sectors;
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
