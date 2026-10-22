// Совет Ратуши (РТ-1): имена должностей, летопись и весть о пустом месте — то, что нужно шагу партии. Слова окна совета (польза,
// дело должности, черты) — `data/councilWords.ts`, едут с окном. Числа — `game/councilrules.ts`, дверь — `sim/council.ts`.
import type { AdvisorPost } from '../types';
import { MAX_ADVISOR_LEVEL } from '../councilrules';

/**
 * Имя должности. Староста становится Бургомистром на последней ступени совета — с той ратуши, что даёт лучших кандидатов:
 * у посёлка — староста, у города — бургомистр.
 */
export function postTitle(post: AdvisorPost, tier: number): string {
  if (post === 'steward') return tier >= MAX_ADVISOR_LEVEL ? 'Бургомистр' : 'Староста';
  return post === 'treasurer' ? 'Казначей' : 'Воевода';
}

/**
 * Возраст, который показывает лицо: годы ступенями по пять — портрет и облик в покоях седеют вместе с человеком, но не
 * перерисовываются каждый год (`render/chambers/advisor/looks.lookOf`).
 */
export const faceAge = (age: number): number => Math.floor(Math.max(0, age) / 5) * 5;

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

/** Весть о пустом месте (`sim/council.vacancyDef`): выбор нового — в совете Ратуши, туда ведёт дверь вести. */
export const COUNCIL_EVENT = {
  id: (post: AdvisorPost): string => `council_${post}`,
  title: (title: string): string => `Место: ${title.toLowerCase()}`,
  from: 'Писарь ратуши',
  text: (title: string, name: string | null, why: CouncilGone | null): string =>
    `${name ? `${COUNCIL_LOG.gone(title, name, why ?? 'rest')} ` : ''}Место пустует. В ратуше ждут просители — выбери нового или оставь место пустым.`,
  later: 'Подождать',
  laterSaid: 'Место ждёт. Просители — в ратуше, совет.',
};
