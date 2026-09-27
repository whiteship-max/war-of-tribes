// Расстановки: пустые заготовки и пресеты быстрой атаки. Быстрая атака — не
// «плохой вариант», а разумный шаблон (раздел 15 документа). Но шаблон не один:
// четыре пресета, и какой из них пришёл, противник заранее не знает — поэтому
// известный контрер стандартной раскладки выигрывает не больше, чем любая
// настроенная армия. Настроенная армия должна выигрывать у быстрой атаки около
// 15% по потерям — это держит тест.
import { seededRng } from './rng';
import type { CavalryOrder } from './types';
import {
  FRONT,
  HORSE_KINDS,
  REAR,
  SECTORS,
  UNIT_KINDS,
  type ArmySetup,
  type Orders,
  type Sector,
  type Stack,
} from './types';

export const emptyStack = (): Stack => ({ spear: 0, infantry: 0, archer: 0, cavalry: 0, heavy: 0 });

export const stackOf = (part: Partial<Stack>): Stack => ({ ...emptyStack(), ...part });

export const stackTotal = (s: Stack): number => UNIT_KINDS.reduce((n, k) => n + s[k], 0);

export const emptySectors = (): Record<Sector, Stack> =>
  Object.fromEntries(SECTORS.map((id) => [id, emptyStack()])) as Record<Sector, Stack>;

export const DEFAULT_ORDERS: Orders = {
  cavalry: 'charge',
  heavy: 'charge',
  archer: 'nearest',
  spear: 'hold-line',
  infantry: 'hold-center',
};

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

/** Делит `n` на три части долями `shares`, остаток — в середину. Всё целое. */
function split3(n: number, shares: [number, number, number]): [number, number, number] {
  const a = Math.floor(n * shares[0]);
  const c = Math.floor(n * shares[2]);
  return [a, n - a - c, c];
}

// ---------- Пресеты ----------

export type QuickPresetId = 'standard' | 'anti-cavalry' | 'center-punch' | 'defense';
export const QUICK_PRESET_IDS: readonly QuickPresetId[] = ['standard', 'anti-cavalry', 'center-punch', 'defense'];

export interface QuickPreset {
  id: QuickPresetId;
  name: string;
  /** Раскладка любого состава целиком: ни один боец не остаётся за полем. */
  layout: (army: Stack) => ArmySetup;
}

/** Фронт из пехоты и копий: пехота держит центр, копья — фланги; чего нет, то заменяет другое. */
function frontLine(sectors: Record<Sector, Stack>, a: Stack, infantryShares: [number, number, number], spearShares: [number, number, number]): void {
  if (a.infantry > 0 && a.spear > 0) {
    const [il, im, ir] = split3(a.infantry, infantryShares);
    const [sl, sm, sr] = split3(a.spear, spearShares);
    sectors.A.infantry = il;
    sectors.B.infantry = im;
    sectors.C.infantry = ir;
    sectors.A.spear = sl;
    sectors.B.spear = sm;
    sectors.C.spear = sr;
  } else if (a.infantry > 0) {
    const [l, mid, r] = split3(a.infantry, [0.25, 0.5, 0.25]);
    sectors.A.infantry = l;
    sectors.B.infantry = mid;
    sectors.C.infantry = r;
  } else if (a.spear > 0) {
    const [l, mid, r] = split3(a.spear, [0.3, 0.4, 0.3]);
    sectors.A.spear = l;
    sectors.B.spear = mid;
    sectors.C.spear = r;
  }
}

function rearArchers(sectors: Record<Sector, Stack>, a: Stack, shares: [number, number, number]): void {
  const [dl, dm, dr] = split3(a.archer, shares);
  sectors.D.archer = dl;
  sectors.E.archer = dm;
  sectors.F.archer = dr;
}

/**
 * Конница — в резерв; но если некому держать фронт, она идёт первой: ждать ей нечего.
 * Оба конных рода кладутся одним правилом — в бою они конница, разные у них приказы.
 */
function cavalry(sectors: Record<Sector, Stack>, a: Stack): void {
  const frontEmpty = FRONT.every((id) => stackTotal(sectors[id]) === 0);
  for (const kind of HORSE_KINDS) {
    if (a[kind] <= 0) continue;
    if (frontEmpty) {
      const [l, mid, r] = split3(a[kind], [0.3, 0.4, 0.3]);
      sectors.A[kind] = l;
      sectors.B[kind] = mid;
      sectors.C[kind] = r;
    } else {
      sectors.R[kind] = a[kind];
    }
  }
}

/**
 * Приказ лёгкой коннице в быстрой атаке — «атаковать лучников».
 *
 * Пресет обязан ставить род по назначению: лёгкая держится на скорости, и без манёвра она
 * войску не прибавляет ничего (замер: 1.05 против 1.18 по полпути, docs/stable.md, раздел 4).
 * Тяжёлой пресет оставляет свой приказ: ей манёвр не нужен, она работает при любом.
 */
const LIGHT_ORDER: CavalryOrder = 'attack-archers';

