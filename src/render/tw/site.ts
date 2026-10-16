// Место боя ролика TW: стена города, ворота, башни, улица к площади, лагерь осаждающих, логово в лесу
// (docs/battle_tw.md, раздел 13). Чистое, без three: где стоит стена и что на ней, читают и режиссура (`plan.ts` —
// высота фигур, лестницы, таран, ворота), и сцена (`fort.ts` — камень и дерево из набора города).
//
// Ядро стен не знает: бой у стены — полевой бой (docs/siege.md), и место ему даёт показ по метке записи
// (`BattleRecord.site`). Отсюда правило: место меняет, **где** стоят и **как** идут, но не **кто** и **когда** падает —
// потери, слом и бегство остаются журнальными (`site.test.ts`, «место не меняет темпа потерь»).
import { hash, heightAt, type TwField } from '../reel/terrain';

/**
 * Место боя — те же строки, что `BattleRecord.site` мира (`world/types.ts`). Своим типом: показ мира не читает
 * (`plan.test.ts`, «режиссура не тянет мир»), а строки сверяет тест.
 */
export type TwSiteKind = 'wall' | 'gate' | 'sortie' | 'camp' | 'joint' | 'lair';
export const SITE_KINDS: readonly TwSiteKind[] = ['wall', 'gate', 'sortie', 'camp', 'joint', 'lair'];

export const siteKindOf = (v: string | null | undefined): TwSiteKind | null =>
  v && (SITE_KINDS as readonly string[]).includes(v) ? (v as TwSiteKind) : null;

/**
 * Метр набора города в единицах сцены боя: рост бойца — `units.MAN_HEIGHT` (1.05) на 1.79 м эталона. Набор города
 * строит в метрах (`city/kit.ts`, `forts.ts`), сцена боя масштабирует его этим числом (сверяет тест).
 */
export const CITY_M = 1.05 / 1.79;

/** Стена: боевой ход над землёй, толщина, парапет — числа набора города (`forts.ts`), ход ниже (решение 18). */
export const WALL_TOP = 7.5 * CITY_M;
export const WALL_THICK = 2.4 * CITY_M;
export const PARAPET = 0.6 * CITY_M;
/** Проезд ворот: полуширина и высота свода (у надвратной набора — 4 × 5.6 м). */
export const GATE_HALF = 2.1 * CITY_M;
export const GATE_ARCH = 5.6 * CITY_M;
/** Надвратная башня: сторона квадрата и высота. */
export const GATEHOUSE = 9 * CITY_M;
export const GATEHOUSE_H = 13 * CITY_M;
/** Башни стены: сторона (квадратная) или поперечник (круглая), высота над ходом. */
export const TOWER = 6.6 * CITY_M;
export const TOWER_H = 11.5 * CITY_M;
/** Лестница: на столько от наружной грани стоит её пята; шаг лестниц вдоль строя. */
export const LADDER_FOOT = 2.2;
export const LADDER_STEP = 3.2;
/** Сколько штурмующих на одной лестнице сразу: снизу вверх, на шаг ступеней друг от друга. */
export const LADDER_QUEUE = 3;
export const LADDER_RUNG = 1.2;
/** Лезут со скоростью, единиц сцены в секунду; через стену по одной лестнице — фигура в столько секунд. */
export const CLIMB_SPEED = 1.3;
export const OVER_GAP = 0.55;
/** Таран бьёт раз в столько секунд; ворота, выбитые им, падают за столько секунд. */
export const RAM_PERIOD = 1.7;
export const GATE_FALL = 0.6;
/** Улица от ворот к площади: полуширина; площадь — радиус. */
export const STREET_HALF = 3.2;
export const SQUARE_R = 8;
/** Межпорядок: свободная полоса за стеной изнутри, где стоит гарнизон. */
export const POMERIUM = 5;
/** Полосы фронта в осаде шире: в зазоре между ними стоят башни стены. */
export const LANE_GAP_WALL = 5.2;

export interface TwTower {
  x: number;
  round: boolean;
  /** Сторона или поперечник, высота над землёй — единицы сцены. */
  size: number;
  h: number;
  seed: number;
}

