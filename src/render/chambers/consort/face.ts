// Лист лица супруги (ЛЦ-2, docs/characters.md): 512 × 512, кодом. Лицо — самое светлое и контрастное место фигуры: свет и
// тень формы нарисованы (нос и скулы — только тенью), глаза — белок, радужка с тёмным ободком, зрачок и блик, толстая
// тёмная линия верхнего века с ресницами; брови дугой чуть темнее волос; губы в два тона с бликом на нижней, уголки
// приподняты; румянец, мягкая тень под нижней губой и под подбородком.
//
// Лист зеркальный: левый край — середина лица (выборка у края не выходит за него — шва нет), вправо — к виску. Справа —
// столбец листов белка, века и рта (`head.EYE_SHEET` и соседи). Рисуется по координатам лица (метры по ряду, высота над
// подбородком) — теми же функциями, что кладут UV на сетку (`head.facePx`), поэтому глаз на листе — ровно в разрезе века.
import { BALL, EYE, EYE_SHEET, FACE_PX, FACE_U_M, LID_SHEET, LIP_N, MOUTH, MOUTH_SHEET, TOP_H, U_PX, arcAt, eyeRim, faceHeight, faceOval, facePx, mouthRim } from './head';
import { HAIR } from './figure';
import type { Look } from './looks';
import { Img, around, boxOf, brushPlane, circle, ellipse, flesh, hex, mix, noise, poly, rng, spline, stroke, tone, type RGB } from './paint';

const SX = U_PX / FACE_U_M;

/** Высота над подбородком → строка листа (таблицей: дуга по середине лица считается долго). */
const yOf = (() => {
  const lo = -0.004;
  const hi = TOP_H + 0.02;
  const n = 260;
  const t: number[] = [];
  for (let i = 0; i <= n; i++) t.push(facePx(0, lo + ((hi - lo) * i) / n)[1]);
  return (h: number): number => {
    const k = Math.max(0, Math.min(n, ((h - lo) / (hi - lo)) * n));
    const i = Math.min(n - 1, Math.floor(k));
    return t[i] + (t[i + 1] - t[i]) * (k - i);
  };
})();

/** Точка листа по метрам вдоль ряда и высоте. */
const P = (x: number, h: number): [number, number] => [x * SX, yOf(h)];
/** Полуоси на листе для размеров в метрах. */
const RX = (m: number): number => m * SX;
const RY = (m: number): number => Math.abs(yOf(0.12 + m) - yOf(0.12));

/** Где на лице начинаются волосы (метры от середины по ряду h): по кольцам волос `figure.HAIR`. */
function hairX(h: number): number {
  const y = faceHeight(h);
  for (let i = 1; i < HAIR.length; i++) {
    const a = HAIR[i - 1];
    const b = HAIR[i];
    if (y <= a.y && y >= b.y) {
      const k = (a.y - y) / (a.y - b.y);
      return arcAt(Math.max(0, h), a.open + (b.open - a.open) * k);
    }
  }
  return arcAt(Math.max(0, h), y > HAIR[0].y ? 0 : 1.3);
}

/**
 * Граница волос на лице — овалом (решение после круга 6): шире всего у скул, к вискам и к подбородку уже. Пряди шапки
 * волос — за силуэтом лица, поэтому контур лица рисует эта граница, а не прямые края прядей. Ниже скулы — к подбородку
 * лицо открыто, там граница — сама челюсть.
 */
function edgeX(h: number): number {
  return Math.min(hairX(h), faceOval(h));
}

