// Миниатюры карты нового вида (docs/map_tw.md, раздел 4): места, войска, осадные работы, значки дальнего
// масштаба. Макет вместо значка — как на карте кампании: город — стена из известняка с башнями, черепица,
// донжон и церковь, поля вокруг; замок — донжон под сланцевым конусом на скальном холме; логово — шатры из
// шкур за кольями, костёр с дымом, череп на шесте; войско — фигурки воинов со знаменем на бронзовой
// подставке.
//
// Пути и градиенты — только здесь, при выпечке спрайта (закон кадра, docs/world-map.md): спрайт печётся
// один раз на вид и корзину, в кадре — одно копирование. Единица рисования — клетка: холст масштабируется
// на пиксели клетки, и формы не зависят от размера. Свет — слева-сверху, тень ложится вправо-вниз: тот же,
// что у земли (`field.ts`), иначе макет стоял бы на чужой карте.
//
// Чистая часть (планы: где что стоит и как высоко) отделена от кисти: по одному и тому же плану рисуется
// миниатюра и считается её тело (`placeBody`, `hostBody`) — цель пальца. Две правды о высоте башни
// разошлись бы ровно там, где палец промахивается.
import type { Fate, Stage } from '@/world/types';
import { SIDE_COLOR } from '@/side';
import { makeCanvas } from '../paint';
import { FRONT_R, FRONT_STAKES, REAR_R, REAR_STAKES, stakeOrder, stakesAt } from '../siegemark';

type C = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
/** Косой взгляд сверху: круг на земле — эллипс. Тот же, что у прежних поселений (`village.SQUASH`). */
const SQUASH = 0.62;
const STAGES: readonly Stage[] = ['camp', 'village', 'stronghold', 'town'];
const stageIndex = (s: Stage): number => Math.max(0, STAGES.indexOf(s));

/**
 * Материалы миниатюр — гамма нового города (`render/city/palette.ts`). Каналы — в 0x10…0xf4 (правило
 * палитры города: чистого белого и чёрного нет); исключение — огонь, он свет, а не материал.
 */
const M = {
  stone: '#c3b394',
  stoneLit: '#d6c7a6',
  stoneDark: '#8f826a',
  stoneShade: '#6f6553',
  tile: '#a65a3c',
  tileLit: '#c47a52',
  tileDark: '#7e4232',
  slate: '#5e6268',
  slateLit: '#80858b',
  slateDark: '#45494f',
  thatch: '#a88d55',
  thatchLit: '#c6ab6e',
  thatchDark: '#7a643c',
  burnt: '#4a3d34',
  burntLit: '#615045',
  burntDark: '#302722',
  plaster: '#e2d8c3',
  plasterShade: '#b9ab90',
  timber: '#4a3423',
  wood: '#7c5c3a',
  woodLit: '#a27c50',
  woodDark: '#523d28',
  wattle: '#9a7f52',
  wattleDark: '#6c5636',
  ground: '#a2916f',
  groundDark: '#7d6c50',
  earth: '#7d6848',
  earthLit: '#9c845e',
  rock: '#9c8f6c',
  rockLit: '#b8aa84',
  rockShade: '#625844',
  ink: 'rgba(32, 24, 16, 0.85)',
  inkSoft: 'rgba(32, 24, 16, 0.45)',
  shadow: 'rgba(26, 20, 16, 0.34)',
  fields: ['#c2ab5e', '#9aa04f', '#8a6f48', '#a9a666', '#b89a52', '#7f8e45'],
  hedge: 'rgba(66, 72, 40, 0.55)',
  hide: '#9a7650',
  hideLit: '#c8a676',
  hideDark: '#664a30',
  canvas: '#d9ccab',
  canvasLit: '#eadfc0',
  canvasShade: '#a8997a',
  stake: '#6a5034',
  stakeLit: '#8f6e46',
  // Огонь — свет: правило каналов к нему не относится.
  fire: '#ffb050',
  fireCore: '#ffe08a',
  bone: '#e6dcc4',
  bronze: '#5c4629',
  bronzeMid: '#80643e',
  bronzeLit: '#b08a4e',
  steel: '#a2a7ab',
  steelDark: '#5d6266',
  skin: '#c89a76',
  ash: '#867a70',
  ashGround: '#554a41',
  ashEdge: '#3a322b',
  char: '#2a221d',
  charLit: '#6e6157',
  scorch: 'rgba(40, 30, 22, 0.5)',
  /** Своё место и свои войска — цвет стороны (`side.ts`), а не своё золото миниатюр. */
  gold: SIDE_COLOR.ours,
  goldLit: '#f4cf78',
  goldRim: '#f4e4b4',
  parchment: '#e6d4a8',
  parchmentDark: '#b89f74',
  text: '#3b2a1c',
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

/** «#rrggbb» → каналы; чужая запись (имя, rgba) — нейтральная бронза: знамя всё равно будет видно. */
function rgbOf(c: string): [number, number, number] {
  if (/^#[0-9a-f]{6}$/i.test(c)) return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  return [168, 130, 80];
}

/** Смесь двух цветов: `t` — доля второго. Тень и свет стяга — от его же цвета, а не серым поверх. */
function mix(a: string, b: string, t: number): string {
  const p = rgbOf(a);
  const q = rgbOf(b);
  const ch = (i: number): number => Math.round(p[i] + (q[i] - p[i]) * t);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

// ---------- Примитивы ----------

function ell(ctx: C, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(1e-4, rx), Math.max(1e-4, ry), 0, 0, TAU);
}

function line(ctx: C, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function shadowBlob(ctx: C, x: number, y: number, rx: number, ry: number, alpha = 1): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, `rgba(26, 20, 16, ${0.42 * alpha})`);
  g.addColorStop(0.7, `rgba(26, 20, 16, ${0.22 * alpha})`);
  g.addColorStop(1, 'rgba(26, 20, 16, 0)');
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

/** Мягкое пятно земли без жёсткого края: утоптанное у лагеря и стана, а не вырезанный круг. */
function softPatch(ctx: C, x: number, y: number, rx: number, ry: number, rgb: string, alpha: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, rx * 0.45, 0, 0, rx);
  g.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

type Roof = 'tile' | 'slate' | 'thatch' | 'burnt';
const ROOF: Record<Roof, { base: string; lit: string; dark: string }> = {
  tile: { base: M.tile, lit: M.tileLit, dark: M.tileDark },
  slate: { base: M.slate, lit: M.slateLit, dark: M.slateDark },
  thatch: { base: M.thatch, lit: M.thatchLit, dark: M.thatchDark },
  burnt: { base: M.burnt, lit: M.burntLit, dark: M.burntDark },
};

/** Верх дома от его земли: стена, скат и торец — для тела и для знамени на коньке. */
const houseTop = (y: number, w: number, h: number): number => y - h - w * 0.42 - w * 0.55 * 0.3;

/** Дом в косом взгляде: стена фасадом, двускатная крыша, свет слева. `w` — ширина, `h` — высота стены. */
function house(ctx: C, x: number, y: number, w: number, h: number, roof: Roof, wall: 'plaster' | 'stone'): void {
  const d = w * 0.55;
  const rh = w * 0.42;
  const sx = d * 0.35;
  const sy = d * 0.3;
  ctx.fillStyle = M.shadow;
  ell(ctx, x + w * 0.2, y + 0.01, w * 0.64, w * 0.2);
  ctx.fill();
  // Фасад и торец.
  ctx.fillStyle = wall === 'plaster' ? M.plaster : M.stone;
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = wall === 'plaster' ? M.plasterShade : M.stoneDark;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2 + sx, y - sy);
  ctx.lineTo(x + w / 2 + sx, y - sy - h);
  ctx.lineTo(x + w / 2, y - h);
  ctx.closePath();
  ctx.fill();
  // Крыша: ближний скат светлый слева, тёмная полоса у конька; тонкий контур держит дом на мелкой корзине.
  const r = ROOF[roof];
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - w * 0.06, y - h);
  ctx.lineTo(x + w / 2 + w * 0.06, y - h);
  ctx.lineTo(x + w / 2 + sx, y - h - rh - sy);
  ctx.lineTo(x - w / 2 + sx, y - h - rh - sy);
  ctx.closePath();
  ctx.fillStyle = r.base;
  ctx.fill();
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = w * 0.045;
  ctx.stroke();
  ctx.fillStyle = r.lit;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - w * 0.06, y - h);
  ctx.lineTo(x - w * 0.05, y - h);
  ctx.lineTo(x - w * 0.05 + sx, y - h - rh - sy);
  ctx.lineTo(x - w / 2 + sx, y - h - rh - sy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = r.dark;
  ctx.lineWidth = w * 0.06;
  line(ctx, x - w / 2 + sx, y - h - rh - sy, x + w / 2 + sx, y - h - rh - sy);
  // Тень под свесом и окно-точка: дом обитаем.
  ctx.fillStyle = 'rgba(40, 30, 22, 0.25)';
  ctx.fillRect(x - w / 2, y - h, w, h * 0.16);
  ctx.fillStyle = roof === 'burnt' ? 'rgba(36, 26, 20, 0.85)' : 'rgba(40, 30, 22, 0.75)';
  ctx.fillRect(x - w * 0.12, y - h * 0.62, w * 0.12, h * 0.26);
}

/** Круглая башня: цилиндр камня и коническая кровля; свет слева. Возвращает верх (конёк конуса или зубцы). */
function roundTower(ctx: C, x: number, y: number, r: number, h: number, roof: 'tile' | 'slate' | 'none'): number {
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
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = r * 0.12;
  ctx.stroke();
  ctx.fillStyle = M.stoneLit;
  ell(ctx, x, y - h, r, ry);
  ctx.fill();
  if (roof === 'none') {
    // Зубцы: тёмные прорези по верху.
    ctx.fillStyle = M.stoneShade;
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (0.1 + (i / 5) * 0.8);
      ctx.fillRect(x - Math.cos(a) * r * 0.92 - r * 0.08, y - h + Math.sin(a) * ry * 0.6 - r * 0.14, r * 0.16, r * 0.18);
    }
    return y - h - ry;
  }
  const rh = r * 2.1;
  const cone = ctx.createLinearGradient(x - r, 0, x + r, 0);
  cone.addColorStop(0, roof === 'tile' ? M.tileLit : M.slateLit);
  cone.addColorStop(1, roof === 'tile' ? M.tileDark : M.slateDark);
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(x - r * 1.12, y - h);
  ctx.ellipse(x, y - h, r * 1.12, ry * 1.12, 0, Math.PI, 0, true);
  ctx.lineTo(x, y - h - rh);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = r * 0.12;
  ctx.stroke();
  return y - h - rh;
}

/** Высота конуса круглой башни — та же мерка, что в `roundTower`: по ней считается тело. */
const coneOf = (r: number): number => r * 2.1;

/** Знак на полотнище: крест у людей короны, рога у варваров, пусто у слуха. */
type Sign = 'cross' | 'horns' | 'none';

/**
 * Стяг на древке. `swallow` — раздвоенный хвост (знамя полководца, орды). Полотнище чуть волной, тень
 * складки — от его же цвета, контур чернилами: на 16 px на клетку стяг держится цветом и контуром.
 */
function banner(ctx: C, x: number, y: number, h: number, w: number, color: string, swallow: boolean, sign: Sign = 'cross', alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = Math.max(0.03, w * 0.13);
  line(ctx, x, y, x, y - h);
  ctx.strokeStyle = M.timber;
  ctx.lineWidth = Math.max(0.016, w * 0.07);
  line(ctx, x, y, x, y - h);
  // Навершие: светлый шарик — конец древка виден над крышами.
  ctx.fillStyle = M.goldLit;
  ell(ctx, x, y - h - w * 0.04, w * 0.07, w * 0.07);
  ctx.fill();
  const top = y - h + w * 0.06;
  const bh = w * 0.9;
  const cloth = (): void => {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.quadraticCurveTo(x + w * 0.5, top - w * 0.1, x + w, top + w * 0.05);
    if (swallow) {
      ctx.lineTo(x + w * 0.98, top + bh * 1.02);
      ctx.lineTo(x + w * 0.64, top + bh * 0.66);
      ctx.lineTo(x + w * 0.42, top + bh * 0.98);
    } else ctx.quadraticCurveTo(x + w * 1.02, top + bh * 0.5, x + w * 0.98, top + bh);
    ctx.quadraticCurveTo(x + w * 0.4, top + bh * 0.86, x, top + bh * 0.94);
    ctx.closePath();
  };
  cloth();
  ctx.fillStyle = color;
  ctx.fill();
  // Складка: свет у древка, тень к краю — полотнище не плоская заплатка.
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(250, 236, 200, 0.22)');
  g.addColorStop(0.45, 'rgba(250, 236, 200, 0)');
  g.addColorStop(0.62, 'rgba(32, 22, 12, 0.22)');
  g.addColorStop(0.78, 'rgba(32, 22, 12, 0.05)');
  g.addColorStop(1, 'rgba(32, 22, 12, 0.18)');
  ctx.fillStyle = g;
  ctx.fill();
  if (sign === 'cross') {
    ctx.fillStyle = 'rgba(244, 236, 214, 0.88)';
    ctx.fillRect(x + w * 0.4, top + bh * 0.12, w * 0.12, bh * 0.58);
    ctx.fillRect(x + w * 0.22, top + bh * 0.32, w * 0.48, bh * 0.12);
  } else if (sign === 'horns') {
    // Рогатый череп: два рога дугой и лоб — варварский знак, узнаётся и без цвета.
    ctx.strokeStyle = 'rgba(236, 226, 200, 0.92)';
    ctx.lineWidth = w * 0.08;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, top + bh * 0.16);
    ctx.quadraticCurveTo(x + w * 0.26, top + bh * 0.46, x + w * 0.46, top + bh * 0.44);
    ctx.moveTo(x + w * 0.76, top + bh * 0.16);
    ctx.quadraticCurveTo(x + w * 0.7, top + bh * 0.46, x + w * 0.5, top + bh * 0.44);
    ctx.stroke();
    ctx.fillStyle = 'rgba(236, 226, 200, 0.92)';
    ell(ctx, x + w * 0.48, top + bh * 0.56, w * 0.11, bh * 0.15);
    ctx.fill();
  }
  cloth();
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = Math.max(0.014, w * 0.05);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/**
 * Столб дыма: клубы мягкими пятнами, у земли узко и плотно, кверху шире и прозрачнее, сносит вправо
 * (ветер на карте один, как и свет). `dark` — дым пожара: тёмный у огня, светлеет кверху.
 */
