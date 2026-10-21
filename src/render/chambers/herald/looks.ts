// Облики гонца (ЛЦ-3, docs/characters.md): три разных молодых человека одной службы — три лица, три покраски на одном
// крое. В покоях стоит лучший (`BEST`), два других — под флагом адреса `?herald=a|b|c`, для сравнения (стенд
// `?showcase=consort` ставит их рядом с супругой).
//
// Палитра облика — семь цветов: кожа, волосы, туника, кайма, плащ, кожа ремней и сапог, радужка. Всё остальное на листах —
// их светом и тенью (`paint.tone`: тёплый свет, холодная тень) и смесью между ними: чулки — из плаща, губы и обветренный
// румянец — из кожи, брови и щетина — из волос. Туника и кайма в игре — цвета герба державы (`folk.liveryOf`): гонец носит
// ливрею своего господина, как прежде (Г-10).

export type HeraldId = 'a' | 'b' | 'c';
export const HERALD_IDS: readonly HeraldId[] = ['a', 'b', 'c'];

/** Семь цветов облика (24 бита). */
export interface HeraldPalette {
  skin: number;
  hair: number;
  tunic: number;
  trim: number;
  cloak: number;
  leather: number;
  iris: number;
}

/** Черты, которые рисуются (брови, ресницы, щетина, обветренность, губы), и поправки к маске головы, которые строятся. */
export interface HeraldFace {
  /** Брови: подъём дуги и толщина у начала, м. */
  browArch: number;
  browThick: number;
  /** Ресницы: толщина линии века. */
  lash: number;
  /** Щетина (0…1) и обветренность — красные скулы и нос с дороги (0…1). */
  stubble: number;
  weather: number;
  /** Губы: насыщенность (0…1) и полнота нарисованного края. */
  lipTint: number;
  lipFull: number;
  /** Маска: нос длиннее и крупнее (доли), челюсть шире, надбровье сильнее. */
  nose: number;
  jaw: number;
  brow: number;
  /** Чёлка: сколько прядей падает на лоб. */
  fringe: number;
}

export interface HeraldLook {
  name: string;
  palette: HeraldPalette;
  face: HeraldFace;
}

export const HERALD_LOOKS: Record<HeraldId, HeraldLook> = {
  a: {
    name: 'Рыжий с севера: веснушчатый, медь и серая шерсть',
    palette: { skin: 0xe4ab86, hair: 0x8e4520, tunic: 0x2c4880, trim: 0xb48a2c, cloak: 0x6b6050, leather: 0x5c3a22, iris: 0x5c9070 },
    face: { browArch: 0.0012, browThick: 0.0062, lash: 0.8, stubble: 0.55, weather: 0.7, lipTint: 0.28, lipFull: 0.3, nose: 1, jaw: 1, brow: 1, fringe: 3 },
  },
  b: {
    name: 'Темноволосый: загар, каштан и зелёная шерсть',
    palette: { skin: 0xcf9268, hair: 0x3b2416, tunic: 0x8a2420, trim: 0xb48a2c, cloak: 0x4e5646, leather: 0x6a4222, iris: 0x8a5a26 },
    face: { browArch: 0.0008, browThick: 0.0066, lash: 0.95, stubble: 0.62, weather: 0.5, lipTint: 0.3, lipFull: 0.35, nose: 1.08, jaw: 1.06, brow: 1.1, fringe: 2 },
  },
  c: {
    name: 'Русый: ясные глаза, лён и ржавый плащ',
    palette: { skin: 0xdca079, hair: 0xa07a46, tunic: 0x2e5a32, trim: 0xd6d0bc, cloak: 0x7a4c2c, leather: 0x4a3020, iris: 0x4a78a8 },
    face: { browArch: 0.0016, browThick: 0.0058, lash: 0.85, stubble: 0.4, weather: 0.6, lipTint: 0.32, lipFull: 0.4, nose: 0.94, jaw: 0.96, brow: 0.95, fringe: 4 },
  },
};

/** Облик покоев — лучший по кругам качества (docs/characters.md, ЛЦ-3, «Круги лица»). */
export const BEST: HeraldId = 'b';

/** Облик по адресу (`?herald=a|b|c`), иначе — лучший. */
export function heraldOf(search: string | null = typeof location !== 'undefined' ? location.search : null): HeraldId {
  const v = search ? new URLSearchParams(search).get('herald') : null;
  return v === 'a' || v === 'b' || v === 'c' ? v : BEST;
}
