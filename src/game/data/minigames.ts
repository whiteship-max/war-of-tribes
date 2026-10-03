import type { BuildingTypeId } from '../types';
import { realTime } from '../pace';
import { DAY_MS } from '../time';

/**
 * Промыслы — мини-игры от первого лица (docs/minigames.md). Здесь числа дизайна — как цены: заданы один раз,
 * обоснованы строкой в документе (раздел 1–2) и не подгоняются. Правила энергии и добычи — `sim/minigames.ts`;
 * сцена, раскладка и время игры — свой кусок `src/minigames/`.
 */

export type MinigameId = 'berries' | 'herd';

export interface MinigameDef {
  id: MinigameId;
  /** Имя в строке промыслов и в карточке начала. */
  name: string;
  /**
   * Двор, который игра повторяет: его выработка (`data/yards.ts`) задаёт, какие запасы игра даёт и в какой доле.
   * Своей таблицы наград у игры нет — вторая разошлась бы с двором при первой правке.
   */
  yard: BuildingTypeId;
  /** Цель одной строкой — карточка начала. */
  goal: string;
  /** Запасной знак, пока в листе нет значка (`ui/icons/Icon.tsx`). Emoji 12.0. */
  glyph: string;
}

/** Полный запас энергии: шкала долей — 25 энергии читается четвертью суток ожидания. */
export const ENERGY_MAX = 100;

/** За сколько настоящего времени запас копится от нуля до полного: слово владельца — сутки. */
export const ENERGY_REFILL = realTime(DAY_MS);

/**
 * Цена одной игры. Полный запас — четыре игры по минуте с небольшим, то есть один заход в 3–5 минут (CLAUDE.md):
 * заходящий раз в сутки тратит весь запас за один заход, заходящий четырежды — играет по разу.
 */
export const MINIGAME_COST = 25;

/**
 * Какую долю суточной выработки города приносит полный запас энергии на потолке умения. Двенадцатая — 8 %: заметно
 * в полосе запасов и двора не заменяет. При шкале ×30 игра (четверть запаса) на потолке — ровно игровой день выработки,
 * то самое «+N в день» из подсказки запаса.
 */
export const MINIGAME_SHARE = 1 / 12;

export const MINIGAMES: readonly MinigameDef[] = [
  { id: 'berries', name: 'Ягоды', yard: 'gathering', goal: 'Собери спелые ягоды', glyph: '🍓' },
  { id: 'herd', name: 'Скот', yard: 'pen', goal: 'Накорми всех в загоне', glyph: '🐑' },
];

export const MINIGAME_BY_ID: Record<MinigameId, MinigameDef> = Object.fromEntries(MINIGAMES.map((g) => [g.id, g])) as Record<
  MinigameId,
  MinigameDef
>;
