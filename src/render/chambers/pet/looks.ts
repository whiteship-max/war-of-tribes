// Окрасы кота (ЛЦ-4, docs/characters.md): три кота одной породы на одной фигуре — рыжий полосатый, серый полосатый и
// чёрно-белый. В покоях — лучший (`BEST`), два других — под флагом адреса `?cat=a|b|c`, для сравнения (стенд
// `?showcase=consort&view=cats` ставит их рядом).
//
// Палитра окраса — шесть цветов: шерсть, полосы, светлое (грудь, морда, брюхо), мочка носа, радужка, кожа уха изнутри. Всё
// остальное на листе — их светом и тенью (`paint.tone`): тень под брюхом, свет по спине, мазки шерсти — тоном из-под себя.
import type { HeadSpec } from './figure';

export type CatId = 'a' | 'b' | 'c';
export const CAT_IDS: readonly CatId[] = ['a', 'b', 'c'];

export interface CatPalette {
  fur: number;
  stripe: number;
  pale: number;
  nose: number;
  iris: number;
  ear: number;
}

/** Где светлое: грудь и брюхо, морда (доля — как высоко), лапы («носки»); полосы — есть ли и насколько сильны. */
export interface CatMarks {
  /** Полосы (0 — нет, 1 — полные). */
  tabby: number;
  /** Светлая морда: 0 — только подбородок, 1 — до глаз («маска» чёрно-белого). */
  muzzle: number;
  /** Белая манишка и брюхо. */
  bib: number;
  /** Белые «носки»: высота, доля лапы. */
  socks: number;
}

export interface CatLook {
  name: string;
  palette: CatPalette;
  marks: CatMarks;
  head: HeadSpec;
}

export const CAT_LOOKS: Record<CatId, CatLook> = {
  a: {
    name: 'Рыжий полосатый: белая грудка и носки, медовые глаза',
    palette: { fur: 0xd8883c, stripe: 0x9a4818, pale: 0xf4e0bc, nose: 0xd98c84, iris: 0xd8a02a, ear: 0xe0a294 },
    marks: { tabby: 1, muzzle: 0.35, bib: 1, socks: 0.25 },
    head: { cheek: 0.009, muzzle: 0.014 },
  },
  b: {
    name: 'Серый полосатый: тёмные полосы, светлая морда, зелёные глаза',
    palette: { fur: 0x8c8b88, stripe: 0x2e2d2e, pale: 0xdcd6cb, nose: 0x9a6a6a, iris: 0x9ab446, ear: 0xc8968e },
    marks: { tabby: 1, muzzle: 0.3, bib: 0.6, socks: 0 },
    head: { cheek: 0.01, muzzle: 0.013 },
  },
  c: {
    name: 'Чёрно-белый: фрак, белая маска и носки, жёлтые глаза',
    palette: { fur: 0x26252a, stripe: 0x141317, pale: 0xf2eee6, nose: 0xd8949a, iris: 0xd2c23a, ear: 0xc89096 },
    marks: { tabby: 0, muzzle: 1, bib: 1, socks: 0.45 },
    head: { cheek: 0.008, muzzle: 0.012 },
  },
};

/** Окрас покоев — лучший по оценке (docs/characters.md, ЛЦ-4). */
export const BEST: CatId = 'b';

/** Окрас по адресу (`?cat=a|b|c`), иначе — лучший. */
export function catOf(search: string | null = typeof location !== 'undefined' ? location.search : null): CatId {
  const v = search ? new URLSearchParams(search).get('cat') : null;
  return v === 'a' || v === 'b' || v === 'c' ? v : BEST;
}
