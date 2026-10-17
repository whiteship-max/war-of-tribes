// Формы снаряжения бойцов около 1200 года (docs/polish.md, П-5): щиты, шлемы, подол сюрко, клинки, лук, арбалет, флажок,
// попона. Примитивы фигуры (`figures.PARTS`) — семь коробок и конусов на всех: ими рисует пул посёлка и меряет обмер
// силуэта; форма — то, во что запекание ролика (`reel/bake.ts`) превращает деталь вместо примитива. Деталь остаётся
// своим примитивом для пула и обмера (`Slot.part`), а форма (`Slot.shape`) — лишь точнее рисует то же место.
//
// Все формы — в единичном пространстве, как примитивы: размер детали — масштаб слота, и место, поворот и сустав у формы
// те же, что у примитива. Условия у каждой формы свои и написаны у неё.
//
// Уровни детализации (`Detail`): 2 — вблизи (боец крупнее `crowd.NEAR_PX`), 1 — средний (прежние примитивы), 0 — вдали
// (меньше `crowd.LOD_PX`: грубее по кругу, без мелочи). Подматериал вершины (`SUB`) — что красить: свой цвет детали,
// поле герба (текстура щита), железо, тёмное (прорезь шлема, тетива), дерево.
//
// ЗДЕСЬ ТОЛЬКО ГЕОМЕТРИЯ: без цвета, без сцены и без кадра — и без случая: форма одна на вид, разброс в строю — шейдер толпы.
import * as THREE from 'three';

export type Detail = 0 | 1 | 2;

export type Shape =
  | 'kite'
  | 'heater'
  | 'round'
  | 'nasal'
  | 'spangen'
  | 'kettle'
  | 'great'
  | 'hood'
  | 'felt'
  | 'hair'
  | 'beard'
  | 'skirt'
  | 'leaf'
  | 'blade'
  | 'axe'
  | 'club'
  | 'bow'
  | 'crossbow'
  | 'pennon'
  | 'caparison'
  | 'hoof'
  | 'chest';

/**
 * Чем деталь отличается у бойцов одного вида (разброс в строю, шейдер толпы `reel/crowd.ts`): кожа, волосы, крашеная
 * шерсть (шоссы, капюшон), кожа ремней, железо, масть коня и его грива. `fixed` — у всех одна краска.
 */
export type Mat = 'fixed' | 'skin' | 'hair' | 'hose' | 'leather' | 'metal' | 'horse' | 'mane';
export const MAT_INDEX: Record<Mat, number> = { fixed: 0, skin: 1, hair: 2, hose: 3, leather: 4, metal: 5, horse: 6, mane: 7 };

/** Подматериал вершины формы. */
export const SUB = { own: 0, coat: 1, iron: 2, dark: 3, wood: 4 } as const;
export type Sub = (typeof SUB)[keyof typeof SUB];

/** Сборщик геометрии: вершины с подматериалом и местом на гербе (`uv`; −1 — не герб). */
class Build {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly sub: number[] = [];
  readonly idx: number[] = [];

