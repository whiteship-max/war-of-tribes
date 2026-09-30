// Единая палитра проекта. Все цвета сцены берутся отсюда, по имени, — ни один
// модуль рендера не держит hex у себя: цвет по месту невозможно ни согласовать,
// ни перекрасить разом. Файл нарочно без three.js: это таблица чисел, и тест
// проверяет её напрямую (palette.test.ts).
//
// Правила палитры:
// - hex — это то, что видно на освещённой солнцем горизонтальной грани в полдень:
//   риг (lighting.ts, `createLightRig`) откалиброван так, что освещённость выходит на альбедо, а
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
  /**
   * Полусфера дня у вида `next`: небо сверху — голубое, но не бирюзовое, отсвет снизу —
   * от тёплой земли. Голубой сверху на зелёном лугу и давал ему «лайм» (9.4).
   */
  hemiSkyWarm: 0xaab9cc,
  hemiGroundWarm: 0x766c59,
  hemiSkyNight: 0x46598a,
  hemiGroundNight: 0x2a2c38,
  /**
   * Ночь вида `next` (`lighting.RIG.next`): луна — ключевой свет, бледно-стальная, а не
   * синяя: на ней штукатурка читается светлой, а не тонет. Полусфера ночи светлее
   * прежней вдвое, отсвет снизу — глухой и тёплый. Дымка ночи светлее фона: дальний
   * лес уходит в неё, а не в черноту.
   */
  moonlight: 0xa9bfe3,
  nightFill: 0x5b72a6,
  nightBounce: 0x3b3f52,
  nightSky: 0x223050,
  nightHaze: 0x33456b,
  fireLight: 0xff9a3a,
  /** Свет окна ночью (вид `next`, `render/glow.ts`): тёплый, как свеча и очаг за ставнем. */
  windowGlow: 0xf2a25a,
  snowflake: 0xe8eef4,
  smoke: 0xd8d2c8,

  // ---------- Земля и растительность ----------
  grass: 0x7fa552,
  grassDark: 0x66884a,
  grassLight: 0x97b85c,
  /**
   * Земля поля боя. Своим цветом, а не травой посёлка, по двум причинам: на весь
   * экран открытая зелень кричит и сцена читается тестовой, а сезон посёлка ролик
   * не касается — бой идёт при ровном дневном свете, и сезонного переопределения
   * у этого ключа нет нарочно.
   */
  field: 0x6d8a4c,
  /**
   * Зимнее поле боя. Явным ключом, а не сезонным переопределением `field`:
   * переопределение переливало бы общий материал, то есть и деревню, а сцена боя
   * обязана красить только себя. Свой ключ — это и есть «явно и только для боя».
   */
  fieldSnow: 0xd9e2ea,
  /** Вода реки на поле боя: тёмная и холодная, зимой такая же — снег её не берёт. */
  water: 0x40688a,
  /** Отмель брода: дно видно, поэтому светлее воды и желтее. */
  shallow: 0x6f8a94,
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

  // ---------- Окружение пробы (`render/env`, docs/graphics_world.md) ----------
  /**
   * Дёрн пробы: луг теплее и глуше прежней травы (`grass*`) — к охре и тёплым жёлтым
   * значка города на карте мира. Свои ключи, а не правка прежних: нынешний вид игры
   * проба не трогает ни на бит.
   *
   * Ночь 1 (docs/graphics_world.md, 9.4): весь дневной ряд зелени — дёрн, трава, мох,
   * папоротник, кроны, всходы, подстилка — сдвинут к жёлтому на 8° тона (хвоя и подстилка
   * — на 4–6°) и приглушён: луг на 15 % насыщенности и 5 % яркости (0.3R + 0.59G + 0.11B),
   * кроны и мох — на 10 % насыщенности при той же яркости. «Лаймовое» ушло к оливе; ночь
   * обесцвечивает к серому той же яркости — у крон она не сдвинулась, у луга темнее на 5 %.
   */
  swardDark: 0x6d7a46,
  swardLight: 0xa3a460,
  /** Кончики травы: светлее и желтее земли под ними — пучок читается на лугу. */
  grassTip: 0xb0b26a,
  /** Густой луг: пятнами, там же и цветы. */
  meadow: 0x919d58,
  /** Лесная подстилка: хвоя и прошлогодний лист под пологом. */
  litter: 0x5a5f3e,
  /** Мох на камнях и пнях. */
  moss: 0x7a8e4d,
  fern: 0x688e49,
  /** Кроны пород: ель — синяя и тёмная, сосна — теплее, дуб — средний, берёза — светлая. */
  spruce: 0x416c49,
  pine: 0x547745,
  oak: 0x688845,
  birch: 0x99b258,
  /** Кора берёзы — белая с тёмными поясками (поясками — затемнение вершин). */
  birchBark: 0xe0dbcd,
  /** Кора сосны — рыжая в верхней части ствола. */
  pineBark: 0x98603a,
  /** Всходы на пашне: весной зелёные, летом спелые, осенью стерня. */
  crop: 0x9cbd5f,
  /** Луговые цветы Европы: ромашка, лютик, василёк, клевер, мак. */
  flowerWhite: 0xeee8d8,
  flowerYellow: 0xe9c648,
  flowerBlue: 0x6d87d1,
  flowerPink: 0xd98aa8,
  flowerRed: 0xcc4a3e,

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
  /** Кожа ремней, сапог, колчана и седла — тёмная, но не чёрная. */
  leather: 0x6f4f34,
  /** Доспех и шлем: светлее клинка, иначе на солнце кираса пропадает. */
  armor: 0x7a818c,
  /** Конская масть: гнедая. */
  horseCoat: 0x7a5236,
  /** Грива, хвост и «чулки» коня. */
  horseMane: 0x3f2f22,
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
 * Одежда по профессии. Сцена её больше не читает — у костра различаются покроем
 * (`FOLK_TINT`), а не профессией, — но цвета живы: это словарь значков. Сборка
 * листа (`scripts/build-icons.ts`) пускает в значок только цвета проекта, и значки
 * профессий нарисованы этими. Уберёшь запись — `npm run build` упадёт на браке цвета.
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
  priest: 0x7a4fa0,
};

