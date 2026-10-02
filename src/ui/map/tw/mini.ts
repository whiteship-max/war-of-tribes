// Миниатюры карты нового вида (docs/map_tw.md, раздел 4): город, логово, армия. Макет вместо значка —
// как на карте кампании: город — стена из известняка с башнями, черепица, донжон и церковь, поля
// вокруг; логово — шатры за кольями и дым костра; армия — фигурка воина со знаменем на подставке.
//
// Пути и градиенты — только здесь, при выпечке спрайта (закон кадра, docs/world-map.md): спрайт
// печётся один раз на вид и размер, в кадре — одно копирование. Единица рисования — клетка: холст
// масштабируется на пиксели клетки, и формы не зависят от размера.
import type { Fate, Stage } from '@/world/types';
import { makeCanvas } from '../paint';

type C = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
/** Косой взгляд сверху: круг на земле — эллипс. Тот же, что у прежних поселений (`village.SQUASH`). */
const SQUASH = 0.62;

/** Материалы миниатюр — гамма нового города (`render/city/palette.ts`). */
const M = {
  stone: '#c3b394',
  stoneLit: '#d6c7a6',
  stoneDark: '#8f826a',
  stoneShade: '#6f6553',
  tile: '#a65a3c',
  tileLit: '#c47a52',
  tileDark: '#7e4232',
  slate: '#5e6165',
  slateLit: '#7b7e82',
  plaster: '#e2d8c3',
  plasterShade: '#b9ab90',
  timber: '#4a3423',
  ground: '#a2916f',
  groundDark: '#7d6c50',
  ink: 'rgba(30, 22, 14, 0.85)',
  shadow: 'rgba(24, 20, 14, 0.34)',
  fields: ['#c2ab5e', '#9aa04f', '#8a6f48', '#a9a666', '#b89a52', '#7f8e45'],
  hedge: 'rgba(66, 72, 40, 0.55)',
  hide: '#8b6b4a',
  hideLit: '#a88a62',
  hideDark: '#5e4630',
  stake: '#6a5034',
  stakeLit: '#8a6a44',
  fire: '#ffb050',
  smoke: 'rgba(206, 202, 194, 0.42)',
  bone: '#e6dcc4',
  bronze: '#6a5232',
  bronzeLit: '#a07c46',
  steel: '#9aa0a6',
  steelDark: '#5d6266',
  skin: '#c89a76',
} as const;

/** Детерминированный шум кисти: у одного вида одна и та же раскладка на каждом запуске. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

// ---------- Примитивы ----------

function shadowBlob(ctx: C, x: number, y: number, rx: number, ry: number, alpha = 1): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, `rgba(24, 20, 14, ${0.42 * alpha})`);
  g.addColorStop(0.7, `rgba(24, 20, 14, ${0.22 * alpha})`);
  g.addColorStop(1, 'rgba(24, 20, 14, 0)');
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.translate(-x, -y);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Дом в косом взгляде: стена фасадом, двускатная крыша, свет слева. `w` — ширина, `h` — высота стены. */
function house(ctx: C, x: number, y: number, w: number, h: number, roof: 'tile' | 'slate', wall: 'plaster' | 'stone'): void {
  const d = w * 0.55;
  const rh = w * 0.42;
  ctx.fillStyle = M.shadow;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.18, y + 0.01, w * 0.62, w * 0.2, 0, 0, TAU);
  ctx.fill();
  // Фасад и торец.
  ctx.fillStyle = wall === 'plaster' ? M.plaster : M.stone;
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = wall === 'plaster' ? M.plasterShade : M.stoneDark;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2 + d * 0.35, y - d * 0.3);
  ctx.lineTo(x + w / 2 + d * 0.35, y - d * 0.3 - h);
  ctx.lineTo(x + w / 2, y - h);
  ctx.closePath();
  ctx.fill();
  // Крыша: ближний скат светлый, дальний — тёмная полоса у конька.
  const lit = roof === 'tile' ? M.tileLit : M.slateLit;
  const base = roof === 'tile' ? M.tile : M.slate;
  const dark = roof === 'tile' ? M.tileDark : M.slate;
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - w * 0.06, y - h);
  ctx.lineTo(x + w / 2 + w * 0.06, y - h);
  ctx.lineTo(x + w / 2 + d * 0.35, y - h - rh - d * 0.3);
  ctx.lineTo(x - w / 2 + d * 0.35, y - h - rh - d * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - w * 0.06, y - h);
  ctx.lineTo(x - w * 0.05, y - h);
  ctx.lineTo(x - w * 0.05 + d * 0.35, y - h - rh - d * 0.3);
  ctx.lineTo(x - w / 2 + d * 0.35, y - h - rh - d * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = w * 0.06;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + d * 0.35, y - h - rh - d * 0.3);
  ctx.lineTo(x + w / 2 + d * 0.35, y - h - rh - d * 0.3);
  ctx.stroke();
  // Окно-точка: дом обитаем.
  ctx.fillStyle = 'rgba(40, 30, 22, 0.75)';
  ctx.fillRect(x - w * 0.12, y - h * 0.62, w * 0.12, h * 0.26);
}

