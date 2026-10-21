// Лист лица гонца (ЛЦ-3, docs/characters.md): 512 × 512, кодом, на холсте и чертах набора (`kit/face.ts`) — та же манера,
// что у супруги: свет и тень плоскостями, тёмная линия века, брови темнее волос, мазок, а не аэрограф. Лицо — другого
// человека: мужское, открытое и обветренное. Лоб и скула на свету, под скулой — широкая впадина (худой), челюсть
// квадратная с тенью по краю, надбровье нависает — глаза глубже, нос длиннее, губы тоньше; щёки и нос красные с дороги;
// лёгкая щетина по челюсти, подбородку и над губой; короткая чёлка и бакенбарды до середины уха. Справа под листом рта —
// лист уха (`figure.EAR_SHEET`).
import { FaceSheet, grain, paintBrows, paintEyeball, paintEyelids, paintLid, paintLips, paintMouth, skinBase, underChin, type FacePt } from '../kit/face';
import type { Head } from '../kit/head';
import { EYE_SHEET, FACE_PX, LIP_N, U_PX } from '../kit/head';
import { Img, around, boxOf, circle, ellipse, flesh, hex, mix, noise, poly, rng, spline, stroke, tone, type RGB } from '../kit/paint';

const smooth01 = (k: number): number => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};
import { EAR_SHEET } from './figure';
import type { HeraldLook } from './looks';

