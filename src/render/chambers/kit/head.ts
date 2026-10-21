// Голова набора персонажа (ЛЦ-3, docs/characters.md; вынесено из супруги ЛЦ-2): маска лица — сетка рядов и столбцов по
// поверхности головы, и в ней три дыры, заполненные петлями: две у глаз (прямоугольник сетки → глазница → край века) и
// одна у рта (прямоугольник → край губ → линия губ). За краем века — белок (сдвиг его UV — взгляд) и верхнее веко (кость
// `lids` — моргание), за губами — тёмный рот; нижняя половина рта и подбородок — на кости `jaw`. Нос и скулы — тенью на
// текстуре, геометрия под ними — только мягкий бугор носа и скулы в силуэте.
//
// Чьё лицо — решают таблицы облика головы (`HeadSpec`): ширина и глубина по высоте, бугры, разрез глаз, рот, овал. Сетка,
// петли и лист лица — общие: так супруга и гонец — один стиль, а лица разные.
//
// Координаты лица — (θ, h): θ — угол по кругу головы от середины лица (+ — левая щека фигуры, ось +x), h — высота над
// низом подбородка, м. Текстура лица кладётся по этим же координатам (`facePx`): половина лица — от середины (край листа,
// зеркало) к виску, длина по поверхности — метрами, поэтому нарисованное ложится без растяжки.
import type { V3 } from '../../city/geom';
import type { SkinMesh, Weights } from './skin';

/** Таблица «высота над подбородком → величина»: между узлами — плавно. */
export type Table = readonly (readonly [number, number])[];

/** Глаз: середина (метры по ряду, высота), полуширина, верх и низ века, подъём внешнего угла и внутреннего. */
export interface EyeSpec {
  x: number;
  h: number;
  half: number;
  up: number;
  down: number;
  tilt: number;
  inner: number;
}

/** Рот: полуширина, линия губ, верх верхней губы, лук Купидона и низ нижней. */
export interface MouthSpec {
  half: number;
  line: number;
  top: number;
  bow: number;
  bottom: number;
}

/** Облик головы: чертёжные меры, таблицы формы и черты, которые строятся (то, что рисуется, — у листа лица). */
export interface HeadSpec {
  /** Низ подбородка над полом и ось головы (середина сечения) по глубине, м. */
  chinY: number;
  hz: number;
  /** Высота линии волос над низом подбородка. */
  topH: number;
  /** Ряды маски (h) и столбцы (метры от середины лица по ряду глаз): петли глаз и рта стоят в прямоугольниках сетки. */
  rows: readonly number[];
  colsM: readonly number[];
  /** Полуширина (`aT`) и глубина (`fT`) головы по высоте над подбородком. */
  aT: Table;
  fT: Table;
  /** Подъём линии челюсти к уху: низ маски у середины — подбородок, у виска — угол челюсти. */
  rise(th: number): number;
  /** Мягкие бугры: нос, надбровье, щёки (`front` — вперёд), скулы (`out` — наружу). */
  relief(th: number, h: number): { front: number; out: number };
  /** Ниже рта лицо короче рядов (`chinUp`): подбородок и от рта до низа. */
  chinUp(h: number): number;
  /** Овал лица: полуширина по ряду h, метры по поверхности от середины. */
  faceOval(h: number): number;
  eye: EyeSpec;
  mouth: MouthSpec;
  /** Белок — сплюснутый эллипсоид: полуось по x, радиус сечения; веко и край — снаружи на зазор. */
  ball: { rx: number; r: number; lid: number; rim: number };
  /** Подъём уголков губ, м: у линии губ и у края губ. */
  cornerUp: number;
  rimUp: number;
  /** Губы вперёд у середины: верхняя, нижняя. */
  lipFront: { upper: number; lower: number };
  /** Шея под челюстью (чертёжные меры): радиус и середина по глубине верхнего кольца шеи, на сколько ряд ниже подбородка. */
  neck: { r: number; zc: number; drop: number };
  /** Где кончается челюсть: ниже `jaw[0]` — целиком на ней, до `jaw[1]` — долей 0,3. */
  jaw: readonly [number, number];
}

