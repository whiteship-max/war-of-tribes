// Облики служанки (ЛЦ-6, docs/characters.md): три разные молодые женщины простого сословия — три лица, три покраски на одном
// крое. В покоях стоит лучшая (`BEST`), две другие — под флагом адреса `?maid=a|b|c`, для сравнения (стенд
// `?showcase=consort` ставит их рядом с супругой, гонцом, советником и котом).
//
// Палитра облика — восемь цветов: кожа, волосы, платье, лён (фартук, чепец, сорочка), дерево подноса, лента в косе и шнур,
// радужка, румянец. Всё остальное на листах — их светом и тенью (`paint.tone`): губы — из кожи и румянца, брови — из волос,
// веснушки — из кожи. Платье — приглушённое домашнее сукно, без золота: она не госпожа.

export type MaidId = 'a' | 'b' | 'c';
export const MAID_IDS: readonly MaidId[] = ['a', 'b', 'c'];

/** Восемь цветов облика (24 бита). */
export interface MaidPalette {
  skin: number;
  hair: number;
  dress: number;
  linen: number;
  wood: number;
  ribbon: number;
  iris: number;
  blush: number;
}

/** Черты, которые рисуются (брови, веки, губы, румянец, веснушки), и поправки к маске головы, которые строятся. */
export interface MaidFace {
  /** Брови: подъём дуги и толщина, м. */
  browArch: number;
  browThick: number;
  /** Ресницы: толщина линии века. */
  lash: number;
  /** Губы: насыщенность и полнота нарисованного края (0…1). */
  lipTint: number;
  lipFull: number;
  /** Румянец и веснушки (0…1). */
  blush: number;
  freckles: number;
  /** Маска: круглее у щёк и подбородка (доля), нос (доля), щёки-яблочки (доля). */
  round: number;
  nose: number;
  cheek: number;
}

export interface MaidLook {
  name: string;
  palette: MaidPalette;
  face: MaidFace;
}

export const MAID_LOOKS: Record<MaidId, MaidLook> = {
  a: {
    name: 'Медовая в мареновом сукне: русая коса, синяя лента',
    palette: { skin: 0xecb995, hair: 0xa87c48, dress: 0x6e4a3e, linen: 0xe6e0d2, wood: 0x8a5e36, ribbon: 0x3e5a78, iris: 0x5e86a6, blush: 0xe07a6a },
    face: { browArch: 0.0022, browThick: 0.0042, lash: 1.05, lipTint: 0.5, lipFull: 0.75, blush: 0.55, freckles: 1, round: 1.06, nose: 0.92, cheek: 1 },
  },
  b: {
    name: 'Каштановая в сером сукне: тёмная коса, красная лента',
    palette: { skin: 0xe8b28c, hair: 0x6c4428, dress: 0x56606a, linen: 0xe2ddd0, wood: 0x7a5232, ribbon: 0x9a3a2e, iris: 0x6a5432, blush: 0xd8705e },
    face: { browArch: 0.0016, browThick: 0.0048, lash: 1.15, lipTint: 0.45, lipFull: 0.65, blush: 0.45, freckles: 0.7, round: 1.1, nose: 1, cheek: 0.9 },
  },
  c: {
    name: 'Пшеничная в оливковом: светлая коса, вишнёвая лента',
    palette: { skin: 0xf0c09e, hair: 0xc79a5e, dress: 0x5c6448, linen: 0xe8e2d4, wood: 0x94683e, ribbon: 0x7a3046, iris: 0x6f8a58, blush: 0xe8806e },
    face: { browArch: 0.0026, browThick: 0.0038, lash: 1, lipTint: 0.55, lipFull: 0.8, blush: 0.6, freckles: 0.8, round: 1.03, nose: 0.88, cheek: 1.1 },
  },
};

/** Облик покоев — лучший по оценке (docs/characters.md, ЛЦ-6, «Оценка»). */
export const BEST: MaidId = 'b';

/** Облик по адресу (`?maid=a|b|c`), иначе — лучший. */
export function maidOf(search: string | null = typeof location !== 'undefined' ? location.search : null): MaidId {
  const v = search ? new URLSearchParams(search).get('maid') : null;
  return v === 'a' || v === 'b' || v === 'c' ? v : BEST;
}
