// Лист тела супруги (ЛЦ-2, docs/characters.md): 512 × 512, кодом. Свет и тень нарисованы в самом листе, как у моделей
// классического Warcraft III: блики на плечах и на груди, мягкая тень в ложбинке и под грудью, складки, затемнение к
// подолу. Волосы — крупными прядями с тёмными промежутками и бликами по форме; корсаж — со шнуровкой и косточками;
// сорочка — со сборками; по подолу и по краю корсажа — свой орнамент.
//
// Волосы, торс и юбка — зеркальные половины (левый край — середина спереди, правый — середина сзади): узоры у краёв
// симметричны сами по себе, и край не повторяется, поэтому шва на линии зеркала нет (это держит тест).
import { SHEETS, SKIRT, TORSO, torsoV } from './figure';
import { mirrorU } from '../kit/body';
import type { Look } from './looks';
import { Img, around, boxOf, circle, ellipse, flesh, hex, mix, noise, poly, rng, stroke, tone, type RGB } from '../kit/paint';
import { hairStrands, ornamentBand, paintMitten, skinTube, type StrandSpec } from '../kit/cloth';

const W = 512;

/** Строка листа торса по высоте над полом (ряды `figure.TORSO`). */
const torsoY = (() => {
  const vs = torsoV();
  return (y: number): number => {
    if (y >= TORSO[0].y) return vs[0];
    for (let i = 1; i < TORSO.length; i++)
      if (y >= TORSO[i].y) {
        const k = (TORSO[i - 1].y - y) / (TORSO[i - 1].y - TORSO[i].y);
        return vs[i - 1] + (vs[i] - vs[i - 1]) * k;
      }
    return vs[vs.length - 1];
  };
})();
/** Обратно: строка торса → высота. */
function yOfTorso(py: number): number {
  let lo = 0.8;
  let hi = 1.32;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (torsoY(mid) > py) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
const ax = (a: number): number => mirrorU(a);
const aOf = (x: number): number => (x / W) * Math.PI;

/** Вырез сорочки и край корсажа по углу: высота над полом. */
export const neckline = (a: number): number => {
  const x = Math.min(1, Math.abs(a) / 1.25);
  return Math.abs(a) > 1.25 ? 1.19 - 0.012 * Math.min(1, (Math.abs(a) - 1.25) / 0.8) : 1.079 + 0.113 * x * x * (3 - 2 * x);
};
export const bodiceTop = (a: number): number => {
  const x = Math.min(1, Math.abs(a) / 1.0);
  return 1.057 + 0.043 * x * x * (3 - 2 * x) + (Math.abs(a) > 1.6 ? 0.008 : 0);
};

export function paintCloth(look: Look): Img {
  const img = new Img(W, W);
  const p = look.palette;
  const skin = hex(p.skin);
  const hair = hex(p.hair);
  const linen = hex(p.linen);
  const bodice = hex(p.bodice);
  const skirt = hex(p.skirt);
  const gold = hex(p.gold);
  const gem = hex(p.iris);
  paintHair(img, hair);
  paintTorso(img, skin, linen, bodice, gold);
  paintSkirt(img, skirt, bodice, gold);
  paintArms(img, skin, linen, gold);
  paintGold(img, gold, gem);
  return img;
}

/** Пряди супруги: восемь на половину листа (круг 13: у лица и на плечах видно по две-три пряди с тёмными зазорами). */
const STRANDS: StrandSpec = { seed: [31, 41], n: 8, w: 70, wv: 14, top: 33, cap: 34, crown: 22, wave: [20, 30], taper: [100, 30], shine: [50, 92], shineLen: [18, 8] };

function paintHair(img: Img, hair: RGB): void {
  hairStrands(img, { x0: 0, y0: 0, x1: W, y1: SHEETS.hair.y1 }, hair, STRANDS);
}

function paintTorso(img: Img, skin: RGB, linen: RGB, bodice: RGB, gold: RGB): void {
  const T = SHEETS.torso;
  const box = { x0: 0, y0: T.y0, x1: W, y1: T.y1 };
  const n = noise(57);
  const r = rng(61);
  // Слои по высоте: кожа над вырезом, сорочка до корсажа, корсаж до пояса.
  const zoneAt = (x: number, y: number): { a: number; h: number } => ({ a: aOf(x), h: yOfTorso(y) });
  img.shape((x, y) => -1, box, (x, y) => {
    const { a, h } = zoneAt(x, y);
    const side = Math.min(1, Math.max(0, (Math.abs(a) - 0.9) / 1.2));
    if (h > neckline(a)) {
      // Кожа: шея под подбородком в тени, грудь светлее, к бокам — в тень.
      // Под подбородком — та же тёплая тень, что у низа листа лица (шва нет); к ключицам светлеет.
      // Тень от подбородка на шее — по его форме: ниже посередине, к бокам выше (не ошейником).
      // Перед шеи ниже тени — на свету (середина — светлее боков, их тени — плоскостями ниже).
      // Бока шеи — в тень мягко, по углу (не плоскостями с краем: края читались швами, круг 12).
      const edge = 1.274 + 0.022 * Math.min(1, Math.abs(a) / 1.3) ** 2;
      const neck = h > edge - 0.01 ? -1 * Math.min(1, (h - edge + 0.01) / 0.008) ** 0.7 : 0;
      const up = Math.min(1, Math.max(0, (h - 1.205) / 0.03));
      const front = -0.8 * up * Math.min(1, Math.max(0, (Math.abs(a) - 0.3) / 0.9)) ** 1.2;
      const c = flesh(skin, 0.08 + neck + front - 0.32 * side);
      // Тень под подбородком — тёплая, в рыжину.
      return neck < -0.2 ? mix(c, [0.4, 0.17, 0.1], 0.42 * Math.min(1, -neck)) : c;
    }
    if (h > bodiceTop(a)) return tone(linen, -0.05 - 0.28 * side + (n(x * 0.15, y * 0.4) - 0.5) * 0.08);
    // Корсаж: верх светлее (на свету), к поясу и к бокам — в тень.
    const down = Math.max(0, (bodiceTop(a) - h) / 0.2);
    return tone(bodice, 0.14 - 0.34 * down - 0.4 * side);
  });
  const P = (a: number, h: number): [number, number] => [ax(a), torsoY(h)];

  // Кожа: ключицы, блики на груди сверху, ложбинка.
  {
    const cb = P(0.45, 1.198);
    img.shape(ellipse(cb[0], cb[1], 34, 2.2, 0.08), around(cb[0], cb[1], 40, 6), tone(skin, 0.3), { soft: 3, alpha: 0.6 });
    const cs = P(0.45, 1.19);
    img.shape(ellipse(cs[0], cs[1] + 3, 30, 2, 0.08), around(cs[0], cs[1] + 3, 36, 6), tone(skin, -0.25), { soft: 3, alpha: 0.4 });
  }
  // Грудь над вырезом: тёплый блик на верхней дуге, тень по внутренней дуге к ложбинке; ниже — под сорочкой.
  const bustTop = P(0.47, 1.099);
  img.shape(ellipse(bustTop[0], bustTop[1], 26, 7), around(bustTop[0], bustTop[1], 36, 14), flesh(skin, 0.75), { soft: 9, alpha: 0.85 });
  const inner = [P(0.02, 1.122), P(0.12, 1.104), P(0.22, 1.092), P(0.3, 1.084)];
  img.shape(stroke(inner, (t) => 9 * (1 - t) + 3), boxOf(inner, 12), flesh(skin, -0.5), { soft: 9, alpha: 0.7 });
  // Ложбинка: тень от выреза вверх, у края листа (середина груди), сужается.
  const cl0 = P(0, neckline(0) + 0.002);
  const cl1 = P(0, 1.13);
  img.shape(stroke([cl0, cl1], (t) => 16 * (1 - t) + 3), boxOf([cl0, cl1], 16), flesh(skin, -0.62), { soft: 7, alpha: 0.85 });

  // Сорочка: сборки (вертикальные складки), объём груди — свет сверху, тень под ней; край выреза — рюш с тенью.
  for (let i = 1; i < 45; i++) {
    const x = ax((i * Math.PI) / 45) + (r() - 0.5) * 4;
    const a = aOf(x);
    const top = torsoY(neckline(a)) + 2;
    const bot = torsoY(bodiceTop(a)) - 1;
    if (bot - top < 3) continue;
    img.shape((px, py) => Math.abs(px - x - (i === 0 || i === 45 ? 0 : Math.sin(py * 0.3 + i) * 1.2)) - 1.3, { x0: x - 4, y0: top, x1: x + 4, y1: bot }, i % 2 ? tone(linen, -0.35) : tone(linen, 0.3), { soft: 2, alpha: 0.55 });
  }
  const chemBust = P(0.5, 1.072);
  img.shape(ellipse(chemBust[0], chemBust[1], 34, 4), around(chemBust[0], chemBust[1], 44, 10), tone(linen, 0.55), { soft: 6, alpha: 0.8 });
  const chemUnder = P(0.36, 1.06);
  img.shape(ellipse(chemUnder[0], chemUnder[1], 30, 3), around(chemUnder[0], chemUnder[1], 40, 8), tone(linen, -0.45), { soft: 5, alpha: 0.5 });
  // Тень под грудью — на корсаже, по нижнему краю выпуклости (и у края корсажа сверху — тень сорочки, заправленной в него).
  const under = P(0.5, 1.03);
  img.shape(ellipse(under[0], under[1], 40, 6), around(under[0], under[1], 50, 14), tone(bodice, -0.75), { soft: 9, alpha: 0.6 });
  img.shape((x, y) => {
    const a = aOf(x);
    return Math.abs(y - (torsoY(bodiceTop(a)) - 1.8)) - 1.6;
  }, { x0: 0, y0: T.y0, x1: W, y1: T.y1 }, tone(linen, -0.6), { soft: 2.5, alpha: 0.65 });
  // Рюш по вырезу: волнистый край, сверху светлый, снизу тень. Сзади, под волосами, волна стихает: гребень волны на
  // линии зеркала дал бы на ней излом в полпикселя.
  const wave = (a: number): number => Math.cos(a * 100) * 1.1 * Math.min(1, Math.max(0, (2.9 - Math.abs(a)) / 0.3));
  img.shape((x, y) => {
    const a = aOf(x);
    const e = torsoY(neckline(a)) + 1.8 + wave(a);
    return Math.abs(y - e) - 1.8;
  }, box, tone(linen, 0.5), { soft: 1.4 });
  img.shape((x, y) => {
    const a = aOf(x);
    const e = torsoY(neckline(a)) + 4.6 + wave(a);
    return Math.abs(y - e) - 0.9;
  }, box, tone(linen, -0.45), { soft: 1.4, alpha: 0.6 });
  // Тень выреза на коже над рюшем — тонкая, от края ткани.
  img.shape((x, y) => {
    const a = aOf(x);
    return Math.abs(y - (torsoY(neckline(a)) - 1.2)) - 1.0;
  }, box, tone(skin, -0.35), { soft: 2, alpha: 0.4 });

  // Корсаж: косточки (вертикальные швы со светом рядом), шнуровка спереди крест-накрест, люверсы, кайма по верху.
  for (const a of [0.42, 0.85, 1.3, 2.3]) {
    const x = ax(a);
    img.shape((px, py) => {
      const top = torsoY(bodiceTop(aOf(px)));
      return Math.max(Math.abs(px - x) - 0.9, top + 3 - py);
    }, { x0: x - 4, y0: T.y0, x1: x + 4, y1: T.y1 }, tone(bodice, -0.65), { soft: 1.3, alpha: 0.8 });
    img.shape((px, py) => {
      const top = torsoY(bodiceTop(aOf(px)));
      return Math.max(Math.abs(px - x - 2.6) - 1.1, top + 3 - py);
    }, { x0: x - 2, y0: T.y0, x1: x + 6, y1: T.y1 }, tone(bodice, 0.35), { soft: 1.5, alpha: 0.5 });
  }
  const lace0 = torsoY(bodiceTop(0)) + 5;
  const lace1 = torsoY(0.88);
  // Под шнуровкой — щель, в ней сорочка.
  img.shape((x, y) => x - 3.2, { x0: 0, y0: lace0 - 3, x1: 6, y1: lace1 }, tone(linen, -0.3), { soft: 1.2 });
  for (let y = lace0; y < lace1 - 6; y += 10) {
    // Шнурок — крестом через ось: обе диагонали на листе, поэтому зеркало ничего не ломает.
    for (const [a0, a1] of [
      [y, y + 9],
      [y + 9, y],
    ])
      img.shape(stroke([[-9, a0], [9, a1]], 2.1), { x0: 0, y0: y - 2, x1: 12, y1: y + 12 }, tone(gold, -0.15), { soft: 1.1 });
    img.shape(circle(10, y + 1, 2.1), around(10, y + 1, 4), tone(gold, 0.3), { soft: 1 });
    img.shape(circle(10, y + 1, 0.9), around(10, y + 1, 2), tone(bodice, -0.8), { soft: 0.8 });
  }
  // Кайма по верху корсажа: золотая полоса с точками, под ней — тень.
  img.shape((x, y) => {
    const e = torsoY(bodiceTop(aOf(x))) + 1.6;
    return Math.abs(y - e) - 2.1;
  }, box, (x, y) => tone(gold, 0.12 + 0.2 * Math.cos(aOf(x) * 146)), { soft: 1.2 });
  for (let k = 0; k <= 42; k++) {
    const x = ax((k * Math.PI) / 42);
    const e = torsoY(bodiceTop(aOf(x))) + 1.6;
    img.shape(circle(x, e, 1.4), around(x, e, 2.8), tone(bodice, -0.6), { soft: 1 });
  }
  // Кайма по поясу корсажа.
  const waist = torsoY(0.868);
  img.shape((x, y) => Math.abs(y - waist) - 2, { x0: 0, y0: waist - 5, x1: W, y1: waist + 5 }, tone(gold, 0.05), { soft: 1.2 });
}

function paintSkirt(img: Img, skirt: RGB, bodice: RGB, gold: RGB): void {
  const S = SHEETS.skirt;
  const box = { x0: 0, y0: S.y0, x1: W, y1: S.y1 };
  const r = rng(73);
  const n = noise(79);
  const hem0 = SKIRT[SKIRT.length - 1].v;
  // Свет: верх на бёдрах светлее, к подолу — темнее; складки — по геометрии (вершины у столбцов 0, π/4, …, впадины между).
  img.shape((x, y) => -1, box, (x, y) => {
    const a = aOf(x);
    const k = (y - S.y0) / (S.y1 - S.y0);
    const fold = Math.cos(8 * a);
    const amp = 0.12 + 0.32 * k;
    const minor = (n(x * 0.06, y * 0.012) - 0.5) * 0.22 * k;
    const light = 0.16 * Math.exp(-(((y - 318) / 24) ** 2)) - 0.26 * k ** 1.4;
    return tone(skirt, light + fold * amp + minor);
  });
  // Тонкие складки между крупными.
  for (let i = 0; i < 40; i++) {
    const x = 12 + r() * (W - 24);
    const y0 = S.y0 + 20 + r() * 40;
    const pts: [number, number][] = [0, 0.5, 1].map((t) => [x + Math.sin(t * 3 + i) * 4 * t, y0 + (hem0 - y0 - 8) * t]);
    img.shape(stroke(pts, (t) => 1 + 2.5 * t), boxOf(pts, 4), r() > 0.5 ? tone(skirt, 0.25) : tone(skirt, -0.4), { soft: 2, alpha: 0.35 });
  }
  // Пояс и мыс корсажа поверх юбки: золотой поясок, ниже — острый мыс цвета корсажа с золотой каймой.
  img.shape((x, y) => Math.abs(y - (S.y0 + 3)) - 1.4, { x0: 0, y0: S.y0, x1: W, y1: S.y0 + 8 }, (x, y) => tone(gold, 0.15 * Math.cos(aOf(x) * 114)), { soft: 1 });
  const point = [
    [-26, S.y0 + 1],
    [26, S.y0 + 1],
    [0, S.y0 + 11],
  ] as [number, number][];
  img.shape(poly(point), { ...boxOf(point, 3), x0: 0 }, (x, y) => tone(bodice, -0.1 - (y - S.y0) * 0.01), { soft: 1.2 });
  for (const end of [point[0], point[1]]) img.shape(stroke([end, point[2]], 2.4), { ...boxOf(point, 4), x0: 0 }, tone(gold, 0.1), { soft: 1.1 });
  // Под мысом и под поясом — тень на юбке.
  for (const sx of [-1, 1]) img.shape(stroke([[sx * 30, S.y0 + 3], [0, S.y0 + 15]], 5), { x0: 0, y0: S.y0, x1: 40, y1: S.y0 + 26 }, tone(skirt, -0.5), { soft: 4, alpha: 0.45 });

  // Орнамент по подолу: тёмная полоса между двумя золотыми линиями, в ней ромбы с трилистником и точки; край подола темнее.
  ornamentBand(img, { b0: hem0 - 24, b1: hem0 - 7, x1: W, ground: tone(skirt, -0.45), line: gold, steps: 16, half: 6.5, at: ax });
  img.shape((x, y) => hem0 - 4 - y, { x0: 0, y0: hem0 - 6, x1: W, y1: S.y1 }, tone(skirt, -0.7), { soft: 2 });
}

function paintArms(img: Img, skin: RGB, linen: RGB, gold: RGB): void {
  const sl = SHEETS.sleeve;
  const sw = sl.x1 - sl.x0;
  // Наплечник: сборки от верха, верх на свету, низ — в тени, у рукава — глубокая складка; рукав до локтя, манжета с каймой.
  img.shape((x, y) => -1, { x0: sl.x0, y0: sl.y0, x1: sl.x1, y1: sl.y1 }, (x, y) => {
    const u = (x - sl.x0) / sw;
    const outer = Math.cos((u - 0.5) * Math.PI * 2) * 0.5 + 0.5;
    const v = y - sl.y0;
    const gather = Math.sin(u * Math.PI * 2 * 7 + Math.sin(v * 0.08) * 0.8) * (v < 72 ? 0.22 * (1 - Math.abs(v - 34) / 50) : 0.08);
    const light = v < 70 ? 0.22 * Math.exp(-(((v - 24) / 18) ** 2)) - 0.4 * Math.max(0, (v - 44) / 26) - 0.06 : -0.05 - 0.15 * ((v - 70) / 26);
    return tone(linen, light + gather - 0.3 * (1 - outer));
  });
  img.shape((x, y) => Math.abs(y - (sl.y0 + 71)) - 1.8, { x0: sl.x0, y0: sl.y0 + 66, x1: sl.x1, y1: sl.y0 + 76 }, tone(linen, -0.7), { soft: 2, alpha: 0.8 });
  img.shape((x, y) => Math.abs(y - (sl.y1 - 10)) - 1.4, { x0: sl.x0, y0: sl.y1 - 14, x1: sl.x1, y1: sl.y1 - 6 }, tone(gold, 0.05), { soft: 1 });
  img.shape((x, y) => y - (sl.y1 - 8), { x0: sl.x0, y0: sl.y1 - 9, x1: sl.x1, y1: sl.y1 }, (x, y) => tone(linen, -0.1 + 0.25 * Math.sin(x * 0.5)), { soft: 1 });
  // Предплечье и кисть — генераторы набора: кожа трубкой с тенью манжеты, «варежка» с бороздками, костяшками и ногтями.
  skinTube(img, SHEETS.fore, skin);
  paintMitten(img, SHEETS.hand, SHEETS.thumb, skin);
}

function paintGold(img: Img, gold: RGB, gem: RGB): void {
  const g = SHEETS.gold;
  img.shape((x, y) => -1, { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 }, (x, y) => {
    const u = (x - g.x0) / (g.x1 - g.x0);
    return tone(gold, 0.35 - 0.6 * Math.abs(u - 0.4));
  });
  for (let y = g.y0 + 12; y < g.y1; y += 9) {
    const c = (g.x0 + g.x1) / 2;
    const d = [
      [c, y - 3.5],
      [c + 5, y],
      [c, y + 3.5],
      [c - 5, y],
    ] as [number, number][];
    img.shape((x, yy) => Math.abs(poly(d)(x, yy)) - 0.6, boxOf(d, 2), tone(gold, -0.55), { soft: 0.8, alpha: 0.8 });
  }
  const jx = g.x0 + 16;
  const jy = g.y0 + 4;
  img.shape(circle(jx, jy, 3.6), around(jx, jy, 5), tone(gem, -0.2), { soft: 0.8 });
  img.shape(circle(jx - 1, jy - 1, 1.2), around(jx, jy, 3), tone(gem, 0.9), { soft: 0.8 });
}
