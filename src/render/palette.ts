// Единая палитра проекта. Все цвета сцены берутся отсюда, по имени, — ни один
// модуль рендера не держит hex у себя: цвет по месту невозможно ни согласовать,
// ни перекрасить разом. Файл нарочно без three.js: это таблица чисел, и тест
// проверяет её напрямую (palette.test.ts).
//
// Правила палитры:
// - hex — это то, что видно на освещённой солнцем горизонтальной грани в полдень:
//   риг (lighting.ts) откалиброван так, что освещённость ≈ 1.08 × альбедо, а
//   Neutral tone mapping ниже 0.8 почти тождественный, поэтому цвет в таблице и
//   цвет на экране совпадают, и палитру можно подбирать в любом пикере;
// - теплохолодность делает свет, а не краска: материалы тёплые (солома, дерево,
//   земля), заполняющий свет и всё, что затемняет, — холодные. Синева теней
//   получается из полусферы (единственный свет в тени) и из множителей затемнения
//   с B > R (ниже), а в самой палитре «синих теней» нет;
// - чистого белого и чёрного нет ни в одном канале, кроме огня (он светится сам):
//   самое тёмное — проём `dark` (тёплый графит с фиолетом), самое светлое — штукатурка
//   и зимняя трава (снег с небом, а не белый лист);
// - сезон не заменяет палитру, а переопределяет её часть (SEASON_OVERRIDES): снег
//   ложится на то, что лежит горизонтально, — землю, кроны, крыши, дороги, — а стены,
//   столбы, камень цоколя и металл остаются собой.
import type { JobId, Season, TroopId } from '@/game/types';

export const PALETTE = {
  // ---------- Небо и свет ----------
  sky: 0xa7cfe9,
  /** Дымка: светлее и серее неба, в неё уходит дальний лес. */
  fog: 0xc4d9e8,
  skyDusk: 0xdc8c60,
  skyNight: 0x1a2238,
  /** Солнце — единственный источник с тенью: тёплое днём, оранжевое на закате. */
  sunDay: 0xffe4bf,
  sunDusk: 0xffb27a,
  /** Ночью та же лампа становится луной. */
  moon: 0x8ea3cf,
  /** Заполняющий свет: небо сверху — холодное, земля снизу — тёплая и глухая. */
  hemiSky: 0x9db7d9,
  hemiGround: 0x6e6a5c,
  hemiSkyNight: 0x46598a,
  hemiGroundNight: 0x2a2c38,
  fireLight: 0xff9a3a,
  snowflake: 0xe8eef4,
  smoke: 0xd8d2c8,

  // ---------- Земля и растительность ----------
  grass: 0x7fa552,
  grassDark: 0x66884a,
  grassLight: 0x97b85c,
  /** Тропинка лагеря и голая земля. Светлее и суше, чем пашня: дорога — не борозда. */
  dirt: 0x9a7b59,
  /** Вытоптанная земля: пятна у построек и обочины дорог. */
  trample: 0x7b6247,
  /** Утоптанная улица — шире и чуть темнее тропинки. */
  packed: 0x8f7657,
  /** Мостовая. */
  paved: 0x9c9891,
  /** Пашня. */
  soil: 0x6f4d31,
  sprout: 0x8ac652,
  trunk: 0x6b4a30,
  leaves: 0x4a8a48,
  leaves2: 0x5f9c4c,
  bush: 0x568f4c,
  berry: 0xc44060,
  rock: 0x8e8a82,
  /** Свежий срез пня и торец бревна. */
  cut: 0xc9a878,

  // ---------- Дерево ----------
  wood: 0x9d6d42,
  woodDark: 0x60432a,
  /** Тёс: светлые доски стен и фронтонов. */
  plank: 0xbf9463,
  /** Балки фахверка, конёк, перемычки. */
  timber: 0x5b4029,

  // ---------- Кровли ----------
  thatch: 0xcfa85e,
  thatchDark: 0xac8843,
  hide: 0xa77d55,
  shingle: 0x5c5650,
  tile: 0xb85a3e,

  // ---------- Камень и штукатурка ----------
  stone: 0x8f8b84,
  stoneDark: 0x6c6963,
  /** Верх цоколя. */
  stoneLight: 0xa8a49b,
  plaster: 0xe4dac6,

  // ---------- Отделка ----------
  paintRed: 0xb6432f,
  paintBlue: 0x336f9b,
  gold: 0xd4a544,
  metal: 0x5c5e64,
  bone: 0xe4dcc6,
  ore: 0xb8763a,
  /** Самый тёмный цвет сцены: проёмы дверей и окон, устье штольни. Не чёрный. */
  dark: 0x2b2733,
  goat: 0xe6dfd0,
  cloth: 0xc9b48c,
  barrel: 0x8c6238,
  stake: 0x60432a,
  skin: 0xd9a77a,
  hair: 0x3b2a20,

  // ---------- Огонь (светится сам, единственное исключение из правила про ff) ----------
  fire: 0xff7a1a,
  fireInner: 0xffd25a,
  forge: 0xff6a1a,
} as const;

