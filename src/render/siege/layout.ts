// Раскладка ролика осады: город за стеной по её уровню, лагерь с рогатками, места машин (docs/gfx.md, ГФ-2). Чистая, без
// three: где что стоит, читают режиссура (`reel.ts` — пути фигур, камни, камера) и сцена (`stage.ts` — камень и дерево).
//
// Город и лагерь — те же кирпичики места боя ролика TW (`tw/site.ts`): стена с ходом, башни, дома набора города, шатры,
// рогатки и костры. Своего здесь — только то, что осада знает сверх боя: уровень стены (дерево или камень, сколько башен и
// какой высоты), башня с орудием, машины лагеря и логово, если стены нет.
import type { Quality } from '../quality';
import { TW_SPEC } from '../reel/spec';
import { hash, heightAt, type TwField } from '../reel/terrain';
import {
  GATE_HALF,
  GATEHOUSE,
  POMERIUM,
  SQUARE_R,
  STREET_HALF,
  TOWER,
  TOWER_H,
  WALL_THICK,
  WALL_TOP,
  campOf,
  townHouses,
  type TwCamp,
  type TwSite,
  type TwTower,
  type TwWall,
} from '../tw/site';
import type { SiegeShow, ShowMachine } from './show';

/** Стена ролика — от −`WALL_HALF` до `WALL_HALF` по X, наружная грань на z = 0, город — к +Z, лагерь — к −Z. */
export const WALL_HALF = 44;
/** Рогатки лагеря — на этой линии; шатры — дальше от стены. */
export const STAKES_Z = -24;
export const CAMP_BACK = -30;
/** Площадь города — на столько за стеной. */
export const SQUARE_Z = 27;
/** Полуширина лагеря по X. */
const CAMP_HALF = 34;

/** Вид замка по уровню частокола (docs/gfx.md, ГФ-2, «Замок по уровню»). */
export interface CastleLook {
  /** Частокол из брёвен (до третьего уровня) или камень. */
  wood: boolean;
  /** Башен по стене (без надвратной) и их высота против обычной. */
  towers: number;
  towerH: number;
}

/** Уровень частокола → вид замка: дерево до третьего, дальше камень; башен больше и они выше с уровнем. */
export function castleLook(level: number): CastleLook {
  const l = Math.max(1, Math.min(10, Math.round(level)));
  return { wood: l <= 3, towers: l <= 3 ? 2 : l <= 6 ? 4 : 6, towerH: l <= 3 ? 0.8 : 0.9 + (l - 4) * 0.05 };
}

/** Где стоит машина лагеря (по X и Z) и куда смотрит. */
export interface MachineSpot {
  id: ShowMachine | 'trebuchet' | 'gun';
  x: number;
  z: number;
}

export interface SiegeLayout {
  field: TwField;
  /** Место для кирпичиков боя: стена, дома, площадь, улица, лагерь. Лестницы, таран и башня — по машинам (`reel.ts`). */
  site: TwSite;
  /** Стена города; нет — осаждали логово. */
  wall: TwWall | null;
  look: CastleLook | null;
  /** Логово за частоколом — когда стены нет: шалаши и колья кольцом. */
  lair: TwCamp | null;
  /** Лагерь осаждающих: шатры, рогатки, костры. */
  camp: TwCamp;
  /** Места машин лагеря (камнемёт, требушет обстрела, таран, башня, лестницы) и орудия города. */
  spots: Record<MachineSpot['id'], MachineSpot>;
  /** Где ждёт гарнизон у ворот изнутри и где — площадь. */
  yard: { x: number; z: number };
  square: { x: number; z: number; r: number };
  /** Ход стены: z, на котором стоят защитники, и высота над землёй. */
  walkZ: number;
  walkY: number;
}

