// Палитра карты в духе карты кампании (docs/map_tw.md, раздел 3). Одно место на все цвета нового вида:
// земля, вода, снег, свет, чернила и пергамент. Гамма — та же, что у города (`render/city/palette.ts`):
// тёплая, приглушённая, «под солнцем»; чистого белого и чёрного нет ни в одном канале — правило города.

export type RGB = readonly [number, number, number];

/** «#rrggbb» → [r, g, b]. Разбирается один раз при загрузке модуля, а не в узлах решётки. */
export const rgbOf = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Цвета нового вида строками — для кистей холста. */
export const TW = {
  // ---- земля по классам: юг (выгоревший) и север (свежий); середина — смешением по широте ----
  plainSouth: '#aaa35f',
  plainNorth: '#879650',
  forestSouth: '#56692f',
  forestNorth: '#3d5530',
  hills: '#94895a',
  hillsNorth: '#7d7d4f',
  steppe: '#ad9f66',
  desert: '#cdb27c',
  /** Камень гор: светлый на свету, тёмный — в тени складки. */
  rock: '#928573',
  rockDark: '#6a6056',
  scree: '#8d8064',
  /** Снег: на свету тёплый, в тени голубой. */
  snow: '#e9ebe6',
  snowShade: '#b4c0cc',
  /** Иней зимой на равнине севера. */
  frost: '#c9cdc4',

  // ---- свет ----
  light: '#f3e2b8',
  shade: '#2c3346',

  // ---- вода ----
  deep: '#1d4057',
  sea: '#2b5b72',
  shallow: '#3f8a8c',
  foam: '#d8e2d6',
  beach: '#c8b88c',
  river: '#5a8f9c',
  riverDeep: '#467a8a',
  riverBank: '#4d5f34',
  ford: '#c9bf9e',

  // ---- линии людей ----
  road: '#b49b6a',
  roadEdge: '#6f5b3b',
  bridge: '#7a5a38',

  // ---- лес ----
  /** Подлесок: тёмная подложка под кронами, чтобы лес читался массой. */
  understory: '#2e4226',
  broadleaf: ['#56702f', '#4f6a2d', '#5f7734', '#4a6430', '#64793a', '#53692f'] as readonly string[],
  broadleafLit: ['#7a9142', '#71893e', '#829846', '#6c843f', '#8a9c4c', '#768c40'] as readonly string[],
  conifer: ['#2f4a2c', '#34502f', '#2b4430', '#385433', '#2d4729', '#33502f'] as readonly string[],
  coniferLit: ['#4a6a3e', '#527444', '#46644a', '#567848', '#45663b', '#4f7043'] as readonly string[],
  trunk: '#4a3423',
  treeShadow: 'rgba(28, 30, 22, 0.42)',

  // ---- старинная карта ----
  ink: '#3b2a1c',
  parchment: '#d9c49b',
  parchmentDark: '#b89f74',
} as const;

/** Те же цвета числами — для решётки света (`field.ts`). */
export const C = {
  plainSouth: rgbOf(TW.plainSouth),
  plainNorth: rgbOf(TW.plainNorth),
  forestSouth: rgbOf(TW.forestSouth),
  forestNorth: rgbOf(TW.forestNorth),
  hills: rgbOf(TW.hills),
  hillsNorth: rgbOf(TW.hillsNorth),
  steppe: rgbOf(TW.steppe),
  desert: rgbOf(TW.desert),
  rock: rgbOf(TW.rock),
  rockDark: rgbOf(TW.rockDark),
  scree: rgbOf(TW.scree),
  snow: rgbOf(TW.snow),
  snowShade: rgbOf(TW.snowShade),
  frost: rgbOf(TW.frost),
  light: rgbOf(TW.light),
  shade: rgbOf(TW.shade),
  deep: rgbOf(TW.deep),
  sea: rgbOf(TW.sea),
  shallow: rgbOf(TW.shallow),
  understory: rgbOf(TW.understory),
  parchment: rgbOf(TW.parchment),
  parchmentDark: rgbOf(TW.parchmentDark),
  ink: rgbOf(TW.ink),
} as const;