function plume(ctx: C, x: number, y: number, h: number, w: number, drift: number, dark: boolean, alpha: number, rnd: () => number): void {
  const n = Math.max(4, Math.round(h / (w * 0.75)));
  const puffs: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    puffs.push([x + drift * t * t + (rnd() - 0.5) * w * 0.35, y - h * t, w * (0.42 + t * 0.7), t]);
  }
  // Верхние клубы — раньше: нижние, плотные, ложатся поверх, и столб растёт из огня, а не падает в него.
  for (let i = puffs.length - 1; i >= 0; i--) {
    const [px, py, rr, t] = puffs[i];
    const c = dark ? [Math.round(56 + t * 118), Math.round(50 + t * 116), Math.round(46 + t * 112)] : [214, 208, 198];
    const a = alpha * (1 - t * 0.62);
    const g = ctx.createRadialGradient(px - rr * 0.3, py - rr * 0.3, 0, px, py, rr);
    g.addColorStop(0, `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`);
    g.addColorStop(0.65, `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a * 0.72})`);
    g.addColorStop(1, `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, rr, 0, TAU);
    ctx.fill();
  }
}

/** Костёр: свечение, камни, крест поленьев и два языка огня. */
function campfire(ctx: C, x: number, y: number, s: number): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, s * 2.2);
  glow.addColorStop(0, 'rgba(255, 176, 80, 0.55)');
  glow.addColorStop(1, 'rgba(255, 176, 80, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, s * 2.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = M.stoneShade;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    ell(ctx, x + Math.cos(a) * s * 0.7, y + Math.sin(a) * s * 0.7 * SQUASH, s * 0.18, s * 0.12);
    ctx.fill();
  }
  ctx.strokeStyle = M.char;
  ctx.lineWidth = s * 0.2;
  ctx.lineCap = 'round';
  line(ctx, x - s * 0.5, y + s * 0.1, x + s * 0.5, y - s * 0.12);
  line(ctx, x - s * 0.45, y - s * 0.14, x + s * 0.48, y + s * 0.1);
  ctx.fillStyle = M.fire;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.42, y);
  ctx.quadraticCurveTo(x - s * 0.36, y - s * 0.8, x - s * 0.02, y - s * 1.25);
  ctx.quadraticCurveTo(x + s * 0.34, y - s * 0.7, x + s * 0.42, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = M.fireCore;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.18, y);
  ctx.quadraticCurveTo(x - s * 0.12, y - s * 0.46, x + s * 0.02, y - s * 0.7);
  ctx.quadraticCurveTo(x + s * 0.16, y - s * 0.4, x + s * 0.2, y);
  ctx.closePath();
  ctx.fill();
}

// ---------- Поля и ограды ----------

/** Поля вокруг места: от, до (середины лоскутов, клетки), сколько лоскутов, мера лоскута. */
type FieldRing = readonly [number, number, number, number];

/** Полуразмах пачки полос за дальний край кольца полей — запас холста (пачка: до 0.42 × 0.44, середина не дальше ¾ кольца). */
const PATCH_REACH = 0.22;

/**
 * Поля вокруг места: межевые клинья из полос пашни, луга и жнивья — земля, которая кормит стену. Полосы
 * лежат пачками по две-четыре рядом, как нарезают надел, и пачки вразброс по кругу: россыпь отдельных
 * лоскутов читалась картами на столе, а кольцо — пирогом (круг 1 стенда объектов).
 */
function fields(ctx: C, f: FieldRing, rnd: () => number): void {
  const [r0, r1, n, k] = f;
  // Подложка: обработанная земля кольцом — желтее и ровнее луга; полосы ложатся на неё лоскутным одеялом,
  // а не карточками на траве (круг 3).
  softPatch(ctx, 0, 0, r1 + 0.16, (r1 + 0.16) * SQUASH, '178, 164, 94', 0.34);
  const blocks = Math.max(4, Math.round(n * 0.62));
  for (let b = 0; b < blocks; b++) {
    const a = (b / blocks) * TAU + (rnd() - 0.5) * (TAU / blocks) * 0.7;
    const r = r0 + rnd() * (r1 - r0) * 0.75;
    const cx = Math.cos(a) * r;
    const cy = Math.sin(a) * r * SQUASH;
    const rot = a + Math.PI / 2 + (rnd() - 0.5) * 0.5;
    const strips = 2 + Math.floor(rnd() * 3);
    const L = (0.28 + rnd() * 0.14) * k;
    const W = (0.075 + rnd() * 0.035) * k;
    for (let i = 0; i < strips; i++) {
      const len = L * (0.82 + rnd() * 0.18);
      const off = (i - (strips - 1) / 2) * W;
      const skew = (rnd() - 0.5) * 0.05 * k;
      const col = M.fields[Math.floor(rnd() * M.fields.length)];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, SQUASH);
      ctx.rotate(rot);
      ctx.translate(skew, off);
      const quad = (): void => {
        ctx.beginPath();
        ctx.moveTo(-len / 2, -W / 2);
        ctx.lineTo(len / 2 + skew, -W / 2);
        ctx.lineTo(len / 2, W / 2);
        ctx.lineTo(-len / 2 - skew, W / 2);
        ctx.closePath();
      };
      quad();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = col;
      ctx.fill();
      // Борозды вдоль полосы и межа по краю.
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = '#4e4428';
      ctx.lineWidth = 0.01;
      for (let j = 1; j < 3; j++) {
        const yy = -W / 2 + (W * j) / 3;
        line(ctx, -len / 2 + 0.01, yy, len / 2 - 0.01, yy);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = M.hedge;
      ctx.lineWidth = 0.016;
      quad();
      ctx.stroke();
      ctx.restore();
    }
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
    g.addColorStop(0, 'rgba(250, 240, 214, 0.3)');
    g.addColorStop(0.5, 'rgba(250, 240, 214, 0)');
    g.addColorStop(1, 'rgba(32, 24, 18, 0.34)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = M.inkSoft;
    ctx.lineWidth = 0.016;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, from, to, false);
    ctx.stroke();
  }
  // Гребень с зубцами.
  ctx.strokeStyle = M.stoneLit;
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h, rx, ry, 0, from, to, false);
  ctx.stroke();
  ctx.fillStyle = M.stoneShade;
  const n = Math.round(36 * rx);
  for (let i = 0; i < n; i++) {
    const a = from + ((i + 0.5) / n) * Math.PI;
    ctx.fillRect(cx + Math.cos(a) * rx - 0.012, cy - h + Math.sin(a) * ry - 0.05, 0.024, 0.035);
  }
}

/**
 * Частокол: кольцо брёвен с заострёнными верхами, по половине за раз. У ближней половины свет на левых
 * брёвнах (наружная сторона смотрит на солнце), у дальней — на правых: видна её внутренняя сторона.
 * Ворота — прореха спереди шириной `gate` (радианы в обе стороны).
 */
function palisade(ctx: C, cx: number, cy: number, r: number, h: number, front: boolean, gate: number, logW: number, dark: boolean): void {
  const ry = r * SQUASH;
  const perim = TAU * Math.sqrt((r * r + ry * ry) / 2);
  const n = Math.max(16, Math.round(perim / logW));
  const w = (perim / n) * 1.12;
  const logs: { x: number; y: number; lit: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.5 / n;
    const s = Math.sin(a);
    if (s > 0 !== front) continue;
    if (gate > 0 && Math.abs(a - Math.PI / 2) < gate) continue;
    logs.push({ x: cx + Math.cos(a) * r, y: cy + s * ry, lit: front ? -Math.cos(a) : Math.cos(a) * 0.6 - 0.3 });
  }
  logs.sort((p, q) => p.y - q.y);
  const base = dark ? M.stake : M.wood;
  const lit = dark ? M.stakeLit : M.woodLit;
  for (const g of logs) {
    ctx.fillStyle = g.lit > 0.25 ? lit : g.lit < -0.3 ? M.woodDark : base;
    ctx.beginPath();
    ctx.moveTo(g.x - w / 2, g.y);
    ctx.lineTo(g.x - w / 2, g.y - h);
    ctx.lineTo(g.x, g.y - h - w * 0.9);
    ctx.lineTo(g.x + w / 2, g.y - h);
    ctx.lineTo(g.x + w / 2, g.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = M.inkSoft;
    ctx.lineWidth = w * 0.18;
    ctx.stroke();
  }
}

/** Плетень деревни: низкая лента из прутьев на кольях. Ворота — прореха спереди. */
function wattle(ctx: C, r: number, h: number, front: boolean, gate: number): void {
  const ry = r * SQUASH;
  const arcs: [number, number][] = front
    ? [
        [0, Math.PI / 2 - gate],
        [Math.PI / 2 + gate, Math.PI],
      ]
    : [[Math.PI, TAU]];
  for (const [a0, a1] of arcs) {
    ctx.beginPath();
    ctx.ellipse(0, -h, r, ry, 0, a0, a1, false);
    ctx.ellipse(0, 0, r, ry, 0, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = front ? M.wattle : M.wattleDark;
    ctx.fill();
    if (front) {
      const g = ctx.createLinearGradient(-r, 0, r, 0);
      g.addColorStop(0, 'rgba(250, 236, 200, 0.25)');
      g.addColorStop(1, 'rgba(32, 22, 12, 0.3)');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.strokeStyle = M.inkSoft;
    ctx.lineWidth = 0.012;
    ctx.stroke();
  }
  // Колья плетня торчат над лентой.
  ctx.strokeStyle = M.woodDark;
  ctx.lineWidth = 0.016;
  ctx.lineCap = 'round';
  const n = Math.round((TAU * r) / 0.1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.3 / n;
    if (Math.sin(a) > 0 !== front) continue;
    if (front && Math.abs(a - Math.PI / 2) < gate) continue;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * ry;
    line(ctx, x, y + 0.004, x, y - h - 0.03);
  }
}

/**
 * Деревянная башня: сруб с лицом и торцом, выносная площадка и шатёр кровли. Возвращает верх кровли —
 * на нём древко знамени ворот.
 */
function timberTower(ctx: C, x: number, y: number, w: number, h: number, roof: Roof, gate = false): number {
  const sx = w * 0.22;
  const sy = w * 0.2;
  ctx.fillStyle = M.shadow;
  ell(ctx, x + w * 0.4, y + 0.01, w * 0.85, w * 0.25);
  ctx.fill();
  ctx.fillStyle = M.wood;
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = M.woodLit;
  ctx.fillRect(x - w / 2, y - h, w * 0.3, h);
  ctx.fillStyle = M.woodDark;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2 + sx, y - sy);
  ctx.lineTo(x + w / 2 + sx, y - sy - h);
  ctx.lineTo(x + w / 2, y - h);
  ctx.closePath();
  ctx.fill();
  // Венцы сруба — тёмные строки поперёк лица.
  ctx.strokeStyle = 'rgba(40, 28, 18, 0.35)';
  ctx.lineWidth = w * 0.05;
  for (let i = 1; i < 4; i++) line(ctx, x - w / 2, y - (h * i) / 4, x + w / 2, y - (h * i) / 4);
  if (gate) {
    ctx.fillStyle = 'rgba(30, 22, 16, 0.92)';
    ctx.beginPath();
    ctx.moveTo(x - w * 0.26, y);
    ctx.lineTo(x - w * 0.26, y - h * 0.42);
    ctx.lineTo(x + w * 0.26, y - h * 0.42);
    ctx.lineTo(x + w * 0.26, y);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(30, 22, 16, 0.8)';
    ctx.fillRect(x - w * 0.06, y - h * 0.72, w * 0.12, h * 0.2);
  }
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = w * 0.06;
  ctx.strokeRect(x - w / 2, y - h, w, h);
  // Площадка шире сруба и шатёр над ней.
  const pw = w * 1.24;
  ctx.fillStyle = M.woodDark;
  ctx.fillRect(x - pw / 2, y - h - w * 0.12, pw, w * 0.14);
  const rt = y - h - w * 0.12;
  const peak = rt - w * 0.78;
  const rf = ROOF[roof];
  ctx.fillStyle = rf.base;
  ctx.beginPath();
  ctx.moveTo(x - pw * 0.58, rt);
  ctx.lineTo(x + pw * 0.58 + sx, rt);
  ctx.lineTo(x + sx * 0.5, peak);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rf.lit;
  ctx.beginPath();
  ctx.moveTo(x - pw * 0.58, rt);
  ctx.lineTo(x, rt);
  ctx.lineTo(x + sx * 0.5, peak);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = w * 0.06;
  ctx.beginPath();
  ctx.moveTo(x - pw * 0.58, rt);
  ctx.lineTo(x + pw * 0.58 + sx, rt);
  ctx.lineTo(x + sx * 0.5, peak);
  ctx.closePath();
  ctx.stroke();
  return peak;
}

/** Высота деревянной башни с шатром — та же мерка, что в `timberTower`. */
const timberTop = (y: number, w: number, h: number): number => y - h - w * 0.12 - w * 0.78;

/** Вышка лагеря: ноги, будка и шатёр — высоты по частям (по ним же считается тело). */
const WATCH = { leg: 0.3, cab: 0.12, roof: 0.16 };

/** Вышка лагеря: четыре ноги, будка и шатёр соломы. Возвращает верх шатра. */
function watchtower(ctx: C, x: number, y: number, s: number): number {
  const w = 0.17 * s;
  const legH = WATCH.leg * s;
  const cabH = WATCH.cab * s;
  ctx.fillStyle = M.shadow;
  ell(ctx, x + w * 0.7, y + 0.01, w * 1.1, w * 0.3);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.strokeStyle = M.woodDark;
  ctx.lineWidth = 0.026 * s;
  line(ctx, x - w * 0.46, y, x - w * 0.34, y - legH);
  line(ctx, x + w * 0.46, y, x + w * 0.34, y - legH);
  ctx.lineWidth = 0.014 * s;
  line(ctx, x - w * 0.42, y - legH * 0.12, x + w * 0.36, y - legH * 0.78);
  line(ctx, x + w * 0.42, y - legH * 0.12, x - w * 0.36, y - legH * 0.78);
  const cy = y - legH;
  ctx.fillStyle = M.wood;
  ctx.fillRect(x - w / 2, cy - cabH, w, cabH);
  ctx.fillStyle = M.woodLit;
  ctx.fillRect(x - w / 2, cy - cabH, w * 0.34, cabH);
  ctx.fillStyle = 'rgba(30, 22, 16, 0.7)';
  ctx.fillRect(x - w * 0.1, cy - cabH * 0.72, w * 0.22, cabH * 0.36);
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = 0.012 * s;
  ctx.strokeRect(x - w / 2, cy - cabH, w, cabH);
  const rt = cy - cabH;
  const peak = rt - WATCH.roof * s;
  ctx.fillStyle = M.thatch;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.7, rt);
  ctx.lineTo(x + w * 0.7, rt);
  ctx.lineTo(x, peak);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = M.thatchLit;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.7, rt);
  ctx.lineTo(x, rt);
  ctx.lineTo(x, peak);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = M.inkSoft;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.7, rt);
  ctx.lineTo(x + w * 0.7, rt);
  ctx.lineTo(x, peak);
  ctx.closePath();
  ctx.stroke();
  return peak;
}

/** Квадратный донжон города: лицо, торец в тени, зубцы и окно. */
function keep(ctx: C, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = M.shadow;
  ell(ctx, x + 0.16, y + 0.02, 0.26, 0.08);
  ctx.fill();
  ctx.fillStyle = M.stone;
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = M.stoneShade;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2 + 0.07, y - 0.06);
  ctx.lineTo(x + w / 2 + 0.07, y - h - 0.06);
  ctx.lineTo(x + w / 2, y - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = M.stoneLit;
  ctx.fillRect(x - w / 2, y - h, w * 0.32, h);
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = 0.014;
  ctx.strokeRect(x - w / 2, y - h, w, h);
  // Зубцы донжона.
  ctx.fillStyle = M.stone;
  for (let i = 0; i < 4; i++) ctx.fillRect(x - w / 2 + i * (w / 3.5), y - h - 0.05, w / 7, 0.05);
  ctx.fillStyle = 'rgba(40, 30, 22, 0.8)';
  ctx.fillRect(x - 0.02, y - h * 0.62, 0.04, 0.08);
  ctx.fillRect(x - 0.02, y - h * 0.34, 0.04, 0.06);
}

const KEEP = { w: 0.22, h: 0.62 };

/** Церковь: неф под кровлей и колокольня со шпилем слева. `s` — мера. */
function church(ctx: C, x: number, y: number, s: number, roof: Roof): void {
  house(ctx, x, y, 0.3 * s, 0.16 * s, roof, 'stone');
  const tx = x - 0.2 * s;
  const ty = y + 0.02 * s;
  const tw = 0.12 * s;
  const th = 0.42 * s;
  ctx.fillStyle = M.stone;
  ctx.fillRect(tx - tw / 2, ty - th, tw, th);
  ctx.fillStyle = M.stoneShade;
  ctx.fillRect(tx + tw * 0.17, ty - th, tw * 0.33, th);
  ctx.fillStyle = M.stoneLit;
  ctx.fillRect(tx - tw / 2, ty - th, tw * 0.3, th);
  ctx.fillStyle = 'rgba(40, 30, 22, 0.8)';
  ctx.fillRect(tx - tw * 0.12, ty - th * 0.86, tw * 0.24, th * 0.16);
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = 0.012 * s;
  ctx.strokeRect(tx - tw / 2, ty - th, tw, th);
  const sh = CHURCH.spire * s;
  ctx.fillStyle = M.slate;
  ctx.beginPath();
  ctx.moveTo(tx - tw * 0.62, ty - th);
  ctx.lineTo(tx + tw * 0.62, ty - th);
  ctx.lineTo(tx, ty - th - sh);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = M.slateLit;
  ctx.beginPath();
  ctx.moveTo(tx - tw * 0.62, ty - th);
  ctx.lineTo(tx, ty - th);
  ctx.lineTo(tx, ty - th - sh);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = M.inkSoft;
  ctx.beginPath();
  ctx.moveTo(tx - tw * 0.62, ty - th);
  ctx.lineTo(tx + tw * 0.62, ty - th);
  ctx.lineTo(tx, ty - th - sh);
  ctx.closePath();
  ctx.stroke();
}

const CHURCH = { tower: 0.42, spire: 0.3 };
const churchTop = (y: number, s: number): number => y + 0.02 * s - (CHURCH.tower + CHURCH.spire) * s;

/** Гарь по площадке разорённого места: пятна под постройками — горело вокруг них, а не на крышах. */
function scorch(ctx: C, r: number, rnd: () => number): void {
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU;
    const k = r * Math.sqrt(rnd()) * 0.95;
    const w = (0.13 + rnd() * 0.11) * Math.max(0.7, r);
    softPatch(ctx, Math.cos(a) * k, Math.sin(a) * k * SQUASH, w, w * SQUASH, '36, 26, 20', 0.78);
  }
}

/**
 * Дым над разорённым местом: два-три столба разной высоты (равные читались бы забором), тёмные у крыш.
 * Верх ограничен потолком холста — столб, посчитанный от размера города, обрезался бы ровной линией.
 */
function sackSmoke(ctx: C, r: number, n: number, ceil: number, ground: number, rnd: () => number): void {
  for (let i = 0; i < n; i++) {
    const x = (n === 2 ? (i - 0.5) * 0.7 : i - 1) * r * 0.55 + (rnd() - 0.5) * 0.06;
    const y = ground - 0.08 - rnd() * 0.08 * r;
    const room = y - ceil;
    const h = room * (0.62 + rnd() * 0.34) * (i === 1 ? 1 : 0.86);
    // Огонь у основания: дым идёт от пожара, а не висит облаком.
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 0.09 + r * 0.05);
    glow.addColorStop(0, 'rgba(255, 150, 60, 0.85)');
    glow.addColorStop(1, 'rgba(255, 150, 60, 0)');
    ctx.fillStyle = glow;
    ell(ctx, x, y, 0.09 + r * 0.05, 0.09 + r * 0.05);
    ctx.fill();
    plume(ctx, x, y, h, 0.11 + r * 0.07, 0.12 + rnd() * 0.12, true, 0.95, rnd);
  }
}

// ---------- Планы мест: где что стоит и как высоко ----------

/** Знамя: древко от (x, y) вверх на `h`, полотнище шириной `w`. */
interface Flag {
  x: number;
  y: number;
  h: number;
  w: number;
}

const flagTop = (f: Flag): number => f.y - f.h - f.w * 0.11;

type Ring = 'none' | 'fence' | 'palisade' | 'stone';

interface CityGeo {
  /** Радиус застройки и ограды по x, клеток. */
  r: number;
  fields: FieldRing;
  houses: number;
  /** Мера дома: ширина от и до. */
  houseW: readonly [number, number];
  ring: Ring;
  ringH: number;
  /** Башен в ограде, без ворот. */
  towers: number;
  /** Доли кровель: черепица, сланец; остальное — солома. Солома — лагерь и деревня, черепица — город. */
  roofs: readonly [number, number];
}

/**
 * Город по стадии: лагерь — горсть изб и вышка без ограды; деревня — дома, церковь и плетень; крепость
 * — частокол с башнями и палата; город — каменная стена с башнями, донжон и церковь. Поля растут вместе с
 * городом: размер миниатюры — размер того, что она изображает.
 */
const CITY: Record<Stage, CityGeo> = {
  camp: { r: 0.38, fields: [0.5, 0.8, 8, 0.72], houses: 6, houseW: [0.13, 0.17], ring: 'none', ringH: 0, towers: 0, roofs: [0.2, 0] },
  village: { r: 0.5, fields: [0.62, 1.04, 13, 0.82], houses: 12, houseW: [0.1, 0.15], ring: 'fence', ringH: 0.06, towers: 0, roofs: [0.42, 0.04] },
  stronghold: { r: 0.66, fields: [0.8, 1.3, 17, 0.92], houses: 17, houseW: [0.1, 0.16], ring: 'palisade', ringH: 0.14, towers: 5, roofs: [0.7, 0.1] },
  town: { r: 0.84, fields: [0.98, 1.56, 22, 1], houses: 26, houseW: [0.11, 0.18], ring: 'stone', ringH: 0.18, towers: 8, roofs: [0.82, 0.18] },
};

const HALL = { w: 0.38, h: 0.15 };
const LONGHOUSE = { w: 0.26, h: 0.11 };
const TIMBER = { w: 0.12, h: 0.24 };
const GATEHOUSE = { w: 0.2, h: 0.26 };
const STONE_TOWER = { back: 0.075, front: 0.08, kBack: 1.55, kFront: 1.6, gate: 0.06, kGate: 1.75 };

/** Башни ограды: поровну между воротами (угол π/2), у ворот башен нет — там свои. */
function ringSpots(r: number, n: number): { x: number; y: number; front: boolean }[] {
  const out: { x: number; y: number; front: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + Math.PI / n + (i / n) * TAU;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * SQUASH, front: Math.sin(a) > 0 });
  }
  return out;
}

interface CityPlan {
  g: CityGeo;
  main: { x: number; y: number };
  church: { x: number; y: number; s: number } | null;
  flag: Flag;
  gateFlag: Flag | null;
  body: Body;
}

/** План города: главное здание, церковь, знамёна и тело. Своё — знамя выше и второе на воротах. */
function cityPlan(stage: Stage, own: boolean): CityPlan {
  const g = CITY[stage];
  const ry = g.r * SQUASH;
  const k = own ? 1.3 : 1;
  const fw = own ? 0.25 : 0.2;
  const tops: number[] = [];
  let main: { x: number; y: number };
  let ch: CityPlan['church'] = null;
  let flag: Flag;
  let gateFlag: Flag | null = null;
  if (stage === 'camp') {
    main = { x: -0.1, y: -0.08 };
    const t = main.y - (WATCH.leg + WATCH.cab + WATCH.roof);
    tops.push(t);
    flag = { x: main.x, y: t + 0.01, h: 0.3 * k, w: fw * 0.9 };
  } else if (stage === 'village') {
    main = { x: -0.15, y: -0.05 };
    ch = { x: 0.19, y: -0.14, s: 0.78 };
    tops.push(houseTop(main.y, LONGHOUSE.w, LONGHOUSE.h));
    flag = { x: 0.03, y: 0.04, h: 0.7 * k, w: fw };
    if (own) gateFlag = { x: 0.12, y: ry + 0.01, h: 0.4, w: 0.15 };
  } else if (stage === 'stronghold') {
    main = { x: -0.1, y: -0.08 };
    ch = { x: 0.3, y: -0.19, s: 0.86 };
    const ht = houseTop(main.y, HALL.w, HALL.h);
    tops.push(ht);
    flag = { x: main.x - HALL.w / 2 + HALL.w * 0.55 * 0.35 + 0.03, y: ht + 0.005, h: 0.42 * k, w: fw };
    const gt = timberTop(ry, GATEHOUSE.w, GATEHOUSE.h);
    tops.push(gt);
    for (const t of ringSpots(g.r, g.towers)) tops.push(timberTop(t.y, TIMBER.w, TIMBER.h));
    if (own) gateFlag = { x: 0.02 + GATEHOUSE.w * 0.11, y: gt + 0.01, h: 0.3, w: 0.14 };
  } else {
    main = { x: -0.12, y: -0.08 };
    ch = { x: 0.3, y: -0.16, s: 1 };
    tops.push(main.y - KEEP.h - 0.05);
    flag = { x: main.x + 0.02, y: main.y - KEEP.h - 0.03, h: 0.38 * k, w: own ? 0.26 : 0.2 };
    for (const t of ringSpots(g.r, g.towers)) {
      const r = t.front ? STONE_TOWER.front : STONE_TOWER.back;
      tops.push(t.y - g.ringH * (t.front ? STONE_TOWER.kFront : STONE_TOWER.kBack) - coneOf(r));
    }
    if (own) gateFlag = { x: 0.14, y: ry - g.ringH * STONE_TOWER.kGate, h: 0.24, w: 0.12 };
  }
  if (ch) tops.push(churchTop(ch.y, ch.s));
  tops.push(flagTop(flag));
  if (gateFlag) tops.push(flagTop(gateFlag));
  const rx = g.r + (g.ring === 'stone' ? 0.09 : g.ring === 'palisade' ? 0.08 : 0.07);
  return { g, main, church: ch, flag, gateFlag, body: { rx, up: -Math.min(...tops), down: ry + 0.06 } };
}

interface CastleGeo {
  r: number;
  towers: number;
  /** Высота скального холма под стеной и его радиус. */
  lift: number;
  knoll: number;
  wallH: number;
  /** Донжон: радиус и высота цилиндра. */
  donjon: readonly [number, number];
  hall: boolean;
  chapel: boolean;
  fields: FieldRing | null;
}

/**
 * Замок по стадии: всегда на холме, всегда каменный, донжон выше всего вокруг под сланцевым конусом —
 * этим замок и отличается от города издали (город широкий и красный, замок высокий и сизый). Стадия
 * добавляет кольцо, башни, палату и часовню.
 */
const CASTLE: Record<Stage, CastleGeo> = {
  camp: { r: 0.3, towers: 3, lift: 0.1, knoll: 0.5, wallH: 0.15, donjon: [0.11, 0.5], hall: false, chapel: false, fields: null },
  village: { r: 0.4, towers: 4, lift: 0.12, knoll: 0.64, wallH: 0.17, donjon: [0.12, 0.58], hall: false, chapel: false, fields: [0.8, 1.06, 9, 0.8] },
  stronghold: { r: 0.54, towers: 6, lift: 0.15, knoll: 0.82, wallH: 0.19, donjon: [0.14, 0.66], hall: true, chapel: false, fields: [0.98, 1.3, 13, 0.9] },
  town: { r: 0.7, towers: 8, lift: 0.18, knoll: 1.02, wallH: 0.21, donjon: [0.16, 0.74], hall: true, chapel: true, fields: [1.14, 1.54, 18, 1] },
};

const CASTLE_TOWER = 0.075;

interface CastlePlan {
  g: CastleGeo;
  donjon: { x: number; y: number };
  flag: Flag;
  body: Body;
}

function castlePlan(stage: Stage, own: boolean): CastlePlan {
  const g = CASTLE[stage];
  const cy = -g.lift;
  const ry = g.r * SQUASH;
  const [dr, dh] = g.donjon;
  const donjon = { x: -0.05, y: cy - ry * 0.2 };
  const coneTip = donjon.y - dh - coneOf(dr);
  const flag: Flag = { x: donjon.x, y: coneTip + 0.02, h: own ? 0.4 : 0.3, w: own ? 0.24 : 0.19 };
  const tops = [coneTip, flagTop(flag)];
  for (const t of ringSpots(g.r, g.towers)) tops.push(cy + t.y - g.wallH * 1.6 - coneOf(CASTLE_TOWER));
  const rx = Math.max(g.knoll, g.r + CASTLE_TOWER + 0.04);
  return { g, donjon, flag, body: { rx, up: -Math.min(...tops), down: g.knoll * SQUASH + 0.02 } };
}

interface LairGeo {
  r: number;
  tents: number;
  ring: 'none' | 'stakes' | 'palisade';
  chief: 'none' | 'long' | 'big';
  /** Древко знамени стана; 0 — знамени нет. */
  flag: number;
}

/**
 * Логово по стадии: стоянка — два шатра у костра; деревня — четыре за кольями; крепость — пять и длинный
 * шатёр вождя, малое знамя; город — военный стан за частоколом, большой шатёр и большое знамя цвета
 * варваров.
 */
const LAIR: Record<Stage, LairGeo> = {
  camp: { r: 0.38, tents: 2, ring: 'none', chief: 'none', flag: 0 },
  village: { r: 0.5, tents: 4, ring: 'stakes', chief: 'none', flag: 0 },
  stronghold: { r: 0.62, tents: 5, ring: 'stakes', chief: 'long', flag: 0.66 },
  town: { r: 0.8, tents: 7, ring: 'palisade', chief: 'big', flag: 1.0 },
};

interface Tent {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LairPlan {
  g: LairGeo;
  tents: Tent[];
  chief: Tent | null;
  pole: { x: number; y: number; h: number };
  fire: { x: number; y: number; s: number };
  flag: Flag | null;
  body: Body;
}

/** Раскладка вариантов: соседние места одного размера не близнецы, но вариантов три (`village.variantOf`). */
const variant3 = (v: number): number => ((Math.round(v) % 3) + 3) % 3;

/** Верх шатра из шкур с жердями над ним — та же мерка, что в `tent`. */
const tentTop = (t: Tent): number => t.y - t.h - t.w * 0.14;

function lairPlan(stage: Stage, variant: number): LairPlan {
  const g = LAIR[stage];
  const rnd = rng(4111 + variant3(variant) * 37 + stageIndex(stage) * 131);
  const ry = g.r * SQUASH;
  const tents: Tent[] = [];
  // Шатры по кругу у костра. Спереди — проход к воротам и шест с черепом, сзади у большого стана — шатёр
  // вождя: эти два сектора шатрам закрыты, остальной круг делится поровну.
  const gateGap = 0.62;
  const backGap = g.chief === 'none' ? 0 : 0.6;
  const free = TAU - gateGap * 2 - backGap * 2;
  for (let i = 0; i < g.tents; i++) {
    let a = Math.PI / 2 + gateGap + ((i + 0.5) / g.tents) * free + (rnd() - 0.5) * (free / g.tents) * 0.35;
    if (backGap > 0 && a > (Math.PI * 3) / 2 - backGap) a += backGap * 2;
    const rr = g.r * (0.56 + rnd() * 0.16);
    const w = 0.23 + rnd() * 0.06 + (stage === 'camp' ? 0.04 : 0);
    tents.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr * SQUASH - 0.02, w, h: w * (0.92 + rnd() * 0.12) });
  }
  const chief: Tent | null =
    g.chief === 'big' ? { x: -0.02, y: -ry * 0.42, w: 0.46, h: 0.36 } : g.chief === 'long' ? { x: 0.02, y: -ry * 0.48, w: 0.38, h: 0.24 } : null;
  const pole = { x: -g.r * 0.34, y: ry * 0.6, h: stage === 'camp' ? 0.36 : 0.42 };
  const fire = { x: 0.02, y: 0.02, s: 0.06 + g.r * 0.04 };
  const flag: Flag | null = g.flag > 0 ? { x: g.r * 0.4, y: -ry * 0.34, h: g.flag, w: g.flag * 0.4 } : null;
  const tops = tents.map(tentTop);
  if (chief) tops.push(tentTop(chief));
  tops.push(pole.y - pole.h - 0.1);
  if (flag) tops.push(flagTop(flag));
  const ringH = g.ring === 'none' ? 0 : 0.21;
  tops.push(-ry - ringH);
  const front = Math.max(ry + 0.05, ...tents.map((t) => t.y + 0.02));
  return { g, tents, chief, pole, fire, flag, body: { rx: g.r + 0.08, up: -Math.min(...tops), down: front } };
}

/** Пепелище по стадии сгоревшего логова: чем больше было, тем шире выжженное пятно. */
const RUIN_R: Record<Stage, number> = { camp: 0.3, village: 0.4, stronghold: 0.5, town: 0.62 };
const RUIN_FRAMES: Record<Stage, number> = { camp: 1, village: 2, stronghold: 3, town: 4 };

interface RuinPlan {
  r: number;
  frames: Tent[];
  body: Body;
}

function ruinPlan(stage: Stage, variant: number): RuinPlan {
  const r = RUIN_R[stage];
  const rnd = rng(9001 + variant3(variant) * 53 + stageIndex(stage) * 17);
  const frames: Tent[] = [];
  const n = RUIN_FRAMES[stage];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + ((i + 0.5) / n) * TAU + (rnd() - 0.5) * 0.5;
    const rr = n === 1 ? 0.06 : r * (0.38 + rnd() * 0.2);
    const w = 0.16 + rnd() * 0.05;
    frames.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr * SQUASH, w, h: w * 1.05 });
  }
  const up = -Math.min(...frames.map((f) => f.y - f.h - 0.02));
  return { r, frames, body: { rx: r * 1.08, up, down: r * SQUASH * 1.08 } };
}

// ---------- Город ----------

function cityPlace(ctx: C, l: PlaceLook, span: Span): void {
  const plan = cityPlan(l.stage, l.own);
  const g = plan.g;
  const rnd = rng(31337 + variant3(l.variant) * 101 + stageIndex(l.stage) * 7919);
  // Разорение — своей костью: разорённый город стоит теми же домами, что и целый, меняются только копоть и дым.
  const soot = rng(424243 + variant3(l.variant) * 13 + stageIndex(l.stage) * 7);
  const r = g.r;
  const ry = r * SQUASH;
  shadowBlob(ctx, 0.1, 0.07, r * 1.35, r * 0.72, 0.75);
  fields(ctx, g.fields, rnd);
  // Площадка: внутри ограды — утоптанная земля с подолом; у лагеря — мягкое пятно без края.
  if (g.ring === 'none') {
    softPatch(ctx, 0, 0.02, r * 1.45, r * 1.45 * SQUASH, '125, 108, 80', 0.85);
  } else {
    ctx.fillStyle = M.groundDark;
    ell(ctx, 0, 0.02, r * 1.08, ry * 1.08);
    ctx.fill();
    ctx.fillStyle = M.ground;
    ell(ctx, 0, 0, r, ry);
    ctx.fill();
  }
  if (l.sacked) scorch(ctx, r, soot);

  // Дальняя половина ограды — до домов.
  const towers = g.ring === 'stone' || g.ring === 'palisade' ? ringSpots(r, g.towers) : [];
  if (g.ring === 'fence') wattle(ctx, r, g.ringH, false, 0.2);
  if (g.ring === 'palisade') palisade(ctx, 0, 0, r, g.ringH, false, 0, 0.042, false);
  if (g.ring === 'stone') wallArc(ctx, 0, 0, r, g.ringH, false);
  for (const t of towers.filter((t) => !t.front)) {
    if (g.ring === 'stone') roundTower(ctx, t.x, t.y, STONE_TOWER.back, g.ringH * STONE_TOWER.kBack, rnd() < 0.5 ? 'tile' : 'slate');
    else timberTower(ctx, t.x, t.y, TIMBER.w, TIMBER.h, 'thatch');
  }

  // Застройка: дома, главное здание и церковь. Глубже — раньше, ближе — позже (порядок художника).
  type Piece = { y: number; draw: () => void };
  const pieces: Piece[] = [];
  const burnt = (): boolean => l.sacked && soot() < 0.38;
  const { main, church: ch, flag } = plan;
  const flagPiece = (f: Flag, swallow: boolean): void => banner(ctx, f.x, f.y, f.h, f.w, l.color, swallow);
  if (l.stage === 'camp') {
    pieces.push({
      y: main.y,
      draw: () => {
        watchtower(ctx, main.x, main.y, 1);
        flagPiece(flag, l.own);
      },
    });
  } else if (l.stage === 'village') {
    const roof: Roof = burnt() ? 'burnt' : 'thatch';
    pieces.push({ y: main.y, draw: () => house(ctx, main.x, main.y, LONGHOUSE.w, LONGHOUSE.h, roof, 'plaster') });
    pieces.push({ y: flag.y, draw: () => flagPiece(flag, l.own) });
  } else if (l.stage === 'stronghold') {
    const roof: Roof = burnt() ? 'burnt' : 'tile';
    pieces.push({
      y: main.y,
      draw: () => {
        house(ctx, main.x, main.y, HALL.w, HALL.h, roof, 'plaster');
        flagPiece(flag, l.own);
      },
    });
  } else {
    pieces.push({
      y: main.y,
      draw: () => {
        keep(ctx, main.x, main.y, KEEP.w, KEEP.h);
        flagPiece(flag, l.own);
      },
    });
  }
  if (ch) {
    const roof: Roof = burnt() ? 'burnt' : l.stage === 'village' ? 'thatch' : 'slate';
    pieces.push({ y: ch.y, draw: () => church(ctx, ch.x, ch.y, ch.s, roof) });
  }
  const avoid: [number, number, number][] = [[main.x, main.y, l.stage === 'town' ? 0.2 : 0.18]];
  if (ch) avoid.push([ch.x - 0.06 * ch.s, ch.y, 0.24 * ch.s]);
  avoid.push([flag.x, flag.y, 0.05]);
  const inner = g.ring === 'none' ? 0.98 : 0.86;
  let made = 0;
  for (let i = 0; made < g.houses && i < g.houses * 3; i++) {
    const a = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * inner;
    const x = Math.cos(a) * r * rr;
    const y = Math.sin(a) * ry * rr * 0.92 + 0.03;
    if (avoid.some(([ax, ay, d]) => Math.hypot(x - ax, (y - ay) / SQUASH) < d)) continue;
    // Проход от ворот к середине свободен: ворота видны, а не заставлены избами.
    if (g.ring !== 'none' && y > ry * 0.45 && Math.abs(x - 0.02) < 0.09) continue;
    const w = g.houseW[0] + rnd() * (g.houseW[1] - g.houseW[0]);
    const h = w * (0.55 + rnd() * 0.25);
    const p = rnd();
    const roof: Roof = burnt() ? 'burnt' : p < g.roofs[0] ? 'tile' : p < g.roofs[0] + g.roofs[1] ? 'slate' : 'thatch';
    const wall = rnd() < (l.stage === 'town' ? 0.55 : 0.75) ? 'plaster' : 'stone';
    pieces.push({ y, draw: () => house(ctx, x, y, w, h, roof, wall) });
    made++;
  }
  pieces.sort((a, b) => a.y - b.y);
  for (const p of pieces) p.draw();

  // Ближняя половина ограды, ворота и знамя на воротах — после домов.
  const gx = 0.02;
  if (g.ring === 'fence') {
    wattle(ctx, r, g.ringH, true, 0.2);
    ctx.strokeStyle = M.woodDark;
    ctx.lineWidth = 0.026;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) line(ctx, gx + s * 0.08, ry + 0.01, gx + s * 0.08, ry - g.ringH - 0.07);
  }
  if (g.ring === 'palisade') {
    palisade(ctx, 0, 0, r, g.ringH, true, 0.16, 0.042, false);
    for (const t of towers.filter((t) => t.front).sort((a, b) => a.y - b.y)) timberTower(ctx, t.x, t.y, TIMBER.w, TIMBER.h, 'thatch');
    timberTower(ctx, gx, ry, GATEHOUSE.w, GATEHOUSE.h, 'tile', true);
  }
  if (g.ring === 'stone') {
    wallArc(ctx, 0, 0, r, g.ringH, true);
    for (const t of towers.filter((t) => t.front).sort((a, b) => a.y - b.y)) roundTower(ctx, t.x, t.y, STONE_TOWER.front, g.ringH * STONE_TOWER.kFront, 'tile');
    // Ворота: тёмная арка и две башни с зубцами.
    ctx.fillStyle = 'rgba(30, 22, 16, 0.92)';
    ctx.beginPath();
    ctx.moveTo(gx - 0.05, ry);
    ctx.lineTo(gx - 0.05, ry - 0.08);
    ctx.arc(gx, ry - 0.08, 0.05, Math.PI, 0);
    ctx.lineTo(gx + 0.05, ry);
    ctx.closePath();
    ctx.fill();
    roundTower(ctx, gx - 0.12, ry + 0.005, STONE_TOWER.gate, g.ringH * STONE_TOWER.kGate, 'none');
    roundTower(ctx, gx + 0.12, ry + 0.005, STONE_TOWER.gate, g.ringH * STONE_TOWER.kGate, 'none');
  }
  if (plan.gateFlag) banner(ctx, plan.gateFlag.x, plan.gateFlag.y, plan.gateFlag.h, plan.gateFlag.w, l.color, false);
  if (l.sacked) sackSmoke(ctx, r, l.stage === 'camp' || l.stage === 'village' ? 2 : 3, -span.ay + 0.14, 0, soot);
}

// ---------- Замок ----------

/**
 * Скальный холм под замком: низкая плита с освещённым левым склоном и каменными уступами. Замок стоит
 * над землёй — силуэт выше и плотнее, чем у города той же стадии.
 */
function knoll(ctx: C, rx: number, lift: number, rnd: () => number): void {
  const ry = rx * SQUASH;
  const tx = rx * 0.84;
  const ty = ry * 0.84;
  ctx.fillStyle = M.rockShade;
  ell(ctx, 0, 0, rx, ry);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -lift, tx, ty, 0, 0, Math.PI, false);
  ctx.ellipse(0, 0, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  const g = ctx.createLinearGradient(-rx, 0, rx, 0);
  g.addColorStop(0, M.rockLit);
  g.addColorStop(0.45, M.rock);
  g.addColorStop(1, M.rockShade);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = 0.014;
  ctx.stroke();
  // Уступы: короткие тёмные штрихи по склону.
  ctx.strokeStyle = 'rgba(48, 40, 30, 0.45)';
  ctx.lineWidth = 0.012;
  for (let i = 0; i < 14; i++) {
    const a = 0.15 + rnd() * (Math.PI - 0.3);
    const k = 0.9 + rnd() * 0.08;
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k - lift * (0.3 + rnd() * 0.5);
    line(ctx, x, y, x + (rnd() - 0.3) * 0.06, y + 0.012);
  }
  ctx.fillStyle = M.groundDark;
  ell(ctx, 0, -lift, tx, ty);
  ctx.fill();
}

/** Донжон замка: высокий круглый цилиндр под сланцевым конусом и лестничная башенка сбоку. */
function donjon(ctx: C, x: number, y: number, r: number, h: number): void {
  ctx.fillStyle = M.shadow;
  ell(ctx, x + r * 1.6, y + 0.02, r * 2.2, r * 0.6);
  ctx.fill();
  roundTower(ctx, x, y, r, h, 'slate');
  // Окна-бойницы и пояс машикулей под кровлей.
  ctx.fillStyle = 'rgba(36, 28, 20, 0.8)';
  for (const t of [0.3, 0.55, 0.78]) ctx.fillRect(x - r * 0.3, y - h * t, r * 0.18, r * 0.42);
  ctx.fillStyle = M.stoneShade;
  ctx.fillRect(x - r, y - h + r * 0.1, r * 2, r * 0.16);
  roundTower(ctx, x + r * 0.98, y + r * 0.3, r * 0.46, h * 0.78, 'slate');
}

function castlePlace(ctx: C, l: PlaceLook, span: Span): void {
  const plan = castlePlan(l.stage, l.own);
  const g = plan.g;
  const rnd = rng(7717 + variant3(l.variant) * 59 + stageIndex(l.stage) * 313);
  const soot = rng(515153 + variant3(l.variant) * 11 + stageIndex(l.stage) * 5);
  const cy = -g.lift;
  const r = g.r;
  const ry = r * SQUASH;
  shadowBlob(ctx, 0.12, 0.06, g.knoll * 1.3, g.knoll * 0.72, 0.85);
  if (g.fields) fields(ctx, g.fields, rnd);
  knoll(ctx, g.knoll, g.lift, rnd);
  ctx.save();
  ctx.translate(0, cy);
  if (l.sacked) scorch(ctx, r, soot);
  const towers = ringSpots(r, g.towers);
  wallArc(ctx, 0, 0, r, g.wallH, false);
  for (const t of towers.filter((t) => !t.front)) roundTower(ctx, t.x, t.y, CASTLE_TOWER, g.wallH * 1.6, 'slate');
  type Piece = { y: number; draw: () => void };
  const pieces: Piece[] = [];
  const dj = { x: plan.donjon.x, y: plan.donjon.y - cy };
  pieces.push({
    y: dj.y,
    draw: () => {
      donjon(ctx, dj.x, dj.y, g.donjon[0], g.donjon[1]);
      banner(ctx, plan.flag.x, plan.flag.y - cy, plan.flag.h, plan.flag.w, l.color, l.own);
    },
  });
  if (g.hall) {
    const hx = r * 0.38;
    const hy = ry * 0.12;
    const roof: Roof = l.sacked ? 'burnt' : 'slate';
    pieces.push({ y: hy, draw: () => house(ctx, hx, hy, 0.26, 0.12, roof, 'stone') });
  }
  if (g.chapel) {
    const cx = -r * 0.48;
    const cyy = ry * 0.2;
    pieces.push({ y: cyy, draw: () => church(ctx, cx, cyy, 0.66, l.sacked ? 'burnt' : 'slate') });
  }
  const extra = l.stage === 'town' ? 5 : l.stage === 'stronghold' ? 3 : l.stage === 'village' ? 1 : 0;
  for (let i = 0; i < extra; i++) {
    const a = rnd() * TAU;
    const rr = 0.45 + rnd() * 0.35;
    const x = Math.cos(a) * r * rr;
    const y = Math.sin(a) * ry * rr * 0.8 + 0.02;
    if (Math.hypot(x - dj.x, (y - dj.y) / SQUASH) < g.donjon[0] * 2.4) continue;
    const w = 0.1 + rnd() * 0.05;
    const roof: Roof = l.sacked && soot() < 0.5 ? 'burnt' : rnd() < 0.7 ? 'slate' : 'tile';
    pieces.push({ y, draw: () => house(ctx, x, y, w, w * 0.62, roof, 'stone') });
  }
  pieces.sort((a, b) => a.y - b.y);
  for (const p of pieces) p.draw();
  wallArc(ctx, 0, 0, r, g.wallH, true);
  for (const t of towers.filter((t) => t.front).sort((a, b) => a.y - b.y)) roundTower(ctx, t.x, t.y, CASTLE_TOWER + 0.005, g.wallH * 1.6, 'slate');
  // Надвратная башня: арка и две башни под конусами.
  const gx = 0.02;
  ctx.fillStyle = 'rgba(30, 22, 16, 0.92)';
  ctx.beginPath();
  ctx.moveTo(gx - 0.045, ry);
  ctx.lineTo(gx - 0.045, ry - 0.08);
  ctx.arc(gx, ry - 0.08, 0.045, Math.PI, 0);
  ctx.lineTo(gx + 0.045, ry);
  ctx.closePath();
  ctx.fill();
  roundTower(ctx, gx - 0.1, ry + 0.005, 0.055, g.wallH * 1.8, 'slate');
  roundTower(ctx, gx + 0.1, ry + 0.005, 0.055, g.wallH * 1.8, 'slate');
  ctx.restore();
  if (l.sacked) sackSmoke(ctx, r, l.stage === 'camp' || l.stage === 'village' ? 2 : 3, -span.ay + 0.14, cy, soot);
}

// ---------- Логово ----------

/** Шатёр из шкур: конус, светлый левый скат, тёмный вход и жерди крест-накрест над верхом. */
function tent(ctx: C, t: Tent): void {
  const { x, y, w, h } = t;
  ctx.fillStyle = M.shadow;
  ell(ctx, x + w * 0.22, y + 0.005, w * 0.62, w * 0.2);
  ctx.fill();
  ctx.strokeStyle = M.stake;
  ctx.lineWidth = w * 0.07;
  ctx.lineCap = 'round';
  line(ctx, x - w * 0.12, y - h - w * 0.14, x + w * 0.06, y - h * 0.86);
  line(ctx, x + w * 0.13, y - h - w * 0.12, x - w * 0.04, y - h * 0.86);
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x - w * 0.2, y - h * 0.52, x, y - h);
  ctx.quadraticCurveTo(x + w * 0.2, y - h * 0.52, x + w / 2, y);
  ctx.closePath();
  ctx.fillStyle = M.hideDark;
  ctx.fill();
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = w * 0.05;
  ctx.stroke();
  ctx.fillStyle = M.hideLit;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x - w * 0.2, y - h * 0.52, x, y - h);
  ctx.lineTo(x + w * 0.04, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = M.hide;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.18, y);
  ctx.lineTo(x - w * 0.02, y - h * 0.7);
  ctx.lineTo(x + w * 0.04, y);
  ctx.closePath();
  ctx.fill();
  // Швы шкур — две тёмные строки поперёк.
  ctx.strokeStyle = 'rgba(48, 32, 20, 0.4)';
  ctx.lineWidth = w * 0.03;
  for (const k of [0.36, 0.64]) line(ctx, x - w * 0.5 * (1 - k) - w * 0.02, y - h * k, x + w * 0.5 * (1 - k) + w * 0.02, y - h * k);
  ctx.fillStyle = 'rgba(30, 20, 14, 0.88)';
  ctx.beginPath();
  ctx.moveTo(x - w * 0.08, y);
  ctx.lineTo(x + w * 0.03, y - h * 0.44);
  ctx.lineTo(x + w * 0.12, y);
  ctx.closePath();
  ctx.fill();
}

/** Шатёр вождя: длинный, на двух жердях, вход посередине; у большого — шкура с рогами над входом. */
function chiefTent(ctx: C, t: Tent, horns: boolean): void {
  const { x, y, w, h } = t;
  ctx.fillStyle = M.shadow;
  ell(ctx, x + w * 0.2, y + 0.01, w * 0.62, w * 0.18);
  ctx.fill();
  const rx = w * 0.22;
  ctx.strokeStyle = M.stake;
  ctx.lineWidth = w * 0.045;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    line(ctx, x + s * rx - w * 0.06, y - h - w * 0.12, x + s * rx + w * 0.03, y - h * 0.86);
    line(ctx, x + s * rx + w * 0.06, y - h - w * 0.12, x + s * rx - w * 0.03, y - h * 0.86);
  }
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x - w * 0.38, y - h * 0.6, x - rx, y - h);
  ctx.lineTo(x + rx, y - h);
  ctx.quadraticCurveTo(x + w * 0.38, y - h * 0.6, x + w / 2, y);
  ctx.closePath();
  ctx.fillStyle = M.hideDark;
  ctx.fill();
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = w * 0.03;
  ctx.stroke();
  ctx.fillStyle = M.hideLit;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x - w * 0.38, y - h * 0.6, x - rx, y - h);
  ctx.lineTo(x - w * 0.02, y - h);
  ctx.lineTo(x - w * 0.05, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = M.hide;
  ctx.fillRect(x - w * 0.05, y - h, w * 0.18, h);
  ctx.fillStyle = 'rgba(30, 20, 14, 0.9)';
  ctx.beginPath();
  ctx.moveTo(x - w * 0.07, y);
  ctx.lineTo(x + w * 0.02, y - h * 0.5);
  ctx.lineTo(x + w * 0.11, y);
  ctx.closePath();
  ctx.fill();
  if (horns) {
    ctx.strokeStyle = M.bone;
    ctx.lineWidth = w * 0.035;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.12, y - h * 0.86);
    ctx.quadraticCurveTo(x - w * 0.1, y - h * 0.66, x + w * 0.02, y - h * 0.68);
    ctx.moveTo(x + w * 0.16, y - h * 0.86);
    ctx.quadraticCurveTo(x + w * 0.14, y - h * 0.66, x + w * 0.02, y - h * 0.68);
    ctx.stroke();
    ctx.fillStyle = M.bone;
    ell(ctx, x + w * 0.02, y - h * 0.62, w * 0.04, w * 0.05);
    ctx.fill();
  }
}

/** Череп на шесте: шест, перекладина с лоскутами и рогатый череп — знак стоянки, читается силуэтом. */
function skullPole(ctx: C, x: number, y: number, h: number): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = 0.045;
  line(ctx, x, y, x, y - h);
  ctx.strokeStyle = M.stake;
  ctx.lineWidth = 0.026;
  line(ctx, x, y, x, y - h);
  ctx.lineWidth = 0.02;
  line(ctx, x - 0.08, y - h * 0.74, x + 0.08, y - h * 0.78);
  ctx.strokeStyle = '#8e3a26';
  ctx.lineWidth = 0.022;
  line(ctx, x - 0.06, y - h * 0.74, x - 0.07, y - h * 0.52);
  ctx.strokeStyle = M.hideLit;
  line(ctx, x + 0.06, y - h * 0.77, x + 0.065, y - h * 0.58);
  // Рога шире черепа: на 16 px рогатый шест узнаётся по рогам.
  ctx.strokeStyle = M.bone;
  ctx.lineWidth = 0.022;
  ctx.beginPath();
  ctx.moveTo(x - 0.03, y - h - 0.05);
  ctx.quadraticCurveTo(x - 0.1, y - h - 0.06, x - 0.1, y - h - 0.13);
  ctx.moveTo(x + 0.03, y - h - 0.05);
  ctx.quadraticCurveTo(x + 0.1, y - h - 0.06, x + 0.1, y - h - 0.13);
  ctx.stroke();
  ctx.fillStyle = M.bone;
  ell(ctx, x, y - h - 0.035, 0.042, 0.048);
  ctx.fill();
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = 0.008;
  ctx.stroke();
  ctx.fillStyle = 'rgba(32, 22, 16, 0.9)';
  ctx.fillRect(x - 0.024, y - h - 0.048, 0.016, 0.016);
  ctx.fillRect(x + 0.008, y - h - 0.048, 0.016, 0.016);
}

/** Колья вокруг стана: заострённые, клонятся наружу, с прорехой входа спереди. */
function stakeRing(ctx: C, r: number, front: boolean, rnd: () => number): void {
  const ry = r * SQUASH;
  const n = Math.round(56 * r);
  ctx.lineCap = 'round';
  const spots: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const h = 0.12 + rnd() * 0.05;
    if (Math.sin(a) > 0 !== front) continue;
    if (Math.abs(a - Math.PI / 2) < 0.3) continue;
    spots.push([Math.cos(a) * r, Math.sin(a) * ry, a, h]);
  }
  spots.sort((p, q) => p[1] - q[1]);
  for (const [x, y, a, h] of spots) {
    const tx = x + Math.cos(a) * 0.05;
    const ty = y - h + Math.sin(a) * 0.05 * SQUASH;
    ctx.strokeStyle = M.ink;
    ctx.lineWidth = 0.04;
    line(ctx, x, y, tx, ty);
    ctx.strokeStyle = Math.cos(a) < 0.2 ? M.stakeLit : M.stake;
    ctx.lineWidth = 0.022;
    line(ctx, x, y, tx, ty);
    ctx.fillStyle = M.bone;
    ell(ctx, tx, ty, 0.01, 0.01);
    ctx.fill();
  }
}

function lairPlace(ctx: C, l: PlaceLook, span: Span): void {
  const plan = lairPlan(l.stage, l.variant);
  const g = plan.g;
  const rnd = rng(5323 + variant3(l.variant) * 41 + stageIndex(l.stage) * 97);
  const r = g.r;
  const ry = r * SQUASH;
  shadowBlob(ctx, 0.08, 0.06, r * 1.4, r * 0.75, 0.6);
  // Утоптанная земля стана светлее шатров: шкура на шкуре не читается (круг 1).
  softPatch(ctx, 0, 0.02, r * 1.45, r * 1.45 * SQUASH, '120, 98, 66', 0.75);
  ctx.fillStyle = '#9a835c';
  ell(ctx, 0, 0, r * 1.02, ry * 1.02);
  ctx.fill();
  ctx.fillStyle = '#b8a27a';
  ell(ctx, -0.03, -0.015, r * 0.8, ry * 0.8);
  ctx.fill();
  // Кости и шкуры по утоптанному.
  for (let i = 0; i < 6 + g.tents; i++) {
    const a = rnd() * TAU;
    const k = r * (0.3 + rnd() * 0.6);
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(230, 220, 196, 0.7)' : 'rgba(94, 70, 48, 0.7)';
    ell(ctx, Math.cos(a) * k, Math.sin(a) * k * SQUASH, 0.025, 0.01);
    ctx.fill();
  }
  if (g.ring === 'stakes') stakeRing(ctx, r, false, rnd);
  if (g.ring === 'palisade') palisade(ctx, 0, 0, r, 0.11, false, 0, 0.045, true);
  type Piece = { y: number; draw: () => void };
  const pieces: Piece[] = [];
  for (const t of plan.tents) pieces.push({ y: t.y, draw: () => tent(ctx, t) });
  const chief = plan.chief;
  if (chief) pieces.push({ y: chief.y, draw: () => chiefTent(ctx, chief, g.chief === 'big') });
  pieces.push({ y: plan.pole.y, draw: () => skullPole(ctx, plan.pole.x, plan.pole.y, plan.pole.h) });
  const f = plan.flag;
  if (f) pieces.push({ y: f.y, draw: () => banner(ctx, f.x, f.y, f.h, f.w, l.color, l.stage === 'town', 'horns') });
  const fire = plan.fire;
  pieces.push({ y: fire.y, draw: () => campfire(ctx, fire.x, fire.y, fire.s) });
  pieces.sort((a, b) => a.y - b.y);
  for (const p of pieces) p.draw();
  // Дым костра — тонкий и светлый: стан живёт, а не горит.
  plume(ctx, fire.x + 0.01, fire.y - fire.s * 1.2, Math.min(0.75, span.ay - 0.1 + fire.y - fire.s * 1.2), 0.05 + r * 0.03, 0.14, false, 0.5, rnd);
  if (g.ring === 'stakes') stakeRing(ctx, r, true, rnd);
  if (g.ring === 'palisade') {
    palisade(ctx, 0, 0, r, 0.11, true, 0.18, 0.045, true);
    // Ворота стана: два столба с черепами.
    for (const s of [-1, 1]) skullPole(ctx, 0.02 + s * 0.12, ry + 0.01, 0.2);
  }
}

// ---------- Пепелище ----------

/** Обгоревший остов шатра: три жерди сходятся к верху, одна сломана. */
function charredFrame(ctx: C, t: Tent, rnd: () => number): void {
  const { x, y, w, h } = t;
  ctx.fillStyle = 'rgba(28, 22, 18, 0.5)';
  ell(ctx, x + w * 0.1, y, w * 0.55, w * 0.18);
  ctx.fill();
  ctx.lineCap = 'round';
  const feet: [number, number][] = [
    [x - w * 0.48, y],
    [x + w * 0.46, y + 0.005],
    [x + w * 0.08, y - w * 0.16],
  ];
  const broken = Math.floor(rnd() * 3);
  feet.forEach(([fx, fy], i) => {
    const k = i === broken ? 0.45 + rnd() * 0.15 : 1;
    const tx = fx + (x - fx) * k;
    const ty = fy + (y - h - fy) * k;
    ctx.strokeStyle = M.char;
    ctx.lineWidth = w * 0.11;
    line(ctx, fx, fy, tx, ty);
    ctx.strokeStyle = M.charLit;
    ctx.lineWidth = w * 0.035;
    line(ctx, fx - w * 0.015, fy, tx - w * 0.015, ty);
  });
}

function ruinPlace(ctx: C, l: PlaceLook, span: Span): void {
  const plan = ruinPlan(l.stage, l.variant);
  const r = plan.r;
  const rnd = rng(6007 + variant3(l.variant) * 71 + stageIndex(l.stage) * 29);
  shadowBlob(ctx, 0.06, 0.04, r * 1.3, r * 0.7, 0.4);
  // Выжженное пятно неровным краем.
  const n = 16;
  const rad: number[] = [];
  for (let i = 0; i < n; i++) rad.push(r * (0.92 + rnd() * 0.24));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * TAU;
    const x = Math.cos(a) * rad[i % n];
    const y = Math.sin(a) * rad[i % n] * SQUASH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = M.ashGround;
  ctx.fill();
  ctx.strokeStyle = M.ashEdge;
  ctx.lineWidth = 0.03;
  ctx.stroke();
  softPatch(ctx, 0, 0, r * 0.7, r * 0.7 * SQUASH, '34, 28, 24', 0.6);
  ctx.fillStyle = M.ash;
  for (let i = 0; i < 10 + RUIN_FRAMES[l.stage] * 3; i++) {
    const a = rnd() * TAU;
    const k = r * Math.sqrt(rnd()) * 0.9;
    ell(ctx, Math.cos(a) * k, Math.sin(a) * k * SQUASH, 0.04 + rnd() * 0.04, 0.016 + rnd() * 0.012);
    ctx.fill();
  }
  type Piece = { y: number; draw: () => void };
  const pieces: Piece[] = [];
  // Пеньки сгоревших кольев по кругу — от деревни и выше: тут стоял частокол.
  if (l.stage !== 'camp') {
    const m = Math.round(26 * r);
    for (let i = 0; i < m; i++) {
      if (rnd() < 0.3) continue;
      const a = (i / m) * TAU;
      const x = Math.cos(a) * r * 0.96;
      const y = Math.sin(a) * r * 0.96 * SQUASH;
      const h = 0.03 + rnd() * 0.05;
      pieces.push({
        y,
        draw: () => {
          ctx.strokeStyle = M.char;
          ctx.lineWidth = 0.026;
          ctx.lineCap = 'round';
          line(ctx, x, y, x + (rnd() - 0.5) * 0.02, y - h);
        },
      });
    }
  }
  for (const t of plan.frames) pieces.push({ y: t.y, draw: () => charredFrame(ctx, t, rnd) });
  pieces.sort((a, b) => a.y - b.y);
  for (const p of pieces) p.draw();
  // Тлеющие угли и тонкая струйка дыма: кончилось, а не идёт.
  ctx.fillStyle = 'rgba(232, 120, 52, 0.7)';
  for (let i = 0; i < 4; i++) {
    const a = rnd() * TAU;
    const k = r * rnd() * 0.5;
    ell(ctx, Math.cos(a) * k, Math.sin(a) * k * SQUASH, 0.012, 0.008);
    ctx.fill();
  }
  plume(ctx, 0.02, -0.04, Math.min(0.62, span.ay - 0.14), 0.035, 0.12, false, 0.34, rnd);
}

// ---------- Войско ----------

/** Мера фигурки: воин в клетку с лишним — армию ищут глазами первой, как на карте кампании. */
const MAN = 1.4;

/**
 * Воин: ноги, кольчуга, накидка цвета стороны, щит-капля, шлем и копьё; контур чернилами. Пропорции
 * коренастые, как у фигурки на подставке: тонкий человек на 16 px на клетку — две чёрточки (круг 1).
 */
function soldier(ctx: C, x: number, y: number, s: number, color: string): void {
  const k = s * MAN;
  const dark = mix(color, '#2a1c12', 0.42);
  ctx.fillStyle = M.steelDark;
  ctx.fillRect(x - 0.062 * k, y - 0.17 * k, 0.052 * k, 0.17 * k);
  ctx.fillRect(x + 0.01 * k, y - 0.17 * k, 0.052 * k, 0.17 * k);
  // Копьё — за телом.
  ctx.lineCap = 'round';
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = 0.038 * k;
  line(ctx, x + 0.11 * k, y - 0.02 * k, x + 0.11 * k, y - SPEAR * k + 0.08 * k);
  ctx.strokeStyle = M.timber;
  ctx.lineWidth = 0.02 * k;
  line(ctx, x + 0.11 * k, y - 0.02 * k, x + 0.11 * k, y - SPEAR * k + 0.08 * k);
  ctx.beginPath();
  ctx.moveTo(x + 0.088 * k, y - SPEAR * k + 0.1 * k);
  ctx.lineTo(x + 0.11 * k, y - SPEAR * k);
  ctx.lineTo(x + 0.132 * k, y - SPEAR * k + 0.1 * k);
  ctx.closePath();
  ctx.fillStyle = M.steel;
  ctx.fill();
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = 0.01 * k;
  ctx.stroke();
  // Плечи в кольчуге и накидка трапецией.
  ctx.fillStyle = M.steel;
  ctx.fillRect(x - 0.095 * k, y - 0.39 * k, 0.19 * k, 0.1 * k);
  ctx.beginPath();
  ctx.moveTo(x - 0.085 * k, y - 0.37 * k);
  ctx.lineTo(x + 0.085 * k, y - 0.37 * k);
  ctx.lineTo(x + 0.105 * k, y - 0.13 * k);
  ctx.lineTo(x - 0.105 * k, y - 0.13 * k);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = 0.016 * k;
  ctx.stroke();
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(x + 0.02 * k, y - 0.365 * k, 0.075 * k, 0.23 * k);
  ctx.globalAlpha = 1;
  // Пояс и рука с копьём.
  ctx.fillStyle = M.woodDark;
  ctx.fillRect(x - 0.1 * k, y - 0.215 * k, 0.2 * k, 0.03 * k);
  ctx.fillStyle = M.steel;
  ctx.fillRect(x + 0.075 * k, y - 0.36 * k, 0.05 * k, 0.13 * k);
  // Голова и шлем с наносником.
  ctx.fillStyle = M.skin;
  ell(ctx, x, y - 0.44 * k, 0.056 * k, 0.056 * k);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 0.068 * k, y - 0.44 * k);
  ctx.quadraticCurveTo(x, y - 0.6 * k, x + 0.068 * k, y - 0.44 * k);
  ctx.closePath();
  ctx.fillStyle = M.steel;
  ctx.fill();
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = 0.014 * k;
  ctx.stroke();
  ctx.fillStyle = 'rgba(250, 244, 230, 0.5)';
  ell(ctx, x - 0.025 * k, y - 0.5 * k, 0.02 * k, 0.012 * k);
  ctx.fill();
  ctx.fillStyle = M.steelDark;
  ctx.fillRect(x - 0.008 * k, y - 0.47 * k, 0.016 * k, 0.07 * k);
  // Щит-капля спереди слева, цвета стороны, с полосой и бликом.
  ctx.beginPath();
  ctx.moveTo(x - 0.165 * k, y - 0.37 * k);
  ctx.lineTo(x - 0.015 * k, y - 0.37 * k);
  ctx.quadraticCurveTo(x - 0.015 * k, y - 0.19 * k, x - 0.09 * k, y - 0.08 * k);
  ctx.quadraticCurveTo(x - 0.165 * k, y - 0.19 * k, x - 0.165 * k, y - 0.37 * k);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = 0.018 * k;
  ctx.stroke();
  ctx.fillStyle = 'rgba(244, 234, 210, 0.88)';
  ctx.fillRect(x - 0.1 * k, y - 0.35 * k, 0.022 * k, 0.21 * k);
  ctx.fillStyle = 'rgba(250, 236, 200, 0.3)';
  ctx.fillRect(x - 0.15 * k, y - 0.36 * k, 0.035 * k, 0.13 * k);
}

/** Высота воина до острия копья, в мерах фигурки. */
const SPEAR = 0.88;

/**
 * Задний ряд орды: ещё четверо пониже ростом за передними — шлемы и щиты между плечами — и лес копий над
 * строем. Одни копья за тремя воинами читались частоколом, а не толпой (круг 2).
 */
function rearRank(ctx: C, color: string, y: number): void {
  const shield = mix(color, '#3a2a1c', 0.25);
  ctx.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const x = -0.44 + i * 0.145;
    const yy = y - 0.02 - (i % 2) * 0.03;
    const top = yy - (1.02 + (i % 3) * 0.06);
    ctx.strokeStyle = M.ink;
    ctx.lineWidth = 0.032;
    line(ctx, x, yy, x, top);
    ctx.strokeStyle = M.timber;
    ctx.lineWidth = 0.017;
    line(ctx, x, yy, x, top);
    ctx.fillStyle = M.steel;
    ctx.beginPath();
    ctx.moveTo(x - 0.014, top + 0.012);
    ctx.lineTo(x, top - 0.07);
    ctx.lineTo(x + 0.014, top + 0.012);
    ctx.closePath();
    ctx.fill();
  }
  for (const x of [-0.42, -0.14, 0.14, 0.42]) soldier(ctx, x, y + (Math.abs(x) > 0.3 ? 0.02 : 0), 0.8, Math.abs(x) > 0.3 ? color : shield);
}

/** Пыль слуха: клубы над дорогой, плотные у земли. Сколько людей под ней, не видно — так и задумано. */
function dust(ctx: C, w: number, rnd: () => number): void {
  // Клубы крупные и внахлёст: мелкие с краем читались галькой (круг 2).
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const x = (rnd() - 0.5) * w * 1.5 - w * 0.12 * t;
    const y = -rnd() * w * 0.9 * (0.3 + t);
    const rr = w * (0.38 + rnd() * 0.3);
    const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.3, 0, x, y, rr);
    // Пыль тоном земли, а не светлее луга: светлая пропадала на равнине (круг 3).
    g.addColorStop(0, 'rgba(188, 164, 124, 0.7)');
    g.addColorStop(0.45, 'rgba(146, 122, 88, 0.5)');
    g.addColorStop(1, 'rgba(132, 108, 76, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.fill();
  }
}

/** Войско по размеру: подставка, люди (x, y, мера), знамя (древко, полотнище). */
interface HostGeo {
  base: number;
  men: readonly (readonly [number, number, number])[];
  flagH: number;
  flagW: number;
}

const HOST: readonly HostGeo[] = [
  { base: 0.34, men: [], flagH: 0.9, flagW: 0.28 },
  { base: 0.28, men: [[0.03, 0.02, 1]], flagH: 1.1, flagW: 0.32 },
  { base: 0.42, men: [[-0.17, -0.03, 0.94], [0.15, 0.04, 1]], flagH: 1.2, flagW: 0.36 },
  { base: 0.52, men: [[-0.28, -0.03, 0.92], [0.27, -0.04, 0.92], [0.0, 0.06, 1]], flagH: 1.36, flagW: 0.46 },
  { base: 0.62, men: [[-0.3, 0.02, 0.92], [0.29, 0.01, 0.92], [0.0, 0.1, 1]], flagH: 1.5, flagW: 0.52 },
];

/** Древко знамени войска — за строем, чуть левее середины. */
const POLE_X = -0.07;

/** Лагерь войска: шатры по размеру (x, y, ширина), костёр спереди, знамя посередине. */
const CAMP_TENTS: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [-0.27, -0.06, 0.36],
    [0.27, -0.1, 0.34],
  ],
  [
    [-0.27, -0.06, 0.36],
    [0.27, -0.1, 0.34],
  ],
  [
    [-0.37, -0.02, 0.34],
    [0.04, -0.22, 0.36],
    [0.39, -0.03, 0.33],
  ],
  [
    [-0.45, -0.01, 0.33],
    [-0.14, -0.23, 0.36],
    [0.22, -0.22, 0.34],
    [0.49, 0.02, 0.33],
  ],
  [
    [-0.47, -0.01, 0.35],
    [-0.14, -0.24, 0.38],
    [0.24, -0.23, 0.36],
    [0.51, 0.02, 0.35],
  ],
];

const campFlag = (size: number): Flag => ({ x: -0.02, y: -0.06, h: 0.96 + size * 0.07, w: 0.3 + size * 0.025 });
/** Верх походного шатра с вымпелом. */
const pavilionTop = (y: number, w: number): number => y - w * 1.0 - w * 0.36;

interface HostPlan {
  body: Body;
}

function hostPlan(size: number, camp: boolean): HostPlan {
  if (camp) {
    const tents = CAMP_TENTS[size];
    const f = campFlag(size);
    const rx = Math.max(...tents.map(([x, , w]) => Math.abs(x) + w * 0.6));
    const up = -Math.min(flagTop(f) - 0.04, ...tents.map(([, y, w]) => pavilionTop(y, w)));
    return { body: { rx, up, down: 0.26 } };
  }
  const g = HOST[size];
  // Древко и навершие, полотнище в сторону хода (зеркалится на запад — поэтому полуширина по модулю).
  let rx = Math.max(g.base, Math.abs(POLE_X + g.flagW) + 0.03, Math.abs(POLE_X) + 0.03);
  let up = g.flagH + 0.04 + g.flagW * 0.11 + 0.02;
  for (const [x, y, s] of g.men) {
    rx = Math.max(rx, Math.abs(x) + 0.18 * s * MAN);
    up = Math.max(up, -(y - SPEAR * s * MAN) + 0.01);
  }
  if (size === 4) rx = Math.max(rx, 0.42 + 0.18 * 0.8 * MAN);
  return { body: { rx, up, down: size === 0 ? 0.14 : g.base * SQUASH * 0.7 + 0.06 } };
}

/** Походный шатёр войска: холст, полосы цвета стороны, вымпел на маковке. Отличен от шкур логова. */
function pavilion(ctx: C, x: number, y: number, w: number, color: string, alpha: number): void {
  const wallH = w * 0.32;
  const coneH = w * 0.68;
  ctx.fillStyle = M.shadow;
  ell(ctx, x + w * 0.22, y + 0.008, w * 0.62, w * 0.2);
  ctx.fill();
  ctx.fillStyle = M.canvasShade;
  ctx.fillRect(x - w * 0.42, y - wallH, w * 0.84, wallH);
  ctx.fillStyle = M.canvas;
  ctx.fillRect(x - w * 0.42, y - wallH, w * 0.44, wallH);
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = w * 0.035;
  ctx.strokeRect(x - w * 0.42, y - wallH, w * 0.84, wallH);
  const cone = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - wallH);
    ctx.lineTo(x, y - wallH - coneH);
    ctx.lineTo(x + w / 2, y - wallH);
    ctx.closePath();
  };
  cone();
  ctx.fillStyle = M.canvasShade;
  ctx.fill();
  ctx.fillStyle = M.canvasLit;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - wallH);
  ctx.lineTo(x, y - wallH - coneH);
  ctx.lineTo(x + w * 0.02, y - wallH);
  ctx.closePath();
  ctx.fill();
  // Полосы цвета стороны по кровле: шатёр чей — видно и без знамени.
  ctx.save();
  cone();
  ctx.clip();
  ctx.globalAlpha = 0.85 * alpha;
  ctx.fillStyle = color;
  for (const k of [-0.28, 0.06, 0.4]) {
    ctx.beginPath();
    ctx.moveTo(x, y - wallH - coneH);
    ctx.lineTo(x + k * w - w * 0.07, y - wallH);
    ctx.lineTo(x + k * w + w * 0.07, y - wallH);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  cone();
  ctx.strokeStyle = M.ink;
  ctx.lineWidth = w * 0.04;
  ctx.stroke();
  ctx.fillStyle = 'rgba(32, 22, 14, 0.85)';
  ctx.beginPath();
  ctx.moveTo(x - w * 0.08, y);
  ctx.lineTo(x + w * 0.02, y - wallH * 1.5);
  ctx.lineTo(x + w * 0.1, y);
  ctx.closePath();
  ctx.fill();
  // Вымпел на маковке.
  const top = y - wallH - coneH;
  ctx.strokeStyle = M.timber;
  ctx.lineWidth = w * 0.04;
  line(ctx, x, top, x, top - w * 0.34);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, top - w * 0.34);
  ctx.lineTo(x + w * 0.3, top - w * 0.28);
  ctx.lineTo(x, top - w * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function hostCamp(ctx: C, l: HostLook): void {
  const rnd = rng(2203 + l.size * 17);
  const tents = CAMP_TENTS[l.size];
  // Утоптанное под станом — в пределах холста: пятно шире холста резалось его краем в квадрат (круг 1).
  const rx = hostPlan(l.size, true).body.rx;
  softPatch(ctx, 0, -0.04, rx + 0.06, 0.36, '110, 92, 64', 0.75);
  const rumor = l.size === 0;
  type Piece = { y: number; draw: () => void };
  const pieces: Piece[] = [];
  for (const [x, y, w] of tents) pieces.push({ y, draw: () => pavilion(ctx, x, y, w, l.color, rumor ? 0.5 : 1) });
  const f = campFlag(l.size);
  pieces.push({ y: f.y, draw: () => banner(ctx, f.x, f.y, f.h, f.w, l.color, l.size >= 4, rumor ? 'none' : 'cross', rumor ? 0.55 : 1) });
  pieces.push({ y: 0.12, draw: () => campfire(ctx, 0.04, 0.12, 0.055) });
  // Козлы с копьями у шатров: стоит войско, а не обоз.
  pieces.push({
    y: 0.06,
    draw: () => {
      ctx.strokeStyle = M.timber;
      ctx.lineWidth = 0.018;
      ctx.lineCap = 'round';
      for (const s of [-1, 1]) line(ctx, -0.22 + s * 0.05, 0.06, -0.22 - s * 0.02, -0.28);
      ctx.fillStyle = M.steel;
      ell(ctx, -0.22, -0.3, 0.02, 0.03);
      ctx.fill();
    },
  });
  pieces.sort((a, b) => a.y - b.y);
  for (const p of pieces) p.draw();
  plume(ctx, 0.05, 0.12 - 0.07, 0.5, 0.045, 0.1, false, 0.45, rnd);
}

function hostDraw(ctx: C, l: HostLook): void {
  if (l.camp) {
    hostCamp(ctx, l);
    return;
  }
  const g = HOST[l.size];
  const rnd = rng(1709 + l.size * 23);
  if (l.size === 0) {
    // Слух: пыль да тусклое знамя без людей — «идут», без «сколько».
    shadowBlob(ctx, 0.06, 0.02, g.base * 1.2, g.base * 0.45, 0.45);
    ctx.save();
    if (l.west) ctx.scale(-1, 1);
    banner(ctx, POLE_X, -0.05, g.flagH, g.flagW, l.color, false, 'none', 0.62);
    dust(ctx, g.base, rnd);
    ctx.restore();
    return;
  }
  shadowBlob(ctx, 0.09, 0.03, g.base * 1.25, g.base * 0.55, 0.9);
  // Подставка: бронзовая плита с торцом и светлой кромкой — фигурка, а не человек на поле.
  const ry = g.base * SQUASH * 0.7;
  ctx.fillStyle = M.bronze;
  ell(ctx, 0, 0.03, g.base, ry);
  ctx.fill();
  ctx.fillRect(-g.base, 0, g.base * 2, 0.03);
  ctx.fillStyle = M.bronzeLit;
  ell(ctx, 0, 0, g.base, ry);
  ctx.fill();
  ctx.fillStyle = M.bronzeMid;
  ell(ctx, 0.01, 0.005, g.base * 0.9, ry * 0.82);
  ctx.fill();
  ctx.strokeStyle = M.inkSoft;
  ctx.lineWidth = 0.014;
  ell(ctx, 0, 0.03, g.base, ry);
  ctx.stroke();
  ctx.save();
  if (l.west) ctx.scale(-1, 1);
  if (l.size === 4) rearRank(ctx, l.color, -0.12);
  banner(ctx, POLE_X, -0.04, g.flagH, g.flagW, l.color, l.size >= 4);
  const men = [...g.men].sort((a, b) => a[1] - b[1]);
  for (const [x, y, s] of men) soldier(ctx, x, y, s, l.color);
  ctx.restore();
}

// ---------- Осадные работы ----------

const WORK = {
  ditch: 'rgba(84, 62, 38, 0.66)',
  ditchEdge: 'rgba(46, 32, 20, 0.6)',
  bank: 'rgba(196, 168, 116, 0.8)',
  bankShade: 'rgba(70, 52, 32, 0.45)',
  front: '#d8b47a',
  rear: '#9c7040',
  line: '#2a1c10',
};

/** Ров с валом: тёмная полоса под обоими рядами и светлая насыпь снаружи — «город обложен» с первой минуты. */
function ditch(ctx: C): void {
  const inner = FRONT_R - 0.1;
  const outer = REAR_R + 0.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, outer, outer * SQUASH, 0, 0, TAU);
  ctx.ellipse(0, 0, inner, inner * SQUASH, 0, 0, TAU, true);
  ctx.fillStyle = WORK.ditch;
  ctx.fill('evenodd');
  ctx.lineWidth = 0.04;
  ctx.strokeStyle = WORK.ditchEdge;
  ell(ctx, 0, 0, inner, inner * SQUASH);
  ctx.stroke();
  ctx.strokeStyle = WORK.bankShade;
  ctx.lineWidth = 0.07;
  ell(ctx, 0.01, 0.012, outer + 0.04, (outer + 0.04) * SQUASH);
  ctx.stroke();
  ctx.strokeStyle = WORK.bank;
  ctx.lineWidth = 0.055;
  ell(ctx, 0, 0, outer + 0.03, (outer + 0.03) * SQUASH);
  ctx.stroke();
}

/** Рогатка: два кола накрест поперёк кольца, верхушки клонятся `lean` (плюс — в поле, минус — к городу). */
function cross(ctx: C, x: number, y: number, a: number, lean: number, body: string): void {
  const tx = -Math.sin(a);
  const ty = Math.cos(a) * SQUASH;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = (tx / tl) * 0.1;
  const uy = (ty / tl) * 0.1;
  const rx = Math.cos(a) * lean;
  const ry = Math.sin(a) * lean * SQUASH;
  const h = 0.3;
  for (const [x0, y0, x1, y1] of [
    [x - ux, y - uy, x + ux * 1.3 + rx, y + uy * 1.3 - h + ry],
    [x + ux, y + uy, x - ux * 1.3 + rx, y - uy * 1.3 - h + ry],
  ]) {
    ctx.strokeStyle = WORK.line;
    ctx.lineWidth = 0.08;
    line(ctx, x0, y0, x1, y1);
    ctx.strokeStyle = body;
    ctx.lineWidth = 0.044;
    line(ctx, x0, y0, x1, y1);
  }
}

function worksRow(ctx: C, radius: number, n: number, step: number, lean: number, half: WorksHalf, body: string): void {
  const order = stakeOrder(n);
  const shown = stakesAt(n, step);
  const spots: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (order[i] >= shown) continue;
    const a = (i / n) * TAU + (radius === FRONT_R ? 0 : Math.PI / n);
    const y = Math.sin(a) * radius * SQUASH;
    if ((half === 'back') !== y < 0) continue;
    spots.push([Math.cos(a) * radius, y, a]);
  }
  spots.sort((p, q) => p[1] - q[1]);
  for (const [x, y, a] of spots) cross(ctx, x, y, a, lean, body);
}

function worksDraw(ctx: C, front: number, rear: number, half: WorksHalf): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (half === 'back') {
    ditch(ctx);
    worksRow(ctx, REAR_R, REAR_STAKES, rear, 0.09, half, WORK.rear);
    worksRow(ctx, FRONT_R, FRONT_STAKES, front, -0.09, half, WORK.front);
  } else {
    worksRow(ctx, FRONT_R, FRONT_STAKES, front, -0.09, half, WORK.front);
    worksRow(ctx, REAR_R, REAR_STAKES, rear, 0.09, half, WORK.rear);
  }
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

/** Холст миниатюры в клетках: ширина, высота и где на нём точка места. */
interface Span {
  w: number;
  h: number;
  ax: number;
  ay: number;
}

/** Корзины размера клетки: спрайт не перепекается на каждом щипке, а берёт ближайшую корзину. */
export const MINI_BUCKETS = [16, 22, 30, 40, 52, 64, 80];
const bucketOf = (px: number): number => MINI_BUCKETS.find((b) => b >= px) ?? MINI_BUCKETS[MINI_BUCKETS.length - 1];

const cache = new Map<string, Mini>();

function bakeMini(span: Span, cell: number, dpr: number, draw: (ctx: C) => void): Mini {
  const w = Math.ceil(span.w * cell);
  const h = Math.ceil(span.h * cell);
  const canvas = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(cell * dpr, 0, 0, cell * dpr, span.ax * cell * dpr, span.ay * cell * dpr);
    ctx.lineJoin = 'round';
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
  /** Размер места: стоянка, деревня, острог, крепость (`world/data/meta.stageOf`). */
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
  if (l.kind === 'ruin') return ruinPlan(l.stage, l.variant).body;
  if (l.kind === 'lair') return lairPlan(l.stage, l.variant).body;
  if (l.kind === 'castle') return castlePlan(l.stage, l.own).body;
  return cityPlan(l.stage, l.own).body;
}

/** Запас над телом под дым: у разорённого города столбы встают над крышами, у логова — дым костра. */
const SMOKE_ROOM = 0.36;

/**
 * Холст места — по виду и стадии, не по раскладке и не по знамени: лагерь мал, город велик, а точка места
 * всегда на земле. Тело берётся по своему (знамя выше) и по худшей из трёх раскладок, поля и тень — запасом
 * вокруг: всё нарисованное ложится внутрь холста при любом виде этой стадии (тест).
 */
function placeSpan(kind: PlaceKind, stage: Stage): Span {
  let rx: number;
  let up: number;
  let down: number;
  if (kind === 'city' || kind === 'castle') {
    const b = kind === 'city' ? cityPlan(stage, true).body : castlePlan(stage, true).body;
    const f = kind === 'city' ? CITY[stage].fields : CASTLE[stage].fields;
    const reach = f ? f[1] + PATCH_REACH * f[3] : 0;
    const knollR = kind === 'castle' ? CASTLE[stage].knoll * 1.3 : 0;
    const shadowR = kind === 'city' ? CITY[stage].r * 1.45 : 0;
    // Тень лежит со сдвигом вправо (свет слева): у замка — на 0.12, у города — на 0.1 клетки.
    rx = Math.max(reach + 0.04, b.rx + 0.08, knollR + 0.14, shadowR + 0.12);
    up = b.up + SMOKE_ROOM;
    down = Math.max(reach * SQUASH + 0.05, b.down + 0.08, knollR * SQUASH * 0.72 + 0.1, shadowR * SQUASH);
  } else {
    const bodies = [0, 1, 2].map((v) => (kind === 'lair' ? lairPlan(stage, v).body : ruinPlan(stage, v).body));
    const r = kind === 'lair' ? LAIR[stage].r : RUIN_R[stage];
    rx = Math.max(r * 1.45 + 0.1, ...bodies.map((b) => b.rx + 0.08));
    up = Math.max(...bodies.map((b) => b.up)) + (kind === 'lair' ? 0.32 : 0.5);
    down = Math.max(r * 1.45 * SQUASH + 0.04, ...bodies.map((b) => b.down + 0.08));
  }
  return { w: rx * 2, h: up + down, ax: rx, ay: up };
}

export function placeSprite(l: PlaceLook, cellPx: number, dpr: number): Mini {
  const b = bucketOf(cellPx);
  return cached(placeKey(l, b, dpr), () => {
    const span = placeSpan(l.kind, l.stage);
    return bakeMini(span, b, dpr, (ctx) => {
      if (l.kind === 'city') cityPlace(ctx, l, span);
      else if (l.kind === 'castle') castlePlace(ctx, l, span);
      else if (l.kind === 'lair') lairPlace(ctx, l, span);
      else ruinPlace(ctx, l, span);
    });
  });
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

/** Лагерь не смотрит никуда: сторона похода в его ключ не входит, и он печётся один на обе. */
export function hostKey(l: HostLook, bucket: number, dpr: number): string {
  return `host:${l.color}:${l.size}:${l.camp ? 'camp' : l.west ? 'w' : 'e'}:${bucket}:${dpr}`;
}

export function hostBody(l: HostLook): Body {
  return hostPlan(l.size, l.camp).body;
}

/**
 * Холст войска — по размеру и виду (поход или лагерь), симметричный около точки: на запад фигурки
 * зеркалятся, и тень, лежащая вправо, остаётся на холсте при любой стороне.
 */
function hostSpan(size: number, camp: boolean): Span {
  const b = hostPlan(size, camp).body;
  // Тень подставки лежит со сдвигом вправо и не зеркалится: запас под неё — по обе стороны.
  const shadow = camp ? 0 : HOST[size].base * 1.25 + 0.11;
  const ax = Math.max(b.rx + (camp ? 0.12 : 0.2), shadow);
  const ay = b.up + 0.08;
  return { w: ax * 2, h: ay + b.down + 0.12, ax, ay };
}

export function hostSprite(l: HostLook, cellPx: number, dpr: number): Mini {
  const b = bucketOf(cellPx);
  return cached(hostKey(l, b, dpr), () => bakeMini(hostSpan(l.size, l.camp), b, dpr, (ctx) => hostDraw(ctx, l)));
}

/** Осадные работы вокруг города: ров и два ряда рогаток (`siegemark.worksStep`: 0..8 на сторону). */
export type WorksHalf = 'back' | 'front';

export function worksKey(front: number, rear: number, half: WorksHalf, bucket: number, dpr: number): string {
  return `works:${front}:${rear}:${half}:${bucket}:${dpr}`;
}

/** Холст рогаток — тот же, что у прежних (`siegemark`): кольцо внутри вырубки, точка — середина клетки. */
const WORKS_SPAN: Span = { w: 3.2, h: 2.4, ax: 1.6, ay: 1.3 };

export function worksSprite(front: number, rear: number, half: WorksHalf, cellPx: number, dpr: number): Mini {
  const b = bucketOf(cellPx);
  return cached(worksKey(front, rear, half, b, dpr), () => bakeMini(WORKS_SPAN, b, dpr, (ctx) => worksDraw(ctx, front, rear, half)));
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

/** Щит-гербик: верх прямой, бока вниз и сходятся в острие у точки места. */
function shieldPath(ctx: C, w: number, top: number, tip: number): void {
  const hh = tip - top;
  ctx.beginPath();
  ctx.moveTo(-w, top);
  ctx.quadraticCurveTo(0, top + hh * 0.06, w, top);
  ctx.lineTo(w, top + hh * 0.42);
  ctx.quadraticCurveTo(w * 0.98, top + hh * 0.84, 0, tip);
  ctx.quadraticCurveTo(-w * 0.98, top + hh * 0.84, -w, top + hh * 0.42);
  ctx.closePath();
}

/** Знак места на щите: башня с зубцами (город), донжон под конусами (замок), шатёр (логово), головни (пепелище). */
function pinGlyph(ctx: C, kind: PlaceKind, ink: string, field: string): void {
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineJoin = 'round';
  if (kind === 'city') {
    // Стена с зубцами и башня посередине выше стены.
    ctx.fillRect(-0.27, -0.56, 0.54, 0.2);
    for (const x of [-0.27, -0.13, 0.13]) ctx.fillRect(x, -0.62, 0.08, 0.06);
    ctx.fillRect(0.19, -0.62, 0.08, 0.06);
    ctx.fillRect(-0.11, -0.8, 0.22, 0.44);
    for (const x of [-0.11, -0.03, 0.05]) ctx.fillRect(x, -0.87, 0.06, 0.07);
    ctx.fillStyle = field;
    ctx.beginPath();
    ctx.moveTo(-0.045, -0.36);
    ctx.lineTo(-0.045, -0.46);
    ctx.arc(0, -0.46, 0.045, Math.PI, 0);
    ctx.lineTo(0.045, -0.36);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (kind === 'castle') {
    // Высокий донжон под конусом и две башенки под конусами пониже.
    ctx.fillRect(-0.09, -0.7, 0.18, 0.34);
    ctx.beginPath();
    ctx.moveTo(-0.14, -0.7);
    ctx.lineTo(0, -0.95);
    ctx.lineTo(0.14, -0.7);
    ctx.closePath();
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.fillRect(s * 0.2 - 0.06, -0.54, 0.12, 0.18);
      ctx.beginPath();
      ctx.moveTo(s * 0.2 - 0.09, -0.54);
      ctx.lineTo(s * 0.2, -0.7);
      ctx.lineTo(s * 0.2 + 0.09, -0.54);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(-0.26, -0.44, 0.52, 0.08);
    ctx.fillStyle = field;
    ctx.fillRect(-0.03, -0.62, 0.06, 0.09);
    return;
  }
  if (kind === 'lair') {
    ctx.beginPath();
    ctx.moveTo(-0.27, -0.36);
    ctx.lineTo(0, -0.82);
    ctx.lineTo(0.27, -0.36);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.05;
    ctx.lineCap = 'round';
    line(ctx, -0.07, -0.92, 0.03, -0.76);
    line(ctx, 0.08, -0.92, -0.03, -0.76);
    ctx.fillStyle = field;
    ctx.beginPath();
    ctx.moveTo(-0.06, -0.36);
    ctx.lineTo(0.02, -0.56);
    ctx.lineTo(0.08, -0.36);
    ctx.closePath();
    ctx.fill();
    return;
  }
  // Пепелище: холмик пепла и две головни крест-накрест — кончилось.
  ctx.beginPath();
  ctx.moveTo(-0.28, -0.36);
  ctx.quadraticCurveTo(0, -0.52, 0.28, -0.36);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0.075;
  ctx.lineCap = 'round';
  line(ctx, -0.2, -0.4, 0.12, -0.84);
  line(ctx, 0.2, -0.4, -0.08, -0.78);
  ctx.lineWidth = 0.05;
  line(ctx, 0.04, -0.4, 0.04, -0.62);
}

/** Яркость цвета 0..1 — тёмный знак на светлом щите, светлый на тёмном. */
const lumOf = (c: string): number => {
  const [r, g, b] = rgbOf(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

/** Своё место — крупнее и с ореолом: на дальнем масштабе его ищут глазами первым. */
const PIN_OWN = 1.22;

export function pinSprite(l: PinLook, dpr: number): Mini {
  const k = l.own ? PIN_OWN : 1;
  const span: Span = { w: 1 * k + 0.1, h: 1.14 * k + 0.12, ax: (1 * k + 0.1) / 2, ay: 1.08 * k + 0.04 };
  return cached(pinKey(l, dpr), () =>
    bakeMini(span, PIN_PX, dpr, (ctx) => {
      const fill = l.kind === 'ruin' ? mix(l.color, M.ash, 0.7) : l.own ? M.gold : l.color;
      ctx.scale(k, k);
      // Тень острия на земле — значок стоит в точке, а не висит.
      ctx.fillStyle = 'rgba(26, 20, 16, 0.4)';
      ell(ctx, 0.05, 0, 0.2, 0.07);
      ctx.fill();
      const w = 0.4;
      const top = -1.02;
      const tip = -0.05;
      if (l.own) {
        const glow = ctx.createRadialGradient(0, -0.56, 0.2, 0, -0.56, 0.52);
        glow.addColorStop(0, 'rgba(244, 207, 120, 0.7)');
        glow.addColorStop(1, 'rgba(244, 207, 120, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, -0.56, 0.52, 0, TAU);
        ctx.fill();
      }
      shieldPath(ctx, w, top, tip);
      ctx.strokeStyle = M.ink;
      ctx.lineWidth = 0.17;
      ctx.stroke();
      ctx.fillStyle = fill;
      ctx.fill();
      // Свет слева-сверху по щиту.
      const g = ctx.createLinearGradient(-w, top, w, tip);
      g.addColorStop(0, 'rgba(250, 240, 214, 0.38)');
      g.addColorStop(0.55, 'rgba(250, 240, 214, 0)');
      g.addColorStop(1, 'rgba(32, 22, 14, 0.28)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = l.own ? M.goldRim : mix(fill, '#f4ead2', 0.45);
      ctx.lineWidth = l.own ? 0.075 : 0.05;
      ctx.stroke();
      const inkC = lumOf(fill) > 0.42 ? '#2e2016' : '#f0e2c0';
      pinGlyph(ctx, l.kind, inkC, fill);
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

/** Холст стяга один на все размеры: древко в одной точке, и значки разных войск стоят ровно. */
const FLAG_SPAN: Span = { w: 1.12, h: 1.4, ax: 0.38, ay: 1.28 };

export function flagSprite(l: FlagLook, dpr: number): Mini {
  return cached(flagKey(l, dpr), () =>
    bakeMini(FLAG_SPAN, PIN_PX, dpr, (ctx) => {
      const rumor = l.size === 0;
      const H = 0.94 + l.size * 0.04;
      const w = 0.5 + l.size * 0.03;
      const bh = 0.38 + l.size * 0.02;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.fillStyle = 'rgba(26, 20, 16, 0.4)';
      ell(ctx, 0.06, 0, 0.2, 0.07);
      ctx.fill();
      if (l.camp) {
        // Шатёр под знаменем: войско стоит.
        const tw = 0.56;
        ctx.beginPath();
        ctx.moveTo(-0.16, 0);
        ctx.lineTo(-0.16 + tw / 2, -0.4);
        ctx.lineTo(-0.16 + tw, 0);
        ctx.closePath();
        ctx.strokeStyle = M.ink;
        ctx.lineWidth = 0.12;
        ctx.stroke();
        ctx.fillStyle = M.canvas;
        ctx.fill();
        ctx.fillStyle = l.color;
        ctx.globalAlpha = rumor ? 0.45 : 0.9;
        ctx.beginPath();
        ctx.moveTo(-0.16 + tw / 2, -0.4);
        ctx.lineTo(-0.16 + tw * 0.62, 0);
        ctx.lineTo(-0.16 + tw * 0.86, 0);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(32, 22, 14, 0.9)';
        ctx.beginPath();
        ctx.moveTo(-0.16 + tw * 0.4, 0);
        ctx.lineTo(-0.16 + tw * 0.48, -0.18);
        ctx.lineTo(-0.16 + tw * 0.56, 0);
        ctx.closePath();
        ctx.fill();
      }
      if (rumor) ctx.setLineDash([0.12, 0.09]);
      ctx.strokeStyle = M.ink;
      ctx.lineWidth = rumor ? 0.1 : 0.13;
      line(ctx, 0, 0, 0, -H);
      ctx.strokeStyle = rumor ? 'rgba(160, 140, 112, 0.9)' : '#7a5a38';
      ctx.lineWidth = 0.065;
      line(ctx, 0, 0, 0, -H);
      const top = -H + 0.02;
      const cloth = (): void => {
        ctx.beginPath();
        ctx.moveTo(0.02, top);
        ctx.quadraticCurveTo(w * 0.5, top - 0.06, w, top + 0.02);
        if (l.size >= 3) {
          ctx.lineTo(w * 0.98, top + bh);
          ctx.lineTo(w * 0.62, top + bh * 0.64);
          ctx.lineTo(w * 0.4, top + bh * 0.98);
        } else ctx.quadraticCurveTo(w * 1.02, top + bh * 0.5, w * 0.98, top + bh);
        ctx.quadraticCurveTo(w * 0.4, top + bh * 0.86, 0.02, top + bh * 0.94);
        ctx.closePath();
      };
      cloth();
      // У слуха — без чернильной подложки: сквозь полупрозрачное полотнище она читалась тёмной тряпкой.
      if (!rumor) {
        ctx.strokeStyle = M.ink;
        ctx.lineWidth = 0.13;
        ctx.stroke();
      }
      ctx.globalAlpha = rumor ? 0.42 : 1;
      ctx.fillStyle = l.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (rumor) {
        ctx.strokeStyle = M.ink;
        ctx.lineWidth = 0.06;
        ctx.stroke();
      }
      if (!rumor) {
        const g = ctx.createLinearGradient(0, top, w, top + bh);
        g.addColorStop(0, 'rgba(250, 240, 214, 0.4)');
        g.addColorStop(0.5, 'rgba(250, 240, 214, 0)');
        g.addColorStop(1, 'rgba(32, 22, 14, 0.25)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = mix(l.color, '#f4ead2', 0.5);
        ctx.lineWidth = 0.04;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = rumor ? 'rgba(200, 180, 140, 0.8)' : M.goldLit;
      ell(ctx, 0, -H - 0.04, 0.06, 0.06);
      ctx.fill();
    }),
  );
}

/** Бейдж над местом: под ударом (идёт набег), свои войска стоят, в осаде (дальний масштаб). */
export type BadgeKind = 'attack' | 'troops' | 'siege';

export const BADGE_PX = 18;

/**
 * Диск бейджа — как значок тревоги нового верха (`.nx-ring`, docs/ui_audit.md, 13): тёмная середина и кольцо цвета
 * смысла — красное у удара, золотое у своих войск, охряное у осады. Тень вниз — бейдж стоит над землёй.
 */
function badgeDisc(ctx: C, ring: string): void {
  ell(ctx, 0.02, 0.04, 0.45, 0.45);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fill();
  const g = ctx.createRadialGradient(0, -0.1, 0.02, 0, 0, 0.42);
  g.addColorStop(0, '#3a2c1f');
  g.addColorStop(1, '#1a140f');
  ell(ctx, 0, 0, 0.41, 0.41);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 0.08;
  ctx.stroke();
}

export function badgeSprite(kind: BadgeKind, dpr: number): Mini {
  return cached(`badge:${kind}:${dpr}`, () =>
    bakeMini({ w: 1, h: 1, ax: 0.5, ay: 0.5 }, BADGE_PX, dpr, (ctx) => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (kind === 'attack') {
        badgeDisc(ctx, SIDE_COLOR.foe);
        // Скрещённые мечи: клинок светлый с чернильным краем, гарда золотом.
        for (const s of [-1, 1]) {
          ctx.save();
          ctx.rotate((s * Math.PI) / 4);
          ctx.beginPath();
          ctx.moveTo(-0.055, 0.1);
          ctx.lineTo(-0.055, -0.24);
          ctx.lineTo(0, -0.33);
          ctx.lineTo(0.055, -0.24);
          ctx.lineTo(0.055, 0.1);
          ctx.closePath();
          ctx.strokeStyle = M.ink;
          ctx.lineWidth = 0.07;
          ctx.stroke();
          ctx.fillStyle = '#ece6d8';
          ctx.fill();
          ctx.fillStyle = M.ink;
          ctx.fillRect(-0.16, 0.08, 0.32, 0.09);
          ctx.fillStyle = M.goldLit;
          ctx.fillRect(-0.14, 0.095, 0.28, 0.06);
          ctx.fillStyle = M.woodDark;
          ctx.fillRect(-0.03, 0.17, 0.06, 0.12);
          ctx.restore();
        }
        return;
      }
      if (kind === 'troops') {
        badgeDisc(ctx, M.gold);
        ctx.strokeStyle = M.goldRim;
        ctx.lineWidth = 0.05;
        line(ctx, -0.16, 0.28, -0.16, -0.3);
        ctx.fillStyle = M.gold;
        ctx.beginPath();
        ctx.moveTo(-0.14, -0.3);
        ctx.lineTo(0.24, -0.27);
        ctx.lineTo(0.24, 0.06);
        ctx.lineTo(0.06, -0.04);
        ctx.lineTo(-0.14, 0.06);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = M.ink;
        ctx.lineWidth = 0.035;
        ctx.stroke();
        return;
      }
      // Осада: кольцо зубьев-рогаток на бронзе.
      badgeDisc(ctx, '#d9a441');
      const teeth = 10;
      ctx.beginPath();
      for (let i = 0; i <= teeth * 2; i++) {
        const a = (i / (teeth * 2)) * TAU;
        const r = i % 2 === 0 ? 0.31 : 0.2;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.strokeStyle = M.ink;
      ctx.lineWidth = 0.12;
      ctx.stroke();
      ctx.strokeStyle = '#ecc98e';
      ctx.lineWidth = 0.06;
      ctx.stroke();
    }),
  );
}

// ---------- Знак участи ----------

const FELL_H = 18;
const FELL_FONT = "600 11px Georgia, 'Times New Roman', serif";
/** Светлые чернила знака участи на тёмной плашке. */
const FELL_INK = '#efe3c8';

/** Знак участи в квадрате 1×1 с серединой в нуле: пламя, цепь, открытый пустой сундук. */
function fellGlyph(ctx: C, fate: Fate, ink: string): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (fate === 'burn') {
    ctx.beginPath();
    ctx.moveTo(-0.32, 0.42);
    ctx.quadraticCurveTo(-0.46, -0.05, -0.08, -0.46);
    ctx.quadraticCurveTo(-0.02, -0.12, 0.14, -0.22);
    ctx.quadraticCurveTo(0.46, 0.05, 0.32, 0.42);
    ctx.closePath();
    ctx.fillStyle = '#d4602c';
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.07;
    ctx.stroke();
    ctx.fillStyle = '#f2c056';
    ctx.beginPath();
    ctx.moveTo(-0.13, 0.42);
    ctx.quadraticCurveTo(-0.2, 0.12, 0.0, -0.08);
    ctx.quadraticCurveTo(0.22, 0.14, 0.13, 0.42);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (fate === 'captives') {
    // Два звена цепи: связанные, а не рядом.
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.13;
    for (const [x, y] of [
      [-0.17, 0.13],
      [0.17, -0.13],
    ] as [number, number][]) {
      ctx.beginPath();
      ctx.ellipse(x, y, 0.3, 0.15, -0.7, 0, TAU);
      ctx.stroke();
    }
    return;
  }
  // Грабёж: пустой сундук с откинутой крышкой.
  ctx.fillStyle = '#8a5a34';
  ctx.fillRect(-0.4, -0.02, 0.8, 0.42);
  ctx.fillStyle = '#3e2a1a';
  ctx.fillRect(-0.32, 0.02, 0.64, 0.12);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.08;
  ctx.strokeRect(-0.4, -0.02, 0.8, 0.42);
  ctx.fillStyle = '#a06a3c';
  ctx.beginPath();
  ctx.moveTo(-0.4, -0.02);
  ctx.lineTo(-0.22, -0.44);
  ctx.lineTo(0.5, -0.32);
  ctx.lineTo(0.4, -0.02);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = M.goldLit;
  ctx.fillRect(-0.05, 0.12, 0.1, 0.1);
}

/** Знак участи павшего города: плашка пергамента со знаком и словом (`siegemark.FELL_WORDS`). */
export function fellSprite(fate: Fate, text: string, dpr: number): Mini {
  return cached(`fell:${fate}:${text}:${dpr}`, () => {
    // Плашка по длине слова: мерится той же гарнитурой, которой пишется.
    let textW = text.length * 6.5;
    const probe = makeCanvas(1, 1).getContext('2d');
    if (probe) {
      probe.font = FELL_FONT;
      textW = Math.ceil(probe.measureText(text).width);
    }
    const pad = 6;
    const glyph = 12;
    const w = pad + glyph + 4 + textW + pad + 2;
    const h = FELL_H;
    // Холст на два пикселя шире плашки: справа-снизу ложится её тень.
    return bakeMini({ w: w + 2, h: h + 2, ax: w / 2, ay: 0 }, 1, dpr, (ctx) => {
      ctx.translate(-w / 2, 0);
      // Плашка с подрезанными углами — ярлык на карте, а не кнопка интерфейса.
      const plate = (): void => {
        const c = 4;
        ctx.beginPath();
        ctx.moveTo(c, 0.5);
        ctx.lineTo(w - c, 0.5);
        ctx.lineTo(w - 0.5, h / 2);
        ctx.lineTo(w - c, h - 0.5);
        ctx.lineTo(c, h - 0.5);
        ctx.lineTo(0.5, h / 2);
        ctx.closePath();
      };
      ctx.save();
      ctx.translate(1, 1.5);
      plate();
      ctx.fillStyle = 'rgba(26, 20, 16, 0.35)';
      ctx.fill();
      ctx.restore();
      plate();
      // Плашка нового вида — та же, что у имени места (`labels.placeLabel`): тёмная, с тёплой кромкой.
      ctx.fillStyle = 'rgba(22, 16, 11, 0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 220, 170, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      ctx.translate(pad + glyph / 2, h / 2);
      ctx.scale(glyph, glyph);
      fellGlyph(ctx, fate, FELL_INK);
      ctx.restore();
      ctx.font = FELL_FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = FELL_INK;
      ctx.fillText(text, pad + glyph + 4, h / 2 + 0.5);
    });
  });
}
