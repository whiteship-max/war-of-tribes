// Готовность стороны лагеря словами — одна строка на оба окна осады: осаждающего
// (`panels/CampPanel`) и обороняющегося (`panels/SiegePanel`).
//
// Число — та же `works.campSides`, что у боя; разошлись окна только словами: одно писало
// «рогатки дозрели», другое «дозрели», и у стороны, куда не рубят, одно добавляло «не
// растут», а другое молчало. Одна сторона одного лагеря в двух окнах обязана читаться
// одинаково.
import { formatLeft, secondsLeft } from '@/world/geo';
import type { SideSight } from '@/world/works';

/** «рогатки дозрели», «40%, дозреют через 12 мин» или «40%, не растут». */
export function sideReady(t: Pick<SideSight, 'works' | 'ripeAt'>, now: number): string {
  if (t.works >= 1) return 'рогатки дозрели';
  const done = `${Math.floor(t.works * 100)}%`;
  return t.ripeAt < Infinity ? `${done}, дозреют через ${formatLeft(secondsLeft(t.ripeAt, now))}` : `${done}, не растут`;
}
