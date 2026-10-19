// Рисунки листа значков на холсте карты (docs/map_tw.md, раздел 14): значок места, отряда и боя на карте — тот же
// рисунок, что в интерфейсе, а не второй, нарисованный кистью карты. Один лист — одна правда о том, как выглядит
// «острог» или «разбойники»: перерисуют значок в листе — карта сменит его сама.
//
// Лист уже лежит в документе (`ui/icons/sheet.ts` кладёт его скрытым блоком для `<use>`), и карта читает символы оттуда:
// второй загрузки нет, веса нет. Формат листа узкий и проверен сборкой (`npm run icons:build`, docs/icons.md): сетка
// 32×32, набор ЗН-1 пишет только `<path>` — заливка с контуром чернилами под ней (`paint-order: stroke`) или линия
// гравюры без заливки; без преобразований — поэтому разбор тут простой. Прямоугольник, круг и многоугольник разбор
// понимает по-прежнему.
// Пока лист не приехал, рисунка нет (`glyphShapes` — null), и значок печётся без него, а ключ спрайта это помнит
// (`glyphStamp`): приехал лист — значок печётся заново.
import { sheetReady, sheetSymbol } from '@/ui/icons/sheet';

type C = CanvasRenderingContext2D;

/** Фигура символа листа в его сетке 32×32. */
export type Shape =
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { k: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { k: 'poly'; pts: number[]; fill: string }
  | { k: 'path'; d: string; fill: string; stroke?: string; sw?: number };

/** Сетка листа. */
export const GLYPH_GRID = 32;

/** Что разбору нужно от элемента: имя тега и атрибут. Узко — чтобы тест подавал фигуры без документа. */
export interface ShapeNode {
  tagName: string;
  getAttribute(name: string): string | null;
}

const num = (n: ShapeNode, a: string): number => Number(n.getAttribute(a) ?? 0) || 0;

/** Фигуры символа по порядку листа (порядок — это и есть слои рисунка). Чужой тег пропускается. */
export function shapesOf(nodes: Iterable<ShapeNode>): Shape[] {
  const out: Shape[] = [];
  for (const n of nodes) {
    const fill = n.getAttribute('fill') ?? '#000000';
    const tag = n.tagName.toLowerCase();
    if (tag === 'rect') out.push({ k: 'rect', x: num(n, 'x'), y: num(n, 'y'), w: num(n, 'width'), h: num(n, 'height'), fill });
    else if (tag === 'circle') out.push({ k: 'circle', cx: num(n, 'cx'), cy: num(n, 'cy'), r: num(n, 'r'), fill });
    else if (tag === 'polygon') {
      const pts = (n.getAttribute('points') ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter(Number.isFinite);
      if (pts.length >= 6) out.push({ k: 'poly', pts, fill });
    } else if (tag === 'path') {
      const d = n.getAttribute('d');
      const stroke = n.getAttribute('stroke');
      if (d) out.push(stroke && stroke !== 'none' ? { k: 'path', d, fill, stroke, sw: num(n, 'stroke-width') || 1 } : { k: 'path', d, fill });
    }
  }
  return out;
}

const memo = new Map<string, Shape[]>();

/** Фигуры значка листа. null — лист не приехал или такого значка в листе нет. */
export function glyphShapes(name: string): Shape[] | null {
  const have = memo.get(name);
  if (have) return have;
  const el = sheetSymbol(name);
  if (!el) return null;
  const shapes = shapesOf(Array.from(el.children));
  memo.set(name, shapes);
  return shapes;
}

/** Отметка листа для ключа спрайта: 0 — рисунков ещё нет, 1 — лист в документе. */
export const glyphStamp = (): number => (sheetReady() ? 1 : 0);

/**
 * Рисует значок в квадрат `size` с левым верхним углом в (`x`, `y`) — в единицах текущего преобразования. Путь `<path>`
 * строится через `Path2D`; где его нет (старый вебвью, заглушка теста), фигура пропускается, а не роняет выпечку.
 */
export function drawGlyph(ctx: C, shapes: readonly Shape[], x: number, y: number, size: number, alpha = 1): void {
  ctx.save();
  ctx.translate(x, y);
  const k = size / GLYPH_GRID;
  ctx.scale(k, k);
  if (alpha < 1) ctx.globalAlpha *= alpha;
  for (const s of shapes) {
    ctx.fillStyle = s.fill;
    if (s.k === 'rect') ctx.fillRect(s.x, s.y, s.w, s.h);
    else if (s.k === 'circle') {
      ctx.beginPath();
      ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.k === 'poly') {
      ctx.beginPath();
      ctx.moveTo(s.pts[0], s.pts[1]);
      for (let i = 2; i + 1 < s.pts.length; i += 2) ctx.lineTo(s.pts[i], s.pts[i + 1]);
      ctx.closePath();
      ctx.fill();
    } else if (typeof Path2D !== 'undefined') {
      const p = new Path2D(s.d);
      // Контур — под заливкой (`paint-order: stroke` листа): снаружи видна половина линии, как в интерфейсе.
      if (s.stroke) {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.sw ?? 1;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke(p);
      }
      if (s.fill !== 'none') ctx.fill(p);
    }
  }
  ctx.restore();
}

/** Сброс разобранного — вместе с кэшем спрайтов (`hook`): лист мог смениться. */
export function dropGlyphs(): void {
  memo.clear();
}
