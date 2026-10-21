// Люди покоев (docs/city_v3.md, Г-7, Г-10): старый слуга в ливрее цветов герба, служанка, супруга правителя, гонец и
// советник. Облик — 1200 год:
// у слуги котта до колен цвета поля герба с каймой его металла, пояс с ключами, седина и короткая борода; у служанки —
// платье из крашеной шерсти, белый передник, льняной чепец и коса; у супруги — блио с золотой каймой, широкие
// свисающие рукава, пояс с длинным концом, белый плат с подбородником (барбетом) и золотой обруч; у гонца — короткая
// котта цветов герба, откинутый на плечи капюшон с оплечьем, сума через плечо и сапоги до колен, пыльные с дороги; у
// советника — длинная мантия тёмного сукна с меховой опушкой, цепь с бляхой, чёрная шапочка и седая борода до груди. Все
// взрослые: рост, плечи и лица — взрослых людей.
//
// Модель — одна сетка с жёсткой кожей (`rig.ts`); движения — позы по костям (`clips`), их смешивает `Person`:
// стоять и дышать, идти, поклониться, присесть в реверансе, говорить руками, налить из кувшина, нести и взять с пола.
import type { V3 } from '../city/geom';
import { tint } from '../city/geom';
import type { Arms, Tincture } from '@/heraldry/arms';
import { PLAIN_LAYER } from './geo';
import { Rig, Skeleton, SkinBuilder, ringY, type Ring, type RigPose, type Turn } from './rig';
import type * as THREE from 'three';
import type { RoomLayer } from './geo';

export type FolkId = 'servant' | 'maid' | 'wife' | 'herald' | 'advisor';

/** Женщины покоев: стан уже, шаг короче, приветствие — реверанс, а не поклон. */
export const isFemale = (id: FolkId): boolean => id === 'maid' || id === 'wife';

/** Шерсть, крашенная под цвета герба: не геральдические чистые тона, а то, что давали марена, вайда и шафран. */
const DYE: Record<Tincture, number> = {
  or: 0xb48a2c,
  argent: 0xd6d0bc,
  gules: 0x8a2420,
  azure: 0x2c4880,
  vert: 0x2e5a32,
  sable: 0x2a2622,
  purpure: 0x5a2c58,
};
const METALS: readonly Tincture[] = ['or', 'argent'];

/** Цвета ливреи: тело — цвет герба (не металл), кайма — металл; у герба без цвета — тёмное сукно. */
export function liveryOf(a: Arms): { body: number; trim: number } {
  const all = [a.field[0], a.field[1], a.tint];
  const colour = all.find((t) => !METALS.includes(t)) ?? 'sable';
  const metal = all.find((t) => METALS.includes(t)) ?? 'or';
  return { body: DYE[colour], trim: DYE[metal] };
}

/** Облик: рост, стан, кожа, волосы, одежда. */
interface Look {
  /** Рост — доля мужского 1,72 м. */
  s: number;
  female: boolean;
  skin: V3;
  /** Румянец губ и щёк. */
  lip: V3;
  hair: V3;
  brow: V3;
  iris: V3;
  /** Платье (котта, блио), второе платье (рукава, исподнее), кайма, передник или пояс, обувь, чулки. */
  cloth: V3;
  under: V3;
  trim: V3;
  belt: V3;
  shoe: V3;
  hose: V3;
  linen: V3;
  /** Подол — до колен (слуга, гонец) или до пола (женщины, советник). */
  hem: number;
}

/** Платье до пола: подол шире и складками гуще, под ним — исподнее, а не чулки. */
const isLong = (L: Look): boolean => L.hem < 0.3;

const SEG = { low: 7, medium: 9, high: 11 } as const;
type Detail = 0 | 1 | 2;
const segOf = (d: Detail): number => (d === 0 ? SEG.low : d === 1 ? SEG.medium : SEG.high);

/** Облики людей покоев; ливрея слуги и котта гонца — из герба державы. */
export function lookOf(id: FolkId, arms: Arms): Look {
  const lv = liveryOf(arms);
  switch (id) {
    case 'servant':
      return {
        s: 0.98,
        female: false,
        skin: tint(0xc49278),
        lip: tint(0xa86a5c),
        hair: tint(0xc8c4bc),
        brow: tint(0xa8a29a),
        iris: tint(0x4a5a6a),
        cloth: tint(lv.body),
        under: tint(0x5a4a3a),
        trim: tint(lv.trim),
        belt: tint(0x3a2618),
        shoe: tint(0x2c1e14),
        hose: tint(0x3a3430),
        linen: tint(0xd8d2c2),
        hem: 0.56,
      };
    case 'maid':
      return {
        s: 0.95,
        female: true,
        skin: tint(0xd8aa90),
        lip: tint(0xb8645a),
        hair: tint(0x7a4a26),
        brow: tint(0x5a3820),
        iris: tint(0x5a4a2a),
        cloth: tint(0x7a3a2c),
        under: tint(0x8a7656),
        trim: tint(0x5a2a20),
        belt: tint(0x5a4026),
        shoe: tint(0x3a2618),
        hose: tint(0x4a3a30),
        linen: tint(0xe4dccc),
        hem: 0.03,
      };
    case 'wife':
      return {
        s: 0.96,
        female: true,
        skin: tint(0xe0b49c),
        lip: tint(0xb0544e),
        hair: tint(0x4a2c18),
        brow: tint(0x3a2414),
        iris: tint(0x3a5a4a),
        cloth: tint(0x24485a),
        under: tint(0x7a2a3a),
        trim: tint(0xc8a048),
        belt: tint(0xb89040),
        shoe: tint(0x4a2a22),
        hose: tint(0x5a3a3a),
        linen: tint(0xf0eadc),
        hem: 0.01,
      };
    case 'herald':
      // Молодой, загорелый с дороги; котта — цвета герба, капюшон и сума — некрашеная шерсть и кожа.
      return {
        s: 1.0,
        female: false,
        skin: tint(0xc08a6a),
        lip: tint(0xa0605a),
        hair: tint(0x5a3a22),
        brow: tint(0x4a2e1a),
        iris: tint(0x5a4a30),
        cloth: tint(lv.body),
        under: tint(0x6a5a40),
        trim: tint(lv.trim),
        belt: tint(0x4a3020),
        shoe: tint(0x4a3220),
        hose: tint(0x3a2c20),
        linen: tint(0x5a4834),
        hem: 0.6,
      };
    case 'advisor':
      // Седой, бледный от письма при свечах; мантия — дорогое тёмное сукно, опушка — куница, цепь — золото.
      return {
        s: 0.99,
        female: false,
        skin: tint(0xd0a088),
        lip: tint(0xa06a60),
        hair: tint(0xd4d0c8),
        brow: tint(0xb4aea4),
        iris: tint(0x4a4a52),
        cloth: tint(0x22302c),
        under: tint(0x3a2a24),
        trim: tint(0x6a4a30),
        belt: tint(0xc8a048),
        shoe: tint(0x241a14),
        hose: tint(0x2a2622),
        linen: tint(0x1c1a18),
        hem: 0.03,
      };
  }
}

/** Скелет взрослого: суставы в позе покоя (руки вдоль тела, ладони к бёдрам), рост — `s` от 1,72 м. */
export function humanSkeleton(s: number, female: boolean): Skeleton {
  const w = female ? 0.9 : 1;
  const p = (x: number, y: number, z = 0): V3 => [x * s * w, y * s, z * s];
  const sk = new Skeleton();
  sk.add('hips', null, p(0, 0.98));
  sk.add('spine', 'hips', p(0, 1.12));
  sk.add('chest', 'spine', p(0, 1.3, 0.005));
  sk.add('neck', 'chest', p(0, 1.49, 0.0));
  sk.add('head', 'neck', p(0, 1.565, 0.012));
  for (const [side, sx] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    sk.add(`arm${side}`, 'chest', p(0.185 * sx, 1.43));
    sk.add(`fore${side}`, `arm${side}`, p(0.205 * sx, 1.135, -0.005));
    sk.add(`hand${side}`, `fore${side}`, p(0.215 * sx, 0.885, 0.01));
    sk.add(`thigh${side}`, 'hips', [0.092 * sx * s * (female ? 1.04 : 1), 0.94 * s, 0]);
    sk.add(`shin${side}`, `thigh${side}`, [0.096 * sx * s, 0.52 * s, 0.012 * s]);
    sk.add(`foot${side}`, `shin${side}`, [0.1 * sx * s, 0.085 * s, -0.012 * s]);
  }
  return sk;
}

