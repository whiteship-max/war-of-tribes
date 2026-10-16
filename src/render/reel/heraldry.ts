// Гербы сторон на знамёнах ролика боя (docs/gfx.md, «Знамёна»). Рисуются шейдером знамени, без текстур.
//
// Поле знамени — цвет стороны (`side.ts`: наши в золоте, чужие в красном), на поле — фигура герба контрастной краской:
// у наших тёмная, у чужих светлая. Наш герб — башня, тот же рисунок, что у герба державы в шапке игры
// (`ui/realm/Coat.tsx`: щит, поле нашей стороны, чёрная башня с тремя зубцами и дверью) — игрок уже знает его как «своё».
// Чужие: разбойники логова — скрещённые топоры; сосед-игрок — та же башня в своём цвете (у державы игрока герб один на
// всех, отличает его цвет стороны). Стая знамён не носит.
//
// Какой герб у чужих, решает зовущий по записи и донесению (`ui/battle/coats.ts`): показ мира не читает.
import type { Side } from '@/battle/types';

export type Coat = 'tower' | 'axes';
export const COATS: readonly Coat[] = ['tower', 'axes'];
export const COAT_INDEX: Record<Coat, number> = { tower: 0, axes: 1 };

/** Гербы сторон боя: наш — башня всегда; у чужих — по тому, кто они. */
export type SideCoats = Record<Side, Coat>;

/** Гербы без знания о противнике (стенд, старая запись): наш — башня, чужие — топоры разбойников. */
export const coatsFor = (us: Side, foe: Coat = 'axes'): SideCoats =>
  (us === 'attacker' ? { attacker: 'tower', defender: foe } : { attacker: foe, defender: 'tower' }) as SideCoats;

/** Тёмная краска фигуры на золоте и светлая — на красном (линейный свет сцены, три числа). */
export const CHARGE_DARK = 0x2b2219;
export const CHARGE_LIGHT = 0xeee3c8;

/**
 * Фигуры гербов в шейдере: `twCoat(p, id)` — 1 внутри фигуры, 0 снаружи; `p` — место в квадрате фигуры (0..1, вверх —
 * +y). Башня переложена из пути `ui/realm/Coat.tsx` (окно 40: тело 14.5…25.5 × 17…28, верх 13…27 × 13.5…17, три
 * зубца, дверь аркой), топоры — две рукояти накрест и два полукруглых лезвия у верхних концов.
 */
export const COAT_GLSL = /* glsl */ `
float twSeg(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return step(length(pa - ba * h), w);
}
float twTower(vec2 p) {
  float x = 13.0 + p.x * 14.0;
  float y = 11.0 + (1.0 - p.y) * 17.0;
  float body = step(14.5, x) * step(x, 25.5) * step(17.0, y);
  float top = step(13.0, x) * step(x, 27.0) * step(13.5, y) * step(y, 17.0);
  float m = (step(13.0, x) * step(x, 16.0) + step(18.5, x) * step(x, 21.5) + step(24.0, x) * step(x, 27.0)) * step(11.0, y) * step(y, 13.5);
  float door = step(18.0, x) * step(x, 22.0) * step(23.5, y) + step(length(vec2(x - 20.0, y - 23.5)), 2.0);
  return clamp(max(max(body, top), m) - clamp(door, 0.0, 1.0), 0.0, 1.0);
}
float twAxes(vec2 p) {
  float h = max(twSeg(p, vec2(0.2, 0.08), vec2(0.78, 0.86), 0.045), twSeg(p, vec2(0.8, 0.08), vec2(0.22, 0.86), 0.045));
  vec2 a = p - vec2(0.84, 0.78);
  vec2 b = p - vec2(0.16, 0.78);
  float ba = step(length(a), 0.2) * step(0.0, a.x + a.y * 0.25);
  float bb = step(length(b), 0.2) * step(b.x - b.y * 0.25, 0.0);
  return max(h, max(ba, bb));
}
float twCoat(vec2 p, float id) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 0.0;
  return id < 0.5 ? twTower(p) : twAxes(p);
}
`;
