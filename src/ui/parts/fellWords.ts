// Знак павшего города словами (Р-4, отзыв тестера 19.10): «Город взят: ограблен · 20:41:45 назад» не говорил, что это,
// сколько продлится и надо ли что-то делать. Знак значит две вещи: город взяли этой участью, и сутки после падения логова
// его не трогают — ни набегом, ни осадой (`SIEGE_IMMUNE`, на нём же держится срок знака `FALL_MARK`). Делать ничего не
// нужно: знак сходит сам. Что потеряно, говорят числа участи — те же константы, по которым мир делит взятый город
// (`spoils.fate`); своей арифметики здесь нет.
import type { FellMark } from '@/world/types';
import { BURN_IMMUNE, BURN_LEVELS, BURN_POP_SHARE, FALL_BUILDINGS, FALL_LEVELS, FALL_MARK, LED_POP_SHARE } from '@/world/data/tuning';
import { FELL_WORDS } from '@/ui/map/siegemark';
import { realSpanText } from './wait';
import type { TipContent } from '@/ui/next/tip';

const pct = (share: number): string => `${Math.round(share * 100)} %`;

/** Что победитель забрал у города этой участью — словами, числами участи. */
export function fellLoss(fell: FellMark): string {
  const levels = `${FALL_BUILDINGS} построек потеряли по ${FALL_LEVELS} уровню`;
  if (fell.fate === 'plunder') return `Вывезли запасы и золото сверх тайника, ${levels}.`;
  if (fell.fate === 'captives') return `Вывезли запасы и увели в неволю до ${pct(LED_POP_SHARE)} жителей, ${levels}.`;
  return `Разошлись ${pct(BURN_POP_SHARE)} жителей, все постройки потеряли по ${BURN_LEVELS} уровня. Снова сжечь его нельзя ${realSpanText(BURN_IMMUNE / 1000)}.`;
}

/**
 * Строка карточки под павшим городом: имя, срок защиты и подсказка «что это и что делать». `mine` — свой город: ему
 * сказано, что делать ничего не нужно и как вернуть потерянное.
 */
export function fellLine(fell: FellMark, now: number, mine: boolean): { name: string; value: string; tip: TipContent } {
  const ago = realSpanText(Math.max(0, now - fell.at) / 1000);
  const left = realSpanText(Math.max(0, fell.at + FALL_MARK - now) / 1000);
  const what = FELL_WORDS[fell.fate];
  return {
    name: mine ? `Город взяли: ${what}` : `Взят: ${what}`,
    value: `защита ещё ${left}`,
    tip: {
      title: `Город взяли ${ago} назад`,
      body: [
        fellLoss(fell),
        `${realSpanText(FALL_MARK / 1000)} после падения логова его не трогают: ни набега, ни осады. Осталось ${left}, потом знак сойдёт сам.`,
        mine ? 'Делать ничего не нужно. Потерянные уровни вернёт только улучшение построек.' : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
  };
}
