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

// ---------- Ёлки ----------

/**
 * Ёлка ростом чуть выше клетки: на ближнем масштабе она должна читаться силуэтом,
 * а не зелёной точкой. Ширина и число ярусов гуляют по видам, иначе лес выглядит
 * штампованным узором, а не лесом.
 */
const TREE_W = Math.round(TILE_BAKE * 0.72);
const TREE_H = Math.round(TILE_BAKE * 1.06);
const treeSprites: (HTMLCanvasElement | null)[] = Array(TREE_KINDS).fill(null);

export function treeSprite(kind: number): HTMLCanvasElement {
  const i = ((kind % TREE_KINDS) + TREE_KINDS) % TREE_KINDS;
  const have = treeSprites[i];
  if (have) return have;
  const c = makeCanvas(TREE_W, TREE_H);
  const ctx = ctxOf(c);

  // Вид задаётся тремя числами: сколько ярусов, насколько крона узкая и куда
  // наклонена. Шесть сочетаний глаз уже не различает как повтор.
  const tiers = 3 + (i % 2);
  const narrow = 0.78 + (i % 3) * 0.08;
  const lean = ((i % 3) - 1) * 0.05;

  const cx = TREE_W / 2;
  const trunkW = Math.max(2, TREE_W * 0.1);
  const trunkTop = TREE_H * 0.74;

  ctx.fillStyle = '#3a2a1c';
  ctx.fillRect(cx - trunkW / 2, trunkTop, trunkW, TREE_H - trunkTop);

  // Ярусы снизу вверх: нижний самый широкий, каждый следующий уже и выше.
  for (let t = 0; t < tiers; t++) {
    const k = t / tiers;
    const halfW = (TREE_W / 2) * narrow * (1 - k * 0.55);
    const baseY = TREE_H * (0.8 - k * 0.21);
    const topY = baseY - TREE_H * 0.3;
    const tipX = cx + lean * TREE_W * (1 - k);
    ctx.beginPath();
    ctx.moveTo(tipX, topY);
    ctx.lineTo(cx + halfW, baseY);
    ctx.lineTo(cx - halfW, baseY);
    ctx.closePath();
    // Правая половина темнее: свет в игре падает слева, как и в сцене посёлка.
    ctx.fillStyle = PALETTE.tree;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = PALETTE.treeLight;
    ctx.fillRect(cx - halfW, topY, halfW * 0.85, baseY - topY);
    ctx.restore();
  }

  treeSprites[i] = c;
  return c;
}

/** Тень под ёлкой: без неё лес висит над травой. */
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
  grassSprites.fill(null);
  treeSprites.fill(null);
}