export function paintHeraldFace(look: HeraldLook, head: Head): Img {
  const pal = look.palette;
  const st = look.face;
  const skin = hex(pal.skin);
  const hair = hex(pal.hair);
  // Губы — бледнее, чем у супруги: мужские, обветренные.
  const lip = mix(mix(flesh(skin, -0.12), [0.6, 0.3, 0.28], st.lipTint), [0.42, 0.2, 0.18], 0.12);
  const ruddy = mix(skin, [0.86, 0.36, 0.3], 0.55);
  const rose = mix(skin, [0.88, 0.45, 0.42], 0.45);
  const lash = mix(tone(hair, -1), [0.05, 0.03, 0.03], 0.7);
  const brow = mix(mix(tone(hair, -0.55), lash, 0.32), hair, 0.1);
  const lid = mix(skin, mix(flesh(skin, -0.6), mix(hair, ruddy, 0.3), 0.4), 0.62);
  const f = new FaceSheet(head, (k) => flesh(skin, k));
  const { img, face, sh, SX } = f;
  const P = (x: number, h: number): [number, number] => f.P(x, h);
  const RX = (m: number): number => f.RX(m);
  const RY = (m: number): number => f.RY(m);
  const plane = (pts: FacePt[], c: RGB, soft: number, alpha = 1): void => f.plane(pts, c, soft, alpha);
  const brushed = (pts: FacePt[], c: RGB, angle: number, len: number, width: number, count: number, seed: number, alpha = 1): void => f.brushed(pts, c, angle, len, width, count, seed, alpha);

  skinBase(f, 0.058, 0.058, 0.58);
  underChin(f);
  // Под челюстью — ровная глубокая тень до самой шеи: полоса к шее (низ листа) не светлеет, как у супруги, а сходится с
  // тенью на шее листа тела (иначе под подбородком читается светлый «второй подбородок»).
  const chinY = f.yOf(0);
  img.shape((x, y) => chinY + 3 - y, { x0: 0, y0: chinY, x1: face.x1, y1: FACE_PX }, sh(-0.85), { soft: 6 });

  // ---------- Свет ----------
  // Лоб — широкий, мазками поперёк; к вискам гаснет.
  brushed([[-0.001, 0.214], [0.034, 0.214], [0.058, 0.205], [0.06, 0.19], [0.04, 0.181], [0.012, 0.179], [-0.001, 0.181]], sh(0.44), 0.05, 26, 6, 44, 33, 0.9);
  // Скула — высоко и узко, от-под глаза к виску (лицо худое: свет только на кости).
  // Скула — светлым клином с чётким краем снизу (как у супруги): плоскость, поверх — мазки по форме.
  // Узкой гранью по верху кости от угла глаза к виску — не овалом (овал на мужском лице читается румянами).
  const bone: FacePt[] = [[0.05, 0.1245], [0.068, 0.1285], [0.09, 0.1262], [0.1, 0.12], [0.088, 0.1185], [0.066, 0.1205], [0.054, 0.1195]];
  // Свет — тёплый охристый, не розовый (розовый на мужском лице читается румянами).
  plane(bone, mix(sh(0.5), [0.95, 0.84, 0.62], 0.3), 2.5, 0.55);
  brushed(bone, mix(sh(0.6), [0.96, 0.86, 0.66], 0.3), -0.2, 10, 4, 16, 35, 0.4);
  // Подбородок — квадратный блик, и свет на верхней губе.
  // Подбородок и над губой — без пятен света: там щетина, а светлое под ней читается «молочными усами».

  // ---------- Тень ----------
  // Висок — вдоль, глубже, чем у супруги.
  brushed([[0.096, 0.232], [0.14, 0.232], [0.14, 0.124], [0.11, 0.128], [0.1, 0.148], [0.097, 0.175], [0.094, 0.205]], sh(-0.5), 1.62, 24, 6, 44, 37, 0.8);
  // Бок лица у виска — в тень плоскостью: край маски не светлеет полосой рядом с волосами.
  img.shape((x, y) => 0.124 * SX - x, face, sh(-0.78), { soft: 10, alpha: (x, y) => 0.75 * Math.min(1, Math.max(0, (f.hRow[Math.min(FACE_PX - 1, y | 0)] - 0.09) / 0.04)) });
  // Под скулой — широкая впадина красноватой охры от виска к углу рта и челюсти: худое лицо после дороги.
  // Провал под скулой — тёмной плоскостью от уха к углу рта: верх по кости чёткий, низ к челюсти мягче (худое лицо).
  const hollow = mix(sh(-0.8), [0.55, 0.25, 0.16], 0.32);
  const cave: FacePt[] = [[0.14, 0.112], [0.118, 0.1085], [0.096, 0.1005], [0.076, 0.089], [0.06, 0.077], [0.046, 0.0675], [0.038, 0.062], [0.048, 0.0575], [0.07, 0.0585], [0.1, 0.062], [0.14, 0.07]];
  plane(cave, hollow, 2, 0.92);
  brushed(cave, mix(hollow, sh(-0.8), 0.3), 2.5, 18, 5, 40, 39, 0.5);
  // Бок челюсти к уху — тёмной плоскостью, как бока щёк у супруги: голова сужается, лицо — сухое.
  brushed([[0.112, 0.074], [0.15, 0.08], [0.15, 0.0], [0.13, -0.004], [0.112, 0.012], [0.104, 0.04]], sh(-0.6), 1.7, 16, 5, 30, 51, 0.8);
  // Челюсть спереди — на свету ниже впадины: квадрат подбородка и угла читается светом над тенью края.
  plane([[0.03, 0.044], [0.05, 0.05], [0.08, 0.047], [0.1, 0.04], [0.104, 0.028], [0.09, 0.022], [0.05, 0.022], [0.03, 0.028]], sh(0.02), 7, 0.3);
  // Край челюсти — тёмной плоскостью вдоль: квадратный угол читается тенью снизу.
  img.shape(
    (x, y) => y - f.yOf(0.012 + 0.03 * smooth01((x / SX - 0.03) / 0.11)),
    face,
    sh(-0.58),
    { soft: 7, alpha: (x) => 0.75 * smooth01((x / SX - 0.012) / 0.05) },
  );
  // Под нижней губой — ямка, над подбородком.
  plane([[-0.001, 0.049], [0.016, 0.0485], [0.02, 0.042], [0.01, 0.038], [-0.001, 0.0385]], sh(-0.45), 4, 0.7);

  // ---------- Глаза: две глазницы под надбровьем, к переносице — светлее ----------
  const E = head.EYE;
  // Тень под надбровьем — дугой над каждым глазом, не полосой от виска до виска.
  const browUnder = spline([P(0.019, 0.154), P(0.034, 0.1595), P(0.054, 0.159), P(0.07, 0.153), P(0.075, 0.145)], 5);
  img.shape(stroke(browUnder, (t) => RY(0.007) * Math.sin(Math.PI * (0.15 + 0.85 * t)) + 1), boxOf(browUnder, 16), sh(-0.8), { soft: 5, alpha: 0.7 });
  const socketC = P(E.x + 0.001, E.h + 0.002);
  img.shape(ellipse(socketC[0], socketC[1], RX(0.026), RY(0.015)), around(socketC[0], socketC[1], RX(0.04), RY(0.028)), mix(sh(-0.6), lid, 0.25), { soft: 10, alpha: 0.7 });
  // Над веком до брови — тёплая бурая тень округлой плоскостью над глазом.
  plane([[0.02, 0.158], [0.034, 0.1615], [0.052, 0.162], [0.068, 0.157], [0.076, 0.147], [0.068, 0.1415], [0.056, 0.1445], [0.04, 0.1455], [0.027, 0.1445], [0.02, 0.1485]], mix(mix(sh(-0.9), [0.5, 0.25, 0.14], 0.25), mix(hair, lid, 0.4), 0.2), 5, 0.92);
  // У внутреннего угла — глубже, но переносица между глазами — на свету.
  plane([[0.016, 0.156], [0.026, 0.159], [0.03, 0.148], [0.026, 0.141], [0.018, 0.142]], mix(sh(-0.8), hair, 0.12), 4, 0.6);
  const bridge = P(0, 0.149);
  img.shape(ellipse(bridge[0], bridge[1], RX(0.009), RY(0.013)), { ...around(bridge[0], bridge[1], RX(0.016), RY(0.02)), x0: 0 }, sh(0.42), { soft: 6, alpha: 0.6 });

  // ---------- Нос: длиннее и крупнее ----------
  img.shape(stroke([P(0, 0.152), P(0, 0.104)], (t) => RX(0.005 + 0.002 * t)), boxOf([P(0, 0.158), P(0.009, 0.098)], 8), sh(0.65), { soft: 3.5, alpha: (x, y) => 0.95 * Math.min(1, Math.max(0, (y - f.yOf(0.16)) / 14)) });
  plane([[0.0066, 0.156], [0.0152, 0.1575], [0.0136, 0.128], [0.0104, 0.119], [0.0072, 0.122], [0.0056, 0.135]], sh(-0.64), 3, 0.85);
  brushed([[0.0082, 0.121], [0.01, 0.122], [0.0172, 0.1035], [0.0134, 0.0945], [0.0076, 0.1015]], sh(-0.75), 1.75, 10, 3.5, 22, 45);
  const tip = P(0, 0.1);
  img.shape(ellipse(tip[0], tip[1], RX(0.0068), RY(0.0042)), around(tip[0], tip[1], RX(0.011), RY(0.009)), mix(sh(0.5), ruddy, 0.25 * st.weather), { soft: 4, alpha: 0.85 });
  img.shape(ellipse(tip[0] + RX(0.001), tip[1] - RY(0.0013), RX(0.0024), RY(0.0016)), around(tip[0], tip[1], RX(0.005), RY(0.004)), sh(0.9), { soft: 2.5, alpha: 0.7 });
  plane([[-0.001, 0.094], [0.0102, 0.094], [0.0138, 0.0895], [0.0086, 0.087], [-0.001, 0.087]], sh(-0.68), 3);
  const nostril = P(0.0072, 0.0912);
  img.shape(ellipse(nostril[0], nostril[1], RX(0.003), RY(0.0016), 0.25), around(nostril[0], nostril[1], RX(0.006), RY(0.004)), sh(-1), { soft: 2, alpha: 0.85 });
  img.shape(stroke(spline([P(0.0104, 0.1025), P(0.0152, 0.0988), P(0.0142, 0.0922)]), RX(0.0017)), boxOf([P(0.008, 0.104), P(0.017, 0.09)], 6), sh(-0.75), { soft: 3, alpha: 0.7 });

  // ---------- Обветренность ----------
  // Ветер — неровной кирпичной краснотой короткими мазками: верх скул, кончик и крылья носа (не румянами).
  const brick = mix(ruddy, [0.55, 0.28, 0.2], 0.5);
  const wr = rng(45);
  const dab = (cx: number, ch: number, sx: number, sy: number, n: number, a: number): void => {
    for (let i = 0; i < n; i++) {
      const x = cx + (wr() - 0.5) * sx;
      const h = ch + (wr() - 0.5) * sy;
      const p0 = P(x, h);
      const ang = -0.3 + (wr() - 0.5) * 0.8;
      const len = 4 + wr() * 7;
      const line: [number, number][] = [
        [p0[0] - Math.cos(ang) * len, p0[1] - Math.sin(ang) * len],
        [p0[0] + Math.cos(ang) * len, p0[1] + Math.sin(ang) * len],
      ];
      // У оси листа — мимо: край мазка лёг бы в один крайний столбец (шов зеркала).
      if (Math.min(line[0][0], line[1][0]) < 6) continue;
      img.shape(stroke(line, (t) => (2.5 + wr() * 2.5) * Math.sin(Math.PI * t) + 0.5), boxOf(line, 6), brick, { soft: 2, alpha: (0.12 + wr() * 0.16) * a * st.weather });
    }
  };
  // Красноту — на кончик и спинку носа и на внешний верх скулы у виска, бурее, не на светлый клин.
  dab(0.088, 0.122, 0.022, 0.012, 18, 1);
  dab(0.006, 0.104, 0.012, 0.02, 14, 1.1);
  // Прищур — две светлые морщинки у внешнего угла глаза (кожа щурится от ветра).
  for (const [dh, len] of [
    [0.004, 0.009],
    [-0.003, 0.007],
  ] as const) {
    const a0 = P(head.EYE.x + head.EYE.half + 0.003, head.EYE.h + dh);
    const a1 = P(head.EYE.x + head.EYE.half + 0.003 + len, head.EYE.h + dh * 1.6 - 0.001);
    img.shape(stroke([a0, a1], (t) => 1.6 * (1 - t) + 0.4), boxOf([a0, a1], 4), sh(0.45), { soft: 1.2, alpha: 0.4 });
    img.shape(stroke([[a0[0], a0[1] + 1.5], [a1[0], a1[1] + 1.5]], (t) => 1.2 * (1 - t) + 0.3), boxOf([a0, a1], 5), sh(-0.5), { soft: 1.2, alpha: 0.3 });
  }
  // Веснушки у рыжего — мелко по носу и щекам.
  if (st.weather > 0.65) {
    const r = rng(47);
    for (let i = 0; i < 40; i++) {
      const fx = 0.004 + r() * 0.07;
      const fh = 0.1 + r() * 0.035 - fx * 0.12;
      if (Math.hypot(fx - head.EYE.x, (fh - head.EYE.h) * 1.6) < 0.028) continue;
      const c = P(fx, fh);
      img.shape(circle(c[0], c[1], 0.9 + r() * 1.1), around(c[0], c[1], 3), sh(-0.3), { soft: 1.3, alpha: (0.15 + r() * 0.25) * (st.weather - 0.6) * 2.5 });
    }
  }

  // ---------- Губы, веки, брови ----------
  paintLips(f, lip, { full: st.lipFull, shine: [0.0582, 0.0045, 0.007], philtrum: [0.0875, 0.0735, 0.0895, 0.07] });
  // Мужской рот: линия губ длиннее и твёрже, верхняя губа — в тени (рот читается чертой, а не цветком).
  const mline = head.mouthRim(true).map((q) => f.signed(q));
  img.shape(stroke(spline([[-mline[5][0], mline[5][1]], ...mline.slice(4, 9)]), (t) => 1.3 + 1.6 * t * t), { ...boxOf(mline, 6), x0: 0 }, tone(lip, -0.95), { soft: 1.3, alpha: 0.85 });
  // Нижняя губа — в тон кожи, не светлой полосой: сомкнутый рот читается верхней губой в тени и тенью под нижней.
  const lower = head.mouthRim(false).slice(LIP_N + 2).map((q) => f.signed(q));
  const lowerLip = [mline[0], ...mline.slice(LIP_N + 2).reverse(), mline[LIP_N + 1], ...lower];
  img.shape(poly(lowerLip), { ...boxOf(lower, 8), x0: 0 }, mix(lip, sh(-0.15), 0.5), { soft: 2.5, alpha: 0.55 });
  paintEyelids(f, lid, lash, rose, { lash: st.lash * 1.8, wing: 0.0014, lashes: 3 });
  // Брови — низкие, почти прямые, густые до хвоста; над ними — свет надбровной дуги.
  paintBrows(f, brow, {
    ridge: [
      [0.018, 0.1735],
      [0.045, 0.177],
      [0.072, 0.1695],
    ],
    pts: [
      [0.012, 0.1605],
      [0.03, 0.1642 + st.browArch * 0.4],
      [0.05, 0.1655 + st.browArch * 0.7],
      [0.068, 0.1628 + st.browArch * 0.3],
      [0.08, 0.1572],
    ],
    thick: st.browThick,
    hairs: 38,
    seed: 49,
    taper: 0.32,
  });

  // ---------- Щетина ----------
  // Кистью, а не вуалью: короткие холодные штрихи по челюсти и подбородку с чётким ломаным краем по линии щеки; над губой —
  // лишь по бокам, губы и ямка под нижней губой — чистые, чтобы рот читался.
  if (st.stubble > 0) {
    const n = noise(51);
    const r = rng(53);
    const M = head.MOUTH;
    const cold = mix(tone(hair, -0.75), [0.26, 0.28, 0.34], 0.5);
    // Край по щеке: от угла рта к уху, ломаный (шум), щетина — ниже.
    const edgeH = (ax: number, y: number): number => 0.062 - 0.18 * Math.max(0, ax - 0.03) + (n(ax * 300, y * 0.15) - 0.5) * 0.008;
    const inZone = (x: number, h: number, y: number): boolean => {
      const ax = Math.abs(x);
      const low = h < edgeH(ax, y) && h > -0.006;
      // Над губой — дугой по верхней губе: у уголков шире и ниже, к середине уже, под носом — чисто; край неровный.
      const k = Math.min(1, ax / (M.half + 0.004));
      const lipLow = M.line + (M.top - M.line) * Math.pow(Math.max(0, 1 - k * k), 0.55) + 0.0015;
      const lipTop = lipLow + 0.004 + 0.005 * k + (n(ax * 260, 7) - 0.5) * 0.003;
      const lip = ax > 0.006 && ax < M.half + 0.006 && h > lipLow && h < lipTop;
      // Чисто — только сами губы: щетина подходит к их краю (иначе вокруг рта светлый «намордник»).
      const mouth = Math.hypot(ax / (M.half + 0.0015), (h - (M.top + M.bottom) / 2) / ((M.top - M.bottom) / 2 + 0.001)) < 1;
      return (low || lip) && !mouth;
    };
    // Зона щетины — темнее кожи и холоднее (тень щетины умножением, не светлой краской): по щеке — мягким краем, над губой
    // и под нижней губой — плотнее; штрихи — поверх.
    const dens = (x: number, h: number, y: number): number => {
      const ax = Math.abs(x);
      if (!inZone(x, h, y)) return 0;
      const fade = Math.min(1, (edgeH(ax, y) - h) / 0.008);
      const lipK = h > M.top ? 1 : 0;
      const under = ax < 0.016 && h < M.bottom && h > M.bottom - 0.014 ? 1 : 0;
      return Math.max(0.75 * fade, lipK, under);
    };
    img.shape((x, y) => -1, face, (x, y) => {
      const c = img.get(Math.min(FACE_PX - 1, x | 0), Math.min(FACE_PX - 1, y | 0));
      const d = dens(x / SX, f.hRow[Math.min(FACE_PX - 1, y | 0)], y) * st.stubble;
      return [c[0] * (1 - 0.24 * d), c[1] * (1 - 0.21 * d), c[2] * (1 - 0.12 * d)];
    });
    for (let i = 0; i < 4200; i++) {
      const x = r() * U_PX;
      const y = r() * FACE_PX;
      // У оси листа — ни штриха: половина у зеркала легла бы только в крайний столбец (шов).
      if (x < 3 || !inZone(x / SX, f.hRow[y | 0], y)) continue;
      const ang = 1.35 + (r() - 0.5) * 0.7 - (x / SX) * 4;
      const l = 1.2 + r() * 1.6;
      const seg: [number, number][] = [
        [x, y],
        [x + Math.cos(ang) * l, y + Math.sin(ang) * l],
      ];
      img.shape(stroke(seg, 0.8), boxOf(seg, 2), tone(cold, -0.3), { soft: 0.6, alpha: (0.18 + r() * 0.26) * st.stubble });
    }
  }

  // ---------- Волосы у лица: линия волос, чёлка, бакенбарды ----------
  const top = head.TOP_H;
  // Линия волос — ниже (лоб не высокий), к вискам — лёгкие залысины, у виска — вниз к бакенбарду; край мягкий и неровный.
  // Посередине — лёгкий мысок, у висков — залысины внутрь, у виска — вниз к бакенбарду.
  const hairH = (X: number): number => top - 0.03 + 0.011 * smooth01(X / 0.07) - 0.038 * smooth01((X - 0.1) / 0.045);
  // Волосы на листе лица — продолжение прядей шапки: те же тона (светлая середина, тёмный край ленты), лента — около 2 см.
  const hairTone = (x: number, y: number): RGB => {
    const u = Math.sin((x / SX / 0.021) * Math.PI + Math.sin(y * 0.04));
    return tone(hair, -0.22 + 0.4 * (1 - u * u) ** 2 - 0.4 * Math.abs(u) ** 6);
  };
  const hn = noise(55);
  const lineY = Array.from({ length: U_PX + 9 }, (_, x) => f.yOf(hairH(x / SX)) + (hn(x * 0.09, 3) - 0.5) * 6);
  const yLine = (x: number): number => lineY[Math.max(0, Math.min(lineY.length - 1, Math.round(x)))];
  // Тень от волос на лбу и виске — мягкой полосой под линией волос; сами волосы — выше неё.
  img.shape((x, y) => Math.abs(y - yLine(x) - 4) - 3, face, sh(-0.42), { soft: 6, alpha: 0.35 });
  img.shape((x, y) => y - yLine(x), face, hairTone, { soft: 5 });
  // Бакенбард — узкий, перед ухом до его середины: от края маски на сантиметр.
  const burnLow = f.yOf(0.122);
  img.shape((x, y) => Math.max((0.138 - 0.006 * smooth01((f.hRow[Math.min(FACE_PX - 1, y | 0)] - 0.122) / 0.02)) * SX - x, y - burnLow), face, hairTone, { soft: 3 });
  // Короткие прядки на лоб — тонкими штрихами вразброс, не зубцами.
  const r = rng(57);
  for (let i = 0; i < 10 + st.fringe * 3; i++) {
    const x0 = r() * 0.09;
    const len = 4 + r() * 7;
    const lean = 1 + r() * 4 + x0 * 40;
    const y0 = yLine(x0 * SX) - 3;
    const pts: [number, number][] = [
      [x0 * SX, y0],
      [x0 * SX + lean * 0.5, y0 + len * 0.6],
      [x0 * SX + lean, y0 + len],
    ];
    img.shape(stroke(pts, (t) => 2.8 * (1 - t) ** 0.8 + 0.4), boxOf(pts, 5), tone(mix(hair, skin, 0.05), -0.22 + (r() - 0.5) * 0.25), { soft: 1.1, alpha: 0.85 });
  }

  grain(f, 59);
  // Белок — по светлой коже (у загорелого тёплый белок от своей кожи вышел бы мутным).
  paintEyeball(img, head, pal.iris, 0xe2bca4, 0.0085);
  // Блик — крупнее, чем у супруги в её свете: у гонца глаз глубже под надбровьем, и малый блик в тени пропадает.
  {
    const s = EYE_SHEET;
    const px = s.w / s.m;
    const ir = 0.0085 * px;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2 - ((0.02 * head.BALL.r) / s.m) * s.w;
    img.shape(circle(cx - ir * 0.34, cy - ir * 0.38, ir * 0.27), around(cx - ir * 0.34, cy - ir * 0.38, ir * 0.36), hex(0xfffcf4), { soft: 1.2 });
  }
  paintLid(img, skin, lid, lash);
  paintMouth(img, lip);
  paintEar(img, skin, ruddy, st.weather);
  return img;
}

