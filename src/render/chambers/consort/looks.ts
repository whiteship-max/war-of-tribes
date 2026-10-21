// Облики супруги (ЛЦ-2, docs/characters.md): три покраски и три лица на одной сетке. В покоях стоит лучший (`BEST`), два
// других — под флагом адреса `?consort=a|b|c`, для сравнения (стенд `?showcase=consort` ставит все три рядом).
//
// Палитра каждого облика — семь цветов: кожа, волосы, сорочка, корсаж, юбка, золото, радужка. Всё остальное на листах —
// их светом и тенью (`paint.tone`: тёплый свет, холодная тень) и смесью между ними: губы и румянец — из кожи, брови —
// из волос.

export type ConsortId = 'a' | 'b' | 'c';
export const CONSORT_IDS: readonly ConsortId[] = ['a', 'b', 'c'];

/** Семь цветов облика (24 бита). */
export interface Palette {
  skin: number;
  hair: number;
  linen: number;
  bodice: number;
  skirt: number;
  gold: number;
  iris: number;
}

/** Черты лица, которые рисуются, а не строятся: брови, веки, губы, румянец, веснушки. */
export interface FaceStyle {
  /** Брови: подъём дуги и толщина у начала, м. */
  browArch: number;
  browThick: number;
  /** Ресницы и «стрелка» за внешним углом, м. */
  lash: number;
  wing: number;
  /** Губы: насыщенность цвета (0…1) и полнота нарисованного края. */
  lipTint: number;
  lipFull: number;
  blush: number;
  freckles: number;
  /** Тени на веке: доля цвета волос в смеси с кожей. */
  lidShade: number;
}

export interface Look {
  name: string;
  palette: Palette;
  face: FaceStyle;
}

export const LOOKS: Record<ConsortId, Look> = {
  a: {
    name: 'Осень: рыжая, лес и ржавчина',
    palette: { skin: 0xebb892, hair: 0x9a4220, linen: 0xe8dfcf, bodice: 0x2d5638, skirt: 0x7c4b2a, gold: 0xcfa54a, iris: 0x4f8a3c },
    face: { browArch: 0.0028, browThick: 0.0054, lash: 1, wing: 0.0042, lipTint: 0.45, lipFull: 0.6, blush: 0.38, freckles: 1, lidShade: 0.3 },
  },
  b: {
    name: 'Королевская: каштан, синь и багрец',
    palette: { skin: 0xe8b38b, hair: 0x5a3018, linen: 0xe6dccb, bodice: 0x27407e, skirt: 0x7e2028, gold: 0xd3aa4c, iris: 0x3f72a8 },
    face: { browArch: 0.0024, browThick: 0.0058, lash: 1.15, wing: 0.005, lipTint: 0.5, lipFull: 0.8, blush: 0.36, freckles: 0, lidShade: 0.36 },
  },
  c: {
    name: 'Золотая: мёд, слива и сталь',
    palette: { skin: 0xdfa77d, hair: 0xc2914c, linen: 0xe6ddcb, bodice: 0x5c2c56, skirt: 0x465269, gold: 0xc79d44, iris: 0x7d5a2c },
    face: { browArch: 0.0018, browThick: 0.0052, lash: 0.9, wing: 0.0032, lipTint: 0.42, lipFull: 0.5, blush: 0.3, freckles: 0, lidShade: 0.26 },
  },
};

/** Облик покоев — лучший по кругам качества (docs/characters.md, «Оценки»). */
export const BEST: ConsortId = 'b';

/** Облик по адресу (`?consort=a|b|c`), иначе — лучший. */
export function lookOf(search: string | null = typeof location !== 'undefined' ? location.search : null): ConsortId {
  const v = search ? new URLSearchParams(search).get('consort') : null;
  return v === 'a' || v === 'b' || v === 'c' ? v : BEST;
}
