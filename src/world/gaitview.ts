// Режим марша глазами окна дела (ДР-7, docs/city_v3.md, «Решения ДР-7»): что режим сделает с составом, выбранным в том же окне.
// Числа — дверью `world/gait` (`lightShare`, `gaitHaul`) и той же поклажей, что у мира (`data/units.stackCarry` по головам,
// `LocalWorld.haul`); своего правила здесь нет. Отдельным модулем нарочно: окно дела едет докачкой, и первой загрузке это не нужно.
// Без `@/`: модуль чистый.
import { gaitHaul, lightShare, type Gait } from './gait';
import { stackCarry } from './data/units';

/**
 * Что режим сделает с отрядом из `men` бойцов на дороге `walkMs`: ожидание ушедших налегке к приходу (доля × отряд) и сколько
 * добра поднимут дошедшие — поклажа без ожидаемой убыли, множитель режима (`gaitHaul`) и множитель своего отряда `haul` (черта
 * «Добычливый»; 0 — дело добычи не берёт).
 */
export function gaitTake(men: number, g: Gait | undefined, walkMs: number, haul: number): { lost: number; carry: number } {
  const n = Math.max(0, Math.floor(Number.isFinite(men) ? men : 0));
  const lost = Math.round(n * lightShare(g, walkMs));
  const carry = haul > 0 ? Math.floor(stackCarry({ warrior: n - lost }) * haul * gaitHaul(g)) : 0;
  return { lost, carry };
}
