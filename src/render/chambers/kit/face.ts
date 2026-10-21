// Лист лица набора персонажа (ЛЦ-3, docs/characters.md; вынесено из супруги ЛЦ-2): 512 × 512, кодом. Лицо — самое светлое и
// контрастное место фигуры: свет и тень формы нарисованы плоскостями (нос и скулы — только тенью), глаза — белок, радужка
// с тёмным ободком, зрачок и блик, толстая тёмная линия верхнего века с ресницами; брови темнее волос; губы в два тона с
// бликом на нижней; мазок, а не аэрограф.
//
// Лист зеркальный: левый край — середина лица (выборка у края не выходит за него — шва нет), вправо — к виску. Справа —
// столбец листов белка, века и рта (`head.EYE_SHEET` и соседи). Рисуется по координатам лица (метры по ряду, высота над
// подбородком) — теми же функциями, что кладут UV на сетку (`Head.facePx`), поэтому глаз на листе — ровно в разрезе века.
//
// Здесь — холст лица и общие черты (основа кожи, веки, брови, губы, зерно, листы глаза и рта). Где лежат плоскости света
// и тени, нос, румянец, щетина и край волос — решает лицо облика (`consort/face.ts`, `herald/face.ts`).
import { EYE_SHEET, FACE_PX, FACE_U_M, LID_SHEET, LIP_N, MOUTH_SHEET, U_PX, type Head } from './head';
import { Img, around, boxOf, brushPlane, circle, ellipse, flesh, hex, mix, noise, poly, rng, spline, stroke, tone, type RGB } from './paint';

/** Точка (метры по ряду, высота над подбородком). */
export type FacePt = [number, number];

/** Холст лица: лист, перевод метров лица в точки листа и кисти плоскостей. */
export class FaceSheet {
  readonly img = new Img(FACE_PX, FACE_PX);
  /** Точек листа на метр по ряду. */
  readonly SX = U_PX / FACE_U_M;
  /** Половина лица на листе (с запасом за край). */
  readonly face = { x0: 0, y0: 0, x1: U_PX + 8, y1: FACE_PX };
  /** Высота над подбородком у каждой строки листа (таблицей). */
  readonly hRow: number[];
  private t: number[] = [];
  private lo = -0.004;
  private hi: number;

  constructor(
    readonly head: Head,
    /** Тон кожи: k < 0 — в тень плоскостью, k > 0 — к свету (`paint.flesh`). */
    readonly sh: (k: number) => RGB,
  ) {
    // Высота над подбородком → строка листа (таблицей: дуга по середине лица считается долго).
    this.hi = head.TOP_H + 0.02;
    const n = 260;
    for (let i = 0; i <= n; i++) this.t.push(head.facePx(0, this.lo + ((this.hi - this.lo) * i) / n)[1]);
    this.hRow = Array.from({ length: FACE_PX }, (_, y) => this.hOfY(y + 0.5));
  }

  yOf(h: number): number {
    const n = 260;
    const t = this.t;
    const k = Math.max(0, Math.min(n, ((h - this.lo) / (this.hi - this.lo)) * n));
    const i = Math.min(n - 1, Math.floor(k));
    return t[i] + (t[i + 1] - t[i]) * (k - i);
  }

