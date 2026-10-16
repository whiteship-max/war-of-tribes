// Когда кончится стройка, если игрока нет, — осторожный прогноз для вести «достроили» (ВС-1, docs/NOTIFY.md, раздел 13).
//
// Стройка идёт трудом, а не сроком: скорость (`buildRate`) — свободные руки, мастерская и ратуша под сезоном и
// усилителями вестей, и отлучка двигает её тем же шагом (`sim/tick`). Наперёд известны две перемены скорости — смена
// сезона и конец усилителя: их прогноз проходит по отрезкам, как пройдёт шаг. Остальное (мораль, прирост, ушедшие
// разведчики) двигает скорость понемногу и в обе стороны — на это срок длиннее на `BUILD_SLACK`. Весть, пришедшая
// чуть позже конца стройки, правды не портит; пришедшая раньше — соврала бы.
//
// Только чтение партии: ни шага, ни записи.
import type { GameState } from './types';
import { activeBoons, buildRate, currentSite, seasonIndex, seasonMods, seasonModsFor, seasonOf, yearOf } from './derived';
import { SEASON_SECONDS } from './data/seasons';

/** Запас на то, что прогноз не видит: срок стройки в вести длиннее расчётного на эту долю. */
export const BUILD_SLACK = 0.15;

/** Сколько отрезков проходит прогноз: смен сезона и концов усилителей за любой срок, который годится в весть, меньше. */
const SEGMENTS = 64;

/** Идущая стройка: что, до какого уровня и через сколько игровых секунд кончится — с запасом. Нет стройки — `null`. */
export function buildForecast(s: GameState): { type: GameState['buildings'][number]['type']; level: number; sec: number } | null {
  const site = currentSite(s);
  if (!site) return null;
  const mods = seasonMods(s);
  const rate = buildRate(s, mods);
  if (!(rate > 0) || !(mods.build > 0)) return null;
  // Часть скорости, которую сезон и усилители не двигают: на неё ложатся множители каждого отрезка.
  const base = rate / mods.build;
  const boons = activeBoons(s);
  let rest = site.workRequired - site.work;
  let t = s.time;
  for (let i = 0; i < SEGMENTS && rest > 0; i++) {
    const seasonEnd = (seasonIndex(t) + 1) * SEASON_SECONDS;
    const end = Math.min(seasonEnd, ...boons.filter((b) => b.until > t).map((b) => b.until));
    const mult = boons.filter((b) => b.until > t).reduce((m, b) => m * (b.def.build ?? 1), seasonModsFor(seasonOf(t), yearOf(t)).build);
    const r = base * mult;
    if (!(r > 0)) return null;
    if (rest <= r * (end - t)) {
      t += rest / r;
      rest = 0;
    } else {
      rest -= r * (end - t);
      t = end;
    }
  }
  if (rest > 0) return null;
  return { type: site.type, level: site.level + 1, sec: (t - s.time) * (1 + BUILD_SLACK) };
}