/**
 * Лист уха: основание (u 0) — у черепа, край (u 1) — завиток; низ листа — мочка, верх — верх уха. Раковина — тёмная
 * впадина посередине, завиток — светлый с тёмной складкой внутри, край — красный от ветра.
 */
function paintEar(img: Img, skin: RGB, ruddy: RGB, weather: number): void {
  const s = EAR_SHEET;
  const box = { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
  const n = noise(61);
  img.shape((x, y) => -1, box, (x, y) => {
    const u = (x - s.x) / s.w;
    const v = (y - s.y) / s.h;
    const concha = Math.exp(-(((u - 0.45) / 0.19) ** 2) - (((v - 0.55) / 0.28) ** 2));
    const rim = Math.exp(-(((u - 0.9) / 0.09) ** 2));
    // У головы — в тени (ухо отходит от черепа), раковина — глубоко, завиток — на свету.
    const base = Math.max(0, 1 - u / 0.22);
    let c = flesh(skin, -0.25 + 0.5 * rim - 1.0 * concha - 0.3 * base + (n(x * 0.2, y * 0.2) - 0.5) * 0.06);
    c = mix(c, ruddy, 0.35 * weather * rim);
    // Мочка — светлее и розовее.
    return v > 0.82 ? mix(c, mix(flesh(skin, 0.1), ruddy, 0.3), Math.min(1, (v - 0.82) / 0.1) * 0.6) : c;
  });
  // Складка завитка — тёмной дугой внутри края.
  const fold = spline([
    [s.x + s.w * 0.78, s.y + s.h * 0.8],
    [s.x + s.w * 0.72, s.y + s.h * 0.45],
    [s.x + s.w * 0.76, s.y + s.h * 0.12],
  ]);
  img.shape(stroke(fold, (t) => 6 * Math.sin(Math.PI * t) + 1.5), boxOf(fold, 8), flesh(skin, -1), { soft: 3, alpha: 0.85 });
  const tragus = poly([
    [s.x + 4, s.y + s.h * 0.5],
    [s.x + s.w * 0.25, s.y + s.h * 0.42],
    [s.x + s.w * 0.25, s.y + s.h * 0.6],
  ]);
  img.shape(tragus, box, flesh(skin, -0.15), { soft: 4, alpha: 0.5 });
}
