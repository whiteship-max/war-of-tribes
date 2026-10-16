/**
 * Общее у промыслов: время игры, цель тапа и счёт (docs/minigames.md, раздел 4).
 *
 * ЗДЕСЬ НЕТ НИ THREE, НИ ЧАСОВ. Время приходит доводом — секунды сцены с «Начать» (`t`): кадр прибавляет к нему
 * прошедшее, вкладка в фоне его не двигает. Раскладка и поведение — чистые функции от зерна и `t`
 * (`berries.ts`, `herd.ts`), поэтому правила держит тест, а не снимок.
 */
import type { MinigameId } from '@/game/data/minigames';
import type { DayPart } from '@/game/data/seasons';

/**
 * Сколько секунд идёт игра. «Ягоды» — минута: десять кустов на поляне радиусом одиннадцать метров, обойти все
 * — секунд сорок ходьбы, и остаток уходит на порядок «что спело». «Скот» — дольше: десять ходок от стога в середине
 * к животному и обратно, до дальнего края шесть метров — четыре-пять секунд на ходку. «Охота» — полторы минуты:
 * восемь стрел, три кучки оленей на разной дали, и к ближней надо ещё подкрасться — шагом крадущегося (`hunt.SNEAK`)
 * десяток метров идётся полминуты. «Рыбалка» — тоже полторы минуты: цель — четыре средние рыбы (`fishing.GOAL_FISH`), а
 * круг «заброс — поклёвка (2–10 с) — вываживание (7–11 с у средней рыбы)» — числа docs/minigames.md, 17.2.
 */
export const GAME_SECONDS: Record<MinigameId, number> = { berries: 60, herd: 75, hunt: 90, fish: 90 };

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

/**
 * Счёт игры: сколько собрано из скольких, и прибавка — серия удач и редкая добыча (docs/minigames.md, 18). Доля — то,
 * что примет начисление (`sim/minigames.scoreOf`).
 *
 * ПРИБАВКА ЛЕЖИТ В ЗНАМЕНАТЕЛЕ ЦЕЛИКОМ: `bonusMax` — сколько прибавки было можно взять на этом поле, и доля считается
 * от суммы. Поэтому полный счёт — по-прежнему единица (потолок добычи не сдвигается ни на зерно), а средний выход не
 * растёт: прибавку берёт тот, кто и основное берёт лучше других, — щуп добычи (`yield.test.ts`) сверяет это на наборе
 * зёрен и умений.
 */
export interface Tally {
  got: number;
  total: number;
  /** Взятая прибавка: серия, земляника, белый олень, ягнёнок. Нет — ноль. */
  bonus?: number;
  /** Сколько прибавки было можно взять на этом поле. */
  bonusMax?: number;
}

export const shareOf = (t: Tally): number => {
  const all = t.total + (t.bonusMax ?? 0);
  return all > 0 ? Math.min(1, (t.got + Math.min(t.bonus ?? 0, t.bonusMax ?? 0)) / all) : 0;
};

/**
 * Серия удач: подряд удавшиеся дела — чисто обобранный куст, вытащенная без схода рыба. С `from`-го подряд каждое
 * следующее приносит `step` прибавки; неудача рвёт серию. Сколько прибавки было можно взять — `streakMax`: все дела
 * поля подряд и без единой неудачи.
 */
export class Streak {
  /** Сколько подряд сейчас. */
  run = 0;
  /** Лучшая серия игры. */
  best = 0;
  /** Сколько прибавки взято серией. */
  bonus = 0;

  constructor(
    readonly from: number,
    readonly step: number,
  ) {}

  /** Удача: серия выросла. Вернёт прибавку этого дела (ноль, пока серия короче `from`). */
  hit(): number {
    this.run += 1;
    this.best = Math.max(this.best, this.run);
    const b = this.run >= this.from ? this.step : 0;
    this.bonus += b;
    return b;
  }

  /** Неудача: серия с нуля. */
  miss(): void {
    this.run = 0;
  }
}

/** Прибавка серии, если все `n` дел поля удались подряд. */
export const streakMax = (n: number, from: number, step: number): number => Math.max(0, n - from + 1) * step;

/**
 * Час промысла — от часов города (`derived.dayPartAt`): утро — утренняя зорька, вечер — вечерняя, день и ночь. Свет
 * игры ставится по нему (`HOUR_SOLAR`), а рыбе и оленю он не всё равно: на зорьке клюёт бойчее и олени смелее, днём
 * — ленивый клёв и чуткий олень (`fishing.HOUR_BITE`, `hunt.HOUR_EAR`). Зорька — прежние числа игр: новый час только
 * отнимает, поэтому средний выход за сутки не выше прежнего.
 */
export type Hour = 'dawn' | 'day' | 'dusk' | 'night';

export const HOURS: readonly Hour[] = ['dawn', 'day', 'dusk', 'night'];

/** Часть суток города — час промысла. */
export const hourOf = (part: DayPart): Hour => (part === 'morning' ? 'dawn' : part === 'evening' ? 'dusk' : part);

/** Час словами — карточке начала: те же слова, что у значка времени суток в верхней строке города. */
export const HOUR_WORDS: Record<Hour, string> = { dawn: 'Утро', day: 'День', dusk: 'Вечер', night: 'Ночь' };

/** Час — строка значков времени суток (`ui/icons/registry.DAY_PARTS`: утро, день, вечер, ночь). */
export const HOUR_PART: Record<Hour, number> = { dawn: 0, day: 1, dusk: 2, night: 3 };

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