  /** Строка листа → высота над подбородком (обратно к `yOf`). */
  hOfY(y: number): number {
    let lo = -0.004;
    let hi = this.head.TOP_H + 0.02;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (this.yOf(mid) > y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Точка листа по метрам вдоль ряда и высоте. */
  P(x: number, h: number): [number, number] {
    return [x * this.SX, this.yOf(h)];
  }

  /** Полуоси на листе для размеров в метрах. */
  RX(m: number): number {
    return m * this.SX;
  }

  RY(m: number): number {
    return Math.abs(this.yOf(0.12 + m) - this.yOf(0.12));
  }

  /** Плоскость света или тени: многоугольник в метрах лица, край — `soft` точек. */
  plane(pts: FacePt[], c: RGB, soft: number, alpha = 1): void {
    const q = pts.map(([x, h]) => this.P(x, h));
    this.img.shape(poly(q), boxOf(q, soft * 2), c, { soft, alpha });
  }

  /** Плоскость мазками кисти по форме (`paint.brushPlane`): штрихи идут вдоль плоскости, край — неровный. */
  brushed(pts: FacePt[], c: RGB, angle: number, len: number, width: number, count: number, seed: number, alpha = 1): void {
    brushPlane(
      this.img,
      pts.map(([x, h]) => this.P(x, h)),
      c,
      { angle, len, width, count, seed, alpha, soft: 4.5 },
    );
  }

  /** Точка края губ через середину: левая половина — с минусом (за краем листа), у зеркала края фигуры нет и шва нет. */
  signed([th, h]: [number, number]): [number, number] {
    const q = this.head.facePx(th, h);
    return [Math.sign(th) * q[0], q[1]];
  }
}

/** Основа кожи: тёплый средний тон; к виску (с `from` метров по ряду, за `span`) — в тень на `deep`. */
export function skinBase(f: FaceSheet, from = 0.06, span = 0.06, deep = 0.55): void {
  const { img, face, sh, SX } = f;
  img.fill(sh(-0.08), face);
  img.shape((x, y) => -1, face, (x, y) => {
    const X = x / SX;
    const side = Math.max(0, Math.min(1, (X - from) / span));
    return sh(-0.08 - deep * side * side);
  });
}

/** Низ листа: под подбородком и полоса к шее — тёмная плоскость (свет сверху); тем же тоном начинается шея на листе тела. */
export function underChin(f: FaceSheet): void {
  const chinY = f.yOf(0);
  f.img.shape((x, y) => chinY - 2 - y, { x0: 0, y0: chinY - 4, x1: f.face.x1, y1: FACE_PX }, (x, y) => f.sh(-0.78 + 0.4 * Math.min(1, Math.max(0, (y - chinY - 6) / 40))), { soft: 4 });
}

/** Стиль губ: полнота нарисованного края; блик нижней губы и ложбинка над верхней (метры лица). */
export interface LipMarks {
  full: number;
  /** Блик нижней губы: высота, полуширина и полуширина его коробки. */
  shine: readonly [number, number, number];
  /** Ложбинка над верхней губой: верх и низ мазка, верх и низ его коробки. */
  philtrum: readonly [number, number, number, number];
}

/**
 * Губы: верхняя — темнее (в тени), нижняя — светлее, с бликом; над верхней — светлый край и ложбинка; линия губ — тёмная, к
 * уголкам гуще и чуть вверх; за уголками — мягкая тень; под нижней — тёмный полумесяц.
 */
export function paintLips(f: FaceSheet, lip: RGB, s: LipMarks): void {
  const { img, head, sh } = f;
  const outer = head.mouthRim(false).map((p) => f.signed(p));
  const line = head.mouthRim(true).map((p) => f.signed(p));
  const N = LIP_N;
  const upperLip = [...outer.slice(0, N + 2), ...line.slice(1, N + 1).reverse()];
  const lowerLip = [line[0], ...line.slice(N + 2).reverse(), line[N + 1], ...outer.slice(N + 2)];
  const lipBox = { ...boxOf(outer, 10), x0: 0 };
  const lineY = f.yOf(head.MOUTH.line);
  img.shape(poly(upperLip), lipBox, (x, y) => mix(tone(lip, -0.36), tone(lip, -0.08), Math.min(1, (lineY - y) / 12)), { soft: 1.6 + s.full });
  img.shape(poly(lowerLip), lipBox, (x, y) => mix(tone(lip, 0.1), tone(lip, -0.22), Math.min(1, (y - lineY) / 20)), { soft: 1.6 + s.full });
  // Блик нижней губы — один мазок посередине (через ось), не две точки.
  const shine = f.P(0, s.shine[0]);
  img.shape(ellipse(shine[0], shine[1], f.RX(s.shine[1]), f.RY(0.0017)), { ...around(shine[0], shine[1], f.RX(s.shine[2]), f.RY(0.005)), x0: 0 }, tone(lip, 0.75), { soft: 3.5, alpha: 0.55 });
  const bow = head
    .mouthRim(false)
    .slice(1, N + 1)
    .map(([th, h]) => f.signed([th, h + 0.0016]));
  img.shape(stroke(spline(bow), 2.4), { ...boxOf(bow, 6), x0: 0 }, sh(0.5), { soft: 2.5, alpha: 0.7 });
  const [p0, p1, b0, b1] = s.philtrum;
  img.shape(stroke([f.P(0, p0), f.P(0, p1)], f.RX(0.0034)), boxOf([f.P(0, b0), f.P(0.008, b1)], 4), sh(-0.2), { soft: 4, alpha: 0.4 });
  // Линия губ — тёмная, к уголкам гуще и чуть вверх (дальше уголка мазок не идёт: там узкие грани края губ).
  const lineR = line.slice((N + 1) / 2, N + 2);
  const corner = line[N + 1];
  const lift: [number, number] = [corner[0] - f.RX(0.0006), corner[1] - f.RY(0.0011)];
  img.shape(stroke(spline([[-lineR[1][0], lineR[1][1]], ...lineR.slice(0, lineR.length - 1), lift]), (t) => 1.2 + 1.6 * t * t), { ...boxOf([...lineR, lift], 6), x0: 0 }, tone(lip, -0.75), { soft: 1.6 });
  // Уголки — чуть вверх мягкой тенью улыбки за уголком.
  const smileC: [number, number][] = [
    [corner[0] + f.RX(0.0012), corner[1] + f.RY(0.0006)],
    [corner[0] + f.RX(0.0032), corner[1] - f.RY(0.0012)],
    [corner[0] + f.RX(0.0038), corner[1] - f.RY(0.0034)],
  ];
  img.shape(stroke(spline(smileC, 4), (t) => 2.6 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 0.5), boxOf(smileC, 6), sh(-0.42), { soft: 3, alpha: 0.55 });
  const under = head
    .mouthRim(false)
    .slice(N + 2)
    .map(([th, h]) => f.signed([th, h - 0.0034]));
  img.shape(stroke(spline(under), (t) => f.RY(0.0034) * Math.sin(Math.PI * t)), { ...boxOf(under, 10), x0: 0 }, sh(-0.62), { soft: 5, alpha: 0.85 });
}

/** Стиль век: толщина линии ресниц, «стрелка» за внешним углом. */
export interface LidMarks {
  lash: number;
  wing: number;
  /** Ресницы — мазками к внешнему углу: сколько (по умолчанию три). */
  lashes?: number;
}

/**
 * Веко: тени над разрезом (к внешнему углу гуще), складка, толстая линия верхнего века, ресницы мазками к внешнему углу
 * (не волосками: на расстоянии покоев волоски — паутина), нижняя линия и светлый край под ней, розовый внутренний угол.
 */
export function paintEyelids(f: FaceSheet, lid: RGB, lash: RGB, rose: RGB, s: LidMarks): void {
  const { img, head, sh } = f;
  const rim = head.eyeRim(1).map(([th, h]) => head.facePx(th, h));
  const top = rim.slice(0, 6);
  const bottom = [rim[5], ...rim.slice(6), rim[0]];
  const lift2 = (pts: [number, number][], m: number): [number, number][] => pts.map(([x, y], i) => [x + (i - 2.5) * 0.6, y - f.RY(m) * Math.sin((Math.PI * (i + 0.6)) / (pts.length + 0.2))]);
  const lidZone = [...top, ...lift2(top, 0.0068).reverse()];
  img.shape(poly(lidZone), boxOf(lidZone, 12), (x, y) => mix(mix(lid, sh(-0.75), 0.45), flesh(lid, -0.6), Math.max(0, Math.min(1, (x - top[0][0]) / (top[5][0] - top[0][0])))), { soft: 6, alpha: 0.95 });
  img.shape(stroke(spline(lift2(top, 0.0058)), (t) => 3 * Math.sin(Math.PI * Math.min(1, t * 1.05))), boxOf(lift2(top, 0.006), 6), flesh(lid, -0.7), { soft: 3, alpha: 0.75 });
  const outerC = rim[5];
  const wingTip: [number, number] = [outerC[0] + f.RX(s.wing * 0.25), outerC[1] - f.RY(s.wing * 0.2)];
  const lashLine = spline([...top, wingTip], 5);
  img.shape(stroke(lashLine, (t) => (3.2 + 5.6 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.08)) * s.lash) * (t > 0.9 ? (1 - t) * 10 : 1)), boxOf(lashLine, 10), lash, { soft: 1.5 });
  for (let i = 0; i < (s.lashes ?? 3); i++) {
    const k = 0.6 + i * 0.13;
    const at = lashLine[Math.min(lashLine.length - 1, Math.round(k * (lashLine.length - 1)))];
    const len = (4 + i * 1.6) * s.lash;
    const ang = -1.05 + i * 0.22;
    const end: [number, number] = [at[0] + Math.cos(ang) * len * 0.9 + 2, at[1] + Math.sin(ang) * len];
    const mid: [number, number] = [(at[0] + end[0]) / 2 + 2, (at[1] + end[1]) / 2 + 1];
    img.shape(stroke(spline([at, mid, end], 4), (t) => 3.4 * (1 - t) ** 1.2 + 0.4), boxOf([at, end], 5), lash, { soft: 1.2, alpha: 0.95 });
  }
  img.shape(stroke(spline(bottom.slice(0, 5)), (t) => 2.4 * (1 - t) + 0.6), boxOf(bottom, 6), mix(lash, sh(-0.6), 0.4), { soft: 1.5, alpha: 0.85 });
  img.shape(stroke(spline(bottom.slice(0, 5).map(([x, y]) => [x, y + f.RY(0.0026)] as [number, number])), 3.5), boxOf(bottom, 10), sh(-0.36), { soft: 4, alpha: 0.55 });
  const inner = rim[0];
  img.shape(circle(inner[0] + 2, inner[1], 4), around(inner[0], inner[1], 8), mix(rose, sh(-0.2), 0.3), { soft: 3, alpha: 0.55 });
}