export interface TwWall {
  /** Наружная грань по Z; внутрь, к городу, — `inward`. */
  z: number;
  inward: 1 | -1;
  /** Земля под стеной (абсолютная высота: город стоит на ровном) и боевой ход над ней. */
  base: number;
  top: number;
  thick: number;
  /** Стена — от −halfX до halfX; концы уходят назад углом. */
  halfX: number;
  gateX: number;
  gateHalf: number;
  /** Ворота: закрыты весь бой (null), открыты с начала (−Infinity) или выбиты на этой секунде. */
  gateAt: number | null;
  towers: TwTower[];
  /** Кто стоит за стеной: город этой стороны. */
  side: 'attacker' | 'defender';
}

export interface TwLadder {
  x: number;
  /** Отряд, что её ставит. */
  unit: number;
  /** Когда встала к стене (до этого — несут и поднимают). */
  raiseAt: number;
  /** Кто на ней — номера фигур, первый лезет первым. */
  queue: number[];
  /** Это лестница осадной башни: её не несут — она внутри башни, и сама лестница не рисуется (`TwSite.tower`). */
  tower?: boolean;
}

/**
 * Проём штурма из записи боя (`BattleRecord.openings`, мир — `world/wall.Opening`): чем лезли и на какую долю стены. Своим
 * типом: показ мира не читает (`plan.test.ts`, «режиссура не тянет мир»), а строки сверяет тест.
 */
export type TwOpeningId = 'breach' | 'gate' | 'tower' | 'ladders' | 'scaling';
export const OPENING_KINDS: readonly TwOpeningId[] = ['breach', 'gate', 'tower', 'ladders', 'scaling'];
export interface TwOpening {
  id: TwOpeningId;
  share: number;
  round: number;
}

/**
 * Чем идут на стену в каждом слоте фронта (0 — левый, 1 — середина, где ворота, 2 — правый): лестницы, пролом, ворота
 * после тарана, осадная башня — или глухая стена, где не лезет никто. Режиссура, а не счёт: ядро сужает фронт всем
 * полосам поровну, а ролик раскладывает проёмы по слотам, чтобы было видно, чем шли (`plan.slotUses`).
 */
export type SlotUse = 'ladders' | 'breach' | 'gate' | 'tower' | 'wall';

/** Осадная башня: у какого отряда, где у стены по X и когда подкатили. */
export interface TwSiegeTower {
  unit: number;
  x: number;
  /** Секунда, когда башня у стены и мост опущен. */
  at: number;
}

export interface TwRam {
  /** Отряд, что его катит, и середина ворот по X. */
  unit: number;
  x: number;
  /** Удары по воротам — секунды ролика. */
  hits: number[];
}

export interface TwHouse {
  x: number;
  z: number;
  /** Ширина по фасаду и глубина, единицы сцены; фасад смотрит по `yaw` (0 — на +Z). */
  w: number;
  d: number;
  yaw: number;
  floors: number;
  seed: number;
}

export interface TwTent {
  x: number;
  z: number;
  yaw: number;
  size: number;
  /** Шалаш из шкур (логово) или полотняный шатёр (лагерь). */
  hide: boolean;
  seed: number;
}

export interface TwCamp {
  tents: TwTent[];
  /** Рогатки перед лагерем: середина и разворот. */
  stakes: { x: number; z: number; yaw: number }[];
  fires: { x: number; z: number }[];
  /** Частокол логова: колья по кругу (с проходом к полю). */
  palisade: { x: number; z: number }[];
  /** Прямоугольник лагеря. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface TwSite {
  kind: TwSiteKind;
  wall: TwWall | null;
  ladders: TwLadder[];
  ram: TwRam | null;
  houses: TwHouse[];
  /** Площадь города и улица к ней от ворот (z — от стены до площади). */
  square: { x: number; z: number; r: number } | null;
  street: { x: number; half: number; z0: number; z1: number } | null;
  camp: TwCamp | null;
  /** Чем идут на стену по слотам фронта (`SlotUse`); нет — запись до стены-прохода: лестницы везде и таран у ворот. */
  uses?: SlotUse[];
  /** Осадная башня у стены; нет — не строили. */
  tower?: TwSiegeTower | null;
}

/** Прямоугольник по плану (для «здесь стоят люди — дом не ставить»). */
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

// ---------- Где стоит фигура ----------

/** Расстояние от наружной грани стены наружу (плюс — за стеной, в поле; минус — в толще и в городе). */
export const outOf = (w: TwWall, z: number): number => (w.z - z) * w.inward;