/** Собрать человека покоев: сетка с костями (`rig.SkinBuilder`). Код подсветки касанием — `code`. */
export function buildPerson(id: FolkId, arms: Arms, detail: Detail, code: number): SkinBuilder {
  const L = lookOf(id, arms);
  const s = L.s;
  const sk = humanSkeleton(s, L.female);
  const sb = new SkinBuilder(sk);
  sb.m.code = code;
  const seg = segOf(detail);
  const w = L.female ? 0.9 : 1;
  const Y = (y: number): number => y * s;
  const X = (x: number): number => x * s * w;
  const ring = (y: number, rx: number, rz: number, fz = 0, x = 0): Ring => ringY(Y(y), X(rx), rz * s, x * s * w, fz * s);

  // ---------- Тело и платье ----------
  const female = L.female;
  // Грудь и стан: у женщин — уже плечи, выше пояс, грудь платья мягче.
  sb.bone('hips');
  sb.loft([ring(0.9, 0.165, 0.118), ring(0.97, female ? 0.18 : 0.168, 0.12), ring(1.05, female ? 0.158 : 0.158, 0.112), ring(1.13, female ? 0.13 : 0.152, 0.106)], seg + 3, 'plain', L.cloth);
  sb.bone('spine');
  sb.loft([ring(1.1, female ? 0.13 : 0.152, 0.106), ring(1.2, female ? 0.132 : 0.158, female ? 0.104 : 0.112, 0.004), ring(1.3, female ? 0.15 : 0.172, female ? 0.118 : 0.118, female ? 0.012 : 0.006)], seg + 3, 'plain', L.cloth);
  sb.bone('chest');
  const bust = female ? 0.02 : 0;
  sb.loft(
    [
      ring(1.28, female ? 0.15 : 0.172, female ? 0.118 : 0.118, female ? 0.012 : 0.006),
      ring(1.36, female ? 0.162 : 0.188, 0.122 + bust * 0.6, 0.012 + bust),
      ring(1.425, female ? 0.164 : 0.186, 0.112, 0.006),
      ring(1.462, female ? 0.13 : 0.148, 0.09, 0.002),
      ring(1.49, female ? 0.085 : 0.095, 0.068, 0.002),
      ring(1.505, 0.064, 0.058, 0.004),
    ],
    seg + 3,
    'plain',
    L.cloth,
  );
  // Ворот: кайма у слуги и супруги, у служанки — край сорочки.
  sb.loft([ring(1.485, female ? 0.105 : 0.12, 0.078, 0.004), ring(1.505, 0.07, 0.062, 0.006)], seg + 3, 'plain', id === 'maid' ? L.linen : L.trim);

  if (id === 'herald') {
    // Ремень сумы — через грудь от правого плеча к левому бедру: полоса поверх котты.
    const strap: V3[] = [
      [X(-0.13), Y(1.44), 0.035 * s],
      [X(-0.06), Y(1.36), 0.122 * s],
      [X(0.04), Y(1.22), 0.124 * s],
      [X(0.12), Y(1.07), 0.118 * s],
      [X(0.16), Y(0.99), 0.07 * s],
    ];
    for (let i = 0; i + 1 < strap.length; i++) sb.rod(strap[i], strap[i + 1], 0.012 * s, 0.012 * s, 4, 'plain', L.belt, false);
    // Капюшон откинут на плечи: оплечье воротником вокруг шеи и складка капюшона на спине.
    sb.loft([ring(1.39, 0.2, 0.135, -0.004), ring(1.45, 0.17, 0.12, -0.002), ring(1.51, 0.082, 0.078, 0.0)], seg + 3, 'plain', L.linen);
    sb.loftTipped([0, Y(1.5), -0.07 * s], [ringY(Y(1.48), X(0.07), 0.04 * s, 0, -0.1 * s), ringY(Y(1.4), X(0.06), 0.035 * s, 0, -0.13 * s)], [0, Y(1.3), -0.13 * s], seg, 'plain', mixC(L.linen, tint(0x000000), 0.15));
  }
  if (id === 'advisor') {
    // Меховой воротник по плечам и цепь советника с бляхой на груди.
    sb.loft([ring(1.4, 0.19, 0.13, 0.002), ring(1.46, 0.165, 0.115, 0.002), ring(1.5, 0.09, 0.075, 0.004)], seg + 3, 'plain', L.trim);
    sb.m.shine = 0.85;
    const links = detail === 0 ? 5 : 7;
    let prev: V3 | null = null;
    for (let i = 0; i <= links; i++) {
      const a = -0.95 + (1.9 * i) / links;
      const p: V3 = [X(Math.sin(a) * 0.13), Y(1.43 - Math.cos(a) * 0.1 + 0.02), (0.1 + Math.cos(a) * 0.035) * s];
      if (prev) sb.rod(prev, p, 0.006 * s, 0.006 * s, 4, 'plain', L.belt, false);
      prev = p;
    }
    sb.ball([0, Y(1.31), 0.132 * s], 0.026 * s, 7, 'plain', L.belt, 1, 0.35);
    sb.m.shine = 0;
  }
  // Подол: котта слуги до колен с разрезом не нужен — расширяется книзу; платья женщин — до пола, складками.
  sb.bone('hips');
  const hem = L.hem;
  const long = isLong(L);
  const skirt: Ring[] = [];
  const top = 0.98;
  const rows = long ? 6 : 4;
  for (let i = 0; i <= rows; i++) {
    const k = i / rows;
    const y = top + (hem - top) * k;
    // Мантия советника — до пола, но прямее женского платья: мужской стан, тяжёлое сукно.
    const rx = (female ? 0.178 : 0.17) + k * (female ? 0.16 : long ? 0.11 : 0.07);
    const rz = 0.12 + k * (female ? 0.15 : long ? 0.1 : 0.075);
    skirt.push(ring(y, rx, rz, long ? 0.012 * k : 0.01 * k));
  }
  // Складки: тон вдоль круга темнее во впадинах.
  const fold = (base: V3) => (_i: number, k: number): V3 => {
    const f = 0.86 + 0.14 * Math.cos((k / (seg + 5)) * Math.PI * 2 * 4);
    return [base[0] * f, base[1] * f, base[2] * f];
  };
  sb.loft(skirt, seg + 5, 'plain', fold(L.cloth));
  // Кайма подола.
  const last = skirt[skirt.length - 1];
  const lip = { ...last, c: [last.c[0], last.c[1] + (id === 'advisor' ? 0.07 : 0.035) * s, last.c[2]] as V3, ru: last.ru * 0.985, rv: last.rv * 0.985 };
  // Опушка мантии — мех: толще каймы и выпуклее.
  const furK = id === 'advisor' ? 1.03 : 1.012;
  sb.loft([lip, { ...last, ru: last.ru * furK, rv: last.rv * furK }], seg + 5, 'plain', L.trim);
  if (id === 'advisor') {
    // Разрез мантии спереди — полоса меха от пояса до подола.
    const front: Ring[] = skirt.map((r) => ({ c: [0, r.c[1], r.c[2] + r.rv + 0.004] as V3, u: [1, 0, 0] as V3, v: [0, 0, 1] as V3, ru: 0.03 * s, rv: 0.012 * s }));
    sb.loft(front, 5, 'plain', L.trim);
  }
  // Передник служанки: полотно спереди по подолу.
  if (id === 'maid') {
    const ap: Ring[] = [];
    for (let i = 0; i <= 4; i++) {
      const k = i / 4;
      const y = 1.06 + (0.3 - 1.06) * k;
      const rr = skirt.reduce((a, r) => (Math.abs(r.c[1] - Y(y)) < Math.abs(a.c[1] - Y(y)) ? r : a));
      ap.push({ c: [0, Y(y), rr.c[2] + rr.rv * 0.97 + 0.004], u: [1, 0, 0], v: [0, 0, 1], ru: X(0.15 + 0.09 * k), rv: 0.02 * s });
    }
    apron(sb, ap, L.linen);
  }
  // Пояс: кожаный у слуги (с ключами), тканый у служанки, золочёный у супруги с концом до колен.
  const by = female ? 1.04 : 1.0;
  // У советника пояса поверх мантии нет: мантия висит с плеч, на груди — цепь.
  if (id !== 'advisor') sb.loft([ring(by - 0.018, female ? 0.162 : 0.162, 0.116, 0.002), ring(by + 0.018, female ? 0.158 : 0.16, 0.114, 0.002)], seg + 3, 'plain', L.belt);
  if (id === 'servant') {
    // Связка ключей на правом боку: кольцо и три ключа.
    const kx = X(-0.15);
    sb.m.shine = 0.7;
    sb.rod([kx, Y(0.99), 0.06 * s], [kx - 0.005, Y(0.94), 0.07 * s], 0.006, 0.006, 5, 'plain', tint(0x3a3430));
    for (const dz of [-0.012, 0, 0.014]) sb.rod([kx, Y(0.94), (0.068 + dz) * s], [kx - 0.01, Y(0.88), (0.07 + dz * 1.4) * s], 0.0035, 0.003, 4, 'plain', tint(0x4a4440));
    sb.m.shine = 0;
    // Кошель у пояса.
    sb.ball([X(0.12), Y(0.95), 0.08 * s], 0.035 * s, 7, 'plain', tint(0x4a3220), 1.2, 0.7);
  }
  if (id === 'herald') {
    // Сума на левом боку: кожаный мешок с клапаном, ремень — через грудь с правого плеча.
    sb.ball([X(0.16), Y(0.93), 0.02 * s], 0.06 * s, detail === 0 ? 6 : 8, 'plain', mixC(L.belt, tint(0x6a4a2a), 0.4), 0.55, 0.95);
    sb.m.quad([X(0.12), Y(0.99), 0.075 * s], [X(0.2), Y(0.99), 0.06 * s], [X(0.205), Y(0.94), 0.064 * s], [X(0.115), Y(0.94), 0.079 * s], 'plain', L.belt);
  }
  if (id === 'wife') {
    sb.m.shine = 0.75;
    sb.rod([X(0.02), Y(by - 0.02), 0.125 * s], [X(0.03), Y(0.58), 0.17 * s], 0.007, 0.006, 5, 'plain', mixC(L.belt, tint(0x3a2a10), 0.25));
    sb.ball([X(0.03), Y(0.575), 0.17 * s], 0.016, 6, 'plain', L.belt);
    sb.m.shine = 0;
  }

  // ---------- Шея и голова ----------
  sb.bone('neck');
  sb.loft([ring(1.47, 0.052, 0.05, 0.004), ring(1.53, 0.046, 0.046, 0.008), ring(1.585, 0.046, 0.048, 0.012)], seg, 'plain', L.skin);
  sb.bone('head');
  head(sb, L, seg, id);

  // ---------- Руки ----------
  for (const [side, sx] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    const arm = sk.bones[sk.of(`arm${side}`)].j;
    const elb = sk.bones[sk.of(`fore${side}`)].j;
    const wr = sk.bones[sk.of(`hand${side}`)].j;
    const along = (a: V3, e: V3, k: number): V3 => [a[0] + (e[0] - a[0]) * k, a[1] + (e[1] - a[1]) * k, a[2] + (e[2] - a[2]) * k];
    sb.bone(`arm${side}`);
    // Плечо — шаром: дельта круглая, рука уходит из-под неё, а не торчит коробкой.
    sb.ball([arm[0] - 0.012 * sx, arm[1] - 0.004, arm[2]], 0.052 * s, seg, 'plain', L.cloth, 1, 1.05);
    const sh: V3 = [arm[0] - 0.012 * sx, arm[1] + 0.0, arm[2]];
    sb.loft(
      [
        { c: sh, u: [1, 0, 0], v: [0, 0, 1], ru: 0.058 * s, rv: 0.058 * s },
        { c: along(arm, elb, 0.35), u: [1, 0, 0], v: [0, 0, 1], ru: 0.05 * s, rv: 0.052 * s },
        { c: along(arm, elb, 1.04), u: [1, 0, 0], v: [0, 0, 1], ru: 0.045 * s, rv: 0.046 * s },
      ],
      seg,
      'plain',
      L.cloth,
      { cap0: true },
    );
    sb.bone(`fore${side}`);
    // Рукав: у супруги — широкий свисающий раструб, у служанки — закатан до локтя (сорочка), у слуги — узкий с каймой.
    if (id === 'wife') {
      sb.loft(
        [
          { c: along(elb, wr, -0.05), u: [1, 0, 0], v: [0, 0, 1], ru: 0.046 * s, rv: 0.047 * s },
          { c: along(elb, wr, 0.5), u: [1, 0, 0], v: [0, 0, 1], ru: 0.05 * s, rv: 0.055 * s },
          { c: along(elb, wr, 0.9), u: [1, 0, 0], v: [0, 0, 1], ru: 0.085 * s, rv: 0.1 * s },
          { c: [wr[0], wr[1] - 0.16 * s, wr[2] - 0.02], u: [1, 0, 0], v: [0, 0, 1], ru: 0.07 * s, rv: 0.13 * s },
        ],
        seg,
        'plain',
        L.cloth,
      );
      sb.loft([{ c: [wr[0], wr[1] - 0.15 * s, wr[2] - 0.02], u: [1, 0, 0], v: [0, 0, 1], ru: 0.071 * s, rv: 0.131 * s }, { c: [wr[0], wr[1] - 0.17 * s, wr[2] - 0.02], u: [1, 0, 0], v: [0, 0, 1], ru: 0.072 * s, rv: 0.133 * s }], seg, 'plain', L.trim);
      // Узкий рукав исподнего платья — до запястья.
      sb.loft([{ c: along(elb, wr, 0.3), u: [1, 0, 0], v: [0, 0, 1], ru: 0.036 * s, rv: 0.036 * s }, { c: along(elb, wr, 1.0), u: [1, 0, 0], v: [0, 0, 1], ru: 0.03 * s, rv: 0.03 * s }], seg, 'plain', L.under, { cap1: true });
    } else if (id === 'advisor') {
      // Рукав мантии — широкий раструб до запястья с меховым обшлагом.
      sb.loft([{ c: along(elb, wr, -0.05), u: [1, 0, 0], v: [0, 0, 1], ru: 0.047 * s, rv: 0.048 * s }, { c: along(elb, wr, 0.55), u: [1, 0, 0], v: [0, 0, 1], ru: 0.056 * s, rv: 0.06 * s }, { c: along(elb, wr, 0.92), u: [1, 0, 0], v: [0, 0, 1], ru: 0.066 * s, rv: 0.072 * s }], seg, 'plain', L.cloth);
      sb.loft([{ c: along(elb, wr, 0.86), u: [1, 0, 0], v: [0, 0, 1], ru: 0.068 * s, rv: 0.074 * s }, { c: along(elb, wr, 1.0), u: [1, 0, 0], v: [0, 0, 1], ru: 0.072 * s, rv: 0.078 * s }], seg, 'plain', L.trim, { cap1: true });
    } else if (id === 'maid') {
      sb.loft([{ c: along(elb, wr, -0.06), u: [1, 0, 0], v: [0, 0, 1], ru: 0.05 * s, rv: 0.05 * s }, { c: along(elb, wr, 0.12), u: [1, 0, 0], v: [0, 0, 1], ru: 0.047 * s, rv: 0.047 * s }], seg, 'plain', L.linen);
      sb.loft([{ c: along(elb, wr, 0.1), u: [1, 0, 0], v: [0, 0, 1], ru: 0.036 * s, rv: 0.037 * s }, { c: along(elb, wr, 1.0), u: [1, 0, 0], v: [0, 0, 1], ru: 0.027 * s, rv: 0.028 * s }], seg, 'plain', L.skin, { cap1: true });
    } else {
      sb.loft([{ c: along(elb, wr, -0.05), u: [1, 0, 0], v: [0, 0, 1], ru: 0.045 * s, rv: 0.046 * s }, { c: along(elb, wr, 0.92), u: [1, 0, 0], v: [0, 0, 1], ru: 0.034 * s, rv: 0.035 * s }], seg, 'plain', L.cloth);
      sb.loft([{ c: along(elb, wr, 0.88), u: [1, 0, 0], v: [0, 0, 1], ru: 0.0355 * s, rv: 0.036 * s }, { c: along(elb, wr, 1.0), u: [1, 0, 0], v: [0, 0, 1], ru: 0.036 * s, rv: 0.037 * s }], seg, 'plain', L.trim, { cap1: true });
    }
    sb.bone(`hand${side}`);
    hand(sb, wr, sx, s * (female ? 0.92 : 1), L.skin, detail);
  }

  // ---------- Ноги ----------
  for (const [side, sx] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    const hip = sk.bones[sk.of(`thigh${side}`)].j;
    const knee = sk.bones[sk.of(`shin${side}`)].j;
    const ank = sk.bones[sk.of(`foot${side}`)].j;
    sb.bone(`thigh${side}`);
    sb.loft([ringY(hip[1] + 0.03, 0.074 * s, 0.08 * s, hip[0], hip[2]), ringY((hip[1] + knee[1]) / 2, 0.063 * s, 0.068 * s, (hip[0] + knee[0]) / 2, 0.006), ringY(knee[1] - 0.02, 0.05 * s, 0.054 * s, knee[0], knee[2])], seg, 'plain', isLong(L) ? L.under : L.hose);
    sb.bone(`shin${side}`);
    // Сапоги гонца — кожа до колена, низ пыльный с дороги; у остальных — чулки.
    const boot = id === 'herald';
    sb.loft(
      [
        ringY(knee[1] + 0.01, (boot ? 0.056 : 0.05) * s, (boot ? 0.06 : 0.054) * s, knee[0], knee[2]),
        ringY(knee[1] - 0.12 * s, (boot ? 0.054 : 0.05) * s, (boot ? 0.058 : 0.056) * s, knee[0], knee[2] - 0.006),
        ringY(ank[1] + 0.03, (boot ? 0.04 : 0.033) * s, (boot ? 0.042 : 0.035) * s, ank[0], ank[2]),
      ],
      seg,
      'plain',
      boot ? (i: number) => (i === 2 ? mixC(L.shoe, tint(0x8a7a62), 0.35) : i === 0 ? mixC(L.shoe, tint(0x000000), 0.1) : L.shoe) : L.hose,
    );
    sb.bone(`foot${side}`);
    // Башмак: петлёй вдоль ступни, от пятки к носку; поворотный башмак 1200 года — мягкий, с острым носом.
    const fx = ank[0];
    sb.loft(
      [
        { c: [fx, ank[1] - 0.04, ank[2] - 0.045 * s], u: [1, 0, 0], v: [0, 1, 0], ru: 0.035 * s, rv: 0.045 * s },
        { c: [fx, ank[1] - 0.045, ank[2] + 0.03 * s], u: [1, 0, 0], v: [0, 1, 0], ru: 0.042 * s, rv: 0.042 * s },
        { c: [fx, ank[1] - 0.06, ank[2] + 0.11 * s], u: [1, 0, 0], v: [0, 1, 0], ru: 0.04 * s, rv: 0.026 * s },
        { c: [fx + 0.004 * sx, ank[1] - 0.07, ank[2] + 0.17 * s], u: [1, 0, 0], v: [0, 1, 0], ru: 0.016 * s, rv: 0.013 * s },
      ],
      seg,
      'plain',
      L.shoe,
      { cap0: true, cap1: true },
    );
  }
  return sb;
}

