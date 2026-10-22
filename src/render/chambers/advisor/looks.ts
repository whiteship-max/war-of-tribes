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
  /** Борода: доля длины к бороде ЛЦ-5 (1 — по грудь лопатой, 0,4 — коротко стриженная). Нет поля — 1. */
  beard?: number;
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

// ---------- Облики совета Ратуши (РТ-1) ----------

/** Сеяный генератор облика: тот же `mulberry32`, что у кости партии (`game/sim/random.seeded`), — без импорта игры. */
function rnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Цвет между двумя 24-битными по доле `k`. */
function mixHex(a: number, b: number, k: number): number {
  const c = (sh: number): number => Math.round(lerp((a >> sh) & 255, (b >> sh) & 255, clamp01(k)));
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** Кожа людей совета — тона трёх обликов ЛЦ-5 и ещё два, смуглее и светлее. */
const SKINS = [0xd6a68a, 0xcc9a7e, 0xdcac90, 0xc08a6c, 0xe2b89e] as const;
/** Волосы молодости: тёмно-русые, каштан, рыжина, чернь, пшеница; седина — к цвету облика ЛЦ-5. */
const YOUNG_HAIR = [0x5a4232, 0x6e4a30, 0x8a4e2c, 0x2e2622, 0xa88a5c] as const;
const GREY = [0xd2cdc4, 0xb8b4ae, 0xe6e3dc] as const;
/** Мантия по должности: Староста — зелень, Казначей — вино и пурпур, Воевода — червлень и сталь. */
const ROBES: Readonly<Record<string, readonly number[]>> = {
  steward: [0x1e3a32, 0x2c4a28, 0x1e2648],
  treasurer: [0x4c1a26, 0x3e1e44, 0x5a2a1a],
  marshal: [0x6a1c18, 0x3a3c44, 0x4a2a1e],
};
const FURS = [0x5e3e28, 0x847c72, 0xe8e2d4, 0x3a2c22] as const;
const GEMS = [0x9a1424, 0x2a4a8a, 0x1a6a4a, 0x6a2a8a] as const;
const IRIS = [0x58687a, 0x4a4a52, 0x6a8a9a, 0x5a4a32, 0x3e5a3e] as const;

/**
 * Облик советника совета Ратуши (РТ-1): из зерна (`Advisor.look`), возраста и должности — лицо, седина, борода, мантия.
 * Набор тот же, что у советника ЛЦ-5 (`kit/`, `advisor/`): меняются только числа облика. Возраст ведёт седину (тёмные до
 * сорока, «соль с перцем» к пятидесяти, белые к шестидесяти), морщины, пятна и залысину; зерно — кожу, кость лица, брови,
 * бороду и цвета. Чистая функция: один и тот же советник — одно лицо на портрете и в покоях.
 */
export function lookOf(seed: number, age: number, post: string): AdvisorLook {
  const r = rnd(seed ^ 0x6c6f6f6b);
  const pick = <T>(xs: readonly T[]): T => xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))];
  const old = clamp01((age - 34) / 24);
  const grey = clamp01((age - 38) / 18);
  const skin = pick(SKINS);
  const young = pick(YOUNG_HAIR);
  const hair = mixHex(young, pick(GREY), grey * (0.85 + 0.15 * r()));
  const robe = pick(ROBES[post] ?? ROBES.steward);
  const fur = pick(FURS);
  return {
    name: `совет ${post} ${seed}`,
    palette: {
      skin,
      hair,
      robe,
      lining: mixHex(robe, 0x2c1c16, 0.6),
      fur,
      gold: pick([0xc8a048, 0xc09a3e, 0xb4ad9e]),
      gem: pick(GEMS),
      iris: pick(IRIS),
    },
    face: {
      browArch: lerp(0.0006, 0.0024, r()),
      browThick: lerp(0.0048, 0.0068, r()),
      bushy: lerp(0.3, 0.6, r()) + 0.35 * old,
      lash: lerp(0.68, 0.88, r()),
      forehead: 0.2 + 0.75 * old * lerp(0.8, 1.2, r()),
      crows: 0.25 + 0.75 * old * lerp(0.8, 1.2, r()),
      folds: 0.3 + 0.65 * old * lerp(0.8, 1.2, r()),
      spots: clamp01((age - 44) / 22) * lerp(0.3, 0.6, r()),
      lipTint: lerp(0.18, 0.3, r()) - 0.06 * old,
      recede: clamp01(lerp(-0.2, 0.45, r()) + 0.5 * old * old),
      ermine: r() < 0.25 ? 1 : 0,
      nose: lerp(0.98, 1.2, r()),
      jaw: lerp(0.94, 1.08, r()),
      brow: lerp(0.92, 1.14, r()),
      beard: lerp(0.4, 1.25, r()),
    },
  };
}

/** Облик по адресу (`?advisor=a|b|c`), иначе — лучший. */
export function advisorOf(search: string | null = typeof location !== 'undefined' ? location.search : null): AdvisorId {
  const v = search ? new URLSearchParams(search).get('advisor') : null;
  return v === 'a' || v === 'b' || v === 'c' ? v : BEST;
}