export const QUICK_PRESETS: Record<QuickPresetId, QuickPreset> = {
  standard: {
    id: 'standard',
    name: 'Стандартная атака',
    // Пехота в центре, копья по флангам с малым якорем пехоты (без него фланг ломается
    // первым и тянет каскад), лучники в тылу 30/40/30, конница в резерве на то место,
    // где проигрываем, охват.
    layout: (a) => {
      const sectors = emptySectors();
      frontLine(sectors, a, [0.15, 0.7, 0.15], [0.5, 0, 0.5]);
      rearArchers(sectors, a, [0.3, 0.4, 0.3]);
      cavalry(sectors, a);
      return { sectors, plan: 'envelop', orders: { ...DEFAULT_ORDERS, cavalry: LIGHT_ORDER }, reserve: { kind: 'weakest' } };
    },
  },
  'anti-cavalry': {
    id: 'anti-cavalry',
    name: 'Анти-кавалерия',
    // Копья по всему фронту вместе с пехотой, лучники за ними бьют по коннице,
    // своя конница из резерва идёт на лучников противника, пока копья держат его конницу.
    layout: (a) => {
      const sectors = emptySectors();
      frontLine(sectors, a, [0.25, 0.5, 0.25], [0.35, 0.3, 0.35]);
      rearArchers(sectors, a, [0.3, 0.4, 0.3]);
      cavalry(sectors, a);
      return {
        sectors,
        plan: 'defense',
        orders: { cavalry: LIGHT_ORDER, heavy: 'attack-archers', archer: 'priority-cavalry', spear: 'priority-cavalry', infantry: 'hold-center' },
        reserve: { kind: 'weakest' },
      };
    },
  },
  'center-punch': {
    id: 'center-punch',
    name: 'Удар по центру',
    // Тяжёлый центр из пехоты прорывает строй, фланги слабее — копья с малым якорем
    // пехоты, лучники поддерживают центр, резерв входит, если центр начинает проигрывать.
    layout: (a) => {
      const sectors = emptySectors();
      frontLine(sectors, a, [0.15, 0.7, 0.15], [0.4, 0.2, 0.4]);
      rearArchers(sectors, a, [0.2, 0.6, 0.2]);
      cavalry(sectors, a);
      return {
        sectors,
        plan: 'assault',
        orders: { cavalry: LIGHT_ORDER, heavy: 'charge', archer: 'support-center', spear: 'hold-line', infantry: 'break-center' },
        reserve: { kind: 'center-losing' },
      };
    },
  },
  defense: {
    id: 'defense',
    name: 'Оборона',
    // Плотный фронт из пехоты и копий в каждом секторе, лучники сзади, конница в
    // резерве держит фланг: выходит навстречу обходу, иначе — туда, где проигрываем.
    layout: (a) => {
      const sectors = emptySectors();
      frontLine(sectors, a, [0.3, 0.4, 0.3], [0.3, 0.4, 0.3]);
      rearArchers(sectors, a, [0.25, 0.5, 0.25]);
      cavalry(sectors, a);
      return {
        sectors,
        plan: 'defense',
        orders: { cavalry: LIGHT_ORDER, heavy: 'hold-flank', archer: 'nearest', spear: 'hold-line', infantry: 'hold-center' },
        reserve: { kind: 'weakest' },
      };
    },
  },
};

/** Стандартный пресет для любого состава, с переопределениями: то, чем пользуются тесты и стенды. */
export function quickSetup(army: Partial<Stack>, over: Partial<ArmySetup> = {}): ArmySetup {
  return { ...QUICK_PRESETS.standard.layout(stackOf(army)), ...over };
}

/**
 * Разведданные о противнике для выбора пресета: сколько кого замечено. Чего
 * нет в объекте — неизвестно. Точность не важна: выбор смотрит на доли.
 */
export type Intel = Partial<Stack>;

/**
 * Веса пресетов. Без разведки — поровну; со свежими разведданными — сдвиг к
 * тому, что отвечает замеченному: много конницы — анти-кавалерия, много лучников —
 * удар по центру (сближаться быстрее), масса пехоты — оборона, медленные копья —
 * стандартный охват.
 */
export const PRESET_WEIGHTS = {
  base: 1,
  cavalryShare: 0.25,
  cavalryBonus: 3,
  archerShare: 0.35,
  archerBonus: 2,
  infantryShare: 0.5,
  infantryBonus: 1.5,
  spearShare: 0.4,
  spearBonus: 2,
};

export function presetWeights(intel?: Intel): Record<QuickPresetId, number> {
  const w: Record<QuickPresetId, number> = { standard: PRESET_WEIGHTS.base, 'anti-cavalry': PRESET_WEIGHTS.base, 'center-punch': PRESET_WEIGHTS.base, defense: PRESET_WEIGHTS.base };
  if (!intel) return w;
  const seen = stackOf(intel);
  const total = stackTotal(seen);
  if (total <= 0) return w;
  if ((seen.cavalry + seen.heavy) / total >= PRESET_WEIGHTS.cavalryShare) w['anti-cavalry'] += PRESET_WEIGHTS.cavalryBonus;
  if (seen.archer / total >= PRESET_WEIGHTS.archerShare) w['center-punch'] += PRESET_WEIGHTS.archerBonus;
  if (seen.infantry / total >= PRESET_WEIGHTS.infantryShare) w.defense += PRESET_WEIGHTS.infantryBonus;
  if (seen.spear / total >= PRESET_WEIGHTS.spearShare) w.standard += PRESET_WEIGHTS.spearBonus;
  return w;
}

/**
 * Быстрая атака: один из пресетов по сиду похода, со сдвигом под разведданные,
 * если они есть. Детерминирована: сервер по тому же сиду получит тот же пресет.
 * Сид смешивается с солью, чтобы выбор пресета не повторял разброс урона боя.
 */
export function quickAttack(army: Partial<Stack>, seed: number, intel?: Intel): { preset: QuickPresetId; setup: ArmySetup } {
  const weights = presetWeights(intel);
  const total = QUICK_PRESET_IDS.reduce((n, id) => n + weights[id], 0);
  let roll = seededRng((seed ^ 0x9e3779b9) >>> 0)() * total;
  let preset: QuickPresetId = 'standard';
  for (const id of QUICK_PRESET_IDS) {
    roll -= weights[id];
    if (roll < 0) {
      preset = id;
      break;
    }
  }
  return { preset, setup: QUICK_PRESETS[preset].layout(stackOf(army)) };
}

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