export function paintFace(look: Look): Img {
  const img = new Img(FACE_PX, FACE_PX);
  const pal = look.palette;
  const st = look.face;
  const skin = hex(pal.skin);
  const hair = hex(pal.hair);
  const lip = mix(mix(skin, [0.7, 0.28, 0.34], st.lipTint * 0.85), [0.48, 0.18, 0.24], 0.1);
  const rose = mix(skin, [0.9, 0.42, 0.4], 0.5);
  const lash = mix(tone(hair, -1), [0.05, 0.03, 0.03], 0.75);
  const brow = mix(mix(tone(hair, -0.5), lash, 0.38), hex(pal.hair), 0.12);
  const lid = mix(skin, mix(flesh(skin, -0.6), mix(hair, rose, 0.35), 0.4), st.lidShade + 0.4);
  const face = { x0: 0, y0: 0, x1: U_PX + 8, y1: FACE_PX };
  const sh = (k: number): RGB => flesh(skin, k);
  /** Плоскость света или тени: многоугольник в метрах лица (по ряду, высота), край — `soft` точек. */
  const plane = (pts: [number, number][], c: RGB, soft: number, alpha = 1): void => {
    const q = pts.map(([x, h]) => P(x, h));
    img.shape(poly(q), boxOf(q, soft * 2), c, { soft, alpha });
  };

  // Основа — тёплый средний тон кожи; к виску и к челюсти — в тень.
  img.fill(sh(-0.08), face);
  img.shape((x, y) => -1, face, (x, y) => {
    const X = x / SX;
    const side = Math.max(0, Math.min(1, (X - 0.06) / 0.06));
    return sh(-0.08 - 0.55 * side * side);
  });
  // Низ: под подбородком и полоса к шее — тёмная плоскость (свет сверху); тем же тоном начинается шея на листе тела.
  const chinY = yOf(0);
  img.shape((x, y) => chinY - 2 - y, { x0: 0, y0: chinY - 4, x1: face.x1, y1: FACE_PX }, (x, y) => sh(-0.78 + 0.4 * Math.min(1, Math.max(0, (y - chinY - 6) / 40))), { soft: 4 });

  // Плоскости света и тени — мазками кисти по форме (`paint.brushPlane`): штрихи идут вдоль плоскости, край — неровный.
  const brushed = (pts: [number, number][], c: RGB, angle: number, len: number, width: number, count: number, seed: number, alpha = 1): void =>
    brushPlane(img, pts.map(([x, h]) => P(x, h)), c, { angle, len, width, count, seed, alpha, soft: 4.5 });
  // Свет: лоб (мазки поперёк), скула (к виску вверх), подбородок.
  brushed([[-0.001, 0.212], [0.03, 0.212], [0.05, 0.204], [0.052, 0.192], [0.036, 0.184], [0.012, 0.182], [-0.001, 0.184]], sh(0.42), 0.05, 26, 6, 40, 3, 0.85);
  // Скула — тёплым светом по форме: длинная дуга от виска к середине щеки.
  // Скула — высоко, под глазом к виску: тёплый свет по форме.
  brushed([[0.036, 0.122], [0.052, 0.1272], [0.07, 0.1262], [0.079, 0.1185], [0.066, 0.1095], [0.048, 0.1125]], mix(sh(0.62), [1, 0.82, 0.6], 0.2), -0.3, 12, 5, 24, 5, 0.9);
  const chinL = P(0, 0.022);
  img.shape(ellipse(chinL[0], chinL[1], RX(0.01), RY(0.007)), around(chinL[0], chinL[1], RX(0.018), RY(0.014)), sh(0.3), { soft: 10, alpha: 0.6 });
  // Тень: висок (вдоль), под скулой — дугой от скулы к углу челюсти, бок челюсти — вдоль её линии.
  brushed([[0.07, 0.235], [0.12, 0.235], [0.12, 0.12], [0.088, 0.126], [0.078, 0.145], [0.072, 0.17], [0.064, 0.2]], sh(-0.62), 1.62, 24, 6, 60, 9);
  // Под скулой — широкая тёмная плоскость красноватой охры от виска к углу челюсти (круг 14; узкая полоса читалась
  // «контурингом»): верх у кости — чёткий, к углу рта и к челюсти — шире и мягче.
  const hollow = mix(sh(-0.58), [0.62, 0.3, 0.2], 0.3);
  // Видимая часть — до края прядей у щёк (`figure.buildLocks`, ≈ овал − 8 мм): плоскость лежит внутри неё.
  const cheek: [number, number][] = [[0.1, 0.118], [0.084, 0.1115], [0.07, 0.1025], [0.056, 0.0915], [0.046, 0.0785], [0.04, 0.0675], [0.046, 0.0555], [0.06, 0.0455], [0.084, 0.0395], [0.1, 0.05]];
  brushed(cheek, hollow, 2.2, 20, 6, 46, 11, 0.9);
  // Челюсть — средним тоном, темнее только у края.
  plane([[0.03, 0.03], [0.06, 0.04], [0.09, 0.036], [0.1, 0.012], [0.1, -0.004], [0.03, -0.004], [0.022, 0.014]], sh(-0.16), 8, 0.5);
  // Глазница: тень под надбровьем — полумесяцем над глазом мазками вдоль дуги, у переносицы — глубже, под глазом — легко.
  const browUnder = spline([P(0.016, 0.158), P(0.034, 0.1625), P(0.054, 0.162), P(0.07, 0.156), P(0.076, 0.146)], 5);
  img.shape(stroke(browUnder, (t) => RY(0.012) * (1 - 0.25 * t)), boxOf(browUnder, 18), sh(-0.8), { soft: 5, alpha: 0.95 });
  brushed([[0.016, 0.158], [0.032, 0.163], [0.054, 0.163], [0.072, 0.157], [0.078, 0.146], [0.066, 0.147], [0.05, 0.151], [0.032, 0.151], [0.022, 0.148]], sh(-0.62), 0.05, 14, 4, 40, 15);
  // Глазница целиком — тёмно-бурым кольцом (как у образца): глаз сидит в ней, а не лежит на коже.
  const socket = P(EYE.x + 0.001, EYE.h + 0.002);
  img.shape(ellipse(socket[0], socket[1], RX(0.029), RY(0.017)), around(socket[0], socket[1], RX(0.042), RY(0.03)), mix(sh(-0.62), lid, 0.25), { soft: 12, alpha: 0.85 });
  // Над веком до брови — тёплая бурая тень (у образца — главный приём «глубоких» глаз): плоскость, а не кольцо.
  plane([[0.014, 0.161], [0.03, 0.1655], [0.052, 0.1665], [0.07, 0.1605], [0.08, 0.1485], [0.072, 0.1425], [0.058, 0.1455], [0.04, 0.147], [0.024, 0.1455], [0.016, 0.148]], mix(mix(sh(-0.88), [0.55, 0.27, 0.14], 0.25), mix(hair, lid, 0.4), 0.25), 4, 1);
  // У внутреннего угла и боков переносицы глазница глубже всего.
  plane([[0.012, 0.16], [0.024, 0.1625], [0.03, 0.15], [0.026, 0.142], [0.016, 0.141], [0.01, 0.148]], mix(sh(-0.8), hair, 0.15), 5, 0.7);
  brushed([[0.008, 0.156], [0.02, 0.156], [0.024, 0.142], [0.02, 0.128], [0.01, 0.132]], sh(-0.55), 1.5, 12, 4, 20, 17, 0.9);
  brushed([[0.022, 0.13], [0.04, 0.128], [0.058, 0.13], [0.062, 0.124], [0.042, 0.12], [0.026, 0.123]], sh(-0.3), 0.05, 12, 4, 20, 19, 0.6);
  // Нос: спинка — свет, бок — тёмная плоскость от угла глаза к крылу, кончик — свет, под ним — тень, ноздри.
  img.shape(stroke([P(0, 0.15), P(0, 0.106)], (t) => RX(0.0044 + 0.0018 * t)), boxOf([P(0, 0.156), P(0.008, 0.1)], 8), sh(0.5), { soft: 4, alpha: (x, y) => 0.9 * Math.min(1, Math.max(0, (y - yOf(0.158)) / 14)) });
  // Бока переносицы — от начала брови вниз к боку носа: тень знаком «Y», как у образца.
  plane([[0.0062, 0.157], [0.0145, 0.1585], [0.0128, 0.13], [0.0098, 0.1215], [0.0068, 0.124], [0.0052, 0.136]], sh(-0.58), 3, 0.8);
  // Бок носа — клином: узко у переносицы, шире к крылу (не две полосы от бровей).
  brushed([[0.0078, 0.122], [0.0094, 0.123], [0.0158, 0.106], [0.0124, 0.0975], [0.0072, 0.104]], sh(-0.7), 1.75, 10, 3.5, 20, 21);
  const tip = P(0, 0.1025);
  img.shape(ellipse(tip[0], tip[1], RX(0.0062), RY(0.0038)), around(tip[0], tip[1], RX(0.01), RY(0.008)), sh(0.55), { soft: 4, alpha: 0.85 });
  img.shape(ellipse(tip[0] + RX(0.001), tip[1] - RY(0.0012), RX(0.0022), RY(0.0015)), around(tip[0], tip[1], RX(0.005), RY(0.004)), sh(0.95), { soft: 2.5, alpha: 0.75 });
  plane([[-0.001, 0.0965], [0.0095, 0.0965], [0.0128, 0.0922], [0.008, 0.0898], [-0.001, 0.0898]], sh(-0.62), 3);
  const nostril = P(0.0068, 0.0938);
  img.shape(ellipse(nostril[0], nostril[1], RX(0.0029), RY(0.0016), 0.25), around(nostril[0], nostril[1], RX(0.006), RY(0.004)), sh(-0.95), { soft: 2, alpha: 0.85 });
  img.shape(stroke(spline([P(0.0098, 0.1045), P(0.0142, 0.1012), P(0.0132, 0.0948)]), RX(0.0016)), boxOf([P(0.008, 0.106), P(0.016, 0.092)], 6), sh(-0.7), { soft: 3, alpha: 0.7 });

  // Румянец и веснушки.
  const blush = P(0.05, 0.088);
  img.shape(ellipse(blush[0], blush[1], RX(0.015), RY(0.01), -0.2), around(blush[0], blush[1], RX(0.03), RY(0.024)), rose, { soft: 26, alpha: st.blush * 0.8 });
  if (st.freckles > 0) {
    const r = rng(7);
    for (let i = 0; i < 46; i++) {
      const fx = 0.004 + r() * 0.07;
      const fh = 0.085 + r() * 0.045 - fx * 0.15;
      if (Math.hypot(fx - EYE.x, (fh - EYE.h) * 1.6) < 0.028) continue;
      const c = P(fx, fh);
      img.shape(circle(c[0], c[1], 1 + r() * 1.2), around(c[0], c[1], 3), sh(-0.35), { soft: 1.4, alpha: (0.2 + r() * 0.3) * st.freckles });
    }
  }

  // Губы: полные; верхняя — темнее (в тени), нижняя — светлее, с бликом; под нижней — тёмный полумесяц; уголки чуть вверх.
  // Точки губ — через середину: левая половина — с минусом (за краем листа), поэтому у зеркала края фигуры нет и шва нет.
  const signed = ([th, h]: [number, number]): [number, number] => {
    const q = facePx(th, h);
    return [Math.sign(th) * q[0], q[1]];
  };
  const outer = mouthRim(false).map(signed);
  const line = mouthRim(true).map(signed);
  const N = LIP_N;
  const upperLip = [...outer.slice(0, N + 2), ...line.slice(1, N + 1).reverse()];
  const lowerLip = [line[0], ...line.slice(N + 2).reverse(), line[N + 1], ...outer.slice(N + 2)];
  const lipBox = { ...boxOf(outer, 10), x0: 0 };
  const lineY = yOf(MOUTH.line);
  img.shape(poly(upperLip), lipBox, (x, y) => mix(tone(lip, -0.36), tone(lip, -0.08), Math.min(1, (lineY - y) / 12)), { soft: 1.6 + st.lipFull });
  img.shape(poly(lowerLip), lipBox, (x, y) => mix(tone(lip, 0.1), tone(lip, -0.22), Math.min(1, (y - lineY) / 20)), { soft: 1.6 + st.lipFull });
  // Блик нижней губы — один мазок посередине (через ось), не две точки.
  const shine = P(0, 0.0556);
  img.shape(ellipse(shine[0], shine[1], RX(0.0085), RY(0.0017)), { ...around(shine[0], shine[1], RX(0.012), RY(0.005)), x0: 0 }, tone(lip, 0.75), { soft: 3.5, alpha: 0.55 });
  const bow = mouthRim(false).slice(1, N + 1).map(([th, h]) => signed([th, h + 0.0016]));
  img.shape(stroke(spline(bow), 2.4), { ...boxOf(bow, 6), x0: 0 }, sh(0.5), { soft: 2.5, alpha: 0.7 });
  img.shape(stroke([P(0, 0.089), P(0, 0.077)], RX(0.0034)), boxOf([P(0, 0.091), P(0.008, 0.073)], 4), sh(-0.2), { soft: 4, alpha: 0.4 });
  // Линия губ — тёмная, к уголкам гуще и чуть вверх (дальше уголка мазок не идёт: там узкие грани края губ).
  const lineR = line.slice((N + 1) / 2, N + 2);
  const corner = line[N + 1];
  const lift: [number, number] = [corner[0] - RX(0.0006), corner[1] - RY(0.0011)];
  img.shape(stroke(spline([[-lineR[1][0], lineR[1][1]], ...lineR.slice(0, lineR.length - 1), lift]), (t) => 1.2 + 1.6 * t * t), { ...boxOf([...lineR, lift], 6), x0: 0 }, tone(lip, -0.75), { soft: 1.6 });
  // Уголки — чуть вверх мягкой тенью улыбки за уголком.
  const smileC: [number, number][] = [
    [corner[0] + RX(0.0012), corner[1] + RY(0.0006)],
    [corner[0] + RX(0.0032), corner[1] - RY(0.0012)],
    [corner[0] + RX(0.0038), corner[1] - RY(0.0034)],
  ];
  img.shape(stroke(spline(smileC, 4), (t) => 2.6 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 0.5), boxOf(smileC, 6), sh(-0.42), { soft: 3, alpha: 0.55 });
  const under = mouthRim(false).slice(N + 2).map(([th, h]) => signed([th, h - 0.0034]));
  img.shape(stroke(spline(under), (t) => RY(0.0034) * Math.sin(Math.PI * t)), { ...boxOf(under, 10), x0: 0 }, sh(-0.62), { soft: 5, alpha: 0.85 });

  // Веко: тени над разрезом (к внешнему углу гуще), складка, толстая линия верхнего века со «стрелкой», ресницы, нижняя
  // линия и светлый край под ней.
  const rim = eyeRim(1).map(([th, h]) => facePx(th, h));
  const top = rim.slice(0, 6);
  const bottom = [rim[5], ...rim.slice(6), rim[0]];
  const lift2 = (pts: [number, number][], m: number): [number, number][] => pts.map(([x, y], i) => [x + (i - 2.5) * 0.6, y - RY(m) * Math.sin((Math.PI * (i + 0.6)) / (pts.length + 0.2))]);
  const lidZone = [...top, ...lift2(top, 0.0068).reverse()];
  img.shape(poly(lidZone), boxOf(lidZone, 12), (x, y) => mix(mix(lid, sh(-0.75), 0.45), flesh(lid, -0.6), Math.max(0, Math.min(1, (x - top[0][0]) / (top[5][0] - top[0][0])))), { soft: 6, alpha: 0.95 });
  img.shape(stroke(spline(lift2(top, 0.0058)), (t) => 3 * Math.sin(Math.PI * Math.min(1, t * 1.05))), boxOf(lift2(top, 0.006), 6), flesh(lid, -0.7), { soft: 3, alpha: 0.75 });
  const outerC = rim[5];
  // Без «стрелки» (круг 12): линия века кончается у самого угла.
  const wingTip: [number, number] = [outerC[0] + RX(st.wing * 0.25), outerC[1] - RY(st.wing * 0.2)];
  const lashLine = spline([...top, wingTip], 5);
  img.shape(stroke(lashLine, (t) => (3.2 + 5.6 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08)) * st.lash) * (t > 0.9 ? (1 - t) * 10 : 1)), boxOf(lashLine, 10), lash, { soft: 1.5 });
  // Ресницы — тремя густыми мазками к внешнему углу (не волосками: на расстоянии покоев волоски — паутина).
  for (let i = 0; i < 3; i++) {
    const k = 0.6 + i * 0.13;
    const at = lashLine[Math.min(lashLine.length - 1, Math.round(k * (lashLine.length - 1)))];
    const len = (4 + i * 1.6) * st.lash;
    const ang = -1.05 + i * 0.22;
    const end: [number, number] = [at[0] + Math.cos(ang) * len * 0.9 + 2, at[1] + Math.sin(ang) * len];
    const mid: [number, number] = [(at[0] + end[0]) / 2 + 2, (at[1] + end[1]) / 2 + 1];
    img.shape(stroke(spline([at, mid, end], 4), (t) => 3.4 * (1 - t) ** 1.2 + 0.4), boxOf([at, end], 5), lash, { soft: 1.2, alpha: 0.95 });
  }
  img.shape(stroke(spline(bottom.slice(0, 5)), (t) => 2.4 * (1 - t) + 0.6), boxOf(bottom, 6), mix(lash, sh(-0.6), 0.4), { soft: 1.5, alpha: 0.85 });
  img.shape(stroke(spline(bottom.slice(0, 5).map(([x, y]) => [x, y + RY(0.0026)] as [number, number])), 3.5), boxOf(bottom, 10), sh(-0.36), { soft: 4, alpha: 0.55 });
  const inner = rim[0];
  img.shape(circle(inner[0] + 2, inner[1], 4), around(inner[0], inner[1], 8), mix(rose, sh(-0.2), 0.3), { soft: 3, alpha: 0.55 });

  // Брови: сильные, темнее волос, почти прямые с лёгким подъёмом к внешней трети, хвост тоньше; волоски — штрихами.
  // Ниже и прямее, гуще у начала (круг 12); над бровью — светлая полоса надбровной дуги.
  const ridge = spline([P(0.02, 0.1755), P(0.045, 0.1785), P(0.07, 0.172)], 5);
  img.shape(stroke(ridge, (t) => RY(0.005) * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05))), boxOf(ridge, 10), sh(0.5), { soft: 6, alpha: 0.55 });
  const browPts = spline([P(0.015, 0.1635), P(0.03, 0.1668 + st.browArch * 0.4), P(0.05, 0.1688 + st.browArch * 0.7), P(0.066, 0.1666 + st.browArch * 0.3), P(0.076, 0.1612)], 6);
  const bw = (t: number): number => RX(st.browThick) * (1.08 - 0.5 * t ** 1.3) * (1 - 0.45 * t ** 3) + 1.2;
  img.shape(stroke(browPts, bw), boxOf(browPts, 12), brow, { soft: 2, alpha: 0.95 });
  const hr = rng(19);
  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    const at = browPts[Math.round(t * (browPts.length - 1))];
    const w = bw(t);
    const off = (hr() - 0.5) * w * 0.7;
    const a = -0.45 + t * 0.8;
    const p0: [number, number] = [at[0] - 3, at[1] + off];
    const p1: [number, number] = [at[0] + Math.cos(a) * 7, at[1] + off + Math.sin(a) * 4];
    img.shape(stroke([p0, p1], 1.1), boxOf([p0, p1], 3), hr() > 0.5 ? tone(brow, -0.4) : tone(brow, 0.3), { soft: 1, alpha: 0.45 });
  }

  // Волосы у края лица: от линии роста к виску — тень прядей; на лице вдоль края — тень от волос.
  // За овалом лица — тёмная плоскость кожи (бок лица в тени), а не волосы: с трёх четвертей эту часть маски видно, и цвет
  // волос лёг бы на щёку пятном (круг 11). Цветом волос — только за краем настоящих прядей (`hairX`).
  const edge = Array.from({ length: FACE_PX }, (_, y) => (edgeX(hRow[y]) - 0.002) * SX);
  const locks = Array.from({ length: FACE_PX }, (_, y) => (hairX(hRow[y]) - 0.002) * SX);
  img.shape((x, y) => edge[Math.min(FACE_PX - 1, y | 0)] - 12 - x, face, sh(-0.62), { soft: 10, alpha: 0.7 });
  img.shape((x, y) => edge[Math.min(FACE_PX - 1, y | 0)] - x, face, mix(sh(-0.74), hair, 0.1), { soft: 6 });
  img.shape((x, y) => locks[Math.min(FACE_PX - 1, y | 0)] - x, face, (x, y) => tone(mix(hair, skin, 0.06), -0.5 - 0.12 * Math.sin((x - locks[Math.min(FACE_PX - 1, y | 0)]) * 0.06 + y * 0.012) ** 2), { soft: 10 });
  const hairline = (x: number): number => yOf(TOP_H - 0.019 - 0.012 * Math.min(1, (x / SX / 0.075) ** 2.4));
  img.shape((x, y) => y - hairline(x), face, (x, y) => tone(mix(hair, skin, 0.08), -0.45 - 0.2 * Math.sin(x * 0.21) ** 2), { soft: 5 });
  img.shape((x, y) => Math.abs(y - hairline(x) - 5) - 4, face, sh(-0.5), { soft: 6, alpha: 0.6 });
  // Край лба — не ровной линией: несколько прядей спадают с линии волос к виску (круг 12).
  for (const [x0, len, bend] of [
    [0.03, 0.012, 0.004],
    [0.048, 0.016, 0.006],
    [0.064, 0.022, 0.008],
  ] as const) {
    const top: [number, number] = [x0 * SX, hairline(x0 * SX) - 2];
    const lockPts = spline([top, P(x0 + bend * 0.5, TOP_H - 0.019 - len * 0.6), P(x0 + bend, TOP_H - 0.019 - len)], 5);
    img.shape(stroke(lockPts, (t) => 6.5 * (1 - t) ** 0.8 + 0.6), boxOf(lockPts, 9), tone(mix(hair, skin, 0.06), -0.42), { soft: 2.2, alpha: 0.95 });
    img.shape(stroke(lockPts.map(([x, y]) => [x + 3.5, y + 1] as [number, number]), (t) => 2.5 * (1 - t) + 0.4), boxOf(lockPts, 10), sh(-0.55), { soft: 3, alpha: 0.45 });
  }

  // Мазок, а не аэрограф: крупные тёплые и прохладные пятна и мелкое зерно — на несколько процентов.
  const grain = noise(83);
  img.shape((x, y) => -1, face, (x, y) => {
    const c = img.get(Math.min(FACE_PX - 1, x | 0), Math.min(FACE_PX - 1, y | 0));
    const big = grain(x * 0.025, y * 0.025) - 0.5;
    const fine = grain(x * 0.3 + 40, y * 0.3) - 0.5;
    return [c[0] * (1 + big * 0.08 + fine * 0.045), c[1] * (1 + big * 0.03 + fine * 0.045), c[2] * (1 - big * 0.04 + fine * 0.045)];
  });

  paintEyeball(img, look);
  paintLid(img, skin, lid, lash);
  paintMouth(img, lip);
  return img;
}