  v(x: number, y: number, z: number, sub: Sub = SUB.own, u = -1, w = -1): number {
    this.pos.push(x, y, z);
    this.uv.push(u, w);
    this.sub.push(sub);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('sub', new THREE.Float32BufferAttribute(this.sub, 1));
    g.setIndex(this.idx);
    // Грани у толпы плоские (`flatShading`), нормали вершин — для порядка: их крутит тот же сустав.
    g.computeVertexNormals();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------
// Тела вращения: кольца снизу вверх, сечение — эллипс (`depth` — доля глубины к ширине).

interface Ring {
  y: number;
  r: number;
  /** Сдвиг кольца вперёд (+z): капюшон с хвостом назад, шлем с выносом над лбом. */
  dz?: number;
  sub?: Sub;
}

interface LatheOpts {
  seg: number;
  depth?: number;
  /** Закрыть низ и верх. */
  capBottom?: boolean;
  capTop?: boolean;
  /** Пропустить грани спереди (лицо в капюшоне): от кольца `from` до кольца `to`, в пределах ±`half` рад от +z. */
  gap?: { from: number; to: number; half: number };
  /** Подматериал граней спереди между кольцами (прорезь топхелма): кольцо `ring`, в пределах ±`half` рад. */
  band?: { ring: number; half: number; sub: Sub };
}

function lathe(b: Build, rings: readonly Ring[], o: LatheOpts): void {
  const seg = o.seg;
  const depth = o.depth ?? 1;
  // Первая грань — плоско вперёд, как у примитивов (`figures.FLAT6`): у шлема лоб, а не ребро.
  const start = Math.PI / seg;
  const ids: number[][] = [];
  rings.forEach((r) => {
    const row: number[] = [];
    for (let s = 0; s < seg; s++) {
      const a = start + (s / seg) * Math.PI * 2;
      row.push(b.v(Math.sin(a) * r.r, r.y, Math.cos(a) * r.r * depth + (r.dz ?? 0), r.sub ?? SUB.own));
    }
    ids.push(row);
  });
  for (let k = 0; k + 1 < rings.length; k++) {
    if (rings[k].r === 0 && rings[k + 1].r === 0) continue;
    for (let s = 0; s < seg; s++) {
      const mid = start + ((s + 0.5) / seg) * Math.PI * 2;
      const front = Math.abs(Math.atan2(Math.sin(mid), Math.cos(mid)));
      if (o.gap && k >= o.gap.from && k < o.gap.to && front < o.gap.half) continue;
      const a = ids[k][s];
      const c = ids[k][(s + 1) % seg];
      const d = ids[k + 1][(s + 1) % seg];
      const e = ids[k + 1][s];
      if (o.band && k === o.band.ring && front < o.band.half) {
        // Прорезь — своими вершинами, иначе тёмное растеклось бы по соседним граням.
        const sub = o.band.sub;
        const p = (i: number): [number, number, number] => [b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]];
        const [a2, c2, d2, e2] = [a, c, d, e].map((i) => b.v(...p(i), sub));
        b.quad(a2, c2, d2, e2);
        continue;
      }
      // Обход против часовой снаружи: грань смотрит наружу (задние грани толпа не рисует).
      b.quad(a, c, d, e);
    }
  }
  if (o.capBottom && rings[0].r > 0) {
    const c = b.v(0, rings[0].y, rings[0].dz ?? 0, rings[0].sub ?? SUB.own);
    for (let s = 0; s < seg; s++) b.tri(c, ids[0][(s + 1) % seg], ids[0][s]);
  }
  const last = rings.length - 1;
  if (o.capTop && rings[last].r > 0) {
    const c = b.v(0, rings[last].y, rings[last].dz ?? 0, rings[last].sub ?? SUB.own);
    for (let s = 0; s < seg; s++) b.tri(c, ids[last][s], ids[last][(s + 1) % seg]);
  }
}

/** Коробка по углам. */
function box(b: Build, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, sub: Sub = SUB.own): void {
  const p = [
    b.v(x0, y0, z0, sub), b.v(x1, y0, z0, sub), b.v(x1, y1, z0, sub), b.v(x0, y1, z0, sub),
    b.v(x0, y0, z1, sub), b.v(x1, y0, z1, sub), b.v(x1, y1, z1, sub), b.v(x0, y1, z1, sub),
  ];
  b.quad(p[4], p[5], p[6], p[7]);
  b.quad(p[1], p[0], p[3], p[2]);
  b.quad(p[5], p[1], p[2], p[6]);
  b.quad(p[0], p[4], p[7], p[3]);
  b.quad(p[7], p[6], p[2], p[3]);
  b.quad(p[0], p[1], p[5], p[4]);
}

// ---------------------------------------------------------------------------------------------
// Щиты: x, y — от −0.5 до 0.5 (вверх — +y), лицо — к +z. Щит выгнут поперёк: края позади середины, толщина — доля
// глубины слота. Поле герба (`SUB.coat`) — внутри обода, обод — цвет детали (цвет стороны): сторона читается и у
// щита с гербом в чужих красках.

type P2 = [number, number];

/** Обвод щита по кругу против часовой (смотря с лица), выпуклый. */
export function shieldOutline(shape: 'kite' | 'heater' | 'round', detail: Detail): P2[] {
  const out: P2[] = [];
  if (shape === 'round') {
    const n = detail === 2 ? 14 : detail === 1 ? 8 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 2;
      out.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5]);
    }
    return out;
  }
  if (shape === 'kite') {
    // Миндалевидный (норманнский): верх — полуэллипс, бока сходятся к острию внизу.
    const arc = detail === 2 ? 8 : detail === 1 ? 4 : 2;
    for (let i = 0; i <= arc; i++) {
      const a = (i / arc) * Math.PI;
      out.push([Math.cos(a) * 0.5, 0.22 + Math.sin(a) * 0.28]);
    }
    const side: P2[] = detail === 0 ? [] : detail === 1 ? [[-0.4, -0.18]] : [[-0.48, 0.02], [-0.4, -0.18], [-0.24, -0.37]];
    out.push(...side, [0, -0.5]);
    out.push(...side.slice().reverse().map(([x, y]) => [-x, y] as P2));
    return out;
  }
  // Треугольный (heater): ровный верх, прямые бока до середины, дуги к острию.
  const top: P2[] = [[0.5, 0.5], [-0.5, 0.5]];
  const side: P2[] = detail === 2 ? [[-0.5, 0.08], [-0.44, -0.14], [-0.32, -0.33], [-0.16, -0.46]] : detail === 1 ? [[-0.5, 0.05], [-0.34, -0.3]] : [[-0.5, 0.0]];
  out.push(...top, ...side, [0, -0.5], ...side.slice().reverse().map(([x, y]) => [-x, y] as P2));
  return out;
}

