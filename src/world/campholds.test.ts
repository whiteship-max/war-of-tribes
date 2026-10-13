// «Садиться в осаду или штурмовать» (docs/siege_v2.md, 1.3, шаг 3): дверь `fights.campHolds`. Лагерь садится, если удержится
// против вылазки всего гарнизона в минуту, когда рогатки со стороны города дозреют (`holdMinute`). Тесты — на самой двери:
// мир спрашивает её одной строкой (siege.test.ts, «лагерь удержится к дозревшим рогаткам»).
import { describe, expect, it } from 'vitest';
import { emptyStack, type Stack } from '@/battle';
import { campFight, campHolds, holdMinute, type HoldIn } from './fights';
import { sideWorks, worksRipeAt } from './works';
import { siegeWear } from './siege';
import { CAMP_GATE_CLEAR, CAMP_WOOD, CAMP_WORKS_RIPE } from './data/tuning';
import { worldDays } from '@/game/pace';

const T0 = 1_700_000_000_000;
const inf = (n: number): Stack => ({ ...emptyStack(), infantry: n });

/** Путь износа до дна — срок голода окна; здесь — обычный голод осады игроком, около двадцати игровых дней. */
const SPAN = worldDays(20);

const hold = (o: { camp: number; builders: number; sortie: number; rest?: number; seed?: number }): HoldIn => ({
  seed: o.seed ?? 7,
  wearSpan: SPAN,
  sight: { since: T0, builders: o.builders },
  camp: { kinds: inf(o.camp), rest: 1 },
  sortie: { kinds: inf(o.sortie), rest: o.rest ?? 1 },
});

describe('садиться ли: лагерь к дозревшим рогаткам', () => {
  it('минута прогона — дозревание фронта по плану древесины лагеря', () => {
    expect(holdMinute(T0)).toBe(worksRipeAt(T0, 'front', CAMP_WOOD));
    // Граница области: в эту минуту фронт дозрел целиком, а минутой раньше — ещё нет.
    expect(sideWorks(T0, holdMinute(T0), 'front')).toBe(1);
    expect(sideWorks(T0, holdMinute(T0) - 60_000, 'front')).toBeLessThan(1);
    // Лес не рубят ни в одну сторону — фронт не дозреет никогда: срок рогаток от постановки.
    expect(worksRipeAt(T0, 'front', { front: 0, rear: 0 })).toBe(Infinity);
    expect(holdMinute(T0, { front: 0, rear: 0 })).toBe(T0 + CAMP_WORKS_RIPE);
  });

  it('вылазка, сметающая лагерь в минуту постановки, к дозреванию упирается в рогатки — лагерь садится', () => {
    const input = hold({ camp: 30, builders: 30, sortie: 120 });
    const atOnce = campFight({ seed: input.seed, at: T0, sight: input.sight, camp: input.camp, front: input.sortie });
    expect(atOnce.refused, 'в минуту постановки проход открыт').toBe(false);
    expect(!atOnce.refused && atOnce.field.won, 'в минуту постановки лагерь сметён').toBe(true);
    expect(campHolds(input), 'к дозреванию лагерь держится').toBe(true);
  });

  it('проход держат строившие: лагерь, выбитый до горстки, вылазку не удержит и не садится', () => {
    // Строили сто, к дозреванию в лагере десять (башня, мор): проход — доля строивших, и он шире лагеря.
    const thinned = hold({ camp: 10, builders: 100, sortie: 120 });
    expect(campHolds(thinned), 'выбитый лагерь не держится').toBe(false);
    // Тот же лагерь, но строили сами десять — проход узкий, лагерь держится: решает проход, а не одна сила вылазки.
    expect(campHolds(hold({ camp: 10, builders: 10, sortie: 120 }))).toBe(true);
  });

  it('износ осады к минуте дозревания кладёт сама дверь: свежая вылазка взяла бы лагерь, уставшая к той минуте — нет', () => {
    const at = holdMinute(T0);
    const wear = siegeWear(T0, at, SPAN);
    // Граница области: к дозреванию износ уже есть, но дна (0) нет.
    expect(wear).toBeLessThan(1);
    expect(wear).toBeGreaterThan(0);
    // Ищем лагерь, на котором свежая вылазка в минуту дозревания побеждает, а с износом той минуты — нет.
    let found: HoldIn | null = null;
    for (let builders = 5; builders <= 200 && !found; builders++) {
      for (const camp of [10, 20, 30, 40]) {
        const input = hold({ camp, builders, sortie: 300 });
        const fresh = campFight({ seed: input.seed, at, sight: input.sight, camp: input.camp, front: input.sortie });
        const worn = campFight({
          seed: input.seed,
          at,
          sight: input.sight,
          camp: input.camp,
          front: { ...input.sortie, rest: wear },
        });
        if (!fresh.refused && fresh.field.won && !worn.refused && !worn.field.won) {
          found = input;
          break;
        }
      }
    }
    expect(found, 'на решётке есть лагерь, который решает износ').not.toBeNull();
    expect(campHolds(found!), 'дверь считает вылазку с износом той минуты').toBe(true);
  });

  it('к рогаткам пробиться некому — боя нет, лагерь держится', () => {
    // Тот же лагерь, который выбитым вылазку не держит (тест выше), но проход фронта занят целиком в минуту дозревания.
    const input = hold({ camp: 10, builders: 100, sortie: 120 });
    expect(campHolds(input)).toBe(false);
    const busy: HoldIn = { ...input, sight: { ...input.sight, gateAt: holdMinute(T0) + CAMP_GATE_CLEAR } };
    expect(campHolds(busy), 'проход занят — лагерь стоит').toBe(true);
  });
});