/** Круглая башня: цилиндр камня и коническая кровля; свет слева. */
function roundTower(ctx: C, x: number, y: number, r: number, h: number, roof: 'tile' | 'slate' | 'none'): void {
  const ry = r * SQUASH;
  const g = ctx.createLinearGradient(x - r, 0, x + r, 0);
  g.addColorStop(0, M.stoneLit);
  g.addColorStop(0.55, M.stone);
  g.addColorStop(1, M.stoneShade);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - r, y - h);
  ctx.lineTo(x - r, y);
  ctx.ellipse(x, y, r, ry, 0, Math.PI, 0, true);
  ctx.lineTo(x + r, y - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = M.stoneLit;
  ctx.beginPath();
  ctx.ellipse(x, y - h, r, ry, 0, 0, TAU);
  ctx.fill();
  if (roof === 'none') {
    // Зубцы: тёмные прорези по верху.
    ctx.fillStyle = M.stoneShade;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (0.1 + (i / 5) * 0.8);
      ctx.fillRect(x - Math.cos(a) * r * 0.92 - r * 0.08, y - h + Math.sin(a) * ry * 0.6 - r * 0.14, r * 0.16, r * 0.18);
    }
    return;
  }
  const rh = r * 2.1;
  const cone = ctx.createLinearGradient(x - r, 0, x + r, 0);
  cone.addColorStop(0, roof === 'tile' ? M.tileLit : M.slateLit);
  cone.addColorStop(1, roof === 'tile' ? M.tileDark : M.slate);
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(x - r * 1.12, y - h);
  ctx.ellipse(x, y - h, r * 1.12, ry * 1.12, 0, Math.PI, 0, true);
  ctx.lineTo(x, y - h - rh);
  ctx.closePath();
  ctx.fill();
}

/** Стяг на древке. `swallow` — раздвоенный хвост (знамя полководца). */
function banner(ctx: C, x: number, y: number, h: number, w: number, color: string, swallow: boolean): void {
  ctx.strokeStyle = M.timber;
  ctx.lineWidth = w * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h);
  ctx.stroke();
  const top = y - h + w * 0.08;
  const bh = w * 0.95;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x + w, top + w * 0.06);
  if (swallow) {
    ctx.lineTo(x + w * 0.96, top + bh);
    ctx.lineTo(x + w * 0.62, top + bh * 0.78);
    ctx.lineTo(x + w * 0.3, top + bh);
  } else ctx.lineTo(x + w, top + bh);
  ctx.lineTo(x, top + bh * 0.94);
  ctx.closePath();
  ctx.fill();
  // Тень складки справа и знак — светлый крест: стяг виден издали, а не только цветом.
  ctx.fillStyle = 'rgba(30, 20, 10, 0.22)';
  ctx.fillRect(x + w * 0.62, top + w * 0.06, w * 0.34, bh * 0.82);
  ctx.fillStyle = 'rgba(250, 240, 214, 0.85)';
  ctx.fillRect(x + w * 0.42, top + bh * 0.14, w * 0.12, bh * 0.56);
  ctx.fillRect(x + w * 0.24, top + bh * 0.34, w * 0.48, bh * 0.11);
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = w * 0.035;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x + w, top + w * 0.06);
  ctx.stroke();
}

// ---------- Город ----------

/**
 * Поля вокруг города: лоскуты пашни, луга и жнивья с межами — земля, которая кормит стену. Лоскуты —
 * неровные четырёхугольники вразброс, а не кольцо: кольцо читалось пирогом.
 */
function fields(ctx: C, cx: number, cy: number, r0: number, r1: number, rnd: () => number): void {
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU;
    const r = r0 + rnd() * (r1 - r0);
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r * SQUASH;
    const w = 0.2 + rnd() * 0.22;
    const h = 0.12 + rnd() * 0.14;
    const rot = a + Math.PI / 2 + (rnd() - 0.5) * 0.6;
    const col = M.fields[Math.floor(rnd() * M.fields.length)];
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(1, SQUASH);
    ctx.rotate(rot);
    const skew = (rnd() - 0.5) * 0.06;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + skew, -h / 2);
    ctx.lineTo(w / 2, -h / 2 + skew);
    ctx.lineTo(w / 2 - skew, h / 2);
    ctx.lineTo(-w / 2, h / 2 - skew);
    ctx.closePath();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = col;
    ctx.fill();
    // Борозды вдоль лоскута и межа по краю.
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = '#4e4428';
    ctx.lineWidth = 0.012;
    for (let k = 1; k < 5; k++) {
      const yy = -h / 2 + (h * k) / 5;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 0.01, yy);
      ctx.lineTo(w / 2 - 0.01, yy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = M.hedge;
    ctx.lineWidth = 0.018;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + skew, -h / 2);
    ctx.lineTo(w / 2, -h / 2 + skew);
    ctx.lineTo(w / 2 - skew, h / 2);
    ctx.lineTo(-w / 2, h / 2 - skew);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

