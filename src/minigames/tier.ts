// Ступень промысла по уровню игры (docs/perf.md, решение ночи 4). Промысел рисует конвейером поляны (`prologue/post`), и
// ступени у него свои — `full`, `lite`, `base`; уровень «Графики» у игры один на всё (`gfx.levelNow`). Здесь — как одно
// переводится в другое. Чистый модуль: без three и без браузера, его держит тест.
import { TIERS, type Tier } from '@/prologue/look';
import type { Quality } from '@/render/quality';

/** Ступень, выше которой промысел на этом уровне не встаёт: «Низкое» — пол поляны, «Среднее» — без полного конвейера. */
export const TIER_OF_QUALITY: Record<Quality, Tier> = { high: 'full', medium: 'lite', low: 'base' };

/**
 * Первая ступень промысла: что умеет устройство (`look.startTier`), но не дороже уровня игры. Ступень из адреса
 * (`?look=`, проверка глазами) сильнее уровня — её стенд ставит нарочно.
 */
export function miniTier(start: Tier, level: Quality, asked: boolean): Tier {
  if (asked) return start;
  const cap = TIER_OF_QUALITY[level];
  return TIERS.indexOf(cap) > TIERS.indexOf(start) ? cap : start;
}

/** Тень стены леса и всего, что стоит, — у ступеней с конвейером; у пола теней нет вовсе. */
export const SHADOWS: Record<Tier, boolean> = { full: true, lite: true, base: false };