/** Насколько выгнут щит: лицо в середине — на +0.5, у края — ниже на столько. */
const BULGE = 0.6;
/** Толщина доски — доля глубины слота. */
const BOARD = 0.4;
/** Обод — доля от середины к краю. */
const RIM = 0.14;

function shield(b: Build, shape: 'kite' | 'heater' | 'round', detail: Detail): void {
  const outline = shieldOutline(shape, detail);
  const front = (x: number, y: number): number =>
    shape === 'round' ? 0.5 - BULGE * 4 * (x * x + y * y) : 0.5 - BULGE * (2 * x) * (2 * x);
  // Поле герба у круглого — середина клетки по высоте: клетка герба выше ширины (`paint.ARMS_ASPECT`).
  const coatUv = (x: number, y: number): [number, number] => (shape === 'round' ? [x + 0.5, 0.5 + y / 1.2] : [x + 0.5, y + 0.5]);
  const cx = 0;
  const cy = shape === 'kite' ? 0.08 : shape === 'heater' ? 0.08 : 0;
  const n = outline.length;
  const rim = detail > 0;
  const inner = outline.map(([x, y]) => (rim ? ([cx + (x - cx) * (1 - RIM), cy + (y - cy) * (1 - RIM)] as P2) : ([x, y] as P2)));
  // Лицо: поле герба веером от середины.
  const coatSub = detail === 0 ? SUB.own : SUB.coat;
  const mid = b.v(cx, cy, front(cx, cy), coatSub, ...coatUv(cx, cy));
  const face = inner.map(([x, y]) => b.v(x, y, front(x, y), coatSub, ...coatUv(x, y)));
  for (let i = 0; i < n; i++) b.tri(mid, face[i], face[(i + 1) % n]);
  // Обод: чуть над полем, цвет детали.
  const lip = 0.06;
  const outer = outline.map(([x, y]) => b.v(x, y, front(x, y) + (rim ? lip : 0)));
  if (rim) {
    const rimIn = inner.map(([x, y]) => b.v(x, y, front(x, y) + lip));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      b.quad(rimIn[i], outer[i], outer[j], rimIn[j]);
      if (detail === 2) {
        // Ступенька от поля к ободу — та же краска; вблизи, дальше её не видно.
        const fi = b.v(inner[i][0], inner[i][1], front(inner[i][0], inner[i][1]));
        const fj = b.v(inner[j][0], inner[j][1], front(inner[j][0], inner[j][1]));
        b.quad(fi, rimIn[i], rimIn[j], fj);
      }
    }
  }
  // Изнанка и торец.
  const back = outline.map(([x, y]) => b.v(x, y, front(x, y) - BOARD));
  const bm = b.v(cx, cy, front(cx, cy) - BOARD);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.tri(bm, back[j], back[i]);
    b.quad(outer[i], back[i], back[j], outer[j]);
  }
  // Умбон круглого щита — железный конус посередине.
  if (shape === 'round' && detail > 0) {
    const from = b.pos.length / 3;
    const boss: Ring[] =
      detail === 2
        ? [
            { y: 0, r: 0.13, sub: SUB.iron },
            { y: 0.2, r: 0.1, sub: SUB.iron },
            { y: 0.3, r: 0, sub: SUB.iron },
          ]
        : [
            { y: 0, r: 0.12, sub: SUB.iron },
            { y: 0.26, r: 0, sub: SUB.iron },
          ];
    lathe(b, boss, { seg: detail === 2 ? 8 : 5 });
    // Тело вращения растёт вдоль +y: повернуть к +z и поставить на лицо.
    const k = b.pos.length / 3;
    for (let i = from; i < k; i++) {
      const y = b.pos[i * 3 + 1];
      const z = b.pos[i * 3 + 2];
      b.pos[i * 3 + 1] = -z;
      b.pos[i * 3 + 2] = 0.5 + y;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Головные уборы: основание — кольцо радиусом 0.5 на y = 0, верх — y = 1, как у примитива `cap`. Лоб — к +z.

/** Профиль убора: радиус на высоте y — для проверки, что голова закрыта (`units.test.ts`). */
export const HEAD_RINGS: Partial<Record<Shape, readonly Ring[]>> = {
  // Конический шлем с наносником (норманнский): обод, конус к острию.
  nasal: [
    { y: 0, r: 0.53 },
    { y: 0.12, r: 0.53 },
    { y: 0.12, r: 0.5 },
    { y: 0.55, r: 0.3 },
    { y: 1, r: 0 },
  ],
  // Сегментный округлый (spangenhelm): купол.
  spangen: [
    { y: 0, r: 0.53 },
    { y: 0.1, r: 0.53 },
    { y: 0.1, r: 0.5 },
    { y: 0.45, r: 0.47 },
    { y: 0.75, r: 0.34 },
    { y: 0.93, r: 0.15 },
    { y: 1, r: 0 },
  ],
  // Шапель (chapel de fer): невысокий купол; поля — отдельно.
  kettle: [
    { y: 0, r: 0.5 },
    { y: 0.45, r: 0.47 },
    { y: 0.78, r: 0.33 },
    { y: 0.95, r: 0.14 },
    { y: 1, r: 0 },
  ],
  // Топхелм около 1200 года: цилиндр от подбородка, плоская макушка; прорезь для глаз на трети сверху.
  great: [
    { y: 0, r: 0.56 },
    { y: 0.58, r: 0.56 },
    { y: 0.66, r: 0.56 },
    { y: 0.94, r: 0.53 },
    { y: 1, r: 0.36 },
  ],
  // Валяная шапка с подвёрнутым краем.
  felt: [
    { y: 0, r: 0.54 },
    { y: 0.16, r: 0.57 },
    { y: 0.18, r: 0.5 },
    { y: 0.5, r: 0.45 },
    { y: 0.85, r: 0.22 },
    { y: 0.9, r: 0 },
  ],
  // Волосы: низкий купол над макушкой и затылком.
  hair: [
    { y: 0, r: 0.53 },
    { y: 0.4, r: 0.49 },
    { y: 0.72, r: 0.32 },
    { y: 0.84, r: 0 },
  ],
  // Капюшон с оплечьем: широкий низ на плечах, лицо открыто, хвост-кончик назад.
  hood: [
    { y: -0.55, r: 0.98 },
    { y: -0.2, r: 0.62 },
    { y: 0.15, r: 0.55 },
    { y: 0.55, r: 0.5 },
    { y: 0.85, r: 0.34, dz: -0.08 },
    { y: 1.08, r: 0, dz: -0.3 },
  ],
};

/** Глубина сечения убора к ширине (эллипс): у топхелма и капюшона лицо площе боков. */
export const HEAD_DEPTH: Partial<Record<Shape, number>> = { great: 1, hood: 0.82 };

/** Радиус убора на высоте `y` (в его единицах): по кольцам профиля; формы без профиля — конус примитива. */
export function headRadiusAt(shape: Shape | undefined, y: number): number {
  const rings = shape ? HEAD_RINGS[shape] : undefined;
  if (!rings) return y <= 1 ? (1 - y) * 0.5 : 0;
  if (y < rings[0].y) return 0;
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i];
    const c = rings[i + 1];
    if (y >= a.y && y <= c.y) return c.y === a.y ? Math.max(a.r, c.r) : a.r + ((c.r - a.r) * (y - a.y)) / (c.y - a.y);
  }
  return 0;
}