/** Передник: полотно перед подолом по кольцам (половина круга спереди), двустороннее светом шейдера покоев. */
function apron(sb: SkinBuilder, rows: readonly Ring[], col: V3): void {
  const from = sb.m.b.vertexCount;
  const n = 6;
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    for (let k = 0; k < n; k++) {
      const x0 = -a.ru + (2 * a.ru * k) / n;
      const x1 = -a.ru + (2 * a.ru * (k + 1)) / n;
      const y0 = -b.ru + (2 * b.ru * k) / n;
      const y1 = -b.ru + (2 * b.ru * (k + 1)) / n;
      // Полотно огибает подол: к краям уходит назад по его кругу.
      const bow = (x: number, r: Ring): number => r.c[2] - (x * x) / (r.ru * 2.6);
      sb.m.quad([x1, a.c[1], bow(x1, a)], [x0, a.c[1], bow(x0, a)], [y0, b.c[1], bow(y0, b)], [y1, b.c[1], bow(y1, b)], 'plain', col);
    }
  }
  sb.m.smoothFrom(from, 40);
}

/**
 * Голова: череп и лицо петлёй колец, глаза (белок, радужка, веко), брови, нос, губы, уши; волосы, борода, чепец или плат
 * с подбородником и обруч. Лицо смотрит на +z.
 */
