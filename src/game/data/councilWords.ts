// Совет Ратуши (РТ-1): слова окна совета — польза, дело должности и черты. Едут докачкой с окном (`ui/next/HallCouncil`):
// шагу партии они не нужны. Числа к ним — `game/councilrules.ts` теми же формулами.
import type { AdvisorPost, AdvisorTrait } from '../types';

/** Чем должность полезна — словом к числу пользы: «+10 % к стройке и добыче». */
export const POST_GIFT: Readonly<Record<AdvisorPost, string>> = {
  steward: 'к стройке и добыче',
  treasurer: 'к налогу и торговле',
  marshal: 'к стойкости дружины',
};

/** Что должность ведёт — одной строкой под именем места, пока оно пустует. */
export const POST_DUTY: Readonly<Record<AdvisorPost, string>> = {
  steward: 'Ведёт стройку и дворы за стеной',
  treasurer: 'Считает подати и выручку рынка',
  marshal: 'Учит дружину стоять в строю',
};

/** Черта: имя и что она делает — без чисел, числа считает окно теми же формулами (`councilrules`). */
export const TRAIT_WORD: Readonly<Record<AdvisorTrait, { name: string; does: string; good: boolean }>> = {
  zealous: { name: 'Усердный', does: 'польза — как у уровня выше', good: true },
  scholar: { name: 'Книжник', does: 'очко в день сверх уровня', good: true },
  frugal: { name: 'Бережливый', does: 'найм без платы вперёд', good: true },
  hale: { name: 'Крепкий', does: 'доживёт до покоя', good: true },
  frail: { name: 'Хворый', does: 'умрёт на службе', good: false },
  greedy: { name: 'Корыстный', does: 'жалованье — как у уровня выше', good: false },
};
