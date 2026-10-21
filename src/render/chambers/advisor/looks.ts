// Облики советника (ЛЦ-5, docs/characters.md): три разных пожилых человека одной должности — три лица, три покраски на одном
// крое. В покоях стоит лучший (`BEST`), два других — под флагом адреса `?advisor=a|b|c`, для сравнения (стенд
// `?showcase=consort` ставит их рядом с супругой и гонцом).
//
// Палитра облика — восемь цветов: кожа, седина, мантия, подбой, мех ворота, золото цепи и перстня, камень, радужка. Всё
// остальное на листах — их светом и тенью (`paint.tone`): подрясник — из подбоя, губы и красные веки — из кожи, брови —
// из седины, тень в бороде — из седины и мантии.

export type AdvisorId = 'a' | 'b' | 'c';
export const ADVISOR_IDS: readonly AdvisorId[] = ['a', 'b', 'c'];

/** Восемь цветов облика (24 бита). */
export interface AdvisorPalette {
  skin: number;
  hair: number;
  robe: number;
  lining: number;
  fur: number;
  gold: number;
  gem: number;
  iris: number;
}

/** Черты, которые рисуются (брови, веки, морщины, губы, линия волос, мех), и поправки к маске головы, которые строятся. */
export interface AdvisorFace {
  /** Брови: подъём дуги, толщина и кустистость (доля волосков, торчащих из дуги). */
  browArch: number;
  browThick: number;
  bushy: number;
  /** Ресницы: толщина линии века. */
  lash: number;
  /** Морщины: глубина на лбу, у глаз («гусиные лапки») и носогубных складок (0…1). */
  forehead: number;
  crows: number;
  folds: number;
  /** Пигментные пятна на висках и лбу (0…1). */
  spots: number;
  /** Губы: насыщенность (0…1). */
  lipTint: number;
  /** Залысина: насколько поднята линия волос (0 — высокий лоб, 1 — лысое темя под зачёсом). */
  recede: number;
  /** Мех ворота: пятна-хвостики горностая (0 — сплошной мех). */
  ermine: number;
  /** Маска: нос длиннее и крупнее (доли), челюсть шире, надбровье сильнее. */
  nose: number;
  jaw: number;
  brow: number;
}

export interface AdvisorLook {
  name: string;
  palette: AdvisorPalette;
  face: AdvisorFace;
}

export const ADVISOR_LOOKS: Record<AdvisorId, AdvisorLook> = {
  a: {
    name: 'Канцлер в вине: соболий ворот, рубин, серебряная седина',
    palette: { skin: 0xd6a68a, hair: 0xd2cdc4, robe: 0x4c1a26, lining: 0x2c1c16, fur: 0x5e3e28, gold: 0xc8a048, gem: 0x9a1424, iris: 0x58687a },
    face: { browArch: 0.0016, browThick: 0.0058, bushy: 0.6, lash: 0.75, forehead: 0.8, crows: 0.85, folds: 0.8, spots: 0.35, lipTint: 0.2, recede: 0.45, ermine: 0, nose: 1.12, jaw: 1, brow: 1 },
  },
  b: {
    name: 'Хранитель печати в зелени: волчий ворот, сапфир, стальная седина',
    palette: { skin: 0xcc9a7e, hair: 0xb8b4ae, robe: 0x1e3a32, lining: 0x3a2a1c, fur: 0x847c72, gold: 0xc09a3e, gem: 0x2a4a8a, iris: 0x4a4a52 },
    face: { browArch: 0.0008, browThick: 0.0066, bushy: 0.9, lash: 0.85, forehead: 0.95, crows: 0.7, folds: 0.95, spots: 0.5, lipTint: 0.18, recede: 0.75, ermine: 0, nose: 1.2, jaw: 1.06, brow: 1.12 },
  },
  c: {
    name: 'Книжник в синем: горностай, изумруд, белая седина',
    palette: { skin: 0xdcac90, hair: 0xe6e3dc, robe: 0x1e2648, lining: 0x4a3a28, fur: 0xe8e2d4, gold: 0xb4ad9e, gem: 0x1a6a4a, iris: 0x6a8a9a },
    face: { browArch: 0.0022, browThick: 0.005, bushy: 0.45, lash: 0.7, forehead: 0.65, crows: 1, folds: 0.65, spots: 0.25, lipTint: 0.24, recede: 0.25, ermine: 1, nose: 1.04, jaw: 0.96, brow: 0.94 },
  },
};

/** Облик покоев — лучший по оценке (docs/characters.md, ЛЦ-5, «Оценка»). */
export const BEST: AdvisorId = 'a';

/** Облик по адресу (`?advisor=a|b|c`), иначе — лучший. */
export function advisorOf(search: string | null = typeof location !== 'undefined' ? location.search : null): AdvisorId {
  const v = search ? new URLSearchParams(search).get('advisor') : null;
  return v === 'a' || v === 'b' || v === 'c' ? v : BEST;
}
