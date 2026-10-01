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
  slate: 0x5d646c,
  slateLight: 0x7c838a,
  // Земля.
  cobble: 0x8f887d,
  cobbleWarm: 0x9c8b72,
  cobbleDark: 0x6e6961,
  grime: 0x4d4236,
  dirt: 0x7d6649,
  dirtDark: 0x5c4a35,
  dirtLight: 0x9a8262,
  grass: 0x6c7d3c,
  grassDry: 0x96914f,
  grassDark: 0x4b5c2c,
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
  roofTints: [0xf0e6dc, 0xe8d0c0, 0xd8c0b0, 0xf4e0c8, 0xc8b8ac, 0xe0c8a8] as readonly number[],
  stoneTints: [0xf2ece4, 0xece0cc, 0xe4ddd2, 0xf0e4d0] as readonly number[],
  // Ночь: тёплый свет окон и факелов.
  windowWarm: 0xffb45a,
  torch: 0xff9a3c,
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