function head(sb: SkinBuilder, L: Look, seg: number, id: FolkId): void {
  const s = L.s;
  const f = L.female;
  const k = f ? 0.93 : 1;
  const Y = (y: number): number => y * s;
  const hs = (v: number): number => v * s * k;
  const hseg = seg + 5;
  // Профиль: подбородок — челюсть — щёки — глаза — лоб — темя (y, полуширина, полуглубина, вынос лица вперёд).
  const prof: [number, number, number, number][] = f
    ? [
        [1.567, 0.03, 0.035, 0.05],
        [1.585, 0.052, 0.068, 0.03],
        [1.612, 0.066, 0.086, 0.016],
        [1.642, 0.072, 0.094, 0.006],
        [1.672, 0.073, 0.097, 0],
        [1.702, 0.07, 0.093, -0.004],
        [1.728, 0.056, 0.078, -0.008],
        [1.744, 0.032, 0.048, -0.01],
      ]
    : [
        [1.562, 0.034, 0.04, 0.052],
        [1.582, 0.06, 0.074, 0.032],
        [1.612, 0.072, 0.09, 0.018],
        [1.642, 0.076, 0.097, 0.008],
        [1.672, 0.077, 0.099, 0.002],
        [1.705, 0.073, 0.094, -0.004],
        [1.732, 0.058, 0.078, -0.008],
        [1.75, 0.032, 0.046, -0.01],
      ];
  const r0 = prof[0];
  const rl = prof[prof.length - 1];
  sb.loftTipped(
    [0, Y(r0[0] - 0.006), hs(r0[3])],
    prof.map(([y, rx, rz, fz]) => ringY(Y(y), hs(rx), hs(rz), 0, hs(fz))),
    [0, Y(rl[0] + 0.01), hs(rl[3] - 0.004)],
    hseg,
    'plain',
    (i) => (i <= 2 ? mixC(L.skin, L.lip, f ? 0.06 : 0.1) : L.skin),
  );
  // Поверхность лица спереди на высоте y и сдвиге x: где ставить черты.
  const faceZ = (y: number, x: number): number => {
    for (let i = 0; i + 1 < prof.length; i++) {
      const a = prof[i];
      const b = prof[i + 1];
      if (y >= a[0] && y <= b[0]) {
        const t = (y - a[0]) / (b[0] - a[0]);
        const rx = a[1] + (b[1] - a[1]) * t;
        const rz = a[2] + (b[2] - a[2]) * t;
        const fz = a[3] + (b[3] - a[3]) * t;
        return hs(fz + rz * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)));
      }
    }
    return hs(0.09);
  };
  const ey = 1.645;
  const ex = f ? 0.03 : 0.032;
  // Глаза: белок — уплощённый шар, радужка — тёмный диск с бликом, верхнее веко — тёмная дуга.
  for (const sx of [1, -1]) {
    const x = hs(ex) * sx;
    const z = faceZ(ey, ex) - hs(0.006);
    sb.ball([x, Y(ey), z], hs(0.0115), 8, 'plain', tint(0xe8e2d6), 0.62, 0.55);
    sb.ball([x, Y(ey - 0.0005), z + hs(0.0055)], hs(0.0058), 7, 'plain', L.iris, 1, 0.35);
    sb.ball([x, Y(ey - 0.0005), z + hs(0.0076)], hs(0.0026), 5, 'plain', tint(0x14100e), 1, 0.3);
    // Веко: полоска над белком.
    const lidY = Y(ey + 0.0068);
    sb.m.quad([x - hs(0.013), lidY - hs(0.002), z + hs(0.004)], [x + hs(0.013), lidY - hs(0.002), z + hs(0.004)], [x + hs(0.011), lidY + hs(0.003), z + hs(0.003)], [x - hs(0.011), lidY + hs(0.003), z + hs(0.003)], 'plain', mixC(L.skin, tint(0x2a1a14), 0.55));
    // Бровь: над глазом, у мужчин гуще, у женщин — тонкая дуга.
    const by = Y(ey + 0.019);
    const bz = faceZ(ey + 0.019, ex) + hs(0.002);
    const bw = f ? 0.0022 : 0.004;
    const inner = x - sx * hs(0.014);
    const outer = x + sx * hs(0.016);
    const quad = (a: V3, b: V3, c: V3, d: V3): void => (sx > 0 ? sb.m.quad(a, b, c, d, 'plain', L.brow) : sb.m.quad(b, a, d, c, 'plain', L.brow));
    quad([inner, by - hs(bw), bz + hs(0.002)], [outer, by - hs(bw) - hs(0.002), bz - hs(0.004)], [outer, by + hs(bw) - hs(0.003), bz - hs(0.004)], [inner, by + hs(bw), bz + hs(0.002)]);
    // Ухо: плоская раковина сбоку.
    const earX = hs(0.074) * sx;
    sb.loft(
      [
        { c: [earX, Y(1.63), hs(-0.004)], u: [0, 1, 0], v: [0, 0, 1], ru: hs(0.022), rv: hs(0.012) },
        { c: [earX + sx * hs(0.008), Y(1.632), hs(-0.008)], u: [0, 1, 0], v: [0, 0, 1], ru: hs(0.024), rv: hs(0.014) },
      ],
      7,
      'plain',
      mixC(L.skin, L.lip, 0.15),
      { cap1: true },
    );
  }
  // Нос: спинка от переносицы к кончику, крылья.
  const nz0 = faceZ(1.655, 0) - hs(0.004);
  const tip: V3 = [0, Y(1.62), faceZ(1.62, 0) + hs(f ? 0.016 : 0.02)];
  const root: V3 = [0, Y(1.657), nz0];
  const wing = hs(f ? 0.012 : 0.014);
  const baseY = Y(1.611);
  const bzN = faceZ(1.611, 0.01);
  const nose = mixC(L.skin, L.lip, 0.12);
  sb.m.tri(root, [-wing, baseY, bzN], tip, 'plain', nose);
  sb.m.tri(root, tip, [wing, baseY, bzN], 'plain', nose);
  sb.m.tri([-wing, baseY, bzN], [wing, baseY, bzN], tip, 'plain', mixC(nose, tint(0x3a2018), 0.3));
  // Губы: верхняя и нижняя — полукольца, у женщин полнее и ярче.
  const my = 1.597;
  const mz = faceZ(my, 0) + hs(0.002);
  const mw = hs(f ? 0.019 : 0.021);
  const lipT = f ? L.lip : mixC(L.lip, L.skin, 0.35);
  sb.m.quad([-mw, Y(my), mz - hs(0.004)], [mw, Y(my), mz - hs(0.004)], [hs(0.008), Y(my + 0.006), mz + hs(0.002)], [-hs(0.008), Y(my + 0.006), mz + hs(0.002)], 'plain', lipT);
  sb.m.quad([-hs(0.008), Y(my - 0.007), mz + hs(0.001)], [hs(0.008), Y(my - 0.007), mz + hs(0.001)], [mw, Y(my), mz - hs(0.004)], [-mw, Y(my), mz - hs(0.004)], 'plain', mixC(lipT, L.skin, 0.15));

  // ---------- Волосы и убор ----------
  if (id === 'herald') {
    // Волосы «под горшок» — по моде 1200 года: шапка волос до бровей спереди и до мочек сбоку; лицо бритое, с тенью щетины.
    sb.loft(
      [ringY(Y(1.632), hs(0.081), hs(0.09), 0, hs(-0.014)), ringY(Y(1.69), hs(0.085), hs(0.104), 0, hs(-0.004)), ringY(Y(1.735), hs(0.074), hs(0.092), 0, hs(-0.01)), ringY(Y(1.758), hs(0.04), hs(0.052), 0, hs(-0.012))],
      hseg,
      'plain',
      (i, kk) => {
        // Спереди ниже бровей — лоб открыт: нижнее кольцо лица — кожа.
        const a = ((kk + 0.5) / hseg) * Math.PI * 2;
        return Math.sin(a) > 0.6 && i === 0 ? L.skin : L.hair;
      },
      { cap1: true, phase: 0 },
    );
    // Чёлка над бровями.
    const fz = faceZ(1.69, 0) + hs(0.004);
    sb.m.quad([-hs(0.06), Y(1.672), fz - hs(0.02)], [hs(0.06), Y(1.672), fz - hs(0.02)], [hs(0.058), Y(1.705), fz - hs(0.012)], [-hs(0.058), Y(1.705), fz - hs(0.012)], 'plain', L.hair);
  } else if (id === 'advisor') {
    // Седые волосы до шеи из-под чёрной шапочки, борода — широкая, до груди, усы в бороду.
    sb.loft([ringY(Y(1.58), hs(0.082), hs(0.088), 0, hs(-0.02)), ringY(Y(1.64), hs(0.085), hs(0.098), 0, hs(-0.012)), ringY(Y(1.69), hs(0.082), hs(0.1), 0, hs(-0.006))], hseg, 'plain', (i, kk) => {
      const a = ((kk + 0.5) / hseg) * Math.PI * 2;
      return Math.sin(a) > 0.45 ? L.skin : L.hair;
    });
    sb.loftTipped(
      [0, Y(1.775), hs(-0.01)],
      [ringY(Y(1.745), hs(0.072), hs(0.09), 0, hs(-0.01)), ringY(Y(1.71), hs(0.086), hs(0.106), 0, hs(-0.008)), ringY(Y(1.69), hs(0.087), hs(0.107), 0, hs(-0.008))],
      [0, Y(1.688), hs(-0.008)],
      hseg,
      'plain',
      L.linen,
    );
    sb.loftTipped(
      [0, Y(1.43), hs(0.1)],
      [ringY(Y(1.5), hs(0.06), hs(0.05), 0, hs(0.07)), ringY(Y(1.555), hs(0.074), hs(0.07), 0, hs(0.05)), ringY(Y(1.595), hs(0.078), hs(0.09), 0, hs(0.014))],
      [0, Y(1.605), hs(0.0)],
      hseg,
      'plain',
      (i) => (i === 0 ? mixC(L.hair, tint(0xffffff), 0.12) : L.hair),
    );
    const uz = faceZ(1.604, 0.012) + hs(0.003);
    sb.m.quad([-hs(0.03), Y(1.594), uz - hs(0.01)], [hs(0.03), Y(1.594), uz - hs(0.01)], [hs(0.006), Y(1.607), uz + hs(0.004)], [-hs(0.006), Y(1.607), uz + hs(0.004)], 'plain', L.hair);
  } else if (id === 'servant') {
    // Седина: венчик по затылку и вискам, темя редкое (тон кожи с сединой), борода и усы коротко.
    sb.loft(
      [ringY(Y(1.625), hs(0.08), hs(0.088), 0, hs(-0.012)), ringY(Y(1.68), hs(0.083), hs(0.1), 0, hs(-0.006)), ringY(Y(1.72), hs(0.074), hs(0.09), 0, hs(-0.012)), ringY(Y(1.748), hs(0.045), hs(0.058), 0, hs(-0.014))],
      hseg,
      'plain',
      (i, kk) => {
        // Спереди (лоб) — кожа: залысины; сзади и с боков — седина.
        const a = ((kk + 0.5) / hseg) * Math.PI * 2;
        const front = Math.sin(a) > 0.55 && i >= 1;
        return front ? mixC(L.skin, L.hair, 0.15) : L.hair;
      },
      { cap1: true, phase: 0 },
    );
    // Борода: от висков по челюсти к подбородку — короткая.
    sb.loftTipped(
      [0, Y(1.545), hs(0.07)],
      [ringY(Y(1.565), hs(0.05), hs(0.06), 0, hs(0.035)), ringY(Y(1.59), hs(0.075), hs(0.088), 0, hs(0.012))],
      [0, Y(1.6), hs(0.0)],
      hseg,
      'plain',
      L.hair,
    );
    // Усы.
    const uz = faceZ(1.604, 0.012) + hs(0.003);
    sb.m.quad([-hs(0.024), Y(1.597), uz - hs(0.008)], [hs(0.024), Y(1.597), uz - hs(0.008)], [hs(0.006), Y(1.607), uz + hs(0.004)], [-hs(0.006), Y(1.607), uz + hs(0.004)], 'plain', L.hair);
  } else if (id === 'maid') {
    // Волосы спереди из-под чепца, чепец (кружок льна с завязками под подбородком), коса по спине.
    sb.loft([ringY(Y(1.678), hs(0.079), hs(0.101), 0, hs(-0.001)), ringY(Y(1.705), hs(0.077), hs(0.098), 0, hs(-0.006))], hseg, 'plain', L.hair);
    sb.loftTipped(
      [0, Y(1.765), hs(-0.012)],
      [ringY(Y(1.738), hs(0.07), hs(0.09), 0, hs(-0.012)), ringY(Y(1.71), hs(0.083), hs(0.104), 0, hs(-0.012)), ringY(Y(1.66), hs(0.085), hs(0.1), 0, hs(-0.024)), ringY(Y(1.6), hs(0.072), hs(0.075), 0, hs(-0.04))],
      [0, Y(1.585), hs(-0.06)],
      hseg,
      'plain',
      L.linen,
    );
    // Коса: звеньями вниз по спине от затылка, перехвачена лентой.
    let p: V3 = [0, Y(1.62), hs(-0.085)];
    for (let i = 0; i < 6; i++) {
      const q: V3 = [Math.sin(i * 1.7) * 0.006, p[1] - 0.055 * s, p[2] - 0.012 + i * 0.002];
      sb.rod(p, q, hs(0.017 - i * 0.0012), hs(0.014 - i * 0.0012), 6, 'plain', i % 2 ? mixC(L.hair, tint(0x000000), 0.15) : L.hair, false);
      p = q;
    }
    sb.ball(p, hs(0.012), 6, 'plain', tint(0x8a2a24));
  } else {
    // Волосы на лбу под платом, барбет (полотно под подбородком к вискам), плат на голове и плечах, золотой обруч.
    sb.loft([ringY(Y(1.682), hs(0.079), hs(0.1), 0, 0), ringY(Y(1.7), hs(0.077), hs(0.098), 0, hs(-0.004))], hseg, 'plain', L.hair);
    // Барбет: полоса льна под подбородком вокруг лица до темени.
    sb.loftTipped(
      [0, Y(1.548), hs(0.035)],
      [ringY(Y(1.56), hs(0.05), hs(0.06), 0, hs(0.02)), ringY(Y(1.6), hs(0.083), hs(0.086), 0, hs(-0.008)), ringY(Y(1.64), hs(0.086), hs(0.08), 0, hs(-0.026))],
      [0, Y(1.69), hs(-0.06)],
      hseg,
      'plain',
      L.linen,
    );
    // Плат: от темени по затылку на плечи.
    sb.loftTipped(
      [0, Y(1.768), hs(-0.008)],
      [
        ringY(Y(1.742), hs(0.074), hs(0.095), 0, hs(-0.008)),
        ringY(Y(1.7), hs(0.088), hs(0.108), 0, hs(-0.012)),
        ringY(Y(1.63), hs(0.094), hs(0.1), 0, hs(-0.03)),
        ringY(Y(1.54), hs(0.12), hs(0.085), 0, hs(-0.05)),
        ringY(Y(1.46), hs(0.17), hs(0.07), 0, hs(-0.06)),
      ],
      [0, Y(1.43), hs(-0.075)],
      hseg,
      'plain',
      mixC(L.linen, tint(0xd8d0c0), 0.4),
    );
    sb.m.shine = 0.75;
    sb.loft([ringY(Y(1.708), hs(0.091), hs(0.112), 0, hs(-0.006)), ringY(Y(1.724), hs(0.088), hs(0.108), 0, hs(-0.006))], hseg, 'plain', L.belt);
    sb.m.shine = 0;
  }
}