/**
 * Герой на площади. Отдельные три цвета, а не запись в TROOP_TINT: герой не вид
 * бойца, он один, и узнаваться должен сразу — по плащу, шлему и щиту.
 */
export const HERO_TINT = {
  cloak: 0x9a2f3a,
  helm: 0xc9a03a,
  shield: 0xc9a03a,
};

/**
 * Покрои горожан. Ролей у жителей больше нет — население это число, — поэтому
 * у костра различаются только видом: рубаха, капюшон, долгополая одежда.
 * Цвет на фигурку идёт инстансом, новых материалов на это не заводится.
 */
export const FOLK_TINT: number[] = [0xb59a76, 0x93855f, 0xa8735a];

/**
 * Одежда бойцов по виду: чем выше в лестнице, тем ближе к металлу. Сцена её не
 * читает, а значки видов бойцов нарисованы этими цветами, и сборка листа их
 * пускает — то же, что у `JOB_TINT`.
 */
export const TROOP_TINT: Record<TroopId, number> = {
  clubman: 0x8a6a4a,
  spearman: 0xa2563f,
  archer: 0x6f8a4a,
  axeman: 0x9a5a2a,
  swordsman: 0x7a5f9a,
  shieldman: 0x4f6f9a,
  rider: 0x8a5f3f,
  knight: 0x6f7a86,
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
    swardDark: 0x707c44,
    swardLight: 0xa9a65f,
    grassTip: 0xb8b566,
    meadow: 0x959f56,
    litter: 0x555b3c,
    moss: 0x748a47,
    fern: 0x618844,
    spruce: 0x3d694a,
    pine: 0x4f7444,
    oak: 0x597b42,
    birch: 0x8aa750,
    crop: 0xd6b75c,
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
    swardDark: 0x7b7a45,
    swardLight: 0xb5a655,
    grassTip: 0xc9b45c,
    meadow: 0xa99f50,
    litter: 0x7a6038,
    moss: 0x8c8a48,
    fern: 0xb4823b,
    spruce: 0x3c6848,
    pine: 0x4d7542,
    oak: 0xb36f2c,
    birch: 0xdcb33b,
    crop: 0xbfa35a,
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
    swardDark: 0xc4cfdb,
    swardLight: 0xe0e7ef,
    grassTip: 0xe4eaf0,
    meadow: 0xdbe3eb,
    litter: 0xc8d1db,
    moss: 0xdde5ec,
    fern: 0xc9d3dc,
    spruce: 0xaebfc6,
    pine: 0xb3c3c8,
    oak: 0xc6ced6,
    birch: 0xd6dee6,
    crop: 0xd9e1e9,
  },
};

/** Плотность снега по сезону: гонит частицы, дым и белизну. */
export const SEASON_SNOW: Record<Season, number> = { spring: 0, summer: 0, autumn: 0, winter: 1 };

/**
 * Доля травы, что торчит из земли, по сезону: зимой пучки прячет снег (окружение
 * пробы, `render/env`). Не цвет, но сезонное число — живёт рядом со снегом.
 */
export const SEASON_SWARD: Record<Season, number> = { spring: 0.9, summer: 1, autumn: 0.85, winter: 0.3 };

/** Доля цветущих цветов по сезону: летом все, осенью редкие, зимой ни одного. */
export const SEASON_BLOOM: Record<Season, number> = { spring: 0.75, summer: 1, autumn: 0.2, winter: 0 };

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
/**
 * Пятно тени под деревом и мелочью окружения пробы (`env/materials.shadeMaterial`):
 * гуще пятна под зданием — дерево стоит в тени целиком, — и тоже холодное.
 */
export const BLOB_SHADE: Mul = [0.6, 0.64, 0.77];