/** Стена-эллипс: дальняя половина — до домов, ближняя — после. `front` — какая половина. */
function wallArc(ctx: C, cx: number, cy: number, rx: number, h: number, front: boolean): void {
  const ry = rx * SQUASH;
  const from = front ? 0 : Math.PI;
  const to = front ? Math.PI : TAU;
  // Лицо стены — полоса высотой `h` под гребнем; у дальней половины видна только внутренняя кромка.
  ctx.fillStyle = front ? M.stone : M.stoneDark;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h, rx, ry, 0, from, to, false);
  ctx.ellipse(cx, cy, rx, ry, 0, to, from, true);
  ctx.closePath();
  ctx.fill();
  if (front) {
    // Свет слева: левая часть лица светлее, правая уходит в тень.
    const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0);
    g.addColorStop(0, 'rgba(255, 246, 220, 0.28)');
    g.addColorStop(0.5, 'rgba(255, 246, 220, 0)');
    g.addColorStop(1, 'rgba(30, 24, 18, 0.32)');
    ctx.fillStyle = g;
    ctx.fill();
  }
  // Гребень с зубцами.
  ctx.strokeStyle = M.stoneLit;
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h, rx, ry, 0, from, to, false);
  ctx.stroke();
  ctx.fillStyle = M.stoneShade;
  const n = 30;
  for (let i = 0; i < n; i++) {
    const a = from + ((i + 0.5) / n) * Math.PI;
    ctx.fillRect(cx + Math.cos(a) * rx - 0.012, cy - h + Math.sin(a) * ry - 0.05, 0.024, 0.035);
  }
}

export interface CityLook {
  /** Знамя владельца. */
  color: string;
  /** Своё поселение — знамя выше и второе на воротах. */
  own: boolean;
  variant: number;
}

/** Ширина и высота холста миниатюры в клетках и где на нём клетка поселения. */
const CITY_SPAN = { w: 3.6, h: 3.2, ax: 1.8, ay: 1.95 };
const LAIR_SPAN = { w: 3.0, h: 3.0, ax: 1.5, ay: 2.05 };
const ARMY_SPAN = { w: 2.4, h: 2.7, ax: 1.0, ay: 2.25 };