/** Кольца профиля на среднем облике — меньше колец, тот же силуэт (номера в `HEAD_RINGS`). */
const MID_RINGS: Partial<Record<Shape, readonly number[]>> = {
  nasal: [0, 2, 4],
  spangen: [0, 2, 4, 6],
  kettle: [0, 2, 4],
  felt: [0, 3, 5],
  hair: [0, 2, 3],
};

function headwear(b: Build, shape: Shape, detail: Detail): void {
  const seg = detail === 2 ? 10 : detail === 1 ? 6 : 4;
  const all = HEAD_RINGS[shape]!;
  const mid = MID_RINGS[shape];
  const rings = detail === 1 && mid ? mid.map((k) => all[k]) : all;
  if (shape === 'great') {
    // Прорезь — тёмная полоса спереди между вторым и третьим кольцом; крестовина — железная полоса вниз от прорези.
    lathe(b, detail === 0 ? [rings[0], rings[3], rings[4]] : rings, {
      seg: detail === 2 ? 10 : detail === 1 ? 8 : 4,
      depth: HEAD_DEPTH.great,
      capTop: true,
      band: detail === 0 ? undefined : { ring: 1, half: 1.15, sub: SUB.dark },
    });
    if (detail > 0) box(b, -0.05, 0.05, 0.08, 0.58, 0.5, 0.58, SUB.dark);
    return;
  }
  if (shape === 'hood') {
    lathe(b, rings, { seg, depth: HEAD_DEPTH.hood, gap: detail === 0 ? undefined : { from: 1, to: 3, half: 0.75 } });
    return;
  }
  lathe(b, detail === 0 && rings.length > 4 ? [rings[0], rings[Math.floor(rings.length / 2)], rings[rings.length - 1]] : rings, {
    seg,
    capBottom: false,
  });
  if (shape === 'nasal' || shape === 'spangen') {
    // Наносник: железная пластина от обода вниз по переносице.
    if (detail > 0) box(b, -0.07, 0.07, -0.55, 0.12, 0.44, 0.56, SUB.iron);
  }
  if (shape === 'kettle' && detail > 0) {
    // Поля шапели: кольцо вокруг купола, к краю чуть вниз.
    const n = seg;
    const inner: number[] = [];
    const outer: number[] = [];
    const innerB: number[] = [];
    const outerB: number[] = [];
    for (let s = 0; s < n; s++) {
      const a = Math.PI / n + (s / n) * Math.PI * 2;
      inner.push(b.v(Math.sin(a) * 0.5, 0.06, Math.cos(a) * 0.5));
      outer.push(b.v(Math.sin(a) * 0.86, -0.06, Math.cos(a) * 0.86));
      innerB.push(b.v(Math.sin(a) * 0.5, 0.02, Math.cos(a) * 0.5));
      outerB.push(b.v(Math.sin(a) * 0.86, -0.1, Math.cos(a) * 0.86));
    }
    for (let s = 0; s < n; s++) {
      const t = (s + 1) % n;
      b.quad(inner[s], outer[s], outer[t], inner[t]);
      b.quad(innerB[t], outerB[t], outerB[s], innerB[s]);
      b.quad(outer[s], outerB[s], outerB[t], outer[t]);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Прочее.

/** Борода: клин под подбородком. x, y, z — от −0.5 до 0.5, вниз — к острию, вперёд — +z. */
function beard(b: Build): void {
  const t = [b.v(-0.5, 0.5, 0.1), b.v(0.5, 0.5, 0.1), b.v(0.5, 0.5, -0.5), b.v(-0.5, 0.5, -0.5)];
  const m = [b.v(-0.42, -0.05, 0.5), b.v(0.42, -0.05, 0.5), b.v(0.42, -0.05, -0.3), b.v(-0.42, -0.05, -0.3)];
  const tip = b.v(0, -0.5, 0.2);
  b.quad(t[0], m[0], m[1], t[1]);
  b.quad(t[1], m[1], m[2], t[2]);
  b.quad(t[3], m[3], m[0], t[0]);
  b.quad(t[2], m[2], m[3], t[3]);
  b.tri(m[0], tip, m[1]);
  b.tri(m[1], tip, m[2]);
  b.tri(m[2], tip, m[3]);
  b.tri(m[3], tip, m[0]);
}

/**
 * Подол сюрко или кольчуги: как примитив корпуса (`body`: конец y = 1 шире), но открытый; слот переворачивает его, как подол
 * горожанки (`units.dressVillager`), и подол расширяется книзу.
 */
function skirt(b: Build, detail: Detail): void {
  const seg = detail === 2 ? 10 : detail === 1 ? 6 : 4;
  // Слот переворачивает форму (поворот на π вокруг x): y = 0 ложится к поясу, y = 1 — к подолу, и подол шире пояса.
  lathe(b, [{ y: 0, r: 0.42 }, { y: 0.55, r: 0.47 }, { y: 1, r: 0.5 }], { seg, depth: 0.85 });
}

/** Наконечник копья — лист: ромб в сечении, к острию. y 0..1, ширина по x, толщина по z. */
function leaf(b: Build): void {
  const base = b.v(0, 0, 0, SUB.iron);
  const tip = b.v(0, 1, 0, SUB.iron);
  const l = b.v(-0.5, 0.32, 0, SUB.iron);
  const r = b.v(0.5, 0.32, 0, SUB.iron);
  const f = b.v(0, 0.32, 0.5, SUB.iron);
  const k = b.v(0, 0.32, -0.5, SUB.iron);
  for (const [a, c] of [[l, f], [f, r], [r, k], [k, l]] as const) {
    b.tri(base, c, a);
    b.tri(tip, a, c);
  }
}

/** Клинок меча: ромб в сечении, к острию; y −0.5…0.5 (как коробка-примитив), остриё — вверху. */
function blade(b: Build): void {
  const ring = (y: number, w: number): number[] => [b.v(-w, y, 0, SUB.iron), b.v(0, y, 0.5, SUB.iron), b.v(w, y, 0, SUB.iron), b.v(0, y, -0.5, SUB.iron)];
  const r0 = ring(-0.5, 0.5);
  const r1 = ring(0.36, 0.42);
  const tip = b.v(0, 0.5, 0, SUB.iron);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    b.quad(r0[i], r0[j], r1[j], r1[i]);
    b.tri(r1[i], r1[j], tip);
  }
  b.quad(r0[3], r0[2], r0[1], r0[0]);
}

/**
 * Секира с бородой (датский топор): вид сбоку в плоскости xy, обух у x = −0.5, лезвие к +x, борода вниз; толщина по z,
 * к лезвию тоньше.
 */
function axe(b: Build, detail: Detail): void {
  const pts: P2[] =
    detail === 0
      ? [[-0.5, 0.15], [0.5, 0.48], [0.5, -0.5], [-0.5, -0.15]]
      : [[-0.5, 0.16], [-0.18, 0.18], [0.18, 0.36], [0.5, 0.5], [0.56, 0.16], [0.56, -0.18], [0.46, -0.5], [0.12, -0.3], [-0.18, -0.18], [-0.5, -0.16]];
  const zOf = (x: number): number => 0.5 - 0.38 * Math.max(0, (x + 0.2) / 0.76);
  const c = b.v(-0.2, 0, zOf(-0.2), SUB.iron);
  const f = pts.map(([x, y]) => b.v(x, y, zOf(x), SUB.iron));
  const k = pts.map(([x, y]) => b.v(x, y, -zOf(x), SUB.iron));
  const cb = b.v(-0.2, 0, -zOf(-0.2), SUB.iron);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.tri(c, f[j], f[i]);
    b.tri(cb, k[i], k[j]);
    b.quad(f[i], f[j], k[j], k[i]);
  }
}

/** Дубина: толстеет к концу, с наплывом; y 0..1. */
function club(b: Build, detail: Detail): void {
  lathe(
    b,
    [
      { y: 0, r: 0.3 },
      { y: 0.5, r: 0.4 },
      { y: 0.8, r: 0.5 },
      { y: 0.94, r: 0.42 },
      { y: 1, r: 0 },
    ],
    { seg: detail === 2 ? 7 : 5, capBottom: true },
  );
}

/**
 * Лук: дуга в плоскости xy (выгиб — к +x, вперёд от стрелка), y −0.5…0.5 — от нижнего плеча к верхнему; тетива — прямая
 * между концами (тёмная). Толщина по z.
 */
function bow(b: Build, detail: Detail): void {
  const n = detail === 2 ? 8 : detail === 1 ? 5 : 3;
  const w = 0.5;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n - 0.5;
    // Плечи выгнуты сильнее у концов (рекурв), рукоять прямее.
    pts.push([0.5 - 2 * s * s * 0.9, s]);
  }
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    // Плечо лука — тонкое (около трёх сантиметров на слоте ширины выгиба), у рукояти толще.
    const t = i === 0 || i === n - 1 ? 0.045 : 0.07;
    const a = [b.v(x0 - t, y0, -w), b.v(x0 + t, y0, -w), b.v(x0 + t, y0, w), b.v(x0 - t, y0, w)];
    const c = [b.v(x1 - t, y1, -w), b.v(x1 + t, y1, -w), b.v(x1 + t, y1, w), b.v(x1 - t, y1, w)];
    for (let k = 0; k < 4; k++) b.quad(a[k], c[k], c[(k + 1) % 4], a[(k + 1) % 4]);
  }
  if (detail > 0) {
    // Тетива.
    const [xa, ya] = pts[0];
    const [xb, yb] = pts[n];
    const s = [b.v(xa - 0.04, ya, 0, SUB.dark), b.v(xa + 0.04, ya, 0, SUB.dark), b.v(xb + 0.04, yb, 0, SUB.dark), b.v(xb - 0.04, yb, 0, SUB.dark)];
    b.quad(s[0], s[1], s[2], s[3]);
    b.quad(s[3], s[2], s[1], s[0]);
  }
}

