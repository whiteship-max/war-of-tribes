// Единственная дверь, кладущая временный усилитель в партию (`GameState.boons`; docs/events.md, раздел 3).
//
// Читает усилители `derived.activeBoons` — при чтении, по `s.time`; здесь только запись. Правило
// одно: **тот же усилитель второй раз не складывается**, а продлевается до дальнего из двух сроков.
// Два праздника урожая подряд — это один праздник подольше, а не двойная мораль: иначе вести одного
// вида, пришедшие одна за другой, давали бы награду дважды (тест).
import type { GameState } from '../types';
import { DAY_LENGTH } from '../constants';
import { BOON_BY_ID } from '../data/boons';

/** Дать усилитель на его срок с нынешней игровой секунды. Отжившие при этом убираются из партии. */
export function grantBoon(s: GameState, id: string): void {
  const def = BOON_BY_ID[id];
  if (!def) throw new Error(`нет такого усилителя: ${id}`);
  const until = s.time + def.days * DAY_LENGTH;
  const live = (s.boons ?? []).filter((b) => b.until > s.time);
  const same = live.find((b) => b.id === id);
  if (same) same.until = Math.max(same.until, until);
  else live.push({ id, until });
  s.boons = live;
}
