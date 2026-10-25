// Расстановка: пустые заготовки и правило развёртывания. Раскладки игрока у удара нет, пресетов и
// быстрой атаки — тоже (docs/battle_eu4.md, 14.5): кто куда встанет, решает одно правило на всех, кто
// входит в бой. Сектора остались полем входа — их заполняет правило, а до поставки 2 и раскладка
// обороны игрока.
import { BATTLE_RULES, FRONT_WIDTH, LONE_RIDER_RULES } from './config';
import { FRONT, REAR, SECTORS, UNIT_KINDS, type ArmySetup, type Sector, type Stack, type UnitKind } from './types';

export const emptyStack = (): Stack => ({ spear: 0, infantry: 0, archer: 0, cavalry: 0, heavy: 0 });

export const stackOf = (part: Partial<Stack>): Stack => ({ ...emptyStack(), ...part });

/** Рода ядра своим именем: под vite-node (отчёты) импорт читается через свойство модуля на каждом обращении. */
const KINDS: readonly UnitKind[] = UNIT_KINDS;
export const stackTotal = (s: Stack): number => {
  // Та же сумма в том же порядке, что `reduce` от нуля, — циклом: её зовут в каждом обходе групп боя.
  let n = 0;
  for (let i = 0; i < KINDS.length; i++) n += s[KINDS[i]];
  return n;
};

export const emptySectors = (): Record<Sector, Stack> =>
  Object.fromEntries(SECTORS.map((id) => [id, emptyStack()])) as Record<Sector, Stack>;

/** Сумма по всем секторам. */
export function armyTotal(setup: ArmySetup): Stack {
  const out = emptyStack();
  for (const id of SECTORS) for (const k of UNIT_KINDS) out[k] += setup.sectors[id][k];
  return out;
}

/**
 * Какая часть каждого сектора — гарнизон (`ArmySetup.garrison`): гарнизон каждого рода делится между секторами в доле
 * того, сколько этого рода стоит в каждом, накопленным округлением в порядке секторов — у сектора не больше, чем там
 * стоит, у рода — весь гарнизон. Гарнизона больше, чем рода в армии, не бывает: лишнее отброшено. Расстановка от этого не
 * зависит: это наблюдение для показа (ролик выводит вышедших из ворот), а не вход боя.
 */
export function garrisonShare(sectors: Record<Sector, Stack>, garrison: Partial<Stack>): Record<Sector, Stack> {
  const out = emptySectors();
  for (const k of UNIT_KINDS) {
    const total = SECTORS.reduce((n, id) => n + sectors[id][k], 0);
    const g = Math.min(total, Math.max(0, Math.round(garrison[k] ?? 0)));
    if (g <= 0) continue;
    let cum = 0;
    let given = 0;
    for (const id of SECTORS) {
      cum += sectors[id][k];
      const upTo = Math.round((g * cum) / total);
      out[id][k] = upTo - given;
      given = upTo;
    }
  }
  return out;
}

// ---------- Правило развёртывания ----------
//
// Одно на всех, кто входит в бой (docs/battle_eu4.md, 14.5; решение владельца 27.09.2026 — ответ 2 в
// 14.13): как у EU4, строй заполняется от центра к краям до ширины фронта. Фланги — за конницей (14.21,
// как у EU4): конница встаёт первой — на края первой линии, поровну, до W на край. Пешие — первой линией
// в то, что конница оставила: центральная полоса до W, затем края. Лучники — второй линией от центра, как
// пешие. Кто не встал — резерв (`R`).
//
// Полный строй — пеших и конных больше, чем мест в первой линии: конница встаёт не вся, а своей долей первой
// линии — долей всадников по головам среди пеших и конных армии (14.34, слово владельца). Это «X мест с
// края» EU4, где X выводится из состава, а не назначается; остальные каждого рода — в резерве. Большая армия
// того же состава ставит ту же первую линию, что меньшая, а лишние ждут в резерве. Прежде конница вставала на
// края вся, до W на край, и прибавка всадников у большей армии вытесняла с краёв её копья: «копья 300 + пехота
// 150 + лёгкая 150» на W, большая на 10 %, проигрывала меньшей, пока её не выручал ×1.05 фронту без пехоты.
// Неполный строй — как прежде: все в строю, конница с краёв.
// Края — ровно поровну: нечётный остаток на край не встаёт, а ждёт в резерве, и так — при расстановке и при
// вводе резерва, одним правилом округления (`edgesEvenly`; слово владельца, поставка 5, 14.33). Прежде
// «лишний один — левому» ставил одиночку на свой левый край у обеих сторон, а свой левый смотрит на чужой
// правый: одиночки стояли мимо друг друга, и бой, где центры бежали разом, стоял до потолка кругов.
// Своих чисел у правила нет, кроме W: ни долей по полосам, ни порогов; доля конницы — из состава армии.
// Резерв посреди боя встаёт без предпочтения рода (`reinforceInto`, как у EU4): фланги за конницей — только
// у начальной расстановки.
//
// Меньшая армия поэтому стоит узко, и более широкая заходит ей во фланг — это и есть то, ради чего
// развёртывание от центра взято у EU4 буквально, а не «поровну на три полосы». А когда первая линия
// переполнена, в резерв уходят лишние обоих родов, каждый своей долей: прежде пешие вставали первыми и
// вытесняли латных из строя (разбор «лезвия», 14.20), потом конница вставала вся и вытесняла пеших (14.34) —
// и в обоих случаях большая армия того же состава проигрывала меньшей.

