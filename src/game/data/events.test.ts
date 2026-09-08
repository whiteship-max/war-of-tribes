import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from './buildings';
import { EVENTS, eventBlock, eventCost, optionHint, type EventOption } from './events';
import { resolveEvent } from '../sim/actions';
import type { GameState } from '../types';

/**
 * Цена события — одна на показ, на запрет и на списание.
 *
 * Так было не всегда: цена жила строкой внутри `apply`, а игрок читал её из
 * подписи, написанной руками. Узнать при этом, **хватает ли**, было неоткуда —
 * окно события закрывает и склад, и всю игру, отложить его нельзя, — и «отдать
 * припасы» нажималось наугад. Не хватило — молча платили тем, что было, и
 * получали полную награду.
 *
 * Эти тесты держат новое правило с трёх сторон: цена объявлена полем, по ней
 * гаснет кнопка, и она же списывается. Плюс четвёртое, без чего первые три
 * опасны: у каждого события остаётся выбор, который ничего не стоит, — иначе
 * гаснущие кнопки заперли бы игрока в окне, которое не закрывается.
 */

/** Посёлок с большим складом и полными закромами. */
function rich(): GameState {
  const s = createInitialState();
  s.tutorialDone = true;
  for (const b of s.buildings) b.level = Math.min(BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  s.gold = 5000;
  s.pop = 200;
  return s;
}

/** Пусто и на складе, и в казне. */
function broke(): GameState {
  const s = rich();
  for (const r of RESOURCE_IDS) s.resources[r] = 0;
  s.gold = 0;
  return s;
}

const paid = (o: EventOption, s: GameState): boolean =>
  Object.values(eventCost(o, s)).some((n) => (n ?? 0) > 0);

describe('цена события объявлена, а не спрятана в apply', () => {
  it('у каждого события есть выбор, который ничего не стоит', () => {
    const s = rich();
    for (const e of EVENTS) {
      const free = e.options.filter((o) => !paid(o, s));
      // Без этого запрет по нехватке запер бы игрока: окно события не
      // закрывается, отложить его нельзя, и все выходы оказались бы гашены.
      expect(free.length, `${e.id}: все варианты просят добро`).toBeGreaterThan(0);
    }
  });

  it('списывается ровно объявленное — ни больше, ни меньше', () => {
    for (const e of EVENTS) {
      for (const [i, o] of e.options.entries()) {
        const s = rich();
        const cost = eventCost(o, s);
        if (!paid(o, s)) continue;
        const before = { ...s.resources, gold: s.gold };
        s.activeEvent = { defId: e.id, at: s.time };
        const r = resolveEvent(s, i);
        expect(r.error, `${e.id}/${i}`).toBeNull();
        for (const res of RESOURCE_IDS) {
          const need = cost[res] ?? 0;
          if (need <= 0) continue;
          expect(Math.round(before[res] - s.resources[res]), `${e.id}/${i}: ${res}`).toBe(need);
        }
        const gold = cost.gold ?? 0;
        if (gold > 0) expect(Math.round(before.gold - s.gold)).toBe(gold);
      }
    }
  });

  it('не хватило — вариант не нажимается, и склад не трогают', () => {
    for (const e of EVENTS) {
      for (const [i, o] of e.options.entries()) {
        const s = broke();
        if (!paid(o, rich())) continue;
        // Цена считается от размера посёлка, а он тот же: на пустом складе
        // проситься она будет ровно так же, только платить нечем.
        if (!paid(o, s)) continue;
        expect(eventBlock(o, s), `${e.id}/${i}`).not.toBeNull();
        s.activeEvent = { defId: e.id, at: s.time };
        const r = resolveEvent(s, i);
        expect(r.error, `${e.id}/${i}`).not.toBeNull();
        // Событие осталось на экране, ничего не случилось и не списалось.
        expect(s.activeEvent).not.toBeNull();
        for (const res of RESOURCE_IDS) expect(s.resources[res]).toBe(0);
        expect(s.gold).toBe(0);
      }
    }
  });

  it('подпись варианта не переписывает цену словами', () => {
    const s = rich();
    // Слова, какими в подписях назывались списываемые ресурсы. Мораль и
    // престиж сюда не входят — их не платят со склада, и минус у них свой.
    const words = /−\s*\d+\s*(ед|древес|камн|шкур|кост|мед|желез|золот)/i;
    for (const e of EVENTS) {
      for (const o of e.options) {
        const hint = optionHint(o, s) ?? '';
        // Цену показывает `Cost` — значком и вместе с запасом. Написанная
        // второй раз словами, она разойдётся с числом при первой же правке.
        expect(hint, `${e.id}: «${hint}»`).not.toMatch(words);
      }
    }
  });

  it('цена растёт вместе с посёлком, как и всё остальное в событии', () => {
    const small = rich();
    small.pop = 30;
    const big = rich();
    big.pop = 600;
    let seen = 0;
    for (const e of EVENTS) {
      for (const o of e.options) {
        if (!paid(o, small)) continue;
        const a = Object.values(eventCost(o, small)).reduce<number>((n, v) => n + (v ?? 0), 0);
        const b = Object.values(eventCost(o, big)).reduce<number>((n, v) => n + (v ?? 0), 0);
        expect(b, e.id).toBeGreaterThan(a);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(5);
  });
});