/**
 * Арбалет: ложе вдоль +y (−0.5 — приклад, 0.5 — нос), дуга поперёк по x у носа, стремя впереди. x −0.5…0.5, z — толщина.
 * Строится от 0 до 1 и сдвигается к середине, как коробка-примитив.
 */
function crossbow(b: Build, detail: Detail): void {
  const from = b.pos.length / 3;
  crossbowRaw(b, detail);
  for (let i = from; i < b.pos.length / 3; i++) b.pos[i * 3 + 1] -= 0.5;
}

function crossbowRaw(b: Build, detail: Detail): void {
  box(b, -0.06, 0.06, 0, 0.92, -0.08, 0.08, SUB.wood);
  // Дуга: железная, чуть вперёд к концам.
  const n = detail === 2 ? 4 : 2;
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const x0 = (s * i * 0.5) / n;
      const x1 = (s * (i + 1) * 0.5) / n;
      const y0 = 0.86 + 0.08 * Math.pow((i * 0.5) / n / 0.5, 2) * -1;
      const y1 = 0.86 + 0.08 * Math.pow(((i + 1) * 0.5) / n / 0.5, 2) * -1;
      box(b, Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1) - 0.02, Math.max(y0, y1) + 0.02, -0.04, 0.04, SUB.iron);
    }
  }
  if (detail > 0) {
    // Тетива — к замку на ложе, и стремя на носу.
    box(b, -0.46, 0.46, 0.76, 0.78, -0.01, 0.01, SUB.dark);
    box(b, -0.08, 0.08, 0.92, 1.0, -0.02, 0.02, SUB.iron);
  }
}

