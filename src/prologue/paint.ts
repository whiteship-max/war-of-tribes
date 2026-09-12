/**
 * Рисунки поляны: лица, одежда, рукава и мягкое пятно света — на холсте в памяти.
 *
 * ЛИЦО — ТЕКСТУРА, НАРИСОВАННАЯ КОДОМ, А НЕ ГЕОМЕТРИЯ И НЕ КАРТИНКА СО СТОРОНЫ.
 * Геометрией глаз, бровь и губы на голове в двадцать сантиметров стоили бы
 * сотен треугольников и всё равно читались бы пятнами; картинка со стороны
 * стоила бы веса и чужого стиля. Холст в памяти не весит ничего, кроме этого
 * кода, а палитра на нём та же, что у всей игры (`render/palette.ts`): оттенок
 * выводится смесью цветов палитры, а не пишется числом по месту.
 *
 * ПЕЧЁТСЯ ОДИН РАЗ И В КАДРЕ НЕ ПЕРЕПЕКАЕТСЯ. Атлас женщины рисуется, когда она
 * появляется на поляне, и все её выражения лежат в нём сразу — сменить лицо
 * значит переложить развёртку лица на другую клетку (`people.setMood`), а не
 * перерисовать холст. Рукава и пятно света печёт сцена при входе.
 *
 * Сколько это памяти — называется числом (docs/prologue.md, раздел 14): атлас
 * 512×256, по одному на женщину в кадре (их бывает две — жена или гостья и
 * уходящая с отказом), два рукава 128×128 и пятно 64×64.
 *
 * `Math.random` здесь нет, как и во всей папке: разброс волосков, веснушек и
 * ворса — тот же `glade.hash`, и одна гостья выглядит одинаково у всех.
 */
import * as THREE from 'three';
import { PALETTE } from '@/render/palette';
import { hash } from './glade';

const C = PALETTE;

/**
 * Смешивание сложением — `THREE.AdditiveBlending`, для света: отсвет огня, искры,
 * глаза волков.
 *
 * ЧИСЛОМ, А НЕ ИМЕНЕМ, И ЭТО ПРО ПЕРВУЮ ЗАГРУЗКУ. Сама константа в общем чанке
 * `three` лежит всегда — ею пользуется рендерер, — но под своим именем деревня её
 * не берёт, и первое же обращение к `THREE.AdditiveBlending` из предыстории
 * дописало бы её имя в список экспорта общего чанка: десять байт в первую загрузку
 * за экран, в который игрок может не зайти. Поймала это опись сборки — хеш чанка
 * `three` сменился. Что число то самое, держит тест (`paint.test.ts`).
 */
export const ADDITIVE = 2 as THREE.Blending;

/** Смесь двух цветов палитры: оттенок из палитры, а не число по месту. */
export const mix = (a: number, b: number, k: number): number => {
  const m = (s: number): number => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * k) & 255;
  };
  return (m(16) << 16) | (m(8) << 8) | m(0);
};

/** Цвет строкой CSS — холсту. */
export const css = (hex: number, alpha = 1): string =>
  `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${alpha})`;

/** Разрез глаз. */
export type EyeShape = 'almond' | 'round' | 'narrow';

/** Брови. */
export type BrowShape = 'soft' | 'arched' | 'straight';

/**
 * Как выглядит гостья. По одной на каждую из `kin.GUESTS`, в том же порядке.
 *
 * Разные лица стоят нисколько — те же семь строк рисунка, другие числа, — и
 * превращают «ещё одна женщина» в «пришла другая». Отличаются они тем, что
 * видно с опушки (волосы, рубаха, повязка), и тем, что видно у огня (глаза,
 * брови, веснушки).
 */
export interface Look {
  hair: number;
  eyes: number;
  shape: EyeShape;
  brow: BrowShape;
  skin: number;
  shirt: number;
  /** Вышивка по вороту, по груди и на обшлагах. */
  stitch: number;
  skirt: number;
  /** Повязка и пояс. */
  band: number;
  /** Передник поверх понёвы. */
  apron: boolean;
  freckles: boolean;
  /**
   * Стрижен коротко: шапка волос вместо прядей по щекам.
   *
   * Нужно мальчику и мужчинам: длинные пряди по сторонам лица — это и есть то,
   * по чему женщину узнают в двадцать пикселей, и оставлять их сыну значило бы
   * рисовать вторую мать.
   */
  crop?: boolean;
  /** Борода: цвет. Нет поля — безбородый. */
  beard?: number;
}