/** Высота над подбородком у каждой строки листа (таблицей). */
const hRow: number[] = Array.from({ length: FACE_PX }, (_, y) => hOfY(y + 0.5));

/** Строка листа → высота над подбородком (обратно к `yOf`). */
function hOfY(y: number): number {
  let lo = -0.004;
  let hi = TOP_H + 0.02;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (yOf(mid) > y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Лист белка: тёплый белок с тенью по краям, радужка с тёмным ободком и светлым низом, зрачок, два блика. */
function paintEyeball(img: Img, look: Look): void {
  const s = EYE_SHEET;
  const iris = hex(look.palette.iris);
  const box = { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
  // Белок — не белее лица: тёплый, приглушённый (иначе глаза спорят с кожей за свет).
  const white: RGB = mix(hex(0xd8cabe), hex(look.palette.skin), 0.28);
  img.fill(white, box);
  const cx = s.x + s.w / 2;
  // Середина радужки чуть выше середины разреза — касается верхнего века.
  const cy = s.y + s.h / 2 - ((0.02 * BALL.r) / s.m) * s.w;
  const px = s.w / s.m;
  // Белок темнеет к уголкам (шар уходит вглубь) — холодно.
  img.shape(
    (x, y) => -1,
    box,
    (x, y) => {
      const r = Math.hypot((x - cx) / (0.024 * px), (y - cy) / (0.016 * px));
      return tone(white, -0.55 * Math.max(0, r - 0.45) ** 1.4);
    },
  );
  const ir = 0.0086 * px;
  // Радужка: тёмный ободок, к низу светлее (свет снизу отражён), лучи волокон, кольцо у зрачка.
  img.shape(circle(cx, cy, ir), around(cx, cy, ir + 2), (x, y) => {
    const dy = (y - cy) / ir;
    const r = Math.hypot(x - cx, y - cy) / ir;
    let c = mix(tone(iris, -0.6), tone(iris, 0.4), Math.max(0, Math.min(1, 0.45 + dy * 0.55)));
    c = mix(c, tone(iris, -0.8), Math.max(0, (r - 0.78) / 0.22) ** 1.2);
    const a = Math.atan2(y - cy, x - cx);
    const fib = 0.5 + 0.5 * Math.sin(a * 23 + Math.sin(a * 7) * 2);
    c = mix(c, tone(c, 0.4), fib * 0.25 * Math.max(0, 1 - Math.abs(r - 0.55) / 0.35));
    return c;
  }, { soft: 1.4 });
  img.shape(circle(cx, cy, ir * 0.48), around(cx, cy, ir * 0.6), tone(iris, 0.25), { soft: 3, alpha: 0.35 });
  // Тень верхнего века на белке и радужке — широкая мягкая полоса сверху.
  img.shape((x, y) => y - (cy - ir * 0.45), box, tone(white, -0.7), { soft: ir * 0.9, alpha: 0.7 });
  img.shape(circle(cx, cy, ir * 0.36), around(cx, cy, ir * 0.4), hex(0x0c0a0c), { soft: 1.2 });
  // Блик — сверху слева (окно) и слабый снизу справа.
  img.shape(circle(cx - ir * 0.36, cy - ir * 0.4, ir * 0.2), around(cx - ir * 0.36, cy - ir * 0.4, ir * 0.3), hex(0xfffcf4), { soft: 1.2 });
  img.shape(circle(cx + ir * 0.32, cy + ir * 0.36, ir * 0.09), around(cx + ir * 0.32, cy + ir * 0.36, ir * 0.15), hex(0xf4f0ea), { soft: 1, alpha: 0.7 });
}

/** Лист века (закрытый глаз): кожа века в тенях, край — толстая тёмная линия с ресницами вниз. */
function paintLid(img: Img, skin: RGB, lid: RGB, lash: RGB): void {
  const s = LID_SHEET;
  const box = { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
  img.shape((x, y) => -1, box, (x, y) => mix(tone(skin, 0.05), lid, Math.min(1, (y - s.y) / (s.h * 0.8))));
  const edge = s.y + s.h - 4;
  img.shape((x, y) => Math.abs(y - edge) - 3.2, { x0: s.x, y0: edge - 6, x1: s.x + s.w, y1: edge + 6 }, lash, { soft: 1.4 });
  for (let i = 0; i < 16; i++) {
    const x = s.x + 22 + i * 5.6;
    img.shape(stroke([[x, edge], [x + 2.5, edge + 4]], 1.2), { x0: x - 3, y0: edge - 2, x1: x + 6, y1: s.y + s.h }, lash, { soft: 1 });
  }
}

/** Лист рта: тёмное нутро, у верха — край верхних зубов. */
function paintMouth(img: Img, lip: RGB): void {
  const s = MOUTH_SHEET;
  const box = { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
  img.shape((x, y) => -1, box, (x, y) => mix(tone(lip, -0.7), tone(lip, -0.9), (y - s.y) / s.h));
  img.shape((x, y) => Math.abs(y - (s.y + 9)) - 3.5 + 0.0004 * (x - s.x - s.w / 2) ** 2, box, hex(0xd8cfc2), { soft: 2.5, alpha: 0.9 });
}
