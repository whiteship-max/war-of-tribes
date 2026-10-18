// Атлас покоев (docs/city_v3.md, Г-4): всё, что в комнате нарисовано, а не сложено из слоёв камня и дерева, — гобелены с
// гербом державы (П-2, `heraldry/paint`), щит, ковёр, медвежья шкура, пергаменты стола (карта, письма, указы, книга
// людей, перечень войска, планы), шахматная доска, покрывало. Один холст, одна текстура, рисуется при входе в покои: в
// первую загрузку и в кусок города не едет ни байта.
//
// Случайность — сеяная (`Math.random` в игре нет нигде): узор у всех одинаковый, герб — свой.
import { paintArms, paintField } from '@/heraldry/paint';
import type { Arms } from '@/heraldry/arms';

/** Клетка атласа в точках холста 1024 × 1024. */
export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ATLAS_PX = 1024;

export const ATLAS = {
  tapA: { x: 0, y: 0, w: 256, h: 320 },
  tapB: { x: 256, y: 0, w: 256, h: 320 },
  shield: { x: 512, y: 0, w: 128, h: 160 },
  rug: { x: 640, y: 0, w: 384, h: 256 },
  fur: { x: 640, y: 256, w: 384, h: 256 },
  map: { x: 0, y: 320, w: 384, h: 288 },
  letter: { x: 384, y: 320, w: 128, h: 96 },
  scroll: { x: 512, y: 320, w: 128, h: 192 },
  ledger: { x: 640, y: 512, w: 256, h: 160 },
  roll: { x: 896, y: 512, w: 128, h: 256 },
  plans: { x: 0, y: 608, w: 320, h: 224 },
  chess: { x: 320, y: 608, w: 128, h: 128 },
  cover: { x: 448, y: 608, w: 192, h: 192 },
  seal: { x: 640, y: 672, w: 64, h: 64 },
  parch: { x: 704, y: 672, w: 64, h: 64 },
  wax: { x: 768, y: 672, w: 64, h: 64 },
} as const satisfies Record<string, Cell>;

export type AtlasCell = keyof typeof ATLAS;

/** Доли клетки (u, v от левого нижнего угла картинки) → UV атласа (текстура с `flipY`: верх холста — v = 1). */
export function atlasUv(cell: AtlasCell, u: number, v: number): [number, number] {
  const c = ATLAS[cell];
  return [(c.x + u * c.w) / ATLAS_PX, 1 - (c.y + (1 - v) * c.h) / ATLAS_PX];
}

/** UV четырёх углов клетки для `Mesher.quad` (a — левый низ, b — правый низ, c — правый верх, d — левый верх). */
export function cellUv(cell: AtlasCell, u0 = 0, v0 = 0, u1 = 1, v1 = 1): [number, number, number, number, number, number, number, number] {
  const a = atlasUv(cell, u0, v0);
  const b = atlasUv(cell, u1, v0);
  const c = atlasUv(cell, u1, v1);
  const d = atlasUv(cell, u0, v1);
  return [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]];
}

/** Сеяная кость холста. */
function bone(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

const INK = 'rgba(58, 34, 20, 0.86)';
const INK_SOFT = 'rgba(70, 44, 26, 0.55)';
const RED_WAX = '#8e1d18';

/** Нарисовать атлас: `px` — сторона холста (1024 на «Среднем» и «Высоком», 512 на «Низком»). */
export function paintAtlas(arms: Arms, px: number, seed = 1200): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = px;
  cv.height = px;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const k = px / ATLAS_PX;
  ctx.scale(k, k);
  const r = bone(seed);
  tapestry(ctx, ATLAS.tapA, arms, '#5a1414', '#c9a24a', r, true);
  tapestry(ctx, ATLAS.tapB, arms, '#17304f', '#c9a24a', r, false);
  shield(ctx, ATLAS.shield, arms);
  rug(ctx, ATLAS.rug, r);
  fur(ctx, ATLAS.fur, r);
  map(ctx, ATLAS.map, arms, r);
  letter(ctx, ATLAS.letter, arms, r);
  scroll(ctx, ATLAS.scroll, arms, r);
  ledger(ctx, ATLAS.ledger, r);
  roll(ctx, ATLAS.roll, r);
  plans(ctx, ATLAS.plans, r);
  chess(ctx, ATLAS.chess);
  cover(ctx, ATLAS.cover, r);
  sealFace(ctx, ATLAS.seal, arms);
  parchment(ctx, ATLAS.parch, r, 0.6);
  wax(ctx, ATLAS.wax, arms);
  return cv;
}