export const LOOKS: readonly Look[] = [
  // Ведана: тёмно-русая, карие миндалевидные, льняная рубаха с красной вышивкой.
  { hair: C.trunk, eyes: C.leather, shape: 'almond', brow: 'soft', skin: C.skin, shirt: C.cloth, stitch: C.paintRed, skirt: C.woodDark, band: C.paintRed, apron: true, freckles: false },
  // Злата: светлая, голубые круглые, белёная рубаха с синей вышивкой, веснушки.
  { hair: C.thatch, eyes: C.paintBlue, shape: 'round', brow: 'arched', skin: mix(C.skin, C.bone, 0.28), shirt: C.bone, stitch: C.paintBlue, skirt: C.water, band: C.paintBlue, apron: false, freckles: true },
  // Милава: рыжая, зелёные узкие, серый лён с кирпичной вышивкой.
  { hair: C.ore, eyes: C.leaves, shape: 'narrow', brow: 'straight', skin: mix(C.skin, C.bone, 0.36), shirt: mix(C.stone, C.cloth, 0.5), stitch: C.tile, skirt: C.timber, band: C.leaves, apron: true, freckles: true },
  // Горислава: чёрная, тёмные миндалевидные, крашенная в зелень рубаха с жёлтым шитьём.
  { hair: C.horseMane, eyes: C.hair, shape: 'almond', brow: 'straight', skin: mix(C.skin, C.wood, 0.22), shirt: mix(C.grassDark, C.cloth, 0.35), stitch: C.thatch, skirt: C.leather, band: C.thatch, apron: false, freckles: false },
  // Любава: каштановая, серые круглые, белая рубаха с ягодной вышивкой.
  { hair: C.wood, eyes: C.stone, shape: 'round', brow: 'soft', skin: C.skin, shirt: C.plaster, stitch: C.berry, skirt: mix(C.paintRed, C.woodDark, 0.45), band: C.berry, apron: true, freckles: false },
  // Дарина: пепельно-русая, серо-голубые узкие, синеватая крашенина с красным шитьём.
  { hair: C.thatchDark, eyes: C.water, shape: 'narrow', brow: 'arched', skin: mix(C.skin, C.bone, 0.15), shirt: mix(C.paintBlue, C.cloth, 0.55), stitch: C.paintRed, skirt: C.stoneDark, band: C.cloth, apron: false, freckles: false },
];

/**
 * Сын. Рыжеватый, стриженый, в веснушках — и в той же рубахе, что у матери:
 * шьёт её она. Лицо то же, что у всех, потому что рисовать его нечем другим —
 * и не надо: мальчика от женщины отличают стрижка и рост.
 */
export const BOY_LOOK: Look = {
  hair: C.ore,
  eyes: C.leather,
  shape: 'round',
  brow: 'soft',
  skin: mix(C.skin, C.bone, 0.2),
  shirt: C.cloth,
  stitch: C.paintRed,
  skirt: C.woodDark,
  band: C.paintRed,
  apron: false,
  freckles: true,
  crop: true,
};

/**
 * Пришедшие из леса. Один облик на всех пятерых, и это решение: они — ватага,
 * и узнавать их по лицам игроку не надо. Тёмные, бородатые, в некрашеной
 * дерюге — всё, что должно читаться, читается силуэтом и цветом.
 *
 * Платят за это одним холстом на пятерых вместо пяти (`people.raiders`).
 */
export const RAIDER_LOOK: Look = {
  hair: C.hair,
  eyes: C.stone,
  shape: 'narrow',
  brow: 'straight',
  skin: mix(C.skin, C.wood, 0.3),
  shirt: mix(C.leather, C.cloth, 0.4),
  stitch: C.stoneDark,
  skirt: C.woodDark,
  band: C.stoneDark,
  apron: false,
  freckles: false,
  crop: true,
  beard: mix(C.hair, C.wood, 0.25),
};

/** Выражения лица — клетки атласа по порядку. */
export const MOOD_CALM = 0;
export const MOOD_WARY = 1;
export const MOOD_WARM = 2;
export const MOOD_BLINK = 3;
export type Mood = typeof MOOD_CALM | typeof MOOD_WARY | typeof MOOD_WARM | typeof MOOD_BLINK;

/**
 * Чем выражения отличаются числами. Настороженная гостья шире открывает глаза,
 * поднимает брови и не улыбается; спокойная жена — мягкая улыбка; тёплая —
 * глаза с прищуром улыбки, румянец гуще.
 */
const MOODS: readonly { open: number; low: number; lift: number; knit: number; smile: number; blush: number; closed: boolean }[] = [
  { open: 1, low: 1, lift: 0, knit: 0, smile: 0.9, blush: 0.55, closed: false },
  { open: 1.2, low: 1.05, lift: 1.8, knit: 1, smile: -0.5, blush: 0.2, closed: false },
  { open: 0.8, low: 0.62, lift: 0.5, knit: 0, smile: 2.3, blush: 1, closed: false },
  { open: 1, low: 1, lift: 0, knit: 0, smile: 0.9, blush: 0.55, closed: true },
];

