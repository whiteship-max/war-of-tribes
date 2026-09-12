// Заготовки кисти: всё, чем рисуется земля, печётся здесь по одному разу.
//
// Правило без исключений: во время кадра не создаётся ни одного градиента и не
// строится ни одного пути. Градиенты и пути живут только тут, на запуске, и
// превращаются в маленькие холсты. Дальше и выпечка тайла, и сам кадр умеют
// ровно одно — `drawImage`.
import { PALETTE, TILE_BAKE, TREE_KINDS } from './const';

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Контекст без сглаживания текста и с готовой заливкой — общий вход для всех заготовок. */
function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Карта: 2D-контекст недоступен.');
  return ctx;
}

// ---------- Мягкий диск ----------

/** Сторона спрайта диска. Больше не нужно: он всегда растягивается вниз. */
const DISC_PX = 128;

let discSprite: HTMLCanvasElement | null = null;

/**
 * Единственный штамп, из которого собираются вода и холмы.
 *
 * Прозрачность внутри спадает как `(1 - d²/r²)²` — это обычное поле метаболов.
 * Складывая такие диски режимом `lighter`, получаем ровно ту же сумму, что
 * считает `scatter.fieldAt`, и альфа насыщается там же, где поле переходит
 * порог. Значит берег на картинке и берег, по которому отбраковываются ёлки, —
 * это одна и та же линия, а не две похожие.
 */
