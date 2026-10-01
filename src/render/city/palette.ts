// Цвета вида «город» — одно место (docs/city.md, раздел 3). Ленивый кусок: общий `palette.ts`
// первой загрузки от города не растёт. Цвета — sRGB, как их пишет художник: слои текстур
// создаются в sRGB, тон вершин переводится в линейный при сборке (`geom.tint`).
// Чистых белого и чёрного нет ни в одном канале (правило палитры игры, держит `palette.test.ts`).

export const CITY = {
  // Камень: тёплый известняк и песчаник, бут серо-бурый, раствор светлый.
  limestone: 0xbfae8f,
  limestoneWarm: 0xc9a979,
  limestoneGrey: 0xa39d8f,
  sandstone: 0xb98d64,
  rubbleGrey: 0x8d877c,
  rubbleBrown: 0x8b7258,
  rubbleDark: 0x6b655d,
  mortar: 0xb3a892,
  // Штукатурка и дерево фахверка.
  plaster: 0xe2d8c3,
  plasterShade: 0xc8bba2,
  oak: 0x4a3423,
  oakLight: 0x6b4c33,
  timberGrey: 0x6f665a,
  // Окна, ставни, двери.
  glass: 0x2c3540,
  glassLit: 0x5a6672,
  lead: 0x24272b,
  shutterGreen: 0x4d5e3f,
  shutterRed: 0x7a3a2c,
  shutterBrown: 0x6a4a30,
  door: 0x5a3e28,
  iron: 0x2a2826,
  // Кровли.
  tile: 0xa65a3c,
  tileLight: 0xbc7350,
  tileDark: 0x7e4232,
  lichen: 0xa7a072,
  moss: 0x5f6b3a,
  slate: 0x5e6165,
  slateLight: 0x7b7e82,
  // Земля.
  cobble: 0x8f887d,
  cobbleWarm: 0x9c8b72,
  cobbleDark: 0x6e6961,
  grime: 0x4d4236,
  dirt: 0x7d6649,
  dirtDark: 0x5c4a35,
  dirtLight: 0x9a8262,
  grass: 0x6d7a43,
  grassDry: 0x8e8a58,
  grassDark: 0x56613b,
  clover: 0x5d7a3a,
  flowerWhite: 0xe8e4d4,
  flowerYellow: 0xd9bf45,
  leaf: 0x4f6b2e,
  leafLight: 0x7f9440,
  leafDark: 0x2f4320,
  rock: 0x9b9384,
  rockDark: 0x6f695e,
  furrow: 0x6f5a40,
  crop: 0x8a9443,
  // Витражи храма.
  stainBlue: 0x2f4670,
  stainRed: 0x7a2f2f,
  stainGold: 0xa98b3c,
  // Тона вершин: штукатурка домов, дерево, кровли.
  wallTints: [0xf2ece0, 0xefe0c0, 0xead2b8, 0xe0e2dc, 0xf0dcc8, 0xe8d6a8, 0xdcd2c4] as readonly number[],
  roofTints: [0xf4e8e0, 0xc8a890, 0x9c8070, 0xe8b8a8, 0xb0a8a0, 0xf0d0b8, 0x988070, 0xd8b0a0] as readonly number[],
  /** Тон сланца (серый) и дранки (выветренное дерево). */
  slateTint: 0xdcdcdc,
  shingleTint: 0xd8c4a8,
  stoneTints: [0xf2ece4, 0xece0cc, 0xe4ddd2, 0xf0e4d0] as readonly number[],
  // Площадь: навесы рядов (тон полотна) и товар на прилавках.
  awnings: [0xa8584a, 0x5a6e88, 0xc0a060, 0x6e7e50, 0xe0d8c4, 0x8a5a6a] as readonly number[],
  goods: [0x9a7a4a, 0x7a8a3a, 0xb0603a, 0xc8b070, 0x6a5a8a] as readonly number[],
  // Ночь: тёплый свет окон и факелов.
  windowWarm: 0xffb45a,
  torch: 0xffb050,
  // Небо и дымка вида (днём берутся из рига `next`).
  snow: 0xeef0f2,
} as const;

/** sRGB hex → линейные доли [0, 1] (как `Color.setHex` с управлением цветом). */
export function linear(hex: number): [number, number, number] {
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [f((hex >> 16) & 0xff), f((hex >> 8) & 0xff), f(hex & 0xff)];
}

/** sRGB hex → доли sRGB [0, 1] — для генератора текстур (слои пишутся в sRGB). */
export function srgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}