function city(ctx: C, look: CityLook): void {
  const rnd = rng(31337 + look.variant * 101);
  const cx = 0;
  const cy = 0;
  const rx = 0.84;
  const ry = rx * SQUASH;
  const wallH = 0.18;
  shadowBlob(ctx, cx + 0.12, cy + 0.1, 1.15, 0.6, 0.8);
  fields(ctx, cx, cy, 1.0, 1.62, rnd);
  // Площадка внутри стены и подол у её подножия.
  ctx.fillStyle = M.groundDark;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 0.02, rx * 1.08, ry * 1.08, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = M.ground;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fill();

  // Башни стены: дальние — до домов, ближние — после.
  const towers: { x: number; y: number; front: boolean }[] = [];
  const nt = 8;
  for (let i = 0; i < nt; i++) {
    const a = (i / nt) * TAU + 0.2;
    towers.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, front: Math.sin(a) > 0 });
  }
  wallArc(ctx, cx, cy, rx, wallH, false);
  for (const t of towers.filter((t) => !t.front)) roundTower(ctx, t.x, t.y, 0.075, wallH * 1.55, rnd() < 0.5 ? 'tile' : 'slate');

  // Застройка: дома рядами, церковь и донжон. Глубже — раньше, ближе — позже.
  type Piece = { y: number; draw: () => void };
  const pieces: Piece[] = [];
  const keep = { x: cx - 0.12, y: cy - 0.08 };
  pieces.push({
    y: keep.y,
    draw: () => {
      const w = 0.22;
      const h = 0.62;
      ctx.fillStyle = M.shadow;
      ctx.beginPath();
      ctx.ellipse(keep.x + 0.16, keep.y + 0.02, 0.26, 0.08, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = M.stone;
      ctx.fillRect(keep.x - w / 2, keep.y - h, w, h);
      ctx.fillStyle = M.stoneShade;
      ctx.beginPath();
      ctx.moveTo(keep.x + w / 2, keep.y);
      ctx.lineTo(keep.x + w / 2 + 0.07, keep.y - 0.06);
      ctx.lineTo(keep.x + w / 2 + 0.07, keep.y - h - 0.06);
      ctx.lineTo(keep.x + w / 2, keep.y - h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = M.stoneLit;
      ctx.fillRect(keep.x - w / 2, keep.y - h, w * 0.32, h);
      // Зубцы донжона.
      ctx.fillStyle = M.stone;
      for (let i = 0; i < 4; i++) ctx.fillRect(keep.x - w / 2 + i * (w / 3.5), keep.y - h - 0.05, w / 7, 0.05);
      ctx.fillStyle = 'rgba(40, 30, 22, 0.8)';
      ctx.fillRect(keep.x - 0.02, keep.y - h * 0.62, 0.04, 0.08);
      banner(ctx, keep.x + 0.02, keep.y - h - 0.03, look.own ? 0.5 : 0.38, look.own ? 0.26 : 0.2, look.color, look.own);
    },
  });
  const church = { x: cx + 0.3, y: cy - 0.16 };
  pieces.push({
    y: church.y,
    draw: () => {
      house(ctx, church.x, church.y, 0.3, 0.16, 'slate', 'stone');
      // Колокольня со шпилем.
      const tx = church.x - 0.2;
      const ty = church.y + 0.02;
      ctx.fillStyle = M.stone;
      ctx.fillRect(tx - 0.06, ty - 0.42, 0.12, 0.42);
      ctx.fillStyle = M.stoneShade;
      ctx.fillRect(tx + 0.02, ty - 0.42, 0.04, 0.42);
      ctx.fillStyle = M.slate;
      ctx.beginPath();
      ctx.moveTo(tx - 0.075, ty - 0.42);
      ctx.lineTo(tx + 0.075, ty - 0.42);
      ctx.lineTo(tx, ty - 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = M.slateLit;
      ctx.beginPath();
      ctx.moveTo(tx - 0.075, ty - 0.42);
      ctx.lineTo(tx, ty - 0.42);
      ctx.lineTo(tx, ty - 0.7);
      ctx.closePath();
      ctx.fill();
    },
  });
  for (let i = 0; i < 26; i++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * 0.86;
    const x = cx + Math.cos(a) * rx * rr;
    const y = cy + Math.sin(a) * ry * rr * 0.92 + 0.04;
    if (Math.hypot(x - keep.x, (y - keep.y) / SQUASH) < 0.2 || Math.hypot(x - church.x, (y - church.y) / SQUASH) < 0.24) continue;
    const w = 0.11 + rnd() * 0.07;
    const h = 0.07 + rnd() * 0.05;
    const roof = rnd() < 0.82 ? 'tile' : 'slate';
    const wall = rnd() < 0.6 ? 'plaster' : 'stone';
    pieces.push({ y, draw: () => house(ctx, x, y, w, h, roof, wall) });
  }
  pieces.sort((a, b) => a.y - b.y);
  for (const p of pieces) p.draw();

  wallArc(ctx, cx, cy, rx, wallH, true);
  for (const t of towers.filter((t) => t.front).sort((a, b) => a.y - b.y)) roundTower(ctx, t.x, t.y, 0.08, wallH * 1.6, 'tile');
  // Ворота: две башни и тёмная арка посреди ближней стены.
  const gx = cx + 0.02;
  const gy = cy + ry;
  ctx.fillStyle = 'rgba(28, 20, 14, 0.9)';
  ctx.beginPath();
  ctx.moveTo(gx - 0.05, gy);
  ctx.lineTo(gx - 0.05, gy - 0.08);
  ctx.arc(gx, gy - 0.08, 0.05, Math.PI, 0);
  ctx.lineTo(gx + 0.05, gy);
  ctx.closePath();
  ctx.fill();
  roundTower(ctx, gx - 0.12, gy + 0.005, 0.06, wallH * 1.75, 'none');
  roundTower(ctx, gx + 0.12, gy + 0.005, 0.06, wallH * 1.75, 'none');
  if (look.own) banner(ctx, gx + 0.12, gy - wallH * 1.75, 0.22, 0.12, look.color, false);
}

// ---------- Логово ----------

function tent(ctx: C, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = M.shadow;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.2, y + 0.005, w * 0.6, w * 0.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = M.hideDark;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x, y - h);
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = M.hideLit;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x, y - h);
  ctx.lineTo(x + w * 0.05, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(26, 18, 12, 0.85)';
  ctx.beginPath();
  ctx.moveTo(x - w * 0.08, y);
  ctx.lineTo(x + w * 0.02, y - h * 0.45);
  ctx.lineTo(x + w * 0.1, y);
  ctx.closePath();
  ctx.fill();
  // Жерди над верхом.
  ctx.strokeStyle = M.stake;
  ctx.lineWidth = w * 0.06;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.08, y - h - w * 0.12);
  ctx.lineTo(x + w * 0.04, y - h * 0.9);
  ctx.moveTo(x + w * 0.1, y - h - w * 0.1);
  ctx.lineTo(x - w * 0.02, y - h * 0.9);
  ctx.stroke();
}

function stakes(ctx: C, cx: number, cy: number, rx: number, front: boolean, rnd: () => number): void {
  const ry = rx * SQUASH;
  const n = 34;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const isFront = Math.sin(a) > 0;
    if (isFront !== front) continue;
    // Прореха — вход в стан.
    if (Math.abs(a - Math.PI / 2) < 0.28) continue;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const h = 0.13 + rnd() * 0.05;
    const w = 0.035;
    ctx.fillStyle = Math.cos(a) < 0.2 ? M.stakeLit : M.stake;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x - w / 2, y - h);
    ctx.lineTo(x, y - h - w * 1.2);
    ctx.lineTo(x + w / 2, y - h);
    ctx.lineTo(x + w / 2, y);
    ctx.closePath();
    ctx.fill();
  }
}

