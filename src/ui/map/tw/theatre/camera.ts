// Камера в границах региона (docs/map_tw.md, раздел 13). Поводок и потолок отдаления — прежние
// (`grid.leashCamera`): они решают, куда игрок смотрит со своего якоря. Здесь — рамка поверх них: кадр не
// показывает дальше рамки региона больше `THEATRE_EDGE` клеток ни на каком масштабе. Внутри рамки чужое
// закрыто листом старой карты (`tw/fog.ts`), за рамкой — тот же лист: края мира игрок не видит.
//
// Только числа — под тестом «камера не выходит за границу» (`theatre.test.ts`).
import type { Rect } from '@/world/types';
import { SCALE_MAX } from '../../const';
import { type Camera, type Viewport, clamp } from '../../grid';

/** Сколько клеток за рамкой региона кадр может показать: край листа, а не обрыв. */
export const THEATRE_EDGE = 6;

/** Прямоугольник, который кадр не покидает: рамка с краем. */
export const reachOf = (box: Rect, edge = THEATRE_EDGE): Rect => ({
  x: box.x - edge,
  y: box.y - edge,
  w: box.w + edge * 2,
  h: box.h + edge * 2,
});

/**
 * Камера, приведённая в рамку: масштаб не мельче того, при котором кадр уже рамки с краем, середина — не
 * ближе к краю, чем полкадра. Регион уже кадра даже на самом крупном масштабе — середина на середине рамки
 * (такого региона в данных нет, но камера не обязана ломаться).
 */
export function holdInTheatre(cam: Camera, vp: Viewport, box: Rect, edge = THEATRE_EDGE): Camera {
  const reach = reachOf(box, edge);
  const floor = Math.max(vp.w / reach.w, vp.h / reach.h);
  const scale = Math.min(SCALE_MAX, Math.max(cam.scale, floor));
  const hw = vp.w / (2 * scale);
  const hh = vp.h / (2 * scale);
  const x0 = reach.x + hw;
  const x1 = reach.x + reach.w - hw;
  const y0 = reach.y + hh;
  const y1 = reach.y + reach.h - hh;
  return {
    scale,
    cx: x0 <= x1 ? clamp(cam.cx, x0, x1) : reach.x + reach.w / 2,
    cy: y0 <= y1 ? clamp(cam.cy, y0, y1) : reach.y + reach.h / 2,
  };
}