/** В проезде ворот: по X — внутри свода. */
export const inGate = (w: TwWall, x: number): boolean => Math.abs(x - w.gateX) < w.gateHalf;

/** Внутри следа башни (или надвратной). */
export function inTower(w: TwWall, x: number, z: number): boolean {
  const d = -outOf(w, z) - w.thick / 2;
  if (Math.abs(x - w.gateX) < GATEHOUSE / 2 && Math.abs(d) < GATEHOUSE / 2 && !inGate(w, x)) return true;
  for (const t of w.towers) if (Math.abs(x - t.x) < t.size / 2 && Math.abs(d) < t.size / 2) return true;
  return false;
}

/** Фигура на боевом ходу: в полосе от парапета до внутренней грани, не в проезде ворот и не в башне. */
export function onWalk(w: TwWall, x: number, z: number): boolean {
  const d = -outOf(w, z);
  // От наружной грани: передняя шеренга в свалке подаётся к самому парапету — и стоит на ходу, а не в камне.
  if (d < 0.02 || d > w.thick) return false;
  if (Math.abs(x) > w.halfX) return false;
  return !inGate(w, x);
}

/** Тело стены: точка внутри каменной толщи (вместе с парапетом), кроме проезда. Ходить здесь можно только поверху. */
export function inWallBody(w: TwWall, x: number, z: number): boolean {
  const d = -outOf(w, z);
  return d > 0.02 && d < w.thick - 0.02 && Math.abs(x) < w.halfX && !inGate(w, x);
}

/** Высота, на которой стоит фигура: боевой ход стены или земля. Одна на кадр, место павшего и стрелы. */
export function standY(f: TwField, site: TwSite | null, x: number, z: number): number {
  const w = site?.wall;
  if (w && onWalk(w, x, z)) return w.base + w.top;
  return heightAt(f, x, z);
}

/**
 * Высота на пути через стену по лестнице (штурм, ход 4): снаружи до пяты — земля, по лестнице — вверх, по ходу — верх
 * стены, за внутренней гранью — спрыгнул (быстро вниз). `d` — расстояние от наружной грани наружу.
 */
export function overLift(w: TwWall, d: number): number {
  if (d >= LADDER_FOOT) return 0;
  if (d > 0) return w.top * (1 - d / LADDER_FOOT);
  if (d >= -w.thick) return w.top;
  return Math.max(0, w.top - (-w.thick - d) * 3.5);
}

/** Насколько поднята лестница (0 — лежит на плечах, 1 — у стены) на секунде `t`. */
export const ladderUp = (l: TwLadder, t: number): number => {
  const k = (t - (l.raiseAt - 0.9)) / 0.9;
  return k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
};

/** Створки ворот: 0 — закрыты, 1 — распахнуты (выбиты внутрь). */
export function gateOpen(w: TwWall, t: number): number {
  if (w.gateAt === null) return 0;
  if (w.gateAt === -Infinity) return 1;
  const k = (t - w.gateAt) / GATE_FALL;
  return k <= 0 ? 0 : k >= 1 ? 1 : 1 - (1 - k) * (1 - k);
}

/** Дрожь створок от удара тарана: затухает за полсекунды. */
export function gateShake(ram: TwRam | null, t: number): number {
  if (!ram) return 0;
  let s = 0;
  for (const h of ram.hits) {
    const dt = t - h;
    if (dt >= 0 && dt < 0.5) s = Math.max(s, (1 - dt / 0.5) * Math.cos(dt * 40));
  }
  return s;
}

/** Ход тарана в такте: 0 — отведён, 1 — в воротах (удар). Между ударами — замах назад и разгон. */
export function ramSwing(ram: TwRam, t: number): number {
  for (const h of ram.hits) {
    const dt = t - h;
    if (dt > -RAM_PERIOD * 0.8 && dt <= 0) {
      const u = 1 + dt / (RAM_PERIOD * 0.8);
      return u < 0.55 ? -0.6 * Math.sin((u / 0.55) * Math.PI * 0.5) : -0.6 + 1.6 * ((u - 0.55) / 0.45) ** 2;
    }
    if (dt > 0 && dt < 0.25) return 1 - dt / 0.25;
  }
  return 0;
}

// ---------- Город за стеной ----------

const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

