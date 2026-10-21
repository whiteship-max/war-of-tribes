// Лист лица советника (ЛЦ-5, docs/characters.md): 512 × 512, кодом, на холсте и чертах набора (`kit/face.ts`) — та же
// манера, что у супруги и гонца: тёмная линия века, брови и губы общими кистями, мазок, а не аэрограф. Лицо — пожилого
// умного человека: высокий лоб с поперечными морщинами, между бровями — две складки, у внешних углов глаз — «гусиные
// лапки», под глазами — мешки, от крыльев носа к углам рта — носогубные складки; виски впалые, скула видна, под ней провал;
// брови седые и кустистые, веко тяжёлое; губы тонкие и бледные, над ними — седые усы, ниже — борода (сама борода — сеткой).
//
// Свет и тень формы — гладким тоном по всему лицу (`kit/face.formShade`), без плоскостей с краем: прежний слабый пункт набора
// — пятна теней на щеках (ЛЦ-3) — здесь не повторяется. Морщины — складками (`kit/face.wrinkle`): борозда и свет под ней.
import { FaceSheet, formShade, grain, paintBrows, paintEyeball, paintEyelids, paintLid, paintLips, paintMouth, skinBase, underChin, wrinkle, type FacePt } from '../kit/face';
import { paintEar } from '../kit/ear';
import { bell, smooth, type Head } from '../kit/head';
import { EYE_SHEET, FACE_PX, U_PX } from '../kit/head';
import { Img, around, boxOf, circle, ellipse, flesh, hex, mix, noise, rng, spline, stroke, tone, type RGB } from '../kit/paint';
import { BEARD_TH, EAR_SHEET } from './figure';
import type { AdvisorLook } from './looks';

/** Верх бороды по столбцу (метры лица): над ним — щека, под ним — седой волос (сетка бороды поверх). */
const beardTop = (X: number): number => 0.047 + 0.006 * smooth(0, 0.024, X) + 0.05 * smooth(0.024, 0.11, X) + 0.025 * smooth(0.11, 0.15, X) + 0.03 * smooth(0.14, 0.17, X);