/** Флажок копья: треугольник от древка (x = −0.5) к концу (+0.5), y −0.5…0.5; две стороны. */
function pennon(b: Build): void {
  const a = b.v(-0.5, 0.5, 0);
  const c = b.v(-0.5, -0.5, 0);
  const tip = b.v(0.5, 0.05, 0);
  b.tri(a, c, tip);
  b.tri(a, tip, c);
}

/**
 * Попона латного коня: ткань с боков и спереди, от спины до колен; на боках — поле герба. Единицы — как у коробки бочки:
 * x — ширина, y — высота (0 — низ, 1 — спина; строится так и сдвигается к середине, как коробка-примитив), z — длина
 * (−0.5 — круп, 0.5 — грудь).
 */
function caparison(b: Build, detail: Detail): void {
  const from = b.pos.length / 3;
  caparisonRaw(b, detail);
  for (let i = from; i < b.pos.length / 3; i++) b.pos[i * 3 + 1] -= 0.5;
}

function caparisonRaw(b: Build, detail: Detail): void {
  // Сечение поперёк коня (половина, сверху вниз): у хребта уже, у бочки шире, к подолу — чуть расклёшено. Полотнище тянется
  // вдоль коня от груди к крупу полосами; спереди и сзади открыто — ноги и грудь коня видны. Поле герба — на средних
  // полосах боков, от холки бочки до подола.
  const half: P2[] = detail === 0 ? [[0.32, 1], [0.5, 0.62], [0.52, 0]] : [[0.3, 1], [0.48, 0.82], [0.53, 0.55], [0.52, 0.22], [0.55, 0]];
  const n = detail === 2 ? 6 : detail === 1 ? 4 : 2;
  const coatAt = (k: number): boolean => detail > 0 && k >= 1 && k <= half.length - 2;
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const z0 = -0.5 + i / n;
      const z1 = -0.5 + (i + 1) / n;
      const mid = i >= Math.floor(n / 4) && i < Math.ceil((3 * n) / 4);
      for (let k = 0; k + 1 < half.length; k++) {
        const coat = mid && coatAt(k) && coatAt(k + 1);
        const sub = coat ? SUB.coat : SUB.own;
        // `u` — вдоль коня (от груди к крупу у правого бока), `v` — по высоте поля: герб стоит, а не лежит.
        const uv = (z: number, y: number): [number, number] => (coat ? [(s > 0 ? 0.25 - z : z + 0.25) * 2, (y - half[half.length - 2][1]) / (half[1][1] - half[half.length - 2][1])] : [-1, -1]);
        const [xa, ya] = half[k];
        const [xb, yb] = half[k + 1];
        const q = [b.v(s * xa, ya, z0, sub, ...uv(z0, ya)), b.v(s * xa, ya, z1, sub, ...uv(z1, ya)), b.v(s * xb, yb, z1, sub, ...uv(z1, yb)), b.v(s * xb, yb, z0, sub, ...uv(z0, yb))];
        if (s > 0) b.quad(q[0], q[1], q[2], q[3]);
        else b.quad(q[0], q[3], q[2], q[1]);
      }
    }
  }
  // Хребет: полоса поверх спины между верхними краями боков.
  const [xt, yt] = half[0];
  const t = [b.v(-xt, yt, -0.5), b.v(xt, yt, -0.5), b.v(xt, yt, 0.5), b.v(-xt, yt, 0.5)];
  b.quad(t[3], t[2], t[1], t[0]);
}

