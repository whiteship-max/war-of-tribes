// Знак павшего города словами (Р-4): что значит, сколько держится защита, что делать. Числа — константы участи и окна
// после падения (правило 18): строка сверяется с ними, а не с переписанными числами.
import { describe, expect, it } from 'vitest';
import { fellLine, fellLoss } from './fellWords';
import { realSpanText } from './wait';
import { BURN_LEVELS, BURN_POP_SHARE, FALL_BUILDINGS, FALL_MARK, LED_POP_SHARE, SIEGE_IMMUNE } from '@/world/data/tuning';

const AT = 1_900_000_000_000;
const HOUR = 3_600_000;

describe('знак «ограблен» словами', () => {
  it('срок знака — окно после падения: что видно, то и держит', () => {
    expect(FALL_MARK).toBe(SIEGE_IMMUNE);
  });

  it('свой город: что потеряно, сколько ещё защита, делать ничего не нужно', () => {
    const now = AT + 3 * HOUR;
    const l = fellLine({ fate: 'plunder', at: AT }, now, true);
    expect(l.name).toBe('Город взяли: ограблен');
    expect(l.value).toBe(`защита ещё ${realSpanText((FALL_MARK - 3 * HOUR) / 1000)}`);
    expect(l.tip.title).toBe(`Город взяли ${realSpanText(3 * 3600)} назад`);
    expect(l.tip.body).toContain(`${FALL_BUILDINGS} построек потеряли`);
    expect(l.tip.body).toContain('ни набега, ни осады');
    expect(l.tip.body).toContain('Делать ничего не нужно');
    // Прежний вид — часы «20:41:45 назад» без смысла — не возвращается.
    expect(`${l.name} ${l.value}`).not.toMatch(/\d+:\d+:\d+/);
  });

  it('чужой город — без совета «что делать»; доли участи — числами мира', () => {
    const l = fellLine({ fate: 'captives', at: AT }, AT + HOUR, false);
    expect(l.name).toBe('Взят: уведены люди');
    expect(l.tip.body).not.toContain('Делать ничего не нужно');
    expect(fellLoss({ fate: 'captives', at: AT })).toContain(`${Math.round(LED_POP_SHARE * 100)} %`);
    const burn = fellLoss({ fate: 'burn', at: AT });
    expect(burn).toContain(`${Math.round(BURN_POP_SHARE * 100)} %`);
    expect(burn).toContain(`по ${BURN_LEVELS} уровня`);
  });

  it('знак сошёл — защиты не осталось, ноль, а не отрицательный срок', () => {
    expect(fellLine({ fate: 'plunder', at: AT }, AT + FALL_MARK + HOUR, true).value).toBe(`защита ещё ${realSpanText(0)}`);
  });
});