/** Кисть: ладонь, четыре пальца одним рядом и большой палец; ладонь к бедру (`sx` — сторона). */
function hand(sb: SkinBuilder, wr: V3, sx: number, s: number, skin: V3, detail: Detail): void {
  const palmL = 0.085 * s;
  const seg = detail === 0 ? 5 : 6;
  // Ладонь в плоскости y–z: ширина — по z, толщина — по x.
  sb.loft(
    [
      { c: [wr[0], wr[1] + 0.005, wr[2]], u: [0, 0, 1], v: [1, 0, 0], ru: 0.03 * s, rv: 0.016 * s },
      { c: [wr[0] - 0.002 * sx, wr[1] - palmL * 0.5, wr[2] + 0.004], u: [0, 0, 1], v: [1, 0, 0], ru: 0.041 * s, rv: 0.015 * s },
      { c: [wr[0] - 0.004 * sx, wr[1] - palmL, wr[2] + 0.006], u: [0, 0, 1], v: [1, 0, 0], ru: 0.04 * s, rv: 0.012 * s },
    ],
    seg + 2,
    'plain',
    skin,
    { cap0: true },
  );
  // Пальцы: чуть согнуты к ладони (к −x у левой).
  const lens = [0.07, 0.078, 0.073, 0.058];
  for (let i = 0; i < 4; i++) {
    const z = wr[2] + 0.006 + (0.027 - i * 0.018) * s;
    const a: V3 = [wr[0] - 0.004 * sx, wr[1] - palmL + 0.004, z];
    const l = lens[i] * s;
    const m: V3 = [a[0] - 0.006 * sx, a[1] - l * 0.55, z + 0.002];
    const e: V3 = [a[0] - 0.016 * sx, a[1] - l, z + 0.004];
    sb.rod(a, m, 0.0095 * s, 0.0085 * s, seg - 1, 'plain', skin, false);
    sb.rod(m, e, 0.0085 * s, 0.007 * s, seg - 1, 'plain', skin, true);
  }
  // Большой палец: от основания ладони вперёд и вниз.
  const t0: V3 = [wr[0] - 0.008 * sx, wr[1] - 0.025 * s, wr[2] + 0.03 * s];
  const t1: V3 = [t0[0] - 0.012 * sx, t0[1] - 0.035 * s, t0[2] + 0.022 * s];
  const t2: V3 = [t1[0] - 0.008 * sx, t1[1] - 0.028 * s, t1[2] + 0.008 * s];
  sb.rod(t0, t1, 0.012 * s, 0.01 * s, seg - 1, 'plain', skin, false);
  sb.rod(t1, t2, 0.0098 * s, 0.0078 * s, seg - 1, 'plain', skin, true);
}

