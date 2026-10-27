// Вещи правителя (ДР-7, docs/city_v3.md, «Решения ДР-7») — единственная дверь, которая пишет `RealmState.gear`: на агентов вещи не
// надевают. Читает поле из сохранения `sim/dynasty.mergeRealm`. Место получает имя и ничего больше; что вещь даёт, спросят у
// `data/items.ITEMS`, когда она будет надета, а снятая лежит в сундуке — во владении (`net/owned.ts`). Отдельным модулем нарочно:
// переодевают из раздела правителя, и первой загрузке это не нужно.
import type { GameState } from '../types';
import { GEAR_SLOTS, ITEMS, type ItemId } from '../data/items';
import { has } from '../guard';

/** Вещи правителя по местам: имя или пусто. */
export const gearOf = (s: GameState): (ItemId | null)[] => Array.from({ length: GEAR_SLOTS }, (_, i) => s.realm.gear?.[i] ?? null);

/**
 * Надеть вещь на правителя или снять её (`item` = null). Правитель всегда дома: переодевать его можно всегда. Места — у
 * престола: наследник садится в тех же вещах.
 */
export function wear(s: GameState, slot: number, item: ItemId | null, owned: readonly ItemId[]): string | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= GEAR_SLOTS) return 'Такого места нет.';
  const gear = gearOf(s);
  if (item !== null) {
    if (!has(ITEMS, item)) return 'Такой вещи нет.';
    if (!owned.includes(item)) return 'Этой вещи у тебя нет.';
    if (gear.some((x, i) => i !== slot && x === item)) return 'Эта вещь уже надета.';
  }
  gear[slot] = item;
  if (gear.some((x) => x !== null)) s.realm.gear = gear;
  else delete s.realm.gear;
  return null;
}