function lair(ctx: C, variant: number): void {
  const rnd = rng(4111 + variant * 37);
  ctx.scale(1.3, 1.3);
  const rx = 0.58;
  const ry = rx * SQUASH;
  shadowBlob(ctx, 0.08, 0.06, 0.82, 0.42, 0.7);
  ctx.fillStyle = '#7d6848';
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 1.1, ry * 1.1, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#9c845e';
  ctx.beginPath();
  ctx.ellipse(-0.04, -0.02, rx * 0.86, ry * 0.86, 0, 0, TAU);
  ctx.fill();
  stakes(ctx, 0, 0, rx, false, rnd);
  type Piece = { y: number; draw: () => void };
  const pieces: Piece[] = [];
  const spots: [number, number][] = [
    [-0.28, -0.12],
    [0.22, -0.16],
    [-0.34, 0.08],
    [0.3, 0.06],
    [-0.02, -0.22],
  ];
  for (const [x, y] of spots) {
    const w = 0.2 + rnd() * 0.06;
    pieces.push({ y, draw: () => tent(ctx, x, y, w, w * 0.95) });
  }
  // Тотем: шест с черепом и красной тряпкой — логово видно не по цвету, а по силуэту.
  pieces.push({
    y: 0.04,
    draw: () => {
      ctx.strokeStyle = M.stake;
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.moveTo(0.08, 0.04);
      ctx.lineTo(0.08, -0.42);
      ctx.stroke();
      ctx.fillStyle = M.bone;
      ctx.beginPath();
      ctx.arc(0.08, -0.45, 0.045, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(30, 20, 14, 0.9)';
      ctx.fillRect(0.06, -0.46, 0.014, 0.014);
      ctx.fillRect(0.088, -0.46, 0.014, 0.014);
      ctx.fillStyle = '#8e2f22';
      ctx.beginPath();
      ctx.moveTo(0.08, -0.38);
      ctx.lineTo(0.2, -0.35);
      ctx.lineTo(0.15, -0.3);
      ctx.lineTo(0.2, -0.26);
      ctx.lineTo(0.08, -0.28);
      ctx.closePath();
      ctx.fill();
    },
  });
  pieces.sort((a, b) => a.y - b.y);
  // Костёр посередине: свечение, языки и дым столбом вверх-вправо.
  const fx = -0.04;
  const fy = 0.0;
  const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, 0.2);
  glow.addColorStop(0, 'rgba(255, 176, 80, 0.6)');
  glow.addColorStop(1, 'rgba(255, 176, 80, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(fx, fy, 0.2, 0, TAU);
  ctx.fill();
  for (const p of pieces) p.draw();
  ctx.fillStyle = M.fire;
  ctx.beginPath();
  ctx.moveTo(fx - 0.04, fy);
  ctx.quadraticCurveTo(fx - 0.03, fy - 0.08, fx, fy - 0.11);
  ctx.quadraticCurveTo(fx + 0.03, fy - 0.07, fx + 0.04, fy);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    ctx.fillStyle = M.smoke;
    ctx.globalAlpha = 0.9 - t * 0.6;
    ctx.beginPath();
    ctx.arc(fx + t * 0.22 + Math.sin(i * 1.7) * 0.03, fy - 0.16 - t * 0.62, 0.05 + t * 0.07, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  stakes(ctx, 0, 0, rx, true, rnd);
}

// ---------- Армия ----------

export type ArmySize = 1 | 2 | 3;

export interface ArmyLook {
  color: string;
  size: ArmySize;
  /** Смотрит влево (идёт на запад). */
  west: boolean;
}

/** Воин: ноги, кольчуга, накидка цвета стороны, щит-капля, шлем и копьё. */
function soldier(ctx: C, x: number, y: number, s: number, color: string): void {
  ctx.fillStyle = M.steelDark;
  ctx.fillRect(x - 0.045 * s, y - 0.16 * s, 0.035 * s, 0.16 * s);
  ctx.fillRect(x + 0.012 * s, y - 0.16 * s, 0.035 * s, 0.16 * s);
  // Тело: кольчуга и накидка.
  ctx.fillStyle = M.steel;
  ctx.fillRect(x - 0.075 * s, y - 0.36 * s, 0.15 * s, 0.22 * s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - 0.065 * s, y - 0.34 * s);
  ctx.lineTo(x + 0.065 * s, y - 0.34 * s);
  ctx.lineTo(x + 0.08 * s, y - 0.13 * s);
  ctx.lineTo(x - 0.08 * s, y - 0.13 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(30, 20, 10, 0.25)';
  ctx.fillRect(x + 0.01 * s, y - 0.34 * s, 0.07 * s, 0.21 * s);
  // Голова и шлем.
  ctx.fillStyle = M.skin;
  ctx.beginPath();
  ctx.arc(x, y - 0.41 * s, 0.045 * s, 0, TAU);
  ctx.fill();
  ctx.fillStyle = M.steel;
  ctx.beginPath();
  ctx.moveTo(x - 0.052 * s, y - 0.41 * s);
  ctx.quadraticCurveTo(x, y - 0.53 * s, x + 0.052 * s, y - 0.41 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = M.steelDark;
  ctx.fillRect(x - 0.006 * s, y - 0.44 * s, 0.012 * s, 0.06 * s);
  // Копьё.
  ctx.strokeStyle = M.timber;
  ctx.lineWidth = 0.018 * s;
  ctx.beginPath();
  ctx.moveTo(x + 0.1 * s, y - 0.02 * s);
  ctx.lineTo(x + 0.1 * s, y - 0.72 * s);
  ctx.stroke();
  ctx.fillStyle = M.steel;
  ctx.beginPath();
  ctx.moveTo(x + 0.085 * s, y - 0.72 * s);
  ctx.lineTo(x + 0.1 * s, y - 0.8 * s);
  ctx.lineTo(x + 0.115 * s, y - 0.72 * s);
  ctx.closePath();
  ctx.fill();
  // Щит-капля спереди слева, цвета стороны, с умбоном.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - 0.12 * s, y - 0.33 * s);
  ctx.lineTo(x - 0.02 * s, y - 0.33 * s);
  ctx.quadraticCurveTo(x - 0.02 * s, y - 0.18 * s, x - 0.07 * s, y - 0.1 * s);
  ctx.quadraticCurveTo(x - 0.12 * s, y - 0.18 * s, x - 0.12 * s, y - 0.33 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(30, 20, 10, 0.7)';
  ctx.lineWidth = 0.012 * s;
  ctx.stroke();
  ctx.fillStyle = 'rgba(250, 240, 214, 0.85)';
  ctx.fillRect(x - 0.078 * s, y - 0.31 * s, 0.016 * s, 0.17 * s);
}

function army(ctx: C, look: ArmyLook): void {
  // Фигурка крупнее человека в масштабе карты нарочно — как на карте кампании: армию ищут глазами первой.
  ctx.scale(look.west ? -1.5 : 1.5, 1.5);
  const base = 0.27 + look.size * 0.05;
  shadowBlob(ctx, 0.09, 0.04, base * 1.25, base * 0.55, 0.9);
  // Подставка: бронзовый диск с бликом по ближней кромке — фигурка, а не человек на поле.
  ctx.fillStyle = M.bronze;
  ctx.beginPath();
  ctx.ellipse(0, 0, base, base * SQUASH * 0.7, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = M.bronzeLit;
  ctx.beginPath();
  ctx.ellipse(-0.02, -0.012, base * 0.92, base * SQUASH * 0.6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#7a6040';
  ctx.beginPath();
  ctx.ellipse(0, -0.006, base * 0.84, base * SQUASH * 0.52, 0, 0, TAU);
  ctx.fill();
  // Знамя за строем: выше и шире у большого войска.
  banner(ctx, -0.04, -0.02, 0.92 + look.size * 0.12, 0.3 + look.size * 0.04, look.color, look.size === 3);
  const s = 0.95;
  if (look.size >= 2) soldier(ctx, -0.15, -0.03, s * 0.92, look.color);
  if (look.size >= 3) soldier(ctx, 0.15, -0.04, s * 0.92, look.color);
  soldier(ctx, 0.0, 0.02, s, look.color);
}

// ---------- Кэш спрайтов ----------

export interface Mini {
  canvas: HTMLCanvasElement;
  /** Где на холсте точка поселения или ног фигурки, в CSS-пикселях. */
  ax: number;
  ay: number;
  /** Размер холста в CSS-пикселях. */
  w: number;
  h: number;
}

/** Корзины размера клетки: спрайт не перепекается на каждом щипке, а берёт ближайшую корзину. */
export const MINI_BUCKETS = [16, 22, 30, 40, 52, 64, 80];
const bucketOf = (px: number): number => MINI_BUCKETS.find((b) => b >= px) ?? MINI_BUCKETS[MINI_BUCKETS.length - 1];

const cache = new Map<string, Mini>();

function bakeMini(span: { w: number; h: number; ax: number; ay: number }, cell: number, dpr: number, draw: (ctx: C) => void): Mini {
  const w = Math.ceil(span.w * cell);
  const h = Math.ceil(span.h * cell);
  const canvas = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(cell * dpr, 0, 0, cell * dpr, span.ax * cell * dpr, span.ay * cell * dpr);
    draw(ctx);
  }
  return { canvas, ax: span.ax * cell, ay: span.ay * cell, w, h };
}

/**
 * Память спрайтов — по байтам, а не по штукам: город на корзине 80 при плотности 2 весит больше
 * мегабайта, бейдж — килобайт. Вытесняется давно не нужный (свежий — в конец).
 */
const CACHE_BYTES = 16 * 1024 * 1024;
let cacheBytes = 0;
const bytesOf = (m: Mini): number => m.canvas.width * m.canvas.height * 4;

function cached(key: string, make: () => Mini): Mini {
  const have = cache.get(key);
  if (have) {
    cache.delete(key);
    cache.set(key, have);
    return have;
  }
  const m = make();
  cache.set(key, m);
  cacheBytes += bytesOf(m);
  while (cacheBytes > CACHE_BYTES && cache.size > 1) {
    const first = cache.keys().next().value as string;
    const gone = cache.get(first);
    cache.delete(first);
    if (gone) {
      cacheBytes -= bytesOf(gone);
      gone.canvas.width = 0;
    }
  }
  return m;
}

/** Сколько байт держат спрайты миниатюр — бюджету (`docs/map_tw.md`, раздел 8). */
export const miniBytes = (): number => cacheBytes;

export function citySprite(look: CityLook, cellPx: number, dpr: number): Mini {
  const b = bucketOf(cellPx);
  return cached(`city:${look.color}:${look.own}:${look.variant}:${b}:${dpr}`, () => bakeMini(CITY_SPAN, b, dpr, (ctx) => city(ctx, look)));
}

export function lairSprite(variant: number, cellPx: number, dpr: number): Mini {
  const b = bucketOf(cellPx);
  return cached(`lair:${variant}:${b}:${dpr}`, () => bakeMini(LAIR_SPAN, b, dpr, (ctx) => lair(ctx, variant)));
}

export function armySprite(look: ArmyLook, cellPx: number, dpr: number): Mini {
  const b = bucketOf(cellPx);
  return cached(`army:${look.color}:${look.size}:${look.west}:${b}:${dpr}`, () => bakeMini(ARMY_SPAN, b, dpr, (ctx) => army(ctx, look)));
}

/** Копирование миниатюры в кадр: `px` — пикселей на клетку сейчас, спрайт растягивается из корзины. */
export function drawMini(ctx: C, m: Mini, cellPx: number, bucket: number, sx: number, sy: number): void {
  const k = cellPx / bucket;
  ctx.drawImage(m.canvas, sx - m.ax * k, sy - m.ay * k, m.w * k, m.h * k);
}

export const miniBucket = bucketOf;

export function dropMinis(): void {
  for (const m of cache.values()) m.canvas.width = 0;
  cache.clear();
  cacheBytes = 0;
}


// ---------- Объекты игры (этап 2): договор кадра и касания ----------
//
// Кадр игры (`tw/frame.ts`) и касание (`tw/tap.ts`) зовут только то, что ниже: вид объекта — из полей
// мира (`SettlementView`, `MarchView`), спрайт — один раз на вид и корзину, в кадре — копирование. Ключ
// спрайта называет **каждое** поле, меняющее картинку (тест `tw/mini.test.ts`, как у `village.spriteKey`).

/** Что за место: город или двор игрока, замок, логово, пепелище. */
export type PlaceKind = 'city' | 'castle' | 'lair' | 'ruin';

export interface PlaceLook {
  kind: PlaceKind;
  /** Размер места: лагерь, деревня, крепость, город (`world/data/meta.stageOf`). */
  stage: Stage;
  /** Знамя владельца — цвет стороны (`RELATION_META`). */
  color: string;
  /** Своё поселение: знамя выше, картуш подписи. */
  own: boolean;
  /** Раскладка 0..2 (`village.variantOf` по id): соседние места одного размера не близнецы. */
  variant: number;
  /** Разорено: копоть и дым над крышами. */
  sacked: boolean;
}

export function placeKey(l: PlaceLook, bucket: number, dpr: number): string {
  return `place:${l.kind}:${l.stage}:${l.color}:${l.own ? 1 : 0}:${l.variant}:${l.sacked ? 1 : 0}:${bucket}:${dpr}`;
}

/** Тело миниатюры в клетках от точки места: стены и дома, без полей и тени. По нему — цель касания. */
export interface Body {
  /** Полуширина. */
  rx: number;
  /** Сколько тело поднимается над точкой места (крыши, башни, знамя). */
  up: number;
  /** Сколько уходит ниже точки места. */
  down: number;
}

export function placeBody(l: PlaceLook): Body {
  if (l.kind === 'ruin') return { rx: 0.55, up: 0.45, down: 0.35 };
  if (l.kind === 'lair') return { rx: 0.75, up: 1.05, down: 0.5 };
  return { rx: 0.95, up: 1.2, down: 0.62 };
}

export function placeSprite(l: PlaceLook, cellPx: number, dpr: number): Mini {
  const b = bucketOf(cellPx);
  return cached(placeKey(l, b, dpr), () =>
    l.kind === 'lair' || l.kind === 'ruin'
      ? bakeMini(LAIR_SPAN, b, dpr, (ctx) => lair(ctx, l.variant))
      : bakeMini(CITY_SPAN, b, dpr, (ctx) => city(ctx, { color: l.color, own: l.own, variant: l.variant })),
  );
}

/**
 * Войско на карте. `size`: 0 — слух (пыль без фигур: сколько их, неизвестно, `world/sight`), 1 — горстка,
 * 2 — отряд, 3 — войско, 4 — орда. `camp` — стоит лагерем у цели (осада, подмога): шатры и знамя.
 */
export interface HostLook {
  color: string;
  size: 0 | 1 | 2 | 3 | 4;
  west: boolean;
  camp: boolean;
}

export function hostKey(l: HostLook, bucket: number, dpr: number): string {
  return `host:${l.color}:${l.size}:${l.camp ? 'camp' : l.west ? 'w' : 'e'}:${bucket}:${dpr}`;
}

export function hostBody(l: HostLook): Body {
  return l.camp ? { rx: 0.7, up: 1.0, down: 0.35 } : { rx: 0.5, up: 1.35, down: 0.3 };
}

export function hostSprite(l: HostLook, cellPx: number, dpr: number): Mini {
  const b = bucketOf(cellPx);
  const size = (Math.min(3, Math.max(1, l.size)) as ArmySize);
  return cached(hostKey(l, b, dpr), () => bakeMini(ARMY_SPAN, b, dpr, (ctx) => army(ctx, { color: l.color, size, west: l.west })));
}

/** Осадные работы вокруг города: ров и два ряда рогаток (`siegemark.worksStep`: 0..8 на сторону). */
export type WorksHalf = 'back' | 'front';

export function worksKey(front: number, rear: number, half: WorksHalf, bucket: number, dpr: number): string {
  return `works:${front}:${rear}:${half}:${bucket}:${dpr}`;
}

export function worksSprite(front: number, rear: number, half: WorksHalf, cellPx: number, dpr: number): Mini {
  const b = bucketOf(cellPx);
  return cached(worksKey(front, rear, half, b, dpr), () =>
    bakeMini({ w: 3.2, h: 2.4, ax: 1.6, ay: 1.3 }, b, dpr, (ctx) => {
      ctx.strokeStyle = 'rgba(60, 44, 28, 0.6)';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.ellipse(0, 0, 1.2, 1.2 * SQUASH, 0, half === 'back' ? Math.PI : 0, half === 'back' ? TAU : Math.PI);
      ctx.stroke();
      void front;
      void rear;
    }),
  );
}

// ---------- Значки постоянного размера ----------
//
// Дальний масштаб и бейджи: размер в пикселях экрана, а не в клетках — на 4 px на клетку миниатюра в
// клетку не видна, а значок обязан читаться. `ax`, `ay` — точка места на значке.

/** Значок места на дальнем масштабе: башня, шатёр или пепел на щитке цвета стороны. */
export interface PinLook {
  kind: PlaceKind;
  color: string;
  own: boolean;
}

export const PIN_PX = 18;

export function pinKey(l: PinLook, dpr: number): string {
  return `pin:${l.kind}:${l.color}:${l.own ? 1 : 0}:${dpr}`;
}

export function pinSprite(l: PinLook, dpr: number): Mini {
  return cached(pinKey(l, dpr), () =>
    bakeMini({ w: 1, h: 1.2, ax: 0.5, ay: 1.0 }, PIN_PX, dpr, (ctx) => {
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.arc(0, -0.45, 0.32, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = M.ink;
      ctx.lineWidth = 0.08;
      ctx.stroke();
    }),
  );
}

/** Значок войска на дальнем масштабе: стяг стороны на древке. `size` — как у `HostLook`. */
export interface FlagLook {
  color: string;
  size: 0 | 1 | 2 | 3 | 4;
  camp: boolean;
}

export function flagKey(l: FlagLook, dpr: number): string {
  return `flag:${l.color}:${l.size}:${l.camp ? 1 : 0}:${dpr}`;
}

export function flagSprite(l: FlagLook, dpr: number): Mini {
  return cached(flagKey(l, dpr), () =>
    bakeMini({ w: 1, h: 1.3, ax: 0.35, ay: 1.15 }, PIN_PX, dpr, (ctx) => banner(ctx, 0, 0, 1.0, 0.5, l.color, l.size >= 3)),
  );
}

/** Бейдж над местом: под ударом (идёт набег), свои войска стоят, в осаде (дальний масштаб). */
export type BadgeKind = 'attack' | 'troops' | 'siege';

export const BADGE_PX = 16;

export function badgeSprite(kind: BadgeKind, dpr: number): Mini {
  return cached(`badge:${kind}:${dpr}`, () =>
    bakeMini({ w: 1, h: 1, ax: 0.5, ay: 0.5 }, BADGE_PX, dpr, (ctx) => {
      ctx.fillStyle = kind === 'attack' ? '#e06b5a' : kind === 'troops' ? '#e8a43c' : '#8a6c42';
      ctx.beginPath();
      ctx.arc(0, 0, 0.4, 0, TAU);
      ctx.fill();
    }),
  );
}

/** Знак участи павшего города: плашка пергамента со знаком и словом (`siegemark.FELL_WORDS`). */
export function fellSprite(fate: Fate, text: string, dpr: number): Mini {
  return cached(`fell:${fate}:${text}:${dpr}`, () => {
    const w = 8 + text.length * 6.5 + 18;
    return bakeMini({ w: w / 16, h: 1, ax: w / 32, ay: 0 }, 16, dpr, (ctx) => {
      ctx.fillStyle = '#e6d4a6';
      ctx.fillRect(-w / 32, 0, w / 16, 1);
    });
  });
}