/** Полосы первой и второй линии слева направо со стороны своей армии; середина — центр. */
const LANES: ReadonlyArray<{ front: Sector; rear: Sector }> = FRONT.map((front, i) => ({ front, rear: REAR[i] }));
const CENTER = LANES.length >> 1;
const EDGES = LANES.map((_, i) => i).filter((i) => i !== CENTER);

/**
 * Поровну по краям до их вместимости: сколько не влезло в один край, уходит в другой. Нечётный остаток, который поровну
 * не делится, на край не встаёт — одно правило округления на расстановку и на ввод резерва (поставка 5, 14.33).
 */
function edgesEvenly(n: number, room: number[]): number[] {
  const out = room.map(() => 0);
  let left = n;
  let open = EDGES.filter((i) => room[i] > 0);
  while (left > 0 && open.length > 0) {
    const share = Math.floor(left / open.length);
    let moved = 0;
    for (const i of open) {
      const take = Math.min(room[i] - out[i], share);
      out[i] += take;
      moved += take;
    }
    left -= moved;
    open = open.filter((i) => out[i] < room[i]);
    if (moved === 0) break;
  }
  return out;
}

/**
 * Сколько `n` встанет в каждую полосу: от центра (`center`) или с краёв (`edges`), до вместимости `room`. С краёв в центр
 * идут только те, кому на краях нет места, — не нечётный остаток при неполных краях: он ждёт в резерве, как у расстановки
 * от центра.
 */
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
    if (EDGES.every((i) => out[i] >= room[i])) center();
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
 * Ввод резерва в дыры строя посреди боя (`sim.refill`) — как у EU4, без предпочтения рода: «Infantry/cavalry will always
 * instantly deploy to fill any available space in the front row up to the combat width» (вики EU4, «Reinforcements»;
 * решение владельца по 14.21). Фланги за конницей — только у начальной расстановки (`deployInto`). Пешие и конные резерва
 * встают в дыры первой линии одним потоком — полосы тем же порядком, от центра к краям, — и в каждой дыре роды стоят в
 * той же доле, что во всём резерве. Лучники — во вторую линию от центра, как при расстановке. `room` — сколько ещё
 * встанет в ряд каждой полосы; кто не встал — остаётся в резерве (`rest`). Числа целые.
 */
export function reinforceInto(army: Stack, room: { front: readonly number[]; rear: readonly number[] }): { front: Stack[]; rear: Stack[]; rest: Stack } {
  const out = { front: LANES.map(() => emptyStack()), rear: LANES.map(() => emptyStack()), rest: emptyStack() };
  const foot = army.spear + army.infantry;
  const horse = army.cavalry + army.heavy;
  const lanes = fill(foot + horse, [...room.front], 'center');
  const reserve = foot + horse - lanes.reduce((n, v) => n + v, 0);
  // Пешие и конные в каждой дыре — долей их во всём резерве; внутри пеших и внутри конных — так же.
  const parts = splitPair(foot, horse, [...lanes, reserve]);
  const kinds = (x: keyof Stack, y: keyof Stack, share: number[]): void => {
    splitPair(army[x], army[y], share).forEach(([a, b], i) => {
      const into = i < LANES.length ? out.front[i] : out.rest;
      into[x] += a;
      into[y] += b;
    });
  };
  kinds('spear', 'infantry', parts.map(([f]) => f));
  kinds('cavalry', 'heavy', parts.map(([, h]) => h));
  const archers = fill(army.archer, [...room.rear], 'center');
  archers.forEach((n, i) => (out.rear[i].archer += n));
  out.rest.archer += army.archer - archers.reduce((n, v) => n + v, 0);
  return out;
}

