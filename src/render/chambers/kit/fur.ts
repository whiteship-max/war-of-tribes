// Шерсть на листе набора персонажа (ЛЦ-4, docs/characters.md): мазки по течению шерсти — как пряди волос у людей набора
// (`cloth.hairStrands`), только короткие и по полю направлений: от носа к затылку, со спины к брюху, по лапе вниз. Мазок
// берёт тон из-под себя и сдвигает его к свету или в тень — узор и светотень, уже лежащие на листе, остаются, а лист
// читается писаным мехом, а не гладкой краской. Случайность — сеяная.
import { boxOf, mix, rng, stroke, tone, type Box, type Img, type RGB } from './paint';

export interface FurSpec {
  /** Направление шерсти в точке листа, рад (0 — вправо, π/2 — вниз). */
  flow: (x: number, y: number) => number;
  /** Сколько мазков, длина и толщина, точки. */
  count: number;
  len: number;
  width: number;
  /** Разброс тона: доля к свету и в тень (`paint.tone`). */
  spread: number;
  /** Сила мазка (0…1). */
  alpha?: number;
  /** Где мазку можно лечь (по умолчанию — вся коробка). */
  mask?: (x: number, y: number) => boolean;
  seed: number;
}

/** Мазки шерсти по полю направлений в коробке `box`: изогнутые, сужающиеся к концам, тоном из-под себя. */
export function furStrokes(img: Img, box: Box, s: FurSpec): void {
  const r = rng(s.seed);
  const a = s.alpha ?? 0.42;
  for (let i = 0; i < s.count; i++) {
    const x = box.x0 + r() * (box.x1 - box.x0);
    const y = box.y0 + r() * (box.y1 - box.y0);
    const k = (r() - 0.5) * 2 * s.spread;
    const ln = s.len * (0.6 + r() * 0.8);
    const bend = (r() - 0.5) * 0.5;
    if (s.mask && !s.mask(x, y)) continue;
    const xi = Math.max(0, Math.min(img.w - 1, x | 0));
    const yi = Math.max(0, Math.min(img.h - 1, y | 0));
    const base: RGB = img.get(xi, yi);
    // Мазок идёт по течению: три точки, вторая — с изгибом.
    const ang = s.flow(x, y);
    const p0: [number, number] = [x, y];
    const a1 = ang + bend;
    const p1: [number, number] = [x + Math.cos(a1) * ln * 0.5, y + Math.sin(a1) * ln * 0.5];
    const a2 = s.flow(p1[0], p1[1]) + bend * 0.5;
    const p2: [number, number] = [p1[0] + Math.cos(a2) * ln * 0.5, p1[1] + Math.sin(a2) * ln * 0.5];
    const line = [p0, p1, p2];
    // К свету — мягче, чем в тень (`tone` к свету тянет к тёплому белому): мазки не белят шерсть в среднем.
    const c = k >= 0 ? mix(base, tone(base, 1), k * 0.4) : tone(base, k);
    img.shape(stroke(line, (t) => s.width * (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.3)))), boxOf(line, s.width), c, { soft: s.width * 0.5, alpha: a, clip: box });
  }
}