export type PaletteKey = keyof typeof PALETTE;

/**
 * Одежда жителей по профессии. Фигурки рисуются инстансами с цветом на каждую,
 * поэтому это цвета, а не материалы, — но hex всё равно живёт только здесь.
 */
export const JOB_TINT: Record<JobId, number> = {
  idle: 0xb59a76,
  gatherer: 0x7fae5a,
  hunter: 0x8a5a3a,
  woodcutter: 0xc2803a,
  stonecutter: 0x8f8a80,
  miner: 0x6f6a62,
  farmer: 0xd0b45a,
  herder: 0xa8b06a,
  crafter: 0x5f7ea6,
  smith: 0x8a6a4a,
  scholar: 0x9a8ac0,
  shaman: 0x7a4fa0,
};

/** Одежда бойцов по виду: чем выше в лестнице, тем ближе к металлу. */
export const TROOP_TINT: Record<TroopId, number> = {
  clubman: 0x8a6a4a,
  spearman: 0xa2563f,
  archer: 0x6f8a4a,
  axeman: 0x9a5a2a,
  swordsman: 0x7a5f9a,
  shieldman: 0x4f6f9a,
  legionary: 0x8a8f96,
};

/** Ключи, которым разрешён канал ff: они не освещаются, а светятся. */
export const EMISSIVE_KEYS: PaletteKey[] = ['fire', 'fireInner', 'forge'];
/** Цвета источников света — не поверхности, правило про белое на них не действует. */
export const LIGHT_KEYS: PaletteKey[] = ['sunDay', 'sunDusk', 'fireLight'];

/**
 * Сезонные переопределения. Весна — сама палитра; лето, осень и зима меняют
 * только то, что меняется в природе. Материалы ведут цвет к этим значениям плавно —
 * см. season.ts. Новый материал, на который ложится снег, обязан попасть сюда.
 */
