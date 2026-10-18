// Камень покоев (docs/city_v3.md, Г-5): стены — живая бутовая кладка с раствором, у проёмов, камина и в нишах окон —
// тёсаный камень. Две повторяющиеся плитки рисуются при входе в покои (в первую загрузку не едет ни байта): цвет — в RGB,
// рельеф — в альфе; шейдер покоев (`material.ts`) гнёт по рельефу нормаль, и огонь с солнцем ложатся на выпуклые камни и
// западают в швы. Прежняя побелка со «съеденными» пятнами бута (зубцы на снимках с телефона) — снята.
//
// Плитки повторяются без шва: ряды кладки укладываются в высоту плитки ровно, камни ряда — в ширину, края рисуются с
// переносом. Случайность — сеяная (`Math.random` в игре нет нигде).

/** Сколько метров стены покрывает плитка: бут — 2,4 м, тёсаный — 1,8 м (`geo.tileOf`). */
export const MASONRY_M = 2.4;
export const DRESSED_M = 1.8;

function bone(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/** Камень плитки: прямоугольник места в ряду (точки), тон и насколько выпуклый. */
interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: [number, number, number];
  bulge: number;
}

/** Ряды кладки: высоты рядов (в метрах — от и до), длины камней; швы — ширина раствора, м. */
interface Course {
  rowMin: number;
  rowMax: number;
  lenMin: number;
  lenMax: number;
  joint: number;
  /** Неровность края камня, доля его меньшей стороны (бут — 0,16; тёсаный — 0,025). */
  rough: number;
  /** Округлость углов, доля меньшей стороны. */
  round: number;
}

const MASONRY: Course = { rowMin: 0.17, rowMax: 0.31, lenMin: 0.22, lenMax: 0.62, joint: 0.022, rough: 0.16, round: 0.32 };
const DRESSED: Course = { rowMin: 0.3, rowMax: 0.3, lenMin: 0.42, lenMax: 0.78, joint: 0.009, rough: 0.025, round: 0.06 };

/** Тона камня: серый известняк, охристый песчаник, тёплый серо-бурый — краска холста (sRGB). */
const TONES: readonly [number, number, number][] = [
  [150, 141, 128],
  [168, 152, 126],
  [134, 126, 116],
  [176, 162, 140],
  [124, 112, 98],
  [158, 146, 132],
];

function layout(px: number, metres: number, c: Course, r: () => number): Block[] {
  const k = px / metres;
  const rows: number[] = [];
  let y = 0;
  while (y < metres - 1e-6) {
    let h = c.rowMin + r() * (c.rowMax - c.rowMin);
    if (metres - y - h < c.rowMin) h = metres - y;
    rows.push(h);
    y += h;
  }
  const blocks: Block[] = [];
  let yy = 0;
  for (const h of rows) {
    let x = r() * c.lenMax;
    const start = x;
    while (x < start + metres - 1e-6) {
      let w = c.lenMin + r() * (c.lenMax - c.lenMin);
      if (start + metres - x - w < c.lenMin) w = start + metres - x;
      const t = TONES[Math.floor(r() * TONES.length)];
      const j = 0.88 + r() * 0.2;
      blocks.push({ x: x * k, y: yy * k, w: w * k, h: h * k, tone: [t[0] * j, t[1] * j, t[2] * j], bulge: 0.55 + r() * 0.45 });
      x += w;
    }
    yy += h;
  }
  return blocks;
}

/** Контур камня: скруглённый прямоугольник с неровным краем — точками по кругу. */
function outline(b: Block, c: Course, jointPx: number, r: () => number): [number, number][] {
  const x0 = b.x + jointPx / 2;
  const y0 = b.y + jointPx / 2;
  const w = b.w - jointPx;
  const h = b.h - jointPx;
  const s = Math.min(w, h);
  const rad = s * c.round;
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [
    [x0 + w - rad, y0 + rad, -Math.PI / 2],
    [x0 + w - rad, y0 + h - rad, 0],
    [x0 + rad, y0 + h - rad, Math.PI / 2],
    [x0 + rad, y0 + rad, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= 3; i++) {
      const a = a0 + (i / 3) * (Math.PI / 2);
      const jit = 1 + (r() - 0.5) * c.rough * 2;
      pts.push([cx + Math.cos(a) * rad * jit + (r() - 0.5) * s * c.rough * 0.5, cy + Math.sin(a) * rad * jit + (r() - 0.5) * s * c.rough * 0.5]);
    }
  }
  return pts;
}

/**
 * Плитка кладки: RGBA, сторона `px` (кратна 8); RGB — цвет (sRGB), A — рельеф (0 — глубина шва, 255 — самая выпуклая
 * точка камня). Без страницы (тесты в узле) — `null`.
 */