// ---------- Лист лица: раскладка общая ----------

/** Лист лица: половина лица — x 0…376 (от зеркала), y 8…504; справа столбец 384…512 — белок, веко, рот, ухо. */
export const FACE_PX = 512;
export const FACE_U_M = 0.165;
export const FACE_V_M = 0.315;
export const U_PX = 376;
const V0 = 8;
const V_PX = 496;
/** Листы глаза, века и рта в точках листа лица; `m` — сколько метров на всю ширину листа (128 точек). */
export const EYE_SHEET = { x: 384, y: 0, w: 128, h: 128, m: 0.06 } as const;
export const LID_SHEET = { x: 384, y: 136, w: 128, h: 64, m: 0.06 } as const;
export const MOUTH_SHEET = { x: 384, y: 208, w: 128, h: 48, m: 0.064 } as const;
/** Сдвиг UV белка на метр взгляда. */
export const GAZE_UV = EYE_SHEET.w / EYE_SHEET.m / FACE_PX;

/**
 * Дыры: глаз — столбцы 1…4, ряды 7…9 (2 клетки по высоте); рот — столбцы −3…3, ряды 2…4. Столбцы — углы, заданные по ряду
 * глаз, а к подбородку лицо уже: рту нужно шесть клеток, чтобы уголки губ встали внутри кольца сетки.
 */
const EYE_COLS = [1, 4] as const;
const EYE_ROWS = [7, 9] as const;
const MOUTH_COLS = [-3, 3] as const;
/** Точки края губ на верхней и нижней половине — доли полуширины рта (столько же, сколько узлов на ряду дыры). */
const LIP_K = [-0.9, -0.62, -0.32, 0, 0.32, 0.62, 0.9] as const;
export const LIP_N = LIP_K.length;
const MOUTH_ROWS = [2, 4] as const;
/** Край открытого века над разрезом, рад. */
const LID_EDGE = 0.1;

export function table(t: Table, x: number): number {
  if (x <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++)
    if (x <= t[i][0]) {
      const k = (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
      const s = k * k * (3 - 2 * k);
      return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * s;
    }
  return t[t.length - 1][1];
}

export const smooth = (a: number, b: number, x: number): number => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
export const bell = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));
const spow = (v: number, p: number): number => Math.sign(v) * Math.abs(v) ** p;
const uvOf = (px: [number, number]): [number, number] => [px[0] / FACE_PX, px[1] / FACE_PX];

/** Петли разреза: от кольца сетки к краю века — середина между ними (глазница, чуть вглубь). */
function midLoop(a: readonly [number, number][], b: readonly [number, number][], k: number): [number, number][] {
  return a.map((p, i) => [p[0] + (b[i][0] - p[0]) * k, p[1] + (b[i][1] - p[1]) * k]);
}

/** Голова по облику: поверхность, лист лица, петли и сборка маски. */
export class Head {
  readonly CHIN_Y: number;
  readonly HZ: number;
  readonly TOP_H: number;
  readonly ROWS: readonly number[];
  readonly EYE: EyeSpec;
  readonly MOUTH: MouthSpec;
  readonly BALL: HeadSpec['ball'];

  constructor(readonly spec: HeadSpec) {
    this.CHIN_Y = spec.chinY;
    this.HZ = spec.hz;
    this.TOP_H = spec.topH;
    this.ROWS = spec.rows;
    this.EYE = spec.eye;
    this.MOUTH = spec.mouth;
    this.BALL = spec.ball;
  }

  // ---------- Поверхность ----------