/** Атлас женщины: четыре лица в верхнем ряду, одежда и образцы цвета в нижнем. */
export const ATLAS_W = 512;
export const ATLAS_H = 256;
export const FACE_CELL = 128;

/** Прямоугольник атласа в пикселях холста: y — сверху. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const REGION = {
  shirt: { x: 0, y: 128, w: 256, h: 128 },
  skirt: { x: 256, y: 128, w: 128, h: 128 },
  fur: { x: 384, y: 128, w: 128, h: 64 },
} as const satisfies Record<string, Rect>;

/** Однотонные образцы: голова, шея, повязка, руки — цветом, а не узором. */
export type Swatch = 'skin' | 'hair' | 'band' | 'neck' | 'hairDark' | 'shirt' | 'lips' | 'fur';
const SWATCHES: readonly Swatch[] = ['skin', 'hair', 'band', 'neck', 'hairDark', 'shirt', 'lips', 'fur'];
const SWATCH = 32;

/** Середина образца в развёртке: вся деталь красится одним его цветом. */
export const swatchUv = (s: Swatch): [number, number] => {
  const i = SWATCHES.indexOf(s);
  const x = 384 + (i % 4) * SWATCH + SWATCH / 2;
  const y = 192 + Math.floor(i / 4) * SWATCH + SWATCH / 2;
  return [x / ATLAS_W, 1 - y / ATLAS_H];
};

/**
 * Прямоугольник атласа в долях развёртки.
 *
 * Холст лежит в текстуре перевёрнутым (`flipY`): верх холста — это `v` = 1.
 */
export const rectUv = (r: Rect, w = ATLAS_W, h = ATLAS_H): { u0: number; u1: number; v0: number; v1: number } => ({
  u0: r.x / w,
  u1: (r.x + r.w) / w,
  v0: 1 - (r.y + r.h) / h,
  v1: 1 - r.y / h,
});

/** Клетка лица по выражению — в пикселях. */
export const faceRect = (mood: Mood): Rect => ({ x: mood * FACE_CELL, y: 0, w: FACE_CELL, h: FACE_CELL });

const canvas = (w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('холст без 2d');
  return { c, g };
};

