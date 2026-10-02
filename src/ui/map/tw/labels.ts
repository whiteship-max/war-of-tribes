// Подписи карты нового вида (docs/map_tw.md, раздел 4): антиква системы, чернила с пергаментным
// ореолом, своё поселение — на картуше. Шрифт не качается: средневековых гарнитур с кириллицей под CC0
// нет, а загрузка шрифта ради подписи — докачка (раздел 9).

type C = CanvasRenderingContext2D;

/** Гарнитура: антиква, какая есть в системе. */
export const SERIF = "Georgia, 'Times New Roman', 'Noto Serif', serif";

const INK = '#3b2a1c';
const HALO = 'rgba(236, 222, 190, 0.82)';
const CARTOUCHE = '#e6d4a6';
const CARTOUCHE_EDGE = '#8a6c42';

/** Разрядка, где браузер её умеет (`letterSpacing`); где нет — без неё. */
function spaced(ctx: C, px: number): void {
  const c = ctx as C & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

/** Имя поселения под миниатюрой. `own` — своё: картуш-свиток, крупнее. */
export function placeLabel(ctx: C, text: string, x: number, y: number, own: boolean): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (own) {
    ctx.font = `600 13px ${SERIF}`;
    spaced(ctx, 1.2);
    const w = ctx.measureText(text).width + 22;
    const h = 20;
    // Свиток: лента с загнутыми концами, тень вниз-вправо — как подписи на старинной карте.
    ctx.fillStyle = 'rgba(20, 14, 8, 0.35)';
    ctx.fillRect(x - w / 2 + 2, y - h / 2 + 2, w, h);
    ctx.fillStyle = CARTOUCHE_EDGE;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + (s * w) / 2, y - h / 2 + 3);
      ctx.lineTo(x + (s * (w + 12)) / 2, y - h / 2 + 6);
      ctx.lineTo(x + (s * (w + 6)) / 2, y + 1);
      ctx.lineTo(x + (s * (w + 12)) / 2, y + h / 2 + 2);
      ctx.lineTo(x + (s * w) / 2, y + h / 2 - 1);
      ctx.closePath();
      ctx.fill();
    }
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, '#efe0b8');
    g.addColorStop(1, CARTOUCHE);
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeStyle = CARTOUCHE_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
    ctx.fillStyle = INK;
    ctx.fillText(text, x, y + 0.5);
  } else {
    ctx.font = `italic 600 12px ${SERIF}`;
    spaced(ctx, 0.6);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = HALO;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = INK;
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}

/** Имя крупного места — моря, гор — разрядкой и курсивом, светлыми чернилами по воде. */
export function regionLabel(ctx: C, text: string, x: number, y: number, size: number, onWater: boolean): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `italic ${size}px ${SERIF}`;
  spaced(ctx, size * 0.35);
  ctx.fillStyle = onWater ? 'rgba(214, 228, 222, 0.78)' : 'rgba(59, 42, 28, 0.78)';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ---------- Подписи игры: испечённые ----------
//
// В кадре игры подпись — копирование испечённой: картуш своего города — это градиент и десяток путей, и
// печь его шестьдесят раз в секунду — ровно то, что запрещает закон кадра (docs/world-map.md). Подпись
// печётся один раз на (текст, своё, плотность); имя своего города меняет игрок, и старое вытесняется.

export interface LabelSprite {
  canvas: HTMLCanvasElement;
  /** Размер в CSS-пикселях; точка подписи — середина. */
  w: number;
  h: number;
}

const labels = new Map<string, LabelSprite>();
const LABELS_MAX = 96;

/** Шрифт подписи — им же меряется вписывание имени (`fitName`). */
export const labelFont = (own: boolean): string => (own ? `600 13px ${SERIF}` : `italic 600 12px ${SERIF}`);

export function labelSprite(text: string, own: boolean, dpr: number): LabelSprite {
  const key = `${own ? 1 : 0}|${dpr}|${text}`;
  const have = labels.get(key);
  if (have) {
    labels.delete(key);
    labels.set(key, have);
    return have;
  }
  const probe = document.createElement('canvas').getContext('2d');
  let tw = text.length * 7;
  if (probe) {
    probe.font = labelFont(own);
    spaced(probe, own ? 1.2 : 0.6);
    tw = probe.measureText(text).width;
  }
  // Картуш шире текста на поля и загнутые концы ленты; простая подпись — на ореол.
  const w = Math.ceil(tw + (own ? 40 : 10));
  const h = own ? 26 : 18;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    placeLabel(ctx, text, w / 2, h / 2 - (own ? 1 : 0), own);
  }
  const out = { canvas, w, h };
  labels.set(key, out);
  if (labels.size > LABELS_MAX) {
    const first = labels.keys().next().value as string;
    const gone = labels.get(first);
    if (gone) gone.canvas.width = 0;
    labels.delete(first);
  }
  return out;
}

/** Имя крупного места — тоже испечённое: разрядка и курсив, по воде светлыми чернилами. */
export function regionSprite(text: string, size: number, onWater: boolean, dpr: number): LabelSprite {
  const key = `r|${size}|${onWater ? 1 : 0}|${dpr}|${text}`;
  const have = labels.get(key);
  if (have) return have;
  const probe = document.createElement('canvas').getContext('2d');
  let tw = text.length * size * 0.8;
  if (probe) {
    probe.font = `italic ${size}px ${SERIF}`;
    spaced(probe, size * 0.35);
    tw = probe.measureText(text).width;
  }
  const w = Math.ceil(tw + size);
  const h = Math.ceil(size * 1.6);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    regionLabel(ctx, text, w / 2, h / 2, size, onWater);
  }
  const out = { canvas, w, h };
  labels.set(key, out);
  return out;
}

export function dropLabels(): void {
  for (const l of labels.values()) l.canvas.width = 0;
  labels.clear();
}