export const SEASON_OVERRIDES: Record<Season, Partial<Record<PaletteKey, number>>> = {
  spring: {},
  summer: {
    sunDay: 0xfff0d2,
    grass: 0x86a94f,
    grassDark: 0x6d8f45,
    grassLight: 0x9fbf58,
    dirt: 0xa2835f,
    trample: 0x846a4b,
    packed: 0x987e5e,
    paved: 0xa39f96,
    soil: 0x77552f,
    sprout: 0x96d054,
    leaves: 0x3f7f3e,
    leaves2: 0x559446,
    bush: 0x4d8744,
    rock: 0x92908a,
    thatch: 0xd9b264,
    thatchDark: 0xb89047,
    hide: 0xb08558,
    shingle: 0x605a53,
    tile: 0xc25f42,
    sky: 0x93c6ea,
    fog: 0xb8d5ea,
  },
  autumn: {
    sunDay: 0xffd6a0,
    grass: 0x9c9552,
    grassDark: 0x847c47,
    grassLight: 0xb0a44e,
    dirt: 0x8d7052,
    trample: 0x6f5940,
    packed: 0x826b50,
    paved: 0x938f88,
    soil: 0x62472b,
    sprout: 0xc9b04a,
    trunk: 0x62432b,
    leaves: 0xc4802f,
    leaves2: 0xdda43c,
    bush: 0xaa7833,
    rock: 0x89857d,
    thatch: 0xc29a52,
    thatchDark: 0x9f7c3b,
    hide: 0x9d7049,
    shingle: 0x554f48,
    tile: 0xaa5136,
    sky: 0xb9c0c6,
    fog: 0xc6cacc,
  },
  winter: {
    // Зимнее солнце бледное; снег голубой, не белый: с солнцем и полусферой он и так у предела.
    sunDay: 0xf2e6d4,
    grass: 0xd6dfe8,
    grassDark: 0xc4cfdb,
    grassLight: 0xe0e7ef,
    dirt: 0xb9c2cc,
    trample: 0xc0c8d1,
    packed: 0xc3cad3,
    paved: 0xd2d7dd,
    soil: 0xa9b3bd,
    sprout: 0xcdd8e2,
    trunk: 0x5a4030,
    leaves: 0xd3dde6,
    leaves2: 0xe0e8ef,
    bush: 0xcbd5de,
    rock: 0xb8bec6,
    thatch: 0xdbe2ea,
    thatchDark: 0xc9d2dc,
    hide: 0xd9dfe6,
    shingle: 0xd3d9e0,
    tile: 0xdfd9d5,
    sky: 0xacb9c9,
    fog: 0xbcc7d3,
  },
};

/** Плотность снега по сезону: гонит частицы, дым и белизну. */
export const SEASON_SNOW: Record<Season, number> = { spring: 0, summer: 0, autumn: 0, winter: 1 };

/** Высота солнечной дуги по сезону: осенью и зимой солнце ниже, тени длиннее. */
export const SEASON_SUN_ARC: Record<Season, number> = { spring: 1, summer: 1.05, autumn: 0.9, winter: 0.8 };

/** Цвет палитры в сезоне: переопределение, если есть, иначе базовый. */
export const seasonColor = (season: Season, key: PaletteKey): number =>
  SEASON_OVERRIDES[season][key] ?? PALETTE[key];

/** Ключи, которые хоть в одном сезоне отличаются от базы — их и переливает сезон. */
export const SEASONAL_KEYS: PaletteKey[] = (Object.keys(PALETTE) as PaletteKey[]).filter((k) =>
  (Object.keys(SEASON_OVERRIDES) as Season[]).some((s) => SEASON_OVERRIDES[s][k] !== undefined),
);

export const isSeasonal = (key: PaletteKey): boolean => SEASONAL_KEYS.includes(key);

// ---------- Множители вершин ----------
//
// Не цвета, а линейные множители к цвету материала. Все затемнения холодные
// (B > R): тень от неба синеет. Умножая сезонный цвет, они зимой сами дают
// сине-серую тень на снегу — без единой зимней строки в коде.

export type Mul = readonly [number, number, number];

/** Низ цоколя: самое сильное контактное затемнение. */
export const AO_BASE: Mul = [0.62, 0.63, 0.72];
/** Низ стены: мягче, только нижняя половина. */
export const AO_WALL: Mul = [0.86, 0.87, 0.92];
/** Основание столба. */
export const AO_POST: Mul = [0.78, 0.79, 0.86];
/** Пятно под зданием на земле (умножающая декаль). */
export const GROUND_SHADE: Mul = [0.68, 0.7, 0.8];
/**
 * Пятна травы: от сырой низины (темнее, чуть синее) до выгоревшего бугра (светлее,
 * чуть желтее). Сдвиг оттенка нарочно мал: те же множители лежат на зимнем снегу,
 * и жёлтый уклон превратил бы его в болото.
 */
export const GRASS_DARK_MUL: Mul = [0.82, 0.86, 0.86];
export const GRASS_LIGHT_MUL: Mul = [1.1, 1.07, 1.0];
/** Трава внутри стены вытоптана: темнее и самую малость теплее. */
export const WALL_TRAMPLE_MUL: Mul = [0.94, 0.92, 0.88];