/** Брови: надбровная дуга светом (`ridge`, три точки) и сама бровь (`pts`, пять точек), толщина у начала, сид волосков. */
export interface BrowMarks {
  ridge: readonly FacePt[];
  pts: readonly FacePt[];
  thick: number;
  /** Сколько волосков штрихами и их сид. */
  hairs?: number;
  seed?: number;
  /** Сужение к хвосту: доля толщины у конца (у супруги 0,5). */
  taper?: number;
}

/** Брови: сильные, темнее волос; над бровью — светлая полоса надбровной дуги; волоски — штрихами. */
export function paintBrows(f: FaceSheet, brow: RGB, s: BrowMarks): void {
  const { img, sh } = f;
  const ridge = spline(
    s.ridge.map(([x, h]) => f.P(x, h)),
    5,
  );
  img.shape(stroke(ridge, (t) => f.RY(0.005) * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05))), boxOf(ridge, 10), sh(0.5), { soft: 6, alpha: 0.55 });
  const browPts = spline(
    s.pts.map(([x, h]) => f.P(x, h)),
    6,
  );
  const taper = s.taper ?? 0.5;
  const bw = (t: number): number => f.RX(s.thick) * (1.08 - taper * t ** 1.3) * (1 - 0.45 * t ** 3) + 1.2;
  img.shape(stroke(browPts, bw), boxOf(browPts, 12), brow, { soft: 2, alpha: 0.95 });
  const hr = rng(s.seed ?? 19);
  const n = s.hairs ?? 30;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const at = browPts[Math.round(t * (browPts.length - 1))];
    const w = bw(t);
    const off = (hr() - 0.5) * w * 0.7;
    const a = -0.45 + t * 0.8;
    const p0: [number, number] = [at[0] - 3, at[1] + off];
    const p1: [number, number] = [at[0] + Math.cos(a) * 7, at[1] + off + Math.sin(a) * 4];
    img.shape(stroke([p0, p1], 1.1), boxOf([p0, p1], 3), hr() > 0.5 ? tone(brow, -0.4) : tone(brow, 0.3), { soft: 1, alpha: 0.45 });
  }
}