/** Текстура из холста: цвет в sRGB, как у палитры. Печётся один раз. */
export function bake(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Лицо ----------

/**
 * Лицо в клетке 128×128.
 *
 * Клетка ложится на переднюю часть головы — на сферу от макушки до подбородка
 * и на ±80° вокруг носа (`people.woman`). Отсюда и числа: глаза на 60-й строке —
 * это чуть выше экватора головы, рот на 90-й, подбородок на 106-й (до увеличения
 * черт на пятую часть вокруг середины); по бокам клетки — пряди, закрывающие уши.
 * Лицо к краю сферы сжимается, поэтому черты держатся середины клетки.
 */
function drawFace(g: CanvasRenderingContext2D, ox: number, look: Look, mood: Mood, seed: number): void {
  const m = MOODS[mood];
  const skin = look.skin;
  const shade = mix(skin, C.leather, 0.42);
  const lash = mix(look.hair, C.dark, 0.7);
  g.save();
  g.translate(ox, 0);
  g.beginPath();
  g.rect(0, 0, FACE_CELL, FACE_CELL);
  g.clip();

  g.fillStyle = css(skin);
  g.fillRect(0, 0, 128, 128);
  // Черты крупнее жизни на пятую часть: лицо на голове в двадцать сантиметров
  // видят с метра с четвертью, и в натуральную величину глаза выходили точками.
  g.save();
  g.translate(64, 64);
  g.scale(1.2, 1.2);
  g.translate(-64, -64);
  // Скулы и челюсть — мягкой тенью: свет сферу и так скруглит, рисунок только подсказывает.
  const jaw = g.createLinearGradient(0, 96, 0, 128);
  jaw.addColorStop(0, css(shade, 0));
  jaw.addColorStop(1, css(shade, 0.4));
  g.fillStyle = jaw;
  g.fillRect(0, 96, 128, 32);
  for (const sx of [-1, 1]) {
    const cheek = g.createRadialGradient(64 + sx * 34, 86, 2, 64 + sx * 34, 86, 22);
    cheek.addColorStop(0, css(shade, 0.22));
    cheek.addColorStop(1, css(shade, 0));
    g.fillStyle = cheek;
    g.fillRect(0, 50, 128, 70);
  }

  // Румянец.
  for (const sx of [-1, 1]) {
    const blush = g.createRadialGradient(64 + sx * 23, 79, 1, 64 + sx * 23, 79, 12);
    blush.addColorStop(0, css(C.berry, 0.12 + 0.18 * m.blush));
    blush.addColorStop(1, css(C.berry, 0));
    g.fillStyle = blush;
    g.fillRect(64 + sx * 23 - 13, 66, 26, 26);
  }

  if (look.freckles) {
    g.fillStyle = css(mix(skin, C.leather, 0.65), 0.45);
    for (let i = 0; i < 22; i++) {
      const a = hash(i, seed * 7 + 3);
      const x = 64 + (hash(i, seed * 7 + 5) - 0.5) * 50;
      const y = 68 + a * 12 - Math.abs(x - 64) * 0.08;
      g.beginPath();
      g.arc(x, y, 0.55 + hash(i, 9) * 0.45, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Нос: тень по боку, ноздри, блик на кончике.
  g.strokeStyle = css(shade, 0.4);
  g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(61, 58);
  g.quadraticCurveTo(58.5, 69, 60, 75);
  g.stroke();
  g.fillStyle = css(mix(skin, C.leather, 0.62), 0.75);
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.ellipse(64 + sx * 3.4, 77.6, 1.5, 0.95, sx * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = css(mix(skin, C.bone, 0.45), 0.4);
  g.beginPath();
  g.ellipse(64.5, 73.5, 2.6, 1.8, 0, 0, Math.PI * 2);
  g.fill();

  // Рот.
  const lip = mix(skin, C.berry, 0.4);
  const lipLow = mix(lip, C.bone, 0.14);
  const mw = 8.5;
  const my = 90;
  const corner = my - m.smile;
  const mid = my + m.smile * 0.35;
  g.fillStyle = css(lip);
  g.beginPath();
  g.moveTo(64 - mw, corner);
  g.bezierCurveTo(64 - 5, my - 2.4, 64 - 2.2, my - 3, 64, my - 1.9);
  g.bezierCurveTo(64 + 2.2, my - 3, 64 + 5, my - 2.4, 64 + mw, corner);
  g.quadraticCurveTo(64, mid, 64 - mw, corner);
  g.fill();
  g.fillStyle = css(lipLow);
  g.beginPath();
  g.moveTo(64 - mw, corner);
  g.quadraticCurveTo(64, mid, 64 + mw, corner);
  g.quadraticCurveTo(64 + 3, my + 3.6 + m.smile * 0.15, 64, my + 3.7 + m.smile * 0.2);
  g.quadraticCurveTo(64 - 3, my + 3.6 + m.smile * 0.15, 64 - mw, corner);
  g.fill();
  g.strokeStyle = css(mix(lip, C.dark, 0.45), 0.85);
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(64 - mw, corner);
  g.quadraticCurveTo(64, mid, 64 + mw, corner);
  g.stroke();
  if (m.smile > 1.5) {
    // Ямочки в уголках — улыбка, а не просто изогнутая черта.
    g.strokeStyle = css(shade, 0.45);
    g.lineWidth = 0.8;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.arc(64 + sx * (mw + 1.2), corner + 0.6, 1.6, sx > 0 ? -1.2 : Math.PI - 1.9, sx > 0 ? 0.7 : Math.PI + 1.2);
      g.stroke();
    }
  }

  // Борода — поверх рта и скул, но под глазами: она закрывает нижнюю треть лица
  // и ничего не говорит о выражении. Есть она только у тех, у кого названа.
  if (look.beard !== undefined) beard(g, look.beard, seed);

  // Глаза и брови.
  for (const sx of [-1, 1]) {
    eye(g, 64 + sx * 17, 60, sx, look, m, lash);
    brow(g, 64 + sx * 17, 60, sx, look, m);
  }
  g.restore();

  if (look.crop) {
    crop(g, look, seed);
    g.restore();
    return;
  }

  // Волосы: пробор, пряди по бокам — они же закрывают уши.
  g.fillStyle = css(look.hair);
  g.beginPath();
  g.moveTo(-2, -2);
  g.lineTo(130, -2);
  g.lineTo(130, 104);
  g.bezierCurveTo(121, 100, 113, 84, 111, 62);
  g.bezierCurveTo(109, 40, 94, 25, 67, 23);
  g.lineTo(64, 27);
  g.lineTo(61, 23);
  g.bezierCurveTo(34, 25, 19, 40, 17, 62);
  g.bezierCurveTo(15, 84, 7, 100, -2, 104);
  g.closePath();
  g.fill();
  const light = mix(look.hair, C.bone, 0.3);
  const dark = mix(look.hair, C.dark, 0.45);
  g.lineWidth = 1;
  for (let i = 0; i < 34; i++) {
    const sx = i % 2 === 0 ? -1 : 1;
    const k = hash(i, seed * 13 + 1);
    g.strokeStyle = css(i % 3 === 0 ? light : dark, 0.35);
    g.beginPath();
    const x0 = 64 + sx * (2 + k * 10);
    g.moveTo(x0, 0);
    g.bezierCurveTo(64 + sx * (18 + k * 20), 18, 64 + sx * (44 + k * 6), 38, 64 + sx * (52 + k * 12), 100 - k * 30);
    g.stroke();
  }
  g.restore();
}

/**
 * Короткая стрижка: шапка волос с неровным краем, без прядей по щекам.
 *
 * Ею отличаются сын и пришедшие. Уши она не закрывает — их на голове и нет:
 * сфера головы гладкая, а уши в двадцать пикселей всё равно не читаются.
 */
function crop(g: CanvasRenderingContext2D, look: Look, seed: number): void {
  g.fillStyle = css(look.hair);
  g.beginPath();
  g.moveTo(-2, -2);
  g.lineTo(130, -2);
  g.lineTo(130, 48);
  g.bezierCurveTo(114, 42, 102, 28, 88, 33);
  g.bezierCurveTo(78, 36, 72, 29, 64, 31);
  g.bezierCurveTo(56, 29, 50, 36, 40, 33);
  g.bezierCurveTo(26, 28, 14, 42, -2, 48);
  g.closePath();
  g.fill();
  const light = mix(look.hair, C.bone, 0.3);
  const dark = mix(look.hair, C.dark, 0.45);
  g.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const k = hash(i, seed * 17 + 7);
    g.strokeStyle = css(i % 3 === 0 ? light : dark, 0.4);
    g.beginPath();
    const x0 = 8 + i * 7;
    g.moveTo(x0, 0);
    g.quadraticCurveTo(x0 + (k - 0.5) * 14, 20, x0 + (k - 0.5) * 26, 34 + k * 10);
    g.stroke();
  }
}

/**
 * Борода: от скул к подбородку, с усами над верхней губой.
 *
 * Рот из-под неё виден — иначе выражение исчезло бы вместе с ним, а лица в
 * атласе четыре как раз затем, чтобы выражение было.
 */
function beard(g: CanvasRenderingContext2D, color: number, seed: number): void {
  g.fillStyle = css(color);
  g.beginPath();
  g.moveTo(40, 70);
  g.bezierCurveTo(35, 96, 46, 122, 64, 124);
  g.bezierCurveTo(82, 122, 93, 96, 88, 70);
  g.bezierCurveTo(85, 86, 76, 97, 64, 98);
  g.bezierCurveTo(52, 97, 43, 86, 40, 70);
  g.closePath();
  g.fill();
  g.beginPath();
  g.ellipse(64, 84, 14, 4.6, 0, 0, Math.PI * 2);
  g.fill();
  const dark = mix(color, C.dark, 0.45);
  g.strokeStyle = css(dark, 0.45);
  g.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    const k = hash(i, seed * 23 + 11);
    const x0 = 42 + i * 3;
    g.beginPath();
    g.moveTo(x0, 88 + k * 6);
    g.quadraticCurveTo(x0 + (k - 0.5) * 6, 104, 64 + (x0 - 64) * 0.4, 116 - k * 8);
    g.stroke();
  }
}

/** Глаз: белок, радужка, зрачок, блик, веко с ресницами и складка над ним. */
function eye(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  sx: number,
  look: Look,
  m: (typeof MOODS)[number],
  lash: number,
): void {
  const w = look.shape === 'round' ? 6.6 : look.shape === 'narrow' ? 8.1 : 7.6;
  const up = (look.shape === 'round' ? 5.1 : look.shape === 'narrow' ? 3.3 : 4.2) * m.open;
  const low = (look.shape === 'round' ? 3.4 : look.shape === 'narrow' ? 2 : 2.6) * m.low;
  const tilt = look.shape === 'round' ? 0.2 : look.shape === 'narrow' ? 1.7 : 1.1;
  const inX = cx - sx * w;
  const outX = cx + sx * w;
  const inY = cy + 0.6;
  const outY = cy - tilt;
  if (m.closed) {
    g.strokeStyle = css(lash, 0.95);
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(inX, inY);
    g.quadraticCurveTo(cx, cy + 2.6, outX, outY + 0.8);
    g.stroke();
    return;
  }
  g.save();
  g.beginPath();
  g.moveTo(inX, inY);
  g.bezierCurveTo(inX + sx * w * 0.45, cy - up, outX - sx * w * 0.4, cy - up * 1.05, outX, outY);
  g.bezierCurveTo(outX - sx * w * 0.45, cy + low, inX + sx * w * 0.4, cy + low, inX, inY);
  g.closePath();
  g.fillStyle = css(mix(C.bone, look.skin, 0.2));
  g.fill();
  g.clip();
  const ir = Math.max(3.2, Math.min(4.6, up * 0.9 + 0.8));
  const ix = cx + sx * 0.2;
  const iy = cy + 0.2;
  g.fillStyle = css(mix(look.eyes, C.dark, 0.35));
  g.beginPath();
  g.arc(ix, iy, ir, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = css(look.eyes);
  g.beginPath();
  g.arc(ix, iy, ir * 0.78, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = css(C.dark);
  g.beginPath();
  g.arc(ix, iy, ir * 0.4, 0, Math.PI * 2);
  g.fill();
  // Тень верхнего века на белке — без неё глаз смотрит пуговицей.
  g.fillStyle = css(mix(look.skin, C.dark, 0.5), 0.35);
  g.fillRect(cx - w - 1, cy - up - 2, w * 2 + 2, 2.6);
  g.fillStyle = css(C.snowflake, 0.95);
  g.beginPath();
  g.arc(ix - 1.3, iy - 1.5, 1.05, 0, Math.PI * 2);
  g.fill();
  g.restore();

  g.strokeStyle = css(lash);
  g.lineCap = 'round';
  g.lineWidth = 1.7;
  g.beginPath();
  g.moveTo(inX, inY);
  g.bezierCurveTo(inX + sx * w * 0.45, cy - up, outX - sx * w * 0.4, cy - up * 1.05, outX + sx * 1.2, outY - 0.6);
  g.stroke();
  g.lineWidth = 0.7;
  g.strokeStyle = css(mix(look.skin, C.dark, 0.35), 0.5);
  g.beginPath();
  g.moveTo(inX + sx * 1.5, inY + 0.5);
  g.bezierCurveTo(inX + sx * w * 0.4, cy + low, outX - sx * w * 0.45, cy + low, outX, outY + 0.5);
  g.stroke();
  // Складка века над глазом.
  g.strokeStyle = css(mix(look.skin, C.leather, 0.5), 0.45);
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(inX + sx * 1.2, cy - up * 0.6);
  g.quadraticCurveTo(cx, cy - up - 3, outX, outY - 2.2);
  g.stroke();
}

/** Бровь: дуга цвета волос, у светлых — темнее самих волос, иначе её не видно. */
function brow(g: CanvasRenderingContext2D, cx: number, cy: number, sx: number, look: Look, m: (typeof MOODS)[number]): void {
  const y0 = cy - 10.5 - m.lift;
  const inY = y0 + (m.knit ? -1.4 : 0.8);
  const arch = look.brow === 'arched' ? 3.8 : look.brow === 'straight' ? 1 : 2.3;
  const color = mix(look.hair, C.dark, look.hair === C.thatch || look.hair === C.thatchDark || look.hair === C.ore ? 0.4 : 0.15);
  g.strokeStyle = css(color, 0.92);
  g.lineCap = 'round';
  for (const [wide, dy] of [
    [look.brow === 'straight' ? 2.8 : 2.3, 0],
    [1.2, 0.9],
  ] as const) {
    g.lineWidth = wide;
    g.beginPath();
    g.moveTo(cx - sx * 6.5, inY + dy);
    g.quadraticCurveTo(cx + sx * 1.5, y0 - arch + dy, cx + sx * 10, y0 + 1.8 + dy);
    g.stroke();
  }
}

// ---------- Одежда ----------

/** Рубаха: лён с ткацкой сеткой, швы по бокам, вышитый ворот, грудь и обшлага. */
function drawShirt(g: CanvasRenderingContext2D, look: Look): void {
  const { x, y, w, h } = REGION.shirt;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = css(look.shirt);
  g.fillRect(x, y, w, h);
  weave(g, x, y, w, h, look.shirt);
  // Складки: полосы тени вдоль рубахи.
  for (const fx of [36, 92, 164, 220]) {
    const f = g.createLinearGradient(x + fx - 8, 0, x + fx + 8, 0);
    f.addColorStop(0, css(C.dark, 0));
    f.addColorStop(0.5, css(C.dark, 0.1));
    f.addColorStop(1, css(C.dark, 0));
    g.fillStyle = f;
    g.fillRect(x + fx - 8, y, 16, h);
  }
  // Боковые швы — строчкой.
  g.strokeStyle = css(mix(look.shirt, C.leather, 0.45), 0.7);
  g.lineWidth = 1;
  g.setLineDash([3, 2]);
  for (const sx of [64, 192]) {
    g.beginPath();
    g.moveTo(x + sx, y + 18);
    g.lineTo(x + sx, y + 106);
    g.stroke();
  }
  g.setLineDash([]);
  band(g, x, y + 1, w, 15, look.stitch, look.shirt);
  // Вышивка по груди: полоса от ворота вниз посередине рубахи.
  g.fillStyle = css(mix(look.shirt, look.stitch, 0.12));
  g.fillRect(x + 118, y + 14, 20, 88);
  g.strokeStyle = css(look.stitch, 0.9);
  g.lineWidth = 1.2;
  for (const sx of [119.5, 136.5]) {
    g.beginPath();
    g.moveTo(x + sx, y + 14);
    g.lineTo(x + sx, y + 102);
    g.stroke();
  }
  for (let k = 0; k < 8; k++) rhomb(g, x + 128, y + 22 + k * 11, 4.4, look.stitch, look.shirt);
  band(g, x, y + 108, w, 16, look.stitch, look.shirt);
  g.restore();
}

/** Понёва: складки, пояс, передник и вышитый подол. */
function drawSkirt(g: CanvasRenderingContext2D, look: Look): void {
  const { x, y, w, h } = REGION.skirt;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = css(look.skirt);
  g.fillRect(x, y, w, h);
  weave(g, x, y, w, h, look.skirt);
  for (let k = 0; k < 8; k++) {
    const f = g.createLinearGradient(x + k * 16, 0, x + k * 16 + 16, 0);
    f.addColorStop(0, css(C.dark, 0.14));
    f.addColorStop(0.6, css(C.bone, 0.05));
    f.addColorStop(1, css(C.dark, 0.14));
    g.fillStyle = f;
    g.fillRect(x + k * 16, y + 10, 16, h - 10);
  }
  // Подол — клетка ткани в ромб.
  g.fillStyle = css(mix(look.skirt, look.stitch, 0.25));
  g.fillRect(x, y + 110, w, 18);
  g.strokeStyle = css(look.stitch, 0.9);
  g.lineWidth = 1.6;
  g.beginPath();
  for (let i = 0; i <= 16; i++) g.lineTo(x + i * 8, y + (i % 2 === 0 ? 124 : 114));
  g.stroke();
  if (look.apron) {
    // Передник узкий, на пятую часть подола: шире — и понёва спереди читалась бы
    // белой у всех, у кого он есть.
    const apron = mix(look.shirt, C.bone, 0.3);
    g.fillStyle = css(apron);
    g.fillRect(x + 50, y + 10, 28, 100);
    weave(g, x + 50, y + 10, 28, 100, apron);
    g.strokeStyle = css(mix(apron, C.leather, 0.4), 0.6);
    g.lineWidth = 1;
    g.strokeRect(x + 50.5, y + 10.5, 27, 99);
    for (let k = 0; k < 2; k++) rhomb(g, x + 58 + k * 12, y + 100, 4, look.stitch, apron);
  }
  // Пояс: тканый, с косой строчкой.
  g.fillStyle = css(look.band);
  g.fillRect(x, y, w, 10);
  g.strokeStyle = css(mix(look.band, C.bone, 0.6), 0.75);
  g.lineWidth = 1;
  for (let i = 0; i < 28; i++) {
    g.beginPath();
    g.moveTo(x + i * 5, y + 8);
    g.lineTo(x + i * 5 + 3, y + 2);
    g.stroke();
  }
  g.restore();
}

/** Мех накидки: короткий ворс вниз и светлая оторочка по краю. */
function drawFur(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: number, seed: number, trim: boolean): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = css(base);
  g.fillRect(x, y, w, h);
  const light = mix(base, C.bone, 0.4);
  const dark = mix(base, C.leather, 0.55);
  const edge = trim ? h - 12 : h;
  g.lineWidth = 1.1;
  g.lineCap = 'round';
  const n = Math.round((w * h) / 9);
  for (let i = 0; i < n; i++) {
    const px = x + hash(i, seed + 11) * w;
    const py = y + hash(i, seed + 13) * edge;
    const len = 2.5 + hash(i, seed + 17) * 3.5;
    const a = Math.PI / 2 + (hash(i, seed + 19) - 0.5) * 0.9;
    g.strokeStyle = css(i % 3 === 0 ? light : dark, 0.55);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
    g.stroke();
  }
  if (trim) {
    const pale = mix(base, C.bone, 0.55);
    g.fillStyle = css(pale);
    g.beginPath();
    g.moveTo(x, y + h);
    for (let i = 0; i <= w; i += 4) g.lineTo(x + i, y + edge + (i % 8 === 0 ? -3 : 2));
    g.lineTo(x + w, y + h);
    g.closePath();
    g.fill();
    for (let i = 0; i < w; i += 2) {
      g.strokeStyle = css(i % 4 === 0 ? mix(pale, C.leather, 0.3) : C.bone, 0.5);
      g.beginPath();
      g.moveTo(x + i, y + edge);
      g.lineTo(x + i + (hash(i, seed + 23) - 0.5) * 3, y + h);
      g.stroke();
    }
  }
  g.restore();
}

/** Ткацкая сетка: тонкие нити в обе стороны, чуть темнее ткани. */
function weave(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: number): void {
  g.fillStyle = css(mix(base, C.dark, 0.5), 0.05);
  for (let yy = 0; yy < h; yy += 2) g.fillRect(x, y + yy, w, 1);
  g.fillStyle = css(mix(base, C.bone, 0.5), 0.05);
  for (let xx = 0; xx < w; xx += 3) g.fillRect(x + xx, y, 1, h);
}

/** Полоса вышивки: две строчки и ромбы между ними. */
function band(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stitch: number, base: number): void {
  g.fillStyle = css(mix(base, stitch, 0.1));
  g.fillRect(x, y, w, h);
  g.strokeStyle = css(stitch, 0.9);
  g.lineWidth = 1.2;
  for (const yy of [y + 1.5, y + h - 1.5]) {
    g.beginPath();
    g.moveTo(x, yy);
    g.lineTo(x + w, yy);
    g.stroke();
  }
  for (let cx = x + 6; cx < x + w; cx += 12) rhomb(g, cx, y + h / 2, Math.min(4.2, h / 2 - 2.5), stitch, base);
}

/** Ромб вышивки с крестом внутри — самый частый знак на вороте. */
function rhomb(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, stitch: number, base: number): void {
  g.fillStyle = css(stitch, 0.92);
  g.beginPath();
  g.moveTo(cx, cy - r);
  g.lineTo(cx + r, cy);
  g.lineTo(cx, cy + r);
  g.lineTo(cx - r, cy);
  g.closePath();
  g.fill();
  g.fillStyle = css(base);
  g.fillRect(cx - 0.6, cy - r * 0.55, 1.2, r * 1.1);
  g.fillRect(cx - r * 0.55, cy - 0.6, r * 1.1, 1.2);
}

/**
 * Атлас человека: четыре лица, рубаха, понёва, мех и образцы.
 *
 * Один на всех, кого рисует `people.ts`: женщину, сына и пришедших. Отличаются
 * они не атласом, а `Look` — стрижкой, бородой и цветами, — и геометрией.
 *
 * `seed` — номер человека: разброс прядей, веснушек и бороды у каждого свой и у
 * всех один.
 */
export function personAtlas(look: Look, seed: number): HTMLCanvasElement {
  const { c, g } = canvas(ATLAS_W, ATLAS_H);
  for (const mood of [MOOD_CALM, MOOD_WARY, MOOD_WARM, MOOD_BLINK] as const) drawFace(g, mood * FACE_CELL, look, mood, seed);
  drawShirt(g, look);
  drawSkirt(g, look);
  drawFur(g, REGION.fur.x, REGION.fur.y, REGION.fur.w, REGION.fur.h, C.hide, seed * 31, true);
  const colors: Record<Swatch, number> = {
    skin: look.skin,
    hair: look.hair,
    band: look.band,
    neck: mix(look.skin, C.leather, 0.25),
    hairDark: mix(look.hair, C.dark, 0.3),
    shirt: look.shirt,
    lips: mix(look.skin, C.berry, 0.4),
    fur: C.hide,
  };
  SWATCHES.forEach((s, i) => {
    g.fillStyle = css(colors[s]);
    g.fillRect(384 + (i % 4) * SWATCH, 192 + Math.floor(i / 4) * SWATCH, SWATCH, SWATCH);
  });
  return c;
}

// ---------- Рукава игрока ----------

/** Рукав игрока: рисунок рукава сверху, образец кожи рук снизу. */
export const SLEEVE = 128;
export const SLEEVE_CLOTH: Rect = { x: 0, y: 0, w: 128, h: 96 };
export const SLEEVE_SKIN: [number, number] = [32 / 128, 1 - 112 / 128];

/**
 * Рукав: лён с вышитым обшлагом — или мех, когда одежда сшита.
 *
 * Мелочь, которую замечают все: сшил одежду из шкуры — и на руке с топором
 * появился мех. Холста два, и меняется у рук материал, а не рисунок.
 */
export function sleeveCanvas(fur: boolean): HTMLCanvasElement {
  const { c, g } = canvas(SLEEVE, SLEEVE);
  if (fur) {
    drawFur(g, 0, 0, 128, 96, mix(C.hide, C.leather, 0.15), 401, true);
  } else {
    g.fillStyle = css(C.cloth);
    g.fillRect(0, 0, 128, 96);
    weave(g, 0, 0, 128, 96, C.cloth);
    g.strokeStyle = css(mix(C.cloth, C.leather, 0.45), 0.7);
    g.setLineDash([3, 2]);
    g.beginPath();
    g.moveTo(3, 0);
    g.lineTo(3, 74);
    g.stroke();
    g.setLineDash([]);
    band(g, 0, 76, 128, 18, C.paintRed, C.cloth);
  }
  g.fillStyle = css(mix(C.skin, C.leather, 0.12));
  g.fillRect(0, 96, 128, 32);
  return c;
}

// ---------- Пятно света ----------

/**
 * Мягкое круглое пятно: белое в середине, прозрачное к краю.
 *
 * Белое не краска, а маска света: его умножают на цвет огня, дыма, искры или
 * глаз волка. Одно пятно на всё — отсвет костра, клубы дыма (иначе точки рисуются
 * квадратами), искры и глаза.
 */
export function glowCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.22, 'rgba(255,255,255,0.62)');
  r.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return c;
}