/**
 * Дома города за стеной: кварталы по обе стороны улицы от ворот к площади, межпорядок у стены свободен. Дом не встаёт
 * туда, где стоят люди (`avoid`), на улицу и на площадь. Дома набора города (`kit.house`) — фасадом к улице.
 */
export function townHouses(w: TwWall, depth: number, avoid: readonly Rect[], square: { x: number; z: number; r: number }, cap: number, seed: number): TwHouse[] {
  const out: TwHouse[] = [];
  const s = w.inward;
  const z0 = w.z + s * (w.thick + POMERIUM);
  for (const sideX of [1, -1]) {
    // Ряды домов вдоль улицы и за ними — кварталами, с проулками.
    for (let row = 0; row < 4; row++) {
      let zz = 0;
      for (let k = 0; zz < depth && out.length < cap; k++) {
        const h1 = hash(seed, row * 97 + k * 13 + (sideX > 0 ? 0 : 5000), 51);
        const h2 = hash(seed, row * 97 + k * 13 + (sideX > 0 ? 0 : 5000), 52);
        const wFront = 2.9 + h1 * 2.2;
        const d = 4.2 + h2 * 1.8;
        const x = w.gateX + sideX * (STREET_HALF + 0.6 + row * 8.6 + d / 2);
        const z = z0 + s * (zz + wFront / 2);
        zz += wFront + (hash(seed, row * 97 + k, 53) < 0.18 ? 2.2 : 0.25);
        if (Math.abs(x) + d / 2 > w.halfX - 2) continue;
        const r: Rect = { x0: x - d / 2 - 0.6, x1: x + d / 2 + 0.6, z0: z - wFront / 2 - 0.6, z1: z + wFront / 2 + 0.6 };
        if (avoid.some((a) => overlaps(a, r))) continue;
        if (Math.hypot(x - square.x, z - square.z) < square.r + Math.max(wFront, d) / 2 + 0.8) continue;
        // Фасад — к улице (к середине по X): глубина дома идёт поперёк улицы.
        out.push({ x, z, w: wFront, d, yaw: sideX > 0 ? -Math.PI / 2 : Math.PI / 2, floors: 2 + (hash(seed, row, k + 54) < 0.35 ? 1 : 0), seed: (seed + row * 131 + k * 17 + (sideX > 0 ? 0 : 7)) >>> 0 });
      }
    }
  }
  return out;
}

/** Башни по стене: между полосами фронта, у концов стены и через `step` по дальним пролётам; у ворот — надвратная. */
export function wallTowers(halfX: number, gateX: number, between: readonly number[], seed: number): TwTower[] {
  const xs = new Set<number>();
  for (const x of between) if (Math.abs(x - gateX) > GATEHOUSE / 2 + TOWER) xs.add(Math.round(x * 10) / 10);
  xs.add(Math.round((halfX - TOWER / 2) * 10) / 10);
  xs.add(Math.round((-halfX + TOWER / 2) * 10) / 10);
  // Дальние пролёты — башня через ≈ 22 единицы.
  const sorted = [...xs, gateX].sort((a, b) => a - b);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const gap = sorted[i + 1] - sorted[i];
    const n = Math.floor(gap / 22);
    for (let k = 1; k <= n; k++) xs.add(Math.round((sorted[i] + (gap * k) / (n + 1)) * 10) / 10);
  }
  return [...xs]
    .sort((a, b) => a - b)
    .map((x, i) => ({
      x,
      round: Math.abs(Math.abs(x) - (halfX - TOWER / 2)) < 0.05 || hash(seed, i, 61) < 0.35,
      size: TOWER * (0.95 + hash(seed, i, 62) * 0.15),
      h: TOWER_H * (0.92 + hash(seed, i, 63) * 0.16),
      seed: (seed * 31 + i * 7) >>> 0,
    }));
}

/**
 * Лагерь за строем стороны: шатры (у логова — шалаши из шкур), костры, рогатки по линии соприкосновения (лагерь
 * осаждающих) или частокол вокруг (логово). `back` — z тыла строя, `dir` — куда от строя лагерь.
 */
