// Что навык агента делает в мире — одно правило на мир и на карточку.
//
// Мир получает от племени три прибавки числами (`PlayerProfile.onslaught`,
// `sightBonus`, `stealth`) и кладёт каждую туда, где у неё своя дверь:
//
// - натиск — в стойкость стороны, **сложением с обрядом**, и только в боях,
//   которые ведёт полководец (`generalResolve`); оборона деревни и вылазка идут
//   мимо, их ведёт гарнизон;
// - зоркость — в радиус, которым разведчик открывает землю (`revealSight`);
//   живого обзора она не даёт, его держит `sight.liveSight`, и он её не читает;
// - скрытность — в то, заметили ли провал (`slipped`); шанс дела не трогает.
//
// Чего здесь нет и не должно быть никогда: вместимости дружины (Статуя), старения
// разведданных, предупреждения и шанса лазутчика (Дозор), обороны (частокол,
// башня, казармы, храм). Держит это `game/data/agents.owners.test.ts`, читая этот
// модуль целиком.
//
// Модуль чистый: ни состояния, ни часов.
import {
  DEFAULT_ORDERS,
  PLAN_IDS,
  UNIT_KINDS,
  emptySectors,
  startMorale,
  stackOf,
  type ArmySetup,
  type UnitKind,
} from '@/battle';
import { gearOf, kindsOf, type TroopStack } from '@/game/battle/kinds';
import { FIGURE_BY_ID } from './data/figures';
import type { FigureId } from './types';

/**
 * Стойкость стороны в бою полководца: обряд храма плюс натиск. Два источника,
 * одно число в бою — так же, как кузница и конюшня складываются в ступень
 * снаряжения. Потолок морали у них общий и живёт в ядре (`startMorale`).
 */
export const generalResolve = (fervour: number, onslaught: number): number =>
  Math.max(0, fervour) + Math.max(0, onslaught);

/**
 * Снаряжение нашего отряда: кузница по видам бойцов. Ступени «от конюшни» здесь больше нет —
 * её место занял второй конный род: доспех на всаднике теперь вид, а не прибавка зданием
 * (docs/stable.md, решение 7).
 */
export function ownGearOf(troops: TroopStack): Partial<Record<UnitKind, number>> {
  return gearOf(troops);
}

/**
 * Радиус, которым фигура открывает **землю**, клеток. Зоркость прибавляется
 * только разведчику: у остальных она не читается вовсе.
 */
export const revealSight = (id: FigureId, sightBonus: number): number =>
  FIGURE_BY_ID[id].sight + (id === 'scout' ? Math.max(0, Math.round(sightBonus)) : 0);

/**
 * Провал лазутчика прошёл незамеченным? Решает тот же бросок, что решил провал,
 * — второго броска нет. `miss` — где легла кость в зоне провала: 0 у самой черты
 * шанса, 1 в самом дальнем углу (`spy.spyOutcome`). Провал, легший ближе к
 * черте, чем доля скрытности, — незамеченный: неудача на волоске уходит тихо.
 * При скрытности ноль не проходит ни один — первый уровень ведёт себя по-прежнему.
 */
export const slipped = (miss: number, stealth: number): boolean => miss < Math.max(0, Math.min(1, stealth));

/**
 * Какая доля провалов проходит незамеченной — **замером**, а не пересказом числа:
 * решение `slipped` прогоняется по всей зоне провала равными шагами.
 */
export function slipShare(stealth: number, steps = 1000): number {
  let n = 0;
  for (let i = 0; i < steps; i++) if (slipped((i + 0.5) / steps, stealth)) n++;
  return n / steps;
}

/** Что натиск даёт одному роду дружины. */
export interface OnslaughtRow {
  kind: UnitKind;
  /** Прибавка к стартовой морали рода при самом неудобном плане, 0..`full`. */
  got: number;
  /** Сколько натиск обещает без потолка. */
  full: number;
}

/**
 * Замер натиска на нынешней дружине: сколько стартовой морали каждому роду
 * прибавит переход от стойкости `from` к стойкости `to` — **той самой функцией
 * ядра**, которой бой считает мораль сектора (`startMorale`), с тем снаряжением,
 * с которым дружина пойдёт в бой.
 *
 * План берётся самый неудобный: пресет быстрой атаки выбирается по сиду боя, и
 * заранее его не знает никто, а план «оборона» сам поднимает мораль и первым
 * упирается в потолок. Поэтому `got` — то, что натиск даст наверняка. Смешанный
 * сектор получает не меньше, чем самый стойкий род в нём: чем ниже средняя
 * мораль, тем дальше потолок.
 */
export function onslaughtRows(troops: TroopStack, fervour: number, from: number, to: number): OnslaughtRow[] {
  const kinds = kindsOf(troops);
  const gear = ownGearOf(troops);
  const rFrom = generalResolve(fervour, from);
  const rTo = generalResolve(fervour, to);
  const rows: OnslaughtRow[] = [];
  for (const kind of UNIT_KINDS) {
    if (kinds[kind] <= 0) continue;
    const stack = stackOf({ [kind]: kinds[kind] });
    let got = Infinity;
    for (const plan of PLAN_IDS) {
      const base: ArmySetup = { sectors: emptySectors(), plan, orders: DEFAULT_ORDERS, reserve: { kind: 'morale' }, gear };
      const gain = startMorale({ ...base, resolve: rTo }, stack) - startMorale({ ...base, resolve: rFrom }, stack);
      got = Math.min(got, gain);
    }
    rows.push({ kind, got: Math.max(0, Math.round(got * 10) / 10), full: rTo - rFrom });
  }
  return rows;
}
