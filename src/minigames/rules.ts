/**
 * Общее у промыслов: время игры, цель тапа и счёт (docs/minigames.md, раздел 4).
 *
 * ЗДЕСЬ НЕТ НИ THREE, НИ ЧАСОВ. Время приходит доводом — секунды сцены с «Начать» (`t`): кадр прибавляет к нему
 * прошедшее, вкладка в фоне его не двигает. Раскладка и поведение — чистые функции от зерна и `t`
 * (`berries.ts`, `herd.ts`), поэтому правила держит тест, а не снимок.
 */
import type { MinigameId } from '@/game/data/minigames';

/**
 * Сколько секунд идёт игра. «Ягоды» — минута: десять кустов на поляне радиусом одиннадцать метров, обойти все
 * — секунд сорок ходьбы, и остаток уходит на порядок «что спело». «Скот» — дольше: десять ходок от стога в середине
 * к животному и обратно, до дальнего края шесть метров — четыре-пять секунд на ходку. «Охота» — полторы минуты:
 * восемь стрел, три кучки оленей на разной дали, и к ближней надо ещё подкрасться — шагом крадущегося (`hunt.SNEAK`)
 * десяток метров идётся полминуты.
 */
export const GAME_SECONDS: Record<MinigameId, number> = { berries: 60, herd: 75, hunt: 90 };

/** Сколько последних секунд отсчёт горит охрой: пора. */
export const LATE_SECONDS = 10;

/** Что можно тронуть тапом: круг на земле. Тап — по ближайшему в досягаемости, а не по прицелу. */
export interface Target {
  /** Номер внутри игры: куст, стог или животное. */
  id: number;
  x: number;
  z: number;
  /** Насколько предмет толст: досягаемость меряется от его края. */
  r: number;
  /** Что сделает тап — строкой подсказки под прицелом. */
  verb: string;
}

/** Счёт игры: сколько собрано из скольких. Доля — то, что примет начисление (`sim/minigames.scoreOf`). */
export interface Tally {
  got: number;
  total: number;
}

export const shareOf = (t: Tally): number => (t.total > 0 ? t.got / t.total : 0);

/**
 * Досягаемость руки — та же, что у поляны предыстории (`glade.REACH`): ближе — тронешь, дальше — подойди.
 * Своё имя ради чистоты модуля (без `three` и сцены), значение держит тест.
 */
export const REACH = 2.1;

/** Ближайшая цель в досягаемости от края, или никакой. */
export function nearestTarget(x: number, z: number, targets: readonly Target[]): Target | null {
  let best: Target | null = null;
  let bestGap = Infinity;
  for (const t of targets) {
    const gap = Math.hypot(t.x - x, t.z - z) - t.r;
    if (gap <= REACH && gap < bestGap - 1e-9) {
      best = t;
      bestGap = gap;
    }
  }
  return best;
}

/** Генератор от зерна — тот же, что у всей игры (`sim/random.seeded`). Своего здесь нет. */
export { seeded } from '@/game/sim/random';