export function campOf(kind: TwSiteKind, halfX: number, back: number, dir: 1 | -1, lineZ: number, cap: number, seed: number): TwCamp {
  const lair = kind === 'lair';
  const z0 = back + dir * 3;
  const depth = lair ? 16 : 20;
  const wide = Math.max(14, halfX * (lair ? 0.7 : 1));
  const tents: TwTent[] = [];
  const fires: { x: number; z: number }[] = [];
  const step = lair ? 4.6 : 4.2;
  let n = 0;
  for (let zz = 1.5; zz < depth; zz += step * 0.95) {
    for (let x = -wide + 2; x <= wide - 2; x += step) {
      const h = hash(seed, n++, 71);
      if (h < 0.22 || tents.length >= cap) continue;
      const jx = (hash(seed, n, 72) - 0.5) * step * 0.45;
      const jz = (hash(seed, n, 73) - 0.5) * step * 0.4;
      if (h < 0.3) {
        fires.push({ x: x + jx, z: z0 + dir * (zz + jz) });
        continue;
      }
      tents.push({ x: x + jx, z: z0 + dir * (zz + jz), yaw: hash(seed, n, 74) * Math.PI * 2, size: (lair ? 1.5 : 1.8) + hash(seed, n, 75) * 0.7, hide: lair, seed: (seed + n * 11) >>> 0 });
    }
  }
  const stakes: { x: number; z: number; yaw: number }[] = [];
  const palisade: { x: number; z: number }[] = [];
  if (lair) {
    // Частокол логова: колья по прямоугольнику вокруг шалашей, проход к полю в середине передней стороны.
    const x0 = -wide - 1;
    const x1 = wide + 1;
    const zA = z0 - dir * 0.5;
    const zB = z0 + dir * (depth + 1);
    const per = 0.42;
    for (let x = x0; x <= x1; x += per) {
      if (Math.abs(x) > 3.2) palisade.push({ x, z: zA });
      palisade.push({ x, z: zB });
    }
    for (let k = 0; k * per <= depth + 1.5; k++) {
      palisade.push({ x: x0, z: zA + dir * k * per });
      palisade.push({ x: x1, z: zA + dir * k * per });
    }
  } else {
    // Рогатки — по линии соприкосновения, с проходами: через них и шли на лагерь (прошедшие — `Report.through`).
    for (let x = -halfX + 6, k = 0; x <= halfX - 6; x += 2.1, k++) {
      if (hash(seed, k, 76) < 0.2) continue;
      stakes.push({ x: x + (hash(seed, k, 77) - 0.5) * 0.6, z: lineZ, yaw: (hash(seed, k, 78) - 0.5) * 0.3 });
    }
  }
  return { tents, stakes, fires, palisade, x0: -wide, x1: wide, z0: Math.min(z0, z0 + dir * depth), z1: Math.max(z0, z0 + dir * depth) };
}

/** Где на поле нельзя ставить дерево: город (стена и за ней) и лагерь. */
export function siteBlocks(site: TwSite | null, x: number, z: number): boolean {
  if (!site) return false;
  const w = site.wall;
  if (w && outOf(w, z) < 6 && Math.abs(x) < w.halfX + 8) return true;
  const c = site.camp;
  if (c && x > c.x0 - 4 && x < c.x1 + 4 && z > c.z0 - 4 && z < c.z1 + 4) return true;
  return false;
}

/**
 * Земля места: мостовая улицы и площади, утоптанная земля города и лагеря. 0 — трава поля; `kind` — какой краской.
 */
export function siteGround(site: TwSite | null, x: number, z: number): { cobble: number; dirt: number } {
  const out = { cobble: 0, dirt: 0 };
  if (!site) return out;
  const w = site.wall;
  if (w) {
    const inside = -outOf(w, z);
    if (inside > 0 && Math.abs(x) < w.halfX + 1) {
      out.dirt = Math.min(1, inside / 2) * 0.75;
      const st = site.street;
      if (st && Math.abs(x - st.x) < st.half && inside < Math.abs(st.z1 - w.z) + 2) out.cobble = 1;
      const sq = site.square;
      if (sq && Math.hypot(x - sq.x, z - sq.z) < sq.r) out.cobble = 1;
    }
    // Дорога от ворот в поле — утоптана.
    if (inside <= 0 && Math.abs(x - w.gateX) < 2.2 && -inside < 30) out.dirt = Math.max(out.dirt, 0.55 * (1 + inside / 30));
  }
  const c = site.camp;
  if (c && x > c.x0 - 2 && x < c.x1 + 2 && z > c.z0 - 2 && z < c.z1 + 2) out.dirt = Math.max(out.dirt, 0.55);
  return out;
}