const mixC = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// ---------- Движения ----------

/** Что держит человек: кувшин (служанка), кота на руках (слуга), письмо с печатью (гонец), свиток доклада (советник). */
export type Carry = 'none' | 'jug' | 'cat' | 'letter' | 'scroll';

/**
 * Доли жестов поверх стояния и шага: поклон, реверанс, речь руками, налить (наклон кувшина 0…1), нести на руках, взять с
 * пола, тянуться к двери; взгляд головы — поворот и наклон к тому, с кем говорит.
 */
export interface Gesture {
  bow: number;
  curtsy: number;
  talk: number;
  pour: number;
  tip: number;
  carry: number;
  stoop: number;
  reach: number;
  /** Протянуть письмо правой рукой (гонец). */
  offer: number;
  /** Держать свиток перед грудью левой рукой и читать с него (советник). */
  read: number;
  lookYaw: number;
  lookPitch: number;
}

export const STILL: Gesture = { bow: 0, curtsy: 0, talk: 0, pour: 0, tip: 0, carry: 0, stoop: 0, reach: 0, offer: 0, read: 0, lookYaw: 0, lookPitch: 0 };

type Turns = Record<string, [number, number, number]>;
const add = (o: Turns, bone: string, x: number, y = 0, z = 0): void => {
  const t = o[bone] ?? (o[bone] = [0, 0, 0]);
  t[0] += x;
  t[1] += y;
  t[2] += z;
};