  /** Точка поверхности головы в позе покоя (оси фигуры). */
  surf(th: number, h: number): V3 {
    const sp = this.spec;
    const r = sp.rise(th) * Math.max(0, 1 - h / 0.1);
    const he = h + r;
    const a = table(sp.aT, he);
    const rel = sp.relief(th, h);
    const f = table(sp.fT, h) + rel.front;
    const s = Math.sin(th);
    const c = Math.cos(th);
    return [a * spow(s, 0.8) + rel.out * s, sp.chinY + sp.chinUp(he), sp.hz + f * spow(c, 0.8) + rel.out * c];
  }

  /** Высота точки лица над полом по высоте h над подбородком (без подъёма челюсти). */
  faceHeight(h: number): number {
    return this.spec.chinY + this.spec.chinUp(h);
  }

  /** Овал лица: по нему лист лица рисует границу кожи, и по нему же ложатся пряди у щёк. */
  faceOval(h: number): number {
    return this.spec.faceOval(h);
  }

  /** Длина по ряду h от середины лица до θ, м. */
  arcAt(h: number, th: number): number {
    const n = 48;
    let len = 0;
    let prev = this.surf(0, h);
    const a = Math.abs(th);
    for (let i = 1; i <= n; i++) {
      const p = this.surf((a * i) / n, h);
      len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      prev = p;
    }
    return len;
  }

