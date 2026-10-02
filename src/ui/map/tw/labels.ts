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
