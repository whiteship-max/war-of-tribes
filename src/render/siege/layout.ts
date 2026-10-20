// Раскладка ролика осады: город за стеной по её уровню, лагерь с рогатками, места машин (docs/gfx.md, ГФ-2). Чистая, без
// three: где что стоит, читают режиссура (`reel.ts` — пути фигур, камни, камера) и сцена (`stage.ts` — камень и дерево).
//
// Город и лагерь — те же кирпичики места боя ролика TW (`tw/site.ts`): стена с ходом, башни, дома набора города, шатры,
// рогатки и костры. Своего здесь — только то, что осада знает сверх боя: башня с орудием, машины лагеря и логово, если
// стены нет. Стена — та же, что в окне города, на любом уровне (Р-5, docs/siege_v2.md, 21.1): камень, башни южной стены
// города (`tw/town.TOWN_WALL_TOWERS`); от уровня стены вид не зависит — как и у окна города.
import type { Quality } from '../quality';
import { TW_SPEC } from '../reel/spec';
import { heightAt, type TwField } from '../reel/terrain';
import {
  CITY_M,
  GATE_HALF,
  POMERIUM,
  SQUARE_R,
  STREET_HALF,
  WALL_THICK,
  WALL_TOP,
  campOf,
  townHouses,
  type TwCamp,
  type TwHouse,
  type TwSite,
  type TwTower,
  type TwWall,
} from '../tw/site';
import { TOWN_HALF, TOWN_WALL_TOWERS, frameOf, toReel, townGround, type Box2 } from '../tw/town';
import type { SiegeShow, ShowMachine } from './show';

/**
 * Стена ролика — от −`WALL_HALF` до `WALL_HALF` по X, наружная грань на z = 0, город — к +Z, лагерь — к −Z. Это южная стена
 * настоящего города (docs/polish.md, П-6): от главных ворот до углов, где её встречают боковые стены (`tw/town.TOWN_HALF`).
 */
export const WALL_HALF = TOWN_HALF;
/** Рогатки лагеря — на этой линии; шатры — дальше от стены. */
export const STAKES_Z = -24;
export const CAMP_BACK = -30;
/** Площадь города — на столько за стеной. */
export const SQUARE_Z = 27;
/** Полуширина лагеря по X. */
const CAMP_HALF = 34;

/**
 * Вид стены ролика. До Р-5 он шёл от уровня частокола — брёвна до третьего, башен 2/4/6 (ГФ-2), — а окно города рисует
 * камень на любом уровне, и игрок видел в ролике деревянный город вместо своего каменного. Теперь вид один — города.
 */
export interface CastleLook {
  /** Частокол из брёвен. У города игрока — никогда (окно города — камень). */
  wood: false;
  /** Башен по стене без надвратной: углы и промежуточные южной стены города. */
  towers: number;
}

/** Вид стены ролика — тот же, что окно города, на любом уровне частокола. */
export const CASTLE_LOOK: CastleLook = { wood: false, towers: 2 + TOWN_WALL_TOWERS.inner.length };

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
  /**
   * Где за стеной ходят люди ролика (двор у ворот, полоса вдоль стены, улица, площадь, орудие) и поле перед стеной —
   * там настоящий город уступает место бою (`tw/town.townCut`). Логово — null.
   */
  town: { inside: Box2[]; outside: Box2; paint: Box2[] } | null;
}

/**
 * Башни стены ролика — башни южной стены города (`TOWN_WALL_TOWERS`): углы на концах стены, где в них входит кольцо города,
 * и промежуточные на своих местах; вид, размер и высота — города. Ролик смотрит на город воротами к лагерю (`inward` = 1):
 * восток города — слева, запад — справа (`tw/town.toReel`).
 */
function towersOf(seed: number): TwTower[] {
  const f = frameOf({ inward: 1, gateX: 0, z: 0 });
  const end = (t: { size: number }): number => WALL_HALF - (t.size * CITY_M) / 2;
  const { east, west, inner } = TOWN_WALL_TOWERS;
  const list = [
    { x: -end(east), t: east },
    { x: end(west), t: west },
    ...inner.map((t) => ({ x: toReel(f, t.x, t.z).x, t })),
  ];
  return list
    .sort((a, b) => a.x - b.x)
    .map(({ x, t }, i) => ({
      x: Math.round(x * 10) / 10,
      round: t.kind === 'round',
      size: t.size * CITY_M,
      h: t.height * CITY_M,
      seed: (seed * 31 + i * 7) >>> 0,
    }));
}

/**
 * Раскладка осады. `houses` — дома настоящего города у ворот (`city/town.ts`, уже без тех, что мешают бою): под огонь, дым и
 * перелёт камня; нет (тест, город не собран) — дома ролика по своей раскладке.
 */
export function layoutOf(show: SiegeShow, quality: Quality, houses: readonly TwHouse[] | null = null): SiegeLayout {
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
    look = CASTLE_LOOK;
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
      towers: towersOf(seed),
      side: 'defender',
    };
    // Под стеной — земля настоящего города (П-6): тот же мыс, что в окне города.
    field.town = townGround(frameOf(wall), field);
    wall.base = heightAt(field, 0, wall.thick / 2);
    site.wall = wall;
    site.square = square;
    site.street = { x: 0, half: STREET_HALF, z0: 0, z1: square.z };
    // Дома — не на дворе у ворот, где ждёт гарнизон (`yard`).
    const yard = { x0: -9, x1: 9, z0: wall.thick, z1: wall.thick + POMERIUM + 6 };
    site.houses = houses ? [...houses] : townHouses(wall, square.z + SQUARE_R + 14 - wall.thick - POMERIUM, [yard], square, spec.houses, seed);
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
  const gun = spots.gun;
  // Где за стеной ходят люди ролика: двор у ворот, полоса вдоль стены (чинят пролом, стоят у ворот), улица до площади,
  // площадь, орудие города; перед стеной — лагерь, машины и подход войска с поля (`field` группа — от края поля).
  const paint: Box2[] = wall
    ? [
        { x0: -10, x1: 10, z0: wall.thick, z1: wall.thick + POMERIUM + 6 },
        { x0: -STREET_HALF - 0.6, x1: STREET_HALF + 0.6, z0: wall.thick, z1: square.z },
        { x0: square.x - square.r - 1, x1: square.x + square.r + 1, z0: square.z - square.r - 1, z1: square.z + square.r + 1 },
      ]
    : [];
  const town = wall
    ? {
        inside: [...paint, { x0: -WALL_HALF + 2, x1: WALL_HALF - 2, z0: wall.thick, z1: wall.thick + POMERIUM }, { x0: gun.x - 3, x1: gun.x + 3, z0: gun.z - 3, z1: gun.z + 3 }],
        outside: { x0: -CAMP_HALF - 14, x1: CAMP_HALF + 14, z0: field.minZ, z1: -0.5 },
        paint,
      }
    : null;
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
    town,
  };
}