  /** Угол по ряду h, на котором до середины лица `m` метров (обратное к `arcAt`). */
  thetaAt(h: number, m: number): number {
    const want = Math.abs(m);
    let lo = 0;
    let hi = 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.arcAt(h, mid) < want) lo = mid;
      else hi = mid;
    }
    return Math.sign(m) * ((lo + hi) / 2);
  }

  /** Длина по середине лица от линии волос вниз до высоты h, м (вертикаль листа лица). */
  private vArc(h: number): number {
    const n = 40;
    const top = this.spec.topH;
    let len = 0;
    let prev = this.surf(0, top);
    for (let i = 1; i <= n; i++) {
      const p = this.surf(0, top + ((h - top) * i) / n);
      len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      prev = p;
    }
    return len;
  }

  /** Точка листа лица (в точках, y — вниз) по координатам лица. */
  facePx(th: number, h: number, under = 0): [number, number] {
    return [(this.arcAt(h, Math.abs(th)) / FACE_U_M) * U_PX, V0 + ((this.vArc(h) + under) / FACE_V_M) * V_PX];
  }

  // ---------- Петли ----------

  /** Столбцы маски — углы (по ряду глаз), обе стороны. */
  columns(): number[] {
    const right = this.spec.colsM.map((m) => this.thetaAt(this.EYE.h, m));
    return [...right.slice(1).reverse().map((t) => -t), ...right];
  }

  /** Край века правого (+x) глаза: 10 точек (θ, h) — внутренний угол, верх от носа к виску, внешний угол, низ обратно. */
  eyeRim(side: 1 | -1): [number, number][] {
    const E = this.EYE;
    const pts: [number, number][] = [];
    const at = (k: number, top: boolean): [number, number] => {
      const xm = E.x + k * E.half;
      const lift = E.inner + (E.tilt - E.inner) * (k * 0.5 + 0.5);
      const env = Math.pow(Math.max(0, 1 - k * k), top ? 0.62 : 0.85);
      // Верх века выше к внешней трети (миндаль), низ — глубже у середины.
      const skew = top ? 1 + 0.12 * k : 1 - 0.08 * k;
      const h = E.h + lift + (top ? E.up : -E.down) * env * skew;
      return [side * this.thetaAt(h, xm), h];
    };
    pts.push(at(-1, true));
    for (const k of [-0.62, -0.2, 0.22, 0.62]) pts.push(at(k, true));
    pts.push(at(1, true));
    for (const k of [0.62, 0.22, -0.2, -0.62]) pts.push(at(k, false));
    return pts;
  }

  /** Край губ (вермилион): 16 точек — левый угол, верх (7), правый угол, низ (7); `line` — линия губ теми же точками. */
  mouthRim(line: boolean): [number, number][] {
    const M = this.MOUTH;
    const xs = LIP_K;
    const pts: [number, number][] = [];
    const th = (h: number, m: number): number => this.thetaAt(h, m);
    // Линия губ — уже края губ: её уголки и точки — внутри вермилиона. Подъём уголков у линии губ — заметный, у края губ
    // — меньше: край выше узла сетки у угла вывернул бы треугольник между ними (тест «нет вывернутых граней лица»).
    const w = M.half * (line ? 0.8 : 1);
    const up = line ? this.spec.cornerUp : this.spec.rimUp;
    const corner = (s: number): [number, number] => [th(M.line + up, s * w), M.line + up];
    const smile = (k: number): number => M.line - 0.0004 * (1 - k * k) + this.spec.cornerUp * k ** 4;
    const upper = (k: number): number => {
      if (line) return smile(k);
      // Лук Купидона: две вершины у середины, ложбинка между ними.
      const bow = M.bow * (bell(k, -0.28, 0.2) + bell(k, 0.28, 0.2)) - 0.0005 * bell(k, 0, 0.12);
      return M.line + (M.top - M.line) * Math.pow(1 - k * k, 0.55) + bow;
    };
    const lower = (k: number): number => (line ? smile(k) : M.line - (M.line - M.bottom) * Math.pow(1 - k * k, 0.7));
    pts.push(corner(-1));
    for (const k of xs) pts.push([th(upper(k), k * w), upper(k)]);
    pts.push(corner(1));
    for (const k of [...xs].reverse()) pts.push([th(lower(k), k * w), lower(k)]);
    return pts;
  }

  /** Середина белка (оси фигуры) для глаза стороны `side`. */
  eyeCenter(side: 1 | -1): V3 {
    const th = this.thetaAt(this.EYE.h, this.EYE.x);
    const p = this.surf(side * th, this.EYE.h);
    return [p[0], p[1], p[2] - (this.BALL.r + 0.0042)];
  }

  /** Радиус сечения эллипсоида белка (с зазором `gap`) на расстоянии x от середины по оси. */
  private rho(x: number, gap: number): number {
    return (this.BALL.r + gap) * Math.sqrt(Math.max(0, 1 - (x / (this.BALL.rx + gap)) ** 2));
  }

  /** Точка на эллипсоиде (с зазором) по смещению x и углу ε вверх от взгляда вперёд. */
  private shell(c: V3, x: number, e: number, gap: number): V3 {
    const r = this.rho(x, gap);
    return [c[0] + x, c[1] + r * Math.sin(e), c[2] + r * Math.cos(e)];
  }

  /** Края разреза глаза по углу: выше всего и ниже всего (по краю века). */
  eyeSpan(): { top: number; bottom: number } {
    const c = this.eyeCenter(1);
    let top = -9;
    let bottom = 9;
    for (const [th, h] of this.eyeRim(1)) {
      const e = elev(c, this.surf(th, h));
      top = Math.max(top, e);
      bottom = Math.min(bottom, e);
    }
    return { top, bottom };
  }

  /** Веко закрыто — на сколько радиан поворачивается кость `lids`. */
  lidClose(): number {
    const s = this.eyeSpan();
    return s.top + LID_EDGE - (s.bottom - 0.07);
  }

  // ---------- Сборка ----------

  /** Вес вершины маски: подбородок и нижняя губа — на челюсти, остальное — голова. */
  private faceWeight(th: number, h: number): Weights {
    const back = 1 - smooth(0.7, 1.45, Math.abs(th));
    const w = (h <= this.spec.jaw[0] ? 1 : h <= this.spec.jaw[1] ? 0.3 : 0) * back;
    return w > 0.01 ? ['jaw', 'head', w] : 'head';
  }

  /**
   * Собрать голову: маска лица, петли глаз и рта, белки, веки, рот и полоса под челюстью к шее; возвращает число граней.
   */
  build(m: SkinMesh): number {
    const { ROWS, EYE, MOUTH, BALL, HZ } = this;
    const from = m.triangles;
    const cols = this.columns();
    const mid = cols.length >> 1;
    const inside = (p: V3): V3 => [0, p[1], HZ - 0.02];
    // Узлы сетки: пропуск — внутри дыры.
    const inHole = (ci: number, ri: number, cs: readonly [number, number], rs: readonly [number, number]): boolean => {
      const c = ci - mid;
      return c > cs[0] && c < cs[1] && ri > rs[0] && ri < rs[1];
    };
    const eyeHole = (ci: number, ri: number): boolean => {
      const c = Math.abs(ci - mid);
      return c > EYE_COLS[0] && c < EYE_COLS[1] && ri > EYE_ROWS[0] && ri < EYE_ROWS[1];
    };
    const node: number[][] = [];
    for (let ri = 0; ri < ROWS.length; ri++) {
      node.push([]);
      for (let ci = 0; ci < cols.length; ci++) {
        const th = cols[ci];
        const h = ROWS[ri];
        if (eyeHole(ci, ri) || inHole(ci, ri, MOUTH_COLS, MOUTH_ROWS)) {
          node[ri].push(-1);
          continue;
        }
        node[ri].push(m.v(this.surf(th, h), uvOf(this.facePx(th, h)), 1, this.faceWeight(th, h)));
      }
    }
    // Клетки сетки, кроме дыр.
    const cellIn = (ci: number, ri: number): boolean => {
      const c0 = ci - mid;
      const c1 = c0 + 1;
      const eyeRows = ri >= EYE_ROWS[0] && ri < EYE_ROWS[1];
      const eye = eyeRows && ((c0 >= EYE_COLS[0] && c1 <= EYE_COLS[1]) || (c0 >= -EYE_COLS[1] && c1 <= -EYE_COLS[0]));
      const mouth = c0 >= MOUTH_COLS[0] && c1 <= MOUTH_COLS[1] && ri >= MOUTH_ROWS[0] && ri < MOUTH_ROWS[1];
      return eye || mouth;
    };
    for (let ri = 0; ri + 1 < ROWS.length; ri++)
      for (let ci = 0; ci + 1 < cols.length; ci++) {
        if (cellIn(ci, ri)) continue;
        const a = node[ri][ci];
        const b = node[ri][ci + 1];
        const c = node[ri + 1][ci + 1];
        const d = node[ri + 1][ci];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue;
        m.quad(a, b, c, d, inside(m.at(a)));
      }

    // Глаза: ряды кольца — низ, середина, верх дыры.
    const [E0, E2] = EYE_ROWS;
    const E1 = E0 + 1;
    for (const side of [1, -1] as const) {
      const cOf = (k: number): number => mid + side * k;
      // Кольцо сетки вокруг дыры: внутренний середина, верх от носа к виску, внешний середина, низ обратно (10 узлов).
      const ring: number[] = [
        node[E1][cOf(1)],
        node[E2][cOf(1)],
        node[E2][cOf(2)],
        node[E2][cOf(3)],
        node[E2][cOf(4)],
        node[E1][cOf(4)],
        node[E0][cOf(4)],
        node[E0][cOf(3)],
        node[E0][cOf(2)],
        node[E0][cOf(1)],
      ];
      const ringP: [number, number][] = [
        [cols[cOf(1)], ROWS[E1]],
        [cols[cOf(1)], ROWS[E2]],
        [cols[cOf(2)], ROWS[E2]],
        [cols[cOf(3)], ROWS[E2]],
        [cols[cOf(4)], ROWS[E2]],
        [cols[cOf(4)], ROWS[E1]],
        [cols[cOf(4)], ROWS[E0]],
        [cols[cOf(3)], ROWS[E0]],
        [cols[cOf(2)], ROWS[E0]],
        [cols[cOf(1)], ROWS[E0]],
      ];
      const rim = this.eyeRim(side);
      const c = this.eyeCenter(side);
      // Глазница: между кольцом и краем века, чуть вглубь; верх — складка века.
      const socket = midLoop(ringP, rim, 0.52);
      const l1 = socket.map(([th, h], i) => {
        const p = this.surf(th, h);
        const top = i >= 1 && i <= 4 ? 1 : 0;
        return m.v([p[0], p[1], p[2] - 0.0046 + top * 0.0004], uvOf(this.facePx(th, h)), 1, 'head');
      });
      // Край века — на эллипсоиде снаружи белка.
      const l2 = rim.map(([th, h]) => {
        const p = this.surf(th, h);
        const x = p[0] - c[0];
        return m.v(this.shell(c, x, elev(c, p), BALL.rim), uvOf(this.facePx(th, h)), 1, 'head');
      });
      m.strip([ring, l1, l2], true, (p) => [p[0], p[1], p[2] - 0.05]);
      // Белок: 4 × 2 клетки по оси и углу, с запасом за края разреза — малым: у внешнего угла шар вышел бы из-под кожи.
      const span = this.eyeSpan();
      const XS = EYE.half + 0.0005;
      const xs = [-XS, -XS / 2, 0, XS / 2, XS];
      const es = [span.bottom - 0.2, (span.bottom + span.top) / 2 - 0.05, span.top + 0.2];
      const rows: number[][] = es.map((e, ri) =>
        xs.map((x) => {
          const sx = x * side;
          const px = EYE_SHEET.x + EYE_SHEET.w / 2 + (sx / EYE_SHEET.m) * EYE_SHEET.w;
          const py = EYE_SHEET.y + EYE_SHEET.h / 2 - ((e * BALL.r) / EYE_SHEET.m) * EYE_SHEET.w;
          // Верх белка в тени века.
          const end = Math.abs(x) === XS;
          const i = m.v(this.shell(c, sx * (end ? 0.94 : 1), e, end ? -0.0012 : 0), uvOf([px, py]), 1, 'head', ri === es.length - 1 ? 0.55 : ri === 1 ? 0.86 : 0.8);
          m.eye.push(i);
          return i;
        }),
      );
      m.strip(rows, false, (p) => [p[0], p[1], p[2] - 0.05]);
      // Верхнее веко: полоса над разрезом на своём эллипсоиде; закрывается поворотом кости `lids` на `lidClose`.
      const edge = span.top + LID_EDGE;
      const lidE = [edge, edge + 0.5, edge + 1.15];
      const lid = lidE.map((e, ri) =>
        xs.map((x) => {
          const sx = x * side;
          const px = LID_SHEET.x + LID_SHEET.w / 2 + (sx / LID_SHEET.m) * LID_SHEET.w;
          const py = LID_SHEET.y + LID_SHEET.h - 4 - (ri / (lidE.length - 1)) * (LID_SHEET.h - 8);
          // Края века у уголков — вглубь: у внешнего угла кожа лица близко к шару, и край века светлел бы из-под неё.
          return m.v(this.shell(c, sx * (Math.abs(x) === XS ? 0.9 : 1), e, Math.abs(x) === XS ? BALL.lid - 0.0016 : BALL.lid), uvOf([px, py]), 1, 'lids');
        }),
      );
      m.strip(lid, false, (p) => [p[0], p[1], p[2] - 0.05]);
    }

    // Рот: кольцо сетки → край губ → линия губ (верх — голова, низ — челюсть).
    const mo = (k: number): number => mid + k;
    const cs = [-3, -2, -1, 0, 1, 2, 3];
    const [M0, M2] = MOUTH_ROWS;
    const M1 = M0 + 1;
    const mRing = [node[M1][mo(-3)], ...cs.map((c) => node[M2][mo(c)]), node[M1][mo(3)], ...[...cs].reverse().map((c) => node[M0][mo(c)])];
    const lf = this.spec.lipFront;
    const lipFront = (k: number, i: number): number => {
      // Губы полнее у середины: верхняя чуть вперёд, нижняя — круглее.
      const upper = i >= 1 && i <= LIP_N;
      const lower = i >= LIP_N + 2;
      return upper ? lf.upper * (1 - k * k * 0.6) : lower ? lf.lower * (1 - k * k * 0.5) : 0.0004;
    };
    const rimW = (i: number): Weights => (i === 0 || i === LIP_N + 1 ? ['jaw', 'head', 0.5] : i > LIP_N + 1 ? 'jaw' : 'head');
    const kOf = (i: number): number => (i === 0 ? -1 : i === LIP_N + 1 ? 1 : i <= LIP_N ? LIP_K[i - 1] : LIP_K[LIP_N - 1 - (i - LIP_N - 2)]);
    const m1 = this.mouthRim(false).map(([th, h], i) => {
      const p = this.surf(th, h);
      const f = lipFront(kOf(i), i);
      return m.v([p[0], p[1], p[2] + f], uvOf(this.facePx(th, h)), 1, rimW(i));
    });
    const lineP = this.mouthRim(true);
    const m2 = lineP.map(([th, h], i) => {
      const p = this.surf(th, h);
      return m.v([p[0], p[1], p[2] + 0.0012], uvOf(this.facePx(th, h)), 1, rimW(i));
    });
    m.strip([mRing, m1, m2], true, (p) => [p[0] * 0.5, p[1], p[2] - 0.04]);
    // Нутро рта: тёмная чаша за губами (верхние зубы — светлее у верха листа).
    const back = this.surf(0, MOUTH.line)[2] - 0.0085;
    const mx = [-0.03, -0.015, 0, 0.015, 0.03];
    const my = [MOUTH.top + 0.002, MOUTH.bottom - 0.004];
    const cave = my.map((h, ri) =>
      mx.map((x) => {
        const px = MOUTH_SHEET.x + MOUTH_SHEET.w / 2 + (x / MOUTH_SHEET.m) * MOUTH_SHEET.w;
        const py = MOUTH_SHEET.y + (ri === 0 ? 4 : MOUTH_SHEET.h - 4);
        return m.v([x, this.faceHeight(h), back - 60 * x * x], uvOf([px, py]), 1, ri === 0 ? 'head' : ['jaw', 'head', 0.7], 0.8);
      }),
    );
    m.strip(cave, false, (p) => [p[0], p[1], p[2] - 0.05]);

    // Под челюстью — к шее: ряд под линией челюсти, заправлен в шею. Полого, почти назад и вдоль всей челюсти: отвесная
    // полоса была бы видна спереди тёмным «ошейником» и коробом у подбородка (ЛЦ-2, круги 10–11), а пологая — узкой
    // тенью под челюстью; ниже — сама шея (верхнее кольцо шеи фигуры — `spec.neck`).
    const nk = this.spec.neck;
    const underRow = cols.map((th) => {
      const p = this.surf(th, 0);
      const q: V3 = [nk.r * Math.sin(th), p[1] - nk.drop, nk.zc + nk.r * Math.cos(th)];
      const px = this.facePx(th, 0, 0.034);
      const w = this.faceWeight(th, 0);
      return m.v(q, uvOf(px), 1, typeof w === 'string' ? w : ['jaw', 'head', w[2] * 0.6], 0.9);
    });
    m.strip([node[0], underRow], false, (p) => [0, p[1] + 0.05, HZ]);
    return m.triangles - from;
  }
}

/** Угол ε точки относительно середины белка. */
const elev = (c: V3, p: V3): number => Math.atan2(p[1] - c[1], p[2] - c[2]);