export function softDisc(): HTMLCanvasElement {
  if (discSprite) return discSprite;
  const c = makeCanvas(DISC_PX, DISC_PX);
  const ctx = ctxOf(c);
  const r = DISC_PX / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  // Узлы взяты прямо из формулы спада, а не подобраны на глаз.
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const w = (1 - t * t) * (1 - t * t);
    g.addColorStop(t, `rgba(255, 255, 255, ${w})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DISC_PX, DISC_PX);
  discSprite = c;
  return c;
}

// ---------- Трава ----------

const GRASS_PX = 128;
const GRASS_KINDS = 3;
const grassSprites: (HTMLCanvasElement | null)[] = Array(GRASS_KINDS).fill(null);

/**
 * Пятно травы: несколько мягких клякс чуть светлее и темнее основы. Нужно, чтобы
 * сплошная заливка не читалась пластиком; на каждый тайл их сыплется несколько
 * десятков со случайным поворотом.
 */
export function grassPatch(kind: number): HTMLCanvasElement {
  const i = ((kind % GRASS_KINDS) + GRASS_KINDS) % GRASS_KINDS;
  const have = grassSprites[i];
  if (have) return have;
  const c = makeCanvas(GRASS_PX, GRASS_PX);
  const ctx = ctxOf(c);
  const tone = [PALETTE.grassLight, PALETTE.grassDark, PALETTE.grassLight][i];
  const blobs = [
    [0.5, 0.5, 0.42],
    [0.34, 0.42, 0.26],
    [0.64, 0.58, 0.3],
  ];
  for (const [bx, by, br] of blobs) {
    const g = ctx.createRadialGradient(bx * GRASS_PX, by * GRASS_PX, 0, bx * GRASS_PX, by * GRASS_PX, br * GRASS_PX);
    g.addColorStop(0, tone);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, GRASS_PX, GRASS_PX);
  }
  grassSprites[i] = c;
  return c;
}

// ---------- Деревья ----------

/**
 * Дерево ростом чуть выше клетки: на ближнем масштабе оно должно читаться
 * силуэтом, а не зелёной точкой.
 *
 * Пород две, и это не прихоть. Одинаковые ёлки ровным шагом читались посадкой, а
 * не лесом; хвоя под Дубровником — ещё и неправдой. Север хвойный, юг
 * лиственный, решает это место (`scatter.coniferAt`), а не дерево.
 *
 * Внутри породы шесть видов, и у каждого свой **тон**, а не только своя форма.
 * Форма разводит силуэты, тон разводит массу: лес одного цвета читается узором,
 * каким бы разным ни был контур каждого дерева.
 */
const TREE_W = Math.round(TILE_BAKE * 0.72);
const TREE_H = Math.round(TILE_BAKE * 1.06);
const treeSprites: (HTMLCanvasElement | null)[] = Array(TREE_KINDS * 2).fill(null);

/** Тёмный и светлый тон вида. Светлый ложится на левую половину — свет слева. */
const toneOf = (conifer: boolean, i: number): [string, string] =>
  conifer
    ? [PALETTE.conifer[i] ?? PALETTE.tree, PALETTE.coniferLit[i] ?? PALETTE.treeLight]
    : [PALETTE.broadleaf[i] ?? PALETTE.tree, PALETTE.broadleafLit[i] ?? PALETTE.treeLight];

/** Ствол общий для обеих пород: на двадцати пикселях его и так почти не видно. */
function trunk(ctx: CanvasRenderingContext2D, from: number, w: number): void {
  ctx.fillStyle = PALETTE.trunk;
  ctx.fillRect(TREE_W / 2 - w / 2, TREE_H * from, w, TREE_H * (1 - from));
}

/** Левую половину фигуры красим светлым — объём без градиента. */
function lit(ctx: CanvasRenderingContext2D, dark: string, light: string, top: number, bottom: number): void {
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = light;
  ctx.fillRect(0, top, TREE_W * 0.46, bottom - top);
  ctx.restore();
}

function conifer(ctx: CanvasRenderingContext2D, i: number): void {
  const [dark, light] = toneOf(true, i);
  // Вид задаётся тремя числами: сколько ярусов, насколько крона узкая и куда
  // наклонена. Шесть сочетаний глаз уже не различает как повтор.
  const tiers = 3 + (i % 2);
  const narrow = 0.78 + (i % 3) * 0.08;
  const lean = ((i % 3) - 1) * 0.05;
  const cx = TREE_W / 2;
  trunk(ctx, 0.74, Math.max(2, TREE_W * 0.1));
  // Ярусы снизу вверх: нижний самый широкий, каждый следующий уже и выше.
  for (let t = 0; t < tiers; t++) {
    const k = t / tiers;
    const halfW = (TREE_W / 2) * narrow * (1 - k * 0.55);
    const baseY = TREE_H * (0.8 - k * 0.21);
    const topY = baseY - TREE_H * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx + lean * TREE_W * (1 - k), topY);
    ctx.lineTo(cx + halfW, baseY);
    ctx.lineTo(cx - halfW, baseY);
    ctx.closePath();
    lit(ctx, dark, light, topY, baseY);
  }
}

/**
 * Лиственное: крона из нескольких перекрывающихся шапок. Опознаётся оно не
 * породой листа — на двадцати пикселях его нет, — а тем, что крона **круглая и
 * шире ствола**, тогда как у хвойного она треугольная и острая.
 */
function broadleaf(ctx: CanvasRenderingContext2D, i: number): void {
  const [dark, light] = toneOf(false, i);
  const cx = TREE_W / 2;
  const wide = 0.4 + (i % 3) * 0.035;
  const tall = 0.3 + (i % 2) * 0.05;
  trunk(ctx, 0.72, Math.max(2, TREE_W * 0.11));
  const lobes: [number, number, number][] = [
    [0, 0.45, 1],
    [-0.26, 0.56, 0.72],
    [0.27, 0.58, 0.68],
    [0.04, 0.33, 0.66],
  ];
  const top = TREE_H * 0.14;
  const bottom = TREE_H * 0.78;
  ctx.beginPath();
  for (const [dx, dy, k] of lobes) {
    ctx.moveTo(cx + dx * TREE_W + TREE_W * wide * k, TREE_H * dy);
    ctx.ellipse(cx + dx * TREE_W, TREE_H * dy, TREE_W * wide * k, TREE_H * tall * k, 0, 0, Math.PI * 2);
  }
  lit(ctx, dark, light, top, bottom);
}

export function treeSprite(kind: number, isConifer: boolean): HTMLCanvasElement {
  const i = ((kind % TREE_KINDS) + TREE_KINDS) % TREE_KINDS;
  const slot = i + (isConifer ? 0 : TREE_KINDS);
  const have = treeSprites[slot];
  if (have) return have;
  const c = makeCanvas(TREE_W, TREE_H);
  const ctx = ctxOf(c);
  if (isConifer) conifer(ctx, i);
  else broadleaf(ctx, i);
  treeSprites[slot] = c;
  return c;
}

// ---------- Общий тон: зерно и затемнение к краям ----------

/**
 * Зерно пергамента. Это карта, а не поле: у неё есть бумага, и её должно быть
 * немного видно. Пятно нарочно слабое и **двустороннее** — и светлые крупинки, и
 * тёмные: односторонний крап читался бы грязью на стекле, а не фактурой листа.
 *
 * Кладётся повторяющимся узором на весь кадр одной заливкой. Это не спор с
 * законом кадра: узор печётся один раз и живёт вечно, а в кадре остаётся одна
 * заливка — ровно та же цена, что у `drawImage`.
 */
const GRAIN_PX = 96;
let grainSprite: HTMLCanvasElement | null = null;

export function grainTile(): HTMLCanvasElement {
  if (grainSprite) return grainSprite;
  const c = makeCanvas(GRAIN_PX, GRAIN_PX);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(GRAIN_PX, GRAIN_PX);
  const d = img.data;
  // Свой генератор, а не `Math.random`: зерно обязано быть одним и тем же от
  // запуска к запуску — иначе снимок «до» и снимок «после» разойдутся на шуме.
  let s = 0x9e3779b1;
  for (let i = 0; i < GRAIN_PX * GRAIN_PX; i++) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b1) >>> 0;
    const v = (s >>> 8) & 255;
    const up = v > 127;
    d[i * 4] = up ? 236 : 24;
    d[i * 4 + 1] = up ? 226 : 20;
    d[i * 4 + 2] = up ? 200 : 14;
    // Слабое и неровное: часть крупинок не видна вовсе, и узор не читается сеткой.
    d[i * 4 + 3] = (v % 7) * 3;
  }
  ctx.putImageData(img, 0, 0);
  grainSprite = c;
  return c;
}

/**
 * Затемнение к краям кадра. Оно делает из экрана **лист**: середина освещена,
 * края уходят в тень. Печётся квадратом и растягивается на экран — от этого
 * круг становится эллипсом по форме экрана, что и нужно.
 */
const VIGNETTE_PX = 256;
let vignetteSprite: HTMLCanvasElement | null = null;

export function vignette(): HTMLCanvasElement {
  if (vignetteSprite) return vignetteSprite;
  const c = makeCanvas(VIGNETTE_PX, VIGNETTE_PX);
  const ctx = ctxOf(c);
  const r = VIGNETTE_PX / 2;
  const g = ctx.createRadialGradient(r, r, r * 0.42, r, r, r * 0.96);
  g.addColorStop(0, 'rgba(14, 10, 7, 0)');
  g.addColorStop(0.62, 'rgba(14, 10, 7, 0.07)');
  g.addColorStop(1, 'rgba(14, 10, 7, 0.33)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIGNETTE_PX, VIGNETTE_PX);
  vignetteSprite = c;
  return c;
}

/** Тень под деревом: без неё лес висит над травой. */
let shadowSprite: HTMLCanvasElement | null = null;

export function treeShadow(): HTMLCanvasElement {
  if (shadowSprite) return shadowSprite;
  const w = Math.round(TILE_BAKE * 0.8);
  const h = Math.round(TILE_BAKE * 0.34);
  const c = makeCanvas(w, h);
  const ctx = ctxOf(c);
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, PALETTE.treeShadow);
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  // Тень плоская: круг сплющен в эллипс масштабом самого холста.
  ctx.fillRect(0, 0, w, h);
  shadowSprite = c;
  return c;
}

export const treeSize = (): { w: number; h: number } => ({ w: TREE_W, h: TREE_H });

// ---------- Сброс ----------

/** Новый мир — новые заготовки. Зовётся вместе со сбросом кэша тайлов. */
export function dropPaint(): void {
  discSprite = null;
  shadowSprite = null;
  grainSprite = null;
  vignetteSprite = null;
  grassSprites.fill(null);
  treeSprites.fill(null);
}