// ---------- Ткани ----------

/** Шерсть: основа цветом и уток штрихами — ткань читается и вблизи, и на расстоянии. */
function wool(ctx: CanvasRenderingContext2D, c: Cell, base: string, r: () => number, rows = 1.4): void {
  ctx.fillStyle = base;
  ctx.fillRect(c.x, c.y, c.w, c.h);
  for (let y = c.y; y < c.y + c.h; y += rows) {
    const l = 0.05 + r() * 0.1;
    ctx.fillStyle = r() < 0.5 ? `rgba(255,240,210,${l * 0.5})` : `rgba(0,0,0,${l})`;
    ctx.fillRect(c.x, y, c.w, 0.7);
  }
  for (let i = 0; i < (c.w * c.h) / 40; i++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '255,235,200' : '0,0,0'},${0.04 + r() * 0.06})`;
    ctx.fillRect(c.x + r() * c.w, c.y + r() * c.h, 1 + r() * 3, 0.8);
  }
}

/** Гобелен: поле шерсти, кайма с лозой, большой герб державы посередине, бахрома внизу; у полога — ещё и гербы малые. */
function tapestry(ctx: CanvasRenderingContext2D, c: Cell, arms: Arms, field: string, gold: string, r: () => number, small: boolean): void {
  wool(ctx, c, field, r);
  // Узор поля: ромбы-решётка тонкой нитью.
  ctx.save();
  ctx.beginPath();
  ctx.rect(c.x, c.y, c.w, c.h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(201,162,74,0.22)';
  ctx.lineWidth = 1.2;
  for (let d = -c.h; d < c.w + c.h; d += 22) {
    ctx.beginPath();
    ctx.moveTo(c.x + d, c.y);
    ctx.lineTo(c.x + d + c.h, c.y + c.h);
    ctx.moveTo(c.x + d, c.y + c.h);
    ctx.lineTo(c.x + d + c.h, c.y);
    ctx.stroke();
  }
  ctx.restore();
  // Кайма: две золотые нити и лоза между ними.
  const b = 16;
  ctx.fillStyle = 'rgba(20,10,6,0.55)';
  ctx.fillRect(c.x, c.y, c.w, b);
  ctx.fillRect(c.x, c.y + c.h - b - 14, c.w, b);
  ctx.fillRect(c.x, c.y, b, c.h - 14);
  ctx.fillRect(c.x + c.w - b, c.y, b, c.h - 14);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(c.x + 3, c.y + 3, c.w - 6, c.h - 20);
  ctx.strokeRect(c.x + b - 2, c.y + b - 2, c.w - 2 * b + 4, c.h - 2 * b - 10);
  ctx.lineWidth = 1.3;
  const vine = (x0: number, y0: number, x1: number, y1: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / 14));
    ctx.beginPath();
    for (let i = 0; i <= n * 8; i++) {
      const t = i / (n * 8);
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const w = Math.sin(t * n * Math.PI * 2) * 3.2;
      const nx = -(y1 - y0) / len;
      const ny = (x1 - x0) / len;
      if (i === 0) ctx.moveTo(x + nx * w, y + ny * w);
      else ctx.lineTo(x + nx * w, y + ny * w);
    }
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const t = (i + 0.25) / n;
      ctx.fillStyle = i % 2 ? gold : '#b8462e';
      ctx.beginPath();
      ctx.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  vine(c.x + 10, c.y + 8, c.x + c.w - 10, c.y + 8);
  vine(c.x + 10, c.y + c.h - b - 6, c.x + c.w - 10, c.y + c.h - b - 6);
  vine(c.x + 8, c.y + 12, c.x + 8, c.y + c.h - b - 10);
  vine(c.x + c.w - 8, c.y + 12, c.x + c.w - 8, c.y + c.h - b - 10);
  // Герб: тень вышивки и сам щит.
  const aw = c.w * 0.56;
  const ax = c.x + (c.w - aw) / 2;
  const ay = c.y + c.h * 0.17;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(ax + aw / 2 + 2, ay + aw * 0.62 + 4, aw * 0.52, aw * 0.64, 0, 0, Math.PI * 2);
  ctx.fill();
  paintArms(ctx, arms, ax, ay, aw, { gloss: false });
  if (small) {
    for (const [fx, fy] of [
      [0.2, 0.83],
      [0.8, 0.83],
    ] as const) {
      paintArms(ctx, arms, c.x + c.w * fx - 13, c.y + c.h * fy - 26, 26, { gloss: false });
    }
  } else {
    // Надпись под гербом — строкой «письма» золотом.
    script(ctx, c.x + c.w * 0.18, c.y + c.h * 0.8, c.w * 0.64, 1, r, gold, 7);
  }
  // Бахрома.
  for (let x = c.x + 2; x < c.x + c.w - 2; x += 3) {
    ctx.strokeStyle = r() < 0.5 ? gold : '#8a6a2a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, c.y + c.h - 15);
    ctx.lineTo(x + (r() - 0.5) * 2, c.y + c.h - 1 - r() * 4);
    ctx.stroke();
  }
  // Ткань у краёв темнее — складки и пыль.
  const g = ctx.createLinearGradient(c.x, 0, c.x + c.w, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.25)');
  g.addColorStop(0.12, 'rgba(0,0,0,0)');
  g.addColorStop(0.88, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = g;
  ctx.fillRect(c.x, c.y, c.w, c.h - 15);
}

/** Щит на стене оружия: герб без полей, фон прозрачный (обрезка по альфе в шейдере). */
function shield(ctx: CanvasRenderingContext2D, c: Cell, arms: Arms): void {
  ctx.clearRect(c.x, c.y, c.w, c.h);
  paintArms(ctx, arms, c.x + 6, c.y + 8, c.w - 12, { gloss: true });
}

/** Ковёр под столом: червлёное поле, медальоны и кайма — заморская роскошь. */
function rug(ctx: CanvasRenderingContext2D, c: Cell, r: () => number): void {
  wool(ctx, c, '#5f2119', r, 1.2);
  const inset = 22;
  ctx.fillStyle = '#25304a';
  ctx.fillRect(c.x + 6, c.y + 6, c.w - 12, inset - 8);
  ctx.fillRect(c.x + 6, c.y + c.h - inset + 2, c.w - 12, inset - 8);
  ctx.fillRect(c.x + 6, c.y + 6, inset - 8, c.h - 12);
  ctx.fillRect(c.x + c.w - inset + 2, c.y + 6, inset - 8, c.h - 12);
  ctx.fillStyle = '#b8944e';
  for (let x = c.x + 12; x < c.x + c.w - 10; x += 12) {
    lozenge(ctx, x, c.y + 13, 4);
    lozenge(ctx, x, c.y + c.h - 13, 4);
  }
  for (let y = c.y + 24; y < c.y + c.h - 20; y += 12) {
    lozenge(ctx, c.x + 13, y, 4);
    lozenge(ctx, c.x + c.w - 13, y, 4);
  }
  // Медальоны рядами: восьмиугольник, внутри — звезда; мелко, как у ковра, а не как у знамени.
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 5; i++) {
      const cx = c.x + 46 + i * ((c.w - 92) / 4);
      const cy = c.y + 46 + j * ((c.h - 92) / 2);
      ctx.fillStyle = '#25304a';
      poly(ctx, cx, cy, 24, 8, Math.PI / 8);
      ctx.fillStyle = '#b8944e';
      poly(ctx, cx, cy, 19, 8, Math.PI / 8);
      ctx.fillStyle = (i + j) % 2 ? '#5f2119' : '#2f4a35';
      poly(ctx, cx, cy, 16, 8, Math.PI / 8);
      ctx.fillStyle = '#d9c596';
      star(ctx, cx, cy, 11, 4.5, 8);
    }
  }
  // Ворс вытерт в середине — ходят к столу.
  const g = ctx.createRadialGradient(c.x + c.w / 2, c.y + c.h / 2, 10, c.x + c.w / 2, c.y + c.h / 2, c.w * 0.6);
  g.addColorStop(0, 'rgba(255,230,190,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(c.x, c.y, c.w, c.h);
}

/** Медвежья шкура у огня: бурый мех прядями, лапы, голова — по контуру, вне контура прозрачно. */
function fur(ctx: CanvasRenderingContext2D, c: Cell, r: () => number): void {
  ctx.clearRect(c.x, c.y, c.w, c.h);
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  ctx.save();
  ctx.beginPath();
  // Контур: тело, четыре лапы, голова справа, хвост слева.
  const body: [number, number][] = [];
  const n = 64;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let rx = c.w * 0.3;
    let ry = c.h * 0.3;
    const legs = Math.pow(Math.max(0, Math.cos(2 * (a - Math.PI / 4))), 6) * 0.5 + Math.pow(Math.max(0, Math.cos(2 * (a + Math.PI / 4))), 6) * 0.5;
    rx *= 1 + legs * 0.55;
    ry *= 1 + legs * 0.75;
    const head = Math.pow(Math.max(0, Math.cos(a)), 10) * 0.42;
    rx *= 1 + head;
    ry *= 1 - head * 0.45;
    const wob = 1 + (r() - 0.5) * 0.06;
    body.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
  }
  ctx.moveTo(body[0][0], body[0][1]);
  for (const [x, y] of body) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(c.x, c.y, c.w, c.h);
  for (let i = 0; i < 2600; i++) {
    const x = c.x + r() * c.w;
    const y = c.y + r() * c.h;
    const a = Math.atan2(y - cy, x - cx) + (r() - 0.5) * 0.8;
    const l = 4 + r() * 7;
    const tone = r();
    ctx.strokeStyle = tone < 0.3 ? 'rgba(25,14,8,0.6)' : tone < 0.8 ? 'rgba(108,74,46,0.55)' : 'rgba(160,120,80,0.45)';
    ctx.lineWidth = 1 + r();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // Хребет темнее, края светлее.
  const g = ctx.createLinearGradient(0, cy - c.h * 0.4, 0, cy + c.h * 0.4);
  g.addColorStop(0, 'rgba(255,220,170,0.08)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(255,220,170,0.08)');
  ctx.fillStyle = g;
  ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.restore();
}

/** Покрывало: густая синь, золотая решётка с лилиями-крестиками. */
function cover(ctx: CanvasRenderingContext2D, c: Cell, r: () => number): void {
  wool(ctx, c, '#1c2d52', r, 1.2);
  ctx.strokeStyle = 'rgba(206,166,82,0.6)';
  ctx.lineWidth = 1.4;
  for (let d = -c.h; d < c.w + c.h; d += 24) {
    ctx.beginPath();
    ctx.moveTo(c.x + d, c.y);
    ctx.lineTo(c.x + d + c.h, c.y + c.h);
    ctx.moveTo(c.x + d, c.y + c.h);
    ctx.lineTo(c.x + d + c.h, c.y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(214,176,90,0.85)';
  for (let y = c.y + 12; y < c.y + c.h; y += 24) for (let x = c.x + (((y - c.y) / 24) % 2 ? 24 : 12); x < c.x + c.w; x += 24) star(ctx, x, y, 4, 1.6, 4);
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 3;
  ctx.strokeRect(c.x + 4, c.y + 4, c.w - 8, c.h - 8);
}

// ---------- Пергаменты ----------

/** Пергамент: тёплый лист, пятна, потемневшие края. */
function parchment(ctx: CanvasRenderingContext2D, c: Cell, r: () => number, age = 0.5): void {
  ctx.fillStyle = '#e4d2a8';
  ctx.fillRect(c.x, c.y, c.w, c.h);
  for (let i = 0; i < (c.w * c.h) / 260; i++) {
    const rr = 2 + r() * Math.min(c.w, c.h) * 0.12;
    ctx.fillStyle = `rgba(${r() < 0.5 ? '150,110,60' : '255,248,225'},${0.03 + r() * 0.06})`;
    ctx.beginPath();
    ctx.arc(c.x + r() * c.w, c.y + r() * c.h, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(c.x + c.w / 2, c.y + c.h / 2, Math.min(c.w, c.h) * 0.3, c.x + c.w / 2, c.y + c.h / 2, Math.max(c.w, c.h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(96,58,24,${0.3 + age * 0.3})`);
  ctx.fillStyle = g;
  ctx.fillRect(c.x, c.y, c.w, c.h);
}