export function paintStone(kind: 'masonry' | 'dressed', px: number, seed = 1207): Uint8Array<ArrayBuffer> | null {
  if (typeof document === 'undefined') return null;
  const c = kind === 'masonry' ? MASONRY : DRESSED;
  const metres = kind === 'masonry' ? MASONRY_M : DRESSED_M;
  const r = bone(seed + (kind === 'masonry' ? 0 : 77));
  const col = document.createElement('canvas');
  const hgt = document.createElement('canvas');
  col.width = col.height = hgt.width = hgt.height = px;
  const cc = col.getContext('2d');
  const hc = hgt.getContext('2d');
  if (!cc || !hc) return null;
  const k = px / metres;
  // Раствор: известь с песком — светлее камня, тёплая.
  cc.fillStyle = kind === 'masonry' ? 'rgb(176,164,142)' : 'rgb(170,160,140)';
  cc.fillRect(0, 0, px, px);
  hc.fillStyle = 'rgb(40,40,40)';
  hc.fillRect(0, 0, px, px);
  const blocks = layout(px, metres, c, r);
  const jointPx = c.joint * k;
  for (const b of blocks) {
    const pts = outline(b, c, jointPx * (0.8 + r() * 0.5), r);
    for (const dx of [-px, 0, px])
      for (const dy of [-px, 0, px]) {
        if (b.x + dx > px || b.x + b.w + dx < 0 || b.y + dy > px || b.y + b.h + dy < 0) continue;
        const path = new Path2D();
        pts.forEach(([x, y], i) => (i ? path.lineTo(x + dx, y + dy) : path.moveTo(x + dx, y + dy)));
        path.closePath();
        cc.fillStyle = `rgb(${b.tone.map((v) => Math.round(v)).join(',')})`;
        cc.fill(path);
        // Рельеф: бут — подушкой (середина выше краёв), тёсаный — плоско, с фаской по краю.
        const cx = b.x + b.w / 2 + dx;
        const cy = b.y + b.h / 2 + dy;
        const g = hc.createRadialGradient(cx, cy, 0, cx, cy, Math.max(b.w, b.h) * 0.62);
        const top = Math.round(150 + 105 * b.bulge);
        if (kind === 'masonry') {
          g.addColorStop(0, `rgb(${top},${top},${top})`);
          g.addColorStop(0.55, `rgb(${top - 30},${top - 30},${top - 30})`);
          g.addColorStop(1, 'rgb(95,95,95)');
        } else {
          g.addColorStop(0, 'rgb(225,225,225)');
          g.addColorStop(0.8, 'rgb(215,215,215)');
          g.addColorStop(1, 'rgb(150,150,150)');
        }
        hc.fillStyle = g;
        hc.fill(path);
        // Тень по нижнему краю и свет по верхнему — камень читается и без огня.
        cc.save();
        cc.clip(path);
        const lg = cc.createLinearGradient(0, b.y + dy, 0, b.y + b.h + dy);
        lg.addColorStop(0, 'rgba(255,248,232,0.10)');
        lg.addColorStop(0.5, 'rgba(0,0,0,0)');
        lg.addColorStop(1, 'rgba(30,20,10,0.22)');
        cc.fillStyle = lg;
        cc.fillRect(b.x + dx, b.y + dy, b.w, b.h);
        // Пятна: известь, копоть, прожилки.
        for (let i = 0; i < 4; i++) {
          cc.fillStyle = r() < 0.5 ? `rgba(255,245,225,${0.05 + r() * 0.06})` : `rgba(40,30,20,${0.05 + r() * 0.08})`;
          cc.beginPath();
          cc.ellipse(b.x + dx + r() * b.w, b.y + dy + r() * b.h, b.w * (0.1 + r() * 0.2), b.h * (0.1 + r() * 0.2), r() * 3, 0, Math.PI * 2);
          cc.fill();
        }
        cc.restore();
      }
  }
  const a = cc.getImageData(0, 0, px, px).data;
  const h = hc.getImageData(0, 0, px, px).data;
  const out = new Uint8Array(px * px * 4);
  // Зерно поверхности: плавная сеяная рябь (сетка через 8 точек, сглаженная) — ноздреватость бута и следы кирки; мелкая
  // россыпь поверх — слабая: вблизи камень не «шумит».
  const nr = bone(seed + 5);
  const G = px / 8;
  const grid = new Float32Array(G * G);
  for (let i = 0; i < grid.length; i++) grid[i] = nr() - 0.5;
  const at = (gx: number, gy: number): number => grid[(((gy % G) + G) % G) * G + (((gx % G) + G) % G)];
  const amp = kind === 'masonry' ? 0.14 : 0.07;
  const hamp = kind === 'masonry' ? 46 : 26;
  for (let y = 0; y < px; y++) {
    const fy = y / 8;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < px; x++) {
      const i = (y * px + x) * 4;
      const fx = x / 8;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a0 = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const a1 = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      const n = a0 + (a1 - a0) * sy + (nr() - 0.5) * 0.12;
      const lit = 1 + n * amp;
      out[i] = Math.min(255, a[i] * lit);
      out[i + 1] = Math.min(255, a[i + 1] * lit);
      out[i + 2] = Math.min(255, a[i + 2] * lit);
      out[i + 3] = Math.max(0, Math.min(255, h[i] + n * hamp));
    }
  }
  return out;
}