/**
 * Мазок, а не аэрограф: крупные тёплые и прохладные пятна (`big` — доли по каналам: красный, зелёный, синий с минусом) и
 * мелкое зерно (`fine`) — на несколько процентов.
 */
export function grain(f: FaceSheet, seed = 83, big: readonly [number, number, number] = [0.08, 0.03, 0.04], fine = 0.045): void {
  const { img, face } = f;
  const g = noise(seed);
  img.shape((x, y) => -1, face, (x, y) => {
    const c = img.get(Math.min(FACE_PX - 1, x | 0), Math.min(FACE_PX - 1, y | 0));
    const b = g(x * 0.025, y * 0.025) - 0.5;
    const n = g(x * 0.3 + 40, y * 0.3) - 0.5;
    return [c[0] * (1 + b * big[0] + n * fine), c[1] * (1 + b * big[1] + n * fine), c[2] * (1 - b * big[2] + n * fine)];
  });
}

/** Лист белка: тёплый белок с тенью по краям, радужка с тёмным ободком и светлым низом, зрачок, два блика. */
export function paintEyeball(img: Img, head: Head, iris0: number, skin0: number, irisR = 0.0086): void {
  const s = EYE_SHEET;
  const iris = hex(iris0);
  const box = { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
  // Белок — не белее лица: тёплый, приглушённый (иначе глаза спорят с кожей за свет).
  const white: RGB = mix(hex(0xd8cabe), hex(skin0), 0.28);
  img.fill(white, box);
  const cx = s.x + s.w / 2;
  // Середина радужки чуть выше середины разреза — касается верхнего века.
  const cy = s.y + s.h / 2 - ((0.02 * head.BALL.r) / s.m) * s.w;
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
  const ir = irisR * px;
  // Радужка: тёмный ободок, к низу светлее (свет снизу отражён), лучи волокон, кольцо у зрачка.
  img.shape(
    circle(cx, cy, ir),
    around(cx, cy, ir + 2),
    (x, y) => {
      const dy = (y - cy) / ir;
      const r = Math.hypot(x - cx, y - cy) / ir;
      let c = mix(tone(iris, -0.6), tone(iris, 0.4), Math.max(0, Math.min(1, 0.45 + dy * 0.55)));
      c = mix(c, tone(iris, -0.8), Math.max(0, (r - 0.78) / 0.22) ** 1.2);
      const a = Math.atan2(y - cy, x - cx);
      const fib = 0.5 + 0.5 * Math.sin(a * 23 + Math.sin(a * 7) * 2);
      c = mix(c, tone(c, 0.4), fib * 0.25 * Math.max(0, 1 - Math.abs(r - 0.55) / 0.35));
      return c;
    },
    { soft: 1.4 },
  );
  img.shape(circle(cx, cy, ir * 0.48), around(cx, cy, ir * 0.6), tone(iris, 0.25), { soft: 3, alpha: 0.35 });
  // Тень верхнего века на белке и радужке — широкая мягкая полоса сверху.
  img.shape((x, y) => y - (cy - ir * 0.45), box, tone(white, -0.7), { soft: ir * 0.9, alpha: 0.7 });
  img.shape(circle(cx, cy, ir * 0.36), around(cx, cy, ir * 0.4), hex(0x0c0a0c), { soft: 1.2 });
  // Блик — сверху слева (окно) и слабый снизу справа.
  img.shape(circle(cx - ir * 0.36, cy - ir * 0.4, ir * 0.2), around(cx - ir * 0.36, cy - ir * 0.4, ir * 0.3), hex(0xfffcf4), { soft: 1.2 });
  img.shape(circle(cx + ir * 0.32, cy + ir * 0.36, ir * 0.09), around(cx + ir * 0.32, cy + ir * 0.36, ir * 0.15), hex(0xf4f0ea), { soft: 1, alpha: 0.7 });
}

/** Лист века (закрытый глаз): кожа века в тенях, край — толстая тёмная линия с ресницами вниз. */
export function paintLid(img: Img, skin: RGB, lid: RGB, lash: RGB): void {
  const s = LID_SHEET;
  const box = { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
  img.shape((x, y) => -1, box, (x, y) => mix(tone(skin, 0.05), lid, Math.min(1, (y - s.y) / (s.h * 0.8))));
  const edge = s.y + s.h - 4;
  img.shape((x, y) => Math.abs(y - edge) - 3.2, { x0: s.x, y0: edge - 6, x1: s.x + s.w, y1: edge + 6 }, lash, { soft: 1.4 });
  for (let i = 0; i < 16; i++) {
    const x = s.x + 22 + i * 5.6;
    img.shape(
      stroke(
        [
          [x, edge],
          [x + 2.5, edge + 4],
        ],
        1.2,
      ),
      { x0: x - 3, y0: edge - 2, x1: x + 6, y1: s.y + s.h },
      lash,
      { soft: 1 },
    );
  }
}

/** Лист рта: тёмное нутро, у верха — край верхних зубов. */
export function paintMouth(img: Img, lip: RGB): void {
  const s = MOUTH_SHEET;
  const box = { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h };
  img.shape((x, y) => -1, box, (x, y) => mix(tone(lip, -0.7), tone(lip, -0.9), (y - s.y) / s.h));
  img.shape((x, y) => Math.abs(y - (s.y + 9)) - 3.5 + 0.0004 * (x - s.x - s.w / 2) ** 2, box, hex(0xd8cfc2), { soft: 2.5, alpha: 0.9 });
}
