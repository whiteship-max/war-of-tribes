// Лист лица служанки (ЛЦ-6, docs/characters.md): 512 × 512, кодом, на холсте и чертах набора (`kit/face.ts`) — та же манера,
// что у супруги, гонца и советника: тёмная линия века, брови и губы общими кистями, свет и тень формы — гладким тоном по
// всему лицу (`kit/face.formShade`), без плоскостей с краем. Лицо — молодое, круглое и простое, и не супругино: щёки —
// яблочками на свету и с румянцем, нос короткий и курносый, через нос и по щекам — веснушки, брови мягче и светлее, губы
// пухлые и розовее. Над лбом — волосы на прямой пробор, гладко к вискам и под чепец; у края чепца на лице — тень.
//
// Лист зеркальный: левый край — середина лица, вправо — к виску; справа — столбец листов белка, века и рта (`head.EYE_SHEET`).
import { FaceSheet, formShade, grain, paintBrows, paintEyeball, paintEyelids, paintLid, paintLips, paintMouth, skinBase, underChin, wrinkle } from '../kit/face';
import { bell, smooth, type Head } from '../kit/head';
import { EYE_SHEET, FACE_PX } from '../kit/head';
import { Img, around, boxOf, circle, ellipse, flesh, hex, mix, noise, rng, spline, stroke, tone, type RGB } from '../kit/paint';
import { coifOpen } from './figure';
import type { MaidLook } from './looks';

/** Линия волос над лбом (метры лица): посередине — высоко, к виску — ниже, у виска сходит к краю чепца. */
export const hairline = (X: number): number => 0.199 - 0.004 * (X / 0.03) ** 2 - 0.5 * Math.max(0, X - 0.072) ** 1.2;