export function paintAdvisorFace(look: AdvisorLook, head: Head): Img {
  const pal = look.palette;
  const st = look.face;
  const skin = hex(pal.skin);
  const hair = hex(pal.hair);
  // Губы — бледные, сухие: почти кожа.
  const lip = mix(mix(flesh(skin, -0.18), [0.62, 0.34, 0.32], st.lipTint), [0.45, 0.26, 0.24], 0.1);
  const ruddy = mix(skin, [0.82, 0.38, 0.32], 0.5);
  const rose = mix(skin, [0.86, 0.46, 0.42], 0.5);
  // Седина у лица — темнее и холоднее, чем в свету: брови и ресницы читаются на коже.
  const lash = mix(tone(hair, -0.95), [0.12, 0.1, 0.1], 0.55);
  const brow = mix(tone(hair, -0.18), [0.42, 0.4, 0.38], 0.25);
  const lid = mix(skin, mix(flesh(skin, -0.6), ruddy, 0.35), 0.6);
  const f = new FaceSheet(head, (k) => flesh(skin, k));
  const { img, face, sh, SX } = f;
  const P = (x: number, h: number): [number, number] => f.P(x, h);
  const RX = (m: number): number => f.RX(m);
  const RY = (m: number): number => f.RY(m);

  skinBase(f, 0.06, 0.06, 0.5);
  underChin(f);

  // ---------- Форма: гладким тоном, без краёв ----------
  const E = head.EYE;
  formShade(f, (X, h) => {
    const a = X;
    return (
      // Лоб — на свету, к вискам гаснет; впалый висок — в тени.
      0.24 * bell(a, 0.035, 0.04) * bell(h, 0.205, 0.035) -
      0.32 * bell(a, 0.118, 0.022) * bell(h, 0.19, 0.035) +
      // Скула — светом по кости, под ней — провал до челюсти.
      0.26 * bell(a, 0.072, 0.022) * bell(h, 0.121, 0.0085) -
      0.36 * bell(a, 0.08, 0.03) * bell(h, 0.082, 0.02) +
      // Оплывшая щека над складкой — светлее, сама складка — ниже кистью.
      0.12 * bell(a, 0.045, 0.012) * bell(h, 0.086, 0.012) +
      // Спинка носа — на свету; глазница у переносицы — в тени.
      0.2 * bell(a, 0, 0.007) * bell(h, 0.125, 0.025) -
      0.34 * bell(a, 0.024, 0.01) * bell(h, 0.146, 0.01) -
      // Надбровье нависает: под бровью — тень над веком.
      0.26 * bell(a, E.x, 0.022) * bell(h, 0.153, 0.007) +
      // Мешок под глазом: свет на нём, тень под ним — гладко.
      0.14 * bell(a, E.x, 0.014) * bell(h, 0.128, 0.004) -
      0.22 * bell(a, E.x + 0.002, 0.016) * bell(h, 0.121, 0.004) -
      // Бок лица к уху — в тень.
      0.32 * smooth(0.1, 0.15, a)
    );
  });

  // ---------- Глаза ----------
  // Тяжёлое веко: тёплая тень над ним до брови, складка — тёмной дугой.
  f.plane([[0.02, 0.157], [0.034, 0.16], [0.052, 0.1605], [0.066, 0.156], [0.074, 0.148], [0.066, 0.1445], [0.054, 0.147], [0.04, 0.1478], [0.028, 0.1468], [0.02, 0.15]], mix(mix(sh(-0.75), [0.5, 0.26, 0.18], 0.25), lid, 0.3), 6, 0.75);
  wrinkle(f, [[0.024, 0.1505], [0.038, 0.1535], [0.054, 0.153], [0.066, 0.1485], [0.072, 0.1425]], 0.8, 1.5, 1.2);
  const bridge = P(0, 0.149);
  img.shape(ellipse(bridge[0], bridge[1], RX(0.008), RY(0.013)), { ...around(bridge[0], bridge[1], RX(0.016), RY(0.02)), x0: 0 }, sh(0.4), { soft: 7, alpha: 0.5 });

  // ---------- Нос: длинный, с горбинкой, кончик ниже ----------
  img.shape(stroke([P(0, 0.152), P(0, 0.103)], (t) => RX(0.0048 + 0.0022 * t)), boxOf([P(0, 0.158), P(0.009, 0.097)], 8), sh(0.6), { soft: 4, alpha: (x, y) => 0.9 * Math.min(1, Math.max(0, (y - f.yOf(0.16)) / 14)) });
  // Горбинка — светлым бликом на кости.
  const hump = P(0, 0.136);
  img.shape(ellipse(hump[0], hump[1], RX(0.004), RY(0.004)), { ...around(hump[0], hump[1], RX(0.008), RY(0.008)), x0: 0 }, sh(0.75), { soft: 3, alpha: 0.6 });
  f.plane([[0.0068, 0.156], [0.015, 0.157], [0.0138, 0.128], [0.0108, 0.118], [0.0074, 0.121], [0.0058, 0.134]], sh(-0.55), 4, 0.7);
  f.brushed([[0.0084, 0.12], [0.0104, 0.121], [0.0178, 0.102], [0.0138, 0.093], [0.0078, 0.1]], sh(-0.7), 1.75, 10, 3.5, 22, 45);
  const tip = P(0, 0.098);
  img.shape(ellipse(tip[0], tip[1], RX(0.007), RY(0.0046)), around(tip[0], tip[1], RX(0.012), RY(0.01)), mix(sh(0.42), ruddy, 0.3), { soft: 4, alpha: 0.85 });
  img.shape(ellipse(tip[0] + RX(0.001), tip[1] - RY(0.0013), RX(0.0024), RY(0.0016)), around(tip[0], tip[1], RX(0.005), RY(0.004)), sh(0.85), { soft: 2.5, alpha: 0.65 });
  f.plane([[-0.001, 0.0925], [0.0105, 0.0925], [0.0142, 0.088], [0.0088, 0.0855], [-0.001, 0.0855]], sh(-0.7), 3);
  const nostril = P(0.0074, 0.0898);
  img.shape(ellipse(nostril[0], nostril[1], RX(0.003), RY(0.0016), 0.25), around(nostril[0], nostril[1], RX(0.006), RY(0.004)), sh(-1), { soft: 2, alpha: 0.85 });
  img.shape(stroke(spline([P(0.0106, 0.1015), P(0.0156, 0.0975), P(0.0146, 0.0908)]), RX(0.0017)), boxOf([P(0.008, 0.103), P(0.018, 0.089)], 6), sh(-0.75), { soft: 3, alpha: 0.7 });

  // ---------- Морщины ----------
  // Лоб — три волны поперёк, глубже посередине, к вискам мельче.
  for (const [h, k] of [
    [0.198, 1],
    [0.213, 0.85],
    [0.228, 0.6],
  ] as const) {
    const pts: FacePt[] = [0, 0.015, 0.03, 0.045, 0.06, 0.072].map((X, i) => [X, h + 0.0022 * Math.sin(i * 1.3 + h * 90) + 0.004 * smooth(0.03, 0.075, X)]);
    wrinkle(f, pts, st.forehead * k, 1.25, 1.6);
  }
  // Между бровями — две складки (вдумчивый, щурится над письмом).
  wrinkle(f, [[0.0075, 0.152], [0.0082, 0.162], [0.0072, 0.172]], st.forehead * 0.8, 1.2, 1.3);
  wrinkle(f, [[0.0145, 0.154], [0.0158, 0.163], [0.0148, 0.17]], st.forehead * 0.45, 1, 1.2);
  // «Гусиные лапки» — веером от внешнего угла глаза.
  const corner: FacePt = [E.x + E.half + 0.003, E.h + 0.0005];
  for (const [dx, dh, k] of [
    [0.016, 0.009, 0.7],
    [0.019, 0.002, 1],
    [0.016, -0.006, 0.85],
    [0.012, -0.011, 0.55],
  ] as const)
    wrinkle(f, [corner, [corner[0] + dx * 0.55, corner[1] + dh * 0.5], [corner[0] + dx, corner[1] + dh]], st.crows * k, 1.1, 1.3);
  // Мешок под глазом — дугой под нижним веком.
  wrinkle(f, [[0.026, 0.1265], [0.036, 0.1225], [0.047, 0.1218], [0.058, 0.125]], st.crows * 0.7, 1.4, 1.6);
  // Носогубная складка — от крыла носа к углу рта и вниз под усы.
  wrinkle(f, [[0.019, 0.0985], [0.026, 0.087], [0.031, 0.076], [0.034, 0.066]], st.folds, 2.4, 2.2);
  // Морщинка у брови у виска.
  wrinkle(f, [[0.072, 0.168], [0.08, 0.162], [0.086, 0.152]], st.forehead * 0.4, 1, 1.2);

  // ---------- Пигмент ----------
  if (st.spots > 0) {
    const r = rng(71);
    for (let i = 0; i < 9; i++) {
      const X = 0.03 + r() * 0.1;
      const h = 0.17 + r() * 0.07;
      const c = P(X, h);
      img.shape(ellipse(c[0], c[1], 2 + r() * 3, 1.6 + r() * 2.4, r()), around(c[0], c[1], 8), mix(flesh(skin, -0.35), [0.5, 0.32, 0.2], 0.4), { soft: 2.5, alpha: (0.18 + r() * 0.2) * st.spots });
    }
  }

  // ---------- Губы, веки, брови ----------
  paintLips(f, lip, { full: 0.15, shine: [0.0586, 0.004, 0.006], philtrum: [0.0875, 0.0735, 0.0895, 0.07] });
  paintEyelids(f, lid, lash, rose, { lash: st.lash * 1.5, wing: 0.0006, lashes: 2 });
  // Брови — седые, кустистые; волоски торчат вверх и к виску.
  const browPts: FacePt[] = [
    [0.012, 0.1615],
    [0.03, 0.1655 + st.browArch * 0.4],
    [0.05, 0.167 + st.browArch * 0.7],
    [0.068, 0.1638 + st.browArch * 0.3],
    [0.081, 0.1575],
  ];
  paintBrows(f, brow, {
    ridge: [
      [0.018, 0.176],
      [0.045, 0.179],
      [0.072, 0.171],
    ],
    pts: browPts,
    thick: st.browThick,
    hairs: 44,
    seed: 73,
    taper: 0.38,
  });
  {
    const r = rng(75);
    const curve = spline(browPts.map(([x, h]) => P(x, h)), 6);
    for (let i = 0; i < 26 * st.bushy; i++) {
      const p0 = curve[Math.floor(r() * curve.length)];
      if (p0[0] < 6) continue;
      const up = -(3 + r() * 6);
      const lean = 2 + r() * 6;
      const line: [number, number][] = [
        [p0[0], p0[1] + 1],
        [p0[0] + lean * 0.5, p0[1] + up * 0.6],
        [p0[0] + lean, p0[1] + up],
      ];
      img.shape(stroke(line, (t) => 1.1 * (1 - t) + 0.3), boxOf(line, 3), r() < 0.5 ? tone(hair, 0.15) : brow, { soft: 0.7, alpha: 0.75 });
    }
  }

  // ---------- Седина у лица: виски, борода под сеткой, усы ----------
  const n = noise(77);
  // Виски — волосы назад: над ухом и у виска, выше — залысина (лоб открыт).
  const templeLow = 0.15 + 0.03 * st.recede;
  const hairTone = (x: number, y: number): RGB => {
    const u = Math.sin(y * 0.33 + Math.sin(x * 0.05) * 2);
    return tone(hair, -0.1 + 0.26 * (1 - u * u) ** 2 - 0.2 * Math.abs(u) ** 6 + (n(x * 0.1, y * 0.4) - 0.5) * 0.1);
  };
  img.shape(
    (x, y) => {
      const h = f.hRow[Math.min(FACE_PX - 1, y | 0)];
      // Волосы — у самого края маски (за 0,128 м от середины) и выше уха; край неровный.
      const edge = 0.128 + 0.012 * smooth(templeLow, templeLow + 0.04, h) + (n(y * 0.08, 5) - 0.5) * 0.006;
      return Math.max(edge * SX - x, (templeLow - h) * SX);
    },
    face,
    hairTone,
    { soft: 3 },
  );
  // Под бородой — седой подшёрсток (сетка бороды лежит поверх; её край не висит над голой кожей).
  img.shape(
    (x, y) => {
      const X = x / SX;
      const h = f.hRow[Math.min(FACE_PX - 1, y | 0)];
      return (h - beardTop(X) + 0.003) * SX;
    },
    face,
    (x, y) => mix(hairTone(x, y), flesh(skin, -0.3), 0.35),
    { soft: 4 },
  );
  // Корни у края бороды — редкими штрихами вверх по щеке, чтобы край не был срезом.
  {
    const r = rng(79);
    for (let i = 0; i < 260; i++) {
      const X = 0.004 + r() * 0.13;
      const top = beardTop(X);
      const h = top + 0.004 - r() * 0.01;
      const p0 = P(X, h);
      if (p0[0] < 4) continue;
      const len = 2 + r() * 4;
      const ang = 1.3 + X * 3;
      const line: [number, number][] = [p0, [p0[0] + Math.cos(ang) * len, p0[1] + Math.sin(ang) * len]];
      img.shape(stroke(line, 0.7), boxOf(line, 2), tone(hair, -0.2 + r() * 0.3), { soft: 0.6, alpha: 0.45 });
    }
  }
  // Усы: от-под носа вниз и к углам рта, свисают за уголки и сходятся с бородой; посередине — пробор над ложбинкой.
  {
    const M = head.MOUTH;
    const r = rng(81);
    const base = mix(tone(hair, -0.1), sh(-0.2), 0.12);
    // Тень под усами на верхней губе.
    img.shape(stroke(spline([P(-0.012, M.line + 0.003), P(0.012, M.line + 0.003), P(0.028, M.line - 0.001), P(0.036, M.line - 0.012)]), (t) => 4 + 4 * Math.sin(Math.PI * t)), { ...boxOf([P(0, 0.08), P(0.04, 0.04)], 10), x0: 0 }, sh(-0.9), { soft: 4, alpha: 0.55 });
    // Края многоугольника — за осью листа (с минусом): край на самой оси лёг бы в один крайний столбец (шов).
    const zone: FacePt[] = [
      [-0.006, 0.0872],
      [0.006, 0.0882],
      [0.016, 0.0866],
      [0.027, 0.0798],
      [0.034, 0.07],
      [0.038, 0.057],
      [0.036, 0.049],
      [0.03, 0.054],
      [0.024, 0.0628],
      [0.012, 0.0668],
      [-0.006, 0.0672],
    ];
    f.plane(zone, base, 2.5, 0.92);
    for (let i = 0; i < 160; i++) {
      const X = 0.002 + r() * 0.034;
      const h0 = 0.0868 - X * 0.12 - r() * 0.004;
      const len = 0.009 + X * 0.45 * (0.6 + r() * 0.5);
      const ang = 1.25 - X * 14 + (r() - 0.5) * 0.25;
      const p0 = P(X, h0);
      const p2: [number, number] = [p0[0] + Math.cos(ang) * RX(len) * 0.9, p0[1] + RY(len) * Math.sin(ang) * 1.1];
      const p1: [number, number] = [(p0[0] + p2[0]) / 2 + 1, (p0[1] + p2[1]) / 2];
      if (p0[0] < 4) continue;
      const c = r() < 0.4 ? tone(hair, 0.3) : r() < 0.6 ? tone(hair, -0.35) : hair;
      img.shape(stroke([p0, p1, p2], (t) => 1.6 * (1 - t) + 0.4), boxOf([p0, p1, p2], 3), c, { soft: 0.8, alpha: 0.8 });
    }
    // Пробор над ложбинкой — мягкой тенью к середине, на десяток точек (у оси листа — не одним столбцом: шов).
    img.shape((x, y) => x - 4, { ...boxOf([P(0, 0.088), P(0.002, 0.074)], 0), x0: 0, x1: 14 }, tone(hair, -0.6), { soft: 6, alpha: 0.3 });
  }

  grain(f, 83, [0.07, 0.03, 0.04], 0.05);
  // Белок — чуть желтоватый (возраст), радужка светлее к краю.
  paintEyeball(img, head, pal.iris, 0xe0c4ae, 0.0082);
  {
    const s = EYE_SHEET;
    const px = s.w / s.m;
    const ir = 0.0082 * px;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2 - ((0.02 * head.BALL.r) / s.m) * s.w;
    img.shape(circle(cx - ir * 0.34, cy - ir * 0.38, ir * 0.25), around(cx - ir * 0.34, cy - ir * 0.38, ir * 0.34), hex(0xfffcf4), { soft: 1.2 });
  }
  paintLid(img, skin, lid, lash);
  paintMouth(img, lip);
  paintEar(img, EAR_SHEET, skin, ruddy, 0.45);
  return img;
}

/** Столбцы бороды на лице (метры) — тестам и стенду: где борода, а где щека. */
export const BEARD_FACE = { top: beardTop, cols: BEARD_TH, width: U_PX } as const;
