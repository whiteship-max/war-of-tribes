// Материалы сцены — по одному на цвет палитры, общие на всё. Цвет каждого ведёт
// сезон (season.ts), поэтому экземпляры создаются здесь один раз и больше нигде.
//
// Наборов три:
// - KIT — для деталей набора (kit.ts): геометрия склеена в один меш и несёт цвет
//   вершин (контактное затемнение, разброс оттенка), поэтому vertexColors включён.
//   Особый член набора — `body`: белый множитель, в вершинах которого запечён
//   цвет палитры. Им красится всё, что сезон не трогает (стены, столбы, цоколь,
//   балки), — одна группа вместо пяти, вдвое меньше вызовов отрисовки;
// - LEGACY — для старых моделей без цвета вершин. Материал с vertexColors, получив
//   геометрию без атрибута color, красит её чёрным, так что смешивать наборы нельзя.
//   Когда все модели переедут на набор деталей, LEGACY исчезнет;
// - DECAL — плоские наложения на землю: вытоптанная земля (сезонная, с альфой
//   вершин) и умножающее пятно тени под зданием.
import * as THREE from 'three';
import { EMISSIVE_KEYS, PALETTE, type PaletteKey } from './palette';

/** Цвета, которым нужен материал. Небо и свет — нет: их берут напрямую из палитры. */
export const MATERIAL_KEYS = [
  'grass', 'grassDark', 'grassLight', 'field', 'dirt', 'trample', 'packed', 'paved', 'soil', 'sprout',
  'trunk', 'leaves', 'leaves2', 'bush', 'berry', 'rock', 'cut',
  'wood', 'woodDark', 'plank', 'timber',
  'thatch', 'thatchDark', 'hide', 'shingle', 'tile',
  'stone', 'stoneDark', 'stoneLight', 'plaster',
  'paintRed', 'paintBlue', 'gold', 'metal', 'bone', 'ore', 'dark', 'goat', 'cloth', 'barrel', 'stake',
  'skin', 'hair',
  'fire', 'fireInner', 'forge',
] as const satisfies readonly PaletteKey[];

export type MatKey = (typeof MATERIAL_KEYS)[number];

/** Общий тип: у Lambert и Basic есть color, и только он нужен сезону. */
export type ColorMaterial = THREE.Material & { color: THREE.Color };

function make(vertexColors: boolean): Record<MatKey, ColorMaterial> {
  const out = {} as Record<MatKey, ColorMaterial>;
  for (const key of MATERIAL_KEYS) {
    out[key] = EMISSIVE_KEYS.includes(key)
      ? new THREE.MeshBasicMaterial({ color: PALETTE[key], vertexColors, toneMapped: false })
      : new THREE.MeshLambertMaterial({ color: PALETTE[key], flatShading: true, vertexColors });
    out[key].name = key;
  }
  return out;
}

export const LEGACY = make(false);

/** Белый множитель: цвет несут вершины. Единственное «белое» в проекте — и его не видно. */
const body = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true });
body.name = 'body';

export const KIT: Record<MatKey, ColorMaterial> & { body: THREE.MeshLambertMaterial } = Object.assign(make(true), { body });

/**
 * Тот же белый множитель для инстансов (figures.ts): цвет несёт instanceColor,
 * а не вершины, поэтому vertexColors здесь выключен — иначе геометрия без
 * атрибута color покрасилась бы чёрным.
 */
export const INSTANCED = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
INSTANCED.name = 'instanced';

/** Ключ материала-декали: только то, что кладётся на землю. */
export type DecalKey = 'trample';

export const DECAL: Record<DecalKey, ColorMaterial> = {
  trample: new THREE.MeshLambertMaterial({
    color: PALETTE.trample,
    flatShading: true,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }),
};
DECAL.trample.name = 'trample';

/**
 * Пятно тени под зданием: честное умножение того, что уже нарисовано (трава,
 * дорога, снег), поэтому нигде не даёт чёрного и не зависит от сезона.
 * Растушёвка — цветом вершин к единице, альфу MultiplyBlending не смотрит.
 */
export const SHADE = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  vertexColors: true,
  blending: THREE.MultiplyBlending,
  transparent: true,
  depthWrite: false,
  fog: false,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
SHADE.name = 'shade';
