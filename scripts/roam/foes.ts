// Сила НПС бродяги (ГДД 3.6.2): ровный бой отряда против отряда НПС — боем ядра мира, без своих чисел.
//
// Ровный бой — мощь отряда НПС, при которой он берёт верх над нашим отрядом хотя бы в половине боёв: та же мерка, что у таблицы
// у ворот (`scripts/raid-defense-mix.ts`, раздел 4б, `evenOf`): кривая долями мощи отряда, первая точка, где НПС берут половину,
// и деление отрезка до неё. Отряд НПС — тем же генератором, что набег логова (`garrison.raidingParty`); бой — в поле
// (`world/battle.resolveField`), нападает отряд бродяги (дела 3.8.2: он идёт к логову, ватаге, селу). Сид — свой на каждый бой.
//
// Шаг неподвижной точки — тем же правилом, что вывод таблицы у ворот (`console/fixpoint.gateMove`, правило 16): строка в
// `GATE_SETTLE` от записанной — села; повернула назад — полусумма; идёт в одну сторону к последнему шагу — не сошлось.
import { kindsOf, troopPower } from '../../src/game/battle/price';
import type { TroopStack } from '../../src/game/battle/kinds';
import { resolveField } from '../../src/world/battle';
import { raidingParty } from '../../src/world/garrison';
import { GATE_SETTLE } from '../console/fixpoint';

/** Кривая: доли мощи отряда от четверти до трёх шагом в четверть — как кривая ровного боя у ворот. */
const CURVE = Array.from({ length: 12 }, (_, i) => (i + 1) / 4);
/** Шагов деления отрезка у ровного боя. */
const EVEN_STEPS = 8;

/** Бой отряда бродяги с отрядом НПС мощью `power`: взял ли отряд верх и какую долю потерял. */
export function fieldFight(band: TroopStack, power: number, seed: number, id: string): { won: boolean; loss: number } {
  const foe = raidingParty(seed, id, power);
  const r = resolveField({
    seed,
    attacker: { kinds: kindsOf(band) },
    defender: { kinds: foe.kinds },
  });
  return { won: r.won, loss: r.attackerLoss };
}

/** Взяли ли НПС мощью `power` верх хотя бы в половине из `seeds` боёв — и только до решённого ответа. */
function foeHalf(band: TroopStack, power: number, seeds: number, tag: string): boolean {
  const need = seeds / 2;
  let broke = 0;
  for (let i = 1; i <= seeds; i++) {
    if (broke >= need) return true;
    if (broke + (seeds - i + 1) < need) return false;
    if (!fieldFight(band, power, i * 7919, `roam-even-${tag}-${i}`).won) broke++;
  }
  return broke >= need;
}

/** Ровный бой: мощь НПС, при которой они берут половину боёв; `NaN` — до конца кривой не берут. */
export function evenPower(band: TroopStack, seeds: number, tag: string): number {
  const p = troopPower(band);
  if (p <= 0) return NaN;
  const cross = CURVE.findIndex((k) => foeHalf(band, k * p, seeds, tag));
  if (cross < 0) return NaN;
  let lo = cross === 0 ? 0 : CURVE[cross - 1] * p;
  let hi = CURVE[cross] * p;
  for (let k = 0; k < EVEN_STEPS; k++) {
    const mid = (lo + hi) / 2;
    if (!foeHalf(band, mid, seeds, tag)) lo = mid;
    else hi = mid;
  }
  return hi;
}

export type RowMove =
  | { kind: 'settled' }
  | { kind: 'swing'; row: number[]; swung: number[] }
  | { kind: 'step'; row: number[] }
  | { kind: 'stuck'; moving: number[] };

const sat = (x: number, was: number): boolean => Math.abs(x - was) <= GATE_SETTLE * Math.abs(was);
const turned = (prev: number | undefined, was: number, x: number): boolean =>
  prev !== undefined && prev !== was && Math.sign(x - was) === -Math.sign(was - prev);

/**
 * Ход вывода строки силы НПС по ступеням после шага — правило `gateMove`. `seen` — записанные строки по шагам (последняя — та,
 * на которой шаг считал), `derived` — выведенная; ступень без вывода (`NaN`: до неё не дошёл ни один отряд) остаётся записанной.
 */
export function rowMove(seen: readonly (readonly number[])[], derived: readonly number[], last: boolean): RowMove {
  const was = seen[seen.length - 1];
  const prev = seen.length >= 2 ? seen[seen.length - 2] : undefined;
  const swung: number[] = [];
  const moving: number[] = [];
  const row = derived.map((x, i) => {
    const w = was[i];
    if (Number.isNaN(x) || sat(x, w)) return Number.isNaN(x) ? w : x;
    if (turned(prev?.[i], w, x)) {
      swung.push(i);
      return Math.round((x + w) / 2);
    }
    moving.push(i);
    return x;
  });
  if (swung.length === 0 && moving.length === 0) return { kind: 'settled' };
  if (moving.length === 0) return { kind: 'swing', row, swung };
  if (last) return { kind: 'stuck', moving };
  return { kind: 'step', row };
}

/**
 * Где строка силы НПС не растёт по ступеням (ПН-Э2а): номера ступеней, которые не сильнее предыдущей. Сила — от престижа (3.6.2): ступень
 * выше — противник не слабее, и строка, где выше слабее, — находка вывода, а не баланс.
 */
export function rowDrops(row: readonly number[]): number[] {
  return row.flatMap((x, i) => (i > 0 && x < row[i - 1] ? [i] : []));
}