export function paintMaidFace(look: MaidLook, head: Head): Img {
  const pal = look.palette;
  const st = look.face;
  const skin = hex(pal.skin);
  const hair = hex(pal.hair);
  const blushC = hex(pal.blush);
  const rose = mix(skin, blushC, 0.75);
  const lip = mix(mix(skin, blushC, 0.35 + st.lipTint * 0.5), [0.62, 0.24, 0.28], 0.12 * st.lipTint);
  const lash = mix(tone(hair, -1), [0.08, 0.05, 0.04], 0.7);
  const brow = mix(mix(tone(hair, -0.35), lash, 0.18), skin, 0.12);
  const lid = mix(skin, mix(flesh(skin, -0.55), rose, 0.4), 0.45);
  const f = new FaceSheet(head, (k) => flesh(skin, k));
  const { img, face, sh, SX, hRow } = f;
  const P = (x: number, h: number): [number, number] => f.P(x, h);
  const RX = (m: number): number => f.RX(m);
  const RY = (m: number): number => f.RY(m);
  const E = head.EYE;

  skinBase(f, 0.07, 0.06, 0.45);
  underChin(f);

  // ---------- Форма: круглая, без кости скулы; щёки-яблочки на свету ----------
  formShade(f, (X, h) => {
    return (
      // Лоб и спинка носа — на свету, к вискам гаснет.
      0.26 * bell(X, 0.025, 0.04) * smooth(0.165, 0.185, h) +
      0.22 * bell(X, 0, 0.008) * bell(h, 0.122, 0.022) +
      // Яблочки щёк — круглым светом, под ними — мягкая тень к челюсти (без провала).
      0.34 * bell(X, 0.052, 0.02) * bell(h, 0.098, 0.016) -
      0.2 * smooth(0.066, 0.092, X) * bell(h, 0.07, 0.024) +
      // Подбородок — светом, под губой — ямка тени.
      0.2 * bell(X, 0, 0.014) * bell(h, 0.026, 0.012) -
      0.22 * bell(X, 0, 0.012) * bell(h, 0.044, 0.004) -
      // Глазница: у переносицы и под бровью — тень; надбровье — свет.
      0.36 * bell(X, 0.024, 0.01) * bell(h, 0.146, 0.01) -
      0.24 * bell(X, E.x, 0.022) * bell(h, 0.153, 0.007) +
      0.14 * bell(X, 0.045, 0.02) * bell(h, 0.174, 0.006) -
      // Бок лица к чепцу — в тень.
      0.42 * smooth(0.09, 0.14, X)
    );
  });

  // ---------- Глаза: тень над веком, мягкая складка ----------
  f.plane([[0.022, 0.157], [0.036, 0.1605], [0.052, 0.161], [0.066, 0.157], [0.074, 0.149], [0.066, 0.1462], [0.052, 0.1488], [0.038, 0.149], [0.028, 0.1475], [0.022, 0.15]], mix(mix(sh(-0.6), [0.55, 0.3, 0.2], 0.25), lid, 0.35), 6, 0.6);
  wrinkle(f, [[0.026, 0.1515], [0.04, 0.155], [0.055, 0.1548], [0.066, 0.151], [0.072, 0.1455]], 0.45, 1.3, 1.1);

  // ---------- Нос: короткий, курносый, кончик круглый и розовый ----------
  img.shape(stroke([P(0, 0.15), P(0, 0.112)], (t) => RX(0.0042 + 0.0016 * t)), boxOf([P(0, 0.156), P(0.008, 0.108)], 8), sh(0.45), { soft: 4, alpha: (x, y) => 0.8 * Math.min(1, Math.max(0, (y - f.yOf(0.158)) / 14)) });
  f.plane([[0.0066, 0.15], [0.013, 0.151], [0.0122, 0.13], [0.0096, 0.122], [0.0066, 0.125], [0.0054, 0.136]], sh(-0.35), 5, 0.45);
  f.brushed([[0.0082, 0.122], [0.0098, 0.123], [0.0166, 0.108], [0.013, 0.1005], [0.0076, 0.106]], sh(-0.55), 1.75, 10, 3.5, 20, 21, 0.85);
  const tip = P(0, 0.1055);
  img.shape(ellipse(tip[0], tip[1], RX(0.0072), RY(0.0048)), around(tip[0], tip[1], RX(0.012), RY(0.01)), mix(sh(0.5), rose, 0.25), { soft: 4, alpha: 0.9 });
  img.shape(ellipse(tip[0] + RX(0.0012), tip[1] - RY(0.0014), RX(0.0026), RY(0.0018)), around(tip[0], tip[1], RX(0.005), RY(0.004)), sh(0.95), { soft: 2.5, alpha: 0.7 });
  // Курносый: ноздри видны спереди, под кончиком — короткая тень.
  f.plane([[-0.001, 0.0995], [0.0098, 0.0995], [0.0132, 0.0955], [0.0084, 0.0932], [-0.001, 0.0932]], sh(-0.55), 3);
  const nostril = P(0.0072, 0.0978);
  img.shape(ellipse(nostril[0], nostril[1], RX(0.0032), RY(0.0019), 0.2), around(nostril[0], nostril[1], RX(0.006), RY(0.0045)), mix(sh(-0.95), rose, 0.15), { soft: 2, alpha: 0.85 });
  img.shape(stroke(spline([P(0.0102, 0.1078), P(0.0148, 0.1042), P(0.014, 0.0978)]), RX(0.0016)), boxOf([P(0.008, 0.11), P(0.017, 0.096)], 6), sh(-0.6), { soft: 3, alpha: 0.6 });

  // ---------- Румянец и веснушки ----------
  const apple = P(0.052, 0.094);
  img.shape(ellipse(apple[0], apple[1], RX(0.018), RY(0.012), -0.15), around(apple[0], apple[1], RX(0.034), RY(0.026)), rose, { soft: 24, alpha: Math.min(1, st.blush * 1.1) });
  img.shape(ellipse(apple[0] - RX(0.004), apple[1] - RY(0.003), RX(0.009), RY(0.005)), around(apple[0], apple[1], RX(0.02), RY(0.014)), mix(sh(0.6), rose, 0.55), { soft: 10, alpha: 0.3 });
  img.shape(ellipse(P(0, 0.112)[0], P(0, 0.112)[1], RX(0.012), RY(0.006)), { ...around(P(0, 0.112)[0], P(0, 0.112)[1], RX(0.02), RY(0.012)), x0: 0 }, rose, { soft: 10, alpha: st.blush * 0.4 });
  if (st.freckles > 0) {
    const r = rng(19);
    for (let i = 0; i < 90; i++) {
      // Гуще всего — на спинке носа и на яблочках, реже — к виску.
      const X = r() < 0.35 ? r() * 0.02 : 0.016 + r() * 0.062;
      const h = 0.098 + r() * 0.036 - Math.max(0, X - 0.04) * 0.2;
      if (Math.hypot(X - E.x, (h - E.h) * 1.5) < 0.026) continue;
      const c = P(X, h);
      if (c[0] < 3) continue;
      img.shape(circle(c[0], c[1], 0.9 + r() * 1.3), around(c[0], c[1], 3.2), mix(sh(-0.4), [0.55, 0.3, 0.16], 0.35), { soft: 1.3, alpha: (0.25 + r() * 0.35) * st.freckles });
    }
  }

  // ---------- Губы, веки, брови ----------
  paintLips(f, lip, { full: st.lipFull, shine: [0.0568, 0.008, 0.011], philtrum: [0.0935, 0.0775, 0.0955, 0.0738] });
  paintEyelids(f, lid, lash, rose, { lash: st.lash, wing: 0.0014 });
  paintBrows(f, brow, {
    ridge: [
      [0.02, 0.1745],
      [0.045, 0.1775],
      [0.07, 0.1715],
    ],
    pts: [
      [0.016, 0.1625],
      [0.031, 0.1658 + st.browArch * 0.4],
      [0.05, 0.1676 + st.browArch * 0.7],
      [0.066, 0.1656 + st.browArch * 0.35],
      [0.077, 0.1606],
    ],
    thick: st.browThick,
  });

  // ---------- Волосы у лба: пробор, гладко к вискам и под чепец ----------
  const n = noise(31);
  const hairTone = (x: number, y: number): RGB => {
    const X = x / SX;
    // Пряди от пробора — наискось вниз к виску: полосы по углу, блик на выпуклости над лбом.
    const s = Math.sin((y * 0.16 - x * 0.12) * 0.9 + Math.sin(x * 0.04 + y * 0.02) * 1.5);
    const bulge = bell(X, 0.035, 0.03);
    return tone(hair, -0.22 + 0.3 * bulge + 0.08 * (1 - s * s) ** 2 - 0.08 * Math.abs(s) ** 5 + (n(x * 0.1, y * 0.4) - 0.5) * 0.12);
  };
  const edgeX = (h: number): number => {
    const open = coifOpen(h);
    return open <= 0 ? 0 : head.arcAt(Math.max(0, h), open);
  };
  const edge = Array.from({ length: FACE_PX }, (_, y) => edgeX(hRow[y]) * SX);
  // Волосы: выше линии волос, до края чепца (за краем лён лежит поверх).
  img.shape(
    (x, y) => {
      const h = hRow[Math.min(FACE_PX - 1, y | 0)];
      return (hairline(x / SX) - h) * SX;
    },
    face,
    hairTone,
    { soft: 3 },
  );
  // Пробор: тонкая тень по оси (у края листа — мягко, в несколько точек: шва нет).
  img.shape((x) => x - 2.5, { ...boxOf([P(0, 0.235), P(0.004, 0.195)], 2), x0: 0, x1: 8 }, mix(tone(hair, -0.7), sh(-0.3), 0.3), { soft: 3, alpha: 0.8 });
  // Мелкие волоски у линии волос — штрихами вниз (край не срезом).
  {
    const r = rng(37);
    for (let i = 0; i < 120; i++) {
      const X = r() * 0.085;
      const h0 = hairline(X) + 0.001;
      const p0 = P(X, h0);
      if (p0[0] < 4) continue;
      const len = 2 + r() * 4;
      const ang = 1.35 + X * 6;
      const line: [number, number][] = [p0, [p0[0] + Math.cos(ang) * len, p0[1] + Math.sin(ang) * len]];
      img.shape(stroke(line, 0.7), boxOf(line, 2), tone(hair, -0.25 + r() * 0.35), { soft: 0.6, alpha: 0.5 });
    }
  }
  // Тень под краем чепца — на волосах и коже вдоль проёма.
  img.shape((x, y) => {
    const e = edge[Math.min(FACE_PX - 1, y | 0)];
    return e > 0 ? e - 16 - x : 1;
  }, face, sh(-0.85), { soft: 12, alpha: 0.55 });
  img.shape((x, y) => {
    const h = hRow[Math.min(FACE_PX - 1, y | 0)];
    return h > 0.218 ? (0.214 - h) * SX : 1;
  }, face, mix(tone(hair, -0.8), sh(-0.6), 0.4), { soft: 8, alpha: 0.6 });

  grain(f, 83, [0.07, 0.03, 0.035], 0.04);
  paintEyeball(img, head, pal.iris, pal.skin, 0.0088);
  {
    // Второй блик — живой влажный глаз.
    const s = EYE_SHEET;
    const px = s.w / s.m;
    const ir = 0.0088 * px;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2 - ((0.02 * head.BALL.r) / s.m) * s.w;
    img.shape(circle(cx + ir * 0.4, cy + ir * 0.35, ir * 0.12), around(cx + ir * 0.4, cy + ir * 0.35, ir * 0.2), hex(0xfffcf4), { soft: 1, alpha: 0.7 });
  }
  paintLid(img, skin, lid, lash);
  paintMouth(img, lip);
  return img;
}

/** Мера «лица»: где на листе волосы и где край чепца — тестам и стенду. */
export const MAID_FACE = { hairline } as const;