/** Строки письма: слова — петлями пера, наклон и нажим разные; `lines` строк по `step`. */
function script(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, lines: number, r: () => number, ink = INK, step = 9, scale = 1): void {
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.9 * scale;
  ctx.lineCap = 'round';
  for (let l = 0; l < lines; l++) {
    const y = y0 + l * step;
    let x = x0 + (l === 0 ? 6 * scale : 0);
    const end = x0 + w * (l === lines - 1 ? 0.55 + r() * 0.3 : 0.94 + r() * 0.06);
    while (x < end) {
      const word = (3 + r() * 9) * scale;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let t = 0; t < word; t += 1.6 * scale) {
        const up = (r() < 0.12 ? 4.5 : 2.2) * scale;
        ctx.quadraticCurveTo(x + t + 0.4 * scale, y - up, x + t + 0.8 * scale, y);
      }
      ctx.stroke();
      x += word + (2 + r() * 2.5) * scale;
    }
  }
}

/** Карта земель: суша пятнами, реки, горы, леса, города башенками, роза ветров; свой город — гербом. */
function map(ctx: CanvasRenderingContext2D, c: Cell, arms: Arms, r: () => number): void {
  parchment(ctx, c, r, 0.7);
  const cx = c.x + c.w * 0.48;
  const cy = c.y + c.h * 0.52;
  ctx.save();
  ctx.beginPath();
  ctx.rect(c.x + 8, c.y + 8, c.w - 16, c.h - 16);
  ctx.clip();
  // Море — штриховкой у берега.
  ctx.strokeStyle = 'rgba(60,80,90,0.35)';
  ctx.lineWidth = 0.8;
  for (let y = c.y; y < c.y + c.h; y += 5) {
    ctx.beginPath();
    ctx.moveTo(c.x, y);
    ctx.lineTo(c.x + c.w, y + 2);
    ctx.stroke();
  }
  // Суша: пятно с изрезанным берегом.
  const land: [number, number][] = [];
  const n = 90;
  const ph = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 1 + 0.22 * Math.sin(a * 3 + ph[0]) + 0.12 * Math.sin(a * 7 + ph[1]) + 0.06 * Math.sin(a * 13 + ph[2]) + (r() - 0.5) * 0.05;
    land.push([cx + Math.cos(a) * c.w * 0.36 * rad, cy + Math.sin(a) * c.h * 0.38 * rad]);
  }
  ctx.fillStyle = '#e9dcb6';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(land[0][0], land[0][1]);
  for (const [x, y] of land) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Реки.
  ctx.strokeStyle = 'rgba(50,80,110,0.7)';
  ctx.lineWidth = 1.3;
  for (let k = 0; k < 2; k++) {
    let x = cx + (r() - 0.5) * 40;
    let y = cy + (r() - 0.5) * 30;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const a = r() * Math.PI * 2;
    for (let i = 0; i < 24; i++) {
      x += Math.cos(a + Math.sin(i * 0.7) * 0.8) * 4.5;
      y += Math.sin(a + Math.sin(i * 0.7) * 0.8) * 4.5;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Горы и леса.
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    const x = cx - c.w * 0.25 + r() * c.w * 0.5;
    const y = cy - c.h * 0.25 + r() * c.h * 0.5;
    if (r() < 0.5) {
      ctx.beginPath();
      ctx.moveTo(x - 5, y + 3);
      ctx.lineTo(x, y - 5);
      ctx.lineTo(x + 5, y + 3);
      ctx.stroke();
    } else {
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        ctx.arc(x + j * 4, y + (j % 2) * 2, 2.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  // Города: башенка с флажком; дороги между ними пунктиром; свой — гербом.
  const towns: [number, number][] = [];
  for (let i = 0; i < 6; i++) towns.push([cx - c.w * 0.26 + r() * c.w * 0.52, cy - c.h * 0.26 + r() * c.h * 0.52]);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(120,40,30,0.7)';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  for (const [x, y] of towns.slice(0, 4)) ctx.lineTo(x, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = INK;
  for (const [x, y] of towns) {
    ctx.fillRect(x - 3, y - 4, 6, 6);
    ctx.fillRect(x - 0.6, y - 9, 1.2, 5);
    ctx.fillStyle = '#9b2a1e';
    ctx.fillRect(x + 0.6, y - 9, 4, 2.4);
    ctx.fillStyle = INK;
  }
  paintArms(ctx, arms, cx - 9, cy - 11, 18, { gloss: false });
  ctx.restore();
  // Роза ветров и рамка.
  const rx = c.x + c.w * 0.84;
  const ry = c.y + c.h * 0.2;
  ctx.fillStyle = 'rgba(120,40,30,0.8)';
  star(ctx, rx, ry, 16, 3, 4);
  ctx.fillStyle = INK;
  star(ctx, rx, ry, 10, 2, 4);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(c.x + 6, c.y + 6, c.w - 12, c.h - 12);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(c.x + 10, c.y + 10, c.w - 20, c.h - 20);
}

/** Сложенное письмо: лицо листа, строка адреса, сургуч с гербом. */
function letter(ctx: CanvasRenderingContext2D, c: Cell, arms: Arms, r: () => number): void {
  parchment(ctx, c, r, 0.4);
  ctx.strokeStyle = 'rgba(96,60,30,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y + c.h * 0.5);
  ctx.lineTo(c.x + c.w * 0.5, c.y + c.h * 0.75);
  ctx.lineTo(c.x + c.w, c.y + c.h * 0.5);
  ctx.stroke();
  script(ctx, c.x + 12, c.y + 18, c.w * 0.62, 2, r, INK, 9);
  waxSeal(ctx, c.x + c.w * 0.5, c.y + c.h * 0.72, 13, arms);
}

/** Свиток указов: текст столбцом, большая буквица, печать на шнуре внизу. */
function scroll(ctx: CanvasRenderingContext2D, c: Cell, arms: Arms, r: () => number): void {
  parchment(ctx, c, r, 0.5);
  ctx.fillStyle = '#8e1d18';
  ctx.font = 'bold 22px serif';
  ctx.fillText('R', c.x + 12, c.y + 34);
  script(ctx, c.x + 32, c.y + 20, c.w - 44, 2, r, INK, 8);
  script(ctx, c.x + 12, c.y + 40, c.w - 24, 12, r, INK, 8);
  ctx.strokeStyle = '#7a1d17';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(c.x + c.w / 2 - 4, c.y + c.h - 40);
  ctx.lineTo(c.x + c.w / 2 - 8, c.y + c.h - 14);
  ctx.moveTo(c.x + c.w / 2 + 4, c.y + c.h - 40);
  ctx.lineTo(c.x + c.w / 2 + 8, c.y + c.h - 14);
  ctx.stroke();
  waxSeal(ctx, c.x + c.w / 2, c.y + c.h - 18, 14, arms);
}

/** Книга людей: развёрнутые листы, столбцы имён и чёрточки счёта. */
function ledger(ctx: CanvasRenderingContext2D, c: Cell, r: () => number): void {
  parchment(ctx, { x: c.x, y: c.y, w: c.w / 2, h: c.h }, r, 0.4);
  parchment(ctx, { x: c.x + c.w / 2, y: c.y, w: c.w / 2, h: c.h }, r, 0.4);
  const g = ctx.createLinearGradient(c.x + c.w / 2 - 14, 0, c.x + c.w / 2 + 14, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(60,30,10,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(c.x + c.w / 2 - 14, c.y, 28, c.h);
  for (const x0 of [c.x + 10, c.x + c.w / 2 + 10]) {
    ctx.strokeStyle = 'rgba(140,40,30,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x0 + 70, c.y + 10);
    ctx.lineTo(x0 + 70, c.y + c.h - 10);
    ctx.stroke();
    for (let l = 0; l < 13; l++) {
      const y = c.y + 18 + l * 10.5;
      script(ctx, x0, y, 62, 1, r, INK, 10);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      const tally = 1 + Math.floor(r() * 9);
      for (let t = 0; t < tally; t++) {
        const x = x0 + 76 + t * 4 + Math.floor(t / 5) * 3;
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x + (t % 5 === 4 ? -16 : 0), y + (t % 5 === 4 ? -1 : 2));
        ctx.stroke();
      }
    }
  }
}

/** Перечень войска: щиток вида и число римскими цифрами строками. */
function roll(ctx: CanvasRenderingContext2D, c: Cell, r: () => number): void {
  parchment(ctx, c, r, 0.5);
  ctx.fillStyle = '#8e1d18';
  ctx.font = 'bold 15px serif';
  ctx.fillText('Exercitus', c.x + 18, c.y + 22);
  const nums = ['XII', 'XL', 'VIII', 'XXV', 'IV', 'XVI', 'IX', 'XXX', 'VI', 'XIV', 'III', 'XX'];
  for (let l = 0; l < 12; l++) {
    const y = c.y + 40 + l * 17;
    ctx.fillStyle = l % 3 === 0 ? '#9b2a1e' : l % 3 === 1 ? '#1f3a66' : '#2e5a2a';
    ctx.beginPath();
    ctx.moveTo(c.x + 12, y - 7);
    ctx.lineTo(c.x + 22, y - 7);
    ctx.lineTo(c.x + 22, y - 1);
    ctx.quadraticCurveTo(c.x + 17, y + 5, c.x + 17, y + 5);
    ctx.quadraticCurveTo(c.x + 12, y + 1, c.x + 12, y - 1);
    ctx.fill();
    script(ctx, c.x + 28, y, c.w - 70, 1, r, INK, 10);
    ctx.fillStyle = INK;
    ctx.font = '11px serif';
    ctx.fillText(nums[l], c.x + c.w - 34, y + 2);
  }
}

/** Планы построек: башня в разрезе и план стен по сетке, отметки размеров. */
function plans(ctx: CanvasRenderingContext2D, c: Cell, r: () => number): void {
  parchment(ctx, c, r, 0.55);
  ctx.strokeStyle = 'rgba(60,40,24,0.18)';
  ctx.lineWidth = 0.6;
  for (let x = c.x + 10; x < c.x + c.w - 6; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, c.y + 8);
    ctx.lineTo(x, c.y + c.h - 8);
    ctx.stroke();
  }
  for (let y = c.y + 10; y < c.y + c.h - 6; y += 10) {
    ctx.beginPath();
    ctx.moveTo(c.x + 8, y);
    ctx.lineTo(c.x + c.w - 8, y);
    ctx.stroke();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  // Башня: стена, зубцы, окна, шатёр.
  const tx = c.x + 40;
  const ty = c.y + 40;
  ctx.strokeRect(tx, ty + 30, 60, 130);
  for (let i = 0; i < 5; i++) ctx.strokeRect(tx - 4 + i * 14, ty + 20, 8, 10);
  ctx.beginPath();
  ctx.moveTo(tx - 6, ty + 20);
  ctx.lineTo(tx + 30, ty - 24);
  ctx.lineTo(tx + 66, ty + 20);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(tx + 30, ty + 56 + i * 28, 5, Math.PI, 0);
    ctx.lineTo(tx + 35, ty + 66 + i * 28);
    ctx.lineTo(tx + 25, ty + 66 + i * 28);
    ctx.closePath();
    ctx.stroke();
  }
  // План: многоугольник стены с башнями-кругами.
  const px = c.x + c.w * 0.68;
  const py = c.y + c.h * 0.5;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const x = px + Math.cos(a) * 62;
    const y = py + Math.sin(a) * 52;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(px + Math.cos(a) * 62, py + Math.sin(a) * 52, 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = 'rgba(140,40,30,0.75)';
  ctx.beginPath();
  ctx.moveTo(tx, ty + 170);
  ctx.lineTo(tx + 60, ty + 170);
  ctx.moveTo(tx, ty + 166);
  ctx.lineTo(tx, ty + 174);
  ctx.moveTo(tx + 60, ty + 166);
  ctx.lineTo(tx + 60, ty + 174);
  ctx.stroke();
  script(ctx, c.x + c.w * 0.45, c.y + 22, c.w * 0.45, 1, r, INK, 9);
}

/** Шахматная доска: поля кости и тёмного дерева, кайма. */
function chess(ctx: CanvasRenderingContext2D, c: Cell): void {
  ctx.fillStyle = '#3a2416';
  ctx.fillRect(c.x, c.y, c.w, c.h);
  const m = 8;
  const s = (c.w - 2 * m) / 8;
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#5b2a1c' : '#e3d3ad';
      ctx.fillRect(c.x + m + i * s, c.y + m + j * s, s, s);
    }
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(c.x + m - 1, c.y + m - 1, c.w - 2 * m + 2, c.h - 2 * m + 2);
}

/** Лицо печати: герб, вырезанный в металле, и кайма с надписью. */
function sealFace(ctx: CanvasRenderingContext2D, c: Cell, arms: Arms): void {
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  ctx.fillStyle = '#b08a3e';
  ctx.beginPath();
  ctx.arc(cx, cy, c.w / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6e5220';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, c.w / 2 - 6, 0, Math.PI * 2);
  ctx.stroke();
  paintArms(ctx, arms, cx - 15, cy - 18, 30, { gloss: false });
}

/** Сургуч у писем: красный, с оттиском герба. */
function wax(ctx: CanvasRenderingContext2D, c: Cell, arms: Arms): void {
  ctx.clearRect(c.x, c.y, c.w, c.h);
  waxSeal(ctx, c.x + c.w / 2, c.y + c.h / 2, c.w / 2 - 3, arms);
}

function waxSeal(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, arms: Arms): void {
  ctx.fillStyle = RED_WAX;
  ctx.beginPath();
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const rr = rad * (i % 2 ? 0.92 : 1.02);
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.72, 0, Math.PI * 2);
  ctx.clip();
  // Оттиск — поле герба в красном воске: глубже тоном, без своих красок.
  ctx.globalCompositeOperation = 'multiply';
  paintField(ctx, arms, x - rad * 0.72, y - rad * 0.72, rad * 1.44, rad * 1.44);
  ctx.restore();
  ctx.strokeStyle = 'rgba(40,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.74, 0, Math.PI * 2);
  ctx.stroke();
}

// ---------- Мелочи рисования ----------

function lozenge(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fill();
}

function poly(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, n: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number, n: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 ? inner : outer;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}
