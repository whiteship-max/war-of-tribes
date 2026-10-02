// Цель пальца на карте нового вида (docs/map_tw.md, этап 2). Объект здесь нарисован не в свою клетку:
// миниатюра города шире трёх клеток, войско у осаждённого стоит лагерем сбоку, четверо агентов дома
// разведены веером, а на дальнем масштабе клетка — 4 px, мельче любого пальца. Касание по клетке под
// точкой промахивалось бы мимо нарисованного.
//
// Поэтому палец ищет **нарисованное**: коробки тел из той же сцены, что рисует кадр (`tw/scene.ts`),
// раздутые до цели пальца (`render/pick.hitBox`, `TAP_TARGET` — 44 px, больше порога владельца в 33 px) и
// с прощением промаха в полпальца (`TAP_FORGIVE`). Найденный объект отдаёт **свою клетку**, и дальше всё
// решает прежний `openAt` по клетке: что откроется, тап только нацеливает. Время и сход пальца судит общий
// разбор жеста (`gestures.Gesture`: 700 мс и 32 px — меньше порогов владельца, 780 мс и 33 px).
import type { Coord } from '@/world/types';
import { TAP_FORGIVE } from '@/gestures';
import { type HitBox, hitBox, pickBox } from '@/render/pick';
import type { Box, FigureItem, HostItem, PlaceItem } from './scene';

export type AimKind = 'place' | 'host' | 'figure';

export interface Aim {
  kind: AimKind;
  /** Клетка, которую получит `openAt`. */
  cell: Coord;
  /** Тело объекта на экране. */
  box: Box;
}

/**
 * Все цели кадра. Свои походы в цели не входят — их и прежде нельзя было тапнуть (`store.marchOn` ищет
 * только чужой идущий отряд); лагерь у цели отдаёт клетку цели — как тап по самому городу.
 */
export function aimsOf(places: PlaceItem[], hosts: HostItem[], figures: FigureItem[]): Aim[] {
  const out: Aim[] = [];
  for (const p of places) out.push({ kind: 'place', cell: { x: p.s.x, y: p.s.y }, box: p.body });
  for (const h of hosts) if (h.target || h.standing) out.push({ kind: 'host', cell: h.cell, box: h.body });
  for (const f of figures) {
    out.push({ kind: 'figure', cell: f.cell, box: f.body });
    if (f.hostBox) out.push({ kind: 'figure', cell: f.cell, box: f.hostBox });
  }
  return out;
}

/** Коробка пальца вокруг тела: не меньше `TAP_TARGET` по каждой стороне. */
export const aimBox = (id: number, b: Box): HitBox => hitBox(id, b.x0, b.y0, b.x1, b.y1);

/**
 * Клетка цели под точкой экрана или null — тогда тап идёт в клетку под точкой, как прежде.
 *
 * С агентом в руке промах не прощается: тап по пустой земле рядом с городом — приказ идти туда, и
 * притягивать его к городу значило бы подменить приказ меню. Попадание в само тело (с запасом до пальца)
 * — по-прежнему цель.
 */
export function aimAt(aims: Aim[], x: number, y: number, hand: boolean): Coord | null {
  const boxes = aims.map((a, i) => aimBox(i, a.box));
  const id = pickBox(boxes, x, y, hand ? 0 : TAP_FORGIVE);
  return id === null ? null : aims[id].cell;
}
