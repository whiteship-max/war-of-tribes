// Ограничитель детализации на отдалении (ПН-00; docs/gdd/path_of_sword.md, 3.5.7, решение С3). Камера свободна у всех
// (`grid.holdCamera`): без потолка отдаления в кадр входит весь регион — больше мест, подписей и движущегося, чем видел
// игрок прежде. Поэтому мельче масштаба, на котором стоял прежний потолок, карта рисует **дальний вид** — только обзорный
// слой: земля — кусками обзора, без среднего слоя; места — одной меткой на клетку экрана, без меток у плеча, рогаток и
// дыма; подписей мест — не больше потолка; агенты — без сроков и полосок энергии; походы — без сроков (кроме враждебных);
// ни прибоя, ни облаков, ни огней лагеря — того, что будит карту каждый кадр. Новых выпечек на кадр дальний вид не
// добавляет: земля региона испечена заранее (`prebake.ts`, рабочий поток), ближний масштаб мельче `FADE_LO` не просится,
// значки новых размеров — не больше `MARK_BAKES_STILL` за кадр и только стоя (`marks.markFrame`).
//
// Порог — **прежний потолок у типичного игрока**, той же формулой, что стояла в `grid.zoomFloor` до ПН-00: разведан круг
// обзора дома (`world/sight.homeSight`) плюс прежний запас `OLD_ZOOM_MARGIN` с каждой стороны, по длинной стороне экрана.
// Мельче него игрок без дальних походов карту прежде не отдалял; дальний вид задуман не дороже кадра на прежнем потолке —
// задуман, а не измерен. Потолки (`FAR_LABELS`, `FAR_CELL`) — ориентир, не измерено; цену кадра на отдалении против прежнего потолка
// меряет `/perf` с телефонов (место «карта», docs/telemetry.md) — передача ПН-1ч в docs/gdd/path_of_sword.md.
//
// Только числа и выбор — под тестом `far.test.ts`; кадр (`frame.ts`) ставит решение раз на кадр, слои, места и палец
// читают его отсюда: одно решение на кадр — то, что нарисовано, то и под пальцем.
import type { Coord } from '@/world/types';
import { homeSight } from '@/world/sight';
import { HOME_SIGHT } from '@/world/data/tuning';
import type { Viewport } from '../grid';

/** Прежний запас потолка отдаления, клеток (`ZOOM_MARGIN` = `CAMERA_LEASH` до ПН-00). */
export const OLD_ZOOM_MARGIN = 7;

/** Сколько клеток вмещал прежний потолок по стороне кадра у игрока, разведавшего круг обзора радиуса `sight`. */
export const oldSpan = (sight: number): number => 2 * sight + 1 + 2 * OLD_ZOOM_MARGIN;

/** Масштаб прежнего потолка на этом экране: мельче — дальний вид. */
export const farBelow = (vp: Viewport, sight: number): number => Math.max(vp.w, vp.h) / oldSpan(sight);

/** Дальний ли вид на этом масштабе: мельче прежнего потолка у игрока с обзором дома `sight`. */
export const isFar = (scale: number, vp: Viewport, sight: number): boolean => scale < farBelow(vp, sight);

/** Потолок подписей мест на дальнем виде: своё — сверх него. Ориентир, не измерено. */
export const FAR_LABELS = 6;

/** Сторона клетки экрана, CSS px: на дальнем виде одна метка места на клетку — цель пальца (`--tap`). Ориентир. */
export const FAR_CELL = 44;

let far = false;

/** Дальний ли вид у последнего кадра. Читают слои земли, места, подписи и палец. */
export const farFrame = (): boolean => far;

/** Решение кадра — ставит только кадр (`frame.drawTwFrame`). Мира ещё нет — обзор дома по умолчанию. */
export function decideFar(scale: number, vp: Viewport, home: Coord | null): boolean {
  far = isFar(scale, vp, home ? homeSight(home) : HOME_SIGHT);
  return far;
}

/** Клетка экрана сводной метки. */
const cellKey = (sx: number, sy: number): string => `${Math.floor(sx / FAR_CELL)},${Math.floor(sy / FAR_CELL)}`;

/**
 * Сводная метка: из мест одной клетки экрана (`FAR_CELL`) остаётся одно — важнейшее (`rank`: больше — важнее), при
 * равенстве — меньшее `id`: метка клетки не прыгает от кадра к кадру. Число меток кадра ограничено числом клеток
 * экрана, а не числом мест региона.
 */
export function farPick<T extends { sx: number; sy: number }>(items: T[], rank: (it: T) => number, id: (it: T) => string): T[] {
  const best = new Map<string, T>();
  for (const it of items) {
    const key = cellKey(it.sx, it.sy);
    const had = best.get(key);
    if (!had || rank(it) > rank(had) || (rank(it) === rank(had) && id(it) < id(had))) best.set(key, it);
  }
  return items.filter((it) => best.get(cellKey(it.sx, it.sy)) === it);
}