/**
 * Поза кадра: шаг (фаза шага `phase`, доля хода `walk`), дыхание и переминание (`t`), жесты поверх. Старик ходит чуть
 * сутулясь, женщины — короче шагом и мягче руками. Возвращает повороты костей и сдвиг таза.
 */
export function posture(id: FolkId, t: number, phase: number, walk: number, g: Gesture): { turns: Turns; lift: V3 } {
  const o: Turns = {};
  const female = isFemale(id);
  const old = id === 'servant' || id === 'advisor';
  // Стоя: дыхание, лёгкое переминание; старик сутулится.
  const breath = Math.sin(t * 1.6) * 0.012;
  add(o, 'chest', -breath + (old ? 0.1 : 0));
  add(o, 'neck', old ? 0.06 : 0);
  add(o, 'head', old ? 0.04 : 0);
  const shift = Math.sin(t * 0.37) * 0.025 * (1 - walk);
  add(o, 'hips', 0, 0, shift * 0.6);
  add(o, 'spine', 0, 0, -shift * 0.4);
  // Руки вдоль тела — чуть согнуты, кисти расслаблены.
  for (const [side, sx] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    add(o, `arm${side}`, -0.05, 0, sx * 0.06);
    add(o, `fore${side}`, -0.18);
    add(o, `hand${side}`, -0.05);
  }
  // Шаг.
  const amp = female ? 0.3 : 0.4;
  const sw = Math.sin(phase);
  const lift: V3 = [0, 0, 0];
  if (walk > 0.001) {
    for (const [side, ph] of [
      ['L', 0],
      ['R', Math.PI],
    ] as const) {
      const p = phase + ph;
      const leg = Math.sin(p);
      // Бедро вперёд-назад, колено гнётся, когда нога идёт вперёд по воздуху, ступня держит носок.
      add(o, `thigh${side}`, -leg * amp * walk);
      const knee = Math.max(0, Math.sin(p - 0.9)) * 0.75 + 0.08;
      add(o, `shin${side}`, knee * walk);
      add(o, `foot${side}`, (-knee * 0.4 + leg * 0.15) * walk);
      // Рука — против ноги той же стороны.
      add(o, `arm${side}`, leg * (female ? 0.16 : 0.26) * walk);
      add(o, `fore${side}`, -Math.max(0, leg) * 0.18 * walk);
    }
    add(o, 'hips', 0, sw * 0.07 * walk, 0);
    add(o, 'chest', 0.04 * walk, -sw * 0.09 * walk, 0);
    lift[1] = -Math.abs(Math.cos(phase)) * 0.022 * walk + 0.01 * walk;
  }
  // Поклон: спина и голова вперёд, правая рука к груди, левая чуть назад.
  if (g.bow > 0) {
    const b = g.bow;
    add(o, 'spine', 0.3 * b);
    add(o, 'chest', 0.32 * b);
    add(o, 'neck', 0.12 * b);
    add(o, 'head', 0.18 * b);
    // Правая рука — к сердцу: плечо чуть вперёд и к телу, локоть согнут до упора.
    add(o, 'armR', -0.3 * b, 0, 0.14 * b);
    add(o, 'foreR', -1.85 * b, 0.95 * b, 0);
    add(o, 'handR', 0.1 * b, 0, 0.35 * b);
    add(o, 'armL', 0.18 * b, 0, 0.05 * b);
    lift[2] -= 0.05 * b;
  }
  // Реверанс: колени согнуты, правая нога за левой, голова склонена, руки придерживают подол.
  if (g.curtsy > 0) {
    const c = g.curtsy;
    add(o, 'thighL', -0.32 * c);
    add(o, 'shinL', 0.65 * c);
    add(o, 'footL', -0.33 * c);
    add(o, 'thighR', 0.1 * c);
    add(o, 'shinR', 0.75 * c);
    add(o, 'footR', -0.4 * c);
    add(o, 'spine', 0.1 * c);
    add(o, 'neck', 0.12 * c);
    add(o, 'head', 0.22 * c);
    for (const [side, sx] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      add(o, `arm${side}`, -0.1 * c, 0, sx * 0.3 * c);
      add(o, `fore${side}`, -0.45 * c);
    }
    lift[1] -= 0.13 * c;
    lift[2] -= 0.02 * c;
  }
  // Речь: правая рука объясняет, голова кивает, плечи живые. Правая занята (протянутое письмо) — объясняет только голова;
  // левая держит свиток — она не машет.
  if (g.talk > 0) {
    const k = g.talk;
    const kr = k * (1 - g.offer);
    const kl = k * (1 - g.read);
    const a = Math.sin(t * 2.1) * 0.5 + Math.sin(t * 3.7 + 1) * 0.5;
    const b = Math.sin(t * 1.3 + 2);
    add(o, 'armR', (-0.32 + 0.12 * a) * kr, 0, -0.08 * kr);
    add(o, 'foreR', (-1.0 + 0.3 * b) * kr, (0.4 + 0.2 * a) * kr, 0);
    add(o, 'handR', 0.2 * a * kr, 0, 0.45 * kr);
    add(o, 'armL', (-0.12 + 0.06 * b) * kl, 0, 0.04 * kl);
    add(o, 'foreL', (-0.4 - 0.25 * Math.max(0, a)) * kl);
    add(o, 'neck', 0.05 * Math.sin(t * 2.6) * k);
    add(o, 'head', 0.03 * Math.sin(t * 3.1 + 1) * k, 0.04 * Math.sin(t * 1.1) * k, 0.03 * Math.sin(t * 0.9) * k);
  }
  // Налить: правая рука с кувшином вперёд и вверх, кисть наклоняет кувшин (`tip`), левая — придерживает дно.
  if (g.pour > 0) {
    const p = g.pour;
    add(o, 'armR', -0.85 * p, -0.15 * p, -0.05 * p);
    add(o, 'foreR', -0.75 * p, 0.2 * p, 0);
    add(o, 'handR', 0, 0, (0.15 + 0.95 * g.tip) * p);
    add(o, 'armL', -0.6 * p, 0.1 * p, 0.12 * p);
    add(o, 'foreL', -1.15 * p, -0.4 * p, 0);
    add(o, 'spine', 0.08 * p);
    add(o, 'head', 0.25 * p);
  }
  // Нести на руках (кот): предплечья поперёк груди.
  if (g.carry > 0) {
    const c = g.carry;
    for (const [side, sx] of [
      ['L', 1],
      ['R', -1],
    ] as const) {
      add(o, `arm${side}`, -0.35 * c, 0, sx * 0.08 * c);
      add(o, `fore${side}`, -1.35 * c, -sx * 0.55 * c, 0);
      add(o, `hand${side}`, 0, 0, sx * 0.3 * c);
    }
    add(o, 'head', 0.25 * c);
  }
  // Взять с пола (опустить на пол): присесть, спину вперёд, руки вниз.
  if (g.stoop > 0) {
    const k = g.stoop;
    add(o, 'thighL', -0.95 * k);
    add(o, 'thighR', -0.95 * k);
    add(o, 'shinL', 1.6 * k);
    add(o, 'shinR', 1.6 * k);
    add(o, 'footL', -0.62 * k);
    add(o, 'footR', -0.62 * k);
    add(o, 'spine', 0.45 * k);
    add(o, 'chest', 0.2 * k);
    add(o, 'head', -0.2 * k);
    add(o, 'armL', -0.7 * k);
    add(o, 'armR', -0.7 * k);
    lift[1] -= 0.36 * k;
    lift[2] -= 0.1 * k;
  }
  // Протянуть письмо: правая рука вперёд на уровне груди, ладонь вверх; корпус чуть подаётся к правителю.
  if (g.offer > 0) {
    const k = g.offer;
    // Плечо вперёд и к середине тела, локоть чуть согнут: кисть — на высоте груди (1,34 м при росте 1,72), в полуметре
    // перед собой; большим пальцем вверх держит лист за нижний край — лицом к правителю.
    add(o, 'armR', -1.12 * k, 0.3 * k, 0.04 * k);
    add(o, 'foreR', -0.25 * k, 0.1 * k, 0);
    add(o, 'handR', -0.12 * k, 0, 0);
    add(o, 'spine', 0.08 * k);
    add(o, 'head', 0.06 * k);
  }
  // Свиток доклада: левое предплечье поднято перед грудью, кисть повёрнута свитком к глазам; голова — к свитку, когда не
  // смотрит на правителя.
  if (g.read > 0) {
    const k = g.read;
    add(o, 'armL', -0.42 * k, -0.2 * k, 0.12 * k);
    add(o, 'foreL', -1.3 * k, -0.45 * k, 0);
    add(o, 'handL', 0.15 * k, 0, -0.5 * k);
  }
  // Тянуться к ручке двери (правой).
  if (g.reach > 0) {
    const r = g.reach;
    add(o, 'armR', -1.1 * r, 0, -0.1 * r);
    add(o, 'foreR', -0.35 * r);
  }
  // Взгляд: голова и шея к собеседнику (до ±1,1 рад), плечи — малой долей.
  const ly = Math.max(-1.1, Math.min(1.1, g.lookYaw));
  const lp = Math.max(-0.5, Math.min(0.5, g.lookPitch));
  add(o, 'head', -lp * 0.6, ly * 0.55, 0);
  add(o, 'neck', -lp * 0.4, ly * 0.3, 0);
  add(o, 'chest', 0, ly * 0.12, 0);
  return { turns: o, lift };
}

