// Ветвь державы, которую учат «когда хватило — купил» (`autopilot.learn`): докуда она изучена к игровому
// дню `day` и сколько очков её вида к этому дню сгорело на потолке.
//
// Прибор долга административной ветви (docs/dynasty.md, раздел 9, пачка 4): у административных очков
// один сток — сама ветвь. Пока она не изучена, очки уходят на ступени; изучена целиком — копятся до
// потолка (`POINTS_CAP`) и дальше сгорают. У военной ветви то же правило даёт другое: сколько видов
// войск открыто к сроку.
//
// Считается закрытой формой, без прогона партии: очки — функция времени (`sim/points`), цены — из
// `data/realm`. Своего числа у прибора нет. Что форма та же, что у игры, держит тест
// (`branchpace.test.ts`): он проходит те же дни настоящей дверью — `sim/tech.study` и `sim/points.pointsOf`.
import type { RealmBranch } from '@/game/types';
import { POINTS_CAP, levelPrice, levelsOf, pointsPerDay, startingPoints } from '@/game/data/realm';

export interface Pace {
  /** Изученный уровень ветви к сроку. */
  level: number;
  /** Сколько очков её вида лежит к сроку — не больше потолка. */
  held: number;
  /** Сколько очков её вида сгорело на потолке к сроку. */
  burned: number;
  /** С какого игрового дня ветвь изучена целиком; `null` — к сроку ещё нет. */
  doneAt: number | null;
}

/** Ветвь при навыке `skill` (ступени покупаются, как только хватает очков) к игровому дню `day`. */
export function paceOf(branch: RealmBranch, skill: number, day: number): Pace {
  const rate = pointsPerDay(skill);
  const top = levelsOf(branch);
  let t = 0;
  let p = startingPoints(branch);
  let level = 1;
  // Цена ступени не выше потолка (`levelPrice`), поэтому до конца ветви очки на потолок не упираются:
  // следующая ступень покупается раньше. Горят они только у изученной целиком.
  while (level < top) {
    const price = levelPrice(branch, level + 1);
    const wait = rate > 0 ? Math.max(0, (price - p) / rate) : Infinity;
    if (t + wait > day) break;
    t += wait;
    p += rate * wait - price;
    level++;
  }
  const uncapped = p + rate * (day - t);
  return {
    level,
    held: Math.min(POINTS_CAP, uncapped),
    burned: Math.max(0, uncapped - POINTS_CAP),
    doneAt: level >= top ? t : null,
  };
}