/** Грудь сюрко: коробка, лицевая сторона (+z) — поле герба. x, y, z — от −0.5 до 0.5. */
function chest(b: Build, detail: Detail): void {
  box(b, -0.5, 0.5, -0.5, 0.5, -0.5, 0.45);
  const sub = detail === 0 ? SUB.own : SUB.coat;
  const q = [b.v(-0.5, -0.5, 0.5, sub, 0, 0), b.v(0.5, -0.5, 0.5, sub, 1, 0), b.v(0.5, 0.5, 0.5, sub, 1, 1), b.v(-0.5, 0.5, 0.5, sub, 0, 1)];
  b.quad(q[0], q[1], q[2], q[3]);
}

/** Копыто: тёмная коробка у конца ноги, чуть шире ноги. Единицы — как у примитива `limb` (висит вниз от сустава). */
function hoof(b: Build): void {
  box(b, -0.5, 0.5, -1, -0.82, -0.55, 0.62, SUB.dark);
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Геометрия формы на уровне детализации. Новая на каждый вызов (зовущий её крутит и отпускает). */
export function shapeGeometry(shape: Shape, detail: Detail): THREE.BufferGeometry {
  const key = `${shape}:${detail}`;
  let g = cache.get(key);
  if (!g) {
    const b = new Build();
    switch (shape) {
      case 'kite':
      case 'heater':
      case 'round':
        shield(b, shape, detail);
        break;
      case 'nasal':
      case 'spangen':
      case 'kettle':
      case 'great':
      case 'hood':
      case 'felt':
      case 'hair':
        headwear(b, shape, detail);
        break;
      case 'beard':
        beard(b);
        break;
      case 'skirt':
        skirt(b, detail);
        break;
      case 'leaf':
        leaf(b);
        break;
      case 'blade':
        blade(b);
        break;
      case 'axe':
        axe(b, detail);
        break;
      case 'club':
        club(b, detail);
        break;
      case 'bow':
        bow(b, detail);
        break;
      case 'crossbow':
        crossbow(b, detail);
        break;
      case 'pennon':
        pennon(b);
        break;
      case 'caparison':
        caparison(b, detail);
        break;
      case 'hoof':
        hoof(b);
        break;
      case 'chest':
        chest(b, detail);
        break;
    }
    g = b.geometry();
    cache.set(key, g);
  }
  return g.clone();
}