/** Где правая кисть держит предмет (кувшин): точка у ладони в позе покоя — оси кисти. */
export function gripOf(sk: Skeleton, side: 'L' | 'R'): V3 {
  const j = sk.bones[sk.of(`hand${side}`)].j;
  return [j[0], j[1] - 0.06, j[2] + 0.02];
}

/** Тело человека покоев: сетка с костями — `rig.Rig` или своё (супруга, ЛЦ-2: `consort/skin.SkinBody`). */
export interface PersonBody {
  readonly mesh: THREE.Mesh;
  readonly sk: Skeleton;
  readonly triangles: number;
  pose(p: RigPose): void;
  write(): void;
  at(name: string, local?: V3): V3;
  axes(name: string): Float64Array;
  positions(): Float32Array;
  dispose(): void;
}

/** Своя живость тела: поза кадра вместо `posture` (жесты те же) и дело после отрисовки — свет на фигуре. */
export interface PersonMind {
  pose(t: number, phase: number, walk: number, g: Gesture, want: Gesture): { turns: Turns; lift: V3 };
  drawn?(): void;
}

/**
 * Человек покоев на сцене: сетка, место, путь и жесты. Жесты подходят к цели плавно (не рывком), шаг идёт по пути
 * с разгоном и торможением, поворот — не быстрее `TURN`. Рисуется только видимым (`visible`).
 */
export class Person {
  readonly rig: PersonBody;
  x = 0;
  /** Высота пола под ногами (ступени тамбура). */
  y = 0;
  z = 0;
  yaw = 0;
  visible = false;
  readonly g: Gesture = { ...STILL };
  /** Куда стремятся жесты. */
  readonly want: Gesture = { ...STILL };
  carry: Carry = 'none';
  private path: { x: number; z: number }[] = [];
  private faceAt: number | null = null;
  private v = 0;
  private phase = 0;
  private walkK = 0;
  private t = 0;
  /** Шаг: сколько метров прошёл — звуку шагов. */
  onStep: ((soft: boolean) => void) | null = null;

  constructor(
    readonly id: FolkId,
    body: SkinBuilder | PersonBody,
    material: THREE.Material | null,
    readonly speed: number,
    private mind: PersonMind | null = null,
  ) {
    this.rig = body instanceof SkinBuilder ? new Rig(body, material!, `chambers-${id}`) : body;
  }

  /** Идёт ли (есть путь или не встал). */
  get moving(): boolean {
    return this.path.length > 0 || this.v > 0.05;
  }

  /** Встать в точку сразу. */
  place(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.path = [];
    this.v = 0;
    this.faceAt = null;
  }

  /** Пойти по пути; придя — повернуться лицом к `face` (или остаться как шёл). */
  go(path: readonly { x: number; z: number }[], face: number | null = null): void {
    this.path = [...path];
    this.faceAt = face;
  }

  /** Повернуться на месте. */
  face(yaw: number): void {
    this.faceAt = yaw;
  }

  /** Стоит ли лицом куда надо и на месте. */
  get settled(): boolean {
    return !this.moving && (this.faceAt === null || Math.abs(wrap(this.faceAt - this.yaw)) < 0.05);
  }

  /** Шаг кадра: путь, поворот, жесты, поза. */
  step(dt: number, soft: (x: number, z: number) => boolean): void {
    this.t += dt;
    const target = this.path[0];
    if (target) {
      const left = this.path.reduce((a, p, i) => a + Math.hypot(p.x - (i ? this.path[i - 1].x : this.x), p.z - (i ? this.path[i - 1].z : this.z)), 0);
      const want = Math.min(this.speed, Math.sqrt(2 * 1.6 * left) + 0.05);
      this.v += Math.max(-2.4 * dt, Math.min(1.8 * dt, want - this.v));
      let d = this.v * dt;
      while (d > 0 && this.path.length) {
        const q = this.path[0];
        const seg = Math.hypot(q.x - this.x, q.z - this.z);
        const ahead = Math.atan2(q.x - this.x, q.z - this.z);
        if (seg > 0.05) this.turnTo(ahead, dt, 3.2);
        if (seg <= d) {
          this.x = q.x;
          this.z = q.z;
          d -= seg;
          this.path.shift();
        } else {
          this.x += ((q.x - this.x) / seg) * d;
          this.z += ((q.z - this.z) / seg) * d;
          d = 0;
        }
      }
    } else {
      this.v = Math.max(0, this.v - 3 * dt);
      if (this.faceAt !== null) this.turnTo(this.faceAt, dt, 2.4);
    }
    const before = Math.floor(this.phase / Math.PI);
    // Шаг 0,62 м (у женщин 0,55): фаза — по пройденному пути.
    this.phase += ((this.v * dt) / (isFemale(this.id) ? 0.55 : this.id === 'herald' ? 0.68 : 0.6)) * Math.PI;
    if (Math.floor(this.phase / Math.PI) !== before && this.v > 0.2) this.onStep?.(soft(this.x, this.z));
    this.walkK += (Math.min(1, this.v / Math.max(0.4, this.speed * 0.8)) - this.walkK) * Math.min(1, dt * 7);
    const ease = 1 - Math.exp(-dt * 4.5);
    for (const k of Object.keys(this.g) as (keyof Gesture)[]) this.g[k] += (this.want[k] - this.g[k]) * (k === 'tip' ? 1 - Math.exp(-dt * 3) : ease);
  }

  private turnTo(goal: number, dt: number, rate: number): void {
    const d = wrap(goal - this.yaw);
    this.yaw = wrap(this.yaw + Math.max(-rate * dt, Math.min(rate * dt, d * (1 - Math.exp(-dt * 8)))));
  }

  /** Поставить сетку в позу кадра (только видимую). */
  pose(): RigPose {
    const { turns, lift } = this.mind ? this.mind.pose(this.t, this.phase, this.walkK, this.g, this.want) : posture(this.id, this.t, this.phase, this.walkK, this.g);
    return { x: this.x, y: this.y, z: this.z, yaw: this.yaw, lift, turns: turns as Record<string, Turn> };
  }

  draw(origin: V3): void {
    this.rig.mesh.visible = this.visible;
    if (!this.visible) return;
    this.rig.mesh.position.set(origin[0], origin[1], origin[2]);
    this.rig.pose(this.pose());
    this.rig.write();
    this.mind?.drawn?.();
  }
}

export const wrap = (a: number): number => {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
};

export { PLAIN_LAYER };
export type { RoomLayer };
