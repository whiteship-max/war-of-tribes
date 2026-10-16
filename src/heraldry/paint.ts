// Герб на холсте: знамёна города, метки карты, полотнища роликов боя и осады (docs/polish.md, П-2).
//
// Слои — те же, что у SVG интерфейса (`art.armsLayers`): рисунок один, холст только переводит пути в `Path2D`. Окно
// щита с полями под обвод — 104 × 124 (как `viewBox` у `ui/parts/Arms.tsx`), высота герба — 1.2 ширины.
import { anyArms, armsCode, type Arms } from './arms';
import { INK, RIM, SHIELD_PATH, armsLayers } from './art';

/** Есть ли чем рисовать: без `Path2D` (тесты в узле) зовущий рисует свой запасной знак. */
export const canPaintArms = (): boolean => typeof Path2D !== 'undefined';

/** Отношение высоты герба к ширине. */
export const ARMS_ASPECT = 1.2;

const paths = new Map<string, Path2D>();
const path2d = (d: string): Path2D => {
  let p = paths.get(d);
  if (!p) {
    p = new Path2D(d);
    paths.set(d, p);
  }
  return p;
};

export interface PaintOpts {
  /** Блик и тень по щиту (как у SVG); на крошечных метках выключают — там он грязнит. */
  gloss?: boolean;
  /** Обвод щита. */
  rim?: boolean;
}

/** Нарисовать герб шириной `w` с левым верхним углом в `x, y` (с полями под обвод). */
export function paintArms(ctx: CanvasRenderingContext2D, a: Arms, x: number, y: number, w: number, opts: PaintOpts = {}): void {
  const s = w / 104;
  const shield = path2d(SHIELD_PATH[a.shield]);
  ctx.save();
  ctx.translate(x + 2 * s, y + 2 * s);
  ctx.scale(s, s);
  ctx.save();
  ctx.clip(shield);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const l of armsLayers(a)) {
    ctx.save();
    if (l.m) ctx.transform(l.m[0], l.m[1], l.m[2], l.m[3], l.m[4], l.m[5]);
    const p = path2d(l.d);
    if (l.fill) {
      ctx.fillStyle = l.fill;
      ctx.fill(p, 'evenodd');
    }
    if (l.stroke) {
      ctx.strokeStyle = l.stroke;
      ctx.lineWidth = l.width ?? 1;
      ctx.stroke(p);
    }
    ctx.restore();
  }
  if (opts.gloss !== false) {
    const g = ctx.createRadialGradient(30, 26, 0, 30, 26, 114);
    g.addColorStop(0, 'rgba(255,255,255,0.32)');
    g.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 100, 120);
  }
  ctx.restore();
  if (opts.rim !== false) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = RIM;
    ctx.lineJoin = 'round';
    ctx.stroke(shield);
  }
  ctx.restore();
}

const canvases = new Map<string, HTMLCanvasElement>();

/**
 * Герб готовым холстом шириной `w` пикселей — для кэшей меток и текстур. Без документа (тесты) — `null`: зовущий рисует
 * без герба. Строка — любая (`anyArms`: гербы логов тоже), неразборчивая — герб по умолчанию.
 */
export function armsCanvas(code: string, w: number, opts: PaintOpts = {}): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const a = anyArms(code);
  const key = `${armsCode(a)}|${w}|${opts.gloss !== false}|${opts.rim !== false}`;
  let c = canvases.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = Math.ceil(w);
    c.height = Math.ceil(w * ARMS_ASPECT);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    paintArms(ctx, a, 0, 0, w, opts);
    // Кэш не растёт без меры: гербов на карте десятки, размеров — несколько.
    if (canvases.size > 256) canvases.clear();
    canvases.set(key, c);
  }
  return c;
}