/**
 * Правило развёртывания: куда встанет каждый боец армии `army` при ширине фронта `width` (бойцов строя
 * на полосу). Кладёт армию целиком — сектора плюс резерв равны составу. Ширина бесконечна — пешие и
 * лучники встают в центр целиком, конница — на края, резерва нет: полоса вмещает всех.
 */
export function deploy(army: Partial<Stack>, width: number, rules: number = BATTLE_RULES): Record<Sector, Stack> {
  const cap = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : Infinity;
  const into = deployInto(stackOf(army), { front: LANES.map(() => cap), rear: LANES.map(() => cap) }, rules);
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
 * стороны своей армии). Им ставится войско перед боем (`deploy`, места — ширина фронта). Резерв посреди боя встаёт
 * другим правилом — без предпочтения рода (`reinforceInto`): так у EU4, фланги за конницей у него — только при
 * начальной расстановке (решение владельца по 14.21). Числа целые.
 */
export function deployInto(
  army: Stack,
  room: { front: readonly number[]; rear: readonly number[] },
  rules: number = BATTLE_RULES,
): { front: Stack[]; rear: Stack[]; rest: Stack } {
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
  // Конница — первой, с краёв: в неполный строй — вся, в полный — своей долей первой линии (по головам среди пеших и
  // конных; 14.34, слово владельца). Сверх краёв — в центр, раньше пеших: иначе у армии, где конницы больше двух третей,
  // доля жила бы только у малой. Пешие — от центра в то, что осталось; конница, не вставшая долей, — в дыры, если остались.
  const riders = army.cavalry + army.heavy;
  const walkers = army.spear + army.infantry;
  const line = room.front.reduce((n, v) => n + v, 0);
  const share = riders + walkers > line ? Math.floor((line * riders) / (riders + walkers)) : riders;
  const flanks = fill(share, [...room.front], 'edges');
  const foot = fill(walkers, room.front.map((r, i) => r - flanks[i]), 'center');
  const more = fill(riders - flanks.reduce((n, v) => n + v, 0), room.front.map((r, i) => r - flanks[i] - foot[i]), 'edges');
  // Одинокий всадник (BTL-5, с версии правил `LONE_RIDER_RULES`): нечётный остаток ждёт в резерве, пока сторона стоит
  // линией (14.33), а у стороны, где пеших нет и края не взяли ни одного всадника, резерву встать некуда — она проиграла бы,
  // не войдя в бой. Такой всадник встаёт в центр.
  if (rules >= LONE_RIDER_RULES && walkers === 0 && riders > 0 && [...flanks, ...more].every((n) => n === 0)) {
    more[CENTER] = Math.min(riders, Math.max(0, room.front[CENTER] - flanks[CENTER] - foot[CENTER]));
  }
  place('spear', 'infantry', foot, 'front');
  place('cavalry', 'heavy', flanks.map((n, i) => n + more[i]), 'front');
  place('archer', null, fill(army.archer, [...room.rear], 'center'), 'rear');
  return out;
}

/**
 * Сторона, вставшая по правилу развёртывания: так входят в бой все, у кого нет своей раскладки, — удар,
 * перехват, лагерь, вылазка, логова и отряды мира, викторина ежедневки, стенд ролика. `width` — ширина
 * фронта боя; нет — `FRONT_WIDTH`, та же, с которой бой идёт по умолчанию. `rules` — версия правил боя (`BATTLE_RULES`,
 * BTL-0): запись старше версии раскладывается по своим.
 */
export const deploySetup = (army: Partial<Stack>, width: number = FRONT_WIDTH, rules: number = BATTLE_RULES): ArmySetup => ({
  sectors: deploy(army, width, rules),
});

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
  if (setup.behind) {
    for (const id of SECTORS) {
      for (const k of UNIT_KINDS) {
        const n = setup.behind[id][k];
        if (!Number.isInteger(n) || n < 0 || n > setup.sectors[id][k]) return `тыл ${id}: ${k} = ${n}`;
      }
    }
  }
  return null;
}

/** Часть секторов, которая не в тылу противника: строй своей полосы (`ArmySetup.behind`). Нет поля — все сектора. */
export function frontOf(setup: ArmySetup): Record<Sector, Stack> {
  if (!setup.behind) return setup.sectors;
  const out = emptySectors();
  for (const id of SECTORS) for (const k of UNIT_KINDS) out[id][k] = setup.sectors[id][k] - setup.behind[id][k];
  return out;
}

export { FRONT, REAR };
