// Совет Ратуши (РТ-1): слова должностей, черт и летописи. Числа — `game/councilrules.ts`, дверь — `sim/council.ts`.
import type { AdvisorPost, AdvisorTrait } from '../types';
import { MAX_ADVISOR_LEVEL } from '../councilrules';

/**
 * Имя должности. Староста становится Бургомистром на последней ступени совета — с той ратуши, что даёт лучших кандидатов:
 * у посёлка — староста, у города — бургомистр.
 */
export function postTitle(post: AdvisorPost, tier: number): string {
  if (post === 'steward') return tier >= MAX_ADVISOR_LEVEL ? 'Бургомистр' : 'Староста';
  return post === 'treasurer' ? 'Казначей' : 'Воевода';
}

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

/** Почему место опустело. */
export type CouncilGone = 'died' | 'rest' | 'unpaid' | 'dismissed';

/** Строки летописи совета. */
export const COUNCIL_LOG = {
  hired: (title: string, name: string): string => `${title} ${name} вступил в должность.`,
  gone: (title: string, name: string, why: CouncilGone): string =>
    why === 'died'
      ? `${title} ${name} скончался на службе.`
      : why === 'rest'
        ? `${title} ${name} ушёл на покой.`
        : why === 'unpaid'
          ? `${title} ${name} ушёл: жалованье не платят.`
          : `${title} ${name} отставлен.`,
};

/** Весть о пустом месте (`sim/council.councilEvents`). */
export const COUNCIL_EVENT = {
  id: (post: AdvisorPost): string => `council_${post}`,
  title: (title: string): string => `Место: ${title.toLowerCase()}`,
  from: 'Писарь ратуши',
  text: (title: string, name: string | null, why: CouncilGone | null): string =>
    `${name ? `${COUNCIL_LOG.gone(title, name, why ?? 'rest')} ` : ''}Место пустует. В ратуше ждут просители — назначь нового или оставь место пустым.`,
  later: 'Подождать',
  laterSaid: 'Место ждёт. Просители — в ратуше, совет.',
  best: 'Назначить лучшего',
  none: 'Просителей нет: место ждёт.',
  taken: (title: string, name: string): string => `Место уже занял ${title.toLowerCase()} ${name}.`,
};