/** Башни стены: по уровню — сколько и какой высоты; у концов стены — круглые. */
function towersOf(look: CastleLook, seed: number): TwTower[] {
  const xs: number[] = [WALL_HALF - TOWER / 2, -(WALL_HALF - TOWER / 2)];
  const inner = look.towers - 2;
  // Внутренние башни — ровно по пролётам между надвратной и концами.
  for (let k = 0; k < inner; k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const n = Math.ceil(inner / 2);
    const j = Math.floor(k / 2) + 1;
    xs.push(side * (GATEHOUSE / 2 + ((WALL_HALF - GATEHOUSE / 2 - TOWER) * j) / (n + 1)));
  }
  return xs
    .sort((a, b) => a - b)
    .map((x, i) => ({
      x: Math.round(x * 10) / 10,
      round: Math.abs(Math.abs(x) - (WALL_HALF - TOWER / 2)) < 0.05 || hash(seed, i, 61) < 0.35,
      size: TOWER * (0.95 + hash(seed, i, 62) * 0.15),
      h: TOWER_H * look.towerH * (0.92 + hash(seed, i, 63) * 0.16),
      seed: (seed * 31 + i * 7) >>> 0,
    }));
}

export function layoutOf(show: SiegeShow, quality: Quality): SiegeLayout {
  const spec = TW_SPEC[quality];
  const seed = show.seed >>> 0;
  const field: TwField = {
    halfX: 92,
    minZ: -118,
    maxZ: 70,
    seed,
    land: show.ground.land,
    hill: null,
    river: null,
    woods: show.ground.woods,
    road: true,
    ridge: null,
    winter: show.ground.winter,
    // Город и стена — на ровном: волны земли гаснут к стене.
    calm: { z: -4, dir: 1 },
    forest: null,
  };
  const site: TwSite = { kind: 'wall', wall: null, ladders: [], ram: null, houses: [], square: null, street: null, camp: null };
  const square = { x: 0, z: SQUARE_Z, r: SQUARE_R };
  let wall: TwWall | null = null;
  let look: CastleLook | null = null;
  let lair: TwCamp | null = null;
  if (show.wall > 0) {
    look = castleLook(show.wall);
    wall = {
      z: 0,
      inward: 1,
      base: 0,
      top: WALL_TOP,
      thick: WALL_THICK,
      halfX: WALL_HALF,
      gateX: 0,
      gateHalf: GATE_HALF,
      gateAt: null,
      towers: towersOf(look, seed),
      side: 'defender',
      ...(look.wood ? { wood: true } : {}),
    };
    wall.base = heightAt(field, 0, wall.thick / 2);
    site.wall = wall;
    site.square = square;
    site.street = { x: 0, half: STREET_HALF, z0: 0, z1: square.z };
    // Дома — не на дворе у ворот, где ждёт гарнизон (`yard`).
    const yard = { x0: -9, x1: 9, z0: wall.thick, z1: wall.thick + POMERIUM + 6 };
    site.houses = townHouses(wall, square.z + SQUARE_R + 14 - wall.thick - POMERIUM, [yard], square, spec.houses, seed);
  } else {
    // Логово: шалаши за частоколом, проход к полю — к лагерю.
    lair = campOf('lair', 26, 6, 1, 0, spec.tents, seed + 5);
  }
  const camp = campOf('sortie', CAMP_HALF, CAMP_BACK, -1, STAKES_Z, spec.tents, seed);
  site.camp = camp;
  const walkZ = wall ? wall.z + wall.inward * (0.62) : 2;
  const walkY = wall ? wall.base + wall.top : 0;
  const spots: SiegeLayout['spots'] = {
    mangonel: { id: 'mangonel', x: -15, z: -31 },
    trebuchet: { id: 'trebuchet', x: 13, z: -37 },
    ram: { id: 'ram', x: 0, z: -28 },
    tower: { id: 'tower', x: 21, z: -30 },
    ladders: { id: 'ladders', x: -26, z: -28 },
    // Орудие города — на дворе за стеной, у башни: бьёт через стену навесом.
    gun: { id: 'gun', x: 12, z: wall ? wall.thick + 3.4 : 12 },
  };
  return {
    field,
    site,
    wall,
    look,
    lair,
    camp,
    spots,
    yard: { x: 0, z: wall ? wall.thick + POMERIUM * 0.7 : 10 },
    square,
    walkZ,
    walkY,
  };
}
