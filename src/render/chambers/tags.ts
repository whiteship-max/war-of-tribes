// Покои правителя (docs/city_v3.md, Г-5, Г-6): раскладка подписей — не налезают друг на друга, не выходят за край, вдали
// мельче. Кому подпись нужна (подошёл и смотрит, сидя — предметы стола), решает комната (`room.ts`, `labelWants`). Чистая
// раскладка без DOM и three: на вход — где на экране вещь и как она далеко, на выход — где встать подписям. Её же сверяет тест.

/** Предмет на экране: точка над ним (`ax`, `ay`, точки CSS), расстояние от глаза, м; `on` — в кадре и перед глазом. */
export interface TagIn {
  id: string;
  text: string;
  ax: number;
  ay: number;
  dist: number;
  on: boolean;
  /** Очередь раскладки: меньше — раньше (уже видимые — первыми, чтобы не прыгали); нет — по расстоянию. */
  rank?: number;
}

/** Где подпись: середина плашки, размер с масштабом, видна ли и сдвинута ли от предмета (тогда к нему — черта). */
export interface TagOut {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  visible: boolean;
  ax: number;
  ay: number;
  /** Плашка ушла от своего места над предметом — к предмету ведёт черта. */
  led: boolean;
  /** Насколько проступила (0…1) — ставит комната (`room.fadeLabels`). */
  alpha?: number;
}

/** Кегль подписи вблизи, точки CSS; вдали — до `TAG_MIN` доли (не мельче 12: правило кегля, docs/polish.md, П-1). */
export const TAG_FONT = 14.5;
export const TAG_MIN = 12.5 / 14.5;
/** Зазор подписи над предметом и между подписями, точки. */
const GAP = 7;
const PAD = 3;

/** Масштаб подписи по расстоянию: сидя за столом (до 0,9 м) — во весь кегль, через комнату — меньше. */
export const tagScale = (dist: number): number => Math.max(TAG_MIN, Math.min(1, 1.12 - 0.13 * dist));

/** Размер плашки: ширина по буквам кегля, высота — строка с полями. */
export function tagSize(text: string, scale: number): { w: number; h: number } {
  const f = TAG_FONT * scale;
  // Ширина буквы своего шрифта (Golos Text, полужирный) — около 0,62 кегля; поля по 8 точек.
  return { w: Math.round(text.length * f * 0.62 + 18 * scale), h: Math.round(f * 1.25 + 8 * scale) };
}

/**
 * Разложить подписи в рамке экрана (`left`…`right`, `top`…`bottom`): ближние к глазу — первыми, каждая — на первое
 * свободное место из ряда (над предметом, выше на строку и на две, под ним, слева, справа); места нет — подпись прячется,
 * а не ложится поверх чужой. По ширине подпись прижимается к краю, а не уходит за него.
 */
export function layoutTags(items: readonly TagIn[], view: { left: number; top: number; right: number; bottom: number }): TagOut[] {
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const out = new Map<string, TagOut>();
  const order = [...items].sort((a, b) => (a.rank ?? a.dist) - (b.rank ?? b.dist));
  for (const it of order) {
    const scale = tagScale(it.dist);
    const { w, h } = tagSize(it.text, scale);
    const base: TagOut = { id: it.id, x: it.ax, y: it.ay, w, h, scale, visible: false, ax: it.ax, ay: it.ay, led: false };
    if (!it.on) {
      out.set(it.id, base);
      continue;
    }
    const up = it.ay - GAP - h / 2;
    const tries: [number, number][] = [
      [it.ax, up],
      [it.ax, up - (h + PAD)],
      [it.ax, up - 2 * (h + PAD)],
      [it.ax, it.ay + GAP + h / 2],
      [it.ax - w / 2 - GAP, it.ay],
      [it.ax + w / 2 + GAP, it.ay],
      [it.ax - w * 0.6, up],
      [it.ax + w * 0.6, up],
    ];
    for (const [tx, ty] of tries) {
      const x = Math.min(Math.max(tx, view.left + w / 2), view.right - w / 2);
      const y = ty;
      if (y - h / 2 < view.top || y + h / 2 > view.bottom) continue;
      const r = { x0: x - w / 2 - PAD / 2, y0: y - h / 2 - PAD / 2, x1: x + w / 2 + PAD / 2, y1: y + h / 2 + PAD / 2 };
      if (placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) continue;
      placed.push(r);
      out.set(it.id, { ...base, x, y, visible: true, led: Math.hypot(x - it.ax, y - up) > 4 });
      break;
    }
    if (!out.has(it.id)) out.set(it.id, base);
  }
  return items.map((i) => out.get(i.id)!);
}
